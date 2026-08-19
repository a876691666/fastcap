# Satori HTML/CSS 语法规范

> 本文档是 `render-service` 的模板层规范，供开发者与大模型在编写 `template.html` 时引用。
> 权威来源：[Satori 官方文档](https://github.com/vercel/satori) 与 [支持元素/预设样式源码 presets.ts](https://github.com/vercel/satori/blob/main/src/handler/presets.ts)。
> 本服务使用的 Satori 版本：**0.29.0**。

---

## 1. Satori 在本服务中的角色

`render-service` 的渲染分三层：

1. **Satori**：把 HTML/CSS 模板排版为 SVG（负责页面骨架、标题、卡片、布局）。
2. **d3**：在独立子进程里用标准 d3 语法生成图表 SVG。
3. **resvg**：把最终 SVG 光栅化为 PNG。

模板文件 `template.html` 就是 Satori 的输入。你只需关心：**用 HTML 标签 + 内联 `style` 描述静态布局**。

Satori 是一个**受限的 HTML/CSS 实现**：它用 [Yoga](https://yogalayout.com)（React Native 同款 Flexbox 引擎）做布局，只支持一个 CSS 子集，**不保证与浏览器像素级一致**。

---

## 2. 模板写法约定

- 只写**静态、可见**的元素；不支持 `<input>`、`<style>`、`<script>`、`<link>` 等。
- 样式写在**内联 `style` 属性**里，CSS 属性用 kebab-case（`font-size`）。本服务在送入 Satori 前会：① 转成 camelCase（`fontSize`）；② 用 css-to-react-native 把 `margin`/`padding`/`border`/`borderRadius`/`flex`/`font` 等**简写展开成长格式**（Satori 自身的简写展开不可靠，见第 6 节）。
- 模板根元素建议显式设置 `width` / `height`（px），与 `manifest.json` 的 `width`/`height` 一致，或用 `100%`。
- 图表占位符：`<div data-chart="槽位名" style="width:600px;height:300px"></div>`。渲染时被替换为对应 d3 图表的位图。

```html
<div style="display:flex;flex-direction:column;width:1200px;height:630px;background:#0f172a;color:#e2e8f0;padding:48px">
  <div style="font-size:48px;font-weight:700">标题 Title</div>
  <div data-chart="revenue" style="width:1104px;height:400px;margin-top:28px"></div>
</div>
```

---

## 3. 支持的 HTML 元素

Satori 只实现了**静态可见元素**的子集。常用元素如下（完整清单以 [presets.ts](https://github.com/vercel/satori/blob/main/src/handler/presets.ts) 为准）：

**文本/容器**：`div` `span` `p` `h1`~`h6` `blockquote` `a` `ul` `ol` `li` `code` `pre` `br` `hr`
**内联强调**：`b`/`strong` `i`/`em` `small` `mark` `del` `sub` `sup` `q` `s`
**表格**：`table` `thead` `tbody` `tr` `th` `td`
**媒体**：`img`
**SVG（可直接内联，Satori 会原样序列化）**：`svg` `g` `defs` `path` `rect` `circle` `ellipse` `line` `polyline` `polygon` `text` `image` `clipPath` `mask` `linearGradient` `radialGradient` `stop` `pattern` `use`

> ⚠️ 不支持的：`input`、`button`、`select`、`form`、`style`、`script`、`link`、`canvas` 等交互/外部资源元素。

---

## 4. 布局模型：Flexbox（Yoga）

Satori 默认 `display: flex`（不是浏览器的 block）。要点：

- 默认 `flexDirection: row`、`justifyContent: flex-start`、`alignItems: stretch`、`flexWrap: nowrap`。
- `position` 支持 `relative` / `absolute` / `static`（默认 `relative`）。
- **强制约束**：一个 `<div>` 只要含**多个子节点**，就必须显式写 `display:flex`（或 `display:contents` / `display:none`），否则 Satori 直接报错：

  ```
  Expected <div> to have explicit "display: flex", "display: contents", or "display: none"
  if it has more than one child node.
  ```

  > 单文本子节点的 `<div>` 不受此限制（如 `<div style="font-size:20px">标题</div>`）。

---

## 5. CSS 属性支持表

### 5.1 display / position / 尺寸

| 属性 | 支持值 / 说明 |
|---|---|
| `display` | `flex` `contents` `none`，默认 `flex` |
| `position` | `relative` `static` `absolute`，默认 `relative` |
| `top` `right` `bottom` `left` | 支持 |
| `width` `height` | 支持（px、%、数值=px） |
| `minWidth`/`minHeight`/`maxWidth`/`maxHeight` | 支持，**不支持** `min-content`/`max-content`/`fit-content` |
| `boxSizing` | 支持（默认 `border-box`） |
| `overflow` | `visible` `hidden`，默认 `visible` |

### 5.2 盒模型

| 属性 | 支持值 / 说明 |
|---|---|
| `margin` / `marginTop/Right/Bottom/Left` | 支持 |
| `padding` / `paddingTop/Right/Bottom/Left` | 支持 |
| `border` 简写 | 支持，如 `1px solid gray` |
| `borderWidth` / `borderTopWidth` 等 | 支持 |
| `borderStyle` / `borderTopStyle` 等 | `solid` `dashed`，默认 `solid` |
| `borderColor` / `borderTopColor` 等 | 支持 |
| `borderRadius` 简写 | 支持，如 `5px`、`50% / 5px` |
| `borderTopLeftRadius` 等四角 | 支持 |

### 5.3 Flex

| 属性 | 支持值 / 说明 |
|---|---|
| `flexDirection` | `column` `row` `row-reverse` `column-reverse`，默认 `row` |
| `flexWrap` | `wrap` `nowrap` `wrap-reverse`，默认 `nowrap` |
| `flexGrow` / `flexShrink` | 支持 |
| `flexBasis` | 支持，**不支持 `auto`** |
| `alignItems` | `stretch` `center` `flex-start` `flex-end` `baseline` `normal`，默认 `stretch` |
| `alignContent` / `alignSelf` | 支持 |
| `justifyContent` | 支持 |
| `gap` / `rowGap` / `columnGap` | 支持 |

### 5.4 字体与文本

| 属性 | 支持值 / 说明 |
|---|---|
| `fontFamily` | 支持；需在 `manifest.fonts` 或默认字体里注册同名字体 |
| `fontSize` | 支持 |
| `fontWeight` | 支持（`400`/`700` 或 `normal`/`bold`） |
| `fontStyle` | 支持（`normal`/`italic`） |
| `textAlign` | `start` `end` `left` `right` `center` `justify`，默认 `start` |
| `textTransform` | `none` `lowercase` `uppercase` `capitalize` |
| `textOverflow` | `clip` `ellipsis`，默认 `clip` |
| `textDecoration` | 线型 `underline` `line-through`；样式 `dotted` `dashed` `double` `solid` |
| `textShadow` | 支持 |
| `textIndent` | 支持（含负值悬挂缩进） |
| `textWrap` | `wrap` `balance`，默认 `wrap` |
| `lineHeight` | 支持 |
| `letterSpacing` | 支持 |
| `whiteSpace` | `normal` `pre` `pre-wrap` `pre-line` `nowrap`，默认 `normal` |
| `wordBreak` | `normal` `break-all` `break-word` `keep-all` |
| `tabSize` | 支持 |
| `lineClamp` | 支持 |
| `WebkitTextStrokeWidth` / `WebkitTextStrokeColor` | 支持 |

### 5.5 颜色 / 背景 / 图片

| 属性 | 支持值 / 说明 |
|---|---|
| `color` | 支持（`currentColor` 仅对 `color` 属性可用） |
| `backgroundColor` | 支持（单值） |
| `backgroundImage` | `linear-gradient` `repeating-linear-gradient` `radial-gradient` `repeating-radial-gradient` `url(...)`（单值） |
| `backgroundPosition` | 支持（单值） |
| `backgroundSize` | `cover` `contain` `auto`，或双值如 `10px 20%` |
| `backgroundRepeat` | `repeat` `repeat-x` `repeat-y` `no-repeat`，默认 `repeat` |
| `backgroundClip` | `border-box` `text` |
| `opacity` | 支持 |

### 5.6 transform / 其他

| 属性 | 支持值 / 说明 |
|---|---|
| `transform` | `translate` `translateX/Y` `rotate` `scale` `scaleX/Y` `skew` `skewX/Y`；**不支持 3D** |
| `transformOrigin` | 支持单值/双值（相对与绝对） |
| `objectFit` / `objectPosition` | 支持 |
| `boxShadow` | 支持 |
| `filter` | 支持 |
| `clipPath` | 支持 |
| `maskImage` / `maskPosition` / `maskSize` / `maskRepeat` | 支持 |
| **CSS 变量** | 支持 `--name` 声明、`var(--name)` 使用、fallback、嵌套 |

---

## 6. 关键约束与常见坑

1. **`<div>` 多子节点必须 `display:flex`**（见第 4 节）。
2. **无 `z-index`**：SVG 没有 z-index，靠文档顺序决定层叠，后写的元素在上层。
3. **不支持 `calc()`**。
4. **3D transform 不支持**。
5. **文本默认渲染为 `<path>`**（Satori 把字形轮廓直接内联进 SVG），所以最终出图**不依赖下游字体**；可用 `embedFont:false` 改为 `<text>`。
6. **字体格式**：仅支持 **TTF / OTF / WOFF**，**不支持 WOFF2**、TTC 需自行处理。
7. **高级排版不支持**：kerning、连字（ligature）、RTL 不保证。
8. **`<img>` 建议显式给 `width`/`height`**，否则可能无法确定图片尺寸。本服务渲染图表时已自动带上宽高。
9. **不支持 `<style>`/`<link>`/`<script>`**：所有样式必须内联。
10. **简写展开由服务端完成**：`margin`/`padding`/`border`/`borderRadius`/`flex`/`font` 等简写可直接写，服务端会用 css-to-react-native 展开成长格式；**不要依赖 Satori 自身的简写展开**——实测 `margin: 40px 80px` 它只生效左右、上下被静默丢弃。

---

## 7. 字体与多语言

- 渲染文字**必须注册字体**：`manifest.fonts`（或在无 `fonts` 时使用服务端默认字体目录 `RENDER_FONTS_DIR`）。
- `fontFamily` 里的名字要与注册字体的 `name`（即 `family`）匹配，Satori 按 `name + weight + style` 匹配。
- 中文/日文等需要对应的 CJK 字体（如 `Arial Unicode MS`、`Noto Sans SC`）。
- 用 `lang` 属性可强制指定 locale 渲染（如 `<div lang="ja-JP">骨</div>`）。
- Emoji：默认可能缺字形，可用 `graphemeImages` 把特定 emoji 映射到图片。

### 与 manifest.fonts 的对应

```json
{
  "fonts": [
    { "family": "Noto Sans SC", "path": "assets/NotoSansSC-Regular.otf", "weight": 400 },
    { "family": "Noto Sans SC", "path": "assets/NotoSansSC-Bold.otf", "weight": 700 }
  ]
}
```

`family` → Satori 的 `name`；`path` 为包内相对路径；`weight` 默认 400；`style` 默认 `normal`。

---

## 8. 官方参考

- [Satori GitHub](https://github.com/vercel/satori)
- [支持元素与预设样式 presets.ts](https://github.com/vercel/satori/blob/main/src/handler/presets.ts)
- [CSS 属性支持表（README）](https://github.com/vercel/satori#css)
- [Satori Playground](https://og-playground.vercel.app/)：可视化调试模板的官方沙盒
