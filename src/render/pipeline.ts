import { join, basename } from 'node:path';
import satori from 'satori';
import type { Font } from 'satori';
import { runChartScript } from './execute';
import { defaultFontPaths, loadFonts, localFontFiles, parseFontFile, type LoadedFont } from './fonts';
import { extractChartRefs, extractChartSlots, parseTemplate, renderPreviewHtml, rootToSatori, type ChartInjection } from './html';
import { loadPackage } from './pkg';
import { RENDER_SCRIPT } from './manifest';
import { chartSvgToDataUri, svgIntrinsicSize, svgToPng } from './resvg';
import { inlineUnocssStyles } from './unocss';
import { vueTemplateToHtml } from './vue';
import type { Manifest, RenderRequest } from './types';

/** <Chart> 组件解析结果 */
export interface ChartInjectionResult {
  dataUri: string;
  width: number;
  height: number;
}

/** vue 模板中 <Chart id> 组件的解析器（由模板路由注入：加载 chart 模板并渲染成图片） */
export type ChartResolver = (
  chartId: string,
  data: unknown,
  size?: { width?: number; height?: number },
) => Promise<ChartInjectionResult>;

export interface RenderEnv {
  workdirBase: string;
  timeoutMs: number;
  /** 解析 vue 模板中 <Chart id> 组件（缺省时若模板用了 <Chart> 会报错） */
  resolveChart?: ChartResolver;
}

export interface RenderResult {
  buffer: Buffer;
  contentType: string;
  /** 仅当 captureStages=true 时存在：管线中间产物，供编辑器调试预览 */
  stages?: RenderStages;
}

/** 管线中间产物：HTML 阶段（Vue SSR + unocss 后、送入 Satori 前）与 SVG 阶段（Satori 输出 + 截断结果） */
export interface RenderStages {
  /** 送入 Satori 的最终 HTML 字符串 */
  html: string;
  /** Satori 原始输出的 SVG（auto-height 时为高画布，未截断） */
  svg: string;
  /** 截断（auto-height crop）后、真正用于输出的 SVG */
  finalSvg: string;
  /** 是否 auto-height（manifest.height === 0） */
  autoHeight: boolean;
  /** 内容实际底部像素（auto-height 时用于截断） */
  contentBottom: number;
  /** 最终宽度 */
  width: number;
  /** 最终高度（auto-height 时为内容高度） */
  height: number;
  /** 渲染实际使用的字体（供 HTML 阶段预览 @font-face 注入，保证字体一致） */
  fonts: StageFont[];
}

/** HTML 阶段预览用的字体描述 */
export interface StageFont {
  family: string;
  weight: number;
  style: string;
  /** 字体文件 URL（本地字体走 /api/font-files/<file>；否则为 data URI） */
  url: string;
}

export interface RenderOptions {
  /** 采集管线中间产物（HTML / SVG），用于调试预览 */
  captureStages?: boolean;
}

/** 主渲染管线：代码包 -> 图片 */
export async function renderPackage(
  req: RenderRequest,
  env: RenderEnv,
  opts: RenderOptions = {},
): Promise<RenderResult> {
  const pkg = await loadPackage(req.files, env.workdirBase);
  try {
    const manifest = applyOverrides(pkg.manifest, req.options);

    // 1) 执行 d3 图表脚本（固定 render.js，独立子进程）；vue 模板可无 render.js（图表已分离为 chart 模板）
    const entrySrc = req.files[RENDER_SCRIPT];
    const hasEntry = !!entrySrc && entrySrc.trim().length > 0;
    const charts = hasEntry
      ? await runChartScript({
          entryPath: join(pkg.root, RENDER_SCRIPT),
          data: req.data,
          manifest,
          timeoutMs: env.timeoutMs,
        })
      : {};

    // 2) 解析模板：.vue 模板先用 Vue SSR 渲染成 HTML（外部 data 绑定），再走 Satori
    const templateRaw = await Bun.file(join(pkg.root, manifest.template!)).text();
    const templateSsr = manifest.template!.endsWith('.vue')
      ? await vueTemplateToHtml(templateRaw, req.data ?? {})
      : templateRaw;
    // 2.5) unocss className → 内联 style（与原有 style 合并，unocss 低优先级）
    const templateHtml = await inlineUnocssStyles(templateSsr);
    const root = parseTemplate(templateHtml);
    const slots = extractChartSlots(root);
    const refs = extractChartRefs(root);
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

    // <Chart id> 组件：加载对应 chart 模板渲染成图片注入
    for (const ref of refs) {
      if (!env.resolveChart) {
        throw new Error(
          `模板使用了 <Chart id="${ref.id}"> 组件，但当前渲染环境未提供图表解析器（generic /render 不支持）`,
        );
      }
      const inj = await env.resolveChart(ref.id, ref.data, { width: ref.width, height: ref.height });
      injections[ref.key] = { dataUri: inj.dataUri, width: inj.width, height: inj.height };
    }

    // 加载 Satori 字体（同时用于 HTML 阶段预览，保证预览字体与最终图片一致）
    const fonts = await loadFonts(manifest, pkg.root);
    const fontFamilies = [...new Set(fonts.map((f) => f.name))];
    const stageFonts = opts.captureStages ? await describeStageFonts(fonts) : [];

    // 3) HTML -> Satori 元素；并生成 HTML 阶段预览（替换图表图片 + 归一 font-family）
    const elements = rootToSatori(root, injections);
    const previewHtml = opts.captureStages ? renderPreviewHtml(root, injections, fontFamilies) : '';

    // 4) Satori -> SVG（height=0 时自动按内容高度裁切）
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
    const finalHeight = autoHeight ? Math.max(1, Math.ceil(contentBottom)) : manifest.height;
    const stages: RenderStages | undefined = opts.captureStages
      ? {
          html: previewHtml,
          svg,
          finalSvg,
          autoHeight,
          contentBottom,
          width: manifest.width,
          height: finalHeight,
          fonts: stageFonts,
        }
      : undefined;
    if (manifest.format === 'svg') {
      return { buffer: Buffer.from(finalSvg), contentType: 'image/svg+xml; charset=utf-8', stages };
    }
    const png = svgToPng(finalSvg, { fontFiles });
    return { buffer: png, contentType: 'image/png', stages };
  } finally {
    await pkg.cleanup();
  }
}

/** HTML 阶段预览的字体描述：本地字体目录内的给 URL，其余（manifest 内联字体）走 data URI */
async function describeStageFonts(fonts: LoadedFont[]): Promise<StageFont[]> {
  const locals = localFontFiles();
  return fonts.map((f) => {
    const match = locals.find((p) => {
      const m = parseFontFile(p);
      return m.family === f.name && m.weight === f.weight && m.style === f.style;
    });
    const url = match
      ? `/api/font-files/${encodeURIComponent(basename(match))}`
      : `data:font/otf;base64,${Buffer.from(f.data).toString('base64')}`;
    return { family: f.name, weight: f.weight, style: f.style, url };
  });
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
