#!/usr/bin/env node
// REQ-20260910-006 列表行操作按钮平铺单行 —— 静态契约测试
// 用法：node scripts/tests/req-row-actions-inline.test.mjs
// 覆盖 test-cases.md 的 H1–H6；宽/中/窄容器断点、局部滚动与键盘焦点以浏览器实测。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// 需求列表行构造函数（app.js 的 function reqRowEl(it) { … }）
function reqRowFn() {
  const m = js.match(/function reqRowEl\(it\)[\s\S]*?\n\}/);
  assert.ok(m, '应存在 reqRowEl 函数');
  return m[0];
}

// 列表行操作区模板（reqRowEl 内 <span class="row-acts"> … </span>，内部仅按钮）
function rowActsTpl(fn) {
  const m = fn.match(/class="row-acts"[\s\S]*?<\/span>/);
  assert.ok(m, 'reqRowEl 应存在 .row-acts 操作区模板');
  return m[0];
}

// 列表行操作区规则体（style.css 的 .req-row .row-acts { … }）
function rowActsRule() {
  const m = css.match(/\.req-row \.row-acts\s*\{[^}]*\}/);
  assert.ok(m, '应存在 .req-row .row-acts 容器样式');
  return m[0];
}

t('H1 复制按钮移入操作区：row-acts 首个按钮为复制，信息区 .item-id 不再内嵌复制按钮', () => {
  const fn = reqRowFn();
  assert.match(fn, /itemIdHtml\(it\.id, \{ copy: false \}\)/, '列表行单号应取无复制按钮版本（copy: false）');
  const tpl = rowActsTpl(fn);
  // BUG-20260910-007：列表行复制按钮改图标模式（icon: true），模板复用关系不变
  assert.match(tpl, /copyIdBtnHtml\(it\.id, \{ icon: true \}\)/, '操作区内应以图标模式 copyIdBtnHtml 渲染复制按钮');
  const beforeActs = fn.slice(0, fn.indexOf('class="row-acts"'));
  assert.doesNotMatch(beforeActs, /copy-id-btn/, '复制按钮不得再出现在操作区之前的信息区内');
});

t('H2 按钮固定顺序：复制 → 接受 → 修改 → 删除，同排渲染于同一 .row-acts', () => {
  const tpl = rowActsTpl(reqRowFn());
  const copyAt = tpl.indexOf('copyIdBtnHtml(it.id, { icon: true })');
  const acceptAt = tpl.indexOf('data-accept-id');
  const renameAt = tpl.indexOf('data-rename-id');
  const deleteAt = tpl.indexOf('data-delete-id');
  for (const at of [copyAt, acceptAt, renameAt, deleteAt]) {
    assert.ok(at >= 0, '操作区应包含复制/接受/修改/删除四类按钮');
  }
  assert.ok(copyAt < acceptAt && acceptAt < renameAt && renameAt < deleteAt, '按钮顺序应为 复制 → 接受 → 修改 → 删除');
});

t('H3 操作区为不可拆分单行整体：nowrap 不内换行，极窄容器局部横向滚动不撑破页面', () => {
  const rule = rowActsRule();
  assert.match(rule, /display:\s*inline-flex/, '操作区应为 flex 行布局');
  assert.match(rule, /flex-wrap:\s*nowrap/, '四按钮必须同排，操作区内部不得换行');
  assert.match(rule, /flex:\s*none/, '操作区作为整体不被压缩拆分');
  assert.match(rule, /max-width:\s*100%/, '操作区不超过卡片宽度，避免页面级横向溢出');
  assert.match(rule, /overflow-x:\s*auto/, '极窄容器下操作区应局部横向滚动');
});

t('H4 按钮不折行不被挤压：行内按钮 flex:none 且文案 nowrap（复制成功文案变长仍单行）', () => {
  const rule = css.match(/\.req-row \.row-acts \.btn\s*\{[^}]*\}/);
  assert.ok(rule, '应为 .req-row .row-acts .btn 定义行内按钮规则');
  assert.match(rule[0], /flex:\s*none/, '行内按钮不应被压缩');
  assert.match(rule[0], /white-space:\s*nowrap/, '按钮文案不应折行');
});

t('H5 回归：接受/修改/删除仍仅在 submitted 条目渲染，非 submitted 行操作区仅剩复制', () => {
  const tpl = rowActsTpl(reqRowFn());
  for (const data of ['data-accept-id', 'data-rename-id', 'data-delete-id']) {
    const at = tpl.indexOf(data);
    assert.ok(at >= 0, `操作区应含 ${data} 按钮`);
    const cond = tpl.slice(0, at).match(/it\.status === 'submitted' \?/g) || [];
    assert.ok(cond.length > 0, `${data} 应以 submitted 为渲染条件`);
  }
  assert.doesNotMatch(tpl, /'submitted' \?[\s\S]{0,60}copyIdBtnHtml/, '复制按钮不得被 submitted 条件包裹');
});

t('H6 回归：详情抽屉与抽屉 Bug 子项仍用默认内嵌复制按钮的 itemIdHtml', () => {
  const drawer = js.match(/function renderDrawer\(\)[\s\S]*?\n\}/);
  assert.ok(drawer, '应存在 renderDrawer 函数');
  assert.match(drawer[0], /\$\{itemIdHtml\(it\.id\)\}/, '抽屉头部单号应保留内嵌复制按钮');
  assert.match(drawer[0], /\$\{itemIdHtml\(b\.id\)\}/, '抽屉 Bug 子项单号应保留内嵌复制按钮');
  assert.match(js, /function bindCopyIdButtons\(root\)[\s\S]*?data-copy-id[\s\S]*?copyId\(/, '复制按钮点击绑定（含冒泡阻断）应保持不变');
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
