#!/usr/bin/env node
// BUG-20260914-014 回退 010 实现单（暂扣人工提醒通道）—— 回归测试
// 用法：node scripts/tests/bug-revert-held-notice-20260914-014.test.mjs
// 覆盖（对应 README 期望行为 1–3 / 验收 1–5）：
//   · 残留清零：六个代码文件无 010 独有标识（函数 / 字段 / 单号注释 / 测试文件名），
//     「待人工提交」UI 文案无残留；010 测试文件已删除；
//   · 行为回归：generatePrompt 无暂扣立即报告指令；reported 且带暂扣账本时 checkBatch
//     notice 无暂扣统计行（auto-commit 暂扣账本机制本身为 010 之前已有，须保持工作）；
//     /api/holds 响应不携带暂扣汇总字段；
//   · 他人改动完好：BUG-20260914-003/004/005/006/009/011 与 REQ-20260913-006 的
//     暂扣外改动标识保留；
//   · 历史保留：010 条目文档与实现单暂扣账本不被本回退触碰。
// 说明：验收 1 的 grep 目标标识在本文件内一律拼接构造，避免测试自身成为 grep 命中。
// 模式对齐 bug-held-notice 系列（真实 git 临时仓库 + 端到端经 batch.finishRun）与
// hold-20260911-007.test.mjs（真实 server.mjs + HTTP）。

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as batch from '../lib/batch.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 010 独有标识（拼接构造，避免本文件被验收 grep 命中）
const ID_FN = ['pending', 'ManualRuns'].join('');            // git-flow 盘点函数名
const ID_FIELD = ['pending', 'Commits'].join('');            // /api/holds 响应字段名
const ID_BUG = ['BUG-', '20260914-010'].join('');            // 单号注释
const ID_TEST = ['bug-held-notice-', '20260914-010'].join(''); // 测试文件名
const UI_HELD = ['待人工', '提交'].join('');                  // 「待人工提交」分组文案
const NOTICE_HELD = ['暂扣待', '人工提交'].join('');           // notice 统计行文案
const PROMPT_MARK = ['autoCommit.', 'pendingManual'].join(''); // 调度提示词指令字段

const SRC_FILES = [
  'scripts/lib/batch.mjs',
  'scripts/lib/git-flow.mjs',
  'scripts/server.mjs',
  'scripts/web/app.js',
  'scripts/web/i18n.js',
  'scripts/web/style.css',
];

const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const readSrc = (rel) => fs.readFileSync(path.join(pluginRoot, rel), 'utf8');

function git(root, args) {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r;
}

function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-revert-held-')));
}

// 已有提交的 git 项目（main 起步），看板数据已提交
function mkProject() {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(root, 'README.md'), '# t\n');
  core.initData(root);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 初始化测试仓库']);
  return root;
}

function mkPlannedItem(dataDir, title) {
  const x = core.createItem(dataDir, { type: 'bug', title });
  core.setStatus(dataDir, x.id, 'accepted', { by: 'human' });
  core.setStatus(dataDir, x.id, 'planned', { by: 'human' });
  return x;
}

// 被测源码入库 + 制造「预留前已脏」的 build.js（对齐 010 用例的复现路径）
function seedPreDirtySource(root) {
  fs.mkdirSync(path.join(root, 'scripts', 'web'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'web', 'build.js'), 'base\n');
  fs.writeFileSync(path.join(root, 'scripts', 'lib', 'impl.mjs'), 'v1\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 被测源码入库']);
  fs.appendFileSync(path.join(root, 'scripts', 'web', 'build.js'), '上一单遗留脏改动\n');
}

// 一单完整流转：预留 → 认领 → 运行期改动（含再动预留前已脏的 build.js）→ report → 收尾。
// 收尾即触发 auto-commit 暂扣（doc 提交、test/biz 暂扣、build.js 列待人工路径）。
function runOneHeldItem(root, dataDir, item, title) {
  const nx = batch.nextItem(dataDir, batch.queueHeadBatch(dataDir).batchId, { owner: 'w1' });
  core.claim(dataDir, item.id, 'w1');
  fs.appendFileSync(path.join(root, 'scripts', 'web', 'build.js'), `本单实现改动 ${title}\n`);
  fs.mkdirSync(path.join(root, 'scripts', 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'tests', `${item.id}.test.mjs`), 'import assert from "node:assert/strict";\n');
  fs.appendFileSync(path.join(root, 'scripts', 'lib', 'impl.mjs'), 'v2\n');
  fs.appendFileSync(path.join(nx.itemDir, 'README.md'), '\n实施补充\n');
  core.report(dataDir, item.id, { summary: '实施完成', by: 'w1', run: { runId: nx.runId } });
  batch.finishRun(dataDir, nx.runId, { result: 'reported', reportRef: 'test-report.md' });
  return nx.runId;
}

function req(port, method, pathname) {
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: '127.0.0.1', port, path: pathname, method, timeout: 8000 }, (rs) => {
      let out = '';
      rs.on('data', (c) => { out += c; });
      rs.on('end', () => { try { resolve({ status: rs.statusCode, json: JSON.parse(out || '{}') }); } catch { resolve({ status: rs.statusCode, json: null, raw: out }); } });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    r.end();
  });
}

async function startServer(root) {
  const port = 31000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(os.tmpdir(), `atb-revert-reg-${Date.now()}.json`) },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    try { await req(port, 'GET', '/api/health'); return { server, port }; } catch {}
  }
  server.kill();
  throw new Error('服务未启动');
}

// ---------- 验收 1：代码残留清零 ----------

t('A1 残留清零：六个代码文件无 010 独有标识（函数 / 字段 / 单号 / 测试文件名）', () => {
  for (const rel of SRC_FILES) {
    const src = readSrc(rel);
    for (const id of [ID_FN, ID_FIELD, ID_BUG, ID_TEST]) {
      assert.ok(!src.includes(id), `${rel} 不应残留 010 独有标识 ${id}`);
    }
  }
  assert.ok(
    !fs.existsSync(path.join(pluginRoot, 'scripts', 'tests', `${ID_TEST}.test.mjs`)),
    '010 测试文件应已删除',
  );
});

t('A2 残留清零：「待人工提交」分组 UI 文案在前端三文件无残留', () => {
  for (const rel of ['scripts/web/app.js', 'scripts/web/i18n.js', 'scripts/web/style.css']) {
    const src = readSrc(rel);
    assert.ok(!src.includes(UI_HELD), `${rel} 不应残留「${UI_HELD}」分组文案`);
  }
});

// ---------- 验收 2：行为回归 ----------

t('B1 行为回归：新生成的调度提示词不含暂扣立即报告指令', () => {
  const p = batch.generatePrompt({ projectRoot: '/tmp/demo', workerSpecPath: '/tmp/spec.md' });
  assert.ok(!p.includes(PROMPT_MARK), '提示词不应再点名暂扣字段信号');
  assert.ok(!p.includes(NOTICE_HELD), '提示词不应含暂扣报告指令文案');
  assert.ok(p.includes('短回执'), '提示词主体（短回执纪律）应保持完整');
  assert.ok(p.includes('needs_attention'), '提示词主体（needs_attention 处理）应保持完整');
});

t('C1 行为回归：reported 且带暂扣账本时 notice 无暂扣统计行；暂扣账本机制本身仍工作', () => {
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  seedPreDirtySource(root);
  const held = mkPlannedItem(dataDir, '回退后暂扣单');
  const standby = mkPlannedItem(dataDir, '剩余可实施单'); // 保持 remaining>0
  const batchId = batch.createBatch(dataDir, { projectRoot: root }).batch.batchId;
  const runId = runOneHeldItem(root, dataDir, held, 'C1');
  void standby;

  // REQ-20260914-001 起：自动提交不完整（暂扣/待人工）挂起当前条目并暂停队列——
  // nextAction 不再 continue（不放大混合修改），notice 指向挂起条目而非暂扣统计行。
  const chk = batch.checkBatch(dataDir, batchId);
  assert.equal(chk.nextAction, 'stop', '挂起暂停后应为 stop');
  assert.ok(String(chk.notice || '').includes('待人工确认提交'), `notice 应指向挂起确认入口：${chk.notice}`);
  assert.ok(!String(chk.notice || '').includes(NOTICE_HELD), `notice 不应再含暂扣统计行：${chk.notice}`);
  assert.ok(!String(chk.notice || '').includes('dispatch/runs/*/auto-commit.json'), `notice 不应再给暂扣明细入口：${chk.notice}`);

  // 暂扣账本机制（010 之前已有）保持工作：账本照常生成、build.js 列待人工路径
  const ledger = JSON.parse(fs.readFileSync(path.join(dataDir, 'dispatch', 'runs', runId, 'auto-commit.json'), 'utf8'));
  assert.ok(Array.isArray(ledger.pendingManual) && ledger.pendingManual.includes('scripts/web/build.js'),
    'auto-commit 暂扣账本应照常生成且列待人工路径');
});

t('D1 行为回归：/api/holds 响应不携带暂扣汇总字段（带暂扣账本的项目）', async () => {
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  seedPreDirtySource(root);
  const held = mkPlannedItem(dataDir, '看板回退后暂扣单');
  batch.createBatch(dataDir, { projectRoot: root });
  runOneHeldItem(root, dataDir, held, 'D1');

  const { server, port } = await startServer(root);
  try {
    const r = await req(port, 'GET', `/api/holds?project=${encodeURIComponent(root)}`);
    assert.equal(r.status, 200);
    assert.ok(r.json && typeof r.json === 'object', '/api/holds 应返回 JSON');
    assert.ok(!(ID_FIELD in r.json), '/api/holds 响应不应携带暂扣汇总字段');
    assert.ok(Array.isArray(r.json.items), 'hold 清单原口径（items）应保持');
  } finally {
    server.kill();
  }
});

// ---------- 验收 3：他人改动完好 ----------

t('E1 他人改动完好：003/004/005/006/009/011 与 REQ-20260913-006 的暂扣外改动保留', () => {
  const gf = readSrc('scripts/lib/git-flow.mjs');
  assert.ok(gf.includes('export function ensureMainBranch'), 'BUG-20260914-003 ensureMainBranch 应保留');

  const sv = readSrc('scripts/server.mjs');
  assert.ok(sv.includes("pathname === '/api/build/sync'"), 'BUG-20260914-011 /api/build/sync 应保留');
  assert.ok(sv.includes('occupiedItemMap'), 'BUG-20260914-004 occupiedItemMap 应保留');
  assert.ok(sv.includes('totalDone'), 'BUG-20260914-004 totalDone 应保留');
  assert.ok(/branchLog\(root, branch, \{/.test(sv), 'BUG-20260914-009 branchLog 分页应保留');

  const i18n = readSrc('scripts/web/i18n.js');
  assert.ok(i18n.includes("'⟳ 和远端同步'"), 'BUG-20260914-005 同步按钮词条应保留');
  assert.ok(i18n.includes('远端仓库尚无任何分支（从未推送）。'), 'BUG-20260914-006 远端空态词条应保留');

  const css = readSrc('scripts/web/style.css');
  assert.ok(css.includes('.bld-main-hint'), 'BUG-20260914-003 样式应保留');
  assert.ok(css.includes('.bld-remote-hint'), 'BUG-20260914-006 样式应保留');
  assert.ok(css.includes('.bld-log-pager'), 'BUG-20260914-009 样式应保留');
  assert.ok(css.includes('.bld-edit-form'), 'REQ-20260913-006 样式应保留');

  const app = readSrc('scripts/web/app.js');
  assert.ok(app.includes('function renderHolds'), '待人工确认聚合区渲染应保留');
  assert.ok(app.includes('function holdCardHtml'), '待人工决策卡片渲染应保留');

  const others = [
    'bug-branch-main-missing-20260914-003.test.mjs',
    'bug-build-candidate-occupied-20260914-004.test.mjs',
    'bug-remote-empty-explain-20260914-006.test.mjs',
    'bug-sync-fetch-push-20260914-011.test.mjs',
    'bug-branch-main-no-push-20260914-012.test.mjs',
  ];
  for (const f of others) {
    assert.ok(fs.existsSync(path.join(pluginRoot, 'scripts', 'tests', f)), `他人测试文件应保留：${f}`);
  }
});

// ---------- 验收 5：历史保留 ----------

t('F1 历史保留：010 条目文档与实现单暂扣账本不被本回退触碰', () => {
  for (const f of ['README.md', 'design.md', 'test-report.md', 'ui-demo.html']) {
    assert.ok(fs.existsSync(path.join(pluginRoot, 'docs', 'agent-team-board', 'bugs', ID_BUG, f)), `010 条目文档应保留：${f}`);
  }
  // 010 实现单账本为本地未跟踪数据：存在时核对明细未被清空（不要求克隆环境存在）
  const ledger = path.join(pluginRoot, 'docs', 'agent-team-board', 'dispatch', 'runs', 'run-20260914-232', 'auto-commit.json');
  if (fs.existsSync(ledger)) {
    const rec = JSON.parse(fs.readFileSync(ledger, 'utf8'));
    assert.ok(Array.isArray(rec.pendingManual) && rec.pendingManual.length > 0, '010 实现单账本明细应保持原样');
  }
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
