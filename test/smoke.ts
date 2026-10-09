/**
 * 冒烟测试：验证 Satori（含 native yoga-layout）+ resvg-js（native NAPI）+ d3 在 Bun 下可用。
 * 不用 satori-html，直接用 React-elements-like 对象。
 * 运行：bun test/smoke.ts
 */
import { join } from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import * as d3 from 'd3';

// 用仓库内置字体（跨平台，避免依赖 macOS 系统字体路径）
const fontData = await Bun.file(join(import.meta.dir, '..', 'fonts', 'NotoSans-Regular.ttf')).arrayBuffer();

// 1) satori 渲染纯对象元素 -> SVG
const svg = await satori(
  {
    type: 'div',
    props: {
      children: 'Hello Satori + d3',
      style: {
        display: 'flex',
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 32,
        color: '#111',
        backgroundColor: '#fff',
      },
    },
  },
  {
    width: 600,
    height: 400,
    fonts: [{ name: 'Arial', data: fontData, weight: 400, style: 'normal' }],
  },
);
console.log('satori svg length:', svg.length);

// 2) d3 生成折线 SVG -> resvg -> PNG
const data = [1, 3, 2, 5, 4];
const x = d3.scaleLinear().domain([0, data.length - 1]).range([10, 390]);
const y = d3.scaleLinear().domain([0, d3.max(data)!]).range([290, 10]);
const line = d3
  .line<number>()
  .x((_, i) => x(i))
  .y((d) => y(d));
const chartSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><path d="${line(data)}" stroke="#e11d48" fill="none" stroke-width="2"/></svg>`;
const chartResvg = new Resvg(chartSvg, { font: { loadSystemFonts: true } });
const chartPng = chartResvg.render().asPng();
console.log('chart png bytes:', chartPng.length);

// 3) 最终整页 SVG -> PNG
const fullResvg = new Resvg(svg, { font: { loadSystemFonts: true } });
const fullPng = fullResvg.render().asPng();
console.log('full png bytes:', fullPng.length);

console.log('SMOKE_OK');
