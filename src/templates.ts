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
import { renderPackage, type RenderEnv, type RenderOptions, type RenderResult, type ChartResolver } from './render/pipeline';
import { renderChartImage } from './render/chart';
import { contentKey } from './render/cache';
import { ManifestError } from './render/manifest';

export type TemplateKind = 'vue' | 'chart';

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

/** 模板 ID 冲突（如改 ID 时目标 ID 已存在） */
export class TemplateConflictError extends TemplateError {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateConflictError';
  }
}

export interface TemplateMeta {
  id: string;
  name: string;
  kind: TemplateKind;
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
    let kind: TemplateKind = 'vue';
    try {
      const m = JSON.parse(await Bun.file(manifestPath).text());
      if (typeof m?.name === 'string' && m.name) name = m.name;
      if (m?.kind === 'chart') kind = 'chart';
    } catch {}
    const st = await stat(p);
    list.push({ id, name, kind, updated_at: new Date(st.mtimeMs).toISOString() });
  }
  list.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  return list;
}

const DEFAULT_VUE_TEMPLATE = `<div class="flex flex-col p-6 bg-white" style="width:800px">
  <div class="text-3xl font-bold text-slate-900">{{ data.title }}</div>
  <div class="text-sm text-slate-400 mt-1">{{ data.subtitle }}</div>
</div>`;

// 默认数据放在 data.json（不写死在模板/代码里）
const DEFAULT_VUE_DATA = { title: '标题', subtitle: '副标题' };
const DEFAULT_CHART_DATA = { values: [12, 19, 8, 15, 22, 30, 27, 35, 40, 38, 45, 52] };

const DEFAULT_CHART_RENDER = `import * as d3 from 'd3';

// chart 模板：render.js 返回 { main: svg }（仅一张主图）。
// 数据来自 data；画布尺寸来自 manifest.width / manifest.height（<Chart :width/:height> 会覆盖 manifest）。
export default async function render({ data, manifest }) {
  const values = data?.values ?? [];
  const width = manifest?.width || 600;
  const height = manifest?.height || 300;
  const margin = { top: 16, right: 16, bottom: 32, left: 40 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const x = d3.scaleBand().domain(d3.range(values.length)).range([0, innerW]).padding(0.25);
  const y = d3.scaleLinear().domain([0, d3.max(values) || 1]).nice().range([innerH, 0]);
  const svg = d3.select(document.body).append('svg')
    .attr('width', width).attr('height', height).attr('viewBox', \`0 0 \${width} \${height}\`);
  const g = svg.append('g').attr('transform', \`translate(\${margin.left},\${margin.top})\`);
  g.append('g').attr('transform', \`translate(0,\${innerH})\`)
    .call(d3.axisBottom(x).tickFormat((d) => \`\${Number(d) + 1}\`)).attr('color', '#94a3b8');
  g.append('g').call(d3.axisLeft(y).ticks(5)).attr('color', '#94a3b8');
  g.selectAll('rect').data(values).join('rect')
    .attr('x', (d, i) => x(i)).attr('y', (d) => y(d))
    .attr('width', x.bandwidth()).attr('height', (d) => innerH - y(d))
    .attr('fill', '#38bdf8').attr('rx', 3);
  return { main: svg.node().outerHTML };
}`;

export async function createTemplate(body: {
  name?: string;
  kind?: TemplateKind;
  files?: TemplateFiles;
  data?: unknown;
}): Promise<string> {
  const id = crypto.randomUUID().slice(0, 8);
  const dir = templatePath(id);
  await mkdir(dir, { recursive: true });

  let parsedManifest: Record<string, unknown> = {};
  if (body.files?.['manifest.json']) {
    try { parsedManifest = JSON.parse(body.files['manifest.json']); } catch {}
  }
  const kind: TemplateKind = body.kind === 'chart' || parsedManifest.kind === 'chart' ? 'chart' : 'vue';
  const name = body.name?.trim() || (kind === 'chart' ? '未命名图表' : '未命名模板');

  const manifest: Record<string, unknown> = {
    schema: 1,
    kind,
    width: kind === 'chart' ? 0 : 800, // chart 默认按 SVG 固有宽度自适应
    height: 0,
    format: 'png',
    dpr: 2,
    ...parsedManifest,
    name, // 显式传入的 name 优先（复制时覆盖源 manifest 里的名字）
  };
  if (kind === 'vue') {
    manifest.template = parsedManifest.template ?? 'template.vue';
  } else {
    delete manifest.template;
  }
  delete manifest.entry; // 渲染脚本固定为 render.js，不再写入 manifest

  const files: Record<string, string> = { 'manifest.json': JSON.stringify(manifest, null, 2) };
  if (kind === 'vue') {
    files['template.vue'] = body.files?.['template.vue'] ?? DEFAULT_VUE_TEMPLATE;
    if (body.files?.['render.js'] !== undefined) files['render.js'] = body.files['render.js'];
  } else {
    files['render.js'] = body.files?.['render.js'] ?? DEFAULT_CHART_RENDER;
  }

  for (const [k, v] of Object.entries(files)) {
    await Bun.write(join(dir, k), v);
  }
  const defaultData = kind === 'chart' ? DEFAULT_CHART_DATA : DEFAULT_VUE_DATA;
  await Bun.write(join(dir, 'data.json'), JSON.stringify(body.data ?? defaultData, null, 2));
  return id;
}

export async function getTemplate(id: string): Promise<{
  id: string;
  name: string;
  kind: TemplateKind;
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
    kind: manifest.kind === 'chart' ? 'chart' : 'vue',
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

  // 模板类型在创建时固定：更新时以磁盘上的 kind 为准，忽略传入的修改
  let fixedKind: TemplateKind = 'vue';
  try {
    const cur = JSON.parse(await readFileIn(dir, 'manifest.json'));
    if (cur.kind === 'chart') fixedKind = 'chart';
  } catch {}

  if (body.files) {
    for (const [k, v] of Object.entries(body.files)) {
      if (!['manifest.json', 'template.vue', 'render.js'].includes(k)) continue;
      let content = v ?? '';
      if (k === 'manifest.json') {
        try {
          const m = JSON.parse(content || '{}');
          m.kind = fixedKind;
          delete m.entry; // 渲染脚本固定 render.js
          if (fixedKind === 'chart') delete m.template;
          content = JSON.stringify(m, null, 2);
        } catch {}
      }
      await Bun.write(join(dir, k), content);
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
          cur.kind = fixedKind;
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

/**
 * 修改模板 ID（目录改名）。新 ID 不能与现有模板重复。
 * 同时把其他 Vue 模板里对该 ID 的 <Chart id="..."> 引用改成新 ID，避免引用失效。
 */
export async function renameTemplate(id: string, newId: string): Promise<string> {
  const next = (newId ?? '').trim();
  if (!/^[\w-]+$/.test(next)) {
    throw new TemplateError(`非法模板 ID: ${next}（仅允许字母、数字、下划线、连字符）`);
  }
  if (next === id) return id;
  const from = templatePath(id);
  if (!(await exists(join(from, 'manifest.json')))) {
    throw new TemplateError(`模板不存在: ${id}`);
  }
  const to = templatePath(next);
  if (await exists(to)) {
    throw new TemplateConflictError(`模板 ID 已存在: ${next}`);
  }
  await rename(from, to);
  await rewriteChartRefs(id, next);
  return next;
}

/** 把所有 Vue 模板中 <Chart id="oldId"> 的引用改写为 newId */
async function rewriteChartRefs(oldId: string, newId: string): Promise<void> {
  const dir = templatesDir();
  const entries = (await readdir(dir)).filter((n) => /^[\w-]+$/.test(n));
  const re = new RegExp(`(<Chart\\b[^>]*?\\bid\\s*=\\s*)(["'])${escapeRegExp(oldId)}\\2`, 'g');
  for (const id of entries) {
    const p = join(dir, id, 'template.vue');
    if (!(await exists(p))) continue;
    const src = await Bun.file(p).text();
    if (!src.includes(oldId)) continue;
    const out = src.replace(re, `$1$2${newId}$2`);
    if (out !== src) await Bun.write(p, out);
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function deleteTemplate(id: string): Promise<void> {
  const dir = templatePath(id);
  if (!(await exists(join(dir, 'manifest.json')))) {
    throw new TemplateError(`模板不存在: ${id}`);
  }
  await rm(dir, { recursive: true, force: true });
}

/** 读取模板目录内的指定文件（不存在返回空串） */
async function readFileIn(dir: string, f: string): Promise<string> {
  return (await exists(join(dir, f))) ? await Bun.file(join(dir, f)).text() : '';
}

/** 图模板解析器：把 vue 模板里的 <Chart id> 解析为 chart 模板渲染出的图片 */
function makeChartResolver(env: RenderEnv): ChartResolver {
  return async (chartId, data, size) => {
    const dir = templatePath(chartId);
    if (!(await exists(join(dir, 'manifest.json')))) {
      throw new Error(`引用的图表模板不存在: ${chartId}`);
    }
    const manifestJson = await readFileIn(dir, 'manifest.json');
    let manifest: { kind?: string } = {};
    try { manifest = JSON.parse(manifestJson || '{}'); } catch {}
    if (manifest.kind !== 'chart') {
      throw new Error(`模板 ${chartId} 不是图表模板（kind 需为 chart）`);
    }
    const files: Record<string, string> = {
      'manifest.json': manifestJson,
      'render.js': await readFileIn(dir, 'render.js'),
    };
    const reqData =
      data !== undefined && data !== null
        ? data
        : (await exists(join(dir, 'data.json'))) ? JSON.parse(await readFileIn(dir, 'data.json')) : {};
    const img = await renderChartImage(files, reqData, env, size);
    return { dataUri: img.dataUri, width: img.width, height: img.height };
  };
}

/**
 * 按模板 ID + data 渲染图片。
 * - kind=vue：走完整 Vue + Satori 管线，并把 <Chart> 组件解析为 chart 模板图片。
 * - kind=chart：直接跑 render.js 产出图表图片。
 */
export async function renderTemplate(
  id: string,
  data: unknown,
  options: { format?: string; width?: number; height?: number; dpr?: number } | undefined,
  env: RenderEnv,
  renderOpts?: RenderOptions,
  overrideFiles?: Record<string, string>,
): Promise<RenderResult> {
  const dir = templatePath(id);
  if (!(await exists(join(dir, 'manifest.json')))) {
    throw new TemplateError(`模板不存在: ${id}`);
  }

  // 磁盘文件为底，允许调用端覆盖（编辑器预览：传未保存的当前内容）
  const disk: Record<string, string> = {
    'manifest.json': await readFileIn(dir, 'manifest.json'),
    'template.vue': await readFileIn(dir, 'template.vue'),
    'render.js': await readFileIn(dir, 'render.js'),
  };
  const files: Record<string, string> = { ...disk };
  if (overrideFiles) {
    for (const [k, v] of Object.entries(overrideFiles)) {
      if (typeof v === 'string' && ['manifest.json', 'template.vue', 'render.js'].includes(k)) files[k] = v;
    }
  }

  const manifestJson = files['manifest.json'];
  let meta: { kind?: string } = {};
  try { meta = JSON.parse(manifestJson || '{}'); } catch {}
  const kind: TemplateKind = meta.kind === 'chart' ? 'chart' : 'vue';

  // data 缺省用模板默认数据
  const defaultData = (await exists(join(dir, 'data.json')))
    ? JSON.parse(await readFileIn(dir, 'data.json'))
    : {};
  const reqData = data !== undefined && data !== null ? data : defaultData;

  if (kind === 'chart') {
    const chartFiles: Record<string, string> = {
      'manifest.json': manifestJson,
      'render.js': files['render.js'] ?? '',
    };
    // 结果缓存：key 由 data + 图表文件内容决定（md5）。采集阶段产物时跳过缓存。
    const cache = renderOpts?.captureStages ? undefined : env.cache;
    const cacheKey = cache ? contentKey(['chart', chartFiles, reqData ?? null]) : '';
    if (cache && cacheKey) {
      const hit = await cache.get(cacheKey);
      if (hit) return { ...hit, cached: true };
    }
    const img = await renderChartImage(chartFiles, reqData, env);
    const stages = renderOpts?.captureStages
      ? {
          html: '',
          svg: img.svg,
          finalSvg: img.svg,
          autoHeight: false,
          contentBottom: img.height,
          width: img.width,
          height: img.height,
          fonts: [],
        }
      : undefined;
    if (cache) await cache.set(cacheKey, { buffer: img.buffer, contentType: img.contentType });
    return { buffer: img.buffer, contentType: img.contentType, stages };
  }

  const envWithChart: RenderEnv = { ...env, resolveChart: env.resolveChart ?? makeChartResolver(env) };
  return renderPackage({ files, data: reqData, options: options as never }, envWithChart, renderOpts);
}

// ---- fs helpers ----
import { access, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
