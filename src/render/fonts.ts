import { join } from 'node:path';
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

const DEFAULT_FONT_CANDIDATES: Array<{ name: string; path: string; weight?: number }> = [
  { name: 'Arial', path: '/System/Library/Fonts/Supplemental/Arial.ttf' },
  { name: 'Arial Bold', path: '/System/Library/Fonts/Supplemental/Arial Bold.ttf', weight: 700 },
  { name: 'Arial Unicode MS', path: '/Library/Fonts/Arial Unicode.ttf' },
  { name: 'Arial Unicode MS', path: '/System/Library/Fonts/Supplemental/Arial Unicode.ttf' },
  { name: 'DejaVu Sans', path: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf' },
  { name: 'Arial', path: 'C:\\Windows\\Fonts\\arial.ttf' },
];

/**
 * 加载 Satori 渲染所需的字体。
 * 优先使用 manifest.fonts；否则从 RENDER_FONTS_DIR 或系统字体目录回退。
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
  const dir = process.env.RENDER_FONTS_DIR;
  if (dir) {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(dir);
    const files = entries.filter((f) => /\.(ttf|otf|woff)$/i.test(f));
    const loaded: LoadedFont[] = [];
    for (const file of files) {
      const data = await readFontFile(join(dir, file));
      loaded.push({ name: file.replace(/\.[^.]+$/, ''), data, weight: 400, style: 'normal' });
    }
    if (loaded.length > 0) return loaded;
  }

  const loaded: LoadedFont[] = [];
  for (const c of DEFAULT_FONT_CANDIDATES) {
    try {
      const data = await readFontFile(c.path);
      loaded.push({ name: c.name, data, weight: c.weight ?? 400, style: 'normal' });
    } catch {
      // 该路径不存在则跳过
    }
  }
  if (loaded.length === 0) {
    throw new Error(
      '未找到可用字体：请在 manifest.fonts 指定字体，或设置 RENDER_FONTS_DIR 指向字体目录',
    );
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
 * resvg 渲染 d3 SVG 内文字所需的字体文件路径：
 * 与 loadDefaultFonts 同源（RENDER_FONTS_DIR 或系统候选），保证 Satori 与 resvg 用同一套字体。
 */
export async function defaultFontPaths(): Promise<string[]> {
  const dir = process.env.RENDER_FONTS_DIR;
  if (dir) {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(dir);
    return entries.filter((f) => /\.(ttf|otf|woff)$/i.test(f)).map((f) => join(dir, f));
  }
  const { existsSync } = await import('node:fs');
  return DEFAULT_FONT_CANDIDATES.map((c) => c.path).filter((p) => existsSync(p));
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const hit = fontDataCache.get(b64);
  if (hit) return hit;
  const buf = Buffer.from(b64, 'base64');
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  fontDataCache.set(b64, ab);
  return ab;
}
