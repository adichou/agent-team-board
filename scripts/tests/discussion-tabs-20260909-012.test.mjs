#!/usr/bin/env node
// REQ-20260909-012 讨论详情多页签布局 —— 静态契约 + vm 行为测试
// REQ-20260910-018 调整：页签收敛为「讨论纪要 / 交流记录 / 后续行动」三页签——
// 概况元信息并入详情头部、提示词改由顶部操作区承载（页签行下可折叠块，无提示词页签）。
// 用法：node scripts/tests/discussion-tabs-20260909-012.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const oncallJs = fs.readFileSync(path.join(webRoot, 'oncall.js'), 'utf8');
const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function fnSrc(name) {
  // oncall.js 函数位于 IIFE 内缩进两格（不同于 app.js 顶层函数）：起始允许行首空白，
  // 结束锚定两格缩进的闭括号（函数体内部的块闭合缩进 ≥4 格，不会提前截断）
  const m = oncallJs.match(new RegExp(`^[ \\t]*(?:async )?function ${name}\\([\\s\\S]*?^  \\}`, 'm'));
  assert.ok(m, `应存在 ${name} 函数`);
  return m[0];
}

/* ---------- vm 接缝（discussion-ui.test.mjs 同法） ---------- */
function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes, dataset: {}, innerHTML: '', textContent: '', value: '', title: '', disabled: false, checked: false, hidden: false,
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(sel) { if (!nodes.has(sel)) nodes.set(sel, element()); return nodes.get(sel); },
    querySelectorAll() { return []; },
    appendChild(c) { this.children.push(c); },
    replaceChildren(...c) { this.children = c; },
    setAttribute() {}, removeAttribute() {}, focus() {}, select() {}, remove() {}, scrollIntoView() {},
    closest() { return null; },
    get scrollTop() { return 0; }, set scrollTop(v) {},
  };
}

function setup({ board, detail }) {
  const document = element();
  document.createElement = element;
  document.body = element();
  document.querySelector = (sel) => document.nodes.get(sel) ?? null;
  document.nodes.set('#oncallView', element());
  document.nodes.set('#ocList', element());
  document.nodes.set('#ocDetail', element());
  document.nodes.set('#discMask', element());
  document.nodes.set('#oncallLightbox', element());
  document.addEventListener = () => {};
  const sandbox = {
    document, console, URLSearchParams, CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    // REQ-20260910-001：openItem/closeDetail 派发 atb:oncall-state（快照落盘接缝），此处仅桩
    dispatchEvent: () => {},
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    marked: { parse: (s) => String(s || '') },
    fetch: async (url) => {
      if (String(url).includes('/api/discussion/board')) return { ok: true, json: async () => board };
      if (detail && String(url).includes(`/api/discussion/`)) return { ok: true, json: async () => ({ discussion: detail }) };
      return { ok: true, json: async () => ({}) };
    },
    navigator: { clipboard: { writeText: async () => {} } },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(oncallJs, sandbox, { filename: 'oncall.js' });
  return sandbox;
}

const disc = (id, over = {}) => ({
  id, title: `t-${id}`, status: 'discussing', createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T01:00:00.000Z',
  phase: 'recording', waiting: false, draftCount: 0, createdCount: 0,
  roundCount: 1, lastRoundAt: '2026-09-09T01:30:00.000Z', legacyRoundCount: 0,
  background: '讨论背景', startPrompt: 'SP', continuePrompt: 'CP', organizePrompt: 'OP',
  minutes: { content: '纪要正文', version: 1, updatedAt: '2026-09-09T01:00:00.000Z', stale: false },
  rounds: [{ no: 1, roundId: 'R0001', at: '2026-09-09T01:30:00.000Z', user: '用户原文', summary: '回复总结', session: 's1' }],
  outcome: { state: 'waiting' }, candidates: [], created: [], legacyRounds: [], ...over,
});

// ---------- T1 页签行结构（REQ-20260910-018 三页签） ----------

t('T1 头部下方固定页签栏：三页签顺序 讨论纪要→交流记录→后续行动；原生 button + role=tab + aria-selected', () => {
  const rd = fnSrc('renderDetail');
  const posHead = rd.indexOf('</header>');
  const posTabs = rd.indexOf('<nav class="tabs drawer-tabs"');
  const posBody = rd.indexOf('<div class="drawer-body">');
  assert.ok(posHead >= 0 && posTabs > posHead, '页签栏应在抽屉头部之后');
  assert.ok(posBody > posTabs, '内容区应在页签栏之后');
  const navEnd = rd.indexOf('</nav>', posTabs);
  const navTpl = rd.slice(posTabs, navEnd);
  const order = ['data-tab="minutes"', 'data-tab="rounds"', 'data-tab="actions"']
    .map((s) => navTpl.indexOf(s));
  assert.ok(order.every((p) => p >= 0), '页签栏应含 讨论纪要/交流记录/后续行动 三页签');
  assert.ok(order[0] < order[1] && order[1] < order[2], '页签顺序应为 讨论纪要 → 交流记录 → 后续行动');
  assert.match(navTpl, />讨论纪要/, '首页签文案为「讨论纪要」');
  assert.match(navTpl, />交流记录/, '第二页签文案为「交流记录」');
  assert.match(navTpl, /后续行动\$\{/, '后续行动页签带计数角标（模板插值）');
  assert.match(navTpl, /role="tablist"/, '页签行应为 tablist');
  assert.equal((navTpl.match(/role="tab"/g) || []).length, 3, '三个页签均带 role=tab');
  for (const btn of navTpl.match(/<button[^>]*data-tab=/g) || []) {
    assert.match(btn, /type="button"/, '页签应为原生 button');
    assert.match(btn, /role="tab"/, '页签应带 role=tab');
    assert.match(btn, /aria-selected="/, '页签应带 aria-selected');
  }
  // REQ-20260910-018：旧四页签（概况/成果/提示词）不再出现
  assert.ok(!navTpl.includes('data-tab="overview"') && !navTpl.includes('data-tab="drafts"') && !navTpl.includes('data-tab="prompt"'));
});

// ---------- T2 分区呈现与常驻通知条 ----------

t('T2 三个 tabpanel 分区按 hidden 切换；常驻 #ocNotice 在分区之前；读取失败含重新读取入口', () => {
  const rd = fnSrc('renderDetail');
  const bodyTpl = rd.slice(rd.indexOf('<div class="drawer-body">'));
  for (const pane of ['minutes', 'rounds', 'actions']) {
    const tag = bodyTpl.match(new RegExp(`<section[^>]*data-pane="${pane}"[^>]*>`));
    assert.ok(tag, `应存在 ${pane} 分区`);
    assert.match(tag[0], /role="tabpanel"/, `${pane} 分区应为 tabpanel`);
    assert.match(tag[0], /aria-label="/, `${pane} 分区应带 aria-label`);
  }
  // 非当前分区 hidden：模板里三段 `${tab === 'xxx' ? '' : ' hidden'}` 判定
  assert.equal((bodyTpl.match(/\$\{tab === '[a-z]+' \? '' : ' hidden'\}/g) || []).length, 3, '三个分区均按当前页签切换 hidden');
  // 通知条常驻页签行之下、分区之前（任意页签可见）
  const posNotice = bodyTpl.indexOf('id="ocNotice"');
  const posFirstPane = bodyTpl.indexOf('data-pane="minutes"');
  assert.ok(posNotice >= 0 && posNotice < posFirstPane, '通知条应在页签行之下、分区之前常驻');
  assert.match(bodyTpl, /role="status" aria-live="polite"/, '通知条保留 status/aria-live');
  assert.match(bodyTpl, /ocReread/, '读取失败应有「重新读取纪要」入口');
  // 仅刷新通知条机制不回归（读取中反馈不动正文）
  const rno = fnSrc('renderDetailNoticeOnly');
  assert.match(rno, /#ocNotice/, 'renderDetailNoticeOnly 仍指向 #ocNotice');
});

// ---------- T3 头部操作区与提示词折叠块（原提示词页签取消） ----------

t('T3 操作区四入口：启动提示词/复制继续讨论提示词/整理结论/归档；提示词为 drawer-body 内折叠块（无提示词页签）', () => {
  const rd = fnSrc('renderDetail');
  for (const word of ['id="ocStart"', 'id="ocCopyContinue"', 'id="ocOrganize"', 'id="ocArchive"']) {
    assert.ok(rd.includes(word), `操作区应有 ${word}`);
  }
  assert.ok(!rd.includes('id="ocFinish"'), '「讨论完毕」按钮移除（整理结论替代）');
  // 提示词折叠块：drawer-body 内、分区之前（REQ-20260910-018 由页签迁回折叠块）
  const bodyPos = rd.indexOf('<div class="drawer-body">');
  const promptPos = rd.indexOf('promptHtml(');
  const firstPane = rd.indexOf('data-pane="minutes"');
  assert.ok(bodyPos >= 0 && promptPos > bodyPos && promptPos < firstPane, '提示词块应在 drawer-body 内、分区之前');
  const ph = fnSrc('promptHtml');
  assert.match(ph, /state\.prompt/, 'promptHtml 应按 state.prompt 展示/收起');
  assert.match(ph, /disc-prompt/, '展示态应沿用 disc-prompt 块');
  assert.match(ph, /ocPromptText/, '提示词 textarea 保留 id=ocPromptText');
  assert.match(ph, /readonly/, '提示词为只读文本');
  assert.match(ph, /启动提示词（复制到 Agent 新会话）/, '启动提示词条幅保留');
  assert.match(ph, /整理结论提示词/, '整理结论提示词条幅');
  assert.match(ph, /ocCopyPrompt/, '复制按钮保留');
  assert.match(ph, /ocHidePrompt/, '收起按钮保留');
  assert.match(ph, /复制只代表提示词已生成/, '复制语义提示保留');
  // 头部与通知区不再插入提示词浮层；disc-prompt 块只出现在 promptHtml 内
  const head = rd.slice(0, rd.indexOf('<div class="drawer-body">'));
  assert.ok(!head.includes('disc-prompt'), '头部不应再插入提示词浮层');
  // 复制继续讨论提示词：直接复制 continuePrompt（不展开折叠块）
  const cp = oncallJs.match(/#ocCopyContinue'\)\?\.addEventListener\('click'[\s\S]*?\}\);/);
  assert.ok(cp, '应存在复制继续讨论提示词处理');
  assert.match(cp[0], /continuePrompt/, '复制内容为继续讨论提示词');
  assert.match(cp[0], /copyPlain/, '复制走双回退');
  // 复制双回退保留
  assert.match(oncallJs, /navigator\.clipboard\.writeText/, '剪贴板优先');
  assert.match(oncallJs, /execCommand\('copy'\)/, 'execCommand 回退');
  assert.match(oncallJs, /⌘C \/ Ctrl\+C/, '全选手动复制提示保留');
});

// ---------- T4 讨论纪要分区 ----------

t('T4 讨论纪要分区：minutesHtml（背景 + 最新纪要 + 待更新徽标）；旧版历史问答应答保留展示', () => {
  const rd = fnSrc('renderDetail');
  const pMi = rd.indexOf('data-pane="minutes"');
  const pRo = rd.indexOf('data-pane="rounds"');
  assert.ok(pMi > 0 && pRo > pMi, '应存在讨论纪要与交流记录分区');
  assert.match(rd.slice(pMi, pRo), /minutesHtml\(d\)/, '纪要分区应渲染 minutesHtml');
  const mh = fnSrc('minutesHtml');
  assert.match(mh, /讨论背景/, '纪要应含讨论背景');
  assert.match(mh, /讨论纪要/, '纪要应含纪要正文区');
  assert.match(mh, /stale/, '纪要应含待更新徽标判定（minutes.stale）');
  const rh = `${fnSrc('roundsHtml')}`;
  assert.match(rh, /legacyRoundsHtml\(d\)/, '旧版历史问答应保留展示（交流记录分区尾部）');
  assert.ok(!rd.includes('data-pane="legacy"'), '历史问答不应独立页签');
});

// ---------- T5 交流记录与后续行动分区 ----------

t('T5 交流记录渲染 roundsHtml；后续行动保留 #ocPane（bindDrafts 兼容）与 draftsHtml；计数角标 N=待创建+已创建', () => {
  const rd = fnSrc('renderDetail');
  const pRo = rd.indexOf('data-pane="rounds"');
  // 分区起始标签上 id 在 data-pane 之前，从所属 <section 起点切片
  const acStart = rd.lastIndexOf('<section', rd.indexOf('data-pane="actions"'));
  assert.match(rd.slice(pRo, acStart), /roundsHtml\(d\)/, '交流记录分区应渲染 roundsHtml');
  const acTpl = rd.slice(acStart);
  assert.match(acTpl, /id="ocPane"/, '后续行动分区应保留 #ocPane id');
  assert.match(acTpl, /draftsHtml\(d, createdIds\)/, '后续行动分区应渲染 draftsHtml');
  assert.match(rd, /if \(tab === 'actions'\) bindDrafts/, '后续行动页签激活时绑定草稿交互');
  const dh = fnSrc('draftsHtml');
  const ch = fnSrc('createdHtml');
  for (const word of ['createdHtml', 'id="ocCreate"', 'data-retry', 'data-goto-item', 'type="checkbox"']) {
    assert.ok(dh.includes(word) || ch.includes(word) || acTpl.includes(word), `后续行动内容应包含 ${word}`);
  }
  // 交流记录页签角标：已保存轮数；后续行动角标：待创建候选 + 已创建成果
  assert.match(rd, /交流记录\$\{d\.roundCount \? ` \(\$\{d\.roundCount\}\)` : ''\}/, '交流记录页签带轮数角标');
  const countExpr = rd.match(/const draftsCount = ([^;]+);/);
  assert.ok(countExpr, '应存在 draftsCount 计算');
  assert.match(countExpr[1], /created/, '计数应含已创建成果');
  assert.match(countExpr[1], /candidates/, '计数应含候选草稿');
  assert.match(countExpr[1], /createdIds/, '待创建数应排除已创建（createdIds）');
});

// ---------- T6 页签记忆与重置 ----------

t('T6 openItem/closeDetail 重置默认页签 minutes；detailSig 含 tab 与 prompt；无效页签回落默认', () => {
  const m = oncallJs.match(/const DISC_TABS = \[[^\]]*\]/);
  assert.ok(m, '应存在 DISC_TABS 常量');
  assert.match(m[0], /key: 'minutes'/);
  assert.match(m[0], /key: 'rounds'/);
  assert.match(m[0], /key: 'actions'/);
  assert.match(oncallJs, /DISC_DEFAULT_TAB = 'minutes'/, '默认页签应为讨论纪要');
  const dto = fnSrc('discTabOf');
  assert.match(dto, /DISC_TABS\.some/, '无效页签应回落默认页签（旧快照 overview/drafts/prompt 同样回落）');
  const open = fnSrc('openItem');
  assert.match(open, /state\.tab = DISC_DEFAULT_TAB/, '切换讨论记录应重置默认页签');
  const close = fnSrc('closeDetail');
  assert.match(close, /state\.tab = DISC_DEFAULT_TAB/, '关闭详情应重置默认页签');
  const rd = fnSrc('refreshDetail');
  assert.match(rd, /state\.tab/, 'detailSig 应包含当前页签（轮询重渲染不重置）');
  assert.match(rd, /state\.prompt\?\.kind/, 'detailSig 应包含提示词展示态');
});

// ---------- T7 自动定位等价 ----------

t('T7 自动定位：doOrganize 展示整理提示词；doCreate 完成跳后续行动；reveal 展示启动提示词', () => {
  const org = fnSrc('doOrganize');
  assert.match(org, /kind: 'organize'/, '整理结论应展示整理提示词');
  assert.doesNotMatch(org, /\/finish/, '整理结论不调用 finish 接口（纯前端）');
  const cre = fnSrc('doCreate');
  assert.match(cre, /state\.tab = 'actions'/, '创建完成后应回到后续行动分区');
  const rev = fnSrc('reveal');
  assert.match(rev, /kind: 'start'/, '新建定位应展示启动提示词');
});

// ---------- T8 vm 行为 ----------

t('T8 行为：openItem 后详情含 tablist 三页签与三分区；页签切换纯前端（处理器不含请求）', async () => {
  const detail = disc('ASK-20990909-001', {
    draftCount: 2, createdCount: 1,
    candidates: [{ id: 'd2', type: 'requirement', title: '候选2', description: 'x' }],
    created: [{ draftId: 'd1', type: 'bug', itemId: 'BUG-20260909-001', itemTitle: '成果1', itemStatus: 'submitted' }],
  });
  const h = setup({ board: { initialized: true, discussions: [disc('ASK-20990909-001', { draftCount: 2, createdCount: 1 })] }, detail });
  await h.ATBOncall.poll('/p', true);
  h.ATBOncall.openItem('ASK-20990909-001');
  await new Promise((r) => setTimeout(r, 20));
  const html = h.document.querySelector('#ocDetail').innerHTML;
  assert.match(html, /role="tablist"/, '详情应有页签行');
  for (const key of ['minutes', 'rounds', 'actions']) {
    assert.match(html, new RegExp(`data-tab="${key}"`), `应有 ${key} 页签`);
    assert.match(html, new RegExp(`data-pane="${key}"`), `应有 ${key} 分区`);
  }
  assert.match(html, /aria-selected="true"/, '当前页签 aria-selected=true');
  assert.match(html, /后续行动 \(2\)/, '后续行动页签计数角标（1 已创建 + 1 待创建）');
  assert.match(html, /讨论背景/, '纪要分区含讨论背景');
  assert.match(html, /用户原文/, '交流记录分区含用户原文');
  assert.match(html, /创建勾选的条目/, '后续行动分区含批量创建按钮');
  assert.match(html, /复制继续讨论提示词/, '操作区含复制继续讨论提示词');
  // 页签切换处理器：纯前端，不发起请求
  const sw = oncallJs.match(/for \(const b of wrap\.querySelectorAll\('\[data-tab\]'\)\) \{[\s\S]*?\n    \}/);
  assert.ok(sw, '应存在页签切换处理器');
  assert.doesNotMatch(sw[0], /\bapi\(|fetch\(/, '页签切换不得发起请求');
  assert.match(sw[0], /state\.tab = b\.dataset\.tab/, '切换应写入 state.tab');
});

// ---------- T9 样式与回归契约 ----------

t('T9 样式契约：.drawer-tabs（含 flex-wrap）；.disc-pane 布局保留；交流记录样式存在；#ocBack 复用 .drawer-back', () => {
  assert.match(css, /\.drawer-tabs\s*\{/, '.drawer-tabs 样式存在（REQ-20260909-006 复用）');
  const drawerTabs = css.match(/\.drawer-tabs \{[\s\S]*?\}/)[0];
  assert.match(drawerTabs, /flex-wrap:\s*wrap/, '页签行应换行不横向滚动');
  assert.match(css, /\.disc-pane \{/, '.disc-pane 内容布局保留');
  assert.match(css, /\.disc-empty-rounds \{/, '交流记录空态样式存在');
  assert.match(css, /\.disc-rounds-history \{/, '历史轮次折叠样式存在');
  assert.match(css, /\.disc-last-summary \{/, '列表最新回复摘要样式存在');
  // #ocBack 复用 .drawer-back（BUG-20260909-007 口径不回归）
  assert.match(oncallJs, /class="btn drawer-back" id="ocBack"/, '#ocBack 应仍复用 .drawer-back');
  // 旧四页签文案不再作为页签；内容渲染函数保留
  assert.doesNotMatch(fnSrc('renderDetail'), />概况</, '不再有「概况」页签文案');
  assert.doesNotMatch(fnSrc('renderDetail'), />提示词</, '不再有「提示词」页签文案');
  assert.match(oncallJs, /function minutesHtml/, 'minutesHtml 渲染函数保留');
  assert.match(oncallJs, /function draftsHtml/, 'draftsHtml 渲染函数保留');
  assert.match(oncallJs, /function roundsHtml/, 'roundsHtml 渲染函数存在（REQ-20260910-018）');
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
