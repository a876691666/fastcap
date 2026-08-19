/**
 * 模板管理 API 测试：CRUD + 按 ID+data 渲染。
 * 用临时 TEMPLATES_DIR 隔离，避免污染真实模板目录。
 * 运行：bun test/templates.ts
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from '../src/index';

const baseDir = join(import.meta.dir, 'tmp-tpl');
await mkdir(baseDir, { recursive: true });
const workdir = await mkdtemp(join(baseDir, 'tpl-test-'));
process.env.TEMPLATES_DIR = join(workdir, 'templates');
const server = createServer({ port: 0, workdirBase: join(workdir, '.cache') });
const base = `http://127.0.0.1:${server.port}`;

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}`, extra ?? ''); }
}

async function post(path: string, body: unknown) {
  const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, ct: res.headers.get('content-type') ?? '', body: (await res.json()) as any };
}

const TPL = `
<div class="flex flex-col p-6 bg-white" style="width:600px;font-family:Arial Unicode MS, Arial">
  <div class="text-3xl font-bold text-slate-900">{{ data.title }}</div>
  <div class="text-sm text-slate-400 mt-1">{{ data.subtitle }}</div>
</div>`;

async function main() {
  // 1) 创建
  const created = await post('/api/templates', {
    name: '测试模板',
    files: { 'template.vue': TPL, 'render.js': 'export default async function render(){return {};}' },
    data: { title: '你好', subtitle: '来自 API 测试' },
  });
  check('POST /api/templates → 200 + id', created.status === 200 && typeof created.body.id === 'string', created.body);
  const id: string = created.body.id;

  // 2) 列表
  const list: any = await fetch(`${base}/api/templates`).then((r) => r.json());
  check('GET /api/templates 含新模板', list.list?.some((t: { id: string }) => t.id === id), list);

  // 3) 详情
  const got: any = await fetch(`${base}/api/templates/${id}`).then((r) => r.json());
  check('GET /api/templates/:id 返回 Vue 模板', got.files?.['template.vue']?.includes('{{ data.title }}'), got.files?.['template.vue']);

  // 4) 按 ID+data 渲染（覆盖默认 data）
  const renderRes = await fetch(`${base}/api/templates/${id}/render`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { title: '渲染成功', subtitle: 'x' } }),
  });
  const png = Buffer.from(await renderRes.arrayBuffer());
  check('POST /:id/render → 200 image/png', renderRes.status === 200 && (renderRes.headers.get('content-type') ?? '').includes('image/png'), renderRes.status);
  check('渲染出有效 PNG', png.length > 100 && png[0] === 0x89 && png[1] === 0x50, png.length);

  // 5) 缺省 data 用模板默认
  const r2 = await fetch(`${base}/api/templates/${id}/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('缺省 data 也能渲染（用默认 data.json）', r2.status === 200, r2.status);

  // 6) 更新
  const upd = await fetch(`${base}/api/templates/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '改名', data: { title: '新' } }) });
  check('PUT 更新 → ok', upd.status === 200);

  // 6.1) 复制
  const cp: any = await fetch(`${base}/api/templates/${id}/copy`, { method: 'POST' }).then((r) => r.json());
  check('POST /:id/copy → 新 id', typeof cp.id === 'string' && cp.id !== id, cp);
  const cpTpl: any = await fetch(`${base}/api/templates/${cp.id}`).then((r) => r.json());
  check('副本名称带「（副本）」', (cpTpl.name ?? '').includes('副本'), cpTpl.name);

  // 6.2) 版本（update 已自动快照）
  const vs: any = await fetch(`${base}/api/templates/${id}/versions`).then((r) => r.json());
  check('版本列表非空（保存自动快照）', (vs.list?.length ?? 0) >= 1, vs);
  const snap: any = await fetch(`${base}/api/templates/${id}/versions`, { method: 'POST' }).then((r) => r.json());
  check('手动快照 → v', typeof snap.v === 'string', snap);
  const vd: any = await fetch(`${base}/api/templates/${id}/versions/${snap.v}`).then((r) => r.json());
  check('读取版本文件', vd.files?.['template.vue'] !== undefined, vd);
  const rest = await fetch(`${base}/api/templates/${id}/restore/${snap.v}`, { method: 'POST' });
  check('恢复版本 → ok', rest.status === 200);

  // 6.3) 删除单个快照 + 清空全部
  const delV = await fetch(`${base}/api/templates/${id}/versions/${snap.v}`, { method: 'DELETE' });
  check('DELETE /versions/:v → ok', delV.status === 200);
  const vsAfter: any = await fetch(`${base}/api/templates/${id}/versions`).then((r) => r.json());
  check('删除后版本减少', (vsAfter.list ?? []).every((x: any) => x.v !== snap.v), vsAfter);
  const clear = await fetch(`${base}/api/templates/${id}/versions`, { method: 'DELETE' });
  check('DELETE /versions（清空）→ ok', clear.status === 200);
  const vsEmpty: any = await fetch(`${base}/api/templates/${id}/versions`).then((r) => r.json());
  check('清空后版本为空', (vsEmpty.list ?? []).length === 0, vsEmpty);

  // 7) 删除
  const del = await fetch(`${base}/api/templates/${id}`, { method: 'DELETE' });
  check('DELETE → ok', del.status === 200);
  const after: any = await fetch(`${base}/api/templates/${id}`).then((r) => r.json());
  check('删除后 GET → 404 NOT_FOUND', after.error?.code === 'NOT_FOUND', after);

  // 8) 不存在的模板渲染 → 404
  const r404 = await fetch(`${base}/api/templates/nonexistent/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('不存在模板渲染 → 404', r404.status === 404, r404.status);

  server.stop();
  await rm(baseDir, { recursive: true, force: true });
  if (failures === 0) console.log('TEMPLATES_TEST_OK');
  else { console.log(`TEMPLATES_TEST_FAILED (${failures})`); process.exit(1); }
}

main();
