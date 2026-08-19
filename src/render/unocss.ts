/**
 * UnoCSS 内联：把模板 HTML 里的 unocss className（如 `flex px-4 text-red-500`）
 * 转成元素的内联 style，并与元素原有硬编码 style **合并**——unocss 低优先级（原有 style 覆盖）。
 *
 * 为什么需要这一步：Satori 不支持外部样式表/类选择器，只认内联 style。
 * 所以模板里写 unocss 工具类，服务端渲染前先展开成内联样式。
 */
import { createGenerator } from '@unocss/core';
import { presetWind } from '@unocss/preset-wind';
import { parse, type HTMLElement, type Node as HtmlNode } from 'node-html-parser';

let generatorPromise: ReturnType<typeof createGenerator> | null = null;
function getGenerator(): ReturnType<typeof createGenerator> {
  if (!generatorPromise) generatorPromise = createGenerator({ presets: [presetWind()] });
  return generatorPromise;
}

const ELEMENT_NODE = 1;

/** 把 HTML 中的 unocss className 展开为内联 style（无 class 时原样返回） */
export async function inlineUnocssStyles(html: string): Promise<string> {
  const root = parse(html);

  const classSet = new Set<string>();
  collectClasses(root, classSet);
  if (classSet.size === 0) return html;

  const gen = await getGenerator();
  const { css } = await gen.generate([...classSet]);
  const styleMap = parseUnocssCss(css);

  applyStyles(root, styleMap);
  return root.toString();
}

function collectClasses(root: HtmlNode, out: Set<string>) {
  const walk = (node: HtmlNode) => {
    for (const child of node.childNodes) {
      if (child.nodeType !== ELEMENT_NODE) continue;
      const el = child as HTMLElement;
      const cls = el.getAttribute('class');
      if (cls) for (const c of cls.split(/\s+/)) if (c) out.add(c);
      walk(el);
    }
  };
  walk(root);
}

/** 解析 unocss 生成的 CSS（形如 `.flex{display:flex}.px-4{padding-left:1rem;...}`）→ className -> 声明 */
function parseUnocssCss(css: string): Map<string, Record<string, string>> {
  const map = new Map<string, Record<string, string>>();
  const ruleRe = /\.([^{}]+)\{([^}]*)\}/g;
  for (const m of css.matchAll(ruleRe)) {
    const selector = m[1].trim();
    // 跳过变体/伪类（:hover、md: 等，静态渲染不需要）
    if (selector.includes(':')) continue;
    const cls = selector.replace(/\\/g, ''); // 反转义（w-1\/2 -> w-1/2）
    const raw: Record<string, string> = {};
    for (const d of m[2].split(';')) {
      const idx = d.indexOf(':');
      if (idx < 0) continue;
      raw[d.slice(0, idx).trim()] = d.slice(idx + 1).trim();
    }
    // 解析 var(--un-*)：用本规则的 --un-* 声明替换值里的 var()，然后丢弃 --un-* 键（Satori 不需要）
    const decls: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (k.startsWith('--')) continue;
      decls[camelize(k)] = v.replace(/var\((--[\w-]+)\)/g, (_m, name) => raw[name] ?? '1');
    }
    map.set(cls, decls);
  }
  return map;
}

/** 把每个元素的 unocss 声明合并进 style（unocss 先、原有 style 后 → 原有 style 优先） */
function applyStyles(root: HtmlNode, styleMap: Map<string, Record<string, string>>) {
  const walk = (node: HtmlNode) => {
    for (const child of node.childNodes) {
      if (child.nodeType !== ELEMENT_NODE) continue;
      const el = child as HTMLElement;
      const cls = el.getAttribute('class');
      if (cls) {
        const merged: Record<string, string> = {};
        for (const c of cls.split(/\s+/)) {
          const d = styleMap.get(c);
          if (d) Object.assign(merged, d);
        }
        if (Object.keys(merged).length > 0) {
          // 原有硬编码 style 覆盖 unocss（低优先级）；用原始解析保留单位（如 600px）
          Object.assign(merged, parseRawInlineStyle(el.getAttribute('style')));
          el.setAttribute('style', serializeStyle(merged));
        }
      }
      walk(el);
    }
  };
  walk(root);
}

/** 原始内联 style 解析：保留值原样（不经过 css-to-react-native 的数值化），尊重括号/引号 */
function parseRawInlineStyle(style: string | null | undefined): Record<string, string> {
  if (!style) return {};
  const out: Record<string, string> = {};
  for (const decl of splitTopLevel(style, ';')) {
    const idx = decl.indexOf(':');
    if (idx < 0) continue;
    const prop = decl.slice(0, idx).trim();
    const val = decl.slice(idx + 1).trim();
    if (!prop || !val) continue;
    out[camelize(prop)] = val;
  }
  return out;
}

/** 按分隔符切分，但忽略括号与引号内的分隔符 */
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

function serializeStyle(style: Record<string, unknown>): string {
  return Object.entries(style)
    .map(([k, v]) => `${kebabize(k)}:${v}`)
    .join(';');
}

function camelize(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function kebabize(s: string): string {
  return s.replace(/[A-Z]/g, (c: string) => `-${c.toLowerCase()}`);
}
