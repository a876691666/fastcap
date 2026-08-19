/**
 * 在独立子进程里执行用户提供的 d3 图表脚本（render.js），
 * 超时可强制终止，避免死循环/崩溃拖垮主服务。
 */
import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Manifest } from './types';

export interface RunScriptOptions {
  entryPath: string;
  data: unknown;
  manifest: Manifest;
  timeoutMs: number;
}

export async function runChartScript(opts: RunScriptOptions): Promise<Record<string, string>> {
  const workerPath = resolve(import.meta.dir, '../worker/run-render.ts');
  const inputPath = opts.entryPath + '.in.json';
  const outputPath = opts.entryPath + '.out.json';

  await rm(outputPath, { force: true }).catch(() => {});
  await Bun.write(
    inputPath,
    JSON.stringify({ modulePath: opts.entryPath, data: opts.data, manifest: opts.manifest }),
  );

  const proc = Bun.spawn({
    cmd: [process.execPath, workerPath, inputPath, outputPath],
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env as Record<string, string>,
  });

  const outcome = await Promise.race([
    proc.exited.then((code) => ({ kind: 'exit' as const, code })),
    sleep(opts.timeoutMs).then(() => ({ kind: 'timeout' as const })),
  ]);

  if (outcome.kind === 'timeout') {
    proc.kill();
    await rm(inputPath, { force: true }).catch(() => {});
    throw new Error(`render.js 执行超时（>${opts.timeoutMs}ms）`);
  }

  const stderr = await new Response(proc.stderr).text();
  if (!existsSync(outputPath)) {
    await rm(inputPath, { force: true }).catch(() => {});
    throw new Error(`render.js 未产出结果（exit=${outcome.code}）stderr: ${stderr || '(空)'}`);
  }

  const output = JSON.parse(await Bun.file(outputPath).text()) as
    | { ok: true; charts: Record<string, string> }
    | { ok: false; error: string };

  await rm(inputPath, { force: true }).catch(() => {});
  await rm(outputPath, { force: true }).catch(() => {});

  if (!output.ok) {
    throw new Error(`render.js 执行失败：${output.error}`);
  }
  if (!output.charts || typeof output.charts !== 'object' || Array.isArray(output.charts)) {
    throw new Error('render.js 必须返回 { 槽位名: svg字符串 } 对象');
  }
  return output.charts;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
