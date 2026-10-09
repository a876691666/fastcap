/**
 * chart 模板渲染：纯图表模板（manifest.json + render.js，无 Vue）。
 *
 * 流程与主管线一致的最后一步：render.js 在子进程产出 SVG → resvg 光栅化为 PNG。
 * 既用于 chart 模板「单独渲染」（输出图片），也用于 vue 模板中 <Chart> 组件的嵌入注入。
 */
import { join } from 'node:path';
import { runChartScript } from './execute';
import { defaultFontPaths } from './fonts';
import { loadPackage } from './pkg';
import { RENDER_SCRIPT } from './manifest';
import { ensureSvgXmlns, svgIntrinsicSize, svgToPng } from './resvg';
import type { RenderEnv } from './pipeline';
import type { Manifest } from './types';

export interface ChartImage {
  /** 供 Satori <img> 内嵌的 PNG data URI */
  dataUri: string;
  /** 图表原始 SVG 字符串 */
  svg: string;
  /** 输出尺寸（px） */
  width: number;
  height: number;
  /** 单独渲染时的字节产物（按 manifest.format：png/svg） */
  buffer: Buffer;
  contentType: string;
}

/** chart 模板 render.js 返回值中取主图：优先 main，其次唯一键 */
function pickSvg(charts: Record<string, string>): string {
  if (charts.main) return charts.main;
  const values = Object.values(charts);
  if (values.length === 1) return values[0];
  if (values.length === 0) throw new Error('chart 模板的 render.js 未返回任何图表');
  throw new Error(
    `chart 模板的 render.js 返回了多个图表（${Object.keys(charts).join('、')}），请用 main 指定主图`,
  );
}

/** 收集 resvg 渲染图表内文字所需字体文件路径（manifest.fonts + 默认字体） */
async function resolveFontFiles(manifest: Manifest, pkgRoot: string): Promise<string[]> {
  const out: string[] = [];
  for (const f of manifest.fonts ?? []) {
    if (f.path) out.push(join(pkgRoot, f.path));
    else if (f.data) {
      const p = join(pkgRoot, `__font_${out.length}.ttf`);
      await Bun.write(p, Buffer.from(f.data, 'base64'));
      out.push(p);
    }
  }
  out.push(...(await defaultFontPaths()));
  return out;
}

/**
 * 渲染一个 chart 模板为图片。
 * @param size 嵌入时由 <Chart :width/:height> 覆盖尺寸（优先级最高）
 */
export async function renderChartImage(
  files: Record<string, string>,
  data: unknown,
  env: RenderEnv,
  size?: { width?: number; height?: number },
): Promise<ChartImage> {
  const pkg = await loadPackage(files, env.workdirBase);
  try {
    const manifest = pkg.manifest;
    // 已确定的宽高（<Chart :width/:height> > manifest）先传给 render.js，便于按目标尺寸绘制
    const knownWidth = size?.width ?? manifest.width ?? 0;
    const knownHeight = size?.height ?? manifest.height ?? 0;
    const charts = await runChartScript({
      entryPath: join(pkg.root, RENDER_SCRIPT),
      data,
      manifest: { ...manifest, width: knownWidth, height: knownHeight },
      timeoutMs: env.timeoutMs,
    });
    const svg = ensureSvgXmlns(pickSvg(charts));
    const intrinsic = svgIntrinsicSize(svg);
    // 尺寸优先级：size（<Chart :width/:height>）> manifest > SVG 固有；只给一边时按宽高比推算
    let width = knownWidth;
    let height = knownHeight;
    if (width > 0 && height > 0) {
      // 显式宽高：按指定画布
    } else if (width > 0) {
      height = Math.round((width * intrinsic.height) / intrinsic.width);
    } else if (height > 0) {
      width = Math.round((height * intrinsic.width) / intrinsic.height);
    } else {
      width = intrinsic.width;
      height = intrinsic.height;
    }
    const dpr = manifest.dpr ?? 2;
    const fontFiles = await resolveFontFiles(manifest, pkg.root);
    const png = svgToPng(svg, { width: Math.round(width * dpr), fontFiles });
    const dataUri = `data:image/png;base64,${png.toString('base64')}`;
    if (manifest.format === 'svg') {
      return { dataUri, svg, width, height, buffer: Buffer.from(svg), contentType: 'image/svg+xml; charset=utf-8' };
    }
    return { dataUri, svg, width, height, buffer: png, contentType: 'image/png' };
  } finally {
    await pkg.cleanup();
  }
}
