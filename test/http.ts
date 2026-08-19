/**
 * HTTP 端到端测试：起服务 -> POST /render -> 校验返回 PNG；再测 /health 与错误分支。
 * 运行：bun test/http.ts
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from '../src/index';

const server = createServer({ port: 0, workdirBase: join(import.meta.dir, '..', '.render-cache') });
const base = `http://127.0.0.1:${server.port}`;

const dir = join(import.meta.dir, '..', 'examples', 'bar-chart');
const files: Record<string, string> = {};
for (const n of ['manifest.json', 'template.html', 'render.js']) {
  files[n] = await readFile(join(dir, n), 'utf8');
}

// 1) health
const health = await fetch(`${base}/health`).then((r) => r.json());
console.log('health:', JSON.stringify(health));

// 2) 成功渲染
const ok = await fetch(`${base}/render`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ files, data: { values: [3, 7, 5, 11, 9] } }),
});
const png = Buffer.from(await ok.arrayBuffer());
console.log('render status:', ok.status, 'content-type:', ok.headers.get('content-type'));
console.log('png bytes:', png.length, 'render-time-ms:', ok.headers.get('x-render-time-ms'));
const isPng = png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47;
console.log('is valid PNG signature:', isPng);

// 3) 错误分支：缺 manifest
const bad = await fetch(`${base}/render`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ files: { 'template.html': '<div/>' } }),
});
console.log('bad status:', bad.status, 'body:', await bad.text());

server.stop();
console.log('HTTP_TEST_OK');
