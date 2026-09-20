#!/usr/bin/env node
// REQ-20260916-006 挂起确认面板「查看差异」语义渲染 —— 解析 / 折叠 / 新文件 / 统一并排 /
// 字符级高亮 / 挂载行为 / i18n / 接线契约 测试。
// 用法：node scripts/tests/req-20260916-006.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { makeScanner, extractFragments } from './lib/js-string-scanner.mjs';
import '../web/i18n.js';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const diffViewSrc = fs.readFileSync(path.join(webRoot, 'diff-view.js'), 'utf8');
const appJs = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const styleCss = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');
const serverJs = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// diff-view.js 在无 document 的 vm 上下文加载（加载期不触碰 DOM；mount 由假 DOM 驱动）
const ctx = vm.createContext({ console });
vm.runInContext(diffViewSrc, ctx, { filename: 'diff-view.js' });
const DV = ctx.ATBDiffView;
assert.ok(DV, 'diff-view.js 应在 globalThis.ATBDiffView 暴露接口');

const I = globalThis.ATBI18N;
const { EN, EN_DYNAMIC } = I._dict;

// ---------- 样例 diff（行号与 git diff HEAD 原文一致） ----------

const SAMPLE = [
  'diff --git a/scripts/lib/impl.mjs b/scripts/lib/impl.mjs',
  'index 3e1f2ab..9c4d5e6 100644',
  '--- a/scripts/lib/impl.mjs',
  '+++ b/scripts/lib/impl.mjs',
  '@@ -1,4 +1,5 @@',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
  '+const c = 3;',
  ' // tail',
  ' // more',
  '@@ -20,4 +21,4 @@ function x() {',
  '  ctx20',
  '  ctx21',
  '-removed',
  '+replaced',
  '  ctx23',
  '\\ No newline at end of file',
].join('\n');

// ---------- T1 解析 ----------

t('T1 解析 unified diff：行分类与旧/新行号与 git 原文一致（含注记行不计行号）', () => {
  const m = DV.parseDiff(SAMPLE);
  assert.equal(m.kind, 'diff');
  const rows = m.rows;
  assert.equal(rows[0].type, 'meta', 'diff --git 头为元信息行');
  assert.equal(rows.filter((r) => r.type === 'meta').length, 4, '4 行文件头元信息');
  const h1 = rows.find((r) => r.type === 'hunk');
  assert.equal(h1.text, '@@ -1,4 +1,5 @@', 'hunk 头原文保留');
  const byPos = (i) => rows[i];
  // 第一个 hunk：ctx old1/new1 → del old2 → add new2 → add new3 → ctx old3/new4 → ctx old4/new5
  assert.deepEqual([byPos(5).type, byPos(5).oldLine, byPos(5).newLine], ['ctx', 1, 1]);
  assert.deepEqual([byPos(6).type, byPos(6).oldLine, byPos(6).newLine], ['del', 2, null]);
  assert.deepEqual([byPos(7).type, byPos(7).oldLine, byPos(7).newLine], ['add', null, 2]);
  assert.deepEqual([byPos(8).type, byPos(8).oldLine, byPos(8).newLine], ['add', null, 3]);
  assert.deepEqual([byPos(9).type, byPos(9).oldLine, byPos(9).newLine], ['ctx', 3, 4]);
  assert.deepEqual([byPos(10).type, byPos(10).oldLine, byPos(10).newLine], ['ctx', 4, 5]);
  // 第二个 hunk（带节标题）：ctx old20/new21 → ctx old21/new22 → del old22 → add new23 → ctx old23/new24
  assert.equal(byPos(11).text, '@@ -20,4 +21,4 @@ function x() {');
  assert.deepEqual([byPos(12).oldLine, byPos(12).newLine], [20, 21]);
  assert.deepEqual([byPos(13).oldLine, byPos(13).newLine], [21, 22]);
  assert.deepEqual([byPos(14).type, byPos(14).oldLine, byPos(14).newLine], ['del', 22, null]);
  assert.deepEqual([byPos(15).type, byPos(15).oldLine, byPos(15).newLine], ['add', null, 23]);
  assert.deepEqual([byPos(16).oldLine, byPos(16).newLine], [23, 24]);
  // 末尾 \ No newline 注记：单列呈现且不消费行号
  assert.equal(byPos(17).type, 'note');
  assert.equal(byPos(17).oldLine ?? null, null);
  // 行内容去掉标记前缀
  assert.equal(byPos(7).text, 'const b = 3;');
});

t('T1b 计数缺省 hunk 头（@@ -1 +1 @@）按 1 行消费推进', () => {
  const m = DV.parseDiff(['@@ -1 +1 @@', '-old', '+new'].join('\n'));
  const rows = m.rows;
  assert.deepEqual([rows[1].type, rows[1].oldLine], ['del', 1]);
  assert.deepEqual([rows[2].type, rows[2].newLine], ['add', 1]);
});

// ---------- T2 上下文折叠 ----------

function mkFoldSample() {
  const lines = ['@@ -1,25 +1,26 @@', ' head'];
  lines.push('-old1');
  for (let i = 1; i <= 20; i++) lines.push(` CTXHIDDEN${String(i).padStart(2, '0')}`);
  lines.push('+new1', '+new2', ' tail');
  // 不足 MIN_FOLD（8）的短上下文段：6 行
  lines.push('-old2', ' short1', ' short2', ' short3', ' short4', ' short5', ' short6', '+new3');
  return lines.join('\n');
}

t('T2 长段上下文默认折叠（≥8 收中段、头尾各留 3）；短段不折叠；展开后就地展开且不影响其他段', () => {
  const m = DV.parseDiff(mkFoldSample());
  const segs = DV.foldSegments(m.rows);
  assert.equal(segs.length, 1, `只有一段 20 行上下文应折叠：${JSON.stringify(segs.map((s) => s.count))}`);
  assert.equal(segs[0].count, 14, '20 − 头 3 − 尾 3 = 14 行收进折叠段');

  const collapsed = DV.renderUnified(m, new Set());
  assert.ok(collapsed.includes('⋯ 展开 14 行未变更上下文 ⋯'), '折叠操作行应显示收起行数');
  assert.ok(!collapsed.includes('CTXHIDDEN07'), '折叠中段默认不渲染（改动行始终可见）');
  assert.ok(collapsed.includes('CTXHIDDEN03') && collapsed.includes('CTXHIDDEN18'), '头尾各留 3 行');
  assert.ok(collapsed.includes('short3'), '不足 8 行的短上下文段不折叠');

  const expanded = DV.renderUnified(m, new Set([segs[0].id]));
  assert.ok(expanded.includes('CTXHIDDEN07'), '展开后中段可见');
  assert.ok(!expanded.includes('dv-unfold'), '全部段展开后不再有折叠操作行');
});

// ---------- T3 新文件 ----------

t('T3 未跟踪新文件：整文件按新增行呈现，头部标注「（新文件，未纳入版本控制）」', () => {
  const text = `（新文件，未纳入版本控制）\n${'='.repeat(60)}\nline1\n<b>bold</b>\nline3`;
  const m = DV.parseDiff(text);
  assert.equal(m.kind, 'newfile');
  assert.equal(m.notice, '（新文件，未纳入版本控制）');
  assert.equal(m.rows.length, 3);
  for (const [i, r] of m.rows.entries()) {
    assert.equal(r.type, 'add', `第 ${i + 1} 行应为新增`);
    assert.equal(r.newLine, i + 1, '新行号从 1 递增');
    assert.equal(r.oldLine, null, '新文件无旧行号');
  }
  const html = DV.renderUnified(m, new Set());
  assert.ok(html.includes('（新文件，未纳入版本控制）'), '头部标注提示');
  assert.ok((html.match(/dv-row dv-u-row dv-add/g) || []).length === 3, '全部行按新增渲染');
  assert.ok(html.includes('&lt;b&gt;'), '文件内容须转义');
});

// ---------- T4 统一视图渲染 ----------

t('T4 统一视图：四类行样式类可区分、行首标记保留、行号列呈现、内容置于 CODE 且转义', () => {
  const m = DV.parseDiff(SAMPLE);
  const html = DV.renderUnified(m, new Set());
  for (const cls of ['dv-hunk', 'dv-ctx', 'dv-add', 'dv-del']) {
    assert.ok(new RegExp(`class="[^"]*${cls}`).test(html), `应有 ${cls} 行样式类`);
  }
  assert.match(html, /dv-s-add">[^<]*\+/, '新增行行首 + 标记保留');
  assert.match(html, /dv-s-del">[^<]*-/, '删除行行首 − 标记保留');
  assert.match(html, /<code[^>]*>const a = 1;<\/code>/, '上下文行内容置于 CODE（翻译层跳过用户数据）');
  const addIdx = html.indexOf('const b = ');
  assert.ok(addIdx > 0 && html.slice(addIdx - 200, addIdx + 200).includes('dv-code'), '行内容置于 CODE');
  assert.ok(!html.includes('&gt;const b'), '行内容不被二次转义');
  const delRow = html.slice(html.indexOf('dv-u-row dv-del'), html.indexOf('dv-u-row dv-del') + 400);
  assert.ok(/dv-no">2</.test(delRow) && /dv-s-del/.test(delRow), '删除行含旧行号 2 与 − 标记列');
  assert.ok(/dv-no"><\/span>/.test(delRow), '删除行无新行号');
  const addRow = html.slice(html.indexOf('dv-u-row dv-add'), html.indexOf('dv-u-row dv-add') + 400);
  assert.ok(/dv-s-add/.test(addRow) && /dv-no"><\/span>/.test(addRow), '新增行含 + 标记且无旧行号');
});

// ---------- T5 并排视图 ----------

t('T5 并排视图：成对删除/新增行左右对齐同一行，未配对行单侧呈现，两栏行号正确', () => {
  const m = DV.parseDiff(SAMPLE);
  const html = DV.renderSplit(m, new Set());
  // 第一 hunk：del『const b = 2;』与 add『const b = 3;』成对同行（字符级高亮拆分中段）
  const pairIdx = html.indexOf('<span class="dv-ch">2</span>');
  assert.ok(pairIdx > 0, '并排视图应包含删除侧字符片段');
  const pairRow = html.slice(html.lastIndexOf('dv-s-row', pairIdx), pairIdx + 600);
  assert.ok(/class="dv-old">const b = <span class="dv-ch">2<\/span>;</.test(pairRow), '左删（含字符片段）');
  assert.ok(/class="dv-new">const b = <span class="dv-ch">3<\/span>;</.test(pairRow), '右增与删除行成对左右对齐');
  assert.ok(pairRow.indexOf('dv-old') < pairRow.indexOf('dv-new'), '左删右增');
  // 未配对的新增行（const c = 3;）单侧呈现
  const cIdx = html.indexOf('const c = 3;');
  const cRow = html.slice(html.lastIndexOf('dv-s-row', cIdx), cIdx);
  assert.ok(cRow.includes('dv-cell-empty'), '未配对新增行左栏占位（保持分栏对齐）');
  assert.ok(!cRow.includes('dv-old'), '未配对新增行左栏为空');
  // 两栏行号
  assert.match(html, /dv-no[^>]*>\s*2\s*</, '左栏旧行号');
  assert.match(html, /dv-no[^>]*>\s*23\s*</, '右栏新行号');
  assert.ok(html.includes('dv-gap'), '左右栏之间有细分隔');
  // 与统一视图内容一致：同样的行内容集合（未被高亮拆分的内容原样出现在两视图）
  const u = DV.renderUnified(m, new Set());
  for (const content of ['const a = 1;', 'ctx21', '@@ -20,4 +21,4 @@ function x() {']) {
    assert.ok(u.includes(content) && html.includes(content), `两视图都应包含：${content}`);
  }
});

// ---------- T6 字符级高亮 ----------

t('T6a 成对行字符级高亮：公共前后缀外的中段标注；纯增删/一致行不高亮', () => {
  const r = DV.highlightPair('const b = 2;', 'const b = 3;');
  // vm 跨原型对象用 JSON 比较（结构与值全等）
  assert.equal(JSON.stringify(r), JSON.stringify({ pre: 'const b = ', oldMid: '2', newMid: '3', post: ';' }));
  assert.equal(DV.highlightPair('abc', 'abc'), null, '一致行不高亮');
  assert.equal(DV.highlightPair('', 'new line'), null, '整行新增不配对');
  assert.equal(DV.highlightPair('old line', ''), null, '整行删除不配对');
});

t('T6b 渲染含 dv-ch 片段；上下文行无 dv-ch', () => {
  const m = DV.parseDiff(SAMPLE);
  const u = DV.renderUnified(m, new Set());
  assert.match(u, /dv-ch[^>]*>2<\/span>;?/, '删除侧字符片段高亮');
  assert.match(u, /dv-ch[^>]*>3<\/span>;?/, '新增侧字符片段高亮');
  const ctxRow = u.slice(u.indexOf('const a = 1;') - 300, u.indexOf('const a = 1;') + 100);
  assert.ok(!ctxRow.includes('dv-ch'), '上下文行整行着色、无字符级片段');
  const s = DV.renderSplit(m, new Set());
  assert.ok(s.includes('dv-ch'), '并排视图同样应用字符级高亮');
});

// ---------- T7 挂载行为（vm + 假 DOM） ----------

function mkBox() {
  const bodyEl = { scrollTop: 0 };
  return {
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; },
    listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    querySelector(sel) { return sel === '.dv-body' ? bodyEl : null; },
    bodyEl,
  };
}

const clickOn = (box, el) => box.listeners.click({ target: { closest: (s) => (s ? el : null) } });

t('T7a 挂载：空差异显示「（与 HEAD 一致：无差异——可能已补交入库）」；正常差异渲染标题与切换', () => {
  const box = mkBox();
  DV.mount(box, { path: 'scripts/lib/impl.mjs', diff: '' });
  assert.ok(box.innerHTML.includes('（与 HEAD 一致：无差异——可能已补交入库）'), '空差异语义文案保持');
  assert.ok(!box.innerHTML.includes('dv-unfold'), '空差异无折叠行');

  DV.mount(box, { path: 'scripts/lib/impl.mjs', diff: SAMPLE });
  assert.ok(box.innerHTML.includes('scripts/lib/impl.mjs（工作区 vs Git 基线）'), '标题行口径保持');
  assert.ok(box.innerHTML.includes('dv-body'), '主体为差异内容区');
  assert.ok(box.innerHTML.includes('data-dv-view="unified"') && box.innerHTML.includes('data-dv-view="split"'), '提供统一/并排切换');
});

t('T7b 视图切换：保持展开状态与滚动位置不丢失', () => {
  const box = mkBox();
  DV.mount(box, { path: 'a.mjs', diff: mkFoldSample() });
  const segId = DV.foldSegments(DV.parseDiff(mkFoldSample()).rows)[0].id;
  assert.ok(!box.innerHTML.includes('CTXHIDDEN07'), '默认折叠');

  // 就地展开
  clickOn(box, { dataset: { dvUnfold: segId } });
  assert.ok(box.innerHTML.includes('CTXHIDDEN07'), '点击展开后就地展开');

  // 切到并排：展开状态保留 + 滚动位置保留
  box.bodyEl.scrollTop = 42;
  clickOn(box, { dataset: { dvView: 'split' } });
  assert.ok(box.innerHTML.includes('dv-s-row'), '切换为并排渲染');
  assert.ok(box.innerHTML.includes('CTXHIDDEN07'), '切换视图后展开状态不丢');
  assert.ok(!box.innerHTML.includes('dv-unfold'), '唯一折叠段已展开，无折叠操作行');
  assert.equal(box.bodyEl.scrollTop, 42, '滚动位置保持');

  // 切回统一仍展开
  clickOn(box, { dataset: { dvView: 'unified' } });
  assert.ok(box.innerHTML.includes('CTXHIDDEN07') && box.innerHTML.includes('dv-u-row'), '切回统一仍展开');
});

t('T7c 切换文件：折叠状态按文件重置，视图偏好保留', () => {
  const box = mkBox();
  DV.mount(box, { path: 'a.mjs', diff: mkFoldSample() });
  const segId = DV.foldSegments(DV.parseDiff(mkFoldSample()).rows)[0].id;
  clickOn(box, { dataset: { dvUnfold: segId } });
  clickOn(box, { dataset: { dvView: 'split' } });
  DV.mount(box, { path: 'b.mjs', diff: mkFoldSample() });
  assert.ok(!box.innerHTML.includes('CTXHIDDEN07'), '换文件后折叠状态重置（不串用上个文件的展开段）');
  assert.ok(box.innerHTML.includes('dv-s-row'), '视图偏好（并排）保留');
  assert.ok(box.innerHTML.includes('b.mjs（工作区 vs Git 基线）'), '标题切换为新文件');
});

// ---------- T8 i18n ----------

t('T8 i18n：新增文案中英文同步、无键值冲突；diff-view.js 中文片段全覆盖；现有键沿用', () => {
  const need = {
    统一: 'Unified',
    并排: 'Side-by-side',
    '（新文件，未纳入版本控制）': '(new file, not tracked in Git)',
  };
  for (const [k, v] of Object.entries(need)) {
    assert.ok(k in EN, `EN 缺键：${k}`);
    assert.equal(EN[k], v, `EN 键值应为 ${v}`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN[k]), 'EN 值不得含中文');
  }
  const dyn = { '⋯ 展开 ◇ 行未变更上下文 ⋯': '⋯ Expand $1 unchanged lines ⋯' };
  for (const [k, v] of Object.entries(dyn)) {
    assert.ok(k in EN_DYNAMIC, `EN_DYNAMIC 缺键：${k}`);
    assert.equal(EN_DYNAMIC[k], v);
    assert.equal((k.match(/◇/g) || []).length, (v.match(/\$(\d)/g) || []).length, '占位与捕获组一致');
  }
  // 现有差异相关键沿用不改
  for (const k of ['查看差异', '（与 HEAD 一致：无差异——可能已补交入库）', '正在读取差异…']) {
    assert.ok(k in EN, `现有键沿用：${k}`);
  }
  assert.ok('◇（工作区 vs Git 基线）' in EN_DYNAMIC && '差异读取失败：◇（读取失败不冒充无差异）' in EN_DYNAMIC, '现有动态键沿用');

  // diff-view.js 全部中文片段被词典覆盖（与 i18n-coverage 同口径）
  const { texts, attrs } = extractFragments(makeScanner().run(diffViewSrc));
  const missing = [...new Set([...texts, ...attrs])].filter((s) => !(s in EN) && !(s in EN_DYNAMIC));
  assert.deepEqual(missing, [], `diff-view.js 中文片段缺词典：${missing.join('、')}`);
});

// ---------- T9 接线契约 ----------

t('T9 接线：index.html 先于 app.js 加载 diff-view.js；app.js 成功路径挂载 ATBDiffView（缺库回退）；服务端无行为变更', () => {
  const dvIdx = indexHtml.indexOf('<script src="/diff-view.js"></script>');
  const appIdx = indexHtml.indexOf('<script src="/app.js"></script>');
  assert.ok(dvIdx > 0, 'index.html 应引入 diff-view.js');
  assert.ok(appIdx > dvIdx, 'diff-view.js 须在 app.js 之前加载');

  const fn = appJs.match(/async function loadConfirmDiff\([\s\S]*?\n\}/);
  assert.ok(fn, 'app.js 应保留 loadConfirmDiff');
  assert.ok(fn[0].includes('ATBDiffView.mount'), '成功路径应挂载语义渲染');
  assert.ok(fn[0].includes('<pre>'), '渲染层缺失时应回退纯文本 <pre>（优雅降级）');
  assert.ok(fn[0].includes('正在读取差异…'), '加载中文案保持');
  assert.ok(fn[0].includes('差异读取失败：') && fn[0].includes('（读取失败不冒充无差异）'), '失败语义文案保持');
  assert.ok(/confirmDiffRetry[\s\S]{0,200}重试/.test(fn[0]) || fn[0].includes('confirmDiffRetry'), '重试入口保持');

  // 服务端口径不变：仍走 fileDiffText 且错误语义原文保留
  assert.ok(serverJs.includes('gitFlow.fileDiffText'), '服务端仍走 fileDiffText');
  assert.ok(serverJs.includes('差异读取失败：无法读取'), '服务端读取失败错误文案保持');
});

// ---------- T10 深浅色样式 ----------

t('T10 深浅色两套 dv-* 配色；长行横向滚动不换行', () => {
  const light = styleCss.slice(0, styleCss.indexOf('@media (prefers-color-scheme: dark)'));
  const dark = styleCss.slice(styleCss.indexOf('@media (prefers-color-scheme: dark)'));
  for (const token of ['--dv-add-bg', '--dv-del-bg', '--dv-add-ch', '--dv-del-ch', '--dv-hunk-bg']) {
    assert.ok(styleCss.includes(token), `应定义 ${token}`);
    assert.ok(light.includes(token) && dark.includes(token), `${token} 深浅色均应定义`);
  }
  assert.ok(styleCss.includes('white-space: pre'), '长行不换行（white-space: pre）');
  assert.ok(/dv-body[^}]*overflow[^}]*auto/.test(styleCss) || styleCss.includes('.dv-scroll'), '差异内容区横向滚动');
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
