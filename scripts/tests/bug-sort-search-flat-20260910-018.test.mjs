#!/usr/bin/env node
// BUG-20260910-018 排序下拉组件没有和搜索框平齐 —— 定位组内「左右相邻不堆叠」结构契约测试
// （沿用 sort-search-align-20260910-025.test.mjs 的静态契约模式）
// 覆盖用例 B1–B6：
//   B1 左右相邻结构保证（核心）：定位组内搜索组在所有宽度声明 min-width:0（解除基础 .global-search
//      140px 保底在组内的作用，此前仅 ≤720px 媒体查询内生效），组内换行堆叠在常规与逐步缩窄宽度下
//      结构性不可达；组容器 flex-wrap 口径由 BUG-20260911-001（复发）修正为 nowrap——
//      本单 min-width:0 不参与 wrap 断行判定（断行按 flex-basis 380px 打包）
//   B2 等高平齐不回退（REQ-20260910-025 修复成果，本 Bug 高度侧依赖）
//   B3 复用位置不外溢：基础 .global-search 140px 保底 / 基础 .sort-select 24px 口径不变
//   B4 窄屏契约不回退（≤720px 分行 / 组独占整行 / 搜索伸缩）
//   B5 行为契约不回退（DOM 顺序 / 显隐接线 / 五选项 / 反馈条位置）
//   B6 ui-demo 离线自包含守护
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const htmlSrc = fs.readFileSync(path.join(root, 'scripts', 'web', 'index.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(root, 'scripts', 'web', 'style.css'), 'utf8');
const jsSrc = fs.readFileSync(path.join(root, 'scripts', 'web', 'app.js'), 'utf8');
const itemDir = path.join(root, 'docs', 'agent-team-board', 'bugs', 'BUG-20260910-018');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// 规则提取：行首锚定的单一选择器声明块（媒体查询内规则有缩进，不会被行首锚定命中）
const ruleOf = (css, selector) => css.match(new RegExp(`\\n${selector}\\s*\\{([^}]*)\\}`));

// B1 左右相邻结构保证（核心）：定位组内搜索组全宽度 min-width:0
t('B1 左右相邻结构保证：`.page-head .locate-group .module-search` 存在顶层（非媒体查询内）独立规则并声明 min-width:0——组内 min-content 收敛为排序下拉固有宽度，常规与缩窄宽度下排序与搜索恒同一行左右相邻、不换行堆叠；`.page-head .locate-group` 组容器 flex-wrap:nowrap（BUG-20260911-001 修正：wrap 断行按 flex-basis 380px 打包，min-width:0 不参与断行，组宽 ≈<466px 时搜索组仍换行） / gap:6px / min-width:0 / margin-left:auto 口径沿用', () => {
  const scoped = [...cssSrc.matchAll(/\n\.page-head \.locate-group \.module-search\s*\{[^}]*\}/g)];
  assert.ok(scoped.length > 0, '应有 `.page-head .locate-group .module-search` 顶层独立规则（区别于 025 等高合并块与 ≤720px 缩进规则）');
  assert.ok(
    scoped.some((m) => /min-width:\s*0/.test(m[0])),
    '定位组内搜索组应全宽度声明 min-width:0（不再仅 ≤720px 生效，换行堆叠结构性不可达）',
  );
  const grp = ruleOf(cssSrc, '\\.page-head \\.locate-group');
  assert.ok(grp, '应有 .page-head .locate-group 规则');
  assert.match(grp[1], /display:\s*flex/, 'flex 布局（排序与搜索相邻）');
  assert.match(grp[1], /align-items:\s*center/, '组内垂直居中');
  assert.match(grp[1], /flex-wrap:\s*nowrap/, '组内恒不换行（BUG-20260911-001 修正原 wrap 极窄口径；整组下移由 .page-head wrap 承担，不裁切、不横向滚动）');
  assert.match(grp[1], /gap:\s*6px/, '组内间距沿用');
  assert.match(grp[1], /min-width:\s*0/, '定位组可收缩');
  assert.match(grp[1], /margin-left:\s*auto/, '宽屏定位组靠右');
});

// B2 等高平齐不回退（REQ-20260910-025 修复成果守护：本 Bug「高度一致」侧的实现依赖）
t('B2 等高平齐不回退：`.page-head .locate-group .sort-select` 与 `.page-head .locate-group .module-search` 仍由同一规则块显式同高 height:32px（全文件仅出现一次）', () => {
  const combined = cssSrc.match(
    /\.page-head \.locate-group \.sort-select,\s*\n\.page-head \.locate-group \.module-search\s*\{[^}]*\}/,
  );
  assert.ok(combined, '025 等高合并规则块保留');
  assert.match(combined[0], /height:\s*32px/, '等高目标 32px');
  assert.equal((cssSrc.match(/height:\s*32px/g) || []).length, 1, '32px 等高声明只出现一次（避免样式来源分裂）');
});

// B3 复用位置不外溢：顶栏 / 全局面板搜索与讨论筛选条行末排序下拉维持原口径
t('B3 复用位置不外溢：基础 `.global-search` 仍 min-width:140px（顶栏 / 全局面板保底不因定位组解除）；基础 `.sort-select` 仍 height:24px / padding:0 4px（讨论筛选条行末复用不受影响）', () => {
  const gs = ruleOf(cssSrc, '\\.global-search');
  assert.ok(gs, '应有基础 .global-search 规则');
  assert.match(gs[1], /min-width:\s*140px/, '基础 .global-search 140px 保底保留（min-width:0 仅限定位组作用域）');
  const sort = ruleOf(cssSrc, '\\.sort-select');
  assert.ok(sort, '应有基础 .sort-select 规则');
  assert.match(sort[1], /height:\s*24px/, '基础 .sort-select 维持 24px');
  assert.match(sort[1], /padding:\s*0 4px/, '基础 .sort-select 水平内边距维持 0 4px');
});

// B4 窄屏契约不回退（≤720px 分行 / 组独占整行 / 搜索伸缩）
t('B4 窄屏契约不回退：≤720px 媒体查询保留定位组独占整行（flex:1 1 100%; margin-left:0）与搜索组伸缩（flex:1 1 auto; min-width:0）', () => {
  const narrow = cssSrc.match(/@media \(max-width: 720px\) \{[\s\S]*?\n\}/);
  assert.ok(narrow, '应保留 ≤720px 窄屏适配');
  const grp = narrow[0].match(/\.page-head \.locate-group\s*\{[^}]*\}/);
  assert.ok(grp, '窄屏应有 .page-head .locate-group 规则');
  assert.match(grp[0], /flex:\s*1 1 100%/, '窄屏定位组独占整行（副标题与定位组分行）');
  assert.match(grp[0], /margin-left:\s*0/, '窄屏定位组不再靠右顶格');
  const search = narrow[0].match(/\.page-head \.module-search\s*\{[^}]*\}/);
  assert.ok(search, '窄屏应有 .page-head .module-search 规则');
  assert.match(search[0], /min-width:\s*0/, '窄屏搜索组可收缩（无横向溢出）');
});

// B5 行为契约不回退（静态）：结构 / 显隐接线 / 反馈条位置
t('B5 行为契约不回退：定位组内 #reqSort 位于 #searchInput 之前（Tab 顺序排序 → 搜索）且初始 hidden、五选项保留；syncReqSortVisibility 存在并被 setView / renderBoard 调用；#searchFeedback 位于 #pageHead 之后且不混入定位组', () => {
  const group = htmlSrc.match(/<div id="locateGroup"[\s\S]*?<\/div>\s*<\/section>/);
  assert.ok(group, '应存在定位组 #locateGroup');
  assert.ok(group[0].indexOf('id="reqSort"') < group[0].indexOf('id="searchInput"'), '排序仍在搜索之前（Tab 顺序排序 → 搜索）');
  assert.match(htmlSrc.match(/<select id="reqSort"[^>]*>/)[0], /class="[^"]*\bhidden\b[^"]*"/, '#reqSort 初始 hidden（显隐口径不变）');
  const sortSel = htmlSrc.match(/<select id="reqSort"[\s\S]*?<\/select>/);
  for (const [v, label] of [
    ['updated-desc', '最新更新'], ['updated-asc', '最早更新'],
    ['created-desc', '最新创建'], ['created-asc', '最早创建'], ['id-asc', '单号'],
  ]) assert.ok(sortSel[0].includes(`value="${v}"`) && sortSel[0].includes(`>${label}<`), `排序选项 ${label} 保留`);
  assert.match(jsSrc, /function syncReqSortVisibility\(\)/, '显隐同步函数保留');
  assert.match(jsSrc.match(/function setView\(v\) \{[\s\S]*?\n\}/)[0], /syncReqSortVisibility\(\)/, 'setView 仍调用显隐同步');
  assert.match(jsSrc.match(/function renderBoard\(\) \{[\s\S]*?if \(!b\.initialized\) return;/)[0], /syncReqSortVisibility\(\)/, 'renderBoard 初始化早退前仍调用显隐同步');
  const iHeadEnd = htmlSrc.indexOf('</section>', htmlSrc.indexOf('<section id="pageHead"'));
  assert.ok(htmlSrc.indexOf('<section id="searchFeedback"') > iHeadEnd, '#searchFeedback 仍在 #pageHead 之后');
  assert.ok(!group[0].includes('searchFeedback'), '反馈条不混入定位组');
});

// B6 ui-demo 离线自包含守护
t('B6 ui-demo 离线自包含：存在 ui-demo.html 且无外链脚本/样式/网络资源；含「缺陷现状 / 修复后」对照开关、参考线与宽度滑块；README 含 ./ui-demo.html 链接', () => {
  const demoPath = path.join(itemDir, 'ui-demo.html');
  assert.ok(fs.existsSync(demoPath), '条目目录应存在 ui-demo.html');
  const demo = fs.readFileSync(demoPath, 'utf8');
  assert.doesNotMatch(demo, /<script[^>]*\ssrc=/i, '不得外链脚本');
  assert.doesNotMatch(demo, /<link[^>]*href=/i, '不得外链样式/资源');
  assert.doesNotMatch(demo, /@import/i, '不得 @import 外部样式');
  assert.doesNotMatch(demo, /url\(\s*['"]?https?:/i, '不得引用网络资源');
  for (const word of ['缺陷现状', '修复', '参考线', '滑块']) {
    assert.ok(demo.includes(word), `演示应包含「${word}」`);
  }
  const readme = fs.readFileSync(path.join(itemDir, 'README.md'), 'utf8');
  assert.match(readme, /\]\(\.\/ui-demo\.html\)/, 'README 需含 ./ui-demo.html 相对链接');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
