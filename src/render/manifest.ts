import type { Manifest } from './types';

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestError';
  }
}

const FORMATS = ['png', 'svg'] as const;

/** 渲染脚本固定文件名（图表脚本入口） */
export const RENDER_SCRIPT = 'render.js';

/**
 * 解析并校验 manifest.json，填充默认值。
 * 抛 ManifestError 表示校验失败，错误信息面向调用方（开发人员/大模型）。
 */
export function parseManifest(raw: unknown, files: Record<string, string>): Manifest {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ManifestError('manifest.json 必须是一个 JSON 对象');
  }
  const m = raw as Record<string, unknown>;

  if (m.schema !== 1) {
    throw new ManifestError(`manifest.schema 必须为 1（当前 ${JSON.stringify(m.schema)}）`);
  }

  const kind: 'vue' | 'chart' = m.kind === 'chart' ? 'chart' : 'vue';

  // vue 模板必须有画布宽度；chart 模板 width=0 表示按 SVG 固有尺寸自适应
  const width = kind === 'chart' ? toAutoInt(m.width, 'manifest.width') : toPositiveInt(m.width, 'manifest.width');
  const height = parseHeight(m.height);

  const format = (m.format ?? 'png') as string;
  if (!FORMATS.includes(format as never)) {
    throw new ManifestError(`manifest.format 只支持 ${FORMATS.join(' | ')}（当前 ${format}）`);
  }

  const dpr = m.dpr === undefined ? 2 : toPositiveNumber(m.dpr, 'manifest.dpr');
  if (dpr > 4) throw new ManifestError('manifest.dpr 建议不超过 4');

  const template = typeof m.template === 'string' ? m.template : 'template.html';
  if (kind === 'vue') {
    // 页面模板必须有模板文件
    if (!files[template]) throw new ManifestError(`缺少模板文件：${template}`);
  } else {
    // 图表模板没有 Vue 模板，但必须有渲染脚本 render.js
    if (!files[RENDER_SCRIPT]) throw new ManifestError(`chart 模板缺少渲染脚本：${RENDER_SCRIPT}`);
  }

  const fonts = parseFonts(m.fonts, files);
  const charts = parseCharts(m.charts);

  return {
    schema: 1,
    width,
    height,
    format: format as Manifest['format'],
    dpr,
    template,
    fonts,
    charts,
    ...m,
    kind,
  };
}

function toPositiveInt(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0 || v > 10000) {
    throw new ManifestError(`${name} 必须是 1~10000 之间的整数（当前 ${JSON.stringify(v)}）`);
  }
  return v;
}

/** chart 模板宽度：0 表示自适应（按 SVG 固有尺寸），否则 1~10000 */
function toAutoInt(v: unknown, name: string): number {
  if (v === undefined || v === 0) return 0;
  return toPositiveInt(v, name);
}

/** 高度：缺省或 0 = auto（由内容决定），否则 1~10000 */
function parseHeight(v: unknown): number {
  if (v === undefined) return 0;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10000) return v;
  throw new ManifestError(`manifest.height 必须是 0（auto）或 1~10000 之间的整数（当前 ${JSON.stringify(v)}）`);
}

function toPositiveNumber(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    throw new ManifestError(`${name} 必须是正数（当前 ${JSON.stringify(v)}）`);
  }
  return v;
}

function parseFonts(raw: unknown, files: Record<string, string>): Manifest['fonts'] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new ManifestError('manifest.fonts 必须是数组');
  return raw.map((f, i) => {
    if (f === null || typeof f !== 'object') throw new ManifestError(`manifest.fonts[${i}] 必须是对象`);
    const o = f as Record<string, unknown>;
    if (typeof o.family !== 'string' || !o.family) {
      throw new ManifestError(`manifest.fonts[${i}].family 必填`);
    }
    const weight = o.weight === undefined ? 400 : toPositiveNumber(o.weight, `manifest.fonts[${i}].weight`);
    const style = (o.style ?? 'normal') as string;
    if (style !== 'normal' && style !== 'italic') {
      throw new ManifestError(`manifest.fonts[${i}].style 只支持 normal|italic`);
    }
    const path = typeof o.path === 'string' ? o.path : undefined;
    const data = typeof o.data === 'string' ? o.data : undefined;
    if (!path && !data) throw new ManifestError(`manifest.fonts[${i}] 需要 path 或 data 之一`);
    if (path && !files[path]) throw new ManifestError(`manifest.fonts[${i}] 引用的字体文件不存在：${path}`);
    return { family: o.family, path, data, weight, style: style as 'normal' | 'italic' };
  });
}

function parseCharts(raw: unknown): Manifest['charts'] {
  if (raw === undefined) return {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ManifestError('manifest.charts 必须是对象');
  }
  const out: NonNullable<Manifest['charts']> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === null || typeof v !== 'object') {
      throw new ManifestError(`manifest.charts.${k} 必须是对象`);
    }
    const o = v as Record<string, unknown>;
    out[k] = {
      width: o.width === undefined ? undefined : toPositiveNumber(o.width, `manifest.charts.${k}.width`),
      height: o.height === undefined ? undefined : toPositiveNumber(o.height, `manifest.charts.${k}.height`),
    };
  }
  return out;
}
