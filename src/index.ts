import { join } from 'node:path';
import pkg from '../package.json';
import { ManifestError } from './render/manifest';
import { renderPackage, type RenderEnv } from './render/pipeline';
import { createRenderCache } from './render/cache';
import { prewarmChartWorkers } from './render/execute';
import { fontsDir } from './render/fonts';
import type { ApiError } from './render/types';
import * as templates from './templates';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';

export interface ServerEnv extends Partial<RenderEnv> {
  host?: string;
  port?: number;
  maxBody?: number;
  /** 结果缓存目录（默认 .render-cache/results） */
  cacheDir?: string;
  /** 结果缓存 TTL（毫秒，默认 24h；<=0 关闭 TTL） */
  cacheTtlMs?: number;
  /** 结果缓存条数上限（默认 500；<=0 不限制条数） */
  cacheMax?: number;
}

export function createServer(env: ServerEnv = {}) {
  const host = env.host ?? HOST;
  const port = env.port ?? PORT;
  const workdirBase = env.workdirBase ?? join(import.meta.dir, '..', '.render-cache');
  const timeoutMs = env.timeoutMs ?? Number(process.env.RENDER_TIMEOUT_MS ?? 10000);
  const maxBody = env.maxBody ?? Number(process.env.RENDER_MAX_BODY ?? 20 * 1024 * 1024);
  const cacheDir = env.cacheDir ?? process.env.RENDER_CACHE_DIR ?? join(workdirBase, 'results');
  const cacheTtlMs = env.cacheTtlMs ?? Number(process.env.RENDER_CACHE_TTL_MS ?? 24 * 60 * 60 * 1000);
  const cacheMax = env.cacheMax ?? Number(process.env.RENDER_CACHE_MAX ?? 500);
  const cache = env.cache ?? createRenderCache(cacheDir, cacheTtlMs, cacheMax);
  const renderEnv: RenderEnv = { workdirBase, timeoutMs, cache };

  const server = Bun.serve({
    hostname: host,
    port,
    maxRequestBodySize: maxBody,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === 'GET' && url.pathname === '/health') {
        return Response.json({ ok: true, service: 'render-service', version: pkg.version });
      }

      if (req.method === 'GET' && url.pathname === '/') {
        return serveFrontend();
      }

      if (req.method === 'GET' && url.pathname === '/playground') {
        return serveEditor();
      }

      if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
        return serveFrontendAsset(url.pathname);
      }

      if (req.method === 'GET' && url.pathname.startsWith('/examples/')) {
        return serveExample(url.pathname);
      }

      if (req.method === 'GET' && url.pathname.startsWith('/api/font-files/')) {
        return serveFontFile(decodeURIComponent(url.pathname.slice('/api/font-files/'.length)));
      }

      if (req.method === 'POST' && url.pathname === '/render') {
        return handleRender(req, renderEnv);
      }

      if (url.pathname === '/api/templates' || url.pathname.startsWith('/api/templates/')) {
        return handleTemplateApi(req, url.pathname, renderEnv);
      }

      return err('NOT_FOUND', `没有路由 ${req.method} ${url.pathname}`, 404);
    },
  });

  prewarmChartWorkers();
  return server;
}

if (import.meta.main) {
  const server = createServer();
  console.log(`render-service listening on http://${server.hostname}:${server.port}`);
  console.log(`  GET  /                     模板管理界面（列表/编辑/预览/保存）`);
  console.log(`  POST /api/templates        模板 CRUD（文件存储，TEMPLATES_DIR=${templates.templatesDir()}）`);
  console.log(`  POST /api/templates/:id/render  按模板 ID + data 渲染图片（调用方入口）`);
  console.log(`  POST /api/templates/:id/stages  管线阶段预览（HTML / SVG 截断）`);
  console.log(`  GET  /playground           独立模板编辑器`);
  console.log(`  POST /render               通用代码包渲染`);
  console.log(`  GET  /health               健康检查`);
}

async function handleRender(req: Request, env: RenderEnv): Promise<Response> {
  let body: { files?: Record<string, string>; data?: unknown; options?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return err('BAD_REQUEST', '请求体必须是 JSON', 400);
  }
  if (!body.files || typeof body.files !== 'object' || Array.isArray(body.files)) {
    return err('BAD_REQUEST', '请求体需要 files 对象（文件名 -> 内容）', 400);
  }

  try {
    const t0 = performance.now();
    const result = await renderPackage(
      { files: body.files, data: body.data, options: body.options as never },
      env,
    );
    return new Response(result.buffer, {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Content-Length': String(result.buffer.byteLength),
        'Cache-Control': 'no-store',
        'X-Cache': result.cached ? 'HIT' : 'MISS',
        'X-Render-Time-Ms': Math.round(performance.now() - t0).toString(),
      },
    });
  } catch (e) {
    const code = e instanceof ManifestError ? 'INVALID_PACKAGE' : 'RENDER_FAILED';
    return err(code, e instanceof Error ? e.message : String(e), 422);
  }
}

function err(code: string, message: string, status: number): Response {
  const body: ApiError = { error: { code, message } };
  return Response.json(body, { status });
}

/** 模板管理 API：/api/templates*（CRUD + 按 ID 渲染） */
async function handleTemplateApi(
  req: Request,
  pathname: string,
  env: RenderEnv,
): Promise<Response> {
  if (pathname === '/api/templates') {
    if (req.method === 'GET') {
      return Response.json({ list: await templates.listTemplates() });
    }
    if (req.method === 'POST') {
      const body = await safeJson(req);
      if (!body) return err('BAD_REQUEST', '请求体必须是 JSON', 400);
      try {
        const id = await templates.createTemplate({
          name: body.name,
          kind: (body.kind as templates.TemplateKind) ?? undefined,
          files: body.files as never,
          data: body.data,
        });
        return Response.json({ id, ok: true });
      } catch (e) {
        return templateError(e);
      }
    }
    return err('NOT_FOUND', `没有路由 ${req.method} ${pathname}`, 404);
  }

  // /api/templates/:id[/action[/arg]]
  const m = pathname.match(/^\/api\/templates\/([\w-]+)(?:\/([\w-]+)(?:\/([\w-]+))?)?$/);
  if (!m) return err('NOT_FOUND', `没有路由 ${req.method} ${pathname}`, 404);
  const id = m[1];
  const action = m[2] ?? '';
  const arg = m[3] ?? '';

  try {
    if (action === 'render' && req.method === 'POST') {
      const body = await safeJson(req);
      if (!body) return err('BAD_REQUEST', '请求体必须是 JSON', 400);
      const t0 = performance.now();
      const result = await templates.renderTemplate(
        id, body.data, body.options as never, env,
        undefined,
        body.files as Record<string, string> | undefined,
      );
      return new Response(result.buffer, {
        status: 200,
        headers: {
          'Content-Type': result.contentType,
          'Content-Length': String(result.buffer.byteLength),
          'Cache-Control': 'no-store',
          'X-Cache': result.cached ? 'HIT' : 'MISS',
          'X-Render-Time-Ms': Math.round(performance.now() - t0).toString(),
        },
      });
    }
    if (action === 'stages' && req.method === 'POST') {
      const body = await safeJson(req);
      if (!body) return err('BAD_REQUEST', '请求体必须是 JSON', 400);
      const t0 = performance.now();
      const result = await templates.renderTemplate(
        id, body.data, body.options as never, env,
        { captureStages: true },
        body.files as Record<string, string> | undefined,
      );
      if (!result.stages) return err('RENDER_FAILED', '未采集到管线阶段信息', 422);
      return Response.json(
        { ok: true, stages: result.stages },
        { headers: { 'X-Render-Time-Ms': Math.round(performance.now() - t0).toString() } },
      );
    }
    if (action === 'copy' && req.method === 'POST') {
      const newId = await templates.copyTemplate(id);
      return Response.json({ id: newId, ok: true });
    }
    if (action === 'rename' && req.method === 'POST') {
      const body = await safeJson(req);
      if (!body) return err('BAD_REQUEST', '请求体必须是 JSON', 400);
      const next = await templates.renameTemplate(id, String(body.id ?? ''));
      return Response.json({ id: next, ok: true });
    }
    if (action === 'versions' && !arg) {
      if (req.method === 'GET') return Response.json({ list: await templates.listVersions(id) });
      if (req.method === 'POST') {
        const v = await templates.snapshotVersion(id);
        return Response.json({ v, ok: true });
      }
      if (req.method === 'DELETE') {
        await templates.clearVersions(id);
        return Response.json({ ok: true });
      }
    }
    if (action === 'versions' && arg) {
      if (req.method === 'GET') return Response.json({ v: arg, files: await templates.getVersion(id, arg) });
      if (req.method === 'DELETE') {
        await templates.deleteVersion(id, arg);
        return Response.json({ ok: true });
      }
    }
    if (action === 'restore' && arg && req.method === 'POST') {
      await templates.restoreVersion(id, arg);
      return Response.json({ ok: true });
    }
    if (!action) {
      if (req.method === 'GET') {
        return Response.json(await templates.getTemplate(id));
      }
      if (req.method === 'PUT') {
        const body = await safeJson(req);
        if (!body) return err('BAD_REQUEST', '请求体必须是 JSON', 400);
        await templates.updateTemplate(id, {
          name: body.name,
          files: body.files as never,
          data: body.data,
        });
        return Response.json({ ok: true });
      }
      if (req.method === 'DELETE') {
        await templates.deleteTemplate(id);
        return Response.json({ ok: true });
      }
    }
  } catch (e) {
    return templateError(e);
  }
  return err('NOT_FOUND', `没有路由 ${req.method} ${pathname}`, 404);
}

async function safeJson(
  req: Request,
): Promise<{ id?: string; name?: string; kind?: string; files?: unknown; data?: unknown; options?: unknown } | null> {
  try {
    return (await req.json()) as never;
  } catch {
    return null;
  }
}

function templateError(e: unknown): Response {
  if (e instanceof templates.TemplateConflictError) return err('CONFLICT', e.message, 409);
  if (e instanceof templates.TemplateError) return err('NOT_FOUND', e.message, 404);
  if (e instanceof ManifestError) return err('INVALID_PACKAGE', e.message, 422);
  return err('RENDER_FAILED', e instanceof Error ? e.message : String(e), 422);
}

/** 管理前端页面（frontend/dist） */
async function serveFrontend(): Promise<Response> {
  const html = await Bun.file(join(import.meta.dir, '..', 'frontend', 'dist', 'index.html')).text();
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/** 前端构建产物静态资源 */
async function serveFrontendAsset(pathname: string): Promise<Response> {
  const rel = pathname.replace(/^\/assets\//, '');
  if (rel.includes('..') || !/^[\w.-]+$/.test(rel)) {
    return err('NOT_FOUND', '非法路径', 404);
  }
  const file = Bun.file(join(import.meta.dir, '..', 'frontend', 'dist', 'assets', rel));
  if (!(await file.exists())) return err('NOT_FOUND', `资源不存在: ${rel}`, 404);
  const ext = rel.split('.').pop() ?? '';
  const ct = ext === 'js' ? 'text/javascript' : ext === 'css' ? 'text/css' : ext === 'svg' ? 'image/svg+xml' : 'application/octet-stream';
  return new Response(file, { headers: { 'Content-Type': ct } });
}

/** 静态提供字体文件（供 HTML 阶段预览 @font-face 使用） */
async function serveFontFile(name: string): Promise<Response> {
  if (!name || name.includes('/') || name.includes('..') || !/^[\w.-]+$/.test(name)) {
    return err('NOT_FOUND', '非法字体文件名', 404);
  }
  const file = Bun.file(join(fontsDir(), name));
  if (!(await file.exists())) return err('NOT_FOUND', `字体不存在: ${name}`, 404);
  const ext = name.split('.').pop()?.toLowerCase();
  const ct =
    ext === 'ttf' ? 'font/ttf'
    : ext === 'otf' ? 'font/otf'
    : ext === 'ttc' ? 'font/collection'
    : 'application/octet-stream';
  return new Response(file, { headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400' } });
}

/** 独立模板编辑器页面（/playground，单文件无构建） */
async function serveEditor(): Promise<Response> {
  const html = await Bun.file(join(import.meta.dir, 'editor.html')).text();
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/** 静态提供 examples/ 下的示例代码包（供编辑器加载示例） */
async function serveExample(pathname: string): Promise<Response> {
  const rel = pathname.replace(/^\/examples\//, '');
  // 防路径穿越：只允许普通文件名/子目录
  if (rel.includes('..') || rel.split('/').some((s) => !/^[\w.-]+$/.test(s))) {
    return err('NOT_FOUND', '非法路径', 404);
  }
  const file = Bun.file(join(import.meta.dir, '..', 'examples', rel));
  if (!(await file.exists())) {
    return err('NOT_FOUND', `示例文件不存在: ${rel}`, 404);
  }
  const ext = rel.split('.').pop() ?? '';
  const ct =
    ext === 'json' ? 'application/json'
    : ext === 'html' ? 'text/html; charset=utf-8'
    : ext === 'js' ? 'text/javascript; charset=utf-8'
    : 'application/octet-stream';
  return new Response(file, { headers: { 'Content-Type': ct } });
}
