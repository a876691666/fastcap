# 部署与接入指南（通用截图渲染服务）

render-service 是一个**自包含的截图渲染服务**（Satori + resvg + d3，模板用 Vue + unocss），可以快速接入**任意服务**的部署：Docker sidecar 或同机独立运行，宿主服务通过 HTTP 调用渲染。

流程一句话：**封包 → 上传 → 部署 → 宿主服务配置 URL → 调用渲染**。

---

## 1. 封包（本机一次）

```bash
cd render-service
./docker-build.sh                 # 默认产出 release/ 目录
# FONTS_DIR=/path/to/fonts ./docker-build.sh   # 自定义字体目录
```

产出 `release/`（与 eve-mission-rust 同款分发模型）：

```
release/
├── render-service-amd64.tar.gz   # 镜像包（docker load 载入）
├── docker-compose.yml            # 独立部署编排
├── deploy.sh                     # 一键部署
├── templates/                    # 模板持久化目录（卷映射，不随容器丢失）
├── fonts/                        # CJK 字体（卷映射）
└── README.md
```

> 也可不封包直接跑：`bun install && bun src/index.ts`（开发/内网直跑）。

## 2. 部署（服务器）

```bash
# 上传整个 release/ 到服务器后
cd release && ./deploy.sh         # docker load 镜像 + compose up
# 访问 http://<host>:8787/  模板管理界面
```

## 3. 接入任意服务（三选一）

**A. Docker sidecar（同 compose，推荐）** —— 在宿主项目的 `docker-compose.yml` 加一段：

```yaml
services:
  render-service:
    image: render-service:amd64          # 先 docker load -i render-service-amd64.tar.gz
    container_name: render-service
    environment:
      PORT: "8787"
      TEMPLATES_DIR: /app/templates
      RENDER_FONTS_DIR: /app/fonts
    volumes:
      - ./templates:/app/templates       # 模板持久化
      - ./fonts:/app/fonts
    restart: unless-stopped
    # ports: ["8787:8787"]               # 同网络内用服务名即可，无需暴露端口
```

同 compose 网络内，宿主服务用 **`http://render-service:8787`** 调用。

**B. 同机独立运行** —— 直接跑 `release/deploy.sh`（占用 8787 端口），宿主服务把地址配成 `http://127.0.0.1:8787`。

**C. 任意语言/服务** —— 只需要 HTTP：任意后端（Go/Rust/Node/Python…）配置一个 URL 即可。

## 4. 调用渲染

| 接口 | 用途 | 请求 |
|---|---|---|
| `POST /render` | 通用代码包渲染 | `{files:{manifest.json,template.html/template.vue,render.js}, data}` |
| `POST /api/templates/:id/render` | 按模板 ID + data 渲染（推荐） | `{data, options?}` |
| `GET /api/templates` | 模板列表 | - |
| `POST /api/templates` | 创建模板 → `{id}` | `{name, files?, data?}` |

模板管理界面 `http://<host>:8787/` 可在线编辑/预览/保存模板（Monaco 编辑器 + d3 浏览器预览 + 版本回滚）。

宿主服务接入示例（配置一个环境变量即可）：

```
RENDER_SERVICE_URL=http://render-service:8787   # 或 http://127.0.0.1:8787
```

## 5. 运维要点

- **模板持久化**：`templates/` 是宿主机目录（卷映射），备份/迁移 = 拷目录；模板内含版本快照。
- **字体**：`fonts/` 放 CJK 字体（Noto 等），`RENDER_FONTS_DIR=/app/fonts`。
- **端口**：默认 8787，`PORT` 可改。
- **更新**：新镜像 `docker load` + `docker compose up -d`；配置/模板/字体热改（卷映射，无需重建）。
- **体积**：无 Chromium，纯 CPU；Bun 运行时 + 少量 npm 包（含 Monaco 管理界面）。
