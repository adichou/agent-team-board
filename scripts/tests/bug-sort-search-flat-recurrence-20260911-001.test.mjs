#!/usr/bin/env node
// BUG-20260911-001 排序下拉与搜索框仍未平齐（BUG-20260910-018 复发）——组内换行堆叠结构性不可达测试
// （沿用 bug-sort-search-flat-20260910-018.test.mjs 的静态契约模式）
// 复发根因：flex-wrap:wrap 的多行 flex 断行按各项「假设主尺寸」（flex-basis 经 min/max 截断）打包，
//   搜索组 flex:0 1 380px 的假设主尺寸恒为 380px——BUG-20260910-018 的 min-width:0 只解除收缩/最小内容
//   保底，不参与断行判定。组可用宽度 < 排序固有(~80px)+gap(6px)+380px ≈ 466px（视口 ≲ ~502px）时
//   搜索组仍被打包到第二行，两控件上下堆叠——「左右相邻」结构保证从未真正成立。
// 覆盖用例 C1–C7：
//   C1 组内恒不换行（核心）：.page-head .locate-group 声明 flex-wrap:nowrap——断行结构性不可达，
//      任意宽度排序与搜索恒同一行左右相邻；组容器其余对齐契约沿用；.page-head 保留 wrap（整组允许
//      移至副标题下方，属期望行为）
//   C2 极窄退化方式显式化：搜索组 flex-basis 380px / 组内 min-width:0 沿用；≤480px 隐藏定位组搜索内
//      辅助键位提示 .kbd-hint（不裁切主控件）；最小支持视口 320px 口径在 CSS 注释中声明
//   C3 等高平齐不回退（REQ-20260910-025：同高 32px 合并块，全文件唯一）
//   C4 复用位置不外溢（基础 .global-search 140px 保底 / 基础 .sort-select 24px 口径不变）
//   C5 窄屏契约不回退（≤720px 组独占整行 / 搜索伸缩；媒体查询内不得重开组内 wrap）
//   C6 行为契约不回退（DOM 顺序 / 显隐接线 / 五选项 / 反馈条位置）
//   C7 ui-demo 离线自包含守护（本条目目录）
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const htmlSrc = fs.readFileSync(path.join(root, 'scripts', 'web', 'index.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(root, 'scripts', 'web', 'style.css'), 'utf8');
const jsSrc = fs.readFileSync(path.join(root, 'scripts', 'web', 'app.js'), 'utf8');
const itemDir = path.join(root, 'docs', 'agent-team-board', 'bugs', 'BUG-20260911-001');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// 规则提取：行首锚定的单一选择器声明块（媒体查询内规则有缩进，不会被行首锚定命中）
const ruleOf = (css, selector) => css.match(new RegExp(`\\n${selector}\\s*\\{([^}]*)\}`));

// C1 组内恒不换行（核心修复）：nowrap 让断行在结构上不可达
t('C1 组内恒不换行：`.page-head .locate-group` 顶层规则声明 flex-wrap:nowrap——多行断行按 flex-basis(380px) 打包的堆叠路径（组宽 ≈<466px，视口 ≲~502px 触发）被结构性关闭，任意宽度排序在左、搜索在右恒同一行；display:flex / align-items:center / gap:6px / min-width:0 / max-width:100% / margin-left:auto 沿用；`.page-head` 保留 flex-wrap:wrap（空间不足时整组移至副标题下方仍允许）', () => {
  const grp = ruleOf(cssSrc, '\\.page-head \\.locate-group');
  assert.ok(grp, '应有 .page-head .locate-group 顶层规则');
  assert.match(grp[1], /flex-wrap:\s*nowrap/, '组内必须 nowrap：wrap 口径下断行按 flex-basis 380px 打包，min-width:0 无法阻止搜索组换行堆叠（BUG-20260911-001 根因）');
  assert.doesNotMatch(grp[1], /flex-wrap:\s*wrap/, '组内不得再声明 wrap（复发根因）');
  assert.match(grp[1], /display:\s*flex/, 'flex 布局（排序与搜索相邻）');
  assert.match(grp[1], /align-items:\s*center/, '组内垂直居中');
  assert.match(grp[1], /gap:\s*6px/, '组内间距沿用');
  assert.match(grp[1], /min-width:\s*0/, '定位组可收缩');
  assert.match(grp[1], /max-width:\s*100%/, '组不超出页面行宽');
  assert.match(grp[1], /margin-left:\s*auto/, '宽屏定位组靠右');
  const head = ruleOf(cssSrc, '\\.page-head');
  assert.ok(head, '应有 .page-head 规则');
  assert.match(head[1], /flex-wrap:\s*wrap/, '.page-head 保留 wrap：整组移至副标题下方仍允许（期望行为，不是组内堆叠）');
});

// C2 极窄退化方式显式化：nowrap 后搜索组全宽度收缩 + ≤480px 隐藏辅助键位提示 + 最小支持视口口径声明
t('C2 极窄退化方式显式化：`.page-head .module-search` 保留 flex:0 1 380px（宽屏基准）且 `.page-head .locate-group .module-search` 保留 min-width:0（018 成果，收缩不受 140px 保底限制）；≤480px 媒体查询内 `.page-head .module-search .kbd-hint` 声明 display:none（辅助键位提示让位，不裁切输入/范围标签/清除按钮）；定位组规则注释声明最小支持视口 320px（其下为未支持边界，不以此解释常规窗口堆叠）', () => {
  const searchBase = ruleOf(cssSrc, '\\.page-head \\.module-search');
  assert.ok(searchBase, '应有 .page-head .module-search 规则');
  assert.match(searchBase[1], /flex:\s*0 1 380px/, '搜索组宽屏基准 flex-basis 380px 沿用（nowrap 下仅作收缩基准，不再触发断行）');
  const scoped = [...cssSrc.matchAll(/\n\.page-head \.locate-group \.module-search\s*\{[^}]*\}/g)];
  assert.ok(
    scoped.some((m) => /min-width:\s*0/.test(m[0])),
    '定位组内搜索组应全宽度声明 min-width:0（018 成果不回退）',
  );
  const narrow480 = cssSrc.match(/@media \(max-width: 480px\) \{[\s\S]*?\n\}/);
  assert.ok(narrow480, '应有 ≤480px 极窄退化媒体查询');
  const kbd = narrow480[0].match(/\.page-head \.module-search \.kbd-hint\s*\{[^}]*\}/);
  assert.ok(kbd, '≤480px 应有 .page-head .module-search .kbd-hint 退化规则');
  assert.match(kbd[0], /display:\s*none/, '极窄时隐藏辅助键位提示（让位主控件，不裁切）');
  const grpComment = cssSrc.match(/\/\*(?:[^*]|\*(?!\/))*BUG-20260911-001(?:[^*]|\*(?!\/))*\*\/\s*\.page-head \.locate-group\s*\{/);
  assert.ok(grpComment, '定位组规则前应有标注 BUG-20260911-001 的说明注释');
  assert.match(grpComment[0], /320px/, '注释应声明最小支持视口 320px 口径（极窄边界显式化）');
});

// C3 等高平齐不回退（REQ-20260910-025 修复成果守护）
t('C3 等高平齐不回退：`.page-head .locate-group .sort-select` 与 `.page-head .locate-group .module-search` 仍由同一规则块显式同高 height:32px（全文件仅出现一次）', () => {
  const combined = cssSrc.match(
    /\.page-head \.locate-group \.sort-select,\s*\n\.page-head \.locate-group \.module-search\s*\{[^}]*\}/,
  );
  assert.ok(combined, '025 等高合并规则块保留');
  assert.match(combined[0], /height:\s*32px/, '等高目标 32px');
  assert.equal((cssSrc.match(/height:\s*32px/g) || []).length, 1, '32px 等高声明只出现一次（避免样式来源分裂）');
});

// C4 复用位置不外溢：顶栏 / 全局面板搜索与讨论筛选条行末排序下拉维持原口径
t('C4 复用位置不外溢：基础 `.global-search` 仍 min-width:140px；基础 `.sort-select` 仍 height:24px / padding:0 4px（讨论筛选条行末复用不受影响）', () => {
  const gs = ruleOf(cssSrc, '\\.global-search');
  assert.ok(gs, '应有基础 .global-search 规则');
  assert.match(gs[1], /min-width:\s*140px/, '基础 .global-search 140px 保底保留');
  const sort = ruleOf(cssSrc, '\\.sort-select');
  assert.ok(sort, '应有基础 .sort-select 规则');
  assert.match(sort[1], /height:\s*24px/, '基础 .sort-select 维持 24px');
  assert.match(sort[1], /padding:\s*0 4px/, '基础 .sort-select 水平内边距维持 0 4px');
});

// C5 窄屏契约不回退（≤720px 分行 / 组独占整行 / 搜索伸缩；媒体查询内不得重开组内 wrap）
t('C5 窄屏契约不回退：≤720px 媒体查询保留定位组独占整行（flex:1 1 100%; margin-left:0）与搜索组伸缩（flex:1 1 auto; min-width:0），且媒体查询内不出现任何把 .locate-group 改回 wrap 的声明', () => {
  const narrow = cssSrc.match(/@media \(max-width: 720px\) \{[\s\S]*?\n\}/);
  assert.ok(narrow, '应保留 ≤720px 窄屏适配');
  const grp = narrow[0].match(/\.page-head \.locate-group\s*\{[^}]*\}/);
  assert.ok(grp, '窄屏应有 .page-head .locate-group 规则');
  assert.match(grp[0], /flex:\s*1 1 100%/, '窄屏定位组独占整行（副标题与定位组分行）');
  assert.match(grp[0], /margin-left:\s*0/, '窄屏定位组不再靠右顶格');
  const search = narrow[0].match(/\.page-head \.module-search\s*\{[^}]*\}/);
  assert.ok(search, '窄屏应有 .page-head .module-search 规则');
  assert.match(search[0], /min-width:\s*0/, '窄屏搜索组可收缩（无横向溢出）');
  // 逐媒体查询块扫描（块内规则有缩进、块尾 } 顶格，\n} 只结束媒体块）：
  // 任何断点内不得把 .locate-group 改回 wrap（重开堆叠路径）
  for (const m of cssSrc.matchAll(/@media[^{]+\{([\s\S]*?)\n\}/g)) {
    const inBlock = m[1].match(/\.page-head \.locate-group\s*\{[^}]*flex-wrap:\s*wrap[^}]*\}/);
    assert.ok(!inBlock, `媒体查询内不得重开组内 wrap（${m[0].slice(0, 40).trim()}…）`);
  }
});

// C6 行为契约不回退（静态）：结构 / 显隐接线 / 反馈条位置
t('C6 行为契约不回退：定位组内 #reqSort 位于 #searchInput 之前（Tab 顺序排序 → 搜索）且初始 hidden、五选项保留；syncReqSortVisibility 存在并被 setView / renderBoard 调用；#searchFeedback 位于 #pageHead 之后且不混入定位组', () => {
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

// C7 ui-demo 离线自包含守护（本条目目录）
t('C7 ui-demo 离线自包含：存在 ui-demo.html 且无外链脚本/样式/网络资源；含「缺陷/期望」对照、参考线与宽度调整；README 含 ./ui-demo.html 链接', () => {
  const demoPath = path.join(itemDir, 'ui-demo.html');
  assert.ok(fs.existsSync(demoPath), '条目目录应存在 ui-demo.html');
  const demo = fs.readFileSync(demoPath, 'utf8');
  assert.doesNotMatch(demo, /<script[^>]*\ssrc=/i, '不得外链脚本');
  assert.doesNotMatch(demo, /<link[^>]*href=/i, '不得外链样式/资源');
  assert.doesNotMatch(demo, /@import/i, '不得 @import 外部样式');
  assert.doesNotMatch(demo, /url\(\s*['"]?https?:/i, '不得引用网络资源');
  for (const word of ['缺陷', '期望', '参考线']) {
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
