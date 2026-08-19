<script setup>
import { ref, watch } from 'vue';
import * as d3 from 'd3';
import CodeEditor from './CodeEditor.vue';

const route = ref(window.location.hash || '#/');
window.addEventListener('hashchange', () => { route.value = window.location.hash || '#/'; });

// ---------- 列表 ----------
const templates = ref([]);
const newName = ref('');
async function loadList() {
  const r = await fetch('/api/templates');
  templates.value = (await r.json()).list || [];
}
async function createTemplate() {
  const name = newName.value.trim() || '未命名模板';
  const r = await fetch('/api/templates', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  });
  const { id } = await r.json();
  if (id) window.location.hash = '#/edit/' + id;
}
async function copyTemplate(id) {
  const r = await fetch('/api/templates/' + id + '/copy', { method: 'POST' });
  const { id: newId } = await r.json();
  if (newId) window.location.hash = '#/edit/' + newId;
  loadList();
}
async function removeTemplate(id) {
  if (!confirm('删除模板 ' + id + '？')) return;
  await fetch('/api/templates/' + id, { method: 'DELETE' });
  loadList();
}

// ---------- 编辑器 ----------
const currentId = ref('');
const templateVue = ref('');
const renderJs = ref('');
const manifest = ref('');
const data = ref('');
const previewSrc = ref('');
const status = ref('');

// d3 浏览器预览
const d3Charts = ref([]);       // [{name, svg}]
const d3Status = ref('');

// 版本
const versions = ref([]);

function parseRoute() {
  const m = route.value.match(/^#\/edit\/([\w-]+)$/);
  if (m) { currentId.value = m[1]; loadTemplate(m[1]); }
  else { currentId.value = ''; previewSrc.value = ''; d3Charts.value = []; loadList(); }
}

async function loadTemplate(id) {
  const r = await fetch('/api/templates/' + id);
  const t = await r.json();
  if (!t.files) { status.value = '加载失败'; return; }
  templateVue.value = t.files['template.vue'] || '';
  renderJs.value = t.files['render.js'] || '';
  manifest.value = t.files['manifest.json'] || '';
  data.value = JSON.stringify(t.data ?? {}, null, 2);
  status.value = '已加载';
  loadVersions(id);
  runD3Preview();
}

function parseData() {
  try { return JSON.parse(data.value || '{}'); }
  catch (e) { throw new Error('data 不是合法 JSON：' + e.message); }
}
function parseManifest() {
  try { return JSON.parse(manifest.value || '{}'); } catch { return {}; }
}

// ---- d3 浏览器预览：本地运行 render.js，实时显示图表 SVG ----
function serializeSvgBrowser(node) {
  const html = (node && typeof node.outerHTML === 'string') ? node.outerHTML : String(node);
  const t = html.trim();
  if (t.startsWith('<svg') && !t.includes('xmlns')) return t.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  return html;
}
function buildRenderFn(code) {
  const cleaned = code
    .replace(/^import\s+.*$/gm, '')
    .replace(/^export\s+default\s+/m, '')
    .trim();
  if (!cleaned) return null;
  const factory = new Function('d3', 'document', 'serializeSvg', `${cleaned}\nreturn render;`);
  return factory(d3, document, serializeSvgBrowser);
}
async function runD3Preview() {
  try {
    if (!renderJs.value.trim()) { d3Charts.value = []; d3Status.value = ''; return; }
    const fn = buildRenderFn(renderJs.value);
    if (!fn) { d3Charts.value = []; d3Status.value = ''; return; }
    const dataVal = parseData();
    const charts = (await fn({ data: dataVal, manifest: parseManifest() })) || {};
    d3Charts.value = Object.entries(charts).map(([name, svg]) => ({ name, svg: String(svg) }));
    d3Status.value = d3Charts.value.length ? '' : '（render.js 未返回图表）';
  } catch (e) {
    d3Status.value = 'd3 预览失败：' + e.message;
    d3Charts.value = [];
  }
}

// ---- 整体渲染预览（服务端）----
async function renderPreview() {
  let d;
  try { d = parseData(); } catch (e) { status.value = e.message; return; }
  status.value = '渲染中…';
  const r = await fetch('/api/templates/' + currentId.value + '/render', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: d }),
  });
  if (!r.ok) {
    let msg = 'HTTP ' + r.status;
    try { const j = await r.json(); msg += ' [' + (j.error?.code || '') + '] ' + (j.error?.message || ''); } catch {}
    status.value = '渲染失败：' + msg;
    return;
  }
  const blob = await r.blob();
  previewSrc.value = URL.createObjectURL(blob);
  status.value = '渲染成功 ✓';
}

// ---- 保存 / 复制 ----
async function saveTemplate() {
  let d;
  try { d = parseData(); } catch (e) { status.value = e.message; return false; }
  const r = await fetch('/api/templates/' + currentId.value, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: { 'manifest.json': manifest.value, 'template.vue': templateVue.value, 'render.js': renderJs.value },
      data: d,
    }),
  });
  if (!r.ok) { status.value = '保存失败（' + r.status + '）'; return false; }
  status.value = '已保存 ✓（已自动生成版本快照）';
  loadVersions(currentId.value);
  return true;
}
async function copyCurrent() {
  const r = await fetch('/api/templates/' + currentId.value + '/copy', { method: 'POST' });
  const { id: newId } = await r.json();
  if (newId) window.location.hash = '#/edit/' + newId;
}

// ---- 版本 ----
async function loadVersions(id) {
  const r = await fetch('/api/templates/' + id + '/versions');
  versions.value = (await r.json()).list || [];
}
async function snapshotNow() {
  await fetch('/api/templates/' + currentId.value + '/versions', { method: 'POST' });
  loadVersions(currentId.value);
}
async function restoreVersion(v) {
  if (!confirm('恢复到版本 ' + v + '？（当前状态会先保存为快照）')) return;
  const r = await fetch('/api/templates/' + currentId.value + '/restore/' + v, { method: 'POST' });
  status.value = r.ok ? '已恢复版本 ' + v : '恢复失败';
  if (r.ok) { loadTemplate(currentId.value); }
}
async function removeVersion(v) {
  if (!confirm('删除版本快照 ' + v + '？')) return;
  await fetch('/api/templates/' + currentId.value + '/versions/' + v, { method: 'DELETE' });
  loadVersions(currentId.value);
}
async function clearAllVersions() {
  if (!confirm('清空全部版本快照？此操作不可恢复。')) return;
  await fetch('/api/templates/' + currentId.value + '/versions', { method: 'DELETE' });
  versions.value = [];
  status.value = '已清空全部版本';
}

// 编辑 render.js / data 时，d3 预览自动刷新（防抖 500ms）
let d3Timer = null;
watch([renderJs, data], () => {
  clearTimeout(d3Timer);
  d3Timer = setTimeout(runD3Preview, 500);
});

document.addEventListener('keydown', (e) => {
  // Ctrl/Cmd + S：保存并自动预览
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveTemplate().then((ok) => { if (ok) renderPreview(); });
    return;
  }
  // Ctrl/Cmd + Enter：直接预览
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); renderPreview(); }
});

// 路由变化（hash）驱动视图切换：创建/复制/返回/编辑链接都靠它
watch(route, parseRoute, { immediate: true });
</script>

<template>
  <!-- 列表 -->
  <div v-if="!currentId" class="page">
    <header>
      <h1>render-service 模板管理</h1>
      <span class="muted">模板以文件存储（Docker 卷映射持久化）· 调用端「模板 ID + data」渲染图片</span>
    </header>
    <div class="toolbar">
      <input v-model="newName" placeholder="新模板名称（回车创建）" @keyup.enter="createTemplate">
      <button class="primary" @click="createTemplate">＋ 创建模板</button>
    </div>
    <table>
      <thead><tr><th>名称</th><th>ID</th><th>更新时间</th><th>操作</th></tr></thead>
      <tbody>
        <tr v-for="t in templates" :key="t.id">
          <td>{{ t.name }}</td>
          <td><code>{{ t.id }}</code></td>
          <td class="muted">{{ t.updated_at }}</td>
          <td class="ops">
            <a :href="'#/edit/' + t.id">✏️ 编辑</a>
            <a href="#" @click.prevent="copyTemplate(t.id)">📋 复制</a>
            <button @click="removeTemplate(t.id)">删除</button>
          </td>
        </tr>
        <tr v-if="templates.length === 0"><td colspan="4" class="muted">还没有模板，先创建一个。</td></tr>
      </tbody>
    </table>
  </div>

  <!-- 编辑器 -->
  <div v-else class="page">
    <header>
      <a class="back" href="#/">← 返回列表</a>
      <h1>编辑模板 <code>{{ currentId }}</code></h1>
      <span :class="['status', status.startsWith('渲染失败') ? 'err' : status.includes('已保存') || status.includes('已恢复') || status.includes('渲染成功') ? 'ok' : '']">{{ status }}</span>
      <div class="toolbar">
        <button @click="copyCurrent">📋 复制为副本</button>
        <button class="primary" @click="renderPreview">渲染预览 (Ctrl+Enter)</button>
        <button @click="saveTemplate">保存</button>
      </div>
    </header>

    <div class="main">
      <section class="editors">
        <div class="editor grow"><label>template.vue（Vue 模板 + unocss class）</label><CodeEditor v-model="templateVue" language="html" /></div>
        <div class="editor"><label>render.js（d3 图表，可选；浏览器实时预览）</label><CodeEditor v-model="renderJs" language="javascript" /></div>
        <div class="editor"><label>manifest.json</label><CodeEditor v-model="manifest" language="json" /></div>
        <div class="editor"><label>data（JSON，渲染时外部传入）</label><CodeEditor v-model="data" language="json" /></div>
      </section>

      <section class="preview-col">
        <div class="panel">
          <div class="panel-title">d3 图表预览（浏览器实时）<span class="muted">{{ d3Status }}</span></div>
          <div class="d3-charts">
            <div v-if="d3Charts.length === 0" class="hint">编辑 render.js / data 后自动预览图表 SVG</div>
            <div v-for="c in d3Charts" :key="c.name" class="d3-item">
              <div class="muted">槽位：{{ c.name }}</div>
              <div v-html="c.svg"></div>
            </div>
          </div>
        </div>
        <div class="panel grow">
          <div class="panel-title">整体渲染预览（服务端 Satori + resvg）</div>
          <div class="img-wrap">
            <img v-if="previewSrc" :src="previewSrc" alt="整体预览">
            <div v-else class="hint">点「渲染预览」查看最终图片</div>
          </div>
        </div>
      </section>
    </div>

    <section class="panel versions">
      <div class="panel-title">
        版本历史（保存自动快照，可回滚）
        <button @click="snapshotNow" style="margin-left:8px">保存快照</button>
        <button v-if="versions.length" @click="clearAllVersions" style="margin-left:6px" class="danger">清空版本</button>
      </div>
      <table v-if="versions.length">
        <tbody>
          <tr v-for="v in versions" :key="v.v">
            <td><code>{{ v.v }}</code></td>
            <td class="muted">{{ v.created_at }}</td>
            <td>
              <button @click="restoreVersion(v.v)">恢复</button>
              <button @click="removeVersion(v.v)" class="danger">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="muted">暂无版本，保存模板后自动生成。</div>
    </section>
  </div>
</template>

<style>
:root { --bg:#0f172a; --panel:#1e293b; --border:#334155; --text:#e2e8f0; --muted:#94a3b8; --accent:#38bdf8; }
* { box-sizing:border-box; }
body { margin:0; font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; background:var(--bg); color:var(--text); height:100vh; }
#app { height:100vh; }
.page { height:100%; display:flex; flex-direction:column; padding:16px; gap:10px; }
header { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
header h1 { font-size:18px; margin:0; }
.muted { color:var(--muted); font-size:12px; }
.back { color:var(--accent); text-decoration:none; font-size:14px; }
.toolbar { display:flex; gap:8px; align-items:center; }
input { background:var(--panel); color:var(--text); border:1px solid var(--border); border-radius:6px; padding:6px 10px; font-size:13px; }
button { background:var(--panel); color:var(--text); border:1px solid var(--border); border-radius:6px; padding:5px 11px; font-size:12.5px; cursor:pointer; }
button:hover { border-color:var(--accent); }
button.primary { background:var(--accent); color:#0f172a; border-color:var(--accent); font-weight:600; }
button.danger { color:#f87171; }
button.danger:hover { border-color:#f87171; }
table { border-collapse:collapse; width:100%; font-size:13px; }
th, td { text-align:left; padding:7px 12px; border-bottom:1px solid var(--border); }
th { color:var(--muted); font-weight:500; }
code { background:var(--panel); padding:1px 6px; border-radius:4px; font-size:12px; }
.ops a { color:var(--accent); margin-right:10px; text-decoration:none; }
.status { font-size:12px; font-family:ui-monospace,monospace; }
.status.ok { color:#4ade80; }
.status.err { color:#f87171; }

.main { flex:1; display:flex; gap:10px; min-height:0; }
.editors { display:grid; grid-template-columns:1fr 1fr; gap:8px; flex:1.3; min-width:0; }
.editor { display:flex; flex-direction:column; gap:3px; min-height:0; }
.editor.grow { grid-row:span 2; }
.editor label { font-size:11px; color:var(--muted); font-family:ui-monospace,monospace; }
.preview-col { flex:1; display:flex; flex-direction:column; gap:10px; min-width:0; }
.panel { background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:10px; display:flex; flex-direction:column; gap:8px; }
.panel.grow { flex:1; min-height:0; }
.panel-title { font-size:12.5px; color:var(--text); font-weight:600; display:flex; align-items:center; }
.d3-charts { display:flex; flex-direction:column; gap:8px; overflow:auto; max-height:40vh; }
.d3-item { background:#fff; border-radius:6px; padding:8px; }
.d3-item svg { max-width:100%; height:auto; }
.img-wrap { flex:1; display:flex; align-items:center; justify-content:center; overflow:auto; min-height:120px; }
.img-wrap img { max-width:100%; height:auto; border-radius:4px; background:#fff; }
.hint { color:var(--muted); font-size:12px; text-align:center; line-height:1.8; }
.versions { max-height:220px; overflow:auto; }
.versions td { padding:5px 12px; }
@media (max-width: 1100px) { .main { flex-direction:column; } .editors { grid-template-columns:1fr; } }
</style>
