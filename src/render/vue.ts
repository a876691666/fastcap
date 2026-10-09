/**
 * Vue 模板 SSR：把用户写的 Vue 模板字符串 + 外部 data 渲染成 HTML 字符串，
 * 再由 Satori 管线排版成图片。
 *
 * 模板里通过 `data` 绑定外部数据，例如：
 *   <div>{{ data.title }}</div>
 *   <div v-for="item in data.list" :key="item.name">{{ item.name }}</div>
 *   <div data-chart="boss"></div>   ← d3 图表槽位（render.js 产出 SVG 后替换为位图）
 */
import { createSSRApp, h } from 'vue';
import { renderToString } from '@vue/server-renderer';

export class VueTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VueTemplateError';
  }
}

/**
 * 内置全局组件 <Chart id="图表模板ID" :data="..." :width="..." :height="..." />。
 * Vue SSR 阶段只输出一个占位元素（携带图表模板 ID + 传入数据 + 可选尺寸），
 * 落到 HTML 后由渲染管线解析该占位、加载对应 chart 模板并注入图片。
 */
export const ChartComponent = {
  name: 'Chart',
  props: {
    id: { type: String, required: true },
    data: { default: undefined },
    width: { type: [Number, String], default: undefined },
    height: { type: [Number, String], default: undefined },
  },
  render(): unknown {
    const props = this as unknown as { id: string; data: unknown; width?: unknown; height?: unknown };
    const attrs: Record<string, unknown> = { 'data-chart-ref': props.id };
    if (props.data !== undefined) attrs['data-chart-data'] = JSON.stringify(props.data);
    if (props.width !== undefined && props.width !== '') attrs['data-chart-width'] = String(props.width);
    if (props.height !== undefined && props.height !== '') attrs['data-chart-height'] = String(props.height);
    return h('div', attrs);
  },
};

/** Vue 模板字符串 + data → HTML 字符串 */
export async function vueTemplateToHtml(template: string, data: unknown): Promise<string> {
  try {
    const app = createSSRApp({
      components: { Chart: ChartComponent },
      data: () => ({ data: data ?? {} }),
      template,
    });
    return await renderToString(app);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new VueTemplateError(`Vue 模板渲染失败：${msg}`);
  }
}
