/**
 * 代码包（code package）与渲染请求/响应的共享类型定义。
 * 这些类型同时是「代码包结构」这一交付物的规范来源之一。
 */

/** manifest.json —— 代码包的入口元数据 */
export interface Manifest {
  /** 结构版本，当前固定为 1 */
  schema: 1;
  /** 最终图片宽度（px） */
  width: number;
  /** 最终图片高度（px） */
  height: number;
  /** 输出格式 */
  format?: 'png' | 'svg';
  /** 图表槽位光栅化倍率（用于高分屏），默认 2 */
  dpr?: number;
  /** HTML/CSS 模板文件路径，默认 template.html */
  template?: string;
  /** d3 图表脚本入口，默认 render.js */
  entry?: string;
  /** Satori 渲染文字所需的字体 */
  fonts?: FontSpec[];
  /** 可选：显式声明图表槽位像素尺寸（优先级低于模板占位符上的 style） */
  charts?: Record<string, { width?: number; height?: number }>;
  /** 任意附加配置，透传给 render.js 的 manifest 参数 */
  [key: string]: unknown;
}

/** 字体描述：path 与 data 二选一 */
export interface FontSpec {
  /** 字体 family 名，供模板 font-family 引用 */
  family: string;
  /** 字体文件在包内的相对路径 */
  path?: string;
  /** base64 编码的字体二进制（无文件时用） */
  data?: string;
  /** 字重，默认 400 */
  weight?: number;
  /** 字型，默认 normal */
  style?: 'normal' | 'italic';
}

/** 代码包：文件名 -> 文件内容（UTF-8 文本；二进制走 base64 时放在 manifest.fonts[].data） */
export interface CodePackage {
  files: Record<string, string>;
}

/** POST /render 请求体 */
export interface RenderRequest {
  files: Record<string, string>;
  /** 传给 render.js 的业务数据 */
  data?: unknown;
  /** 覆盖 manifest 的输出参数 */
  options?: {
    format?: 'png' | 'svg';
    width?: number;
    height?: number;
    dpr?: number;
  };
}

/** render.js 的默认导出签名：返回 槽位名 -> SVG 字符串 */
export type ChartScript = (ctx: {
  data: unknown;
  manifest: Manifest;
}) => Record<string, string> | Promise<Record<string, string>>;

/** 图表槽位：模板占位符解析结果 */
export interface ChartSlot {
  name: string;
  width: number;
  height: number;
}

/** 渲染成功响应（字节流）之外的统一错误体 */
export interface ApiError {
  error: {
    code: string;
    message: string;
    detail?: string;
  };
}
