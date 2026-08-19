/**
 * 模板管理：模板以文件形式存储在 `TEMPLATES_DIR/<id>/` 下，
 * 目录可通过 Docker 卷映射持久化。
 *
 * 结构：
 *   templates/<id>/manifest.json   （含 name 等元数据）
 *   templates/<id>/template.vue    （Vue 模板：{{ data.xxx }} / unocss class）
 *   templates/<id>/render.js       （可选 d3 图表脚本）
 *   templates/<id>/data.json       （预览用的默认数据）
 */
import { join } from 'node:path';
import { renderPackage, type RenderEnv } from './render/pipeline';
import { ManifestError } from './render/manifest';

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

export interface TemplateMeta {
  id: string;
  name: string;
  updated_at: string;
}

export interface TemplateFiles {
  'manifest.json'?: string;
  'template.vue'?: string;
  'render.js'?: string;
}

export function templatesDir(): string {
  return process.env.TEMPLATES_DIR ?? join(import.meta.dir, '..', 'templates');
}

export function templatePath(id: string): string {
  // 防路径穿越：id 只允许安全字符
  if (!/^[\w-]+$/.test(id)) throw new TemplateError(`非法模板 ID: ${id}`);
  return join(templatesDir(), id);
}

export async function listTemplates(): Promise<TemplateMeta[]> {
  const dir = templatesDir();
  await mkdir(dir, { recursive: true });
  const entries = (await readdir(dir)).filter((n) => /^[\w-]+$/.test(n));
  const list: TemplateMeta[] = [];
  for (const id of entries) {
    const p = templatePath(id);
    const manifestPath = join(p, 'manifest.json');
    if (!(await exists(manifestPath))) continue;
    let name = id;
    try {
      const m = JSON.parse(await Bun.file(manifestPath).text());
      if (typeof m?.name === 'string' && m.name) name = m.name;
    } catch {}
    const st = await stat(p);
    list.push({ id, name, updated_at: new Date(st.mtimeMs).toISOString() });
  }
  list.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  return list;
}

export async function createTemplate(body: {
  name?: string;
  files?: TemplateFiles;
  data?: unknown;
}): Promise<string> {
  const id = crypto.randomUUID().slice(0, 8);
  const dir = templatePath(id);
  await mkdir(dir, { recursive: true });

  const name = body.name?.trim() || '未命名模板';
  const manifest = {
    schema: 1,
    width: 800,
    height: 0,
    format: 'png',
    dpr: 2,
    template: 'template.vue',
    entry: 'render.js',
    ...(body.files?.['manifest.json'] ? JSON.parse(body.files['manifest.json']) : {}),
    name, // 显式传入的 name 优先（复制时覆盖源 manifest 里的名字）
  };

  const files: Record<string, string> = {
    'manifest.json': JSON.stringify(manifest, null, 2),
    'template.vue':
      body.files?.['template.vue'] ??
      `<div class="flex flex-col p-6 bg-white" style="width:800px;font-family:Arial Unicode MS, Arial">
  <div class="text-3xl font-bold text-slate-900">{{ data.title }}</div>
  <div class="text-sm text-slate-400 mt-1">{{ data.subtitle }}</div>
</div>`,
    'render.js': body.files?.['render.js'] ?? 'export default async function render() { return {}; }',
  };
  for (const [k, v] of Object.entries(files)) {
    await Bun.write(join(dir, k), v);
  }
  await Bun.write(join(dir, 'data.json'), JSON.stringify(body.data ?? {}, null, 2));
  return id;
}

export async function getTemplate(id: string): Promise<{
  id: string;
  name: string;
  files: Record<string, string>;
  data: unknown;
}> {
  const dir = templatePath(id);
  if (!(await exists(join(dir, 'manifest.json')))) {
    throw new TemplateError(`模板不存在: ${id}`);
  }
  const read = async (f: string): Promise<string> =>
    (await exists(join(dir, f))) ? await Bun.file(join(dir, f)).text() : '';
  const manifest = JSON.parse((await read('manifest.json')) || '{}');
  return {
    id,
    name: manifest.name ?? id,
    files: {
      'manifest.json': await read('manifest.json'),
      'template.vue': await read('template.vue'),
      'render.js': await read('render.js'),
    },
    data: (await exists(join(dir, 'data.json'))) ? JSON.parse(await read('data.json')) : {},
  };
}

export async function updateTemplate(
  id: string,
  body: { name?: string; files?: TemplateFiles; data?: unknown },
): Promise<void> {
  const dir = templatePath(id);
  if (!(await exists(join(dir, 'manifest.json')))) {
    throw new TemplateError(`模板不存在: ${id}`);
  }
  // 保存前自动快照当前状态（版本管理，可回滚）
  await snapshotVersion(id);
  if (body.files) {
    for (const [k, v] of Object.entries(body.files)) {
      if (!['manifest.json', 'template.vue', 'render.js'].includes(k)) continue;
      await Bun.write(join(dir, k), v ?? '');
    }
    // 更新 name（若给了）
    if (body.name && body.files['manifest.json']) {
      try {
        const m = JSON.parse(body.files['manifest.json']);
        if (m && typeof m.name === 'string') {
          // manifest 里已含 name
        } else {
          const cur = JSON.parse(await Bun.file(join(dir, 'manifest.json')).text());
          cur.name = body.name;
          await Bun.write(join(dir, 'manifest.json'), JSON.stringify(cur, null, 2));
        }
      } catch {}
    }
  }
  if (body.data !== undefined) {
    await Bun.write(join(dir, 'data.json'), JSON.stringify(body.data, null, 2));
  }
}

// ---------------- 版本管理 ----------------

const VERSION_FILES = ['manifest.json', 'template.vue', 'render.js', 'data.json'];

export interface VersionMeta {
  v: string;
  created_at: string;
}

/** 把当前状态快照到 versions/<ts>/，返回版本号 */
export async function snapshotVersion(id: string): Promise<string> {
  const dir = templatePath(id);
  const v = String(Date.now());
  const vdir = join(dir, 'versions', v);
  await mkdir(vdir, { recursive: true });
  for (const f of VERSION_FILES) {
    const p = join(dir, f);
    if (await exists(p)) {
      await Bun.write(join(vdir, f), await Bun.file(p).text());
    }
  }
  return v;
}

export async function listVersions(id: string): Promise<VersionMeta[]> {
  const vdir = join(templatePath(id), 'versions');
  if (!(await exists(vdir))) return [];
  const vs = (await readdir(vdir)).filter((n) => /^\d+$/.test(n));
  vs.sort().reverse();
  return vs.map((v) => ({ v, created_at: new Date(Number(v)).toISOString() }));
}

/** 读取某个版本的文件内容 */
export async function getVersion(id: string, v: string): Promise<Record<string, string>> {
  const vdir = join(templatePath(id), 'versions', v);
  if (!(await exists(join(vdir, 'manifest.json')))) {
    throw new TemplateError(`版本不存在: ${id}@${v}`);
  }
  const out: Record<string, string> = {};
  for (const f of VERSION_FILES) {
    const p = join(vdir, f);
    if (await exists(p)) out[f] = await Bun.file(p).text();
  }
  return out;
}

/** 恢复某个版本到当前（先快照当前，避免丢失） */
export async function restoreVersion(id: string, v: string): Promise<void> {
  const dir = templatePath(id);
  const vdir = join(dir, 'versions', v);
  if (!(await exists(join(vdir, 'manifest.json')))) {
    throw new TemplateError(`版本不存在: ${id}@${v}`);
  }
  await snapshotVersion(id);
  for (const f of VERSION_FILES) {
    const p = join(vdir, f);
    if (await exists(p)) await Bun.write(join(dir, f), await Bun.file(p).text());
  }
}

/** 删除某个版本快照 */
export async function deleteVersion(id: string, v: string): Promise<void> {
  const vdir = join(templatePath(id), 'versions', v);
  if (!/^\d+$/.test(v) || !(await exists(join(vdir, 'manifest.json')))) {
    throw new TemplateError(`版本不存在: ${id}@${v}`);
  }
  await rm(vdir, { recursive: true, force: true });
}

/** 清空该模板的全部版本快照 */
export async function clearVersions(id: string): Promise<void> {
  await rm(join(templatePath(id), 'versions'), { recursive: true, force: true });
}

/** 复制模板为新模板（新 ID，名称加「（副本）」） */
export async function copyTemplate(id: string): Promise<string> {
  const src = await getTemplate(id);
  const newId = await createTemplate({
    name: `${src.name}（副本）`,
    files: src.files as TemplateFiles,
    data: src.data,
  });
  return newId;
}

export async function deleteTemplate(id: string): Promise<void> {
  const dir = templatePath(id);
  if (!(await exists(join(dir, 'manifest.json')))) {
    throw new TemplateError(`模板不存在: ${id}`);
  }
  await rm(dir, { recursive: true, force: true });
}

/** 按模板 ID + data 渲染图片（调用通用渲染管线） */
export async function renderTemplate(
  id: string,
  data: unknown,
  options: { format?: string; width?: number; height?: number; dpr?: number } | undefined,
  env: RenderEnv,
): Promise<{ buffer: Buffer; contentType: string }> {
  const dir = templatePath(id);
  if (!(await exists(join(dir, 'manifest.json')))) {
    throw new TemplateError(`模板不存在: ${id}`);
  }
  const read = async (f: string): Promise<string> =>
    (await exists(join(dir, f))) ? await Bun.file(join(dir, f)).text() : '';

  const manifestJson = await read('manifest.json');
  const files: Record<string, string> = {
    'manifest.json': manifestJson,
    'template.vue': await read('template.vue'),
    'render.js': await read('render.js'),
  };

  // data 缺省用模板默认数据
  const defaultData = (await exists(join(dir, 'data.json')))
    ? JSON.parse(await read('data.json'))
    : {};
  const reqData = data !== undefined && data !== null ? data : defaultData;

  return renderPackage({ files, data: reqData, options: options as never }, env);
}

// ---- fs helpers ----
import { access, mkdir, readdir, rm, stat } from 'node:fs/promises';

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
