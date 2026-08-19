import * as d3 from 'd3';

/**
 * 示例：柱状图。
 * 返回 { 槽位名: svg字符串 }，槽位名需与 template.html 中 data-chart="..." 对应。
 * 环境提供全局 document（linkedom）与 serializeSvg() 助手。
 */
export default async function render({ data }) {
  const values = data?.values ?? [12, 19, 8, 15, 22, 30, 27, 35, 40, 38, 45, 52];
  const width = 1104;
  const height = 400;
  const margin = { top: 20, right: 24, bottom: 40, left: 48 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const x = d3
    .scaleBand()
    .domain(d3.range(values.length))
    .range([0, innerW])
    .padding(0.25);
  const y = d3
    .scaleLinear()
    .domain([0, d3.max(values)])
    .nice()
    .range([innerH, 0]);

  const svg = d3
    .select(document.body)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`);

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  // X 轴
  g.append('g')
    .attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(x).tickFormat((d) => `${Number(d) + 1}月`))
    .attr('color', '#94a3b8');

  // Y 轴
  g.append('g').call(d3.axisLeft(y).ticks(5)).attr('color', '#94a3b8');

  // 柱
  g.selectAll('rect')
    .data(values)
    .join('rect')
    .attr('x', (d, i) => x(i))
    .attr('y', (d) => y(d))
    .attr('width', x.bandwidth())
    .attr('height', (d) => innerH - y(d))
    .attr('fill', '#38bdf8')
    .attr('rx', 4);

  return { revenue: svg.node().outerHTML };
}
