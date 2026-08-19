# d3.js 精选权威参考（服务端图表渲染）

> 本文档是 `render-service` 的 d3 参考，供开发者与大模型在编写 `render.js` 时引用。
> 覆盖 **d3@7.9.0** 全部子模块，重点展开服务端 SVG 图表生成最常用的部分。
> 全量权威文档见 [d3js.org](https://d3js.org) 与 [d3 GitHub](https://github.com/d3/d3)。

---

## 1. d3 在本服务中的运行方式

- `render.js` 里 `import * as d3 from 'd3'` 即可使用全部 d3 模块。
- 服务在**子进程**里提供全局 `document`（[linkedom](https://github.com/WebReflection/linkedom) 实现的轻量 DOM），因此 `d3.select(document.body)`、`d3.select('svg')`、`.append()`、`.attr()`、`d3.axisBottom(...)` 等**标准写法全部可用**。
- 渲染是**静态、一次性的**：不要用 `transition()`/`d3.timer` 等依赖 `requestAnimationFrame` 的异步动画。
- 约定返回值：`export default async function render({ data, manifest }) { return { 槽位名: svg字符串 } }`。
- 序列化：`svg.node().outerHTML` 或全局助手 `serializeSvg(svg.node())`（后者会自动补 `xmlns`）。

**最小示例骨架：**

```js
import * as d3 from 'd3';

export default async function render({ data, manifest }) {
  const width = 600, height = 300;
  const svg = d3.select(document.body)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`);

  const x = d3.scaleLinear().domain([0, 10]).range([0, width]);
  svg.append('g').attr('transform', `translate(0,${height})`).call(d3.axisBottom(x));

  return { chart: svg.node().outerHTML };
}
```

---

## 2. d3 模块总览

| 模块 | 用途 |
|---|---|
| `d3-array` | 数据变换/统计/聚合（min/max/bin/group…） |
| `d3-scale` | 比例尺（映射数据域→像素域） |
| `d3-shape` | 图形生成器（line/area/arc/pie/stack/curve…） |
| `d3-selection` | DOM 选择与数据绑定 |
| `d3-axis` | 坐标轴 |
| `d3-format` | 数值格式化 |
| `d3-time` / `d3-time-format` | 时间区间与时间格式化 |
| `d3-scale-chromatic` | 调色板/颜色插值 |
| `d3-color` | 颜色解析与转换 |
| `d3-interpolate` | 值/颜色/数组插值 |
| `d3-hierarchy` | 层级布局（tree/treemap/pack/partition…） |
| `d3-geo` | 地理投影与路径（地图） |
| `d3-force` | 力导向图布局 |
| `d3-chord` | 弦图/关系 |
| `d3-path` | Canvas/SVG 路径构建 |
| `d3-dsv` | CSV/TSV 解析与格式化 |
| `d3-random` | 随机数生成 |
| `d3-contour` | 等高线/密度 |
| `d3-delaunay` | Delaunay 三角剖分 / Voronoi |
| `d3-polygon` | 多边形几何计算 |
| `d3-quadtree` | 四叉树空间索引 |
| `d3-dispatch` | 事件分发 |
| `d3-drag` / `d3-zoom` / `d3-brush` | 交互（服务端静态渲染下基本不用） |
| `d3-ease` / `d3-timer` / `d3-transition` | 缓动/定时/过渡（动画，服务端基本不用） |
| `d3-fetch` | 网络请求（服务端不建议用，数据应走请求 `data`） |

---

## 3. d3-scale（比例尺）★核心

把「数据域 domain」映射到「像素域 range」。

```js
const x = d3.scaleLinear().domain([0, 100]).range([0, 600]);
const y = d3.scaleLinear().domain([0, 100]).nice().range([400, 0]); // y 轴反转
```

### 常用比例尺

| 函数 | 用途 | 关键方法 |
|---|---|---|
| `scaleLinear()` | 连续线性 | `domain` `range` `nice` `ticks` `tickFormat` `clamp` |
| `scalePow().exponent(0.5)` / `scaleSqrt()` | 幂/平方根 | 同上 |
| `scaleLog()` | 对数 | `base` `domain` `range` `ticks` |
| `scaleTime()` / `scaleUtc()` | 时间 | `domain` `range` `nice` `ticks` |
| `scaleSequential(interpolator)` | 顺序色阶 | `domain` `interpolator` `clamp` |
| `scaleDiverging(interpolator)` | 发散色阶 | 同上 |
| `scaleQuantize()` | 分箱离散 | `domain` `range` `nice` |
| `scaleQuantile()` | 分位数 | `domain` `range` `quantiles` |
| `scaleThreshold()` | 阈值离散 | `domain` `range` `invertExtent` |
| `scaleOrdinal()` | 序数 | `domain` `range` `unknown` |
| `scaleBand()` | 带状（柱状图） | `domain` `range` `padding` `paddingInner` `paddingOuter` `align` `bandwidth` `step` `round` |
| `scalePoint()` | 点状 | `domain` `range` `padding` `align` `step` |

### 关键方法

```js
scale.domain([0, 10]);          // 设置数据域
scale.range([0, 300]);          // 设置像素域
scale.nice(5);                  // 把 domain 扩展到"好看的"边界
scale.ticks(5);                 // 返回约 5 个刻度值（用于手绘刻度）
scale.tickFormat(5, '.1f');     // 刻度格式化器
scale(5);                       // 调用：数据值 -> 像素值
scale.clamp(true);              // 越界值收敛到边界
```

`scaleBand` 专有：

```js
const x = d3.scaleBand().domain(['a','b','c']).range([0,600]).padding(0.2);
x('a');            // 每个 band 的起始 x
x.bandwidth();     // band 宽度
x.step();          // band 间距
```

---

## 4. d3-shape（图形生成器）★核心

### 4.1 折线 / 面积

```js
const line = d3.line()
  .x((d, i) => x(i))
  .y((d) => y(d))
  .curve(d3.curveMonotoneX);   // 可选平滑

const area = d3.area()
  .x((d, i) => x(i))
  .y0(y(0))
  .y1((d) => y(d));
```

### 4.2 饼图 / 环形

```js
const pie = d3.pie().value(d => d.value).sort(null);
const arc = d3.arc().innerRadius(0).outerRadius(100);
pie(data).forEach(d => {
  // d.startAngle, d.endAngle, d.data
  arc(d);   // 返回 path 的 d 属性
});
const donutArc = d3.arc().innerRadius(60).outerRadius(100);  // 环形
```

### 4.3 堆叠

```js
const stack = d3.stack().keys(['a','b','c']).offset(d3.stackOffsetNone);
const series = stack(data);   // 每层为 [y0,y1] 数组
```

### 4.4 常用曲线 `d3.curve*`

`curveLinear`（默认直线）、`curveStep`（阶梯）、`curveStepAfter`、`curveBasis`（B 样条）、`curveBasisClosed`、`curveCardinal`、`curveCatmullRom`、`curveMonotoneX`、`curveMonotoneY`、`curveNatural`、`curveBundle`。

### 4.5 符号（散点形状）

```js
const sym = d3.symbol().type(d3.symbolCircle).size(64);
// 类型：symbolCircle, symbolCross, symbolDiamond, symbolSquare, symbolStar, symbolTriangle, symbolWye
```

### 4.6 链接

`linkHorizontal()` `linkVertical()` `linkRadial()` —— 树/桑基类布局的连线。

---

## 5. d3-selection（选择与数据绑定）★核心

```js
d3.select(sel)        // 选中第一个匹配（DOM 节点或选择器）
d3.selectAll(sel)     // 选中全部
sel.append('g')       // 追加子元素
sel.attr('fill', '#fff')      // 设属性
sel.style('color', 'red')     // 设样式
sel.text('hello')     // 设文本
sel.datum(d)          // 绑定单个数据
```

### 数据连接（enter/update/exit，`.join` 简化版）

```js
svg.selectAll('rect')
  .data(values)               // 绑定数组
  .join('rect')               // 等价 enter.append + update + exit.remove
  .attr('x', (d, i) => x(i))
  .attr('y', (d) => y(d))
  .attr('width', x.bandwidth())
  .attr('height', (d) => innerH - y(d));
```

其他常用：`.call(fn)`（把 selection 传给函数，如 `.call(axis)`）、`.node()`（取 DOM 节点）、`.remove()`、`.merge()`、`.filter()`、`.sort()`、`.each()`、`.empty()`、`.size()`。

---

## 6. d3-axis（坐标轴）★核心

```js
svg.append('g')
  .attr('transform', `translate(0,${height})`)
  .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format('.0f')));

svg.append('g').call(d3.axisLeft(y).ticks(5));
```

| 方向 | 函数 |
|---|---|
| 下 | `axisBottom(scale)` |
| 左 | `axisLeft(scale)` |
| 上 | `axisTop(scale)` |
| 右 | `axisRight(scale)` |

轴方法：`.scale()` `.ticks(n)` `.tickValues(arr)` `.tickFormat(f)` `.tickSize(n)` `.tickSizeInner(n)` `.tickSizeOuter(n)` `.tickPadding(n)` `.offset(n)`。

> 提示：给 `<g>` 设 `attr('color', '#94a3b8')` 可统一轴的颜色（轴文本用 `currentColor`）。

---

## 7. d3-array（数据变换/统计）★核心

```js
d3.min(data, d => d.value)
d3.max(data, d => d.value)
d3.extent(data, d => d.value)     // [min, max]
d3.sum(data, d => d.value)
d3.mean(data, d => d.value)
d3.median(data, d => d.value)
d3.quantile(data, 0.5)
d3.variance(data, d => d.value)
d3.deviation(data, d => d.value)
d3.ascending(a, b) / d3.descending(a, b)   // 比较器
d3.range(0, 10, 1)               // [0..9]
d3.ticks(0, 100, 5)              // 刻度
d3.group(data, d => d.category)  // 分组 -> Map
d3.rollup(data, v => d3.sum(v, d => d.value), d => d.category)
d3.bin().domain(x.domain()).thresholds(20)(data)  // 直方图分箱
d3.count(data, d => d.value)
d3.sort(data, d => d.value)
d3.shuffle(data)
d3.permute(data, [1,0,2])
d3.zip(a, b) / d3.pairs(a) / d3.cross(a, b) / d3.merge(arrays)
d3.bisect(sorted, x) / d3.bisector(accessor)
d3.least(data, acc) / d3.greatest(data, acc)
d3.cumsum(data, acc) / d3.fsum(data, acc)
d3.thresholdSturges(values) / d3.thresholdScott(values) / d3.thresholdFreedmanDiaconis(values)
```

---

## 8. d3-format / d3-time-format（格式化）

```js
d3.format('.2f')(3.14159)     // "3.14"
d3.format(',.0f')(1234567)    // "1,234,567"
d3.format('.2%')(0.123)       // "12.3%"
d3.formatPrefix('.1', 1e6)(1e6)  // "1.0M"
d3.formatSpecifier('.2f')     // 解析格式字符串

d3.timeFormat('%Y-%m-%d')(new Date())
d3.timeParse('%Y-%m-%d')('2024-01-01')
d3.utcFormat('%Y-%m-%d')(d)
d3.isoFormat(new Date())      // ISO8601
```

时间区间 `d3.timeDay` / `d3.timeWeek` / `d3.timeMonth` / `d3.timeYear`：

```js
d3.timeDay.range(start, end)          // 每天
d3.timeMonth.every(2)                 // 每两月
d3.timeDay.offset(d, 7)               // +7 天
```

---

## 9. d3-hierarchy（层级布局）

```js
const root = d3.hierarchy(data)        // 数据 -> 层级节点
  .sum(d => d.value)
  .sort((a, b) => b.value - a.value);

// 树 / 集群
d3.tree().size([width, height])(root);
// 树状矩形图
d3.treemap().size([width, height]).padding(2)(root);
// 打包/圆堆积
d3.pack().size([width, height]).padding(2)(root);
// 分区（冰柱/旭日）
d3.partition().size([width, height])(root);

root.descendants()  // 所有后代（含自身）
root.leaves()       // 叶子
root.links()        // 边 [{source, target}]
```

配套：`d3.stratify()`（扁平 id/parentId 数据 -> 层级）。

---

## 10. d3-geo（地图）

```js
const projection = d3.geoMercator().fitSize([width, height], geojson);
const path = d3.geoPath(projection);
svg.append('path').attr('d', path(geojson)).attr('fill', '#e2e8f0');
```

投影：`geoMercator` `geoAlbers` `geoAlbersUsa` `geoEqualEarth` `geoOrthographic` `geoNaturalEarth1` `geoStereographic` `geoConicConformal` 等。
投影方法：`.scale()` `.translate()` `.center()` `.rotate()` `.fitExtent()` `.fitSize()` `.precision()`。
几何计算：`geoArea` `geoBounds` `geoCentroid` `geoDistance` `geoLength` `geoContains` `geoInterpolate`。
> 需要 GeoJSON；TopoJSON 用 [topojson-client](https://github.com/topojson/topojson-client) 的 `feature()` 转换（非 d3 内置）。

---

## 11. d3-force（力导向图）

```js
const simulation = d3.forceSimulation(nodes)
  .force('link', d3.forceLink(links).id(d => d.id).distance(60))
  .force('charge', d3.forceManyBody().strength(-200))
  .force('center', d3.forceCenter(width / 2, height / 2))
  .force('collide', d3.forceCollide(10))
  .stop();                        // 同步跑完（服务端不要用 on('tick') 动画）

for (let i = 0; i < 300; i++) simulation.tick();
// 之后从 nodes[i].x / nodes[i].y 读取坐标，再画边和点
```

> 服务端要点：**不要 `on('tick')`**，用 `simulation.stop()` 后手动循环 `tick()` 若干次，得到稳定布局后一次性画图。

---

## 12. d3-chord（弦图）

```js
const chord = d3.chord().padAngle(0.05)(matrix);
const ribbon = d3.ribbon().radius(innerRadius);
// chord 返回 { source:{startAngle,endAngle}, target:{...} }
```

---

## 13. 颜色与插值

```js
d3.color('#ff0000')              // 解析
d3.rgb('steelblue').brighter(0.5).formatHex()
d3.hsl(...) / d3.lab(...) / d3.hcl(...) / d3.cubehelix(...)

d3.interpolate(0, 100)(0.5)      // 50
d3.interpolateRgb('red', 'blue')(0.5)
d3.interpolateHsl(...)
d3.interpolateNumber / interpolateRound / interpolateString / interpolateDate / interpolateArray
d3.quantize(d3.interpolateRgb('red','blue'), 5)   // 5 个颜色
```

### d3-scale-chromatic 调色板

- 分类色：`d3.schemeCategory10`、`d3.schemeTableau10`、`d3.schemeDark2`、`d3.schemePaired`、`d3.schemeSet1/2/3`、`d3.schemePastel1/2`、`d3.schemeAccent`
- 连续插值：`d3.interpolateBlues` `interpolateReds` `interpolateGreens` `interpolateOranges` `interpolatePurples` `interpolateGreys` `interpolateRdBu` `interpolateViridis` `interpolateMagma` `interpolateInferno` `interpolatePlasma` `interpolateCividis` `interpolateTurbo` `interpolateCool` `interpolateWarm` `interpolateRainbow` `interpolateSinebow`

```js
const color = d3.scaleSequential(d3.interpolateViridis).domain([0, 100]);
```

---

## 14. 其他模块速查

| 模块 | 关键 API | 服务端注意 |
|---|---|---|
| `d3-dsv` | `csvParse` `csvParseRows` `csvFormat` `tsvParse` `dsvFormat` `autoType` | 字符串解析，无需 DOM |
| `d3-path` | `d3.path()` + `moveTo/lineTo/arc/arcTo/bezierCurveTo/quadraticCurveTo/rect/closePath` | 构造 path 字符串 |
| `d3-random` | `randomUniform` `randomInt` `randomNormal` `randomLogNormal` `randomLcg` | 可给 seed（`randomLcg`）复现 |
| `d3-contour` | `d3.contours().size().thresholds()(values)` `contourDensity()` | 等高线/密度 |
| `d3-delaunay` | `Delaunay.from(points)` `.voronoi()` `.find()` `.hull` | Voronoi 图 |
| `d3-polygon` | `polygonArea` `polygonCentroid` `polygonHull` `polygonContains` `polygonLength` | |
| `d3-quadtree` | `quadtree()` `.addAll()` `.find()` `.visit()` | 空间检索 |
| `d3-dispatch` | `dispatch('a','b')` `.on()` `.call()` | 事件 |
| `d3-drag` / `d3-zoom` / `d3-brush` | 交互 | 静态渲染不用 |
| `d3-ease` / `d3-timer` / `d3-transition` | 动画 | 静态渲染不用 |
| `d3-fetch` | `json` `csv` `text` `svg` `buffer` | 网络请求，服务端应改用请求 `data` |

---

## 15. 服务端集成要点（务必遵守）

1. **静态渲染**：不要 `transition()`、不要 `d3.timer`、不要 `requestAnimationFrame` 依赖；力导向用 `simulation.stop()` + 手动 `tick()`。
2. **返回契约**：`render.js` 的 default export 接收 `{ data, manifest }`，返回 `{ 槽位名: svg字符串 }`，槽位名必须与 `template.html` 的 `data-chart="..."` 一一对应。
3. **SVG 要自带尺寸**：`svg` 元素显式设 `width`/`height`（和/或 `viewBox`），否则 resvg 光栅化尺寸不对。
4. **序列化**：优先 `serializeSvg(svg.node())`（自动补 xmlns），或直接 `svg.node().outerHTML`。
5. **数据来源**：外部数据通过 HTTP 请求体的 `data` 字段传入，不要在脚本里 fetch。
6. **字体**：图表内文字（如轴标签）由 resvg 用系统字体渲染；如需自定义字体，把它放进 `manifest.fonts`（服务会传给 resvg）。
7. **执行限制**：脚本在子进程运行，有超时（默认 10s，`RENDER_TIMEOUT_MS` 可调）。

---

## 16. 官方链接

- [d3 主站与 API 索引](https://d3js.org) · [d3 GitHub](https://github.com/d3/d3)
- [d3 官方 gallery（Observable）](https://observablehq.com/@d3/gallery)
- [d3-graph-gallery](https://d3-graph-gallery.com)
- 本服务内置：`node_modules/d3` 及全部 `d3-*` 子包（每个子包都有独立 README 与文档）
