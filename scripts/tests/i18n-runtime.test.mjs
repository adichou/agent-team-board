#!/usr/bin/env node
// REQ-20260911-005 R1/R2/R3：translateTree 文本与属性翻译、跳过规则、动态捕获组回填。
// 用轻量假 DOM（nodeType/childNodes/attribute 最小面）验证，不依赖真实浏览器。
// 用法：node scripts/tests/i18n-runtime.test.mjs

import assert from 'node:assert/strict';
import '../web/i18n.js';

const I = globalThis.ATBI18N;
assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');

// ---- 最小假 DOM ----
function text(v) { return { nodeType: 3, nodeValue: v, childNodes: [] }; }
function el(tagName, { attrs = {}, children = [] } = {}) {
  const a = { ...attrs };
  return {
    nodeType: 1,
    tagName: String(tagName).toUpperCase(),
    childNodes: children,
    getAttribute: (k) => (k in a ? a[k] : null),
    setAttribute: (k, v) => { a[k] = v; },
    get _attrs() { return a; },
  };
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('R1a 文本节点全文命中被译，保留前后空白', () => {
  I.setLang('en');
  const node = text('  待接受  ');
  I.translateTree(el('div', { children: [node] }));
  assert.equal(node.nodeValue, '  Pending  ');
  I.setLang('zh');
});

t('R1b 属性 title / placeholder / aria-label 同口径翻译', () => {
  I.setLang('en');
  const e = el('button', { attrs: { title: '全选', 'aria-label': '关闭', placeholder: '搜需求 / Bug / 文档…' } });
  I.translateTree(e);
  assert.equal(e._attrs.title, 'Select all');
  assert.equal(e._attrs['aria-label'], 'Close');
  assert.notEqual(e._attrs.placeholder, '搜需求 / Bug / 文档…', 'placeholder 应被翻译');
  I.setLang('zh');
});

t('R1c 不命中的文本与属性保持原样（降级）', () => {
  I.setLang('en');
  const node = text('用户自己的标题内容');
  const e = el('div', { attrs: { title: '用户自己的悬浮说明' }, children: [node] });
  I.translateTree(e);
  assert.equal(node.nodeValue, '用户自己的标题内容');
  assert.equal(e._attrs.title, '用户自己的悬浮说明');
  I.setLang('zh');
});

t('R2 SCRIPT/STYLE/CODE/PRE 与 data-i18n-skip 子树跳过', () => {
  I.setLang('en');
  const code = text('待接受');
  const skipped = text('待接受');
  const root = el('div', {
    children: [
      el('pre', { children: [text('待接受')] }),
      el('code', { children: [text('待接受')] }),
      el('div', { attrs: { 'data-i18n-skip': '1' }, children: [skipped] }),
      el('span', { children: [text('待接受')] }),
    ],
  });
  void code;
  I.translateTree(root);
  assert.equal(root.childNodes[0].childNodes[0].nodeValue, '待接受', 'PRE 内不译');
  assert.equal(root.childNodes[1].childNodes[0].nodeValue, '待接受', 'CODE 内不译');
  assert.equal(skipped.nodeValue, '待接受', 'data-i18n-skip 子树不译');
  assert.equal(root.childNodes[3].childNodes[0].nodeValue, 'Pending', '正常节点被译');
  I.setLang('zh');
});

t('R3 动态捕获组回填（数字与 ID 形态）', () => {
  I.setLang('en');
  const n = text('已选 3 项');
  I.translateTree(el('div', { children: [n] }));
  assert.ok(/3/.test(n.nodeValue) && !/已选/.test(n.nodeValue), `已选 3 项 → 含 3 的英文（实际：${n.nodeValue}）`);
  const id = text('接受 REQ-20260911-005');
  I.translateTree(el('div', { children: [id] }));
  assert.match(id.nodeValue, /REQ-20260911-005/);
  assert.doesNotMatch(id.nodeValue, /接受/);
  I.setLang('zh');
});

t('R3b 长模板优先：含后缀的动态文案不被短模板部分吞译', () => {
  I.setLang('en');
  const v = I.t('编辑 REQ-20260911-003 标题与描述');
  assert.equal(v, 'Edit REQ-20260911-003 title & description', `'编辑 ◇' 不得抢先于 '编辑 ◇ 标题与描述'（实际：${v}）`);
  I.setLang('zh');
  const back = I.t('Edit REQ-20260911-003 title & description');
  assert.equal(back, '编辑 REQ-20260911-003 标题与描述', '反向同样长模板优先');
});

t('R4 双语往返：en 译出后切回 zh 能还原（反向词典与反向模板）', () => {
  I.setLang('en');
  assert.equal(I.t('待接受'), 'Pending');
  assert.equal(I.t('已选 5 项'), '5 selected');
  I.setLang('zh');
  assert.equal(I.t('Pending'), '待接受', '精确反向还原');
  assert.equal(I.t('5 selected'), '已选 5 项', '动态反向还原');
  assert.equal(I.t('智能体团队看板'), '智能体团队看板', '已是中文的原样返回');
});

t('R4b DOM 往返：同一节点 en 译出、zh 译回', () => {
  I.setLang('en');
  const node = text('待测试');
  I.translateTree(el('div', { children: [node] }));
  assert.equal(node.nodeValue, 'In test');
  I.setLang('zh');
  I.translateTree(el('div', { children: [node] }));
  assert.equal(node.nodeValue, '待测试');
});

for (const [name, fn] of cases) {
  fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
