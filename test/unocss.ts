/**
 * unocss 内联单测：className → 内联 style；与原有 style 合并且 unocss 低优先级（inline 覆盖）。
 * 运行：bun test/unocss.ts
 */
import { inlineUnocssStyles } from '../src/render/unocss';

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}`, extra ?? ''); }
}

async function main() {
  // 1) 纯 unocss 类 → 内联 style
  {
    const out = await inlineUnocssStyles('<div class="flex px-4 text-red-500">x</div>');
    check('display:flex', out.includes('display:flex'), out);
    check('padding-left:1rem', out.includes('padding-left:1rem'), out);
    check('颜色已内联（rgb 现代语法）', out.includes('color:rgb('), out);
    check('原 class 保留', out.includes('class="flex px-4 text-red-500"'), out);
  }

  // 2) 合并优先级：inline style 覆盖 unocss（unocss 低优先级）
  {
    const out = await inlineUnocssStyles(
      '<div class="text-red-500" style="color:#000000;background:#ffffff">x</div>',
    );
    check('inline color 覆盖 unocss', out.includes('color:#000000') && !out.includes('color:rgb(239'), out);
    check('background 原文保留（最终由 css-to-react-native 展开）', out.includes('background:#ffffff'), out);
  }

  // 3) 无 class → 原样返回（不重序列化）
  {
    const html = '<div style="color:red">x</div>';
    const out = await inlineUnocssStyles(html);
    check('无 class 原样返回', out === html, out);
  }

  // 4) 未知类忽略 + 变体跳过
  {
    const out = await inlineUnocssStyles('<div class="my-custom-class hover:text-blue-300">x</div>');
    check('未知类/变体不产生内联样式', !/style=/.test(out), out);
  }

  if (failures === 0) console.log('UNOCSS_TEST_OK');
  else { console.log(`UNOCSS_TEST_FAILED (${failures})`); process.exit(1); }
}

main();
