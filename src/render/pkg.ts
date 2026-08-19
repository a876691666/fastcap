import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { ManifestError, parseManifest } from './manifest';
import type { Manifest } from './types';

export interface LoadedPackage {
  root: string;
  manifest: Manifest;
  files: Record<string, string>;
  cleanup: () => Promise<void>;
}

/**
 * 把代码包（文件名 -> 内容）落盘到独立工作目录，并解析 manifest。
 * 所有文件路径做沙箱化，禁止绝对路径与 `..` 越界。
 */
export async function loadPackage(
  files: Record<string, string>,
  base: string,
): Promise<LoadedPackage> {
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    throw new ManifestError('请求体需要 files 对象（文件名 -> 内容）');
  }
  if (typeof files['manifest.json'] !== 'string') {
    throw new ManifestError('代码包缺少 manifest.json');
  }

  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, 'pkg-'));

  try {
    for (const [p, content] of Object.entries(files)) {
      if (typeof content !== 'string') {
        throw new ManifestError(`文件 ${p} 的内容必须是 UTF-8 字符串`);
      }
      const dest = safeJoin(root, p);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, content, 'utf8');
    }
    const manifest = parseManifest(JSON.parse(files['manifest.json']), files);
    const cleanup = () => rm(root, { recursive: true, force: true });
    return { root, manifest, files, cleanup };
  } catch (e) {
    await rm(root, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}

export function safeJoin(root: string, p: string): string {
  if (isAbsolute(p)) throw new ManifestError(`文件路径不允许绝对路径：${p}`);
  const dest = resolve(root, p);
  const rel = relative(root, dest);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new ManifestError(`文件路径越界：${p}`);
  }
  return dest;
}
