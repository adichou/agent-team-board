#!/usr/bin/env node
// BUG-20260917-003 挂起确认面板「归属待确认」路径缺少批量计入/排除操作，大量路径时须逐项选择 —— 修复回归。
// 用法：node scripts/tests/bug-20260917-003.test.mjs
// 覆盖（README 验收说明）：
//   · T1 批量入口渲染：归属待确认组内出现「全部计入 / 全部排除」批量条（waiting 态可用；
//     busy / 已确认（resolved）/ 组内无未入库行时禁用）；「本单可归属」组无批量条；
//   · T2 全部排除一步生效：组内全部未入库行下拉同步变「排除（保持工作区）」，摘要显示
//     「排除 N 个」、「待核对」提示消失；已入库行不受影响、不计入摘要；
//   · T3 全部计入一步生效：摘要显示「归属待确认已计入 N 个 = 将补交 …」；
//   · T4 批量与逐项互相覆盖：批量后逐项改一行摘要即时反映；再次批量整体覆盖逐项结果；
//   · T5 服务端口径不弱化（源码契约）：确认拦截与 include 仍按 confirmSide.attr 逐路径显式
//     构建（已入库行不参与拦截判定），批量不引入静默并入；
//   · T6 i18n 双语：新增界面文案在 scripts/web/i18n.js 词典有英文译文（值不含中文）。
// 模式对齐 bug-confirm-panel-scope-20260915-003.test.mjs P5（vm 片段渲染），
// 并用轻量 fake DOM 解析渲染产物驱动真实 bindConfirmFormActions 交互。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import '../web/i18n.js';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const appSource = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// ---------- 轻量 fake DOM ----------

function mkNode(extra = {}) {
  const classes = new Set();
  const listeners = new Map();
  return Object.assign({
    textContent: '', innerHTML: '', value: '', disabled: false, dataset: {},
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, on) => { const to = on === undefined ? !classes.has(c) : !!on; to ? classes.add(c) : classes.delete(c); },
    },
    addEventListener(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, []); listeners.get(ev).push(fn); },
    fire(ev) { for (const fn of listeners.get(ev) || []) fn(); },
    click() { this.fire('click'); },
    change() { this.fire('change'); },
  }, extra);
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 渲染 develop 挂起确认面板（真实 renderConfirmForm / updateConfirmScopeSummary 片段），
// 解析渲染产物重建归属下拉与批量按钮节点，再挂真实 bindConfirmFormActions 片段供交互。
function buildPanel(detail, { busyId = null } = {}) {
  const confirmSide = {
    open: true, busy: false, id: detail.itemId, seq: 1, detail,
    attr: new Map(), needsReverify: false, opener: null,
  };
  const nodes = new Map();
  for (const id of ['confirmPanelTitle', 'confirmPanelScope', 'confirmForm', 'confirmScopeSummary', 'confirmUnresolved', 'confirmPanelMsg']) {
    nodes.set(`#${id}`, mkNode());
  }
  const $ = (s) => nodes.get(s) || nodes.get(s.replace(/^#confirmForm /, '')) || null;
  const ctx = vm.createContext({
    $, esc,
    fmtTime: () => '12:00',
    confirmSide,
    state: { confirms: { busyId } },
    confirmScopeText: (c) => {
      if (c.scopeUnknown || c.pendingCount == null) return '待提交：待核对（无法扫描工作区，不显示误导性 0）';
      const base = `待提交：${c.pendingCount} 个路径`;
      if (c.attributedCount == null || c.uncertainCount == null) return base;
      return `${base}（本单可归属 ${c.attributedCount} · 归属待确认 ${c.uncertainCount}）`;
    },
    confirmAttrOf: (p) => (confirmSide.attr instanceof Map ? confirmSide.attr.get(p) || null : null),
    bindConfirmFormActions: () => {}, // 渲染阶段先占位，交互前替换为真实片段
  });
  const start = appSource.indexOf('function renderConfirmForm(');
  const mid = appSource.indexOf('function bindConfirmFormActions(');
  const end = appSource.indexOf('async function loadConfirmDiff(');
  assert.ok(start > 0 && mid > start && end > mid, 'app.js 应包含挂起确认面板片段');
  vm.runInContext(appSource.slice(start, mid), ctx);
  vm.runInContext(`renderConfirmForm(${JSON.stringify(detail)})`, ctx);

  const html = nodes.get('#confirmForm').innerHTML;
  // 解析渲染产物：归属下拉（路径 + 是否禁用）与批量按钮（include/exclude + 是否禁用）
  const selects = [...html.matchAll(/<select class="attr-select" data-confirm-attr="([^"]+)"[^>]*>/g)]
    .map((m) => mkNode({ dataset: { confirmAttr: m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&') }, disabled: /disabled/.test(m[0]) }));
  const batchBtns = [...html.matchAll(/data-confirm-batch="(include|exclude)"([^>]*)>/g)]
    .map((m) => mkNode({ dataset: { confirmBatch: m[1] }, disabled: /\bdisabled\b/.test(m[2]) }));
  const form = nodes.get('#confirmForm');
  form.querySelectorAll = (sel) => (sel === '[data-confirm-attr]' ? selects
    : sel === '[data-confirm-batch]' ? batchBtns : []);
  form.querySelector = () => null;

  // 挂真实交互绑定（归属选择 / 批量操作）
  vm.runInContext(appSource.slice(mid, end), ctx);
  vm.runInContext(`bindConfirmFormActions(${JSON.stringify(detail)})`, ctx);
  return {
    html, confirmSide, selects, batchBtns, form,
    summary: nodes.get('#confirmScopeSummary'),
    hint: nodes.get('#confirmUnresolved'),
  };
}

const DETAIL = {
  itemId: 'BUG-20260917-003', kind: 'develop', blockTypeLabel: '待人工确认提交', state: 'waiting',
  reason: '自动提交失败', legacy: false, committedCount: 0, supplementCommits: [],
  pendingCount: 5, attributedCount: 1, uncertainCount: 4, scopeUnknown: false,
  files: [
    { path: 'scripts/lib/impl.mjs', group: 'own', kind: '修改', state: '未提交' },
    { path: 'dist/bundle.js', group: 'undetermined', kind: '新增', state: '未提交' },
    { path: 'agent-team-board/data/README.md', group: 'undetermined', kind: '修改', state: '未提交' },
    { path: 'shared/config.json', group: 'undetermined', kind: '修改', state: '未提交' },
    { path: 'shared/committed.log', group: 'undetermined', kind: '修改', state: '已入库' },
  ],
  verify: null, keepNote: null, fingerprint: { files: {} },
};

const btnOf = (panel, val) => panel.batchBtns.find((b) => b.dataset.confirmBatch === val);
const selOf = (panel, p) => panel.selects.find((s) => s.dataset.confirmAttr === p);

// ---------- T1：批量入口渲染与禁用态 ----------

t('T1 批量入口：归属待确认组出现「全部计入 / 全部排除」，waiting 可用；busy / resolved / 无未入库行禁用；本单可归属组无批量条', () => {
  const panel = buildPanel(DETAIL);
  assert.equal(panel.batchBtns.length, 2, `应有全部计入 / 全部排除两个批量按钮：${panel.batchBtns.length}`);
  const inc = btnOf(panel, 'include');
  const exc = btnOf(panel, 'exclude');
  assert.ok(inc && exc, 'include / exclude 按钮均应存在');
  assert.ok(!inc.disabled && !exc.disabled, 'waiting 态批量按钮应可用');
  // 批量条紧跟归属待确认组头之后、文件表之前（组内专属，不污染本单可归属组）
  const headIdx = panel.html.indexOf('归属待确认（4）');
  const ownIdx = panel.html.indexOf('本单可归属（1）');
  const barIdx = panel.html.indexOf('全部计入');
  assert.ok(headIdx > ownIdx && barIdx > headIdx, '批量条应位于归属待确认组头之后');
  assert.ok(!panel.html.slice(ownIdx, headIdx).includes('全部计入'), '本单可归属组不得出现批量条');

  // busy 态（服务端互斥 / 任务运行中）：与行内下拉一致禁用
  const busyPanel = buildPanel(DETAIL, { busyId: DETAIL.itemId });
  assert.ok(btnOf(busyPanel, 'include').disabled && btnOf(busyPanel, 'exclude').disabled, 'busy 态批量按钮应禁用');
  assert.ok(busyPanel.selects.every((s) => s.disabled), 'busy 态行内下拉应禁用（对照）');

  // 已确认（resolved）态：与行内下拉一致禁用
  const resolvedPanel = buildPanel({ ...DETAIL, state: 'resolved' });
  assert.ok(btnOf(resolvedPanel, 'include').disabled && btnOf(resolvedPanel, 'exclude').disabled, 'resolved 态批量按钮应禁用');
  assert.ok(resolvedPanel.selects.every((s) => s.disabled), 'resolved 态行内下拉应禁用（对照）');

  // 组内无未入库行（全部已入库）：批量无作用对象，禁用
  const allIn = buildPanel({ ...DETAIL, files: DETAIL.files.map((f) => ({ ...f, state: '已入库' })) });
  assert.ok(btnOf(allIn, 'include').disabled && btnOf(allIn, 'exclude').disabled, '组内无未入库行时批量按钮应禁用');
});

// ---------- T2：全部排除一步生效（已入库行不受影响） ----------

t('T2 全部排除：组内未入库行下拉同步为排除，摘要「排除 N 个」、待核对消失；已入库行不受影响不计入', () => {
  const panel = buildPanel(DETAIL);
  btnOf(panel, 'exclude').click();
  for (const p of ['dist/bundle.js', 'agent-team-board/data/README.md', 'shared/config.json']) {
    assert.equal(selOf(panel, p).value, 'exclude', `${p} 下拉应同步为排除`);
    assert.equal(panel.confirmSide.attr.get(p), 'exclude', `${p} 归属应显式置为 exclude`);
  }
  // 已入库行不参与批量：下拉保持未选择、attr 不写入
  assert.equal(selOf(panel, 'shared/committed.log').value, '', '已入库行下拉不应被批量改动');
  assert.equal(panel.confirmSide.attr.get('shared/committed.log'), undefined, '已入库行归属不得写入');
  // 摘要一步到位：排除 3 个、无未处理、待核对提示隐藏
  const s = panel.summary.textContent;
  assert.ok(s.includes('排除 3 个'), `摘要应显示排除 3 个：${s}`);
  assert.ok(!s.includes('未处理'), `排除完不应再有未处理提示：${s}`);
  assert.ok(panel.hint.classList.contains('hidden'), '待核对提示应隐藏');
});

// ---------- T3：全部计入一步生效 ----------

t('T3 全部计入：摘要显示「归属待确认已计入 N 个 = 将补交 …」，将补交数含本单可归属', () => {
  const panel = buildPanel(DETAIL);
  btnOf(panel, 'include').click();
  for (const p of ['dist/bundle.js', 'agent-team-board/data/README.md', 'shared/config.json']) {
    assert.equal(selOf(panel, p).value, 'include', `${p} 下拉应同步为计入`);
  }
  const s = panel.summary.textContent;
  assert.ok(s.includes('归属待确认已计入 3 个'), `摘要应显示已计入 3 个：${s}`);
  assert.ok(s.includes('将补交 4 个路径'), `将补交应为本单可归属 1 + 已计入 3：${s}`);
  assert.ok(!s.includes('未处理') && panel.hint.classList.contains('hidden'), '全部处理后无未处理提示');
});

// ---------- T4：批量与逐项互相覆盖 ----------

t('T4 覆盖关系：批量后逐项改一行摘要即时反映；再次批量整体覆盖逐项结果', () => {
  const panel = buildPanel(DETAIL);
  btnOf(panel, 'exclude').click();
  // 逐项覆盖：把一行改选计入
  const one = selOf(panel, 'dist/bundle.js');
  one.value = 'include';
  one.change();
  let s = panel.summary.textContent;
  assert.ok(s.includes('归属待确认已计入 1 个') && s.includes('排除 2 个'), `逐项覆盖后摘要应即时反映（已计入 1 / 排除 2）：${s}`);
  assert.equal(panel.confirmSide.attr.get('dist/bundle.js'), 'include', '逐项覆盖应写入最新值');
  // 再次批量：整体覆盖逐项结果（以最后一次操作为准）
  btnOf(panel, 'include').click();
  s = panel.summary.textContent;
  assert.ok(s.includes('归属待确认已计入 3 个') && !s.includes('排除'), `再次批量应整体覆盖逐项结果：${s}`);
  assert.equal(panel.confirmSide.attr.get('dist/bundle.js'), 'include', '批量覆盖后归属为最新批量值');
  for (const p of ['agent-team-board/data/README.md', 'shared/config.json']) {
    assert.equal(selOf(panel, p).value, 'include', `${p} 下拉应同步最新批量值`);
  }
});

// ---------- T5：服务端口径不弱化（源码契约） ----------

t('T5 服务端口径：拦截与 include 仍逐路径显式构建（已入库不参与），批量不引入静默并入', () => {
  // 确认并继续的拦截 / include 构建保持既有口径：按 state !== '已入库' 过滤 + confirmAttrOf 逐路径读取
  const contStart = appSource.indexOf('async function confirmContinueAction(');
  const contEnd = appSource.indexOf('function setConfirmButtonsDisabled(');
  assert.ok(contStart > 0 && contEnd > contStart, '应存在 confirmContinueAction 片段');
  const cont = appSource.slice(contStart, contEnd);
  assert.ok(cont.includes("=== 'undetermined' && f.state !== '已入库'"), '拦截判定应继续排除已入库行');
  assert.ok(cont.includes("confirmAttrOf(f.path) === 'include'"), 'include 应继续由逐路径显式选择构建');
  assert.ok(cont.includes('全局文件不得静默整批归为本单'), '拦截文案口径不得弱化');
  // 批量操作不得触碰请求体构建：data-confirm-batch 处理只写前端归属 Map 与下拉显示
  const bindStart = appSource.indexOf('function bindConfirmFormActions(');
  const bindEnd = appSource.indexOf('async function loadConfirmDiff(');
  const bind = appSource.slice(bindStart, bindEnd);
  const batchIdx = bind.indexOf('data-confirm-batch');
  assert.ok(batchIdx > 0, '批量操作应在面板交互绑定中处理');
  assert.ok(!bind.slice(batchIdx).includes('/api/confirms'), '批量操作不得直接发确认请求（口径留给确认并继续）');
});

// ---------- T6：i18n 双语同步 ----------

t('T6 i18n 双语：批量条新增文案均有英文词条（值不含中文），中文原文以词典键精确匹配', () => {
  const { EN } = globalThis.ATBI18N._dict;
  const zh = [
    '全部计入',
    '全部排除',
    '批量选择：',
    '批量计入：把归属待确认的全部未入库路径显式选为「计入本次补交」，仍可逐项覆盖',
    '批量排除：把归属待确认的全部未入库路径显式选为「排除（保持工作区）」，仍可逐项覆盖',
    '作用于归属待确认的未入库路径；批量后仍可逐项覆盖',
  ];
  const missing = zh.filter((k) => !(k in EN));
  assert.deepEqual(missing, [], `缺少词典条目：${missing.join('；')}`);
  const zhInVal = zh.filter((k) => /[\u4e00-\u9fff]/.test(EN[k]));
  assert.deepEqual(zhInVal, [], `英文值不得含中文：${zhInVal.join('；')}`);
  // app.js 中的批量条文案与词典键逐字一致（防键形态漂移）
  for (const k of zh.slice(0, 2)) assert.ok(appSource.includes(`>${k}</button>`), `按钮文案应精确为词典键：${k}`);
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
