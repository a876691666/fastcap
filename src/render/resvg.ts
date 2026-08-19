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
  const resvg = new Resvg(ensureSvgXmlns(svg), {
    font: { loadSystemFonts: true, fontFiles: opts.fontFiles },
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

/** 读取 SVG 固有尺寸（root 的 width/height），用于 auto-height 时确定图表槽位尺寸 */
export function svgIntrinsicSize(svg: string): { width: number; height: number } {
  const r = new Resvg(ensureSvgXmlns(svg), {});
  if (r.width > 0 && r.height > 0) return { width: r.width, height: r.height };
  const img = r.render();
  return { width: img.width, height: img.height };
}
