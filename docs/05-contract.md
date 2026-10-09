# render-service 契约（Contract）

> 这是 render-service 的**唯一权威 HTTP 契约**，供 Rust 客户端、任何第三方实现、以及 render-service 自身测试对齐。
> 实现一致性由 `test/contract.ts` + `test/http.ts` 固化；本文档是语义权威。

---

## 1. 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/` | 管理前端（模板列表/编辑/预览） |
| `GET` | `/api/templates` | 模板列表（含 ID） |
| `POST` | `/api/templates` | 创建模板 → `{id}` |
| `GET` | `/api/templates/:id` | 模板详情（files + data） |
| `PUT` | `/api/templates/:id` | 保存模板 |
| `DELETE` | `/api/templates/:id` | 删除模板 |
| `POST` | `/api/templates/:id/copy` | 复制模板 → 新 `{id}`（名称加「（副本）」） |
| `POST` | `/api/templates/:id/rename` | 修改模板 ID → `{id}`（body `{id}`；重复 → `409 CONFLICT`；自动改写其他模板的 `<Chart id>` 引用） |
| `GET` | `/api/templates/:id/versions` | 版本列表（保存自动快照） |
| `POST` | `/api/templates/:id/versions` | 手动保存版本快照 |
| `GET` | `/api/templates/:id/versions/:v` | 读取某版本文件 |
| `POST` | `/api/templates/:id/restore/:v` | 恢复某版本（先快照当前） |
| `POST` | `/api/templates/:id/render` | **按模板 ID + data 渲染图片** |
| `GET` | `/playground` | 独立模板编辑器 |
| `GET` | `/health` | 健康检查 |
| `GET` | `/examples/*` | 示例代码包静态文件 |
| `POST` | `/render` | 通用代码包渲染（无 ID） |

---

## 2. 请求体（JSON）

```json
{
  "files": {
    "manifest.json": "{\"schema\":1,...}",
    "template.html": "<div ...>...</div>",
    "render.js": "export default async function render({data}){...}"
  },
  "data": { "任意业务数据": "..." },
  "options": { "format": "png", "width": 800, "height": 0, "dpr": 2 }
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `files` | `Record<string, string>` | ✅ | 代码包：文件名 → UTF-8 内容 |
| `files["manifest.json"]` | string | ✅ | manifest（见 §3） |
| `data` | any | 否 | 透传给 `render.js` 的 `data` 参数 |
| `options` | object | 否 | 覆盖 manifest 的 `format/width/height/dpr` |

---

## 3. manifest.json schema

```json
{
  "schema": 1,
  "kind": "vue",
  "width": 800,
  "height": 0,
  "format": "png",
  "dpr": 2,
  "template": "template.html",
  "fonts": [{ "family": "Noto Sans SC", "path": "assets/x.otf", "weight": 700 }],
  "charts": { "slot1": { "width": 600, "height": 300 } }
}
```

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `schema` | `1` | 必填 | 结构版本，当前固定 1 |
| `kind` | `'vue' \| 'chart'` | `vue` | 模板类型（vue 页面 / chart 图表） |
| `width` | int | 必填 | 图片宽度（vue：1~10000；chart：0=按 SVG 自适应） |
| `height` | int | `0` | 图片高度；**`0` 或缺省 = auto（按内容裁切 / chart 按 SVG 自适应）**，否则 1~10000 |
| `format` | `'png' \| 'svg'` | `png` | 输出格式 |
| `dpr` | number | `2` | 图表槽位光栅化倍率（≤4） |
| `template` | string | `template.html` | 模板文件路径（vue） |
| `fonts` | FontSpec[] | `[]` | Satori 字体；缺省用 `RENDER_FONTS_DIR`/系统字体 |
| `charts` | object | `{}` | 显式槽位尺寸（可选） |

> 图表脚本入口固定为 `render.js`，不再通过 manifest 配置。

`FontSpec`：`{ family, path?, data?(base64), weight?(400), style?('normal'|'italic') }`，`path` 与 `data` 二选一。
`data`（base64）字体会落盘到包内临时文件并回传给 resvg，保证 d3 SVG 内文字可渲染。

---

## 4. 模板（template.html）约定

- Satori HTML 子集 + 内联 `style`；语法见 [`01-satori-html-css.md`](./01-satori-html-css.md)。
- 图表占位符：`<div data-chart="槽位名" [style="..."]></div>`。渲染时替换为对应 d3 SVG 光栅化后的 `<img>`，占位符自身的 `style`（除 width/height 外）会保留。
- **auto-height 时**：模板根元素不要写 `height:100%`（否则会撑满画布，无法按内容收缩）。

---

## 5. render.js 契约

- 必须 `export default` 一个**函数**：`async ({ data, manifest }) => ({ [槽位名]: svg字符串 | DOM节点 })`。
- `manifest.width` / `manifest.height` 会作为画布尺寸传入，可按目标尺寸绘制；chart 模板被 `<Chart :width/:height>` 引用时，这两值即组件尺寸（否则用 chart 模板 manifest 的值，0 表示自适应）。
- 环境提供全局 `document`（linkedom）与 `serializeSvg(node)` 助手（自动补 `xmlns`）。
- 返回的 SVG **必须自带 `width`/`height`（和/或 `viewBox`）**——这些尺寸会被用作槽位尺寸（见 §6）。
- 槽位名必须与模板 `data-chart="..."` 一一对应；缺失会报 `RENDER_FAILED`。
- 语法/用法见 [`02-d3js-reference.md`](./02-d3js-reference.md)。

---

## 6. 尺寸语义（auto-height / intrinsic）

- **槽位尺寸优先级**：`manifest.charts[name]` 显式值 > 模板占位符 `style` 里的 width/height > **chart SVG 固有尺寸**（render.js 返回的 SVG 的 width/height）。
- **总高度**：`manifest.height` 非 0 时用固定高度；为 0（auto）时用 Satori 测量内容高度后裁切。
- 因此客户端（如 Rust）**无需计算任何像素尺寸**：尺寸全部由 render.js 的 SVG 决定，render-service 自动测量/裁切。

---

## 7. 响应与错误

成功：`200`，`Content-Type: image/png`（或 `image/svg+xml; charset=utf-8`），响应体即图片字节。

失败：JSON 错误体 `{ "error": { "code": "...", "message": "..." } }`：

| HTTP | code | 触发 |
|---|---|---|
| 400 | `BAD_REQUEST` | 请求体不是 JSON，或缺少 `files` |
| 404 | `NOT_FOUND` | 路由不存在 |
| 422 | `INVALID_PACKAGE` | manifest/代码包结构非法（schema、尺寸、缺文件等） |
| 422 | `RENDER_FAILED` | 渲染失败（render.js 报错/超时/缺槽位/未配字体等） |

---

## 8. 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8787` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址 |
| `RENDER_WORKDIR` | `./.render-cache` | 代码包临时落盘目录 |
| `RENDER_TIMEOUT_MS` | `10000` | render.js 执行超时（常驻 worker，超时终止并重建） |
| `RENDER_MAX_BODY` | `20971520` | 请求体上限 |
| `RENDER_FONTS_DIR` | 空 | 默认字体目录（Satori 与 resvg 共用；缺省 manifest.fonts 时启用） |
| `TEMPLATES_DIR` | `./templates` | 模板文件存储目录（建议 Docker 卷映射持久化） |

---

## 9. 契约测试

- `test/http.ts`：端点、成功渲染、`BAD_REQUEST`、`INVALID_PACKAGE`。
- `test/contract.ts`：manifest schema 校验、render.js 契约错误、auto-height、错误码。
- `test/templates.ts`：模板 CRUD + 按 ID 渲染 + 404。
- `test/vue.ts`：Vue 模板 SSR + unocss + d3 槽位 + auto-height。
- `test/unocss.ts`：className → 内联 style + 低优先级合并。

---

## 10. 模板管理 API

模板以文件存储于 `TEMPLATES_DIR/<id>/`，分两类（`manifest.kind`）：

- **vue（默认）**：`manifest.json` / `template.vue` / `data.json`（`render.js` 可选，仅旧版 `data-chart` 槽位用）。
- **chart**：`manifest.json` / `render.js` / `data.json`（无 Vue；`render.js` 返回 `{ main: svg }`）。

- `POST /api/templates` body：`{ name?, kind?('vue'|'chart'), files?{manifest.json,template.vue,render.js}, data? }` → `{ id, ok }`。
- `PUT /api/templates/:id` body：`{ name?, files?, data? }` → `{ ok }`。
- `POST /api/templates/:id/rename` body：`{ id }` → `{ id, ok }`。ID 为模板目录名，改 ID 即目录改名；新 ID 已存在 → `409 CONFLICT`，非法字符 → `404`（当作不存在处理）；改名后其他模板中指向它的 `<Chart id="...">` 会被自动改写。
- `POST /api/templates/:id/render` body：`{ data?, options? }` → 图片字节（`data` 缺省用模板 `data.json`）。vue 走完整管线，chart 直接跑 render.js 出图。
- `POST /api/templates/:id/stages` body：`{ data?, options? }` → `{ ok, stages:{ html, svg, finalSvg, autoHeight, contentBottom, width, height } }`（管线阶段调试：`html` 为送入 Satori 的 HTML；`svg` 为 Satori 原始输出；`finalSvg` 为 auto-height 截断后结果）。chart 模板的 `html` 为空，`svg` 即图表 SVG。
- 错误：模板不存在 → `404 NOT_FOUND`；manifest 非法 → `422 INVALID_PACKAGE`；渲染失败（含引用的图表模板不存在/非 chart）→ `422 RENDER_FAILED`。

## 11. Vue 模板契约

模板的 HTML 部分用 **Vue 模板字符串**（`template.vue`）：

- 外部数据通过 `data` 暴露：`{{ data.title }}`、`v-for="item in data.items"`、`v-if` 等。
- CSS 用 **unocss className**（如 `flex text-slate-900 w-20`），服务端转成内联 `style`，与元素原有 `style` **合并（unocss 低优先级，原有 style 覆盖）**。
- **引用了图表模板（推荐）**：内置全局组件 `<Chart id="图表模板ID" :data="..." :width="..." :height="..." />`。Vue SSR 阶段输出占位 `data-chart-ref`；管线加载该 chart 模板、以其 `render.js`（传入 `:data`）出 SVG → 光栅化为 `<img>` 注入。`:width/:height` 缺省时用 chart 模板 `manifest` / SVG 固有尺寸。
- 旧版 d3 槽位（可选，兼容）：`<div data-chart="槽位名"></div>`，由本模板 `render.js` 产出同名 SVG 替换为位图。
- 尺寸：`manifest.height=0` 自动高度；槽位尺寸取 chart SVG 固有尺寸。
- 服务端流程：`template.vue + data → Vue SSR（含 <Chart> 占位）→ HTML → unocss 内联 → 解析 <Chart> 组件（加载 chart 模板出图）→ Satori → resvg → PNG`。
