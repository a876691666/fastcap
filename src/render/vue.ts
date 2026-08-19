/**
 * Vue 模板 SSR：把用户写的 Vue 模板字符串 + 外部 data 渲染成 HTML 字符串，
 * 再由 Satori 管线排版成图片。
 *
 * 模板里通过 `data` 绑定外部数据，例如：
 *   <div>{{ data.title }}</div>
 *   <div v-for="item in data.list" :key="item.name">{{ item.name }}</div>
 *   <div data-chart="boss"></div>   ← d3 图表槽位（render.js 产出 SVG 后替换为位图）
 */
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';

export class VueTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VueTemplateError';
  }
}

/** Vue 模板字符串 + data → HTML 字符串 */
export async function vueTemplateToHtml(template: string, data: unknown): Promise<string> {
  try {
    const app = createSSRApp({
      data: () => ({ data: data ?? {} }),
      template,
    });
    return await renderToString(app);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new VueTemplateError(`Vue 模板渲染失败：${msg}`);
  }
}
