# render-service 服务化 API

> `render-service`：通过 HTTP 接收「代码文件包」，用 Satori + resvg + d3 渲染并返回图片。
> 技术栈：Bun 1.3+，无浏览器、纯 CPU、毫秒级、小体积。

---

## 1. 快速开始

```bash
cd render-service
bun install
bun src/index.ts            # 默认监听 http://127.0.0.1:8787
```

```bash
curl http://127.0.0.1:8787/health
# {"ok":true,"service":"render-service","version":"0.1.0"}
```

---

## 2. 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/` | 管理前端（模板列表/编辑/预览） |
| `GET` | `/api/templates` | 模板列表（含 ID） |
| `POST` | `/api/templates` | 创建模板 → `{id}`（body 可带 `kind: 'vue' \| 'chart'`） |
| `GET` | `/api/templates/:id` | 模板详情（files + data） |
| `PUT` | `/api/templates/:id` | 保存模板 |
| `DELETE` | `/api/templates/:id` | 删除模板 |
| `POST` | `/api/templates/:id/rename` | 修改模板 ID → `{id}`（body `{id}`；新 ID 不能重复 → `409 CONFLICT`；自动改写其他模板的 `<Chart id>` 引用） |
| `POST` | `/api/templates/:id/render` | 按模板 ID + data 渲染图片 |
| `POST` | `/api/templates/:id/stages` | 管线阶段预览：返回 `{stages:{html,svg,finalSvg,autoHeight,contentBottom,width,height}}`（HTML 阶段 / SVG 截断，编辑器调试用） |
| `GET` | `/playground` | 独立模板编辑器 |
| `GET` | `/health` | 健康检查，返回 JSON |
| `GET` | `/examples/*` | 示例代码包静态文件 |
| `POST` | `/render` | 通用代码包渲染，返回图片字节流 |

---

## 3. POST /render

### 3.1 请求

`Content-Type: application/json`

```json
{
  "files": {
    "manifest.json": "{\"schema\":1,\"width\":1200,\"height\":630,\"format\":\"png\",\"dpr\":2}",
    "template.html": "<div style=\"display:flex;...\">...</div>",
    "render.js": "import * as d3 from 'd3'; export default async function render({data}){...}"
  },
  "data": { "values": [1, 2, 3] },
  "options": { "format": "png", "width": 1200, "height": 630, "dpr": 2 }
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `files` | `Record<string, string>` | ✅ | 代码包：文件名 -> UTF-8 内容 |
| `data` | `any` | 否 | 传给 `render.js` 的业务数据 |
| `options` | object | 否 | 覆盖 manifest 的 `format`/`width`/`height`/`dpr` |

### 3.2 响应

成功：`200`，`Content-Type: image/png`（或 `image/svg+xml`），响应体即图片字节。

失败：`4xx`，JSON 错误体：

```json
{ "error": { "code": "INVALID_PACKAGE", "message": "manifest.schema 必须为 1" } }
```

| 错误码 | HTTP | 含义 |
|---|---|---|
| `BAD_REQUEST` | 400 | 请求体不是 JSON 或缺少 `files` |
| `INVALID_PACKAGE` | 422 | manifest/代码包结构非法 |
| `RENDER_FAILED` | 422 | 渲染过程失败（脚本报错、超时、缺槽位等） |
| `NOT_FOUND` | 404 | 路由不存在 |

---

## 4. 代码包结构

一个代码包 = 文件名到内容的映射，最少三个文件：

```
manifest.json    # 入口元数据（必填）
template.html    # Satori HTML/CSS 布局模板（必填，路径可配）
render.js        # d3 图表脚本（必填，路径可配）
assets/*         # 可选：字体、图片等资源
```

### 4.1 manifest.json

```json
{
  "schema": 1,
  "kind": "vue",
  "width": 1200,
  "height": 630,
  "format": "png",
  "dpr": 2,
  "template": "template.html",
  "fonts": [
    { "family": "Noto Sans SC", "path": "assets/NotoSansSC.otf", "weight": 400 }
  ],
  "charts": { "revenue": { "width": 1104, "height": 400 } }
}
```

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `schema` | `1` | 必填 | 结构版本，当前固定 1 |
| `kind` | `'vue' \| 'chart'` | `vue` | 模板类型；chart 无 Vue 模板，仅 render.js |
| `width` / `height` | int | 必填 | 最终图片尺寸（1~10000 px）；chart 的 width=0 表示按 SVG 固有尺寸自适应 |
| `format` | `'png' \| 'svg'` | `png` | 输出格式 |
| `dpr` | number | `2` | 图表槽位光栅化倍率（≤4，用于高分屏） |
| `template` | string | `template.html` | 模板文件路径（vue） |
| `fonts` | FontSpec[] | `[]` | Satori 字体；缺省用系统/`RENDER_FONTS_DIR` |
| `charts` | object | `{}` | 可选：显式指定槽位像素尺寸（覆盖占位符 style） |
| 其他键 | any | - | 透传给 `render.js` 的 `manifest` 参数 |

> 图表脚本入口固定为 `render.js`，不再通过 manifest 配置。

`FontSpec`：`{ family, path?, data?(base64), weight?(400), style?('normal'|'italic') }`（`path` 与 `data` 二选一）。

### 4.2 template.html（Satori 模板）

- 内联 `style` 写布局，语法见 [`01-satori-html-css.md`](./01-satori-html-css.md)。
- 图表占位符：`<div data-chart="槽位名" style="width:600px;height:300px"></div>`，渲染时替换为 d3 图表位图。
- 引用独立图表模板（推荐）：`<Chart id="图表模板ID" :data="..." :width="..." :height="..." />`，服务端加载该 kind=chart 模板渲染成图片注入。

### 4.3 render.js（d3 脚本契约）

```js
import * as d3 from 'd3';

export default async function render({ data, manifest }) {
  // 环境提供全局 document（linkedom）与 serializeSvg() 助手
  const svg = d3.select(document.body).append('svg')
    .attr('width', 600).attr('height', 300);
  // ... 用 d3 画图 ...
  return { revenue: serializeSvg(svg.node()) };  // 槽位名 -> svg 字符串
}
```

- default export 必须是一个函数，接收 `{ data, manifest }`。
- 返回 `{ 槽位名: svg字符串 | DOM节点 }`，槽位名与模板 `data-chart` 对应。
- 语法/用法见 [`02-d3js-reference.md`](./02-d3js-reference.md)。

---

## 5. 渲染管线（内部流程）

```
POST /render
  → 校验 + 代码包落盘（沙箱化路径，禁止 ../ 越界）
  → 子进程执行 render.js（linkedom + d3，超时可杀）
  → 每个图表槽位：d3 SVG → resvg 光栅化为 PNG(dpr 倍) → data URI
  → 模板占位符替换为 <img>，HTML → Satori 元素 → Satori 排版为 SVG
  → format=svg 直接返回 SVG；format=png 由 resvg 光栅化返回 PNG
  → 清理临时目录
```

---

## 6. 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8787` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址 |
| `RENDER_WORKDIR` | `./.render-cache` | 代码包临时落盘目录 |
| `RENDER_TIMEOUT_MS` | `10000` | `render.js` 执行超时（超时终止并重建 worker） |
| `RENDER_MAX_BODY` | `20971520`（20MB） | 请求体上限 |
| `RENDER_FONTS_DIR` | 空 | 字体目录（缺省用项目 `fonts/`；加载 `*.ttf/otf/ttc`，不扫描系统字体） |
| `TEMPLATES_DIR` | `./templates` | 模板文件存储目录（建议 Docker 卷映射持久化） |
| `RENDER_WORKERS` | `2` | 常驻 render.js worker 并发数 |
| `RENDER_WORKER_MAX_JOBS` | `500` | 每个 worker 处理多少任务后回收（限制模块缓存增长） |
| `RENDER_WORKER_IDLE_MS` | `60000` | 热生存时限：空闲超过该毫秒数的 worker 被回收（0 = 不回收） |
| `RENDER_CACHE_DIR` | `./.render-cache/results` | 结果缓存目录（key = data + 模板文件内容 md5） |
| `RENDER_CACHE_TTL_MS` | `86400000`（24h） | 缓存有效期，超时视为失效并删除（`0` = 不过期） |
| `RENDER_CACHE_MAX` | `500` | 缓存条数上限，超过按写入时间滚动淘汰最旧条目（`0` = 不限条数） |

---

## 7. 安全模型（v1）

- 用户脚本在**独立子进程**运行，超时强制 `kill`，崩溃/死循环不拖垮主服务。
- 代码包文件路径做沙箱化：拒绝绝对路径与 `..` 越界。
- 请求体大小受限（默认 20MB）。
- 每个请求用独立临时目录，结束即清理。
- ⚠️ 注意：v1 **未做**网络/文件系统级隔离（脚本仍可 `fetch`、读同机文件）。若脚本不可信，请额外加容器/沙箱（如 gVisor、NSJail、Docker 只读卷）。

---

## 8. 完整示例

见 [`examples/bar-chart/`](../examples/bar-chart/)（柱状图）与 [`examples/line-chart/`](../examples/line-chart/)（折线+面积图），均为 manifest + template + render.js 三件套。

```bash
# 用示例代码包跑一次
bun test/integration.ts          # 直接走管线，产出 test/output.png

# 或起服务后 HTTP 调用
bun src/index.ts &
curl -X POST http://127.0.0.1:8787/render \
  -H 'Content-Type: application/json' \
  --data-binary @test/request.json \
  -o out.png
```
