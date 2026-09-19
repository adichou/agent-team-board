#!/usr/bin/env node
// REQ-20260919-002 决策界面布局优化 —— 纯前端布局层重构静态契约测试
// 用法：node scripts/tests/req-20260919-002.test.mjs
// 覆盖 test-cases.md A1–A5 / B1–B5 / C1–C6 / D1–D2 / E1–E2：
// 聚合区卡片四层分层 + 主次操作分组 + 未答置前/已答折叠 + 区头计数徽标；
// 侧拉面板常驻进度条 + 首个未答聚焦 + 答复框自适应高度 + 底部常驻；
// 既有交互口径零回退（复工防呆 / 二次确认 / Esc 焦点回归 / 三态 / 错误条）；
// i18n 中英双语同步与动态词条往返；深浅色变量与窄屏断点。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import '../web/i18n.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const web = path.join(pluginRoot, 'scripts', 'web');
const js = fs.readFileSync(path.join(web, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(web, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(web, 'style.css'), 'utf8');
const I = globalThis.ATBI18N;
assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
const { EN, EN_DYNAMIC } = I._dict;

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- VM 提取：holdCardHtml 渲染隔离验证（与 commit-ui 测试同套路） ---------- */

// REQ-20260919-002 独立样式块（从块注释到下一个分节注释）
function cssBlock() {
  const m = css.match(/\/\* ---------- REQ-20260919-002[\s\S]*?(?=\n\/\* ---------- )/);
  assert.ok(m, 'style.css 应有 REQ-20260919-002 独立样式块');
  return m[0];
}

function holdPanelHtml() {
  const m = html.match(/<div id="holdPanel"[\s\S]*?<footer class="sp-foot">[\s\S]*?<\/footer>\s*<\/div>/);
  assert.ok(m, '应能定位 holdPanel 结构（至底部常驻区闭合）');
  return m[0];
}

function extractFn(src, name) {
  const m = src.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(m, `app.js 应存在 ${name}`);
  return m[0];
}

function holdCardVm(h, opts = {}) {
  const ctx = {
    esc: (s) => String(s == null ? '' : s),
    fmtWait: () => '2 小时',
    fmtTime: () => '2026-09-19 20:41',
    HOLD_EVENT_LABEL: {},
    itemIdHtml: (id) => `<span class="item-id">${id}</span>`,
    state: {
      holds: {
        expanded: new Set(opts.expanded ? [h.itemId] : []),
        answeredOpen: new Map(opts.foldOpen ? [[h.itemId, true]] : []),
        events: new Map(),
      },
    },
  };
  ctx.state.holds.events.set(h.itemId, []);
  vm.createContext(ctx);
  return vm.runInContext(
    `${extractFn(js, 'holdTimelineHtml')}\n${extractFn(js, 'holdCardHtml')}\nholdCardHtml(${JSON.stringify(h)})`,
    ctx
  );
}

const FIXTURE = {
  itemId: 'REQ-20260919-010',
  title: '批量导入支持 CSV 与 JSON 格式',
  unanswered: 2,
  total: 3,
  declaredAt: '2026-09-19T20:41:00Z',
  reason: '范围取舍待人工决策',
  runId: 'run-20260919-1830-a1',
  questions: [
    { id: 'q1', text: 'CSV 异常行策略？', answer: '' },
    { id: 'q2', text: '单文件大小上限？', answer: '上限先按 50MB' },
    { id: 'q3', text: '是否提供行为开关？', answer: '' },
  ],
};

// ---------- A 组：聚合区卡片分层 ----------

t('A1 卡片信息分层：元信息行（单号 / 旗标 / 等待时长靠右）/ 标题 / 摘要（未答计数徽标）/ 操作区四层齐备', () => {
  const card = holdCardVm(FIXTURE);
  assert.match(card, /class="card-top"/, '应有元信息行 card-top');
  assert.match(card, /class="item-id"/, '元信息行应含单号');
  assert.match(card, /hold-flag[^>]*>⚠ 等人工决策/, '元信息行应含旗标');
  assert.match(card, /class="[^"]*hold-wait[^"]*">已等待 /, '等待时长应有 hold-wait 类');
  assert.match(card, /class="card-title"/, '应有标题行');
  assert.match(card, /class="unanswered-count">未答 2\/3/, '未答计数应为徽标（未答 2/3）');
  assert.match(card, /class="hold-q-summary"/, '应有问题摘要区');
  assert.match(card, /class="hold-acts"/, '应有操作区');
});

t('A2 操作分主次两组：主操作（补决策 primary / 复工 accent）+ 次操作（查看进展记录 / 确认完成 ghost 弱化）', () => {
  const card = holdCardVm(FIXTURE);
  const primary = card.match(/<span class="acts-primary">([\s\S]*?)<\/span>/);
  const secondary = card.match(/<span class="acts-secondary">([\s\S]*?)<\/span>/);
  assert.ok(primary && secondary, '操作区应有 acts-primary 与 acts-secondary 两组');
  assert.match(primary[1], /data-hold-answer/, '主操作组应含补决策');
  assert.match(primary[1], /class="btn small primary"[^>]*>补决策/, '补决策应为 primary 突出样式');
  assert.match(primary[1], /data-hold-resume/, '主操作组应含复工');
  assert.match(primary[1], /class="btn small accent"/, '复工应为 accent 样式');
  assert.match(secondary[1], /data-hold-toggle/, '次操作组应含查看进展记录');
  assert.match(secondary[1], /data-hold-done/, '次操作组应含确认完成');
  assert.match(secondary[1], /class="btn small ghost"/, '次操作按钮应为 ghost 弱化样式');
  assert.ok(card.indexOf('acts-primary') < card.indexOf('acts-secondary'), '主操作组应在前');
});

t('A3 问题列表组织：未答置前加粗、已答默认收起为「已答 n 项」可展开；全未答不渲染折叠按钮', () => {
  const card = holdCardVm(FIXTURE);
  const list = card.match(/<ul class="hold-qs">([\s\S]*?)<\/ul>\s*<\/div>/);
  assert.ok(list, '应有 hold-qs 问题列表');
  const openIdx = list[1].indexOf('>○ CSV 异常行策略？');
  const foldIdx = list[1].indexOf('data-hold-fold');
  assert.ok(openIdx >= 0, '未答问题应渲染（○ 前缀加粗）');
  assert.ok(list[1].indexOf('class="open"') < list[1].indexOf('hold-fold'), '未答问题应置前于折叠行');
  assert.ok(foldIdx >= 0, '有已答时应渲染折叠按钮');
  assert.match(list[1], /aria-expanded="false"/, '已答默认收起');
  assert.match(list[1], /已答 1 项/, '折叠按钮应含已答计数');
  assert.ok(!list[1].includes('上限先按 50MB') || /aria-expanded="true"/.test(list[1]), '收起态不得直接平铺已答明细');

  const expanded = holdCardVm(FIXTURE, { foldOpen: true });
  assert.match(expanded, /aria-expanded="true"/, '点击后 aria-expanded=true');
  assert.match(expanded, /已答：上限先按 50MB/, '展开后显示已答问题（含答复 title）');

  const allOpen = holdCardVm({ ...FIXTURE, questions: [FIXTURE.questions[0]], unanswered: 1, total: 1 });
  assert.ok(!allOpen.includes('data-hold-fold'), '全未答时不渲染折叠按钮');

  const allAnswered = holdCardVm({
    ...FIXTURE,
    questions: [{ id: 'q1', text: 'A？', answer: '答' }],
    unanswered: 0,
    total: 1,
  });
  assert.ok(!/<li class="open"/.test(allAnswered), '全已答时无未答项');
  assert.match(allAnswered, /data-hold-fold/, '全已答时折叠按钮保留');
});

t('A4 区头可见性增强：「⚠ 待人工确认」强调文本 + hold-count 计数徽标；整区面板化描边', () => {
  assert.match(js, /<header class="hold-area-head"><span class="hold-area-title">⚠ 待人工确认<\/span><span class="hold-count">/, '区头应为强调文本 + 计数徽标结构');
  const block = cssBlock();
  const areaRule = block.match(/\.hold-area \{[^}]*\}/);
  assert.ok(areaRule, '新样式块应有 .hold-area 面板化规则');
  assert.match(areaRule[0], /background:\s*var\(--panel\)/, '聚合区应面板化（面板底色）');
  assert.match(areaRule[0], /border:\s*1px solid var\(--border\)/, '聚合区应有边界描边');
  assert.match(css, /\.hold-count \{/, '应有计数徽标样式');
  assert.match(css, /\.hold-count \{[^}]*var\(--inprogress\)/, '计数徽标应走语义色变量');
});

t('A5 轮询签名剪枝纳入已答折叠态：answeredOpen 进签名，重绘不丢折叠态', () => {
  const sigLine = js.match(/const sig = JSON\.stringify\(\[[\s\S]*?\]\)\);/);
  assert.ok(sigLine, 'renderHolds 应有签名剪枝');
  assert.match(sigLine[0], /answeredOpen/, '签名应包含已答折叠态');
  assert.match(js, /answeredOpen: new Map\(\)/, 'state.holds 应初始化 answeredOpen');
  assert.match(js, /data-hold-fold/, '应渲染折叠按钮并绑定');
});

// ---------- B 组：侧拉面板作答效率 ----------

t('B1 常驻进度条：#holdProgress 位于面板头部与内容区之间（flex: none），含未答 pill 与提示文案', () => {
  const p = holdPanelHtml();
  const headIdx = p.indexOf('side-panel-head');
  const progIdx = p.indexOf('id="holdProgress"');
  const bodyIdx = p.indexOf('side-panel-body');
  assert.ok(progIdx > headIdx && progIdx < bodyIdx, '进度条应在头部与内容区之间');
  assert.match(p, /id="holdProgress" class="[^"]*sp-progress/, '进度条应有 sp-progress 常驻条样式');
  assert.match(css, /\.sp-progress \{[^}]*flex:\s*none/, '进度条应 flex: none 不被压缩');
  assert.match(js, /function renderHoldProgress\(/, '应有 renderHoldProgress 渲染函数');
  assert.match(js, /hold-progress-pill/, '进度条应渲染未答 pill 徽标');
});

t('B2 进度实时更新：读取表单后与保存成功后都更新进度条（与卡片同源 unanswered/total）', () => {
  const loadFn = extractFn(js, 'loadHoldQuestions');
  assert.match(loadFn, /renderHoldProgress\(/, 'loadHoldQuestions 渲染表单后应更新进度条');
  const saveFn = extractFn(js, 'saveHoldAnswers');
  assert.match(saveFn, /renderHoldProgress\(r\.unanswered,\s*r\.total\)/, '保存成功后应按响应更新进度条');
});

t('B3 首个未答可达：打开面板聚焦首个未答问题的答复框（跳过已答项）', () => {
  const loadFn = extractFn(js, 'loadHoldQuestions');
  assert.match(loadFn, /querySelectorAll\('textarea\[data-hq\]'\)\]\.find\(\(ta\) => !ta\.value\.trim\(\)\)/, '应查找首个未答（空值）答复框聚焦');
  assert.match(loadFn, /\.focus\(\)/, '应调用 focus');
});

t('B4 答复框自适应高度：渲染后带 data-hold-grow 并随输入生长，最小 2 行、上限 12 行', () => {
  assert.match(js, /data-hold-grow/, '答复 textarea 应带 data-hold-grow');
  assert.match(js, /function holdAutoGrow\(/, '应有自动生长函数');
  const loadFn = extractFn(js, 'loadHoldQuestions');
  assert.match(loadFn, /holdAutoGrow\(/, '渲染后应初始化自动生长');
  const cssRule = css.match(/\.hold-q textarea \{[^}]*\}/);
  assert.ok(cssRule, '应有 textarea 样式规则');
  assert.match(cssRule[0], /min-height:\s*\d+px/, '应设最小高度（2 行）');
  assert.match(cssRule[0], /max-height:\s*\d+px/, '应设最大高度（12 行，超出内部滚动）');
});

t('B5 底部常驻：消息行 + 关闭/保存决策在 .sp-foot 常驻区（不随内容滚动），保存按钮 form 属性关联 holdForm', () => {
  const p = holdPanelHtml();
  const foot = p.match(/<footer class="sp-foot">([\s\S]*?)<\/footer>/);
  assert.ok(foot, '面板底部应有常驻 sp-foot');
  assert.match(foot[1], /id="holdPanelMsg"/, '底部应含消息行');
  assert.match(foot[1], /id="holdPanelCancel"/, '底部应含关闭按钮');
  assert.match(foot[1], /id="holdPanelSave"[\s\S]*?form="holdForm"/, '保存按钮应经 form 属性关联 holdForm');
  const formEnd = p.indexOf('</form>');
  const footStart = p.indexOf('<footer class="sp-foot">');
  assert.ok(footStart > formEnd, 'sp-foot 应在 holdForm 之外（内容区滚动时不被卷走）');
  assert.match(css, /\.sp-foot \{[^}]*flex:\s*none/, 'sp-foot 应 flex: none 常驻');
  const setView = extractFn(js, 'setHoldPanelView');
  assert.match(setView, /#holdProgress'\)\.classList\.toggle\('hidden', mode !== 'form'\)/, '进度条随表单态显隐');
  assert.match(setView, /#holdPanelSave'\)\.classList\.toggle\('hidden', mode !== 'form'\)/, '保存按钮随表单态显隐（读取/错误态不出现）');
});

// ---------- C 组：既有口径零回退 ----------

t('C1 复工防呆零回退：未答 > 0 复工禁用 + 缺项 tooltip', () => {
  const card = holdCardVm(FIXTURE);
  assert.match(card, /data-hold-resume="REQ-20260919-010" disabled/, '未答 > 0 复工应禁用');
  assert.match(card, /title="尚缺 2 项决策，补齐后可复工"/, '禁用态应有缺项提示');
  assert.match(js, /unanswered > 0 \? ' disabled'/, '禁用判断逻辑保留');
});

t('C2 确认完成防呆零回退：卡片入口 + 二次确认 + force 提交', () => {
  const card = holdCardVm(FIXTURE);
  assert.match(card, /data-hold-done/, '卡片应保留确认完成入口');
  assert.match(js, /仍要确认完成/, '二次确认文案保留');
  assert.match(js, /force:\s*guard\.force/, '二次确认后 force 提交保留');
  assert.match(js, /function confirmDoneGuard\(/, '确认完成防呆函数保留');
});

t('C3 Esc / ✕ 关闭 + 焦点回归 + 保存中不可关闭零回退', () => {
  assert.match(js, /if \(!holdSide\.busy\) closeHoldPanel\(\)/, '保存中不可关闭守卫保留');
  const closeFn = extractFn(js, 'closeHoldPanel');
  assert.match(closeFn, /opener\.focus\?\.\(\)/, '关闭后焦点回归触发按钮');
  assert.match(js, /holdPanelOpen\(\)\) \{ \/\/ REQ-20260911-007：人工决策面板层/, 'Esc 处理链保留面板层');
});

t('C4 面板三态保留：读取中 / 读取失败（重试）/ 表单', () => {
  const setView = extractFn(js, 'setHoldPanelView');
  assert.match(setView, /#holdPanelLoading'\)\.classList\.toggle\('hidden', mode !== 'loading'\)/, '读取中态保留');
  assert.match(setView, /#holdPanelError'\)\.classList\.toggle\('hidden', mode !== 'error'\)/, '错误态保留');
  assert.match(setView, /#holdForm'\)\.classList\.toggle\('hidden', mode !== 'form'\)/, '表单态保留');
  assert.match(html, /id="holdPanelRetry"/, '错误态重试按钮保留');
  assert.match(js, /#holdPanelRetry'\)\?\.addEventListener/, '重试绑定保留');
});

t('C5 聚合区错误条 + 重试与空态整体隐藏保留', () => {
  const fn = extractFn(js, 'renderHolds');
  assert.match(fn, /hold-error" role="alert"/, '错误条保留');
  assert.match(fn, /data-hold-retry/, '重试入口保留');
  assert.match(fn, /classList\.add\('hidden'\)/, '空态整体隐藏保留');
});

t('C6 契约不变：hold 数据层不动；前端仅调用既有 4 个 hold 端点', () => {
  const holdStatesSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'lib', 'hold-states.mjs'), 'utf8');
  const holdStoreSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'lib', 'hold-store.mjs'), 'utf8');
  assert.ok(!holdStatesSrc.includes('20260919-002') && !holdStoreSrc.includes('20260919-002'), '数据层不得因本单改动');
  const endpoints = [...js.matchAll(/['"`](\/api\/hold[s]?[^'"`]*)['"`]/g)].map((m) => m[1]);
  const allowed = (u) =>
    u === '/api/holds' ||
    /^\/api\/hold\/\$\{encodeURIComponent\(id\)\}$/.test(u) ||
    /^\/api\/hold\/\$\{encodeURIComponent\(id\)\}\/answer$/.test(u) ||
    /^\/api\/hold\/\$\{encodeURIComponent\(id\)\}\/resume$/.test(u);
  for (const u of endpoints) {
    assert.ok(allowed(u), `前端不得新增/变更 hold 端点：${u}`);
  }
  const serverSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'server.mjs'), 'utf8');
  assert.ok(!serverSrc.includes('20260919-002'), 'server.mjs 不得因本单改动（契约不变）');
});

// ---------- D 组：i18n 双语同步 ----------

t('D1 新文案中英双语同步；旧区头整串动态键随结构调整移除', () => {
  assert.equal(EN['⚠ 待人工确认'], '⚠ Pending human decisions', '区头强调文本应有 EN 词条');
  assert.equal(EN['展开 / 收起已答问题'], 'Expand / collapse answered questions', '折叠按钮 title 应有 EN 词条');
  assert.equal(EN_DYNAMIC['已答 ◇ 项'], '$1 answered', '已答计数动态词条');
  assert.equal(EN_DYNAMIC['未答 ◇/◇'], 'unanswered $1/$2', '未答计数动态词条');
  assert.equal(EN_DYNAMIC['待答 ◇ 项，填写后保存草稿'], '$1 still to answer — fill them in and save a draft', '进度提示动态词条');
  assert.ok(!('⚠ 待人工确认（◇）' in EN_DYNAMIC), '旧区头整串动态键应随 UI 调整移除（避免死键）');
  assert.ok('⚠ 待人工确认（◇）——阻塞队列，确认后才继续' in EN_DYNAMIC, '挂起确认区同形键不得误删');
});

t('D2 动态词条往返：en 模式插值正确，zh 模式可译回中文', () => {
  const prev = I.getLang();
  I.setLang('en');
  try {
    assert.equal(I.t('⚠ 待人工确认'), '⚠ Pending human decisions');
    assert.equal(I.t('已答 2 项'), '2 answered');
    assert.equal(I.t('未答 1/3'), 'unanswered 1/3');
    assert.equal(I.t('待答 2 项，填写后保存草稿'), '2 still to answer — fill them in and save a draft');
  } finally {
    I.setLang('zh');
  }
  assert.equal(I.t('2 answered'), '已答 2 项', '反向应译回中文');
  assert.equal(I.t('unanswered 1/3'), '未答 1/3', '反向应译回中文');
  assert.equal(I.t('待答 2 项，填写后保存草稿'), '待答 2 项，填写后保存草稿', 'zh 模式中文原样');
  I.setLang(prev);
});

// ---------- E 组：主题与窄屏 ----------

t('E1 深浅色：REQ-20260919-002 新增样式块全部走主题变量，无硬编码色值', () => {
  const block = cssBlock();
  const hexes = block.match(/#[0-9a-fA-F]{3,8}\b/g);
  assert.equal(hexes, null, `新增样式不得硬编码色值（发现：${hexes}）`);
});

t('E2 窄屏 ≤640px：主次操作组分隔取消、换行可用；进度条与底部常驻区收窄', () => {
  const media = cssBlock().match(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/);
  assert.ok(media, '新样式块应含 ≤640px 窄屏断点');
  assert.match(media[0], /\.acts-secondary \{[^}]*border-left:\s*0/, '窄屏应取消次操作组分隔线');
  assert.match(media[0], /\.sp-progress \{/, '窄屏应收窄进度条内边距');
  assert.match(media[0], /\.sp-foot \{/, '窄屏应收窄底部常驻区内边距');
  assert.match(css, /\.acts-primary, \.acts-secondary \{[^}]*flex-wrap:\s*wrap/, '操作组应允许换行');
  assert.match(css, /@media \(max-width: 640px\) \{\s*\.side-panel \{ width: 100vw/, '面板全屏断点保留');
});

// ---------- 执行 ----------

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
