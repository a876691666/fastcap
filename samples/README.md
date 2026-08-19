# 样板模板包（samples）

这里是**可直接 POST 的模板包**（格式就是 `POST /render` 的请求体 `{ files, data }`），供快速测试与业务对接参考。

| 文件 | 内容 | 说明 |
|---|---|---|
| `bar-chart.json` | 柱状图 | 最简入门：`manifest + template + render.js + data` |
| `line-chart.json` | 折线+面积图（时间序列） | 展示 `scaleTime`/`area`/渐变 |
| `vl.json` | 任务图形总览（双卡片） | 生产真实图表：堆叠状态条 + 用户条形；`height:0` 自动高度；**需 CJK 字体** |

## 渲染一条命令

```bash
# bar-chart / line-chart（macOS 系统字体即可，无需 RENDER_FONTS_DIR）
curl -X POST http://127.0.0.1:8787/render \
  -H 'Content-Type: application/json' \
  --data-binary @samples/bar-chart.json \
  -o bar-chart.png

# vl（含中文，需 render-service 启动时带 RENDER_FONTS_DIR）
RENDER_FONTS_DIR=/path/to/noto-fonts bun src/index.ts
curl -X POST http://127.0.0.1:8787/render \
  -H 'Content-Type: application/json' \
  --data-binary @samples/vl.json \
  -o vl.png
```

## 业务方怎么用（小范围修改）

1. 打开 `http://<render-service>/`（模板编辑器）→ 加载示例 → 微调 → **导出模板包**。
2. 导出的 `template-package.json` 与本目录样板同构：`{ files, data }`。
3. **改 `data`**（数值/文案/颜色）→ 原样 POST `/render` 即可出新图，无需改模板。

## 注意

- 样板由 `examples/` 派生，改 `examples/` 后可用编辑器重新导出（`samples/` 为快照）。
- 含中文的模板（`vl.json`）依赖 render-service 的 `RENDER_FONTS_DIR` 或系统 CJK 字体，否则中文显示为方块。
