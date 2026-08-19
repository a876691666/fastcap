// /vl 任务图形总览 —— 图表体渲染（d3 生成 SVG，供 Satori 模板的 data-chart 槽位嵌入）
//
// 每个分区（老板/打手）渲染一个 SVG，包含：
//   1) 顶部堆叠状态条（按各状态 count 占比）
//   2) 图例行（色点 + 状态名 + count·isk）
//   3) 用户横向条形（长度 ∝ count 平方根，颜色=状态色，右侧名字 + count·isk）
//
// 高度公式（与 Rust 侧 vl_chart 布局常量保持一致）：
//   slot 高 = 56 + 26 * 用户行数
// 数据形状由 Rust 预处理好（label/color/isk 均已格式化）：
//   { boss?: Section, worker?: Section }
//   Section = { total_count, statuses:[{label,color,count,isk}], users_flat:[{label,count,isk,color}] }

import * as d3 from 'd3';

const W = 728;
const STACK_H = 16;
const LEGEND_Y = 26; // 图例文字 baseline
const ROWS_Y = 48; // 第一条用户行顶部
const ROW_H = 26;
const BOTTOM_PAD = 8;
const BAR_MAX_W = 320;
const FONT = 'Noto Sans SC';

function sectionHeight(rows) {
  return ROWS_Y + rows.length * ROW_H + BOTTOM_PAD; // = 56 + 26n
}

function renderSection(section) {
  const statuses = section.statuses ?? [];
  const rows = section.users_flat ?? [];
  const h = sectionHeight(rows);

  const svg = d3
    .select(document.body)
    .append('svg')
    .attr('width', W)
    .attr('height', h)
    .attr('viewBox', `0 0 ${W} ${h}`);

  // 1) 顶部堆叠状态条
  const total = Math.max(1, section.total_count ?? 0);
  let cx = 0;
  const segs = statuses.map((st) => {
    const w = Math.max(2, (W * (st.count || 0)) / total);
    const seg = { ...st, x: cx, w };
    cx += w;
    return seg;
  });
  svg
    .append('g')
    .selectAll('rect')
    .data(segs)
    .join('rect')
    .attr('x', (d) => d.x)
    .attr('width', (d) => Math.max(0, d.w - 1))
    .attr('y', 0)
    .attr('height', STACK_H)
    .attr('fill', (d) => d.color)
    .attr('rx', 4);

  // 2) 图例行（每状态等宽一列）
  const n = statuses.length;
  const colW = n ? W / n : W;
  statuses.forEach((st, i) => {
    const gx = i * colW;
    svg
      .append('circle')
      .attr('cx', gx + 5)
      .attr('cy', LEGEND_Y - 5)
      .attr('r', 5)
      .attr('fill', st.color);
    svg
      .append('text')
      .attr('x', gx + 15)
      .attr('y', LEGEND_Y)
      .attr('font-size', 13)
      .attr('fill', '#475569')
      .attr('font-family', FONT)
      .text(`${st.label} ${st.count}·${st.isk}`);
  });

  // 3) 用户横向条形
  const maxLen = Math.max(1, ...rows.map((r) => Math.sqrt(r.count || 0)));
  rows.forEach((r, i) => {
    const y = ROWS_Y + i * ROW_H;
    const bw = Math.max(4, (Math.sqrt(r.count || 0) / maxLen) * BAR_MAX_W);
    svg
      .append('rect')
      .attr('x', 0)
      .attr('y', y + 4)
      .attr('width', bw)
      .attr('height', 18)
      .attr('fill', r.color)
      .attr('rx', 5);
    svg
      .append('text')
      .attr('x', bw + 10)
      .attr('y', y + 18)
      .attr('font-size', 14)
      .attr('fill', '#0f172a')
      .attr('font-family', FONT)
      .text(r.label);
    svg
      .append('text')
      .attr('x', W - 6)
      .attr('y', y + 18)
      .attr('text-anchor', 'end')
      .attr('font-size', 13)
      .attr('fill', '#64748b')
      .attr('font-family', FONT)
      .text(`${r.count}·${r.isk}`);
  });

  return svg.node().outerHTML;
}

export default async function render({ data }) {
  const out = {};
  if (data?.boss) out.boss = renderSection(data.boss);
  if (data?.worker) out.worker = renderSection(data.worker);
  return out;
}
