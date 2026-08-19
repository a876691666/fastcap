/**
 * Vue 模板 SSR 管线测试：template.vue 用 {{ data.xxx }} / v-for 绑定外部数据，
 * 含一个 data-chart 槽位（d3 render.js 产出 SVG），auto-height 出 PNG。
 * 运行：RENDER_FONTS_DIR=<noto> bun test/vue.ts（系统 CJK 字体也可，模板用 Arial Unicode MS 兜底）
 */
import { join } from 'node:path';
import { renderPackage } from '../src/render/pipeline';

const TEMPLATE_VUE = `
<div class="flex flex-col bg-white p-6" style="width:600px;font-family:Arial Unicode MS, Arial">
  <div class="text-3xl font-bold text-slate-900">{{ data.title }}</div>
  <div class="text-sm text-slate-400 mt-1">{{ data.subtitle }}</div>
  <div data-chart="bars" class="mt-3"></div>
  <div class="flex flex-col mt-4 gap-1.5">
    <div v-for="item in data.items" :key="item.name" class="flex flex-row items-center text-sm">
      <div class="w-20 text-slate-700">{{ item.name }}</div>
      <div class="h-3.5 rounded bg-sky-400" :style="{ width: (item.value * 20) + 'px' }"></div>
      <div class="ml-2 text-slate-500">{{ item.value }}</div>
    </div>
  </div>
</div>`;

const RENDER_JS = `
import * as d3 from 'd3';
export default async function render({ data }) {
  const items = data.items ?? [];
  const h = 56 + items.length * 26;
  const svg = d3.select(document.body).append('svg').attr('width', 552).attr('height', h).attr('viewBox', '0 0 552 ' + h);
  const x = d3.scaleLinear().domain([0, d3.max(items, d => d.value)]).range([0, 400]);
  svg.selectAll('rect').data(items).join('rect')
    .attr('x', 0).attr('y', (d, i) => 8 + i * 26).attr('width', d => Math.max(4, x(d.value))).attr('height', 18)
    .attr('fill', '#0ea5e9').attr('rx', 5);
  return { bars: svg.node().outerHTML };
}
`;

const DATA = {
  title: '月度概览',
  subtitle: 'Vue 模板 · 数据驱动',
  items: [
    { name: '一月', value: 12 },
    { name: '二月', value: 19 },
    { name: '三月', value: 8 },
  ],
};

async function main() {
  const manifest = {
    schema: 1,
    width: 600,
    height: 0, // auto
    format: 'png',
    dpr: 2,
    template: 'template.vue',
    entry: 'render.js',
  };
  const files = {
    'manifest.json': JSON.stringify(manifest),
    'template.vue': TEMPLATE_VUE,
    'render.js': RENDER_JS,
  };

  const t0 = performance.now();
  const result = await renderPackage(
    { files, data: DATA },
    { workdirBase: join(import.meta.dir, '..', '.render-cache'), timeoutMs: 10000 },
  );
  console.log(`VUE_RENDER_OK content=${result.contentType} bytes=${result.buffer.byteLength} ms=${(performance.now() - t0).toFixed(0)}`);

  const u8 = new Uint8Array(result.buffer);
  const h = (u8[20] << 24 | u8[21] << 16 | u8[22] << 8 | u8[23]) >>> 0;
  console.log(`PNG 尺寸 600x${h}（应 > 0）`);
  if (h < 50) { console.error('VUE_TEST_FAILED: 高度异常'); process.exit(1); }
  console.log('VUE_TEST_OK');
}

main().catch((e) => {
  console.error('VUE_TEST_FAILED:', e.message ?? e);
  process.exit(1);
});
