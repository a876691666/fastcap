/**
 * 契约测试：固化 docs/05-contract.md 的公开契约（manifest schema 校验、render.js 契约错误、auto-height、错误码）。
 * 运行：bun test/contract.ts
 */
import { join } from 'node:path';
import { createServer } from '../src/index';

const server = createServer({ port: 0, workdirBase: join(import.meta.dir, '..', '.render-cache') });
const base = `http://127.0.0.1:${server.port}`;

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}`, extra ?? ''); }
}

async function render(files: Record<string, string>, data?: unknown): Promise<{ status: number; ct: string; body: any }> {
  const res = await fetch(`${base}/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files, data }),
  });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, ct, body };
}

const MIN_TEMPLATE = '<div style="display:flex;width:400px;padding:10px;background:#fff;font-size:20px">Hello</div>';
const EMPTY_RENDER = 'export default async function render() { return {}; }';
const VALID_MANIFEST = { schema: 1, width: 400, height: 0, format: 'png', template: 'template.html', entry: 'render.js' };

async function main() {
  // 1) 端点
  const h: any = await fetch(`${base}/health`).then((r) => r.json());
  check('GET /health 200 + JSON', h.ok === true && h.service === 'render-service', h);

  // 2) 成功（auto-height）
  {
    const r = await render({
      'manifest.json': JSON.stringify(VALID_MANIFEST),
      'template.html': MIN_TEMPLATE,
      'render.js': EMPTY_RENDER,
    });
    check('合法包 + height:0 → 200 image/png', r.status === 200 && r.ct.includes('image/png'), r);
    check('auto-height 产出非空 PNG', (r.body as Buffer).length > 100, (r.body as Buffer).length);
  }

  // 3) BAD_REQUEST
  {
    const res = await fetch(`${base}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: {} }), // 无 files 字段
    });
    const body: any = await res.json();
    check('缺 files → 400 BAD_REQUEST', res.status === 400 && body.error.code === 'BAD_REQUEST', body);
  }

  // 4) INVALID_PACKAGE: manifest schema 校验
  {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['缺 manifest.json', { 'template.html': MIN_TEMPLATE, 'render.js': EMPTY_RENDER }],
      ['schema!=1', { 'manifest.json': JSON.stringify({ ...VALID_MANIFEST, schema: 2 }), 'template.html': MIN_TEMPLATE, 'render.js': EMPTY_RENDER }],
      ['width 非法', { 'manifest.json': JSON.stringify({ ...VALID_MANIFEST, width: 0 }), 'template.html': MIN_TEMPLATE, 'render.js': EMPTY_RENDER }],
      ['height 非法', { 'manifest.json': JSON.stringify({ ...VALID_MANIFEST, height: -1 }), 'template.html': MIN_TEMPLATE, 'render.js': EMPTY_RENDER }],
      ['format 非法', { 'manifest.json': JSON.stringify({ ...VALID_MANIFEST, format: 'jpg' }), 'template.html': MIN_TEMPLATE, 'render.js': EMPTY_RENDER }],
    ];
    for (const [name, files] of cases) {
      const r = await render(files as Record<string, string>);
      check(`INVALID_PACKAGE：${name}`, r.status === 422 && r.body.error.code === 'INVALID_PACKAGE', r.body);
    }
  }

  // 5) RENDER_FAILED: render.js 契约
  {
    const tplWithSlot = '<div style="display:flex"><div data-chart="c"></div></div>';
    const r1 = await render({
      'manifest.json': JSON.stringify(VALID_MANIFEST),
      'template.html': tplWithSlot,
      'render.js': EMPTY_RENDER,
    });
    check('render.js 缺槽位 → 422 RENDER_FAILED', r1.status === 422 && r1.body.error.code === 'RENDER_FAILED', r1.body);

    const r2 = await render({
      'manifest.json': JSON.stringify(VALID_MANIFEST),
      'template.html': MIN_TEMPLATE,
      'render.js': 'export default 42;',
    });
    check('render.js 非函数 → 422 RENDER_FAILED', r2.status === 422 && r2.body.error.code === 'RENDER_FAILED', r2.body);
  }

  server.stop();
  if (failures === 0) console.log('CONTRACT_TEST_OK');
  else { console.log(`CONTRACT_TEST_FAILED (${failures})`); process.exit(1); }
}

main();
