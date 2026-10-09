# render-service

![CI](https://github.com/a876691666/fastcap/actions/workflows/ci.yml/badge.svg)

**Satori + resvg + d3 图片渲染服务**（Bun）。模板用 **Vue 模板 + unocss className** 编写，服务端渲染成 HTML → Satori → SVG → resvg → PNG。含**所见即所得模板管理界面**（列表 / 编辑器实时预览 / 文件存储），调用端用「模板 ID + data」API 渲染图片。

- **无浏览器、纯 CPU、毫秒级、小体积**（Bun + 少量 npm 包，无 Chromium）
- 运行栈：Bun 1.3+ / Vue 3 SSR / UnoCSS / Satori 0.29（HTML/CSS → SVG）/ resvg-js 2.6（SVG → PNG）/ d3 7.9（图表）

## 快速开始

```bash
# 后端
bun install
bun src/index.ts                  # http://127.0.0.1:8787

# 管理前端（Vue3+Vite，一次性构建）
cd frontend && bun install && bun run build
```

打开 `http://127.0.0.1:8787/` 进入**模板管理界面**（Vue3 + Ant Design Vue 4 + Monaco 代码编辑器，主题跟随系统深浅色）：

1. **列表**：每个模板有独立 ID；可创建 / 复制 / 删除。
2. **编辑**：Monaco 编辑器改 `template.vue`（Vue）/ `render.js`（d3）/ `manifest.json` / `data`；**d3 图表由浏览器实时预览**（编辑即刷新），**整体图片预览**走服务端渲染；保存自动生成**版本快照**，可随时回滚。
3. **调用端**：`POST /api/templates/:id/render` 传 `{data}` → 得图片。

## 模板 = 文件（Docker 卷持久化）

模板存储在 `TEMPLATES_DIR/<id>/`（默认 `./templates/`），分两类（`manifest.kind`）：

```
# Vue 页面模板（kind=vue，默认）
templates/<id>/
├── manifest.json    # kind/width/height/format/name 等
├── template.vue     # Vue 模板：{{ data.xxx }} / v-for / unocss className
└── data.json        # 预览默认数据

# 图表模板（kind=chart，独立、无 Vue）
templates/<id>/
├── manifest.json    # kind=chart，width=0 表示按 SVG 固有尺寸自适应
├── render.js        # d3 图表脚本：返回 { main: svg }
└── data.json
```

Docker 运行（**模板目录用卷映射，保证持久化**）：

```bash
./docker-build.sh
docker run -d --name render-service -p 8787:8787 \
  -v $(pwd)/templates:/app/templates \    # 模板持久化（核心）
  -v $(pwd)/fonts:/app/fonts              # CJK 字体
  render-service:latest
```

## 模板写法（Vue + unocss）

```html
<!-- template.vue：外部 data 绑定 + unocss className -->
<div class="flex flex-col p-6 bg-white" style="width:800px;font-family:Noto Sans SC">
  <div class="text-3xl font-bold text-slate-900">{{ data.title }}</div>
  <div v-for="item in data.items" :key="item.name" class="flex flex-row items-center text-sm">
    <div class="w-20">{{ item.name }}</div>
    <div class="h-3 rounded bg-sky-400" :style="{ width: item.value * 20 + 'px' }"></div>
  </div>
  <!-- 引用独立的图表模板（服务端渲染成图片注入） -->
  <Chart id="<图表模板ID>" :data="data.chart" :width="600" :height="300" />
</div>
```

- **Vue**：模板里的 `{{ data.xxx }}` / `v-for` / `v-if` 由 Vue SSR 渲染成 HTML。
- **unocss**：`className`（如 `flex`、`text-slate-900`、`w-20`）服务端转成内联 `style`，与元素原有 `style` 合并，**unocss 低优先级**（原有 style 覆盖）。
- **图表**：d3 图表已从 Vue 模板**分离为独立「图表模板」**（kind=chart，仅 `manifest.json` + `render.js`，无 Vue）。Vue 模板用内置组件 `<Chart id="图表模板ID" :data="..." />` 引用，服务端跑该图表模板的 `render.js` → 光栅化为图片注入。`:width/:height` 可选。图表模板也可通过 `/api/templates/:id/render` **单独渲染成图片**。
- `data` 为调用端每次传入的数据。

## 目录结构

```
render-service/
├── src/
│   ├── index.ts                 # HTTP 服务（前端/模板 API/渲染/示例）
│   ├── editor.html              # 独立模板编辑器（/playground，单文件）
│   ├── templates.ts             # 模板文件存储 + CRUD + 按 ID 渲染
│   ├── render/
│   │   ├── pipeline.ts          # 主渲染管线（Vue SSR → unocss → Satori → resvg）
│   │   ├── vue.ts               # Vue SSR：模板 + data → HTML
│   │   ├── unocss.ts            # unocss className → 内联 style（低优先级合并）
│   │   ├── html.ts / manifest.ts / fonts.ts / resvg.ts / execute.ts / pkg.ts / types.ts
│   └── worker/run-render.ts     # 子进程执行 render.js（linkedom + d3）
├── frontend/                    # 管理前端（Vue3+Vite）→ dist 由服务托管
├── templates/                   # 模板文件存储（TEMPLATES_DIR，可卷映射）
├── examples/                    # bar-chart / line-chart / vl 示例
├── samples/                     # 可直接 POST 的样板模板包（{files,data}）
├── docs/                        # 知识文档
└── test/                        # smoke/html/unocss/integration/http/contract/vue/templates
```

## API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/` | 管理前端（列表/编辑/预览） |
| `GET` | `/api/templates` | 模板列表（含 ID） |
| `POST` | `/api/templates` | 创建模板 → `{id}` |
| `GET` | `/api/templates/:id` | 模板详情（files + data） |
| `PUT` | `/api/templates/:id` | 保存模板（files/data） |
| `DELETE` | `/api/templates/:id` | 删除模板 |
| `POST` | `/api/templates/:id/copy` | 复制模板 → 新 `{id}` |
| `GET` | `/api/templates/:id/versions` | 版本列表（保存自动快照） |
| `POST` | `/api/templates/:id/versions` | 手动保存版本快照 |
| `GET` | `/api/templates/:id/versions/:v` | 读取某版本文件 |
| `POST` | `/api/templates/:id/restore/:v` | 恢复某版本（先快照当前） |
| `POST` | `/api/templates/:id/render` | **按模板 ID + data 渲染图片（调用端入口）** |
| `POST` | `/api/templates/:id/stages` | 管线阶段预览（HTML 阶段 / SVG 截断，编辑器调试） |
| `GET` | `/playground` | 独立模板编辑器 |
| `POST` | `/render` | 通用代码包渲染（无 ID） |
| `GET` | `/health` | 健康检查 |

## 测试

```bash
bun run test                     # 全量：smoke/html/unocss/integration/http/contract/vue/templates
bun test/vl.ts                   # vl 图表（需 RENDER_FONTS_DIR 字体）
```

手工验证：

```bash
# 创建模板 → 拿 id
curl -X POST http://127.0.0.1:8787/api/templates -H 'Content-Type: application/json' -d '{"name":"我的模板"}'
# 按 ID + data 渲染
curl -X POST http://127.0.0.1:8787/api/templates/<id>/render \
  -H 'Content-Type: application/json' -d '{"data":{"title":"你好"}}' -o out.png
```

样板：`samples/bar-chart.json` / `line-chart.json` / `vl.json`（`{files,data}` 可直接 POST `/render`）。

## 环境变量

`PORT` `HOST` `RENDER_WORKDIR` `RENDER_TIMEOUT_MS` `RENDER_MAX_BODY` `RENDER_FONTS_DIR` `TEMPLATES_DIR` `RENDER_WORKERS` `RENDER_WORKER_MAX_JOBS` `RENDER_WORKER_IDLE_MS` —— 见 [API 文档](docs/04-service-api.md)。

## 部署与接入

```bash
./docker-build.sh                 # 封包：构建镜像 + 生成 release/（镜像包+compose+deploy.sh）
# 上传 release/ 到服务器后: cd release && ./deploy.sh
```

可快速接入**任意服务**的部署（Docker sidecar / 同机独立运行），详见 [`docs/06-deploy.md`](docs/06-deploy.md)。

## 文档索引

| 文档 | 内容 |
|---|---|
| [01-satori-html-css](docs/01-satori-html-css.md) | Satori HTML/CSS 语法规范 |
| [02-d3js-reference](docs/02-d3js-reference.md) | d3 精选权威参考 |
| [03-observable-top-100-charts](docs/03-observable-top-100-charts.md) | ObservableHQ 最热 100 图表 |
| [04-service-api](docs/04-service-api.md) | 服务化 API（含模板 API） |
| [05-contract](docs/05-contract.md) | HTTP 契约唯一权威（含 Vue 模板/模板 API） |

## 已知限制

- Satori 是 Flexbox 子集，非完整 CSS（见文档 01）。
- 图表槽位以位图 PNG 内嵌；Satori 原生支持内联 `<svg>`，纯矢量注入留作增强。
- 脚本隔离为进程级（超时/崩溃隔离），未做网络与文件系统级沙箱。
- unocss 仅支持静态工具类（变体 `hover:`/`md:` 不生效，SSR 无交互）。
