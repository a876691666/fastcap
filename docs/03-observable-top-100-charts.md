# ObservableHQ 最热 100 种图表（d3 图表类型速查）

> 本文档是 `render-service` 的图表类型参考，供开发者与大模型挑选/实现图表时引用。
> 用途：在服务端用 d3 生成 SVG 图表 → 再由 resvg 光栅化或 Satori 排版。
>
> **链接说明**：
> - 官方 d3 gallery 的 notebook 规范地址为 `https://observablehq.com/@d3/<slug>`，完整目录见 [ObservableHQ @d3 gallery](https://observablehq.com/collection/@d3/gallery)。
> - 非官方图表的补充参考见 [The D3 Graph Gallery](https://d3-graph-gallery.com)（Yan Holtz）。
> - 文中链接优先给出规范 @d3 slug；部分图表用 gallery 目录/站内页作为入口，建议以「图表英文名 + observablehq」搜索到最新 notebook。
>
> **依赖注意**：`d3` 主包**不包含** `d3-sankey`、`d3-cloud`（词云）、`topojson-client`（TopoJSON）、`d3-hexbin`，用到时需另装；其余常用模块均内置。

---

## 一、比较 / 排名（1–20）

### 1. 柱状图 Bar Chart
- **用途**：类别值比较，最通用。
- **参考**：https://observablehq.com/@d3/bar-chart
- **d3 模块**：d3-scale（scaleBand/scaleLinear）、d3-axis、d3-selection
- **服务端提示**：`scaleBand` 配 `bandwidth()` 定柱宽。

### 2. 水平柱状图 Horizontal Bar Chart
- **用途**：类别名较长时横向排列。
- **参考**：https://observablehq.com/@d3/bar-chart
- **d3 模块**：d3-scale、d3-axis、d3-selection

### 3. 分组柱状图 Grouped Bar Chart
- **用途**：多组类别的并列比较。
- **参考**：https://observablehq.com/@d3/grouped-bar-chart
- **d3 模块**：d3-scale（scaleBand 嵌套）、d3-axis、d3-shape

### 4. 堆叠柱状图 Stacked Bar Chart
- **用途**：类别内的成分叠加。
- **参考**：https://observablehq.com/@d3/stacked-bar-chart
- **d3 模块**：d3-shape（stack）、d3-scale、d3-axis

### 5. 发散条形图 Diverging Bar Chart
- **用途**：正负/赞成反对对比。
- **参考**：https://observablehq.com/@d3/diverging-bar-chart
- **d3 模块**：d3-scale、d3-axis、d3-selection

### 6. 棒棒糖图 Lollipop Chart
- **用途**：强调数值的极简条形图变体。
- **参考**：https://d3-graph-gallery.com/graph/lollipop_cleveland.html
- **d3 模块**：d3-scale、d3-selection、d3-shape（line）

### 7. 点阵图 Dot Plot
- **用途**：少量类别、数值分布一目了然。
- **参考**：https://observablehq.com/@d3/dot-plot
- **d3 模块**：d3-scale、d3-selection

### 8. 哑铃图 Dumbbell Chart
- **用途**：两个时点/两个群体的成对比较。
- **参考**：https://d3-graph-gallery.com/graph/dumbbell_basic.html
- **d3 模块**：d3-scale、d3-selection、d3-shape（line）

### 9. 子弹图 Bullet Chart
- **用途**：目标 vs 实际值的仪表化对比。
- **参考**：https://d3-graph-gallery.com
- **d3 模块**：d3-scale、d3-selection

### 10. 瀑布图 Waterfall Chart
- **用途**：累计增减变化过程。
- **参考**：https://d3-graph-gallery.com/graph/waterfall_basic.html
- **d3 模块**：d3-scale、d3-selection、d3-array（cumsum）

### 11. 雷达图 Radar / Spider Chart
- **用途**：多维指标对比。
- **参考**：https://d3-graph-gallery.com/graph/radar_basic.html
- **d3 模块**：d3-scale、d3-shape（line）、d3-selection

### 12. 平行坐标 Parallel Coordinates
- **用途**：高维数据线平行排列。
- **参考**：https://observablehq.com/@d3/parallel-coordinates
- **d3 模块**：d3-scale（scalePoint）、d3-shape（line）、d3-selection

### 13. 坡度图 Slope Chart
- **用途**：两个时点的排名变化。
- **参考**：https://observablehq.com/@d3/slope-chart
- **d3 模块**：d3-scale、d3-shape（line）、d3-selection

### 14. 排名变化图 Bump Chart
- **用途**：多时点排名起伏。
- **参考**：https://observablehq.com/@d3/bump-chart
- **d3 模块**：d3-scale、d3-shape（line）、d3-selection

### 15. 动态柱状图 Bar Chart Race
- **用途**：随时间的排名动画（静态可用关键帧）。
- **参考**：https://observablehq.com/@d3/bar-chart-race
- **d3 模块**：d3-scale、d3-selection、d3-array
- **服务端提示**：静态渲染只出某一帧，动画需自行逐帧生成多张图。

### 16. 马赛克图 Marimekko / Mosaic Chart
- **用途**：两个分类维度的占比（宽度+高度编码）。
- **参考**：https://observablehq.com/@d3/marimekko-chart
- **d3 模块**：d3-scale、d3-shape（stack）、d3-selection

### 17. 华夫图 Waffle Chart
- **用途**：网格化占比。
- **参考**：https://observablehq.com/@d3/waffle-chart
- **d3 模块**：d3-scale、d3-selection

### 18. 象形图 Pictogram / Isotype
- **用途**：用图标重复次数编码数量。
- **参考**：https://d3-graph-gallery.com
- **d3 模块**：d3-selection、d3-scale

### 19. 仪表盘 Gauge Chart
- **用途**：单值仪表显示（KPI）。
- **参考**：https://d3-graph-gallery.com
- **d3 模块**：d3-shape（arc）、d3-scale

### 20. 径向柱状图 Radial / Circular Bar Chart
- **用途**：柱状图绕圆排列。
- **参考**：https://d3-graph-gallery.com
- **d3 模块**：d3-scale、d3-shape（arc）、d3-selection

---

## 二、时间序列（21–34）

### 21. 折线图 Line Chart
- **用途**：时间/连续变量的趋势。
- **参考**：https://observablehq.com/@d3/line-chart
- **d3 模块**：d3-shape（line）、d3-scale、d3-axis

### 22. 多折线 Multi-line Chart
- **用途**：多条序列对比。
- **参考**：https://observablehq.com/@d3/multi-line-chart
- **d3 模块**：d3-shape（line）、d3-scale

### 23. 面积图 Area Chart
- **用途**：趋势+量级。
- **参考**：https://observablehq.com/@d3/area-chart
- **d3 模块**：d3-shape（area）、d3-scale

### 24. 堆叠面积图 Stacked Area Chart
- **用途**：多序列成分叠加。
- **参考**：https://observablehq.com/@d3/stacked-area-chart
- **d3 模块**：d3-shape（stack/area）、d3-scale

### 25. 溪流图 Streamgraph
- **用途**：堆叠面积的平滑对称版。
- **参考**：https://observablehq.com/@d3/streamgraph
- **d3 模块**：d3-shape（stack/area）、d3-scale

### 26. 地平线图 Horizon Chart
- **用途**：密集时间序列的分层压缩显示。
- **参考**：https://observablehq.com/@d3/horizon-chart
- **d3 模块**：d3-scale、d3-shape（area）、d3-array

### 27. 迷你图 Sparkline
- **用途**：表格内的小型趋势线。
- **参考**：https://observablehq.com/@d3/sparkline
- **d3 模块**：d3-shape（line/area）、d3-scale

### 28. K 线图 Candlestick Chart
- **用途**：金融 OHLC 可视化。
- **参考**：https://observablehq.com/@d3/candlestick-chart
- **d3 模块**：d3-scale、d3-selection、d3-array

### 29. OHLC 图 OHLC Chart
- **用途**：开高低收（线型）。
- **参考**：https://d3-graph-gallery.com
- **d3 模块**：d3-scale、d3-selection

### 30. 热力图 Heatmap
- **用途**：二维矩阵值的大小用颜色编码。
- **参考**：https://observablehq.com/@d3/heatmap
- **d3 模块**：d3-scale（scaleBand/scaleSequential）、d3-selection

### 31. 日历热力图 Calendar Heatmap
- **用途**：按日历天的活跃度（如 GitHub 贡献图）。
- **参考**：https://observablehq.com/@d3/calendar-view
- **d3 模块**：d3-scale、d3-selection、d3-time

### 32. 山脊图 Ridgeline Plot
- **用途**：多组分布的叠加密度曲线。
- **参考**：https://observablehq.com/@d3/ridgeline-plot
- **d3 模块**：d3-shape（area）、d3-scale、d3-array

### 33. 甘特图 Gantt Chart
- **用途**：项目任务时间段。
- **参考**：https://d3-graph-gallery.com
- **d3 模块**：d3-scale、d3-selection、d3-time

### 34. 时间线 Timeline
- **用途**：事件沿时间轴排列。
- **参考**：https://d3-graph-gallery.com
- **d3 模块**：d3-scale、d3-selection、d3-time

---

## 三、分布（35–48）

### 35. 直方图 Histogram
- **用途**：数值分布的分箱柱状。
- **参考**：https://observablehq.com/@d3/histogram
- **d3 模块**：d3-array（bin）、d3-scale、d3-axis

### 36. 密度图 Density Plot
- **用途**：连续概率密度曲线。
- **参考**：https://observablehq.com/@d3/density-plot
- **d3 模块**：d3-shape（area）、d3-scale、d3-array（KDE 需自实现）

### 37. 箱线图 Box Plot
- **用途**：四分位+离群点。
- **参考**：https://observablehq.com/@d3/box-plot
- **d3 模块**：d3-scale、d3-selection、d3-array（quantile）

### 38. 小提琴图 Violin Plot
- **用途**：分布形状 + 箱线信息。
- **参考**：https://observablehq.com/@d3/violin-plot
- **d3 模块**：d3-shape（area）、d3-scale、d3-array

### 39. 蜂群图 Beeswarm Plot
- **用途**：避免重叠的一维散点。
- **参考**：https://observablehq.com/@d3/beeswarm
- **d3 模块**：d3-scale、d3-selection、d3-force（防重叠）

### 40. 散条图 Strip Plot
- **用途**：一维散点 + 抖动。
- **参考**：https://d3-graph-gallery.com
- **d3 模块**：d3-scale、d3-selection、d3-random（抖动）

### 41. Q-Q 图 Q-Q Plot
- **用途**：检验分布是否接近正态。
- **参考**：https://d3-graph-gallery.com
- **d3 模块**：d3-scale、d3-shape（line）、d3-array（quantile）

### 42. 地毯图 Rug Plot
- **用途**：沿轴的小刻度分布标记。
- **参考**：https://d3-graph-gallery.com
- **d3 模块**：d3-scale、d3-selection

### 43. 雨云图 Raincloud Plot
- **用途**：散点+箱线+密度三合一。
- **参考**：https://d3-graph-gallery.com
- **d3 模块**：d3-shape、d3-scale、d3-array

### 44. 核密度估计 Kernel Density Estimation
- **用途**：平滑概率密度。
- **参考**：https://observablehq.com/@d3/density-contours
- **d3 模块**：d3-contour（contourDensity）、d3-scale

### 45. 二维直方图 2D Histogram
- **用途**：双变量的联合分布。
- **参考**：https://d3-graph-gallery.com
- **d3 模块**：d3-scale、d3-selection、d3-array

### 46. 等高线密度图 Density Contours
- **用途**：二维密度等值线。
- **参考**：https://observablehq.com/@d3/density-contours
- **d3 模块**：d3-contour、d3-scale、d3-shape

### 47. 背靠背直方图 Back-to-back Histogram
- **用途**：两群体分布镜像对比。
- **参考**：https://d3-graph-gallery.com
- **d3 模块**：d3-array（bin）、d3-scale

### 48. 金字塔图 Population Pyramid
- **用途**：人口年龄性别结构。
- **参考**：https://d3-graph-gallery.com
- **d3 模块**：d3-scale、d3-axis、d3-selection

---

## 四、相关 / 散点（49–60）

### 49. 散点图 Scatterplot
- **用途**：两连续变量关系。
- **参考**：https://observablehq.com/@d3/scatterplot
- **d3 模块**：d3-scale、d3-selection、d3-axis

### 50. 气泡图 Bubble Chart
- **用途**：散点 + 第三维用面积编码。
- **参考**：https://observablehq.com/@d3/bubble-chart
- **d3 模块**：d3-scale（scaleSqrt 定半径）、d3-selection

### 51. 连接散点图 Connected Scatterplot
- **用途**：两变量的时间轨迹。
- **参考**：https://observablehq.com/@d3/connected-scatterplot
- **d3 模块**：d3-shape（line）、d3-scale

### 52. 六边形分箱 Hexbin
- **用途**：大数据量散点的密度分箱。
- **参考**：https://observablehq.com/@d3/hexbin
- **d3 模块**：d3-scale、d3-selection（hexbin 需自定义或 d3-hexbin）

### 53. 等高线图 Contour Plot
- **用途**：三维面的等高线。
- **参考**：https://observablehq.com/@d3/contours
- **d3 模块**：d3-contour、d3-scale

### 54. 相关矩阵图 Correlogram
- **用途**：多变量两两相关系数热力。
- **参考**：https://d3-graph-gallery.com/graph/correlogram_basic.html
- **d3 模块**：d3-scale、d3-selection、d3-array

### 55. 散点矩阵 Scatterplot Matrix
- **用途**：多变量两两散点。
- **参考**：https://observablehq.com/@d3/brushable-scatterplot-matrix
- **d3 模块**：d3-scale、d3-selection

### 56. 回归线 Regression / Line of Best Fit
- **用途**：散点 + 拟合直线。
- **参考**：https://d3-graph-gallery.com
- **d3 模块**：d3-shape（line）、d3-scale、d3-array（最小二乘自算）

### 57. 误差棒图 Error Bars
- **用途**：均值 ± 误差。
- **参考**：https://d3-graph-gallery.com
- **d3 模块**：d3-scale、d3-selection

### 58. 置信带 Confidence Band
- **用途**：预测区间/置信区间带状。
- **参考**：https://d3-graph-gallery.com
- **d3 模块**：d3-shape（area/line）、d3-scale

### 59. 沃罗诺伊图 Voronoi Diagram
- **用途**：最近邻区域划分。
- **参考**：https://observablehq.com/@d3/voronoi
- **d3 模块**：d3-delaunay、d3-scale

### 60. Delaunay 三角剖分 Delaunay Triangulation
- **用途**：点集三角网。
- **参考**：https://observablehq.com/@d3/delaunay
- **d3 模块**：d3-delaunay

---

## 五、部分-整体（61–70）

### 61. 饼图 Pie Chart
- **用途**：占比（类别少时）。
- **参考**：https://observablehq.com/@d3/pie-chart
- **d3 模块**：d3-shape（pie/arc）、d3-selection

### 62. 环形图 Donut Chart
- **用途**：饼图中间留空。
- **参考**：https://observablehq.com/@d3/donut-chart
- **d3 模块**：d3-shape（pie/arc）、d3-selection

### 63. 玫瑰图 Nightingale Rose
- **用途**：角度相同、半径编码值。
- **参考**：https://d3-graph-gallery.com
- **d3 模块**：d3-shape（pie/arc）、d3-scale

### 64. 径向堆叠柱 Radial Stacked Bar Chart
- **用途**：堆叠柱绕圆。
- **参考**：https://observablehq.com/@d3/radial-stacked-bar-chart
- **d3 模块**：d3-shape（stack/arc）、d3-scale

### 65. 矩形树图 Treemap
- **用途**：层级占比的矩形镶嵌。
- **参考**：https://observablehq.com/@d3/treemap
- **d3 模块**：d3-hierarchy、d3-selection

### 66. 缩放矩形树图 Zoomable Treemap
- **用途**：可下钻的树图（静态出首层）。
- **参考**：https://observablehq.com/@d3/zoomable-treemap
- **d3 模块**：d3-hierarchy、d3-selection

### 67. 圆堆积 Circle Packing
- **用途**：层级用圆嵌套表示。
- **参考**：https://observablehq.com/@d3/circle-packing
- **d3 模块**：d3-hierarchy（pack）、d3-selection

### 68. 旭日图 Sunburst
- **用途**：径向层级占比。
- **参考**：https://observablehq.com/@d3/sunburst
- **d3 模块**：d3-hierarchy（partition）、d3-shape（arc）

### 69. 冰柱图 Icicle
- **用途**：线性层级分区。
- **参考**：https://observablehq.com/@d3/icicle
- **d3 模块**：d3-hierarchy（partition）、d3-selection

### 70. 树状图（占比）Dendrogram (as partition)
- **用途**：层级占比的树状表达。
- **参考**：https://observablehq.com/@d3/dendrogram
- **d3 模块**：d3-hierarchy（cluster）、d3-shape（link）

---

## 六、层级 / 树（71–78）

### 71. 树图 Tree
- **用途**：层级结构的树布局。
- **参考**：https://observablehq.com/@d3/tree
- **d3 模块**：d3-hierarchy（tree）、d3-shape（link）

### 72. 整洁树 Tidy Tree
- **用途**：水平整洁树布局。
- **参考**：https://observablehq.com/@d3/tidy-tree
- **d3 模块**：d3-hierarchy（tree）、d3-shape（link）

### 73. 径向树 Radial Tree
- **用途**：树绕圆展开。
- **参考**：https://observablehq.com/@d3/radial-tree
- **d3 模块**：d3-hierarchy（tree）、d3-shape（linkRadial）

### 74. 可折叠树 Collapsible Tree
- **用途**：可交互展开的树（静态出展开态）。
- **参考**：https://observablehq.com/@d3/collapsible-tree
- **d3 模块**：d3-hierarchy（tree）、d3-shape（link）

### 75. 聚类树状图 Cluster Dendrogram
- **用途**：层次聚类的合并过程。
- **参考**：https://observablehq.com/@d3/cluster-dendrogram
- **d3 模块**：d3-hierarchy（cluster）、d3-shape（link）

### 76. 分区图 Partition
- **用途**：层级面积分区。
- **参考**：https://observablehq.com/@d3/partition
- **d3 模块**：d3-hierarchy（partition）、d3-shape

### 77. 圈层图 Indented Tree / Enclosure
- **用途**：缩进列表树。
- **参考**：https://observablehq.com/@d3/indented-tree
- **d3 模块**：d3-hierarchy、d3-selection

### 78. 分层边捆绑 Hierarchical Edge Bundling
- **用途**：层级 + 关系连线聚合。
- **参考**：https://observablehq.com/@d3/hierarchical-edge-bundling
- **d3 模块**：d3-hierarchy、d3-shape（line/curveBundle）、d3-selection

---

## 七、网络 / 关系（79–86）

### 79. 力导向图 Force-directed Graph
- **用途**：节点-边网络布局。
- **参考**：https://observablehq.com/@d3/force-directed-graph
- **d3 模块**：d3-force、d3-selection
- **服务端提示**：用 `simulation.stop()` 后手动循环 `tick()` 收敛，再一次性画图。

### 80. 弧线图 Arc Diagram
- **用途**：一维节点 + 弧线连接。
- **参考**：https://observablehq.com/@d3/arc-diagram
- **d3 模块**：d3-scale、d3-shape（arc）

### 81. 弦图 Chord Diagram
- **用途**：类别间的流量关系。
- **参考**：https://observablehq.com/@d3/chord-diagram
- **d3 模块**：d3-chord、d3-shape（arc/ribbon）

### 82. 桑基图 Sankey Diagram
- **用途**：能量/流量在阶段间的流转。
- **参考**：https://observablehq.com/@d3/sankey
- **d3 模块**：d3-sankey（**另装**）、d3-shape、d3-scale

### 83. 冲积图 Alluvial Diagram
- **用途**：类别间的流向变化。
- **参考**：https://observablehq.com/@d3/alluvial
- **d3 模块**：d3-sankey（**另装**）、d3-scale

### 84. 邻接矩阵 Adjacency Matrix
- **用途**：网络的矩阵化表达。
- **参考**：https://observablehq.com/@d3/adjacency-matrix
- **d3 模块**：d3-scale、d3-selection

### 85. 蜂巢图 Hive Plot
- **用途**：多轴网络布局。
- **参考**：https://d3-graph-gallery.com
- **d3 模块**：d3-scale、d3-shape（line）

### 86. 词云 Word Cloud
- **用途**：词频大小编码。
- **参考**：https://d3-graph-gallery.com/graph/wordcloud_basic.html
- **d3 模块**：d3-cloud（**另装**）、d3-scale

---

## 八、地理 / 地图（87–94）

### 87. 分级统计地图 Choropleth
- **用途**：区域数值着色。
- **参考**：https://observablehq.com/@d3/choropleth
- **d3 模块**：d3-geo、d3-scale、d3-selection
- **服务端提示**：需 GeoJSON/TopoJSON；TopoJSON 用 topojson-client（**另装**）转换。

### 88. 符号地图 Symbol Map
- **用途**：点 + 面积/颜色编码。
- **参考**：https://observablehq.com/@d3/symbol-map
- **d3 模块**：d3-geo、d3-scale、d3-shape（symbol）

### 89. 点密度地图 Dot Density Map
- **用途**：单位点代表数量。
- **参考**：https://observablehq.com/@d3/dot-density-map
- **d3 模块**：d3-geo、d3-selection、d3-random

### 90. 变形地图 Cartogram
- **用途**：面积按变量扭曲。
- **参考**：https://d3-graph-gallery.com
- **d3 模块**：d3-geo、d3-scale

### 91. 流向地图 Flow Map
- **用途**：起终点连线流量。
- **参考**：https://d3-graph-gallery.com
- **d3 模块**：d3-geo、d3-shape、d3-selection

### 92. 瓦片地图 Tile Map
- **用途**：格网化区域（等面积分箱）。
- **参考**：https://observablehq.com/@d3/tile-map
- **d3 模块**：d3-scale、d3-selection

### 93. 地球仪 Globe (Orthographic)
- **用途**：三维球面投影。
- **参考**：https://observablehq.com/@d3/orthographic
- **d3 模块**：d3-geo（geoOrthographic）、d3-selection

### 94. 等值区域图 Voronoi Map
- **用途**：非规则区域划分着色。
- **参考**：https://observablehq.com/@d3/voronoi-labels
- **d3 模块**：d3-delaunay、d3-geo

---

## 九、统计 / 学术 / 其他（95–100）

### 95. 漏斗图 Funnel Chart
- **用途**：转化流程各阶段。
- **参考**：https://d3-graph-gallery.com
- **d3 模块**：d3-scale、d3-shape

### 96. 三元相图 Ternary Plot
- **用途**：三成分合计 100% 的点。
- **参考**：https://d3-graph-gallery.com
- **d3 模块**：d3-scale、d3-shape（line）

### 97. PCA / 降维散点 Biplot
- **用途**：高维数据投影到二维。
- **参考**：https://observablehq.com/@d3/brushable-scatterplot-matrix
- **d3 模块**：d3-scale、d3-selection

### 98. 区间图 Span / Range Chart
- **用途**：最小-最大区间。
- **参考**：https://d3-graph-gallery.com
- **d3 模块**：d3-scale、d3-selection

### 99. 极坐标图 Polar Chart
- **用途**：角度+半径双编码。
- **参考**：https://observablehq.com/@d3/radial-line-chart
- **d3 模块**：d3-shape（lineRadial）、d3-scale

### 100. 辛顿图 Hinton Diagram
- **用途**：权重矩阵的方块大小编码。
- **参考**：https://observablehq.com/@d3/hinton-diagram
- **d3 模块**：d3-scale、d3-selection

---

## 附：在本服务中实现图表的一般步骤

1. 确定图表类型 → 查上表拿到所需 d3 模块。
2. 在 `render.js` 里：`import * as d3 from 'd3'`，用 `d3.select(document.body).append('svg')` 构建。
3. 比例尺 `domain/range` → 坐标轴 `d3.axisBottom/Left` → 图形 `d3.line/area/arc/stack/...` 或 `.join()` 绑数据。
4. SVG 元素显式设 `width`/`height`（+ `viewBox`）。
5. `return { 槽位名: serializeSvg(svg.node()) }`。
6. 依赖缺失的模块（sankey/cloud/topojson/hexbin）先在服务里 `bun add` 对应包。

> 官方全量示例：[ObservableHQ @d3 gallery](https://observablehq.com/collection/@d3/gallery) · [The D3 Graph Gallery](https://d3-graph-gallery.com) · [d3js.org](https://d3js.org)
