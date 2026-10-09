#!/usr/bin/env bun
/**
 * 拉取标准字体到本地字体目录（本地化调用，服务不再扫描系统字体）。
 * 用法：bun scripts/fetch-fonts.ts [--force]
 *   - 默认目录：项目内 `fonts/`（可用 RENDER_FONTS_DIR 覆盖）
 *   - 已存在则跳过；--force 强制重新下载
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fontsDir } from '../src/render/fonts';

const FORCE = process.argv.includes('--force');

// 字体来源（Noto 官方仓库）
const BASE_CJK = 'https://raw.githubusercontent.com/googlefonts/noto-cjk/main/Sans/OTF/SimplifiedChinese';
const BASE_LATIN = 'https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts/NotoSans/hinted/ttf';

interface FontSource {
  file: string;
  urls: string[];
}

const FONTS: FontSource[] = [
  // CJK + 拉丁（Noto Sans SC，含简体中文；体积较大）
  { file: 'NotoSansSC-Regular.otf', urls: [`${BASE_CJK}/NotoSansCJKsc-Regular.otf`] },
  { file: 'NotoSansSC-Bold.otf', urls: [`${BASE_CJK}/NotoSansCJKsc-Bold.otf`] },
  // 纯拉丁（更小的常规西文字体）
  { file: 'NotoSans-Regular.ttf', urls: [`${BASE_LATIN}/NotoSans-Regular.ttf`] },
  { file: 'NotoSans-Bold.ttf', urls: [`${BASE_LATIN}/NotoSans-Bold.ttf`] },
];

const dir = fontsDir();
mkdirSync(dir, { recursive: true });
console.log(`字体目录：${dir}`);

let failed = 0;
for (const f of FONTS) {
  const dest = join(dir, f.file);
  if (existsSync(dest) && !FORCE) {
    console.log(`skip  ${f.file}（已存在）`);
    continue;
  }
  let ok = false;
  for (const url of f.urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.log(`  HTTP ${res.status}  ${url}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 4096) {
        console.log(`  内容过小，跳过  ${url}`);
        continue;
      }
      await Bun.write(dest, buf);
      console.log(`get   ${f.file}  (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
      ok = true;
      break;
    } catch (e) {
      console.log(`  失败  ${url}: ${(e as Error).message}`);
    }
  }
  if (!ok) {
    failed++;
    console.log(`FAIL  ${f.file}`);
  }
}

console.log(failed === 0 ? '完成 ✓' : `完成，但有 ${failed} 个字体下载失败`);
process.exit(failed === 0 ? 0 : 1);
