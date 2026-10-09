# ---------- 构建前端（Vue3 + Vite） ----------
FROM oven/bun:1-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/bun.lock ./
RUN bun install
COPY frontend/ ./
RUN bun run build

# ---------- 运行时 ----------
FROM oven/bun:1-alpine
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --production

COPY src ./src
COPY --from=frontend /app/frontend/dist ./frontend/dist
COPY examples ./examples
COPY samples ./samples
COPY fonts ./fonts
COPY docs ./docs

# 模板以文件存储于 TEMPLATES_DIR，通过 Docker 卷映射持久化（宿主机 -v 挂载）
ENV TEMPLATES_DIR=/app/templates
# 默认字体目录（Noto 等 CJK 字体放这里，供 Satori + resvg 使用）
ENV RENDER_FONTS_DIR=/app/fonts
# 容器内必须监听所有网卡（0.0.0.0），否则 Docker 端口映射连不上（默认 127.0.0.1 只绑回环）
ENV HOST=0.0.0.0
ENV PORT=8787
RUN mkdir -p /app/templates
VOLUME /app/templates

EXPOSE 8787
CMD ["bun", "src/index.ts"]
