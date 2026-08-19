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

/** 把解析树转换为 Satori 元素树，并把 data-chart 占位符替换成 <img> */
export function rootToSatori(root: HtmlNode, charts: Record<string, ChartInjection>): SatoriElement[] {
  return topElements(root).map((el) => convert(el, charts));
}

function convert(el: HTMLElement, charts: Record<string, ChartInjection>): SatoriElement {
  const tag = el.tagName.toLowerCase();

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
