import { join } from 'node:path';
import satori from 'satori';
import type { Font } from 'satori';
import { runChartScript } from './execute';
import { defaultFontPaths, loadFonts } from './fonts';
import { extractChartSlots, parseTemplate, rootToSatori, type ChartInjection } from './html';
import { loadPackage } from './pkg';
import { chartSvgToDataUri, svgIntrinsicSize, svgToPng } from './resvg';
import { inlineUnocssStyles } from './unocss';
import { vueTemplateToHtml } from './vue';
import type { Manifest, RenderRequest } from './types';

export interface RenderEnv {
  workdirBase: string;
  timeoutMs: number;
}

export interface RenderResult {
  buffer: Buffer;
  contentType: string;
}

/** 主渲染管线：代码包 -> 图片 */
export async function renderPackage(req: RenderRequest, env: RenderEnv): Promise<RenderResult> {
  const pkg = await loadPackage(req.files, env.workdirBase);
  try {
    const manifest = applyOverrides(pkg.manifest, req.options);

    // 1) 执行 d3 图表脚本（独立子进程）
    const charts = await runChartScript({
      entryPath: join(pkg.root, manifest.entry!),
      data: req.data,
      manifest,
      timeoutMs: env.timeoutMs,
    });

    // 2) 解析模板：.vue 模板先用 Vue SSR 渲染成 HTML（外部 data 绑定），再走 Satori
    const templateRaw = await Bun.file(join(pkg.root, manifest.template!)).text();
    const templateSsr = manifest.template!.endsWith('.vue')
      ? await vueTemplateToHtml(templateRaw, req.data ?? {})
      : templateRaw;
    // 2.5) unocss className → 内联 style（与原有 style 合并，unocss 低优先级）
    const templateHtml = await inlineUnocssStyles(templateSsr);
    const root = parseTemplate(templateHtml);
    const slots = extractChartSlots(root);
    const dpr = manifest.dpr ?? 2;
    // resvg 需要的字体文件：manifest.fonts[].path 直接引用；.data(base64) 落盘到包内临时文件
    const fontFiles = await resolveResvgFontFiles(manifest, pkg.root);
    // 叠加默认字体目录/系统字体（Satori 与 resvg 同源，保证 d3 SVG 内 CJK 文字可渲染）
    fontFiles.push(...(await defaultFontPaths()));

    const injections: Record<string, ChartInjection> = {};
    for (const slot of slots) {
      const override = manifest.charts?.[slot.name];
      const svg = charts[slot.name];
      if (!svg) {
        throw new Error(
          `模板声明了图表槽位 "${slot.name}"，但 render.js 未返回同名键（返回了：${Object.keys(charts).join(', ') || '无'}）`,
        );
      }
      // 尺寸优先级：manifest.charts 显式值 > 模板占位符 style > chart SVG 固有尺寸
      const intrinsic = svgIntrinsicSize(svg);
      const w = override?.width ?? slot.width ?? intrinsic.width;
      const h = override?.height ?? slot.height ?? intrinsic.height;
      injections[slot.name] = {
        dataUri: chartSvgToDataUri(svg, w, h, dpr, fontFiles),
        width: w,
        height: h,
      };
    }

    // 3) HTML -> Satori 元素
    const elements = rootToSatori(root, injections);

    // 4) Satori -> SVG（height=0 时自动按内容高度裁切）
    const fonts = await loadFonts(manifest, pkg.root);
    const rootNode = elements.length === 1 ? elements[0] : elements;
    const autoHeight = manifest.height === 0;
    let contentBottom = 0;
    const satoriOptions: Parameters<typeof satori>[1] = {
      width: manifest.width,
      height: autoHeight ? 20000 : manifest.height,
      fonts: fonts as unknown as Font[],
    };
    if (autoHeight) {
      satoriOptions.onNodeDetected = (n) => {
        contentBottom = Math.max(contentBottom, n.top + n.height);
      };
    }
    const svg = await satori(rootNode as never, satoriOptions);
    const finalSvg = autoHeight ? cropSvgHeight(svg, Math.max(1, Math.ceil(contentBottom))) : svg;

    // 5) 输出
    if (manifest.format === 'svg') {
      return { buffer: Buffer.from(finalSvg), contentType: 'image/svg+xml; charset=utf-8' };
    }
    const png = svgToPng(finalSvg, { fontFiles });
    return { buffer: png, contentType: 'image/png' };
  } finally {
    await pkg.cleanup();
  }
}

function applyOverrides(manifest: Manifest, options?: RenderRequest['options']): Manifest {
  return {
    ...manifest,
    ...(options?.width ? { width: options.width } : {}),
    ...(options?.height ? { height: options.height } : {}),
    ...(options?.format ? { format: options.format } : {}),
    ...(options?.dpr ? { dpr: options.dpr } : {}),
  };
}

/** 收集 resvg 渲染 d3 SVG 文字所需的字体文件路径；data(base64) 字体落盘到包目录 */
async function resolveResvgFontFiles(manifest: Manifest, pkgRoot: string): Promise<string[]> {
  const out: string[] = [];
  for (const f of manifest.fonts ?? []) {
    if (f.path) {
      out.push(join(pkgRoot, f.path));
    } else if (f.data) {
      const bytes = Buffer.from(f.data, 'base64');
      const p = join(pkgRoot, `__font_${out.length}.ttf`);
      await Bun.write(p, bytes);
      out.push(p);
    }
  }
  return out;
}

/** auto-height：把 Satori 大画布 SVG 的高度/viewBox 裁到内容实际高度 */
function cropSvgHeight(svg: string, h: number): string {
  return svg
    .replace(/height="[\d.]+"/, `height="${h}"`)
    .replace(/viewBox="0 0 ([\d.]+) ([\d.]+)"/, (_m, w: string) => `viewBox="0 0 ${w} ${h}"`);
}
