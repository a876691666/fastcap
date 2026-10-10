/**
 * 渲染结果缓存测试（data + 模板文件 md5）：
 *   - 相同 data 二次请求命中缓存（X-Cache: HIT，且不重跑渲染）
 *   - 不同 data → MISS 且产生新条目
 *   - 超过条数上限时按写入时间滚动淘汰最旧条目
 * 运行：bun test/cache.ts
 */
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from '../src/index';

const baseDir = join(import.meta.dir, 'tmp-cache');
await mkdir(baseDir, { recursive: true });
const workdir = await mkdtemp(join(baseDir, 'cache-test-'));
const cacheDir = join(workdir, 'results');
const server = createServer({ port: 0, workdirBase: join(workdir, '.cache'), cacheDir, cacheMax: 2 });
const base = `http://127.0.0.1:${server.port}`;

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}`, extra ?? ''); }
}

const dir = join(import.meta.dir, '..', 'examples', 'bar-chart');
const files: Record<string, string> = {};
for (const n of ['manifest.json', 'template.html', 'render.js']) {
  files[n] = await readFile(join(dir, n), 'utf8');
}

async function render(data: unknown) {
  const res = await fetch(`${base}/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files, data }),
  });
  await res.arrayBuffer();
  return res.headers.get('x-cache');
}

async function entryCount(): Promise<number> {
  try {
    return (await readdir(cacheDir)).filter((n) => n.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

try {
  // 1) 首次 MISS，二次 HIT
  const first = await render({ values: [1, 2, 3] });
  const second = await render({ values: [1, 2, 3] });
  check('首次请求 → MISS', first === 'MISS', first);
  check('相同 data 二次请求 → HIT', second === 'HIT', second);

  // 2) 继续请求相同 data → 持续 HIT
  const repeat = await render({ values: [1, 2, 3] });
  check('相同 data 再次请求 → 持续 HIT', repeat === 'HIT', repeat);

  // 3) 不同 data → MISS + 新条目
  const diff = await render({ values: [9, 9, 9] });
  check('不同 data → MISS', diff === 'MISS', diff);
  check('命中后条目数 = 2（未超上限）', (await entryCount()) === 2, await entryCount());

  // 4) 超过上限（max=2）→ 滚动淘汰最旧，保持 <= 2
  await render({ values: [4, 4, 4] });
  const count = await entryCount();
  check('超过上限后滚动淘汰，条目数 <= 2', count <= 2, count);

  // 5) 模板渲染也走缓存
  const tpl = await fetch(`${base}/api/templates`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '缓存模板', files: { 'template.vue': '<div style="width:200px">{{ data.t }}</div>' }, data: { t: 'x' } }),
  }).then((r) => r.json());
  const h1 = await fetch(`${base}/api/templates/${tpl.id}/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { t: 'a' } }) }).then((r) => { return r.headers.get('x-cache'); });
  const h2 = await fetch(`${base}/api/templates/${tpl.id}/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { t: 'a' } }) }).then((r) => r.headers.get('x-cache'));
  check('模板渲染：首次 MISS', h1 === 'MISS', h1);
  check('模板渲染：相同 data → HIT', h2 === 'HIT', h2);
} finally {
  server.stop();
  await rm(baseDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\nCACHE_TEST_FAILED (${failures})`);
  process.exit(1);
}
console.log('\nCACHE_TEST_OK');
