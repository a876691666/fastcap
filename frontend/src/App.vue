<script setup>
import { ref, watch, computed } from 'vue';
import * as d3 from 'd3';
import { theme as antdTheme, message, Modal } from 'ant-design-vue';
import {
  PlusOutlined, EditOutlined, CopyOutlined, DeleteOutlined, SaveOutlined,
  ThunderboltOutlined, FormatPainterOutlined, HistoryOutlined, ReloadOutlined, UndoOutlined,
} from '@ant-design/icons-vue';
import CodeEditor from './CodeEditor.vue';

// ---------- 主题：跟随系统深浅色 ----------
const mq = window.matchMedia('(prefers-color-scheme: dark)');
const isDark = ref(mq.matches);
mq.addEventListener('change', (e) => { isDark.value = e.matches; });
const themeConfig = computed(() => ({
  algorithm: isDark.value ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
  token: { colorPrimary: '#1677ff', borderRadius: 6 },
}));
const editorTheme = computed(() => (isDark.value ? 'vs-dark' : 'vs'));

// 反馈（随主题）
const [messageApi, messageContext] = message.useMessage();
const [modalApi, modalContext] = Modal.useModal();
function confirmDialog(opts) {
  return new Promise((resolve) => {
    modalApi.confirm({
      okText: '确定', cancelText: '取消', ...opts,
      onOk: () => resolve(true), onCancel: () => resolve(false),
    });
  });
}

// ---------- 路由 ----------
const route = ref(window.location.hash || '#/');
window.addEventListener('hashchange', () => { route.value = window.location.hash || '#/'; });
function gotoEdit(id) { window.location.hash = '#/edit/' + id; }
function goList() { window.location.hash = '#/'; }
function formatTime(iso) { try { return new Date(iso).toLocaleString(); } catch { return iso; } }

// ---------- 列表 ----------
const templates = ref([]);
const newName = ref('');
const newKind = ref('vue');   // 新建类型：vue | chart
const listColumns = [
  { title: '名称', dataIndex: 'name', key: 'name' },
  { title: '类型', key: 'kind', width: 90 },
  { title: 'ID', dataIndex: 'id', key: 'id', width: 150 },
  { title: '更新时间', dataIndex: 'updated_at', key: 'updated_at', width: 190 },
  { title: '操作', key: 'ops', width: 230 },
];
async function loadList() {
  const r = await fetch('/api/templates');
  templates.value = (await r.json()).list || [];
}
async function createTemplate() {
  const name = newName.value.trim() || (newKind.value === 'chart' ? '未命名图表' : '未命名模板');
  const r = await fetch('/api/templates', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, kind: newKind.value }),
  });
  const { id } = await r.json();
  if (id) { newName.value = ''; gotoEdit(id); }
}
async function copyTemplate(id) {
  const r = await fetch('/api/templates/' + id + '/copy', { method: 'POST' });
  const { id: newId } = await r.json();
  if (newId) { messageApi.success('已复制为 ' + newId); gotoEdit(newId); }
  loadList();
}
async function removeTemplate(id) {
  if (!(await confirmDialog({ title: '删除模板', content: '确定删除模板 ' + id + '？此操作不可恢复。', okType: 'danger' }))) return;
  await fetch('/api/templates/' + id, { method: 'DELETE' });
  messageApi.success('已删除 ' + id);
  loadList();
}

// ---------- 编辑器 ----------
const currentId = ref('');
const idDraft = ref('');          // 可编辑的模板 ID（改 ID 走 /rename）
const currentKind = ref('vue');   // 当前模板类型：vue | chart
const templateVue = ref('');
const renderJs = ref('');
const manifest = ref('');
const data = ref('');
const previewSrc = ref('');
const status = ref('');

// 管线阶段预览：HTML 阶段 / SVG 阶段
const stages = ref(null);       // { html, svg, finalSvg, autoHeight, contentBottom, width, height }
const stageTab = ref('image');  // image | html | svg
const stagesStatus = ref('');
const autoRender = ref(false);  // 勾选后：3s 无编辑自动渲染
const renderMs = ref(null);     // 最近一次渲染耗时（毫秒）
const rendering = ref(false);

// HTML 阶段以“渲染预览”展示：用 iframe srcdoc 隔离，避免编辑器全局样式污染。
// 同时注入渲染器实际使用的字体（@font-face），保证预览字体与最终图片一致。
function wrapHtmlDoc(fragment) {
  const fonts = stages.value?.fonts || [];
  const face = fonts.map((f) => {
    const url = typeof f.url === 'string' && f.url.startsWith('/') ? location.origin + f.url : f.url;
    return `@font-face{font-family:'${f.family}';font-style:${f.style || 'normal'};font-weight:${f.weight || 400};src:url("${url}");}`;
  }).join('');
  const families = [...new Set(fonts.map((f) => f.family))];
  const bodyFont = families.length ? `font-family:${families.map((f) => `'${f}'`).join(',')};` : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${face}html,body{margin:0;padding:0;background:#fff;${bodyFont}}</style></head><body>${fragment}</body></html>`;
}
const htmlPreviewDoc = computed(() => (stages.value ? wrapHtmlDoc(stages.value.html) : ''));

// d3 浏览器预览
const d3Charts = ref([]);       // [{name, svg}]
const d3Status = ref('');

// 版本
const versions = ref([]);
const versionColumns = [
  { title: '版本', dataIndex: 'v', key: 'v', width: 170 },
  { title: '时间', dataIndex: 'created_at', key: 'created_at' },
  { title: '操作', key: 'ops', width: 170 },
];

// Vue 模板可引用的图表模板（<Chart id> 组件）
const chartTemplates = computed(() => templates.value.filter((t) => t.kind === 'chart'));
function insertChartRef(c) {
  const snippet = `<Chart id="${c.id}" :data="data.chart" />`;
  navigator.clipboard?.writeText(snippet);
  messageApi.success('已复制组件代码：' + snippet);
  status.value = `已复制组件代码（粘贴到 template.vue）：${snippet}`;
}

// ---- manifest 交互式表单（以 manifest 字符串为准，字段编辑回写 JSON，保留 fonts/charts 等未知字段）----
const mObj = computed(() => {
  try { return JSON.parse(manifest.value || '{}'); } catch { return {}; }
});
function setField(key, val) {
  const o = { ...mObj.value };
  if (val === undefined || val === null || val === '') delete o[key];
  else o[key] = val;
  manifest.value = JSON.stringify(o, null, 2);
}

// ---- 代码格式化（Prettier，按需动态加载）----
const formatting = ref(false);
function stripTemplateWrapper(s) {
  const lines = s.split('\n');
  if (lines.length && lines[0].trim() === '<template>') lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  if (lines.length && lines[lines.length - 1].trim() === '</template>') lines.pop();
  return lines.map((l) => (l.startsWith('  ') ? l.slice(2) : l)).join('\n') + '\n';
}
async function formatCode(parser, code) {
  const src = code ?? '';
  if (!src.trim()) return src;
  const prettier = await import('prettier/standalone');
  if (parser === 'js' || parser === 'json') {
    const babel = await import('prettier/plugins/babel');
    const estree = await import('prettier/plugins/estree');
    const opts = parser === 'js'
      ? { parser: 'babel', plugins: [babel, estree], singleQuote: true, printWidth: 100 }
      : { parser: 'json', plugins: [babel, estree] };
    return await prettier.format(src, opts);
  }
  // vue：包裹 <template> 以支持自闭合组件（如 <Chart />），格式化后去掉包裹
  const html = await import('prettier/plugins/html');
  const out = await prettier.format(`<template>\n${src}\n</template>\n`, {
    parser: 'vue', plugins: [html], printWidth: 100,
  });
  return stripTemplateWrapper(out);
}
async function runFormat(parser, get, set) {
  formatting.value = true;
  try {
    const out = await formatCode(parser, get());
    if (typeof out === 'string') set(out);
    status.value = '已格式化 ✓';
  } catch (e) {
    status.value = '格式化失败：' + (e?.message || e);
    messageApi.error('格式化失败：' + (e?.message || e));
  } finally {
    formatting.value = false;
  }
}
function formatMain() {
  if (currentKind.value === 'vue') runFormat('vue', () => templateVue.value, (v) => { templateVue.value = v; });
  else runFormat('js', () => renderJs.value, (v) => { renderJs.value = v; });
}
function formatData() { runFormat('json', () => data.value, (v) => { data.value = v; }); }

function parseRoute() {
  const m = route.value.match(/^#\/edit\/([\w-]+)$/);
  if (m) { currentId.value = m[1]; loadTemplate(m[1]); }
  else { currentId.value = ''; previewSrc.value = ''; d3Charts.value = []; stages.value = null; loadList(); }
}

async function loadTemplate(id) {
  const r = await fetch('/api/templates/' + id);
  const t = await r.json();
  if (!t.files) { status.value = '加载失败'; messageApi.error('加载失败'); return; }
  currentKind.value = t.kind || 'vue';
  idDraft.value = id;
  templateVue.value = t.files['template.vue'] || '';
  renderJs.value = t.files['render.js'] || '';
  manifest.value = t.files['manifest.json'] || '';
  data.value = JSON.stringify(t.data ?? {}, null, 2);
  status.value = '已加载';
  previewSrc.value = '';
  stages.value = null;
  stagesStatus.value = '';
  renderMs.value = null;
  stageTab.value = 'image';
  loadList();          // 拉取模板列表（Vue 模板需要图表模板引用列表）
  loadVersions(id);
  runD3Preview();
  renderPreview();   // 首次进入即渲染（图片 + HTML/SVG 阶段）
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
  // 用游离的 sandbox 充当 document.body：render.js 里的 d3.select(document.body).append('svg')
  // 只画进 sandbox，不会把 <svg> 挂到真实页面 body（否则会残留在 Monaco aria 容器之后）
  const sandbox = document.createElement('div');
  const sandboxDoc = new Proxy({ body: sandbox }, {
    get(t, p) {
      if (p in t) return t[p];
      const v = document[p];
      return typeof v === 'function' ? v.bind(document) : v;
    },
  });
  return factory(d3, sandboxDoc, serializeSvgBrowser);
}
async function runD3Preview() {
  // 仅 chart 模板有 render.js 可本地预览；vue 模板无 d3 预览模块
  if (currentKind.value !== 'chart') { d3Charts.value = []; d3Status.value = ''; return; }
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

// ---- 整体渲染预览（服务端）：同时取图片 + 管线阶段（HTML / SVG）----
function errMsg(r, j) {
  let msg = 'HTTP ' + r.status;
  if (j?.error) msg += ' [' + (j.error.code || '') + '] ' + (j.error.message || '');
  return msg;
}
// 当前编辑器内容（用于预览时把未保存的改动发给服务端）
function currentFiles() {
  const files = { 'manifest.json': manifest.value };
  if (currentKind.value === 'chart') files['render.js'] = renderJs.value;
  else files['template.vue'] = templateVue.value;
  return files;
}
async function renderStages(d) {
  const r = await fetch('/api/templates/' + currentId.value + '/stages', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: d, files: currentFiles() }),
  });
  if (!r.ok) {
    let j; try { j = await r.json(); } catch {}
    stages.value = null;
    stagesStatus.value = '阶段加载失败：' + errMsg(r, j);
    return;
  }
  const j = await r.json();
  stages.value = j.stages || null;
  stagesStatus.value = j.stages
    ? `输出尺寸 ${j.stages.width}×${j.stages.height}${j.stages.autoHeight ? '（auto-height）' : ''}`
    : '';
}
async function renderPreview() {
  let d;
  try { d = parseData(); } catch (e) { status.value = e.message; return; }
  status.value = '渲染中…';
  rendering.value = true;
  const t0 = performance.now();
  try {
    const tasks = [
      fetch('/api/templates/' + currentId.value + '/render', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: d, files: currentFiles() }),
      }),
    ];
    // chart 模板无 HTML/SVG 阶段标签，跳过 /stages（避免不必要的二次渲染）
    if (currentKind.value === 'vue') tasks.push(renderStages(d));
    const [imgRes] = await Promise.all(tasks);

    if (!imgRes.ok) {
      let j; try { j = await imgRes.json(); } catch {}
      status.value = '渲染失败：' + errMsg(imgRes, j);
      renderMs.value = null;
      messageApi.error(status.value);
    } else {
      const blob = await imgRes.blob();
      previewSrc.value = URL.createObjectURL(blob);
      const serverMs = Number(imgRes.headers.get('X-Render-Time-Ms'));
      const ms = Number.isFinite(serverMs) && serverMs > 0 ? serverMs : Math.round(performance.now() - t0);
      renderMs.value = ms;
      status.value = `渲染成功 ✓ · 耗时 ${ms} ms`;
    }
  } finally {
    rendering.value = false;
  }
}

// ---- 保存 / 复制 / 改 ID ----
async function saveTemplate() {
  let d;
  try { d = parseData(); } catch (e) { status.value = e.message; messageApi.error(e.message); return false; }
  // 按类型只写对应文件：vue 写 template.vue，chart 写 render.js（另一文件不动）
  const files = { 'manifest.json': manifest.value };
  if (currentKind.value === 'chart') files['render.js'] = renderJs.value;
  else files['template.vue'] = templateVue.value;
  const r = await fetch('/api/templates/' + currentId.value, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files, data: d }),
  });
  if (!r.ok) { status.value = '保存失败（' + r.status + '）'; messageApi.error(status.value); return false; }
  status.value = '已保存 ✓（已自动生成版本快照）';
  messageApi.success('已保存 ✓');
  loadVersions(currentId.value);
  return true;
}
async function copyCurrent() {
  const r = await fetch('/api/templates/' + currentId.value + '/copy', { method: 'POST' });
  const { id: newId } = await r.json();
  if (newId) { messageApi.success('已复制为 ' + newId); gotoEdit(newId); }
}

// 修改模板 ID（目录改名）：ID 不能重复；改完跳转到新 ID
async function renameCurrentId() {
  const next = (idDraft.value || '').trim();
  if (!next || next === currentId.value) return;
  if (!/^[\w-]+$/.test(next)) {
    status.value = 'ID 只能用字母、数字、下划线、连字符';
    messageApi.error(status.value);
    idDraft.value = currentId.value;
    return;
  }
  if (!(await confirmDialog({
    title: '修改模板 ID',
    content: `把模板 ID 从 ${currentId.value} 改为 ${next}？未保存的改动会丢失。`,
  }))) { idDraft.value = currentId.value; return; }
  const r = await fetch('/api/templates/' + currentId.value + '/rename', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: next }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    status.value = '改 ID 失败：' + errMsg(r, j);
    messageApi.error(status.value);
    idDraft.value = currentId.value;
    return;
  }
  status.value = 'ID 已改为 ' + j.id;
  messageApi.success('ID 已改为 ' + j.id);
  gotoEdit(j.id);
}

// ---- 版本 ----
async function loadVersions(id) {
  const r = await fetch('/api/templates/' + id + '/versions');
  versions.value = (await r.json()).list || [];
}
async function snapshotNow() {
  await fetch('/api/templates/' + currentId.value + '/versions', { method: 'POST' });
  messageApi.success('已保存快照');
  loadVersions(currentId.value);
}
async function restoreVersion(v) {
  if (!(await confirmDialog({ title: '恢复版本', content: `恢复到版本 ${v}？（当前状态会先保存为快照）` }))) return;
  const r = await fetch('/api/templates/' + currentId.value + '/restore/' + v, { method: 'POST' });
  status.value = r.ok ? '已恢复版本 ' + v : '恢复失败';
  if (r.ok) { messageApi.success('已恢复版本 ' + v); loadTemplate(currentId.value); }
  else messageApi.error('恢复失败');
}
async function removeVersion(v) {
  if (!(await confirmDialog({ title: '删除版本', content: `删除版本快照 ${v}？`, okType: 'danger' }))) return;
  await fetch('/api/templates/' + currentId.value + '/versions/' + v, { method: 'DELETE' });
  loadVersions(currentId.value);
}
async function clearAllVersions() {
  if (!(await confirmDialog({ title: '清空版本', content: '清空全部版本快照？此操作不可恢复。', okType: 'danger' }))) return;
  await fetch('/api/templates/' + currentId.value + '/versions', { method: 'DELETE' });
  versions.value = [];
  status.value = '已清空全部版本';
  messageApi.success('已清空全部版本');
}

// 编辑 render.js / manifest / data 时，d3 预览自动刷新（防抖 500ms）
let d3Timer = null;
watch([renderJs, manifest, data], () => {
  clearTimeout(d3Timer);
  d3Timer = setTimeout(runD3Preview, 500);
});

// 自动渲染：勾选后，任一编辑内容 3s 无变更则触发整体渲染
let autoTimer = null;
watch([templateVue, renderJs, manifest, data], () => {
  if (!autoRender.value || !currentId.value) return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => renderPreview(), 3000);
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
  <a-config-provider :theme="themeConfig">
    <messageContext />
    <modalContext />
    <div :class="['app', isDark ? 'app-dark' : 'app-light']">
      <!-- ================= 列表 ================= -->
      <div v-if="!currentId" class="app-body">
        <a-page-header
          title="render-service 模板管理"
          sub-title="模板以文件存储 · 调用端「模板 ID + data」渲染图片"
        >
          <template #extra>
            <a-space>
              <a-input
                v-model:value="newName"
                placeholder="新模板名称（回车创建）"
                style="width: 220px"
                @press-enter="createTemplate"
              />
              <a-select v-model:value="newKind" style="width: 150px">
                <a-select-option value="vue">Vue 页面模板</a-select-option>
                <a-select-option value="chart">图表模板</a-select-option>
              </a-select>
              <a-button type="primary" @click="createTemplate">
                <plus-outlined /> 创建模板
              </a-button>
            </a-space>
          </template>
        </a-page-header>

        <div class="app-content list-content">
          <a-card :bordered="false">
            <a-table
              :data-source="templates"
              :columns="listColumns"
              row-key="id"
              :pagination="false"
              size="middle"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'kind'">
                  <a-tag :color="record.kind === 'chart' ? 'gold' : 'blue'">
                    {{ record.kind === 'chart' ? '图表' : 'Vue' }}
                  </a-tag>
                </template>
                <template v-else-if="column.key === 'id'">
                  <a-typography-text code>{{ record.id }}</a-typography-text>
                </template>
                <template v-else-if="column.key === 'updated_at'">
                  <span class="muted">{{ formatTime(record.updated_at) }}</span>
                </template>
                <template v-else-if="column.key === 'ops'">
                  <a-space>
                    <a-button type="link" size="small" @click="gotoEdit(record.id)">
                      <edit-outlined /> 编辑
                    </a-button>
                    <a-button type="link" size="small" @click="copyTemplate(record.id)">
                      <copy-outlined /> 复制
                    </a-button>
                    <a-popconfirm
                      title="确定删除该模板？"
                      ok-text="删除"
                      cancel-text="取消"
                      ok-type="danger"
                      @confirm="removeTemplate(record.id)"
                    >
                      <a-button type="link" size="small" danger>
                        <delete-outlined /> 删除
                      </a-button>
                    </a-popconfirm>
                  </a-space>
                </template>
              </template>
            </a-table>
          </a-card>
        </div>
      </div>

      <!-- ================= 编辑器 ================= -->
      <div v-else class="app-body">
        <a-page-header :title="'编辑模板 ' + currentId" @back="goList">
          <template #tags>
            <a-tag :color="currentKind === 'chart' ? 'gold' : 'blue'">
              {{ currentKind === 'chart' ? '图表' : 'Vue' }}
            </a-tag>
          </template>
          <template #subTitle>
            <a-typography-text :type="status.includes('失败') ? 'danger' : 'secondary'">
              {{ status }}
            </a-typography-text>
          </template>
          <template #extra>
            <a-space>
              <a-button @click="copyCurrent"><copy-outlined /> 复制为副本</a-button>
              <a-checkbox v-model:checked="autoRender">自动渲染（3s）</a-checkbox>
              <a-button type="primary" :loading="rendering" @click="renderPreview">
                <thunderbolt-outlined /> 渲染预览
              </a-button>
              <a-button @click="saveTemplate"><save-outlined /> 保存</a-button>
            </a-space>
          </template>
        </a-page-header>

        <div class="app-content editor-content">
          <div class="main">
            <section class="editors">
              <!-- 主编辑器：vue 为 template.vue，chart 为 render.js -->
              <a-card class="editor grow" :bordered="false" size="small">
                <template #title>
                  {{ currentKind === 'vue' ? 'template.vue' : 'render.js' }}
                  <span class="muted">
                    {{ currentKind === 'vue' ? '（Vue 模板 + unocss；用 <Chart id="..." /> 引用图表）' : '（d3 图表；返回 { main: svg }）' }}
                  </span>
                </template>
                <template #extra>
                  <a-button size="small" :loading="formatting" @click="formatMain">
                    <format-painter-outlined /> 格式化
                  </a-button>
                </template>
                <div class="editor-body">
                  <CodeEditor v-if="currentKind === 'vue'" v-model="templateVue" language="html" :theme="editorTheme" />
                  <CodeEditor v-else v-model="renderJs" language="javascript" :theme="editorTheme" />
                </div>
              </a-card>

              <!-- manifest：交互式表单 -->
              <a-card class="editor manifest-form" :bordered="false" size="small" title="manifest">
                <a-form layout="vertical" size="small" class="mform">
                  <a-form-item label="模板 ID">
                    <a-input-group compact>
                      <a-input
                        v-model:value="idDraft"
                        placeholder="字母/数字/-/_"
                        :style="{ width: 'calc(100% - 64px)' }"
                        @press-enter="renameCurrentId"
                      />
                      <a-button :disabled="!idDraft || idDraft === currentId" @click="renameCurrentId">修改</a-button>
                    </a-input-group>
                  </a-form-item>
                  <a-form-item label="名称">
                    <a-input :value="mObj.name || ''" placeholder="模板名称" @change="setField('name', $event.target.value)" />
                  </a-form-item>
                  <a-form-item label="类型">
                    <a-tag :color="currentKind === 'chart' ? 'gold' : 'blue'">
                      {{ currentKind === 'chart' ? '图表' : 'Vue 页面' }}
                    </a-tag>
                    <span class="muted">创建时固定，不可修改</span>
                  </a-form-item>
                  <div class="mform-grid">
                    <a-form-item label="宽度">
                      <a-input-number :value="mObj.width" style="width: 100%" @change="(v) => setField('width', v)" />
                    </a-form-item>
                    <a-form-item label="高度">
                      <a-input-number :value="mObj.height" style="width: 100%" @change="(v) => setField('height', v)" />
                    </a-form-item>
                    <a-form-item label="格式">
                      <a-select :value="mObj.format || 'png'" @change="(v) => setField('format', v)">
                        <a-select-option value="png">png</a-select-option>
                        <a-select-option value="svg">svg</a-select-option>
                      </a-select>
                    </a-form-item>
                     <a-form-item label="dpr">
                       <a-input-number :value="mObj.dpr" :min="1" :max="4" style="width: 100%" @change="(v) => setField('dpr', v)" />
                     </a-form-item>
                   </div>
                 </a-form>
              </a-card>

              <!-- data -->
              <a-card class="editor" :bordered="false" size="small" title="data（JSON，渲染时外部传入）">
                <template #extra>
                  <a-button size="small" :loading="formatting" @click="formatData">
                    <format-painter-outlined /> 格式化
                  </a-button>
                </template>
                <div class="editor-body">
                  <CodeEditor v-model="data" language="json" :theme="editorTheme" />
                </div>
              </a-card>
            </section>

            <section class="preview-col">
              <!-- d3 图表预览仅对 chart 模板有意义（vue 模板的图表走独立 chart 模板 + <Chart> 引用） -->
              <a-card v-if="currentKind === 'chart'" class="panel" :bordered="false" size="small">
                <template #title>
                  d3 图表预览（浏览器实时）<span class="muted">{{ d3Status }}</span>
                </template>
                <div class="d3-charts">
                  <a-empty v-if="d3Charts.length === 0" description="编辑 render.js / data 后自动预览" :image-style="{ height: '40px' }" />
                  <div v-for="c in d3Charts" :key="c.name" class="d3-item">
                    <div class="muted">槽位：{{ c.name }}</div>
                    <div v-html="c.svg"></div>
                  </div>
                </div>
              </a-card>

              <!-- 图表模板引用助手（仅 Vue 模板） -->
              <a-card v-if="currentKind === 'vue'" class="panel" :bordered="false" size="small" title="图表模板（点击插入 <Chart> 代码）">
                <div class="chart-refs">
                  <a-empty v-if="chartTemplates.length === 0" description="还没有图表模板" :image-style="{ height: '40px' }" />
                  <a-button
                    v-for="c in chartTemplates"
                    :key="c.id"
                    class="chart-ref"
                    block
                    @click="insertChartRef(c)"
                  >
                    <span>{{ c.name }}</span>
                    <a-typography-text code>{{ c.id }}</a-typography-text>
                  </a-button>
                </div>
              </a-card>

              <a-card class="panel grow" :bordered="false" size="small">
                <template #title>
                  预览
                  <span v-if="renderMs != null" class="muted">· 渲染耗时 {{ renderMs }} ms</span>
                </template>
                <a-tabs v-model:activeKey="stageTab" size="small" class="preview-tabs">
                  <a-tab-pane key="image" tab="最终图片">
                    <div class="img-wrap">
                      <img v-if="previewSrc" :src="previewSrc" alt="整体预览">
                      <a-empty v-else description="点「渲染预览」查看最终图片" />
                    </div>
                  </a-tab-pane>
                  <a-tab-pane v-if="currentKind === 'vue'" key="html" tab="HTML 阶段">
                    <div class="stage-wrap">
                      <iframe v-if="stages" class="html-frame" :srcdoc="htmlPreviewDoc"></iframe>
                      <a-empty v-else description="点「渲染预览」加载 HTML 阶段（Vue SSR + unocss 后送入 Satori）" />
                    </div>
                  </a-tab-pane>
                  <a-tab-pane v-if="currentKind === 'vue'" key="svg" tab="SVG 阶段">
                    <div class="stage-wrap">
                      <template v-if="stages">
                        <div class="stage-meta muted">{{ stagesStatus }}</div>
                        <div class="svg-box" v-html="stages.svg"></div>
                      </template>
                      <a-empty v-else description="点「渲染预览」加载 SVG 阶段（Satori 输出）" />
                    </div>
                  </a-tab-pane>
                </a-tabs>
              </a-card>
            </section>
          </div>

          <a-card class="versions" :bordered="false" size="small">
            <template #title>
              <history-outlined /> 版本历史（保存自动快照，可回滚）
            </template>
            <template #extra>
              <a-space>
                <a-button size="small" @click="snapshotNow"><reload-outlined /> 保存快照</a-button>
                <a-button v-if="versions.length" size="small" danger @click="clearAllVersions">
                  <delete-outlined /> 清空版本
                </a-button>
              </a-space>
            </template>
            <a-table
              v-if="versions.length"
              :data-source="versions"
              :columns="versionColumns"
              row-key="v"
              :pagination="false"
              size="small"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'v'">
                  <a-typography-text code>{{ record.v }}</a-typography-text>
                </template>
                <template v-else-if="column.key === 'created_at'">
                  <span class="muted">{{ formatTime(record.created_at) }}</span>
                </template>
                <template v-else-if="column.key === 'ops'">
                  <a-space>
                    <a-button size="small" @click="restoreVersion(record.v)"><undo-outlined /> 恢复</a-button>
                    <a-button size="small" danger @click="removeVersion(record.v)"><delete-outlined /> 删除</a-button>
                  </a-space>
                </template>
              </template>
            </a-table>
            <a-empty v-else description="暂无版本，保存模板后自动生成" :image-style="{ height: '40px' }" />
          </a-card>
        </div>
      </div>
    </div>
  </a-config-provider>
</template>

<style>
html, body, #app { height: 100%; }
body { margin: 0; }

.app { height: 100%; }
.app-light { --app-bg: #f5f5f5; }
.app-dark { --app-bg: #000; }
.app-body { height: 100%; display: flex; flex-direction: column; background: var(--app-bg); }
.app-content { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; }
.list-content { overflow: auto; padding: 0 24px 24px; }
.editor-content { overflow: hidden; padding: 0 16px 12px; }

.muted { color: rgba(0, 0, 0, 0.45); font-size: 12px; font-weight: 400; }
.app-dark .muted { color: rgba(255, 255, 255, 0.45); }

.main { flex: 1; min-height: 0; display: flex; gap: 12px; }
.editors { display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 1fr; gap: 12px; flex: 1.3; min-width: 0; min-height: 0; }
.editors .editor.grow { grid-row: span 2; }
.editors .ant-card { display: flex; flex-direction: column; min-height: 0; }
.editors .ant-card-body { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 10px; }
.editor-body { flex: 1; min-height: 0; display: flex; }

.preview-col { flex: 1; display: flex; flex-direction: column; gap: 12px; min-width: 0; min-height: 0; }
.panel { display: flex; flex-direction: column; }
.panel.grow { flex: 1; min-height: 0; }
.panel.grow .ant-card-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.panel .ant-card-head-title { font-size: 13px; }
.panel.grow .preview-tabs { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.panel.grow .ant-tabs-content-holder { flex: 1; min-height: 0; overflow: auto; }
.panel.grow .ant-tabs-content { height: 100%; }
.panel.grow .ant-tabs-tabpane { height: 100%; }

.d3-charts { display: flex; flex-direction: column; gap: 8px; overflow: auto; max-height: 34vh; }
.d3-item { background: #fff; border-radius: 6px; padding: 8px; }
.d3-item svg { max-width: 100%; height: auto; display: block; }

.chart-refs { display: flex; flex-direction: column; gap: 6px; max-height: 22vh; overflow: auto; }
.chart-ref { display: flex; align-items: center; justify-content: space-between; }

.img-wrap { display: flex; align-items: center; justify-content: center; overflow: auto; min-height: 140px; height: 100%; }
.img-wrap img { max-width: 100%; height: auto; border-radius: 4px; background: #fff; }
.stage-wrap { display: flex; flex-direction: column; gap: 6px; overflow: auto; min-height: 140px; height: 100%; }
.html-frame { flex: 1 1 auto; min-height: 220px; width: 100%; border: 0; border-radius: 4px; background: #fff; }
.svg-box { flex: 0 0 auto; background: #fff; border-radius: 4px; padding: 8px; }
.svg-box svg { max-width: 100%; height: auto; display: block; }

.mform .ant-form-item { margin-bottom: 10px; }
.mform-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10px; }

.versions { flex: 0 0 auto; max-height: 240px; overflow: auto; }
.app-dark .d3-item, .app-dark .svg-box, .app-dark .img-wrap img { background: #fff; }

@media (max-width: 1100px) {
  .main { flex-direction: column; overflow: auto; }
  .editors { grid-template-columns: 1fr; grid-auto-rows: auto; }
  .editors .editor.grow { grid-row: auto; }
}
</style>
