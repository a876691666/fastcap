/**
 * /vl 图表 code-package 端到端测试（auto-height 版）：
 * 模拟 Rust 侧组装 template/manifest/data，但**不传任何像素尺寸**——slot 尺寸取自 chart SVG 固有尺寸，
 * 总高度由 render-service 按内容自动裁切（manifest.height=0）。
 * 用 render.js 的布局常量作 oracle 校验最终 PNG 高度。
 * 运行：bun test/vl.ts
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderPackage } from '../src/render/pipeline';

const W = 800;
// oracle（仅用于校验，与 render.js 一致；Rust 侧不再需要这些常量）
const slotH = (n: number) => 56 + 26 * n;
const cardH = (n: number) => 66 + slotH(n);

type Row = { label: string; count: number; status: string };
const STATUS: Record<string, { label: string; color: string }> = {
  '0': { label: '待接受', color: '#969696' },
  '1': { label: '已接受', color: '#4080ff' },
  '2': { label: '已完成', color: '#38ac60' },
  '3': { label: '已结算', color: '#ffaa2a' },
  '4': { label: '返工中', color: '#eb504c' },
};

function section(total_count: number, rows: Row[]) {
  const statuses: Array<{ label: string; color: string; count: number; isk: string }> = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.status)) continue;
    seen.add(r.status);
    const st = STATUS[r.status];
    statuses.push({ label: st.label, color: st.color, count: 0, isk: '0' });
  }
  const byStatus = new Map(statuses.map((s) => [s.label, s]));
  for (const r of rows) {
    const st = STATUS[r.status];
    byStatus.get(st.label)!.count += r.count;
  }
  const users_flat = [...rows]
    .sort((a, b) => b.count - a.count)
    .map((r) => ({ label: r.label, count: r.count, isk: '1.0M', color: STATUS[r.status].color }));
  statuses.forEach((s) => { s.isk = '1.0M'; });
  return { total_count, statuses, users_flat };
}

const boss = section(12, [
  { label: '张三', count: 5, status: '4' },
  { label: '李四', count: 3, status: '2' },
  { label: '王五', count: 2, status: '1' },
  { label: '未关联', count: 2, status: '0' },
]);
const worker = section(8, [
  { label: '赵六', count: 4, status: '1' },
  { label: '钱七', count: 3, status: '3' },
  { label: '孙八', count: 1, status: '4' },
]);

// 卡片/占位符不带任何显式尺寸（root 也不设 height），完全交给 auto-height + intrinsic
function card(name: string, title: string, totalText: string) {
  return `<div style="display:flex;flex-direction:column;background:#ffffff;border-radius:16px;padding:16px;box-shadow:0 2px 10px rgba(15,23,42,0.08)"><div style="display:flex;flex-direction:row;justify-content:space-between;align-items:center;height:24px"><div style="font-size:20px;font-weight:700;color:#0f172a">${title}</div><div style="font-size:14px;color:#64748b">${totalText}</div></div><div data-chart="${name}" style="margin-top:10px"></div></div>`;
}

function buildTemplate() {
  const cards = card('boss', '👑 老板 · 我发布的', '共 12 单 · 12.3B')
    + card('worker', '🛠 打手 · 我接受的', '共 8 单 · 5.2B');
  return `<div style="display:flex;flex-direction:column;background:#eef2f7;padding:16px;gap:16px;font-family:Noto Sans SC">${cards}</div>`;
}

async function main() {
  const renderJs = await readFile(join(import.meta.dir, '..', 'examples/vl/render.js'), 'utf8');

  const manifest = {
    schema: 1,
    width: W,
    height: 0, // auto
    format: 'png',
    dpr: 2,
    template: 'template.html',
    entry: 'render.js',
  };

  const files = {
    'manifest.json': JSON.stringify(manifest),
    'template.html': buildTemplate(),
    'render.js': renderJs,
  };

  const t0 = performance.now();
  const result = await renderPackage(
    { files, data: { boss, worker } },
    { workdirBase: join(import.meta.dir, '..', '.render-cache'), timeoutMs: 10000 },
  );

  const expected = 32 + cardH(boss.users_flat.length) + 16 + cardH(worker.users_flat.length);
  const actualH = pngHeight(result.buffer);
  console.log(`VL_OK content=${result.contentType} bytes=${result.buffer.byteLength} ms=${(performance.now() - t0).toFixed(0)}`);
  console.log(`expected height=${expected}, actual auto-height=${actualH}`);
  const diff = Math.abs(actualH - expected);
  if (diff > 2) {
    console.error(`VL_TEST_FAILED: auto-height 偏差过大 (${diff}px)`);
    process.exit(1);
  }
  console.log(`auto-height 校验通过（偏差 ${diff}px）`);
}

function pngHeight(buf: Uint8Array): number {
  return (buf[20] << 24 | buf[21] << 16 | buf[22] << 8 | buf[23]) >>> 0;
}

main().catch((e) => {
  console.error('VL_TEST_FAILED:', e);
  process.exit(1);
});
