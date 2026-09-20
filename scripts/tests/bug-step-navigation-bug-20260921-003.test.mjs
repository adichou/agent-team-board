// BUG-20260921-003：步骤导航仅浏览，文档门禁不能阻止用户进入合并页查看原因。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');
const nav = source.match(/  function renderStepNav\(v\) \{[\s\S]*?\n  \}/)[0];
const state = { step: 'docs' };
const context = vm.createContext({ state, pfOf: v => v.pf, esc: x => x,
  STEP_LABEL: { plan: '版本计划', link: '关联条目与提交', docs: '文档编写', merge: '合并入 main', release: '正式发布' } });
vm.runInContext(nav, context);
for (const reason of ['文档有未提交修改，不得合并（请先提交文档）', '发布范围已变化，文档需重新核对 / 编写并重新提交']) {
  context.version = { pf: { plan: { steps: [{ key: 'merge', locked: true, reason }, { key: 'release', locked: true, reason }] } } };
  for (const step of ['docs', 'plan', 'merge']) {
    state.step = step;
    const html = vm.runInContext('renderStepNav(version)', context);
    for (const target of ['merge', 'release']) {
      const button = html.match(new RegExp('<button[^>]*data-step="' + target + '"[^>]*>'))[0];
      assert.doesNotMatch(button, /\s(?:disabled|aria-disabled)(?:[= >])/, `${step} → ${target} 必须可鼠标/键盘浏览`);
      assert.ok(button.includes(`title="${reason}"`), '保留门禁原因悬停说明');
    }
  }
}
console.log('✓ 文档门禁与步骤切换：合并/发布页可浏览，原因保留');
