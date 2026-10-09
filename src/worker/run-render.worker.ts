/**
 * 常驻 worker（Bun Worker）入口：执行用户 render.js。
 * 与主进程通过 postMessage 通信，复用进程，使 d3 / linkedom 保持热态。
 * 请求：{ id, modulePath, data, manifest }；响应：{ id, ok, charts } | { id, ok:false, error }
 */
import { parseHTML } from 'linkedom';
import { pathToFileURL } from 'node:url';

const { document } = parseHTML('<!doctype html><html><body></body></html>');
(globalThis as Record<string, unknown>).document = document;
(globalThis as Record<string, unknown>).serializeSvg = (node: unknown): string =>
  ensureXmlns(
    node && typeof (node as { outerHTML?: string }).outerHTML === 'string'
      ? (node as { outerHTML: string }).outerHTML
      : String(node),
  );

// 预热：提前导入 d3（项目依赖），消除首个请求的模块加载开销
import('d3').catch(() => {});

function ensureXmlns(svg: string): string {
  const t = svg.trim();
  if (/^<svg[\s>]/.test(t) && !/xmlns=/.test(t.slice(0, 300))) {
    return t.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return svg;
}

interface JobMessage {
  id: number;
  modulePath: string;
  data: unknown;
  manifest: unknown;
}

const post = (msg: unknown) => (self as unknown as { postMessage(m: unknown): void }).postMessage(msg);

self.onmessage = async (e: MessageEvent) => {
  const { id, modulePath, data, manifest } = e.data as JobMessage;
  try {
    // worker 跨任务/跨模板复用同一个 document：每个任务开始前清空 body，避免残留累积
    document.body.innerHTML = '';
    const mod = (await import(pathToFileURL(modulePath).href)) as { default?: unknown };
    const render = mod.default;
    if (typeof render !== 'function') {
      throw new Error('render.js 必须 default export 一个函数');
    }
    const charts = await (render as (ctx: { data: unknown; manifest: unknown }) => unknown)({ data, manifest });
    if (!charts || typeof charts !== 'object' || Array.isArray(charts)) {
      throw new Error('render.js 必须返回 { 槽位名: svg字符串 } 对象');
    }
    const normalized: Record<string, string> = {};
    for (const [k, v] of Object.entries(charts as Record<string, unknown>)) {
      if (typeof v === 'string') {
        normalized[k] = ensureXmlns(v);
      } else if (v && typeof (v as { outerHTML?: string }).outerHTML === 'string') {
        normalized[k] = ensureXmlns((v as { outerHTML: string }).outerHTML);
      } else {
        throw new Error(`图表 "${k}" 的值必须是 SVG 字符串或 DOM 节点`);
      }
    }
    post({ id, ok: true, charts: normalized });
  } catch (err) {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    post({ id, ok: false, error: msg });
  }
};
