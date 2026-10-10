/**
 * 渲染结果磁盘缓存。
 *
 * key = md5(传入 data + 模板文件内容 + 渲染 options)（对象 key 稳定排序，保证同内容同 key）。
 * 目录布局：`<dir>/<key>.<ext>`（图片二进制）+ `<dir>/<key>.json`（元数据 contentType/at）。
 * - TTL：ttlMs > 0 时命中超过 ttlMs 的条目视为失效并删除。
 * - 条数上限：maxEntries > 0 时写入后若超限，按写入时间「滚动」淘汰最旧条目（先进先出）。
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';

export interface CacheEntry {
  buffer: Buffer;
  contentType: string;
}

export interface RenderCache {
  get(key: string): Promise<CacheEntry | null>;
  set(key: string, entry: CacheEntry): Promise<void>;
}

const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/svg+xml; charset=utf-8': 'svg',
  'image/svg+xml': 'svg',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

interface CacheMeta {
  contentType: string;
  ext: string;
  at: number;
}

/** 稳定序列化：对象 key 排序，保证同一 data 任意 key 顺序都得到相同 md5 */
function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

/** 由若干输入片段计算缓存 key（md5 十六进制字符串） */
export function contentKey(parts: unknown[]): string {
  return createHash('md5').update(stableStringify(parts)).digest('hex');
}

async function unlinkQuiet(p: string): Promise<void> {
  await unlink(p).catch(() => {});
}

export function createRenderCache(dir: string, ttlMs: number, maxEntries = 0): RenderCache {
  const metaPath = (key: string) => join(dir, `${key}.json`);
  const dataPath = (key: string, ext: string) => join(dir, `${key}.${ext}`);

  async function readMeta(key: string): Promise<CacheMeta | null> {
    try {
      return JSON.parse(await readFile(metaPath(key), 'utf8')) as CacheMeta;
    } catch {
      return null;
    }
  }

  async function evict(): Promise<void> {
    if (maxEntries <= 0) return;
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    const keys = names.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -'.json'.length));
    if (keys.length <= maxEntries) return;
    const metas: Array<{ key: string; at: number; ext: string }> = [];
    for (const key of keys) {
      const m = await readMeta(key);
      metas.push({ key, at: m?.at ?? 0, ext: m?.ext ?? 'bin' });
    }
    metas.sort((a, b) => a.at - b.at);
    const stale = metas.slice(0, metas.length - maxEntries);
    await Promise.all(
      stale.flatMap((m) => [unlinkQuiet(metaPath(m.key)), unlinkQuiet(dataPath(m.key, m.ext))]),
    );
  }

  return {
    async get(key) {
      const meta = await readMeta(key);
      if (!meta) return null;
      if (ttlMs > 0 && Date.now() - meta.at > ttlMs) {
        await Promise.all([unlinkQuiet(metaPath(key)), unlinkQuiet(dataPath(key, meta.ext))]);
        return null;
      }
      try {
        return { buffer: await readFile(dataPath(key, meta.ext)), contentType: meta.contentType };
      } catch {
        await unlinkQuiet(metaPath(key));
        return null;
      }
    },
    async set(key, entry) {
      const ext = EXT_BY_TYPE[entry.contentType] ?? 'bin';
      await mkdir(dir, { recursive: true });
      const meta: CacheMeta = { contentType: entry.contentType, ext, at: Date.now() };
      await Promise.all([
        writeFile(dataPath(key, ext), entry.buffer),
        writeFile(metaPath(key), JSON.stringify(meta)),
      ]);
      await evict();
    },
  };
}
