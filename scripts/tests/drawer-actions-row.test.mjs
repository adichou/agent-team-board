#!/usr/bin/env node
// REQ-20260908-006 详情页操作按钮横向布局 —— 静态契约测试
// 用法：node scripts/tests/drawer-actions-row.test.mjs
// 覆盖 test-cases.md 的 H1–H4；B1 为浏览器实测。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// 中栏容器规则体（style.css 的 .drawer-actions-center { … }）
function centerRule() {
  const m = css.match(/\.drawer-actions-center\s*\{[^}]*\}/);
  assert.ok(m, '应存在 .drawer-actions-center 容器样式');
  return m[0];
}

// 详情抽屉中栏模板（renderDrawer 内 .drawer-actions-center …）
function centerTpl() {
  const m = js.match(/<div class="drawer-actions-center">[\s\S]{0,300}/);
  assert.ok(m, '详情抽屉应存在 .drawer-actions-center 中栏模板');
  return m[0];
}

t('H1 操作按钮横向一行：中栏 flex-direction: row（不再 column）、水平居中、允许整按钮换行', () => {
  const rule = centerRule();
  assert.match(rule, /flex-direction:\s*row/, '中栏应为横向布局');
  assert.doesNotMatch(rule, /flex-direction:\s*column/, '不应再纵向堆叠');
  assert.match(rule, /justify-content:\s*center/, '横向整体应居中');
  assert.match(rule, /flex-wrap:\s*wrap/, '窄屏放不下时应整按钮换行而非挤压');
});

t('H2 按钮不被压缩：行内 .btn flex:none 且文案不折行（换行交给容器 wrap）', () => {
  const rule = css.match(/\.drawer-actions-center \.btn\s*\{[^}]*\}/);
  assert.ok(rule, '应为 .drawer-actions-center .btn 定义行内按钮规则');
  assert.match(rule[0], /flex:\s*none/, '行内按钮不应被压缩');
  assert.match(rule[0], /white-space:\s*nowrap/, '按钮文案不应折行');
});

t('H3 行内垂直居中：容器 align-items: center；1 / N 序号不断行', () => {
  const rule = centerRule();
  assert.match(rule, /align-items:\s*center/, '按钮与序号应在行内垂直居中');
  const pos = css.match(/\.drawer-nav-pos\s*\{[^}]*\}/);
  assert.ok(pos, '应存在 .drawer-nav-pos 序号样式');
  assert.match(pos[0], /white-space:\s*nowrap/, '序号 1 / N 不应断行');
});

t('H4 回归：模板结构不动——notice 独立成行在操作行上方，中栏仍只含按钮 + 序号', () => {
  const fn = js.match(/function renderDrawer\(\)[\s\S]*?\n\}/);
  assert.ok(fn, '应存在 renderDrawer 函数');
  assert.match(fn[0], /drawerActionsNoticeHtml\(it\)[\s\S]{0,120}<div class="drawer-actions">/, 'notice 应仍在操作行之前独立成行');
  const tpl = centerTpl();
  assert.doesNotMatch(tpl, /notice/, '中栏不得包含说明文字');
  assert.match(tpl, /drawerActionsButtonHtml/, '中栏应放操作按钮');
  assert.match(tpl, /drawer-nav-pos/, '中栏末尾应保留 1 / N 序号');
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
