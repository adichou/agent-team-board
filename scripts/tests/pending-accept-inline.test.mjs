#!/usr/bin/env node
// REQ-20260906-020 待接受条目「✓ 接受」按钮移至单号行 —— 静态契约测试
// （REQ-20260907-004 布局重构：卡片 cardEl 改为列表行 reqRowEl，意图不变）
// 用法：node scripts/tests/pending-accept-inline.test.mjs
// 覆盖 test-cases.md 的 T1–T5；点击/禁用态动态行为由 accept-ui.test.mjs（A2/A13）回归。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const web = path.join(pluginRoot, 'scripts', 'web');
const js = fs.readFileSync(path.join(web, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(web, 'style.css'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// 需求列表行渲染函数（reqRowEl）整段源码
function rowElBlock() {
  const m = js.match(/function reqRowEl\(it\) \{[\s\S]*?\n\}/);
  assert.ok(m, '应存在 reqRowEl 列表行渲染函数');
  return m[0];
}

t('T1 按钮位置：✓ 接受按钮在首行单号行内（选择框、单号之后）', () => {
  const row = rowElBlock();
  const top = row.match(/<div class="card-top">([\s\S]*?)<\/div>/);
  assert.ok(top, '列表行应有首行 .card-top');
  const head = top[1];
  assert.match(head, /data-select-id=/, '首行应含待接受选择框');
  assert.doesNotMatch(head, /class="chip /, '首行不再含 REQ/BUG 类型徽章（BUG-20260908-004：单号前缀已区分类型）');
  // REQ-20260910-006：复制按钮自单号旁移入 .row-acts 操作区（copy: false），首行仍渲染单号
  assert.match(head, /\$\{itemIdHtml\(it\.id[^)]*\)\}/, '首行应渲染单号（复制控件由 copy-id 测试验证）');
  assert.match(head, /data-accept-id=/, '接受按钮应在首行内');
  const idxCheck = head.indexOf('data-select-id=');
  const idxCid = head.indexOf('itemIdHtml(it.id');
  const idxAccept = head.indexOf('data-accept-id=');
  assert.ok(idxCid > idxCheck, '顺序：选择框在单号之前');
  assert.ok(idxAccept > idxCid, '顺序：接受按钮在单号之后');
});

t('T2 旧布局移除：行模板不再有 .card-accept 底部按钮行，样式一并清理', () => {
  assert.doesNotMatch(rowElBlock(), /class="card-accept"/, '行模板不应再有 .card-accept 容器');
  assert.doesNotMatch(js, /class="card-accept"/, 'app.js 不应再出现 .card-accept 容器');
  assert.doesNotMatch(css, /\.card-accept[\s.,{]/, 'style.css 不应残留 .card-accept 选择器');
});

t('T3 交互保留：data-accept-id 取按钮、点击不冒泡单条接受、渲染初始化与轮询同步禁用态', () => {
  const row = rowElBlock();
  assert.match(row, /const accept = el\.querySelector\('\[data-accept-id\]'\)/, 'reqRowEl 仍按 data-accept-id 取按钮');
  assert.match(row, /accept\.addEventListener\('click'[\s\S]*?stopPropagation\(\);[\s\S]*?return acceptItems\(\[it\.id\], \{ single: true \}\)/, '点击应 stopPropagation 并单条接受（single：免确认 + toast 撤销，REQ-20260910-011）');
  assert.match(row, /accept\.disabled = state\.acceptance\.pending/, '渲染时接受按钮应初始化禁用态');
  assert.match(js, /querySelectorAll\('\[data-accept-id\], \[data-act="accepted"\]'\)/, 'syncAcceptance 仍按 data-accept-id 同步禁用');
});

t('T4 样式：行内接受按钮紧凑尺寸、不被压缩，禁用态保留', () => {
  // BUG-20260910-007：接受/修改按钮图标化，尺寸改由 .req-row .row-acts .btn.icon-act 统一定宽
  assert.match(css, /\.req-row \.row-acts \.btn\.icon-act\s*\{[^}]*min-width:\s*\d+px/, '行内图标操作按钮应保持定宽紧凑尺寸');
  assert.match(css, /\.req-row \.row-acts\s*\{[^}]*flex:\s*none/, '行内操作区应 flex:none 不被压缩');
  assert.match(css, /\.card-accept-btn:disabled,\s*\.card-rename-btn:disabled\s*\{[^}]*opacity:\s*0\.5/, '禁用态样式应保留');
});

t('T5 其他状态不受影响：接受按钮仅限 submitted 分支，planned 行仍为批量开发复选框（REQ-20260908-010）', () => {
  const row = rowElBlock();
  assert.match(row, /\$\{it\.status === 'submitted' \? `[^`]*data-accept-id/, '接受按钮应仅在 submitted 分支渲染');
  assert.match(row, /\$\{it\.status === 'planned' \? `[^`]*data-impl-id/, 'planned 行首仍为批量开发复选框');
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
