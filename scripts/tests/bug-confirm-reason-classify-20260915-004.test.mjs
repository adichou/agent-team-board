#!/usr/bin/env node
// BUG-20260915-004 挂起确认面板错误提示透传截断的原始 git 报错，缺少可读原因与处理指引 —— 修复回归。
// 用法：node scripts/tests/bug-confirm-reason-classify-20260915-004.test.mjs
// 覆盖（README 验收标准）：
//   · C1 采集侧保头保尾：run-20260914-250 形态的 index.lock 失败现场，回执 suspended.reason
//     与确认记录 reason 不再拦腰截断丢关键段（index.lock / File exists 保留，长度受控）；
//   · C2 归类逻辑单元：classifySuspendReason（index.lock 瞬时冲突可重试 + 未知错误兜底）；
//   · C3 侧拉面板默认分层：归类结论条（含下一步指引）+ 原始输出折叠区（不丢原因）；
//   · C4 任务页卡片与队列暂停横幅同款分层（三处统一口径）；
//   · C5 归类文案双语（i18n 词典命中）。
// 模式对齐 bug-confirm-panel-scope-20260915-003.test.mjs（真实 git 临时仓库 + vm 渲染片段）。

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as core from '../lib/core.mjs';
import * as batch from '../lib/batch.mjs';
import * as confirmStates from '../lib/confirm-states.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function git(root, args) {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r;
}

function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-confirm-cls-')));
}

function mkProject() {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(root, 'README.md'), '# t\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'fixture', version: '1.0.0', private: true,
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2));
  core.initData(root);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 初始化测试仓库']);
  return root;
}

// 复现 run-20260914-250 现场：git add 因 .git/index.lock 存在而失败（0 组提交失败后挂起）
function mkAddFailureSuspension(root, title) {
  const dataDir = core.dataDirFrom(root);
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'lib', 'impl.mjs'), 'v1\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 被测源码入库']);
  const item = core.createItem(dataDir, { type: 'bug', title });
  core.setStatus(dataDir, item.id, 'accepted', { by: 'human' });
  core.setStatus(dataDir, item.id, 'planned', { by: 'human' });
  batch.createBatch(dataDir, { projectRoot: root });
  const nx = batch.nextItem(dataDir, batch.queueHeadBatch(dataDir).batchId, { owner: 'w1' });
  core.claim(dataDir, item.id, 'w1');
  fs.appendFileSync(path.join(root, 'scripts', 'lib', 'impl.mjs'), '本单实现改动\n');
  fs.mkdirSync(path.join(root, 'scripts', 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'tests', `${item.id}.test.mjs`), 'import assert from "node:assert/strict";\n');
  fs.appendFileSync(path.join(nx.itemDir, 'README.md'), '\n实施补充\n');
  core.report(dataDir, item.id, { summary: '实施完成', by: 'w1', run: { runId: nx.runId } });
  fs.writeFileSync(path.join(root, '.git', 'index.lock'), 'stale lock\n');
  const { receipt } = batch.finishRun(dataDir, nx.runId, { result: 'reported', reportRef: 'test-report.md' });
  return { dataDir, item, runId: nx.runId, receipt };
}

// ---------- C1 采集侧：挂起 reason 保头保尾（不拦腰截断丢原因） ----------

t('C1 index.lock 失败现场：回执 suspended.reason 与确认记录 reason 保留关键段（不再 slice 拦腰），长度受控', () => {
  const root = mkProject();
  const { dataDir, item, receipt } = mkAddFailureSuspension(root, '归类采集单');

  assert.ok(receipt.suspended, '失败应触发挂起');
  const sr = String(receipt.suspended.reason || '');
  assert.ok(sr.includes('自动提交失败'), `回执挂起原因应说明自动提交失败：${sr}`);
  assert.ok(sr.includes('index.lock'), `回执挂起原因应保留 index.lock 关键段（保头保尾/提高上限）：${sr}`);
  assert.ok(sr.includes('File exists'), `回执挂起原因应保留 File exists 结论段：${sr}`);
  assert.ok([...sr].length <= 200, `回执挂起原因长度应受控（≤200）：${[...sr].length}`);

  const rec = confirmStates.confirmOf(dataDir, item.id);
  assert.ok(rec, '失败应创建挂起确认记录');
  assert.ok(rec.reason.includes('index.lock'), `账本 reason 应保留 index.lock 关键段：${rec.reason}`);
  assert.ok(rec.reason.includes('File exists'), `账本 reason 应保留 File exists 结论段：${rec.reason}`);
  assert.ok([...rec.reason].length <= confirmStates.REASON_MAX_CHARS,
    `账本 reason 长度应 ≤ REASON_MAX_CHARS：${[...rec.reason].length}`);
  // 超长 reason 的保头保尾（非拦腰）：头部现象 + 尾部结论 + 省略衔接，长度不超上限
  const longReason = `git add失败：fatal: Unable to create '${root}/.git/index.lock': File exists.；`
    + 'x'.repeat(400);
  const clipped = confirmStates.clipReasonKeepEnds(longReason, 200);
  assert.ok([...clipped].length <= 200, `保头保尾结果应受控：${[...clipped].length}`);
  assert.ok(clipped.startsWith('git add失败'), `保头保尾应保留头部现象：${clipped.slice(0, 30)}`);
  assert.ok(clipped.includes('……'), '超长截断应以省略号衔接中段');
  assert.ok(/[xy]+$/.test(clipped) || clipped.endsWith('x'), '保头保尾应保留尾部');
});

// ---------- C2 归类逻辑单元（vm 提取 app.js） ----------

const appSource = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');

function loadClassifyFragment(context) {
  const start = appSource.indexOf('function classifySuspendReason(');
  const end = appSource.indexOf('function confirmCardHtml(');
  assert.ok(start > 0 && end > start, 'app.js 应包含 classifySuspendReason 片段');
  vm.runInContext(appSource.slice(start, end), context);
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const incidentFull = `fatal: Unable to create '${'/Users/adichou/Documents/src/agent-team-board'}/.git/index.lock': File exists.\n`
  + 'Another git process seems to be running in this repository, e.g.\nan editor opened by "git commit".';

t('C2a classifySuspendReason：index.lock 现场归「瞬时冲突可重试」，附下一步指引', () => {
  const ctx = vm.createContext({ esc });
  loadClassifyFragment(ctx);
  const r = vm.runInContext(`classifySuspendReason(${JSON.stringify(incidentFull)})`, ctx);
  assert.equal(r.kind, 'index-lock', `应归类 index-lock：${JSON.stringify(r)}`);
  assert.ok(/索引/.test(r.cause) && /占用|并发/.test(r.cause), `归类原因应说明索引被占用：${r.cause}`);
  assert.ok(r.cause.includes('瞬时冲突') && r.cause.includes('可重试'), `归类原因应含瞬时冲突/可重试语义：${r.cause}`);
  assert.ok(r.hint.includes('重新核验') && r.hint.includes('确认并继续'), `应给出下一步指引：${r.hint}`);
});

t('C2b classifySuspendReason：未知错误兜底「原因未知，附原始输出」；空输入不抛错', () => {
  const ctx = vm.createContext({ esc });
  loadClassifyFragment(ctx);
  const r = vm.runInContext(`classifySuspendReason(${JSON.stringify('自动提交失败：exit 128（其余未知错误）')})`, ctx);
  assert.equal(r.kind, 'unknown');
  assert.ok(r.cause.includes('原因未知'), `未知错误应如实归「原因未知」：${r.cause}`);
  assert.ok(r.hint.includes('原始输出'), `未知错误应引导查看原始输出：${r.hint}`);
  const empty = vm.runInContext('classifySuspendReason("")', ctx);
  assert.equal(empty.kind, 'unknown', '空输入应走未知兜底，不抛错');
});

// ---------- C3 侧拉面板默认分层（run-20260914-250 挂起数据形态） ----------

function runRenderFragment(detail) {
  const nodes = new Map();
  const mk = (id) => {
    const el = { textContent: '', innerHTML: '', classList: { add() {}, remove() {}, toggle() {}, contains: () => false } };
    nodes.set(`#${id}`, el);
    return el;
  };
  for (const id of ['confirmPanelTitle', 'confirmPanelScope', 'confirmForm', 'confirmScopeSummary', 'confirmUnresolved']) mk(id);
  const context = vm.createContext({
    $: (s) => nodes.get(s) || nodes.get(s.replace(/^#confirmForm /, '')) || null,
    esc,
    fmtTime: () => '12:00',
    confirmSide: { busy: false, attr: new Map(), needsReverify: false },
    state: { confirms: { busyId: null } },
    confirmScopeText: (c) => `待提交：${c.pendingCount} 个路径`,
    confirmAttrOf: () => null,
    bindConfirmFormActions: () => {},
  });
  loadClassifyFragment(context); // BUG-20260915-004：面板引用的归类条助手
  const start = appSource.indexOf('function renderConfirmForm(');
  const end = appSource.indexOf('function bindConfirmFormActions(');
  assert.ok(start > 0 && end > start, 'app.js 应包含 renderConfirmForm 片段');
  vm.runInContext(appSource.slice(start, end), context);
  vm.runInContext(`renderConfirmForm(${JSON.stringify(detail)})`, context);
  return { html: nodes.get('#confirmForm').innerHTML };
}

// 现场数据形态：reason 为采集侧修复后的全句（含 index.lock），error.full 为完整原始 stderr
const incidentReason = `自动提交失败：git add失败：fatal: Unable to create '/Users/adichou/Documents/src/agent-team-board/.git/index.lock': File exists.；Another git process seems to be running in this （已成功提交 0 组，hash 已保留，不重复提交）`;

t('C3 面板默认分层：归类结论条（索引被占用/瞬时冲突/可重试 + 指引）+ 原始输出折叠区不丢原因', () => {
  const { html } = runRenderFragment({
    itemId: 'BUG-20260914-020', kind: 'develop', blockTypeLabel: '待人工确认提交', state: 'waiting',
    reason: incidentReason, legacy: false, committedCount: 0, supplementCommits: [],
    pendingCount: 3, attributedCount: 2, uncertainCount: 1, scopeUnknown: false,
    files: [{ path: 'scripts/lib/impl.mjs', group: 'own', kind: '修改', state: '未提交' }],
    verify: null, keepNote: null, fingerprint: { files: {} },
    error: { summary: incidentReason.slice(0, 160), full: incidentFull },
  });
  // 验收 1：默认提示包含「索引被占用/瞬时冲突/可重试」语义的归类原因与下一步指引
  assert.ok(html.includes('confirm-classify'), '应有归类结论条节点');
  assert.ok(html.includes('k-index-lock'), `应归类为 index-lock：${html.slice(0, 200)}`);
  assert.ok(/索引/.test(html) && /瞬时冲突/.test(html) && /可重试/.test(html), '归类条应含索引被占用/瞬时冲突/可重试语义');
  assert.ok(html.includes('重新核验') && html.includes('确认并继续'), '归类条应给出下一步指引');
  // 验收 2：原始完整错误可折叠查看，不再拦腰截断丢原因
  assert.ok(/<details[^>]*confirm-(reason|err)-full/.test(html) || html.includes('完整错误'), '应有可折叠的完整原始输出');
  assert.ok(html.includes('index.lock') && html.includes('File exists'), '折叠区应保留 index.lock / File exists 关键段');
  assert.ok(/完整原始输出|完整错误/.test(html), '折叠入口文案应表明完整输出');
});

t('C3b 历史截断记录（无 error 字段）：不编造归类，reason 原文保留', () => {
  const { html } = runRenderFragment({
    itemId: 'BUG-old', kind: 'develop', blockTypeLabel: '待人工确认提交', state: 'waiting',
    reason: "自动提交失败：git add失败：fatal: Unable to create '/Users/adichou/Documents/src/agent-team-board",
    legacy: false, committedCount: 0, supplementCommits: [], pendingCount: 1, attributedCount: 1,
    uncertainCount: 0, scopeUnknown: false,
    files: [{ path: 'a.js', group: 'own', kind: '修改', state: '未提交' }],
    verify: null, keepNote: null, fingerprint: { files: {} },
  });
  assert.ok(!html.includes('k-index-lock'), '无 error 现场不得凭截断串编造 index-lock 归类');
  assert.ok(html.includes('confirm-reason'), 'reason 原文段落应保留');
});

// ---------- C4 任务页卡片与队列暂停横幅（三处统一分层） ----------

function runCardFragment(card) {
  const context = vm.createContext({
    esc,
    fmtElapsed: () => '1 分',
    fmtTime: () => '12:00',
    shortOwner: (s) => String(s || ''),
    state: { confirms: { busyId: null } },
  });
  const start = appSource.indexOf('function confirmKindChip(');
  const end = appSource.indexOf('function renderConfirmArea(');
  assert.ok(start > 0 && end > start, 'app.js 应包含卡片渲染片段');
  vm.runInContext(appSource.slice(start, end), context);
  return vm.runInContext(`confirmCardHtml(${JSON.stringify(card)})`, context);
}

function runBannerFragment(items) {
  const context = vm.createContext({ esc, state: { confirms: { data: { items } } } });
  const start = appSource.indexOf('function confirmQueueBannerHtml(');
  const end = appSource.indexOf('async function verifyConfirmItem(');
  assert.ok(start > 0 && end > start, 'app.js 应包含横幅渲染片段');
  vm.runInContext(appSource.slice(start, end), context);
  // 横幅片段依赖归类分层助手（同文件内先定义）
  const s2 = appSource.indexOf('function classifySuspendReason(');
  const e2 = appSource.indexOf('function confirmCardHtml(');
  vm.runInContext(appSource.slice(s2, e2), context);
  return vm.runInContext('confirmQueueBannerHtml("develop")', context);
}

const incidentCard = {
  itemId: 'BUG-20260914-020', title: '已合并的版本计划不允许再使用 AI 完善按钮了。', itemStatus: 'in-progress',
  kind: 'develop', kindLabel: '开发', blockType: 'commit', blockTypeLabel: '待人工确认提交',
  state: 'waiting', stateLabel: '待人工确认', round: 1, declaredAt: new Date().toISOString(),
  declaredBy: 'auto-commit', runId: 'run-20260914-250', batchId: 'b1',
  reason: incidentReason, legacy: false, keepNote: null,
  committedCount: 0, pendingCount: 3, attributedCount: 2, uncertainCount: 1, scopeUnknown: false,
  pendingManual: [], heldGroups: null, supplementCommits: [], verify: null,
  fingerprint: { files: {} }, error: { summary: incidentReason.slice(0, 160), full: incidentFull },
  partialBadge: true,
};

t('C4a 任务页卡片：归类结论条 + 折叠完整原始输出（不依赖截断串）', () => {
  const html = runCardFragment(incidentCard);
  assert.ok(html.includes('confirm-classify') && html.includes('k-index-lock'), '卡片应有 index-lock 归类结论条');
  assert.ok(/瞬时冲突/.test(html) && /可重试/.test(html), '卡片归类条应含瞬时冲突/可重试语义');
  assert.ok(html.includes('重新核验') && html.includes('确认并继续'), '卡片应保留操作入口/指引');
  assert.ok(/完整原始输出（\d+ 字符，不截断）/.test(html), '卡片应有完整原始输出折叠入口（标注不截断）');
  assert.ok(html.includes('index.lock') && html.includes('File exists'), '折叠区应保留关键段');
});

t('C4b 队列暂停横幅：同款「归类结论条 + 折叠完整原始输出」分层', () => {
  const html = runBannerFragment([incidentCard]);
  assert.ok(html.includes('confirm-queue-banner'), '横幅节点应保留');
  assert.ok(html.includes('confirm-classify') && html.includes('k-index-lock'), '横幅应带归类结论条');
  assert.ok(/完整原始输出（\d+ 字符，不截断）/.test(html), '横幅应有完整原始输出折叠入口');
  assert.ok(html.includes('BUG-20260914-020'), '横幅应保留条目单号');
});

t('C4c 非 git 失败挂起（无 error）与分析侧：保持人话 reason 原样，不套归类条', () => {
  const incomplete = { ...incidentCard, reason: '自动提交不完整：存在归属不明或暂扣待人工路径', error: null };
  const cardHtml = runCardFragment(incomplete);
  assert.ok(!cardHtml.includes('confirm-classify'), '非失败挂起不得套「原因未知」归类条');
  assert.ok(cardHtml.includes('存在归属不明或暂扣待人工路径'), 'reason 人话原文应保留');

  const analyzeCard = {
    ...incidentCard, kind: 'analyze', kindLabel: '分析', blockType: 'analysis',
    blockTypeLabel: '待人工确认分析', reason: '两版方案取舍需人工确认', error: null,
    questionsVersion: 'v1', answered: 0, unansweredRequired: ['q1'], total: 1,
  };
  const analyzeHtml = runCardFragment(analyzeCard);
  assert.ok(!analyzeHtml.includes('confirm-classify'), '分析侧挂起原因是人写的短句，不套归类条');
  assert.ok(analyzeHtml.includes('两版方案取舍需人工确认'), '分析侧 reason 原样展示');
});

// ---------- C5 归类文案双语（i18n 词典命中） ----------

t('C5 归类/折叠文案已入 i18n 双语词典（EN 静态 + 动态字符数）', async () => {
  await import('../web/i18n.js');
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN, EN_DYNAMIC } = I._dict;
  const staticKeys = [
    'git 索引被并发进程占用（瞬时冲突，可重试）',
    '「重新核验」或「确认并继续」即可重试补交',
    '原因未知（未匹配已知失败归类）',
  ];
  for (const k of staticKeys) {
    assert.ok(k in EN, `EN 词典应含归类文案：${k}`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN[k]), `EN 值不得含中文：${k} → ${EN[k]}`);
  }
  assert.ok(!('完整原始输出（◇ 字符，不截断）' in EN), '动态字符数文案不得入静态词典');
  assert.ok(!('完整原始输出（◇ 字符，不截断）' in EN_DYNAMIC) === false, 'EN_DYNAMIC 应含完整原始输出（◇ 字符，不截断）');
  I.setLang('en');
  try {
    assert.ok(I.t('git 索引被并发进程占用（瞬时冲突，可重试）').includes('index') || I.t('git 索引被并发进程占用（瞬时冲突，可重试）').toLowerCase().includes('git'),
      `EN 翻译应说明 git index 被占用：${I.t('git 索引被并发进程占用（瞬时冲突，可重试）')}`);
    assert.ok(I.t('完整原始输出（193 字符，不截断）').includes('untruncated') || I.t('完整原始输出（193 字符，不截断）').includes('Full'),
      `动态折叠入口应可译：${I.t('完整原始输出（193 字符，不截断）')}`);
  } finally {
    I.setLang('zh');
  }
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
