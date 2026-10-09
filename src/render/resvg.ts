import { Resvg } from '@resvg/resvg-js';

export interface SvgToPngOptions {
  /** 额外字体文件路径（传给 resvg，用于图表内文字） */
  fontFiles?: string[];
  /** 输出宽度（缩放，保持宽高比），默认用 SVG 自身尺寸 */
  width?: number;
  /** 背景色，CSS 颜色字符串；默认透明 */
  background?: string;
}

/** SVG -> PNG Buffer */
export function svgToPng(svg: string, opts: SvgToPngOptions = {}): Buffer {
  // 只使用显式提供的字体文件，不扫描系统字体（系统字体扫描每次约 100ms，且不可控）
  const resvg = new Resvg(ensureSvgXmlns(svg), {
    font: { loadSystemFonts: false, fontFiles: opts.fontFiles },
    background: opts.background,
    ...(opts.width ? { fitTo: { mode: 'width' as const, value: Math.round(opts.width) } } : {}),
  });
  return resvg.render().asPng();
}

/** 把图表 SVG 光栅化为 PNG data URI（供 Satori 的 <img> 内嵌） */
export function chartSvgToDataUri(
  svg: string,
  width: number,
  height: number,
  dpr: number,
  fontFiles?: string[],
): string {
  const png = svgToPng(svg, { width: Math.round(width * dpr), fontFiles });
  return `data:image/png;base64,${png.toString('base64')}`;
}

/** 确保根 <svg> 带有 xmlns（linkedom 的 HTML 序列化会丢掉它） */
export function ensureSvgXmlns(svg: string): string {
  const t = svg.trim();
  if (/^<svg[\s>]/.test(t) && !/xmlns=/.test(t.slice(0, 300))) {
    return t.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return svg;
}

/** 读取 SVG 固有尺寸（root 的 width/height，缺省用 viewBox），用于 auto-height 时确定图表槽位尺寸 */
export function svgIntrinsicSize(svg: string): { width: number; height: number } {
  // 关键性能点：直接解析根 <svg> 属性，避免实例化 resvg（每次 ~100ms，且仅为读取尺寸）
  const end = svg.indexOf('>');
  const openTag = end >= 0 ? svg.slice(0, end + 1) : svg.slice(0, 1000);
  const width = pxAttr(openTag, 'width');
  const height = pxAttr(openTag, 'height');
  if (width > 0 && height > 0) return { width, height };

  const vb = openTag.match(/viewBox=["']\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)/i);
  if (vb) {
    const vw = Number(vb[1]);
    const vh = Number(vb[2]);
    if (vw > 0 && vh > 0) return { width: width || vw, height: height || vh };
  }

  // 兜底：交给 resvg 解析（关闭系统字体扫描）
  const r = new Resvg(ensureSvgXmlns(svg), { font: { loadSystemFonts: false } });
  if (r.width > 0 && r.height > 0) return { width: r.width, height: r.height };
  const img = r.render();
  return { width: img.width, height: img.height };
}

/** 读取开标签上的 px 长度属性（百分比/非数字返回 0） */
function pxAttr(openTag: string, name: string): number {
  const m = openTag.match(new RegExp(`[\\s]${name}=["']([^"']+)["']`, 'i'));
  if (!m) return 0;
  const v = m[1].trim();
  if (v.endsWith('%')) return 0;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
