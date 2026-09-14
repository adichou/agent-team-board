#!/usr/bin/env node
// BUG-20260914-017 分支同步界面缺少「main 必须经过发布流程推送」的规则说明——
// 推送范围排除 main（BUG-20260914-011 落定）只存在于悬停提示与设计文档，界面无常驻说明。
// 修复口径（仅展示层，syncRemote 排除 main 行为不变）：
//   U1 工具栏下常驻同步范围说明（不悬停可见）；
//   U2 本地 main 行「通过发布流程推送」标识（当前行 / 非当前行均覆盖，无推送入口）；
//   U3/U4 同步成功 / 部分失败反馈携带「main 已跳过，请通过发布流程推送」（用 skipped 数据）；
//   U5 仅 main 场景「没有可推送的开发分支；main 必须通过发布流程推送」（toast + 空态）；
//   U6 skipped 不含 main 时不误报；W1 i18n 词条（静态 + 动态）与旧键清理；S1 不越界静态断言。
// BUG-20260914-018（用户反馈：删掉 main 行「通过发布流程推送」文字）反向调整：
//   U2 / U2b 改为 main 行（当前行 / 非当前行）无该标识、无悬停详释、无推送入口；
//   W1 标识两条词条改为死词条清理断言；S1 增加 mainFlagHtml / .bld-main-flag 无残留断言。
//   其余 U1 / U3–U6 / W2 与 S1 服务端断言不变（范围边界：仅删 main 行上的文字）。
// 用法：node scripts/tests/bug-sync-main-release-note-20260914-017.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import '../web/i18n.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = path.join(pluginRoot, 'scripts', 'web');
const buildJs = fs.readFileSync(path.join(webRoot, 'build.js'), 'utf8');
const i18nJs = fs.readFileSync(path.join(webRoot, 'i18n.js'), 'utf8');
const buildGitJs = fs.readFileSync(path.join(pluginRoot, 'scripts', 'lib', 'build-git.mjs'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const SYNC_NOTE = '同步仅推送 main 以外的本地分支；main 必须通过发布流程推送。';
const MAIN_FLAG = '通过发布流程推送';
const MAIN_FLAG_TITLE = 'main 由发布流程推送：不随「和远端同步」推送，也无单独推送按钮';
const MAIN_SKIPPED_NOTE = 'main 已跳过，请通过发布流程推送';

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
    setAttribute() {}, removeAttribute() {}, focus() {}, select() {}, remove() {},
    closest() { return null; },
  };
}

function statePayload(over = {}) {
  return { initialized: true, isRepo: true, currentBranch: 'dev', versions: [], ...over };
}

function setup({ branches, state = statePayload(), syncResult } = {}) {
  const document = element();
  document.createElement = element;
  document.body = element();
  document.nodes.set('#buildView', element());
  document.addEventListener = () => {};
  const toasts = [];
  const sandbox = {
    document, console, URLSearchParams,
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    toast: (m, isErr) => toasts.push([m, isErr]),
    fetch: async (url) => {
      const up = new URL(String(url), 'http://local');
      if (up.pathname === '/api/build/state') return { ok: true, json: async () => JSON.parse(JSON.stringify(state)) };
      if (up.pathname === '/api/build/candidates') return { ok: true, json: async () => ({ items: [] }) };
      if (up.pathname === '/api/build/branches') return { ok: true, json: async () => JSON.parse(JSON.stringify(branches)) };
      if (up.pathname === '/api/build/sync') return syncResult ? syncResult() : { ok: true, json: async () => ({}) };
      return { ok: true, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  return { sandbox, toasts, document, run: (code) => vm.runInContext(code, sandbox) };
}

async function openBranches(h) {
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.setTab('branches')`);
  await new Promise((r) => setTimeout(r, 10));
  return h.document.nodes.get('#buildView');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const devMainBranches = () => ({ isRepo: true, current: 'dev', local: ['dev', 'main'], remote: [], remotes: ['origin'] });

const syncOk = (over = {}) => ({
  ok: true, remote: 'origin',
  pushed: [{ branch: 'dev', remoteBranch: 'origin/dev', setUpstream: true }],
  failed: [], skipped: ['main'],
  ...over,
});

/* ---------- U1：常驻说明 ---------- */

t('U1 常驻说明：工具栏下方不悬停即可见同步范围说明（含 main 发布口径），有稳定样式钩子；悬停提示口径一致', async () => {
  const h = setup({ branches: devMainBranches() });
  const view = await openBranches(h);
  const inner = view.innerHTML;
  assert.ok(inner.includes(SYNC_NOTE), `应常驻显示同步范围说明：${SYNC_NOTE}`);
  assert.match(inner, /bld-sync-note/, '常驻说明应有稳定样式钩子');
  assert.match(inner, /role="note"/, '常驻说明 role=note（可访问性口径同 bld-remote-hint）');
  // 悬停提示与常驻说明口径一致：均说明排除 main（不矛盾）
  const btn = inner.match(/<button[^>]*id="bldFetchBtn"[^>]*>/);
  assert.ok(btn, '应渲染 #bldFetchBtn 同步按钮');
  assert.match(btn[0], /main 除外/, '悬停提示保留并说明范围（main 除外）');
});

t('U1b 非 git 仓库：整页引导空态，不渲染常驻说明（无同步入口语境）', async () => {
  const h = setup({ state: statePayload({ isRepo: false }), branches: null });
  const view = await openBranches(h);
  const inner = view.innerHTML;
  assert.match(inner, /当前项目不是 git 仓库/, '非 git 仓库保持引导空态');
  assert.ok(!inner.includes(SYNC_NOTE), '非 git 仓库不渲染同步范围说明');
});

/* ---------- U2：main 行标识（BUG-20260914-018 删除后口径） ---------- */

t('U2 main 行标识已删（当前 dev）：main 行无「通过发布流程推送」徽标、无悬停详释、无推送入口；非 main 行推送不受影响；行仍可点选查看提交', async () => {
  const h = setup({ branches: { isRepo: true, current: 'dev', local: ['dev', 'feat', 'main'], remote: [], remotes: ['origin'] } });
  const view = await openBranches(h);
  const inner = view.innerHTML;
  const mainRow = inner.match(/<div class="bld-branch" data-branch="main"[^>]*>[\s\S]*?<\/div>/);
  assert.ok(mainRow, 'main 行应保留（只读浏览语义不变）');
  assert.ok(!mainRow[0].includes(MAIN_FLAG), `main 行不得再显示「${MAIN_FLAG}」标识（BUG-20260914-018 删除）`);
  assert.doesNotMatch(mainRow[0], /bld-main-flag/, 'main 行不得残留标识样式钩子');
  assert.ok(!mainRow[0].includes(MAIN_FLAG_TITLE), 'main 行不得残留悬停详释');
  assert.doesNotMatch(mainRow[0], /data-push/, 'main 行不得出现任何推送入口（不越界）');
  const featRow = inner.match(/<div class="bld-branch" data-branch="feat"[^>]*>[\s\S]*?<\/div>/);
  assert.ok(featRow, 'feat 行应渲染');
  assert.doesNotMatch(featRow[0], /bld-main-flag/, '非 main 行不渲染 main 标识');
  assert.match(featRow[0], /data-push="feat"/, '非 main 行「推送」按钮不受影响');
  // main 行点击查看提交记录的交互保留（data-branch 委托不变）
  assert.match(buildJs, /querySelectorAll\('\[data-branch\]'\)/, '[data-branch] 点击委托绑定保持');
});

t('U2b main 为当前分支：以「当前」行渲染，同样无「通过发布流程推送」标识（两处一并删除）', async () => {
  const h = setup({ branches: { isRepo: true, current: 'main', local: ['main', 'dev'], remote: [], remotes: ['origin'] } });
  const view = await openBranches(h);
  const inner = view.innerHTML;
  const curRow = inner.match(/<div class="bld-branch bld-cur" data-branch="main"[^>]*>[\s\S]*?<\/div>/);
  assert.ok(curRow, 'main 应以「当前」行渲染');
  assert.ok(curRow[0].includes('当前'), '当前行仍保留「当前」徽标（仅删发布流程徽标）');
  assert.ok(!curRow[0].includes(MAIN_FLAG), `当前 main 行不得再显示「${MAIN_FLAG}」标识`);
  assert.ok(!curRow[0].includes(MAIN_FLAG_TITLE), '当前 main 行不得残留悬停详释');
  assert.doesNotMatch(curRow[0], /data-push/, '当前 main 行无推送入口');
});

/* ---------- U3/U4/U5/U6：同步结果反馈 ---------- */

t('U3 同步成功：toast 同时呈现已推送清单与「main 已跳过，请通过发布流程推送」（利用 skipped 数据）', async () => {
  const h = setup({ branches: devMainBranches(), syncResult: () => ({ ok: true, json: async () => syncOk() }) });
  const view = await openBranches(h);
  view.nodes.get('#bldFetchBtn').listeners.click();
  await sleep(30);
  assert.ok(
    h.toasts.some(([m]) => m.includes('已推送 dev → origin') && m.includes(MAIN_SKIPPED_NOTE)),
    `成功 toast 应同时含推送清单与 main 跳过说明：${JSON.stringify(h.toasts)}`,
  );
});

t('U4 部分推送失败：失败分支与原因列明，「main 已跳过」提示仍出现（错误样式）', async () => {
  const h = setup({
    branches: devMainBranches(),
    syncResult: () => ({
      ok: true, json: async () => syncOk({
        failed: [{ branch: 'feat', error: '推送 feat 到 origin 失败：non-fast-forward（fetch first）' }],
      }),
    }),
  });
  const view = await openBranches(h);
  view.nodes.get('#bldFetchBtn').listeners.click();
  await sleep(30);
  assert.ok(
    h.toasts.some(([m, e]) => /✕ 同步完成但部分推送失败/.test(m) && /feat/.test(m) && /non-fast-forward/.test(m) && m.includes(MAIN_SKIPPED_NOTE) && e === true),
    `部分失败 toast 应列明失败分支并提示 main 已跳过：${JSON.stringify(h.toasts)}`,
  );
});

t('U5 仅 main 场景：toast 明确「没有可推送的开发分支；main 必须通过发布流程推送」，不声称全部分支已同步；远端空态口径同步', async () => {
  const h = setup({
    branches: { isRepo: true, current: 'main', local: ['main'], remote: [], remotes: ['origin'] },
    syncResult: () => ({ ok: true, json: async () => syncOk({ pushed: [] }) }),
  });
  const view = await openBranches(h);
  view.nodes.get('#bldFetchBtn').listeners.click();
  await sleep(30);
  const inner = view.innerHTML;
  assert.ok(
    h.toasts.some(([m]) => m === '✓ 已同步远端：fetch 完成，没有可推送的开发分支；main 必须通过发布流程推送'),
    `仅 main 场景 toast 应明确说明：${JSON.stringify(h.toasts)}`,
  );
  assert.ok(
    !h.toasts.some(([m]) => /全部分支已同步|全部.*已同步/.test(m)),
    '不得声称全部分支已同步',
  );
  // 远端分组仍空时的空态解释同口径（不引导寻找 main 推送按钮）
  assert.match(inner, /本次同步未推送任何分支：没有可推送的开发分支；main 必须通过发布流程推送/, '空态说明应同口径');
  assert.ok(!/在上方「本地」分组.*main.*推送按钮/.test(inner), '不引导寻找 main 的推送按钮');
});

t('U6 skipped 不含 main（本地无 main）：成功 toast 维持两步汇总口径，不误报「main 已跳过」', async () => {
  const h = setup({
    branches: { isRepo: true, current: 'dev', local: ['dev'], remote: [], remotes: ['origin'] },
    syncResult: () => ({ ok: true, json: async () => syncOk({ skipped: [] }) }),
  });
  const view = await openBranches(h);
  view.nodes.get('#bldFetchBtn').listeners.click();
  await sleep(30);
  assert.ok(
    h.toasts.some(([m]) => m === '✓ 已同步远端：fetch 完成，已推送 dev → origin'),
    `skipped 不含 main 时维持既有成功口径：${JSON.stringify(h.toasts)}`,
  );
});

/* ---------- W1：i18n 词典 ---------- */

t('W1 静态词条收录（常驻说明 / 悬停提示 / 仅 main toast），中英往返；main 行标识两条词条已随徽标删除清理', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN } = I._dict;
  assert.ok(EN[SYNC_NOTE], '常驻说明应有词条');
  assert.match(EN[SYNC_NOTE], /release process/i, '常驻说明词条应含发布流程口径');
  // BUG-20260914-018：徽标两条词条随界面删除清理，不留死词条
  assert.ok(!(MAIN_FLAG in EN), `「${MAIN_FLAG}」词条应随徽标删除清理（避免死词条）`);
  assert.ok(!(MAIN_FLAG_TITLE in EN), '徽标 title 详释词条应随徽标删除清理（避免死词条）');
  assert.ok(EN['fetch --all --prune 拉取远端，再推送本地开发分支（main 除外）：确保本地与远端一致'],
    '按钮悬停提示应有词条（现状英文缺失一并修复）');
  assert.ok(EN['✓ 已同步远端：fetch 完成，没有可推送的开发分支；main 必须通过发布流程推送'], '仅 main toast 应有词条');
  assert.ok(!('本次同步未推送任何分支：本地没有可自动推送的开发分支（main 由发布模块管理，不在此推送）。' in EN),
    '旧空态键应随文案更新清理（避免死词条）');
  I.setLang('en');
  assert.equal(I.t(SYNC_NOTE), EN[SYNC_NOTE], '英文界面常驻说明正常翻译');
  I.setLang('zh');
  assert.equal(I.t(EN[SYNC_NOTE]), SYNC_NOTE, '切回中文可还原（往返）');
});

t('W2 动态词条收录（成功 / 部分失败 toast 的 main 注记与无注记形态），中英往返', () => {
  const I = globalThis.ATBI18N;
  const { EN, EN_DYNAMIC } = I._dict;
  const okMain = '✓ 已同步远端：fetch 完成，已推送 dev、feat → origin；main 已跳过，请通过发布流程推送';
  const okPlain = '✓ 已同步远端：fetch 完成，已推送 dev → origin';
  const failMain = '✕ 同步完成但部分推送失败：feat（网络不可达）；main 已跳过，请通过发布流程推送';
  const failPlain = '✕ 同步完成但部分推送失败：feat（网络不可达）';
  const need = [
    '✓ 已同步远端：fetch 完成，已推送 ◇ → ◇；main 已跳过，请通过发布流程推送',
    '✓ 已同步远端：fetch 完成，已推送 ◇ → ◇',
    '✕ 同步完成但部分推送失败：◇（◇）；main 已跳过，请通过发布流程推送',
    '✕ 同步完成但部分推送失败：◇（◇）',
  ];
  for (const k of need) assert.ok(EN_DYNAMIC[k], `动态词条应收录：${k}`);
  I.setLang('en');
  assert.match(I.t(okMain), /^✓ Remote synced: fetch done, pushed dev、feat → origin; main skipped/, '成功 + main 注记应翻译');
  assert.equal(I.t(okPlain), EN_DYNAMIC['✓ 已同步远端：fetch 完成，已推送 ◇ → ◇'].replace('$1', 'dev').replace('$2', 'origin'), '成功无注记应翻译');
  assert.match(I.t(failMain), /^✕ .*feat \(网络不可达\); main skipped/, '部分失败 + main 注记应翻译');
  assert.match(I.t(failPlain), /push failures: feat/, '部分失败无注记应翻译');
  I.setLang('zh');
  assert.equal(I.t(I.t(okMain)), okMain, '切回中文可还原（往返）');
});

/* ---------- S1：不越界静态断言 ---------- */

t('S1 不越界：徽标代码 / 样式无残留，main 行无任何推送入口；syncRemote 排除 main 的服务端行为未被触碰', () => {
  // BUG-20260914-018：mainFlagHtml / .bld-main-flag 全量清理，不留死代码
  assert.ok(!/mainFlagHtml/.test(buildJs), 'build.js 不得残留 mainFlagHtml（BUG-20260914-018 清理）');
  assert.ok(!/bld-main-flag/.test(buildJs), 'build.js 不得残留 bld-main-flag 钩子');
  const styleCss = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');
  assert.ok(!/bld-main-flag/.test(styleCss), 'style.css 不得残留 .bld-main-flag 样式（死代码清理）');
  // 展示层：main 行不渲染 data-push（行为断言见 U2，此处源码双保险）
  const m = buildJs.match(/x === 'main' \? [\s\S]{0,400}? :/);
  assert.ok(m, 'main 行渲染分支应存在');
  assert.ok(!/data-push/.test(m[0]), 'main 行渲染分支不得包含推送入口');
  // 服务端：syncRemote 排除 main 行为不变（本单仅展示层）
  assert.match(buildGitJs, /if \(branch === 'main'\) \{ skipped\.push\(branch\); continue; \}/, 'syncRemote 排除 main 逻辑保持原样');
});

/* ---------- 执行 ---------- */

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}`);
    console.error(`  ${String(e && e.message ? e.message : e).split('\n').join('\n  ')}`);
  }
}
console.log(`\n${cases.length} 用例，失败 ${failed}`);
process.exit(failed ? 1 : 0);
