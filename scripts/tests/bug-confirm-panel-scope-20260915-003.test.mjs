#!/usr/bin/env node
// BUG-20260915-003 提交确认面板计数与核验不一致、缺少待提交差异且 Git 错误被截断 —— 修复回归。
// 用法：node scripts/tests/bug-confirm-panel-scope-20260915-003.test.mjs
// 覆盖（README 验收说明）：
//   · P1 git add 失败（index.lock 现场复现）：完整 Git 错误保留（errorFull 落 auto-commit.json
//     与确认记录，不截断）；卡片/详情计数与文件表/核验同一口径（候选范围扫描），空 pendingManual
//     也展示实际候选文件，不显示误导性 0；候选文件带归属分组与变更类型；
//   · P2 归属待确认显式选择：全局文件默认排除（不静默整批并入），include 显式计入才补交；
//   · P3 内容变化拦截：指纹不符拒绝确认 → 重新核验刷新基线 → 确认成功；
//   · P4 声明后新增归属待确认路径：确认被拦截并要求先重新核验；
//   · P5 面板渲染（vm）：分组文件表 / 变更类型 / 计入-排除选择 / 空态 / 错误块（摘要+全文+复制、
//     历史截断信息不足）/ 确认范围摘要 / 按钮场景说明；
//   · P6 差异读取失败：服务端明确报错（不冒充无差异），UI 呈现错误 + 重试。
// 模式对齐 confirm-block-20260914-001.test.mjs（真实 git 临时仓库 + 端到端经 batch.finishRun）。

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as core from '../lib/core.mjs';
import * as batch from '../lib/batch.mjs';
import * as confirmStore from '../lib/confirm-store.mjs';
import * as confirmStates from '../lib/confirm-states.mjs';
import * as gitFlow from '../lib/git-flow.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
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
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-confirm-scope-')));
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

function mkPlannedItem(dataDir, title, type = 'bug') {
  const x = core.createItem(dataDir, { type, title });
  core.setStatus(dataDir, x.id, 'accepted', { by: 'human' });
  core.setStatus(dataDir, x.id, 'planned', { by: 'human' });
  return x;
}

// 复现 BUG-20260914-020 现场：git add 因 .git/index.lock 存在而失败（0 组提交失败）
function mkAddFailureSuspension(root, title) {
  const dataDir = core.dataDirFrom(root);
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'lib', 'impl.mjs'), 'v1\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 被测源码入库']);
  const item = mkPlannedItem(dataDir, title);
  batch.createBatch(dataDir, { projectRoot: root });
  const nx = batch.nextItem(dataDir, batch.queueHeadBatch(dataDir).batchId, { owner: 'w1' });
  core.claim(dataDir, item.id, 'w1');
  fs.appendFileSync(path.join(root, 'scripts', 'lib', 'impl.mjs'), '本单实现改动\n');
  fs.mkdirSync(path.join(root, 'scripts', 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'tests', `${item.id}.test.mjs`), 'import assert from "node:assert/strict";\n');
  fs.appendFileSync(path.join(nx.itemDir, 'README.md'), '\n实施补充\n');
  core.report(dataDir, item.id, { summary: '实施完成', by: 'w1', run: { runId: nx.runId } });
  // 模拟并发 git 进程残留的 index.lock：git add 阶段失败
  fs.writeFileSync(path.join(root, '.git', 'index.lock'), 'stale lock\n');
  const { receipt } = batch.finishRun(dataDir, nx.runId, { result: 'reported', reportRef: 'test-report.md' });
  return { dataDir, item, runId: nx.runId, receipt };
}

const readAcDetail = (dataDir, runId) =>
  JSON.parse(fs.readFileSync(path.join(dataDir, 'dispatch', 'runs', runId, 'auto-commit.json'), 'utf8'));

const subjectsOf = (root, itemId, p) =>
  git(root, ['log', '--format=%s', '--', p]).stdout.split('\n').filter(Boolean)
    .filter((s) => s.includes(itemId));

// ---------- P1：git add 失败现场的统一口径与完整错误 ----------

t('P1 git add 失败：完整错误保留（不截断、0 组失败也落明细）；计数/文件表/核验同源；空 pendingManual 也展示候选并区分归属', () => {
  const root = mkProject();
  const { dataDir, item, runId, receipt } = mkAddFailureSuspension(root, 'add 失败单');

  // 回执如实失败并挂起
  assert.equal(receipt.autoCommit.status, 'failed');
  assert.ok(receipt.suspended, '失败应触发挂起');

  // 完整错误保留：auto-commit.json 明细（0 组提交失败也落盘）+ run.autoCommit + 确认记录
  const detail = readAcDetail(dataDir, runId);
  assert.equal(detail.status, 'failed', `失败明细应如实标记 failed：${JSON.stringify(detail.status)}`);
  assert.ok(String(detail.errorFull || '').includes('index.lock'), `明细应保留完整原始错误：${String(detail.errorFull).slice(0, 120)}`);
  const run = JSON.parse(fs.readFileSync(path.join(dataDir, 'dispatch', 'runs', runId, 'run.json'), 'utf8'));
  assert.ok(String(run.autoCommit?.errorFull || '').includes('index.lock'), '运行账本应保留 errorFull');
  const rec = confirmStates.confirmOf(dataDir, item.id);
  assert.ok(rec, '失败也应创建挂起确认记录');
  assert.ok(rec.error && String(rec.error.full || '').includes('index.lock'), `确认记录应保留完整错误：${JSON.stringify(rec.error)}`);
  assert.ok(!rec.pendingManual.length, '本夹具无预留前脏路径：声明 pendingManual 为空（原缺陷显示 0 的根源）');

  // 统一口径：卡片计数 = 详情文件表 = 核验剩余（非 0）
  const lst = confirmStore.listConfirms(dataDir, { projectRoot: root });
  assert.equal(lst.count, 1);
  const view = lst.items[0];
  assert.ok(view.pendingCount > 0, `空 pendingManual 时不得显示误导性 0：${view.pendingCount}`);
  assert.equal(view.scopeUnknown, false);
  const d = confirmStore.confirmDetail(dataDir, item.id, { projectRoot: root });
  assert.equal(d.files.length, view.pendingCount, '详情文件表与卡片计数同源');
  assert.equal(d.error && String(d.error.full).includes('index.lock'), true, '详情应透出完整错误');
  assert.ok(d.error.summary && d.error.summary.length <= 200, '错误摘要为短句');

  // 归属分组与变更类型：全局文件归「归属待确认」，本单实现归「本单可归属」
  const byPath = new Map(d.files.map((f) => [f.path, f]));
  assert.equal(byPath.get('docs/agent-team-board/config.json')?.group, 'undetermined', '全局配置文件应归「归属待确认」');
  assert.equal(byPath.get('scripts/lib/impl.mjs')?.group, 'own', '快照差集实现文件应归「本单可归属」');
  assert.equal(byPath.get(`scripts/tests/${item.id}.test.mjs`)?.group, 'own');
  assert.equal(byPath.get(`scripts/tests/${item.id}.test.mjs`)?.kind, '新增', '未跟踪新文件变更类型应为「新增」');
  assert.equal(byPath.get('scripts/lib/impl.mjs')?.kind, '修改');
  assert.ok(d.files.every((f) => ['own', 'undetermined'].includes(f.group)), '每个候选文件必须带归属分组');
  assert.ok(d.files.every((f) => ['修改', '新增', '删除'].includes(f.kind)), '每个候选文件必须带变更类型');

  // 核验与计数同源：原因引用同一数字
  const v = confirmStore.verifyCommitConfirm(dataDir, item.id, { projectRoot: root, runTests: false });
  assert.equal(v.ok, false);
  assert.ok(v.reasons.some((r) => r.includes('未入库')), `核验应说明未入库路径：${v.reasons.join('；')}`);
  assert.ok(v.reasons.some((r) => r.includes(`本单可归属 ${d.files.filter((f) => f.group === 'own').length}`)
    && r.includes(`归属待确认 ${d.files.filter((f) => f.group === 'undetermined').length}`)),
    `核验原因应与面板分组计数同源：${v.reasons.join('；')}`);
  assert.equal(v.remaining.length, d.files.length, '核验剩余与文件表同源');
});

// ---------- P2：归属待确认显式选择（全局文件不静默整批并入） ----------

t('P2a 全局文件默认排除：未显式计入的归属待确认路径不随补交静默提交，本单可归属照常补交', () => {
  const root = mkProject();
  const { dataDir, item } = mkAddFailureSuspension(root, '默认排除单');
  fs.rmSync(path.join(root, '.git', 'index.lock')); // 解除故障

  const rec = confirmStates.confirmOf(dataDir, item.id);
  const r = confirmStore.confirmCommitContinue(dataDir, item.id, { projectRoot: root, fingerprint: rec.fingerprint });
  assert.ok(r.ok, `确认应成功：${JSON.stringify(r.reasons || [])}`);

  // 本单可归属已入库；全局文件保留在工作区（未被静默并入）
  const st = git(root, ['status', '--porcelain', '-uall']).stdout;
  assert.ok(!st.includes('impl.mjs') && !st.includes('.test.mjs'), `本单实现应已补交：\n${st}`);
  assert.ok(subjectsOf(root, item.id, 'scripts/lib/impl.mjs').length === 1, 'impl.mjs 恰一次入库');
  assert.ok(st.includes('config.json'), `config.json 应默认排除、保留在工作区：\n${st}`);
  assert.equal(subjectsOf(root, item.id, 'config.json').length, 0, 'config.json 不得被静默提交');
  assert.equal(confirmStates.confirmOf(dataDir, item.id).state, 'resolved');
});

t('P2b 显式计入：include 携带的归属待确认路径随补交入库', () => {
  const root = mkProject();
  const { dataDir, item } = mkAddFailureSuspension(root, '显式计入单');
  fs.rmSync(path.join(root, '.git', 'index.lock'));

  const rec = confirmStates.confirmOf(dataDir, item.id);
  const r = confirmStore.confirmCommitContinue(dataDir, item.id, {
    projectRoot: root, fingerprint: rec.fingerprint, include: ['docs/agent-team-board/config.json'],
  });
  assert.ok(r.ok, `显式计入后确认应成功：${JSON.stringify(r.reasons || [])}`);
  assert.equal(subjectsOf(root, item.id, 'docs/agent-team-board/config.json').length, 1, 'config.json 应随补交入库');
  const st = git(root, ['status', '--porcelain', '-uall']).stdout;
  assert.ok(!st.includes('config.json'), `config.json 应已入库：\n${st}`);
});

// ---------- P3：内容变化拦截 → 重新核验刷新基线 → 确认 ----------

t('P3 内容变化：确认被指纹拦截 → 重新核验（刷新基线）后确认成功', () => {
  const root = mkProject();
  const { dataDir, item } = mkAddFailureSuspension(root, '内容变化单');
  fs.rmSync(path.join(root, '.git', 'index.lock'));
  // 人工在确认前又改了候选路径内容（脏→脏内容变）
  fs.appendFileSync(path.join(root, 'scripts', 'lib', 'impl.mjs'), '人工再改动（未确认）\n');
  const rec = confirmStates.confirmOf(dataDir, item.id);
  const r1 = confirmStore.confirmCommitContinue(dataDir, item.id, {
    projectRoot: root, fingerprint: rec.fingerprint,
  });
  assert.equal(r1.ok, false, '过期确认应被拒');
  assert.ok(r1.reasons.some((x) => x.includes('内容已变') || x.includes('不一致')), `应说明内容已变：${r1.reasons.join('；')}`);
  assert.equal(confirmStates.confirmOf(dataDir, item.id).state, 'waiting', '应保持挂起');
  // 重新核验 = 人工重新核对：刷新指纹基线后确认绑定最新所见
  const v = confirmStore.verifyCommitConfirm(dataDir, item.id, { projectRoot: root, runTests: false });
  assert.equal(v.ok, false, '路径仍未入库：核验未通过');
  const r2 = confirmStore.confirmCommitContinue(dataDir, item.id, {
    projectRoot: root, fingerprint: confirmStates.confirmOf(dataDir, item.id).fingerprint,
  });
  assert.ok(r2.ok, `重新核验后确认应成功：${JSON.stringify(r2.reasons || [])}`);
});

// ---------- P4：声明后新增归属待确认路径 → 拦截要求先重新核验 ----------

t('P4 新增归属待确认路径：确认被拦截并要求先重新核验；核验后按显式范围确认', () => {
  const root = mkProject();
  const { dataDir, item } = mkAddFailureSuspension(root, '新增待确认单');
  fs.rmSync(path.join(root, '.git', 'index.lock'));
  // 声明/上次核对之后出现的全局改动（归属待确认）
  fs.writeFileSync(path.join(core.dataDirFrom(root), 'extra-uncertain.json'), '{"note":"他单/系统写入"}\n');
  const rec = confirmStates.confirmOf(dataDir, item.id);
  const r1 = confirmStore.confirmCommitContinue(dataDir, item.id, {
    projectRoot: root, fingerprint: rec.fingerprint,
  });
  assert.equal(r1.ok, false, '存在未核对的新归属待确认路径时确认应被拦截');
  assert.ok(r1.reasons.some((x) => x.includes('归属待确认') && x.includes('重新核验')), `应要求先重新核验：${r1.reasons.join('；')}`);
  confirmStore.verifyCommitConfirm(dataDir, item.id, { projectRoot: root, runTests: false });
  const r2 = confirmStore.confirmCommitContinue(dataDir, item.id, {
    projectRoot: root, fingerprint: confirmStates.confirmOf(dataDir, item.id).fingerprint,
  });
  assert.ok(r2.ok, `重新核验后（未计入新路径）确认应成功：${JSON.stringify(r2.reasons || [])}`);
  const st = git(root, ['status', '--porcelain', '-uall']).stdout;
  assert.ok(st.includes('extra-uncertain.json'), `未计入的归属待确认路径应保留在工作区：\n${st}`);
});

// ---------- P5：面板渲染（vm 片段） ----------

const appSource = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');

function runRenderFragment(detail) {
  const nodes = new Map();
  const mk = (id) => {
    const el = {
      textContent: '', innerHTML: '',
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    };
    nodes.set(`#${id}`, el);
    return el;
  };
  for (const id of ['confirmPanelTitle', 'confirmPanelScope', 'confirmForm', 'confirmScopeSummary', 'confirmUnresolved']) mk(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const context = vm.createContext({
    $: (s) => nodes.get(s) || nodes.get(s.replace(/^#confirmForm /, '')) || null,
    esc,
    fmtTime: () => '12:00',
    confirmSide: { busy: false, attr: new Map(), needsReverify: false },
    state: { confirms: { busyId: null } },
    // 片段外助手（app.js 中另处定义）：口径文案与归属选择读取
    confirmScopeText: (c) => {
      if (c.scopeUnknown || c.pendingCount == null) return '待提交：待核对（无法扫描工作区，不显示误导性 0）';
      const base = `待提交：${c.pendingCount} 个路径`;
      if (c.attributedCount == null || c.uncertainCount == null) return base;
      return `${base}（本单可归属 ${c.attributedCount} · 归属待确认 ${c.uncertainCount}）`;
    },
    confirmAttrOf: () => null,
    bindConfirmFormActions: () => {},
  });
  const start = appSource.indexOf('function renderConfirmForm(');
  const end = appSource.indexOf('function bindConfirmFormActions(');
  assert.ok(start > 0 && end > start, 'app.js 应包含 renderConfirmForm 片段');
  // BUG-20260915-004：renderConfirmForm 引用归类结论条助手（同文件先定义），一并载入真实片段
  const clsStart = appSource.indexOf('function classifySuspendReason(');
  const clsEnd = appSource.indexOf('function confirmCardHtml(');
  if (clsStart > 0 && clsEnd > clsStart) vm.runInContext(appSource.slice(clsStart, clsEnd), context);
  vm.runInContext(appSource.slice(start, end), context);
  vm.runInContext(`renderConfirmForm(${JSON.stringify(detail)})`, context);
  return { html: nodes.get('#confirmForm').innerHTML, nodes };
}

t('P5a 面板渲染：分组文件表 / 变更类型 / 计入-排除选择 / 确认范围摘要 / 统一口径计数', () => {
  const { html, nodes } = runRenderFragment({
    itemId: 'BUG-1', kind: 'develop', blockTypeLabel: '待人工确认提交', state: 'waiting',
    reason: '自动提交失败', legacy: false, committedCount: 0, supplementCommits: [],
    pendingCount: 4, attributedCount: 2, uncertainCount: 2, scopeUnknown: false,
    files: [
      { path: 'scripts/lib/impl.mjs', group: 'own', kind: '修改', state: '未提交' },
      { path: 'scripts/tests/x.test.mjs', group: 'own', kind: '新增', state: '未提交' },
      { path: 'config.json', group: 'undetermined', kind: '修改', state: '未提交' },
      { path: 'dispatch/settings.json', group: 'undetermined', kind: '修改', state: '未提交' },
    ],
    verify: null, keepNote: null, fingerprint: { files: {} },
  });
  assert.ok(html.includes('本单可归属'), '应有「本单可归属」分组');
  assert.ok(html.includes('归属待确认'), '应有「归属待确认」分组');
  assert.ok(html.includes('修改') && html.includes('新增'), '应展示变更类型');
  assert.ok(html.includes('计入本次补交') && html.includes('排除'), '归属待确认行应有计入/排除选择');
  assert.ok(/待提交[：:]\s*<strong>?\d*/.test(html) || html.includes('待提交'), '计数行应为「待提交」口径');
  assert.ok(html.includes('本单可归属 2') && html.includes('归属待确认 2'), '计数行应带分组计数');
  assert.ok(html.includes('与文件表 / 最近核验同源') || html.includes('同源'), '计数行应注明同源口径');
  assert.ok(html.includes('confirmScopeSummary'), '确认前应展示实际将提交的文件范围摘要（确认范围节点）');
  const summary = nodes.get('#confirmScopeSummary')?.textContent || '';
  assert.ok(summary.includes('本单可归属 2 个') && summary.includes('归属待确认已计入 0 个') && summary.includes('将补交 2 个路径'),
    `确认范围摘要应给出实际将提交的文件数：${summary}`);
  assert.ok(summary.includes('2 个归属待确认未处理'), `未选择的归属待确认应计数提示：${summary}`);
  assert.ok(html.includes('查看差异'), '文件行应有查看差异入口');
});

t('P5b 面板渲染：完整错误块（摘要+可折叠全文+复制）；历史截断错误明确信息不足', () => {
  const base = {
    itemId: 'BUG-1', kind: 'develop', blockTypeLabel: '待人工确认提交', state: 'waiting',
    reason: '自动提交失败：git add /repo/…（截断）', legacy: false, committedCount: 0,
    supplementCommits: [], pendingCount: 1, attributedCount: 1, uncertainCount: 0, scopeUnknown: false,
    files: [{ path: 'a.js', group: 'own', kind: '修改', state: '未提交' }],
    verify: null, keepNote: null, fingerprint: { files: {} },
  };
  const { html: withFull } = runRenderFragment({
    ...base,
    error: { summary: 'git add 失败——index.lock 已存在', full: 'fatal: Unable to create \'/repo/.git/index.lock\': File exists.\n（完整多行输出）' },
  });
  assert.ok(withFull.includes('git add 失败——index.lock 已存在'), '错误摘要行应展示');
  assert.ok(withFull.includes('完整错误'), '应有可展开全文');
  assert.ok(withFull.includes('index.lock'), '全文应包含原始错误');
  assert.ok(withFull.includes('复制完整错误'), '应有复制完整错误入口');

  const { html: truncated } = runRenderFragment({ ...base, error: { summary: '自动提交失败：git add /repo/…', full: null } });
  assert.ok(truncated.includes('信息不足'), '无原始日志的历史截断错误应明确说明信息不足');
  assert.ok(!truncated.includes('复制完整错误'), '无全文时不得提供复制全文');
});

t('P5c 面板渲染：空态与待核对；按钮场景说明', () => {
  const { html: empty } = runRenderFragment({
    itemId: 'BUG-1', kind: 'develop', blockTypeLabel: '待人工确认提交', state: 'waiting',
    reason: '自动提交失败', legacy: false, committedCount: 1, supplementCommits: 1,
    pendingCount: 0, attributedCount: 0, uncertainCount: 0, scopeUnknown: false,
    files: [], verify: null, keepNote: null, fingerprint: { files: {} },
  });
  assert.ok(empty.includes('无待提交文件'), '空候选时应显示「无待提交文件：全部路径已入库」空态');
  assert.ok(!empty.includes('待人工：0'), '不得出现误导性 0 计数');

  const { html: unknown } = runRenderFragment({
    itemId: 'BUG-2', kind: 'develop', blockTypeLabel: '待人工确认提交', state: 'waiting',
    reason: '自动提交失败', legacy: false, committedCount: 0, supplementCommits: [],
    pendingCount: null, scopeUnknown: true,
    files: [], verify: null, keepNote: null, fingerprint: { files: {} },
  });
  assert.ok(unknown.includes('待核对'), '无法确定范围时应显示「待核对」，不显示 0');

  // 按钮场景说明（源码契约）：重新核验只检查；确认并继续补交+测试+恢复
  assert.ok(appSource.includes('只检查'), '「重新核验」应注明只检查不改现场');
  assert.ok(/确认并继续[：:].{0,60}(补交|测试)/.test(appSource) || appSource.includes('将补交'), '「确认并继续」应说明将补交并跑测试');
  // 差异读取失败：错误 + 重试，不冒充无差异
  assert.ok(appSource.includes('差异读取失败'), '差异读取失败应显示错误');
  assert.ok(/差异读取失败[\s\S]{0,400}重试/.test(appSource), '差异读取失败应提供重试');
  assert.ok(appSource.includes('读取失败不冒充无差异'), '错误文案应明示不冒充无差异');
});

// ---------- P6：差异读取失败（服务端明确报错，不冒充无差异） ----------

function req(port, method, pathname) {
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: '127.0.0.1', port, path: pathname, method, timeout: 30_000 }, (rs) => {
      let out = '';
      rs.on('data', (c) => { out += c; });
      rs.on('end', () => { try { resolve({ status: rs.statusCode, json: JSON.parse(out || '{}') }); } catch { resolve({ status: rs.statusCode, raw: out }); } });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    r.end();
  });
}

t('P6 差异读取失败：fileDiffText 如实返回 null；服务端 /diff 返回明确错误而非空差异', async () => {
  const root = mkProject();
  assert.equal(gitFlow.fileDiffText(root, 'no-such-file.js'), null, '不可读路径差异应返回 null（读取失败），不是空字符串');
  assert.equal(gitFlow.fileDiffText(root, 'README.md'), '', '已入库无差异应为空字符串');

  const { dataDir, item } = mkAddFailureSuspension(root, '差异失败单');
  void dataDir; void item;
  fs.rmSync(path.join(root, '.git', 'index.lock'));
  const port = 31000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(os.tmpdir(), `atb-scope-reg-${Date.now()}.json`) },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      await sleep(150);
      try { await req(port, 'GET', '/api/health'); up = true; } catch {}
    }
    assert.ok(up, '服务未启动');
    const P = `?project=${encodeURIComponent(root)}`;
    const r = await req(port, 'GET', `/api/confirms/BUG-1/diff${P}&path=${encodeURIComponent('no-such-file.js')}`);
    assert.equal(r.status, 500, '读取失败应返回错误状态码');
    assert.ok(String(r.json?.error || '').includes('差异读取失败'), `错误信息应明确：${JSON.stringify(r.json)}`);
    const ok2 = await req(port, 'GET', `/api/confirms/BUG-1/diff${P}&path=${encodeURIComponent('README.md')}`);
    assert.equal(ok2.status, 200, '无差异应正常返回 200');
    assert.equal(ok2.json.diff, '', '无差异返回空差异文本');
  } finally {
    server.kill();
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
