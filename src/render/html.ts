/**
 * HTML 模板 -> Satori 元素树的转换器。
 *
 * 分层说明（专业度边界）：
 * - HTML 解析：依赖成熟库 node-html-parser（非手写）。
 * - CSS 解析/简写展开：依赖生态标准库 css-to-react-native（getStylesForProperty）。
 * - 本文件只负责：元素树 -> Satori 元素树映射、data-chart 占位符替换、文本空白归一化、
 *   以及把内联 style 字符串安全地切分后交给 css-to-react-native。
 */
import { getStylesForProperty } from 'css-to-react-native';
import { parse, type HTMLElement, type Node as HtmlNode } from 'node-html-parser';

export interface SatoriElement {
  type: string;
  props: Record<string, unknown>;
}

export interface ChartInjection {
  dataUri: string;
  width: number;
  height: number;
}

export interface ChartSlot {
  name: string;
  width?: number;
  height?: number;
}

/** <Chart> 组件占位：引用外部 chart 模板 */
export interface ChartRef {
  /** 唯一键（用于把解析结果映射回该占位元素） */
  key: string;
  /** chart 模板 ID */
  id: string;
  /** 传入图表的数据（缺省用 chart 模板自身 data.json） */
  data: unknown;
  /** 可选尺寸覆盖（px） */
  width?: number;
  height?: number;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** 行内元素（决定空白是否保留） */
const INLINE_TAGS = new Set([
  'span', 'a', 'b', 'strong', 'i', 'em', 'code', 'small', 'mark', 'del', 'sub', 'sup', 'q', 's', 'u', 'time', 'abbr', 'img',
]);

/**
 * 这些属性 Satori 自己会解析字符串值（boxShadow 用 css-box-shadow，textShadow 用自身解析器），
 * 不能交给 css-to-react-native（它会把它们展开成 RN 的 shadow* 形式，与 Satori 期望不符）。
 */
const PASSTHROUGH_STYLE_KEYS = new Set(['boxShadow', 'textShadow']);

/** 解析模板，返回文档根节点 */
export function parseTemplate(htmlString: string): HtmlNode {
  return parse(htmlString);
}

/** 取出模板中的顶层元素（跳过 html/body 包裹与空白文本） */
export function topElements(root: HtmlNode): HTMLElement[] {
  const out: HTMLElement[] = [];
  const walk = (node: HtmlNode) => {
    for (const child of node.childNodes) {
      if (child.nodeType === ELEMENT_NODE) {
        const el = child as HTMLElement;
        const tag = el.tagName.toLowerCase();
        if (tag === 'html' || tag === 'body' || tag === 'head') {
          walk(el);
        } else {
          out.push(el);
        }
      }
    }
  };
  walk(root);
  return out;
}

/** 从模板中收集所有 data-chart 占位符及其像素尺寸 */
export function extractChartSlots(root: HtmlNode): ChartSlot[] {
  const slots: ChartSlot[] = [];
  const seen = new Set<string>();
  const visit = (node: HtmlNode) => {
    for (const child of node.childNodes) {
      if (child.nodeType !== ELEMENT_NODE) continue;
      const el = child as HTMLElement;
      const name = el.getAttribute('data-chart');
      if (name) {
        if (seen.has(name)) throw new Error(`重复的图表槽位名：${name}`);
        seen.add(name);
        const style = parseStyle(el.getAttribute('style'));
        const width = parsePx(el.getAttribute('width')) ?? parsePx(style.width);
        const height = parsePx(el.getAttribute('height')) ?? parsePx(style.height);
        slots.push({ name, width, height });
      }
      visit(el);
    }
  };
  visit(root);
  return slots;
}

/** 从模板中收集所有 <Chart> 组件占位（data-chart-ref），并给元素打上唯一 data-chart-key */
export function extractChartRefs(root: HtmlNode): ChartRef[] {
  const refs: ChartRef[] = [];
  let i = 0;
  const visit = (node: HtmlNode) => {
    for (const child of node.childNodes) {
      if (child.nodeType !== ELEMENT_NODE) continue;
      const el = child as HTMLElement;
      const id = el.getAttribute('data-chart-ref');
      if (id) {
        const key = `ref:${i++}`;
        el.setAttribute('data-chart-key', key);
        let data: unknown;
        const raw = el.getAttribute('data-chart-data');
        if (raw) {
          try { data = JSON.parse(raw); } catch { data = undefined; }
        }
        refs.push({
          key,
          id,
          data,
          width: parsePx(el.getAttribute('data-chart-width')),
          height: parsePx(el.getAttribute('data-chart-height')),
        });
      }
      visit(el);
    }
  };
  visit(root);
  return refs;
}

/** 把解析树转换为 Satori 元素树，并把 data-chart 占位符替换成 <img> */
export function rootToSatori(root: HtmlNode, charts: Record<string, ChartInjection>): SatoriElement[] {
  return topElements(root).map((el) => convert(el, charts));
}

/**
 * 生成用于「HTML 阶段」预览的 HTML：
 * - 把图表占位（data-chart-key / data-chart）替换成真实 <img>（data URI）；
 * - 把 font-family 归一到渲染器实际加载的字体（模拟 Satori 的字体回退），
 *   使浏览器预览的字体与最终图片一致。
 * 注意：这是为预览准备的，Satori 渲染走 rootToSatori，二者互不影响。
 */
export function renderPreviewHtml(
  root: HtmlNode,
  charts: Record<string, ChartInjection>,
  fontFamilies: string[],
): string {
  rewriteFontFamilies(root, fontFamilies);
  injectChartImages(root, charts);
  return root.toString();
}

/** 把每个元素的 font-family 归一到已加载字体：保留命中的字体，全不命中则用加载字体栈 */
function rewriteFontFamilies(root: HtmlNode, fontFamilies: string[]): void {
  if (fontFamilies.length === 0) return;
  const known = new Set(fontFamilies.map((f) => f.toLowerCase()));
  const fallback = fontFamilies.map((f) => `'${f}'`).join(',');
  const visit = (node: HtmlNode) => {
    for (const child of node.childNodes) {
      if (child.nodeType !== ELEMENT_NODE) continue;
      const el = child as HTMLElement;
      const style = el.getAttribute('style');
      if (style && /font-family\s*:/i.test(style)) {
        const next = style.replace(/font-family\s*:\s*([^;]*)/gi, (_m, val: string) => {
          const families = String(val)
            .split(',')
            .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean);
          const hit = families.filter((f) => known.has(f.toLowerCase()));
          const chosen = hit.length > 0 ? hit.map((f) => `'${f}'`).join(',') : fallback;
          return `font-family:${chosen}`;
        });
        if (next !== style) el.setAttribute('style', next);
      }
      visit(el);
    }
  };
  visit(root);
}

/** 图表占位 -> 真实 <img>（去掉 style 上的 width/height，尺寸用注入值） */
function injectChartImages(root: HtmlNode, charts: Record<string, ChartInjection>): void {
  const visit = (node: HtmlNode) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType !== ELEMENT_NODE) continue;
      const el = child as HTMLElement;
      const key = el.getAttribute('data-chart-key') ?? el.getAttribute('data-chart') ?? '';
      const inj = key ? charts[key] : undefined;
      if (inj) {
        const style = stripSizeDecls(el.getAttribute('style'));
        const styleAttr = style ? ` style="${style}"` : '';
        el.replaceWith(
          `<img src="${inj.dataUri}" width="${inj.width}" height="${inj.height}"${styleAttr}>`,
        );
      } else {
        visit(el);
      }
    }
  };
  visit(root);
}

/** 去掉 style 里的 width/height 声明（图表图片尺寸由注入的 width/height 决定） */
function stripSizeDecls(style: string | null | undefined): string {
  if (!style) return '';
  return style
    .split(';')
    .map((s) => s.trim())
    .filter((d) => d && !/^(width|height)\s*:/i.test(d))
    .join(';');
}

function convert(el: HTMLElement, charts: Record<string, ChartInjection>): SatoriElement {
  const tag = el.tagName.toLowerCase();

  // <Chart> 组件占位 -> <img>（由外部 chart 模板解析注入）
  const refKey = el.getAttribute('data-chart-key');
  if (refKey) {
    const inj = charts[refKey];
    if (!inj) throw new Error(`未找到图表组件占位 ${refKey}（data-chart-ref）的渲染结果`);
    const style = parseStyle(el.getAttribute('style'));
    delete style.width;
    delete style.height;
    return {
      type: 'img',
      props: {
        src: inj.dataUri,
        width: inj.width,
        height: inj.height,
        ...(Object.keys(style).length > 0 ? { style } : {}),
      },
    };
  }

  // 图表占位符 -> <img>（保留占位符自身样式，width/height 由注入值决定）
  const chartName = el.getAttribute('data-chart');
  if (chartName) {
    const inj = charts[chartName];
    if (!inj) throw new Error(`未找到图表 ${chartName} 的渲染结果（render.js 需返回同名键）`);
    const style = parseStyle(el.getAttribute('style'));
    delete style.width;
    delete style.height;
    return {
      type: 'img',
      props: {
        src: inj.dataUri,
        width: inj.width,
        height: inj.height,
        ...(Object.keys(style).length > 0 ? { style } : {}),
      },
    };
  }

  const props: Record<string, unknown> = {};

  const style = parseStyle(el.getAttribute('style'));
  if (Object.keys(style).length > 0) props.style = style;

  if (tag === 'img') {
    const src = el.getAttribute('src');
    if (src) props.src = src;
    const w = parsePx(el.getAttribute('width')) ?? parsePx(style.width);
    const h = parsePx(el.getAttribute('height')) ?? parsePx(style.height);
    if (w) props.width = w;
    if (h) props.height = h;
  }

  const rawChildren: (SatoriElement | string)[] = [];
  for (const child of el.childNodes) {
    if (child.nodeType === TEXT_NODE) {
      const text = (child as { text?: string }).text ?? '';
      if (text) rawChildren.push(text);
    } else if (child.nodeType === ELEMENT_NODE) {
      rawChildren.push(convert(child as HTMLElement, charts));
    }
  }
  const children = normalizeChildren(rawChildren);
  if (children.length === 1) {
    props.children = children[0];
  } else if (children.length > 1) {
    props.children = children;
  }

  // Satori 约束：含元素子节点（非纯文本）的 <div> 必须显式 display（flex/contents/none），
  // 否则直接报错。自动补 `display:flex`（与 Satori 内部默认行为一致），
  // 避免 Vue/unocss 所见即所得场景里模板作者被晦涩报错卡住。
  const styleObj = props.style as Record<string, unknown> | undefined;
  if (
    tag === 'div' &&
    props.children !== undefined &&
    typeof props.children !== 'string' &&
    !(styleObj && styleObj.display)
  ) {
    props.style = { ...(props.style as Record<string, unknown>), display: 'flex' };
  }

  return { type: tag, props };
}

/**
 * 文本空白归一化：与 HTML 语义一致——
 * - 折叠连续空白为单个空格；
 * - 纯空白文本仅当位于两个「行内内容」之间时才保留为单个空格（如 `A <b>B</b>`）；
 * - 元素之间/边缘的纯空白（模板换行缩进）丢弃。
 */
function normalizeChildren(raw: (SatoriElement | string)[]): (SatoriElement | string)[] {
  const items = raw.map((x) => (typeof x === 'string' ? x.replace(/\s+/g, ' ') : x));
  const out: (SatoriElement | string)[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (typeof item === 'string' && item.trim() === '') {
      const prev = out[out.length - 1];
      const next = items[i + 1];
      if (isInlineContent(prev) && isInlineContent(next)) out.push(' ');
      continue;
    }
    out.push(item);
  }
  return out;
}

function isInlineContent(x: SatoriElement | string | undefined): boolean {
  if (x === undefined) return false;
  if (typeof x === 'string') return true;
  return INLINE_TAGS.has(x.type);
}

/**
 * 解析内联 style 字符串为 Satori 可用的 camelCase 样式对象。
 * - 声明切分尊重括号与引号（避免 url(data:...)、base64 中的 `;`/`:` 被误切）。
 * - 每个声明交给 css-to-react-native 展开简写（margin/padding/border/flex/font 等）。
 */
export function parseStyle(style: string | null | undefined): Record<string, unknown> {
  if (!style) return {};
  const out: Record<string, unknown> = {};
  for (const decl of splitTopLevel(style, ';')) {
    const [prop, val] = splitPropValue(decl);
    if (!prop || val === '') continue;
    const key = camelize(prop);
    if (PASSTHROUGH_STYLE_KEYS.has(key)) {
      out[key] = val;
      continue;
    }
    try {
      Object.assign(out, getStylesForProperty(key, val));
    } catch {
      // css-to-react-native 无法解析的值（如 background 简写带渐变），原样透传给 Satori
      out[key] = val;
    }
  }
  return out;
}

/** 按分隔符切分字符串，但忽略括号与引号内的分隔符 */
function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      cur += ch;
      if (ch === quote && s[i - 1] !== '\\') quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === '(') {
      depth++;
      cur += ch;
    } else if (ch === ')') {
      if (depth > 0) depth--;
      cur += ch;
    } else if (ch === sep && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/** 在顶层（括号/引号外）按第一个 `:` 切分出属性名与值 */
function splitPropValue(decl: string): [string, string] {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < decl.length; i++) {
    const ch = decl[i];
    if (quote) {
      if (ch === quote && decl[i - 1] !== '\\') quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      if (depth > 0) depth--;
    } else if (ch === ':' && depth === 0) {
      return [decl.slice(0, i).trim(), decl.slice(i + 1).trim()];
    }
  }
  return [decl.trim(), ''];
}

function camelize(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function parsePx(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : undefined;
  if (typeof v !== 'string' || !v) return undefined;
  const t = v.trim();
  const px = t.match(/^([0-9.]+)px$/i);
  if (px) return toPos(px[1]);
  if (/^[0-9.]+$/.test(t)) return toPos(t);
  return undefined;
}

function toPos(s: string): number | undefined {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
