/**
 * 子进程入口：提供 linkedom 的 document 全局（供 d3.select 使用），
 * 动态 import 用户 render.js，调用其 default export，把图表 SVG 结果写回 JSON。
 * 用法：bun run-render.ts <input.json> <output.json>
 */
import { parseHTML } from 'linkedom';
import { pathToFileURL } from 'node:url';

const { document } = parseHTML('<!doctype html><html><body></body></html>');

(globalThis as Record<string, unknown>).document = document;
(globalThis as Record<string, unknown>).serializeSvg = (node: unknown): string => {
  const html = node && typeof (node as { outerHTML?: string }).outerHTML === 'string'
    ? (node as { outerHTML: string }).outerHTML
    : String(node);
  return ensureXmlns(html);
};

function ensureXmlns(svg: string): string {
  const t = svg.trim();
  if (/^<svg[\s>]/.test(t) && !/xmlns=/.test(t.slice(0, 300))) {
    return t.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return svg;
}

interface Input {
  modulePath: string;
  data: unknown;
  manifest: unknown;
}

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  const input = JSON.parse(await Bun.file(inputPath).text()) as Input;
  try {
    const mod = await import(pathToFileURL(input.modulePath).href);
    const render = (mod as { default?: unknown }).default;
    if (typeof render !== 'function') {
      throw new Error('render.js 必须 default export 一个函数');
    }
    const charts = await (render as (ctx: { data: unknown; manifest: unknown }) => unknown)({
      data: input.data,
      manifest: input.manifest,
    });
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
    await Bun.write(outputPath, JSON.stringify({ ok: true, charts: normalized }));
  } catch (e) {
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
    await Bun.write(outputPath, JSON.stringify({ ok: false, error: msg }));
    process.exit(1);
  }
}

main();
