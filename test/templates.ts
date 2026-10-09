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

  // 5.1) 管线阶段预览（HTML / SVG 截断）
  const stRes = await fetch(`${base}/api/templates/${id}/stages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { title: '阶段预览', subtitle: 'y' } }),
  });
  const st: any = await stRes.json();
  const s = st.stages;
  check('POST /:id/stages → 200 + stages', stRes.status === 200 && !!s, st);
  check('阶段 html 为 SSR 后 HTML（含渲染标题）', typeof s?.html === 'string' && s.html.includes('阶段预览'), s?.html);
  check('阶段 svg 为 Satori 输出', typeof s?.svg === 'string' && s.svg.startsWith('<svg'), s?.svg?.slice(0, 40));
  check('阶段 finalSvg 为截断后 SVG', typeof s?.finalSvg === 'string' && s.finalSvg.startsWith('<svg'), s?.finalSvg?.slice(0, 40));
  check('阶段含尺寸与截断元信息', typeof s?.width === 'number' && typeof s?.height === 'number' && typeof s?.autoHeight === 'boolean', { w: s?.width, h: s?.height });
  check('阶段含字体描述（供预览 @font-face）', Array.isArray(s?.fonts) && s.fonts.length > 0 && !!s.fonts[0].url && s.fonts[0].family, s?.fonts?.[0]);
  check('阶段 HTML 已把未知 font-family 归一到加载字体', typeof s?.html === 'string' && !/Arial/i.test(s.html) && /Noto Sans/i.test(s.html), s?.html?.slice(0, 160));

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

  // 9) 图表模板（kind=chart）：独立渲染 + 被 Vue 模板以 <Chart> 组件引用
  const chartCreated = await post('/api/templates', {
    name: '测试图表',
    kind: 'chart',
    data: { values: [3, 8, 4, 10, 6] },
  });
  const chartId: string = chartCreated.body.id;
  check('创建图表模板 → kind=chart', chartCreated.status === 200 && typeof chartId === 'string', chartCreated.body);

  const chartList: any = await fetch(`${base}/api/templates`).then((r) => r.json());
  check('列表含 kind=chart', chartList.list?.some((t: { id: string }) => t.id === chartId && t.kind === 'chart'), chartList);

  const chartRender = await fetch(`${base}/api/templates/${chartId}/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const chartPng = Buffer.from(await chartRender.arrayBuffer());
  check('图表模板独立渲染 → 200 PNG', chartRender.status === 200 && chartPng[0] === 0x89 && chartPng[1] === 0x50, chartRender.status);

  const vueWithChart = await post('/api/templates', {
    name: '含图表页面',
    kind: 'vue',
    files: { 'template.vue': `<div style="display:flex;width:600px"><Chart id="${chartId}" :data="data.chart" /></div>` },
    data: { chart: { values: [1, 2, 3, 4] } },
  });
  const vueId: string = vueWithChart.body.id;
  check('创建引用图表的 Vue 模板', vueWithChart.status === 200 && typeof vueId === 'string', vueWithChart.body);

  const vueRes = await fetch(`${base}/api/templates/${vueId}/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const vuePng = Buffer.from(await vueRes.arrayBuffer());
  check('Vue 模板内嵌 <Chart> 渲染 → 200 PNG', vueRes.status === 200 && vuePng[0] === 0x89 && vuePng[1] === 0x50, vueRes.status);

  const vst: any = await fetch(`${base}/api/templates/${vueId}/stages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.json());
  check('阶段 HTML 已把 <Chart> 占位替换为图表图片', (vst.stages?.html ?? '').includes('<img') && (vst.stages?.html ?? '').includes('data:image') && !(vst.stages?.html ?? '').includes('data-chart-ref'), (vst.stages?.html ?? '').slice(0, 120));

  // 9.1) 修改模板 ID：新 ID 生效、旧 ID 失效、引用自动改写、撞车 → 409
  const newChartId = chartId + 'x';
  const ren = await fetch(`${base}/api/templates/${chartId}/rename`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: newChartId }),
  });
  const renBody: any = await ren.json();
  check('POST /:id/rename → 新 ID', ren.status === 200 && renBody.id === newChartId, renBody);
  const oldGone = await fetch(`${base}/api/templates/${chartId}`);
  check('改 ID 后旧 ID → 404', oldGone.status === 404, oldGone.status);
  const refTpl: any = await fetch(`${base}/api/templates/${vueId}`).then((r) => r.json());
  check('改 ID 后其他模板引用自动改写', (refTpl.files?.['template.vue'] ?? '').includes(`id="${newChartId}"`), refTpl.files?.['template.vue']);
  const dup = await fetch(`${base}/api/templates/${newChartId}/rename`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: vueId }),
  });
  check('改 ID 撞车 → 409 CONFLICT', dup.status === 409, dup.status);
  const badRen = await fetch(`${base}/api/templates/${newChartId}/rename`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'bad id!' }),
  });
  check('非法 ID → 404', badRen.status === 404, badRen.status);

  // 引用不存在 / 非图表的模板 → 渲染失败
  const badVue = await post('/api/templates', {
    name: '错误引用', kind: 'vue',
    files: { 'template.vue': `<div style="display:flex"><Chart id="nonexistent" :data="data" /></div>` },
  });
  const badRes = await fetch(`${base}/api/templates/${badVue.body.id}/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('引用不存在的图表模板 → 渲染失败', badRes.status === 422, badRes.status);

  await fetch(`${base}/api/templates/${chartId}`, { method: 'DELETE' });
  await fetch(`${base}/api/templates/${newChartId}`, { method: 'DELETE' });
  await fetch(`${base}/api/templates/${vueId}`, { method: 'DELETE' });
  await fetch(`${base}/api/templates/${badVue.body.id}`, { method: 'DELETE' });

  server.stop();
  await rm(baseDir, { recursive: true, force: true });
  if (failures === 0) console.log('TEMPLATES_TEST_OK');
  else { console.log(`TEMPLATES_TEST_FAILED (${failures})`); process.exit(1); }
}

main();
