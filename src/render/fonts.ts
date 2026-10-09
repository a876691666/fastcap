import { basename, join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import type { Manifest } from './types';

export interface LoadedFont {
  name: string;
  data: ArrayBuffer;
  weight: number;
  style: 'normal' | 'italic';
}

/** 按文件路径缓存已读取的字体二进制，避免每请求重复读盘 */
const fontCache = new Map<string, ArrayBuffer>();
/** 按 base64 内容缓存 data 字体（同一字体重用同一 ArrayBuffer，Satori 内部 WeakMap 才能命中） */
const fontDataCache = new Map<string, ArrayBuffer>();

/**
 * 本地字体目录：RENDER_FONTS_DIR 优先，否则用项目内 `fonts/`（随仓库分发，本地化调用）。
 * 服务只使用该目录内的字体，不扫描系统字体。
 */
export function fontsDir(): string {
  return process.env.RENDER_FONTS_DIR ?? join(import.meta.dir, '..', '..', 'fonts');
}

const FONT_EXT = /\.(ttf|otf|ttc)$/i;

/** 文件名核心 -> 语义化 family（与模板 font-family 对齐） */
const FAMILY_ALIASES: Record<string, string> = {
  NotoSansSC: 'Noto Sans SC',
  NotoSansCJKsc: 'Noto Sans SC',
  NotoSans: 'Noto Sans',
  NotoSerifSC: 'Noto Serif SC',
  NotoSansMono: 'Noto Sans Mono',
  DejaVuSans: 'DejaVu Sans',
  DejaVuSansMono: 'DejaVu Sans Mono',
};

const WEIGHT_TOKENS: Array<[RegExp, number]> = [
  [/thin/i, 100],
  [/(extralight|ultralight)/i, 200],
  [/(semilight|demilight)/i, 350],
  [/light/i, 300],
  [/medium/i, 500],
  [/(semibold|demibold)/i, 600],
  [/(extrabold|ultrabold)/i, 800],
  [/(black|heavy)/i, 900],
  [/bold/i, 700],
  [/(regular|normal|book)/i, 400],
];

/** 从字体文件名推断 family / weight / style */
export function parseFontFile(file: string): { family: string; weight: number; style: 'normal' | 'italic' } {
  const base = basename(file).replace(FONT_EXT, '');
  const style: 'normal' | 'italic' = /italic|oblique/i.test(base) ? 'italic' : 'normal';
  let weight = 400;
  for (const [re, w] of WEIGHT_TOKENS) {
    if (re.test(base)) { weight = w; break; }
  }
  const core = base
    .replace(/[-_\s]?(thin|extralight|ultralight|semilight|demilight|light|medium|semibold|demibold|extrabold|ultrabold|black|heavy|bold|regular|normal|book|italic|oblique)/gi, '')
    .replace(/[-_\s]+$/, '');
  const family = FAMILY_ALIASES[core] ?? FAMILY_ALIASES[core.replace(/[-_]/g, '')] ?? core;
  return { family, weight, style };
}

/** 本地字体目录内的字体文件绝对路径 */
export function localFontFiles(): string[] {
  const dir = fontsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => FONT_EXT.test(f)).map((f) => join(dir, f));
}

/**
 * 加载 Satori 渲染所需的字体。
 * 优先使用 manifest.fonts；否则加载本地字体目录（`fonts/` 或 RENDER_FONTS_DIR）。
 */
export async function loadFonts(manifest: Manifest, packageRoot: string): Promise<LoadedFont[]> {
  const fonts = manifest.fonts;
  if (fonts && fonts.length > 0) {
    return Promise.all(
      fonts.map(async (f): Promise<LoadedFont> => {
        let data: ArrayBuffer;
        if (f.data) {
          data = base64ToArrayBuffer(f.data);
        } else if (f.path) {
          data = await readFontFile(join(packageRoot, f.path));
        } else {
          throw new Error(`字体 ${f.family} 缺少 path 或 data`);
        }
        return { name: f.family, data, weight: f.weight ?? 400, style: f.style ?? 'normal' };
      }),
    );
  }
  return loadDefaultFonts();
}

async function loadDefaultFonts(): Promise<LoadedFont[]> {
  const files = localFontFiles();
  if (files.length === 0) {
    throw new Error(
      `未找到本地字体：请运行 \`bun run fetch-fonts\` 下载标准字体，` +
        `或把字体放入 ${fontsDir()}（也可用 RENDER_FONTS_DIR 指定目录）`,
    );
  }
  const loaded: LoadedFont[] = [];
  for (const path of files) {
    const { family, weight, style } = parseFontFile(path);
    loaded.push({ name: family, data: await readFontFile(path), weight, style });
  }
  return loaded;
}

async function readFontFile(path: string): Promise<ArrayBuffer> {
  const cached = fontCache.get(path);
  if (cached) return cached;
  const data = await Bun.file(path).arrayBuffer();
  fontCache.set(path, data);
  return data;
}

/**
 * resvg 渲染 SVG 内文字所需的字体文件路径（与 Satori 同源，全部来自本地字体目录）。
 * 不与系统字体混用：resvg 侧始终 `loadSystemFonts:false`。
 */
export async function defaultFontPaths(): Promise<string[]> {
  return localFontFiles();
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const hit = fontDataCache.get(b64);
  if (hit) return hit;
  const buf = Buffer.from(b64, 'base64');
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  fontDataCache.set(b64, ab);
  return ab;
}
