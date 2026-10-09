/**
 * 在**常驻 Bun Worker**（持久子线程）中执行用户 render.js。
 *
 * 为什么常驻：每次渲染新建进程要付 ~10ms 进程启动 + ~20ms linkedom + ~30ms d3 导入，
 * 而真正的绘制计算只有 ~1ms。复用 worker 后 d3/linkedom 保持热态，单次降到 ~1ms。
 *
 * 隔离与可控：
 * - 每个任务有独立超时；超时即 `terminate()` 该 worker 并重建。
 * - worker 处理满 `RENDER_WORKER_MAX_JOBS` 个任务后回收，避免动态 import 的模块缓存无限增长。
 * - 并发上限 `RENDER_WORKERS`（默认 2），超出排队。
 */
import type { Manifest } from './types';

export interface RunScriptOptions {
  entryPath: string;
  data: unknown;
  manifest: Manifest;
  timeoutMs: number;
}

const MAX_WORKERS = Math.max(1, Number(process.env.RENDER_WORKERS ?? 2));
const MAX_JOBS_PER_WORKER = Math.max(1, Number(process.env.RENDER_WORKER_MAX_JOBS ?? 500));
/** 热生存时限：空闲超过该毫秒数的 worker 会被回收（释放内存）。0 = 不回收 */
const IDLE_MS = Math.max(0, Number(process.env.RENDER_WORKER_IDLE_MS ?? 60000));
const WORKER_URL = new URL('../worker/run-render.worker.ts', import.meta.url);

interface Pending {
  id: number;
  opts: RunScriptOptions;
  resolve: (charts: Record<string, string>) => void;
  reject: (err: Error) => void;
}

interface Slot {
  worker: Worker;
  busy: boolean;
  jobs: number;
  current: Pending | null;
  timer: ReturnType<typeof setTimeout> | null;
  /** 空闲回收计时器（热生存时限） */
  idleTimer: ReturnType<typeof setTimeout> | null;
}

const slots: Slot[] = [];
const queue: Pending[] = [];
let seq = 0;

function createSlot(): Slot {
  // Bun 全局 Worker；模块 worker 以文件 URL 创建
  const worker = new Worker(WORKER_URL);
  // 不阻塞进程退出：空闲 worker 不应让宿主进程（含测试进程）无法退出
  (worker as unknown as { unref?: () => void }).unref?.();
  const slot: Slot = { worker, busy: false, jobs: 0, current: null, timer: null, idleTimer: null };
  worker.onmessage = (e: MessageEvent) => onMessage(slot, e.data as WorkerReply);
  worker.onerror = (e: unknown) => onError(slot, e);
  return slot;
}

function clearIdle(slot: Slot): void {
  if (slot.idleTimer) {
    clearTimeout(slot.idleTimer);
    slot.idleTimer = null;
  }
}

/** 空闲超过热生存时限则回收 worker（释放内存；下次渲染再按需新建） */
function scheduleIdle(slot: Slot): void {
  clearIdle(slot);
  if (IDLE_MS <= 0) return;
  slot.idleTimer = setTimeout(() => {
    slot.idleTimer = null;
    if (slot.busy) return;
    removeSlot(slot);
  }, IDLE_MS);
  // 不因空闲回收计时器阻塞进程退出
  (slot.idleTimer as unknown as { unref?: () => void }).unref?.();
}

interface WorkerReply {
  id: number;
  ok: boolean;
  charts?: Record<string, string>;
  error?: string;
}

function acquire(): Slot | null {
  // 优先复用空闲且未超龄的 worker
  for (const s of slots) {
    if (!s.busy && s.jobs < MAX_JOBS_PER_WORKER) return s;
  }
  // 回收超龄的空闲 worker
  for (let i = slots.length - 1; i >= 0; i--) {
    const s = slots[i];
    if (!s.busy && s.jobs >= MAX_JOBS_PER_WORKER) {
      try { s.worker.terminate(); } catch {}
      slots.splice(i, 1);
    }
  }
  if (slots.length < MAX_WORKERS) {
    const s = createSlot();
    slots.push(s);
    return s;
  }
  return null;
}

function removeSlot(slot: Slot): void {
  clearIdle(slot);
  try { slot.worker.terminate(); } catch {}
  const i = slots.indexOf(slot);
  if (i >= 0) slots.splice(i, 1);
}

function start(slot: Slot, pending: Pending): void {
  clearIdle(slot);
  slot.busy = true;
  slot.current = pending;
  slot.timer = setTimeout(() => {
    if (slot.current !== pending) return;
    slot.current = null;
    slot.busy = false;
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = null;
    removeSlot(slot);
    pending.reject(new Error(`render.js 执行超时（>${pending.opts.timeoutMs}ms）`));
    dispatch();
  }, pending.opts.timeoutMs);

  slot.worker.postMessage({
    id: pending.id,
    modulePath: pending.opts.entryPath,
    data: pending.opts.data,
    manifest: pending.opts.manifest,
  });
}

function onMessage(slot: Slot, reply: WorkerReply): void {
  const cur = slot.current;
  if (!cur || reply.id !== cur.id) return;
  if (slot.timer) clearTimeout(slot.timer);
  slot.timer = null;
  slot.current = null;
  slot.busy = false;
  slot.jobs++;
  if (reply.ok && reply.charts) {
    cur.resolve(reply.charts);
  } else {
    cur.reject(new Error(`render.js 执行失败：${reply.error ?? '未知错误'}`));
  }
  // 若后续还有排队任务，dispatch 会复用该 worker（start 会清除空闲计时）
  scheduleIdle(slot);
  dispatch();
}

function onError(slot: Slot, e: unknown): void {
  const cur = slot.current;
  if (slot.timer) clearTimeout(slot.timer);
  slot.timer = null;
  slot.current = null;
  slot.busy = false;
  removeSlot(slot);
  const message = e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e);
  if (cur) cur.reject(new Error(`render.js 执行失败：${message}`));
  dispatch();
}

function dispatch(): void {
  while (queue.length > 0) {
    const slot = acquire();
    if (!slot) return;
    const pending = queue.shift()!;
    start(slot, pending);
  }
}

/** 执行 render.js，返回 { 槽位名: SVG 字符串 } */
export async function runChartScript(opts: RunScriptOptions): Promise<Record<string, string>> {
  return new Promise<Record<string, string>>((resolve, reject) => {
    const pending: Pending = { id: ++seq, opts, resolve, reject };
    const slot = acquire();
    if (slot) start(slot, pending);
    else queue.push(pending);
  });
}

/** 预热：提前创建常驻 worker，避免首个请求承担冷启动（进程启动 + linkedom/d3 导入） */
export function prewarmChartWorkers(n = MAX_WORKERS): void {
  for (let i = slots.length; i < n; i++) {
    const slot = createSlot();
    slots.push(slot);
    scheduleIdle(slot); // 预热后长期无请求也会按热生存时限被回收
  }
}
