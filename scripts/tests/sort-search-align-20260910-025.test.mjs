#!/usr/bin/env node
// REQ-20260910-025 排序下拉组件要和搜索框平齐 —— 定位组内排序与搜索等高平齐静态契约测试
// （沿用 sort-locate-group-20260910-016.test.mjs 的静态契约模式）
// 覆盖 test-cases.md 用例 A1–A6：
//   A1 等高平齐：定位组作用域内 .sort-select 与 .module-search 同规则显式同高（32px）
//   A2 组容器对齐契约沿用（016 不回退：flex / 居中 / 可换行 / 靠右）
//   A3 复用位置不破坏：基础 .sort-select 维持 24px；.global-search 基础规则无 height；.search-input 不变
//   A4 窄屏契约不回退（≤720px 分行 / 伸缩）
//   A5 行为契约不回退（HTML 结构 / syncReqSortVisibility 接线 / 反馈条位置）
//   A6 ui-demo 离线自包含守护
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const htmlSrc = fs.readFileSync(path.join(root, 'scripts', 'web', 'index.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(root, 'scripts', 'web', 'style.css'), 'utf8');
const jsSrc = fs.readFileSync(path.join(root, 'scripts', 'web', 'app.js'), 'utf8');
const itemDir = path.join(root, 'docs', 'agent-team-board', 'requirements', 'REQ-20260910-025');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// 规则提取：行首锚定的单一选择器声明块（避免命中作用域规则 / 注释）
const ruleOf = (css, selector) => css.match(new RegExp(`\\n${selector}\\s*\\{([^}]*)\\}`));

// A1 等高平齐（核心）：定位组作用域内排序下拉与搜索组同一规则显式同高
t('A1 等高平齐：`.page-head .locate-group .sort-select` 与 `.page-head .locate-group .module-search` 由同一声明块给定显式 height:32px（全局 border-box 下含边框等高、上下边缘对齐）；排序下拉水平内边距 ≥6px 保持可读', () => {
  const combined = cssSrc.match(
    /\.page-head \.locate-group \.sort-select,\s*\n\.page-head \.locate-group \.module-search\s*\{[^}]*\}/,
  );
  assert.ok(combined, '应以同一规则块为定位组内 .sort-select 与 .module-search 声明等高（两选择器合并书写）');
  assert.match(combined[0], /height:\s*32px/, '等高目标 32px（与需求演示「平齐后」一致）');
  assert.equal((cssSrc.match(/height:\s*32px/g) || []).length, 1, '32px 等高声明只出现一次（避免样式来源分裂）');
  // 可读造型：加高后水平内边距不小于 6px（基础 .sort-select 为 0 4px，太挤）
  const pad = cssSrc.match(/\.page-head \.locate-group \.sort-select\s*\{[^}]*\}/);
  assert.ok(pad, '应有定位组作用域的 .sort-select 独立规则（含内边距调整）');
  const m = pad[0].match(/padding:\s*0\s+(\d+)px/);
  assert.ok(m, '排序下拉应声明水平内边距');
  assert.ok(Number(m[1]) >= 6, `水平内边距应 ≥6px（当前 ${m[1]}px）`);
});

// A2 组容器对齐契约沿用（REQ-20260910-016 不回退；flex-wrap 口径由 BUG-20260911-001 修正为 nowrap）
t('A2 组容器对齐契约沿用：`.page-head .locate-group` 保持 display:flex / align-items:center / flex-wrap:nowrap（BUG-20260911-001：wrap 断行按 flex-basis 380px 打包，组宽 ≈<466px 时搜索组仍换行堆叠，min-width:0 不参与断行） / min-width:0 / margin-left:auto', () => {
  const grp = ruleOf(cssSrc, '\\.page-head \\.locate-group');
  assert.ok(grp, '应有 .page-head .locate-group 规则');
  assert.match(grp[1], /display:\s*flex/, 'flex 布局（排序与搜索相邻）');
  assert.match(grp[1], /align-items:\s*center/, '组内垂直居中（等高后上下边缘对齐）');
  assert.match(grp[1], /flex-wrap:\s*nowrap/, '组内恒不换行（BUG-20260911-001 修正；整组下移由 .page-head wrap 承担，不裁切不横向滚动）');
  assert.match(grp[1], /min-width:\s*0/, '定位组可收缩');
  assert.match(grp[1], /margin-left:\s*auto/, '宽屏定位组靠右');
});

// A3 复用位置不破坏：讨论筛选条行末 .sort-select、全局面板 .search-input 维持原尺寸口径
t('A3 复用位置不破坏：基础 `.sort-select` 仍 height:24px / padding:0 4px；基础 `.global-search` 规则不含显式 height；`.search-input` 基础规则 font-size:12.5px、padding:6px 2px 不变', () => {
  const sort = ruleOf(cssSrc, '\\.sort-select');
  assert.ok(sort, '应有基础 .sort-select 规则');
  assert.match(sort[1], /height:\s*24px/, '基础 .sort-select 维持 24px（讨论筛选条行末复用不受影响）');
  assert.match(sort[1], /padding:\s*0 4px/, '基础 .sort-select 水平内边距维持 0 4px');
  const gs = ruleOf(cssSrc, '\\.global-search');
  assert.ok(gs, '应有基础 .global-search 规则');
  assert.doesNotMatch(gs[1], /height:/, '等高不得写进基础 .global-search（仅限定位组作用域）');
  const si = ruleOf(cssSrc, '\\.search-input');
  assert.ok(si, '应有基础 .search-input 规则');
  assert.match(si[1], /font-size:\s*12\.5px/, '.search-input 字号不变（全局面板搜索复用）');
  assert.match(si[1], /padding:\s*6px 2px/, '.search-input 内边距不变（搜索组实际渲染高度口径不变）');
});

// A4 窄屏契约不回退（≤720px）
t('A4 窄屏契约不回退：≤720px 媒体查询保留定位组独占整行（flex:1 1 100%; margin-left:0）与搜索组伸缩（flex:1 1 auto; min-width:0）', () => {
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

// A5 行为契约不回退（静态）：结构 / 显隐接线 / 反馈条位置
t('A5 行为契约不回退：定位组内 #reqSort 位于 #searchInput 之前且初始 hidden、五选项保留；syncReqSortVisibility 存在并被 setView / renderBoard 调用；#searchFeedback 位于 #pageHead 之后且不混入定位组', () => {
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

// A6 ui-demo 离线自包含守护
t('A6 ui-demo 离线自包含：存在 ui-demo.html 且无外链脚本/样式/网络资源；含「现状 / 平齐后」对照、参考线、排序 / 搜索 / 模块切换与「正常 / 空 / 加载 / 失败」四态；README 含 ./ui-demo.html 链接', () => {
  const demoPath = path.join(itemDir, 'ui-demo.html');
  assert.ok(fs.existsSync(demoPath), '条目目录应存在 ui-demo.html');
  const demo = fs.readFileSync(demoPath, 'utf8');
  assert.doesNotMatch(demo, /<script[^>]*\ssrc=/i, '不得外链脚本');
  assert.doesNotMatch(demo, /<link[^>]*href=/i, '不得外链样式/资源');
  assert.doesNotMatch(demo, /@import/i, '不得 @import 外部样式');
  assert.doesNotMatch(demo, /url\(\s*['"]?https?:/i, '不得引用网络资源');
  for (const word of ['现状', '平齐后', '参考线', '列表排序', '搜索', '模块']) {
    assert.ok(demo.includes(word), `演示应包含「${word}」`);
  }
  for (const st of ['正常', '空', '加载', '失败']) {
    assert.ok(demo.includes(st), `演示应可切换「${st}」状态`);
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
