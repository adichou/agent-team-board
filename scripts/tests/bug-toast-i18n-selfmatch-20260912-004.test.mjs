#!/usr/bin/env node
// BUG-20260912-004：中文界面「✓ …」操作提示随轮询重翻不断叠加「已」（已已已…确认完成）。
// 根因：EN_DYNAMIC 泛化词条 '✓ ◇ 已◇' 的英文模板 '✓ $1 $2' 无 ASCII 锚点，反向模式
// ^✓ (.+?) (.+?)$ → ✓ $1 已$2 会命中纯中文提示并自馈——每遍重翻多叠一个「已」。
// 本文件回归四层：
// B1 词典防线（无英文锚点的动态词条不得回归）；
// B2/B3/B5 zh 模式 t() 与 DOM 反复重翻幂等（含各动作提示与曾受害形态）；
// B4 中英往返；B6 失败/撤销提示与 en 动态翻译回归不受影响。
// 用法：node scripts/tests/bug-toast-i18n-selfmatch-20260912-004.test.mjs

import assert from 'node:assert/strict';
import '../web/i18n.js';

const I = globalThis.ATBI18N;
assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
const { EN_DYNAMIC } = I._dict;

// 复刻 BUG-20260912-003 详情抽屉确认完成后的提示文案（缺陷截图形态）
const CONFIRMED = '✓ BUG-20260912-003 已确认完成';

// ---- 最小假 DOM（与 i18n-runtime.test.mjs 同构） ----
function text(v) { return { nodeType: 3, nodeValue: v, childNodes: [] }; }
function el(tagName, { children = [] } = {}) {
  return { nodeType: 1, tagName: String(tagName).toUpperCase(), childNodes: children };
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('B1 词典防线：动态词条英文模板必须含 ASCII 锚点（反向词典才不会自匹配中文）', () => {
  const anchorless = Object.entries(EN_DYNAMIC).filter(([, v]) => !/[A-Za-z]/.test(String(v)));
  assert.deepEqual(
    anchorless.map(([k]) => k),
    [],
    `无英文锚点的词条会让反向模式命中中文原文并自馈叠字：${anchorless.map(([k]) => k).join('、')}`
  );
});

t('B2 核心缺陷：zh 反复重翻「✓ 条目号 已确认完成」恒定不变', () => {
  I.setLang('zh');
  let s = CONFIRMED;
  for (let i = 0; i < 12; i++) s = I.t(s); // 模拟每 2s 轮询整页重翻
  assert.equal(s, CONFIRMED, `不应叠字（实际：${s}）`);
});

t('B3 zh 幂等：各「✓ 」开头动作提示与曾受害形态反复 t() 不变形', () => {
  I.setLang('zh');
  for (const s of [
    '✓ REQ-20260912-005 已接受',
    '✓ REQ-20260912-005 已移出计划',
    '✓ REQ-20260912-005 已移入计划',
    '✓ REQ-20260912-005 已驳回完成（退回开发）',
    '✓ REQ-20260912-005 已驳回接受（退回待接受）',
    '✓ REQ-1 标题与描述已更新',
    '✓ 已初始化并切换到 agent-team-board（/tmp/x）',
    '✓ 已复制完整提交号 abc12…',
  ]) {
    let cur = s;
    for (let i = 0; i < 6; i++) cur = I.t(cur);
    assert.equal(cur, s, `应幂等不变形（实际：${cur}）`);
  }
});

t('B4 中英往返：确认完成与驳回提示 en 译出、zh 还原', () => {
  I.setLang('en');
  assert.equal(I.t(CONFIRMED), '✓ BUG-20260912-003 confirmed done');
  assert.equal(I.t('✓ REQ-20260912-005 已接受'), '✓ REQ-20260912-005 accepted');
  assert.equal(I.t('✓ REQ-20260912-005 已驳回完成（退回开发）'), '✓ REQ-20260912-005 rejected completion (back to development)');
  assert.equal(I.t('✓ REQ-20260912-005 已驳回接受（退回待接受）'), '✓ REQ-20260912-005 rejected acceptance (back to pending)');
  I.setLang('zh');
  assert.equal(I.t('✓ BUG-20260912-003 confirmed done'), CONFIRMED);
  assert.equal(I.t('✓ REQ-20260912-005 rejected completion (back to development)'), '✓ REQ-20260912-005 已驳回完成（退回开发）');
  assert.equal(I.t('✓ REQ-20260912-005 rejected acceptance (back to pending)'), '✓ REQ-20260912-005 已驳回接受（退回待接受）');
});

t('B5 DOM 幂等：同一节点反复 translateTree（模拟轮询重渲染）文案不变', () => {
  I.setLang('zh');
  const node = text(CONFIRMED);
  I.translateTree(el('div', { children: [node] }));
  for (let i = 0; i < 6; i++) I.translateTree(el('div', { children: [node] }));
  assert.equal(node.nodeValue, CONFIRMED, `DOM 反复重翻不应变形（实际：${node.nodeValue}）`);
  I.setLang('en');
});

t('B6 回归：失败/撤销提示、未命中降级与 en 动态翻译行为不变', () => {
  I.setLang('zh');
  assert.equal(I.t('↩ 已撤销 REQ-1，状态已回退'), '↩ 已撤销 REQ-1，状态已回退');
  assert.equal(I.t('进展记录读取失败：超时'), '进展记录读取失败：超时');
  I.setLang('en');
  assert.equal(I.t('已选 5 项'), '5 selected');
  assert.equal(I.t('用户自己的标题内容'), '用户自己的标题内容', '未命中保持原文（降级）');
  I.setLang('zh');
});

for (const [name, fn] of cases) {
  fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
