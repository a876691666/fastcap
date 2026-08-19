/**
 * 端到端测试：直接调用渲染管线，读取示例代码包，产出 PNG。
 * 运行：bun test/integration.ts
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderPackage } from '../src/render/pipeline';

const exampleDir = join(import.meta.dir, '..', 'examples', 'bar-chart');

const files: Record<string, string> = {};
for (const name of ['manifest.json', 'template.html', 'render.js']) {
  files[name] = await readFile(join(exampleDir, name), 'utf8');
}

const t0 = performance.now();
const result = await renderPackage(
  { files, data: { values: [12, 19, 8, 15, 22, 30, 27, 35, 40, 38, 45, 52] } },
  { workdirBase: join(import.meta.dir, '..', '.render-cache'), timeoutMs: 10000 },
);
const ms = (performance.now() - t0).toFixed(0);

const outPath = join(import.meta.dir, 'output.png');
await Bun.write(outPath, result.buffer);
console.log(`INTEGRATION_OK content=${result.contentType} bytes=${result.buffer.byteLength} ms=${ms}`);
console.log(`written: ${outPath}`);
