/**
 * html.ts 转换器的边界测试：简写展开、含 `:`/`;` 的值、文本空白归一化、boxShadow 透传。
 * 运行：bun test/html.ts
 */
import { extractChartSlots, parseStyle, parseTemplate, rootToSatori } from '../src/render/html';

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}`, extra ?? '');
  }
}

console.log('1) CSS 简写展开');
{
  const s = parseStyle('margin: 10px 20px; padding: 4px 8px 12px; border: 1px solid red; border-radius: 12px; flex: 1');
  check('margin 四向', s.marginTop === 10 && s.marginRight === 20 && s.marginBottom === 10 && s.marginLeft === 20, s);
  check('padding 三值', s.paddingTop === 4 && s.paddingRight === 8 && s.paddingBottom === 12 && s.paddingLeft === 8, s);
  check('border 三值', s.borderWidth === 1 && s.borderColor === 'red' && s.borderStyle === 'solid', s);
  check('borderRadius 展开', s.borderTopLeftRadius === 12 && s.borderBottomRightRadius === 12, s);
  check('flex:1 展开', s.flexGrow === 1, s);
}

console.log('2) 含 `:` / `;` 的值不误切');
{
  const s = parseStyle('background-image: url("data:image/png;base64,AAA:BBB;CCC")');
  const bg = String(s.backgroundImage ?? '');
  check('data URI 完整保留', bg.includes('data:image/png;base64,AAA:BBB;CCC'), s);
}

console.log('3) boxShadow / textShadow 走字符串透传（不展开成 RN shadow*）');
{
  const s = parseStyle('box-shadow: 0 4px 8px rgba(0,0,0,.2)');
  check('boxShadow 保持字符串', s.boxShadow === '0 4px 8px rgba(0,0,0,.2)' && s.shadowOffset === undefined, s);
}

console.log('4) 文本空白归一化');
{
  const inline = rootToSatori(parseTemplate('<div><span>A</span> <span>B</span></div>'), {});
  const children = inline[0].props.children as unknown[];
  check('行内元素间空格保留', children.some((c) => c === ' '), children);

  const block = rootToSatori(
    parseTemplate('<div>\n  <div>x</div>\n  <div>y</div>\n</div>'),
    {},
  );
  const blockChildren = block[0].props.children as unknown[];
  const hasWhitespaceString = blockChildren.some((c) => typeof c === 'string');
  check('块级元素间换行缩进丢弃', !hasWhitespaceString && blockChildren.length === 2, blockChildren);
}

console.log('5) data-chart 占位符与尺寸解析');
{
  const root = parseTemplate('<div data-chart="c" style="width:1104px;height:400px"></div>');
  const slots = extractChartSlots(root);
  check('槽位尺寸解析', slots.length === 1 && slots[0].name === 'c' && slots[0].width === 1104 && slots[0].height === 400, slots);
}

console.log('6) 多子节点 div 自动补 display:flex（Satori 约束）');
{
  // 多元素子节点 + 无 display → 自动补 flex
  const multi = rootToSatori(parseTemplate('<div><span>a</span><span>b</span></div>'), {})[0];
  const s1 = multi.props.style as Record<string, unknown>;
  check('多子节点 div 自动 display:flex', s1?.display === 'flex', s1);
  // 已有显式 display 不覆盖
  const explicit = rootToSatori(parseTemplate('<div style="display:none"><span>a</span><span>b</span></div>'), {})[0];
  const s2 = (explicit.props.style ?? {}) as Record<string, unknown>;
  check('已有 display 不被覆盖', s2.display === 'none', s2);
  // 单文本子节点不补
  const textOnly = rootToSatori(parseTemplate('<div>hello</div>'), {})[0];
  const s3 = (textOnly.props.style ?? {}) as Record<string, unknown>;
  check('单文本子节点不补 flex', s3['display'] === undefined, s3);
}

if (failures === 0) {
  console.log('HTML_TEST_OK');
} else {
  console.log(`HTML_TEST_FAILED (${failures})`);
  process.exit(1);
}
