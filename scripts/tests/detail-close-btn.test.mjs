#!/usr/bin/env node
// REQ-20260906-005 详情页关闭按钮固定在单号右侧 —— 静态契约测试
// 用法：node scripts/tests/detail-close-btn.test.mjs
// 覆盖 test-cases.md 的 T1–T4；B1 为浏览器实测。

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

// 详情抽屉（renderDrawer）函数体：REQ-20260906-005 的契约只约束详情抽屉；
// 批量抽屉 renderBatchDrawer（REQ-20260906-002）头部曾以内联布局实现，BUG-20260906-011
// 曾将 T2 断言收窄到 renderDrawer；BUG-20260906-016 消除批量抽屉头部残留的内联
// space-between（改 .batch-head 类承载）后，T5 恢复 app.js 全局无内联 space-between 断言；
// BUG-20260909-014 整行移除批量抽屉 .batch-head（项目路径 + ✕ 关闭按钮），T5 随之改为
// 断言该行已不存在且全局仍无内联 space-between。
function renderDrawerJs() {
  const m = js.match(/function renderDrawer\(\)[\s\S]*?\n\}/);
  assert.ok(m, '应存在 renderDrawer 函数');
  return m[0];
}

// 抽屉头部模板块（renderDrawer 内 <header class="drawer-head">…</header>）
function drawerHeadBlock() {
  const m = renderDrawerJs().match(/<header class="drawer-head">[\s\S]*?<\/header>/);
  assert.ok(m, '应存在 drawer-head 头部模板');
  return m[0];
}

t('T1 关闭按钮固定单号右侧：#drawerClose 在单号及复制控件之后、待测试 flag 之前', () => {
  const head = drawerHeadBlock();
  assert.match(head, /class="card-top"/, '头部应有单号行 .card-top');
  const top = head.match(/<div class="card-top">([\s\S]*?)<\/div>/);
  assert.ok(top, '.card-top 应为独立单号行容器');
  const row = top[1];
  assert.doesNotMatch(row, /class="chip /, '单号行不再含 REQ/BUG 类型徽章（BUG-20260908-004：单号前缀已区分类型）');
  assert.match(row, /\$\{itemIdHtml\(it\.id\)\}/, '单号行应渲染单号和复制控件（行为由 copy-id 测试验证）');
  assert.match(row, /id="drawerClose"/, '关闭按钮应在单号行内');
  const idxCid = row.indexOf('${itemIdHtml(it.id)}');
  const idxClose = row.indexOf('id="drawerClose"');
  const idxFlag = row.indexOf('class="flag"');
  assert.ok(idxClose > idxCid, '顺序：关闭按钮在单号之后（紧邻右侧）');
  assert.ok(idxFlag === -1 || idxFlag > idxClose, '顺序：「待测试」flag 在关闭按钮之后');
});

t('T2 旧布局移除：不再 space-between 两端结构，标题独占一行（断言范围限 renderDrawer 详情抽屉，BUG-20260906-011 收窄）', () => {
  const fn = renderDrawerJs();
  assert.doesNotMatch(fn, /justify-content:space-between/, '详情抽屉头部模板不应再有 space-between 内联布局');
  const headRule = css.match(/\.drawer-head\s*\{[^}]*\}/);
  assert.ok(headRule, '应存在 .drawer-head 样式');
  assert.doesNotMatch(headRule[0], /space-between/, '.drawer-head 不应再两端布局');
  assert.doesNotMatch(headRule[0], /display:\s*flex/, '.drawer-head 应为纵向普通块（card-top 上、h2 下）');
  const h2 = drawerHeadBlock().match(/<h2>/);
  assert.ok(h2, '标题 h2 应仍在头部内');
  // h2 与单号行不再同层左右并排：card-top 关闭后 h2 才出现，且 h2 不在 flex 两端布局内
  assert.match(fn, /class="card-top">[\s\S]*?<\/div>\s*<h2>/, 'h2 应紧跟单号行之后独占一行');
});

t('T3 关闭交互保留：click 绑定 closeDrawer，Escape 兜底关闭', () => {
  assert.match(js, /\$\('#drawerClose'\)\.addEventListener\('click', closeDrawer\)/, '关闭按钮应绑定 closeDrawer');
  // REQ-20260910-007：Escape 链收敛进 onGlobalKeydown，抽屉兜底前新增帮助 / 项目管理两层（一次只关一层），
  // 行为不变（shortcuts-20260910-007 K7 行为用例覆盖），字面窗口相应放宽。
  // BUG-20260910-004：链中再插入全局任务面板一层（弹窗 → 全局面板 → 抽屉），窗口随之再放宽
  // REQ-20260911-001：链中再插入待接受编辑面板一层（编辑层 → … → 抽屉，详情保留），窗口随之再放宽
  // REQ-20260914-001：链中再插入挂起确认面板一层（确认层 → 编辑层 → … → 抽屉），窗口随之再放宽
  assert.match(js, /Escape[\s\S]{0,1100}closeDrawer\(\)/, 'Escape 应兜底关闭抽屉');
});

t('T4 样式：行内关闭按钮不被压缩且尺寸适配单号行', () => {
  assert.match(css, /\.card-top \.icon-btn\s*\{[^}]*flex:\s*none/, '行内 icon-btn 应 flex:none 不被压缩');
  assert.match(css, /\.card-top \.icon-btn\s*\{[^}]*padding/, '行内 icon-btn 应有适配单号行的 padding');
});

t('T5 全局无内联 space-between：批量抽屉 .batch-head 行已整行移除（BUG-20260909-014）', () => {
  assert.doesNotMatch(js, /justify-content:\s*space-between/, 'app.js 全局不应再有内联 space-between 布局（REQ-20260906-005 契约）');
  const fn = js.match(/function renderBatchDrawer\(\)[\s\S]*?\n\}/);
  assert.ok(fn, '应存在 renderBatchDrawer 函数');
  assert.doesNotMatch(fn[0], /class="batch-head"/, '批量抽屉头部不应再渲染 .batch-head 行（路径 + ✕ 已随 BUG-20260909-014 移除）');
  assert.doesNotMatch(css, /\.batch-head\s*\{/, 'style.css 不应再保留失效的 .batch-head 类样式');
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
