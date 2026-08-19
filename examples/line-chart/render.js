import * as d3 from 'd3';

/**
 * 示例：时间序列折线 + 面积图（含渐变）。
 * 数据来自请求体 data.series：[{ date: 'YYYY-MM-DD', value: number }]
 */
export default async function render({ data }) {
  const points = (data?.series ?? defaultSeries()).map((d) => ({
    date: new Date(d.date),
    value: d.value,
  }));

  const width = 1104;
  const height = 400;
  const margin = { top: 20, right: 24, bottom: 40, left: 48 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const x = d3
    .scaleTime()
    .domain(d3.extent(points, (d) => d.date))
    .range([0, innerW]);
  const y = d3
    .scaleLinear()
    .domain([0, d3.max(points, (d) => d.value)])
    .nice()
    .range([innerH, 0]);

  const line = d3
    .line()
    .x((d) => x(d.date))
    .y((d) => y(d.value))
    .curve(d3.curveMonotoneX);
  const area = d3
    .area()
    .x((d) => x(d.date))
    .y0(y(0))
    .y1((d) => y(d.value))
    .curve(d3.curveMonotoneX);

  const svg = d3
    .select(document.body)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`);

  // 渐变定义
  svg
    .append('defs')
    .append('linearGradient')
    .attr('id', 'areaGrad')
    .attr('x1', '0')
    .attr('y1', '0')
    .attr('x2', '0')
    .attr('y2', '1')
    .selectAll('stop')
    .data([
      { offset: '0%', color: '#0ea5e9' },
      { offset: '100%', color: 'rgba(14,165,233,0)' },
    ])
    .join('stop')
    .attr('offset', (d) => d.offset)
    .attr('stop-color', (d) => d.color);

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  // 坐标轴
  g.append('g')
    .attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(d3.timeFormat('%m月')))
    .attr('color', '#94a3b8');
  g.append('g').call(d3.axisLeft(y).ticks(5)).attr('color', '#94a3b8');

  // 面积 + 折线 + 数据点
  g.append('path').datum(points).attr('fill', 'url(#areaGrad)').attr('d', area);
  g.append('path')
    .datum(points)
    .attr('fill', 'none')
    .attr('stroke', '#0ea5e9')
    .attr('stroke-width', 3)
    .attr('d', line);
  g.selectAll('circle')
    .data(points)
    .join('circle')
    .attr('cx', (d) => x(d.date))
    .attr('cy', (d) => y(d.value))
    .attr('r', 4)
    .attr('fill', '#0ea5e9')
    .attr('stroke', '#f8fafc')
    .attr('stroke-width', 1.5);

  return { trend: svg.node().outerHTML };
}

function defaultSeries() {
  const out = [];
  const start = new Date('2024-01-01');
  for (let i = 0; i < 24; i++) {
    out.push({
      date: new Date(start.getTime() + i * 15 * 86400000).toISOString().slice(0, 10),
      value: Math.round(20 + 25 * Math.sin(i / 3) + Math.random() * 12),
    });
  }
  return out;
}
