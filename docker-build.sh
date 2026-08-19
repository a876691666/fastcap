#!/bin/bash
# ============================================================
# render-service 通用封包脚本
#
# 产出 release/ 目录（与 eve-mission-rust 同款分发模型），可快速接入任意服务的部署：
#   release/<IMAGE>-<TAG>.tar.gz   镜像包（docker load 载入）
#   release/docker-compose.yml     独立部署编排（模板/字体卷映射持久化）
#   release/deploy.sh              一键部署
#   release/templates/             模板持久化目录（卷映射）
#   release/fonts/                 CJK 字体（卷映射）
#
# 用法:
#   ./docker-build.sh [镜像名] [标签]
#   FONTS_DIR=/path/to/fonts ./docker-build.sh   # 指定字体来源
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

IMAGE="${1:-render-service}"
TAG="${2:-amd64}"
FULL="${IMAGE}:${TAG}"
PACKAGE="${IMAGE}-${TAG}.tar.gz"
RELEASE="release"
FONTS_DIR="${FONTS_DIR:-fonts}"

echo "=============================================="
echo "1/3 构建镜像 ${FULL} ..."
echo "=============================================="
docker build -t "${FULL}" .

echo ""
echo "=============================================="
echo "2/3 导出镜像包 + 生成部署目录 ..."
echo "=============================================="
rm -rf "$RELEASE"
mkdir -p "$RELEASE/templates" "$RELEASE/fonts"

docker save "${FULL}" | gzip > "${RELEASE}/${PACKAGE}"

# 字体（含 CJK 的模板需要；默认取本项目 fonts/，可用 FONTS_DIR 覆盖）
if [ -d "$FONTS_DIR" ] && [ -n "$(ls -A "$FONTS_DIR" 2>/dev/null)" ]; then
  cp -r "$FONTS_DIR/." "$RELEASE/fonts/"
fi

# 独立部署编排（模板/字体由宿主机卷映射，重建容器不丢）
cat > "$RELEASE/docker-compose.yml" <<EOF
services:
  render-service:
    image: ${FULL}
    container_name: render-service
    platform: linux/amd64
    environment:
      HOST: "0.0.0.0"
      PORT: "8787"
      TEMPLATES_DIR: /app/templates
      RENDER_FONTS_DIR: /app/fonts
    volumes:
      - ./templates:/app/templates
      - ./fonts:/app/fonts
    ports:
      - "8787:8787"
    restart: unless-stopped
EOF

# 一键部署脚本
cat > "$RELEASE/deploy.sh" <<'EOF'
#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

IMAGE="__IMAGE__"
PACKAGE="__PACKAGE__"

mkdir -p templates fonts
chown 10001:10001 templates 2>/dev/null || echo "警告: 无法 chown templates，如权限报错请手动 chown -R 10001:10001 templates"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "加载镜像包 ${PACKAGE} ..."
  docker load -i "${PACKAGE}"
fi

docker compose up -d
echo "render-service 已部署: http://<host>:8787/ （模板管理界面）"
echo "渲染 API: POST http://<host>:8787/render  (通用代码包) / /api/templates/:id/render (模板 ID + data)"
echo "查看日志: docker compose logs -f"
EOF
sed -i '' -e "s|__IMAGE__|${FULL}|g" -e "s|__PACKAGE__|${PACKAGE}|g" "$RELEASE/deploy.sh"
chmod +x "$RELEASE/deploy.sh"

# 部署说明
cat > "$RELEASE/README.md" <<'EOF'
# render-service 部署包（截图渲染服务）

通用截图渲染服务：Satori + resvg + d3，模板用 Vue + unocss 编写，提供模板管理界面 + 渲染 API。
可快速接入**任何**服务的部署（Docker sidecar 或同机独立运行）。

## 目录
- `render-service-amd64.tar.gz`  镜像包（docker load 载入）
- `docker-compose.yml`           独立部署编排（模板/字体卷映射，持久化）
- `templates/`                   模板持久化目录（挂载到容器 /app/templates，不随容器丢失）
- `fonts/`                       CJK 字体（挂载到容器 /app/fonts）
- `deploy.sh`                    一键部署（load 镜像 + compose up）

## 部署
```bash
./deploy.sh
```
访问 http://<host>:8787/ 进入模板管理界面。

## 接入其他服务（sidecar）
在任意项目的 docker-compose.yml 里加一段即可（或直接把本 release 的 compose 合并进去）：

```yaml
services:
  render-service:
    image: render-service:amd64          # 先 docker load -i render-service-amd64.tar.gz
    container_name: render-service
    environment:
      HOST: "0.0.0.0"
      PORT: "8787"
      TEMPLATES_DIR: /app/templates
      RENDER_FONTS_DIR: /app/fonts
    volumes:
      - ./templates:/app/templates
      - ./fonts:/app/fonts
    # ports: ["8787:8787"]               # 同 compose 网络内可省略，用服务名访问
    restart: unless-stopped
```

同一 compose 网络内，宿主服务用 `http://render-service:8787` 调用：
- `POST /render`：通用代码包渲染 `{files, data}`
- `POST /api/templates/:id/render`：按模板 ID + data 渲染图片
- 把该地址写进宿主服务的配置（如 `render.service_url`）。

## 数据持久化
- `templates/`：模板文件（含版本快照），宿主机目录映射，备份/迁移只需拷目录。
- `fonts/`：字体文件。
EOF

echo ""
echo "=============================================="
echo "3/3 完成: ${RELEASE}/"
echo "  镜像包:   ${RELEASE}/${PACKAGE}"
echo "  部署编排: ${RELEASE}/docker-compose.yml"
echo "  部署脚本: ${RELEASE}/deploy.sh"
echo "  上传整个 ${RELEASE} 目录到服务器后执行 ./deploy.sh"
echo "=============================================="
