#!/usr/bin/env node
// REQ-20260911-010 回退批量 Commit —— 集成 + 静态契约测试
// 覆盖：atb commit 旧子命令回退提示与零副作用、commit log/which 保留、commit-store 内核保留、
// /api/commit/* 路由回退与 item-status 换源（REQ-009 索引）、看板 UI/全局看板/守卫静态契约。
// 用法：node scripts/tests/commit-rollback-20260911-010.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as commitStore from '../lib/commit-store.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ATB = path.join(pluginRoot, 'scripts', 'atb.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const web = path.join(pluginRoot, 'scripts', 'web');
const appJs = fs.readFileSync(path.join(web, 'app.js'), 'utf8');
const guardSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'state-guard.mjs'), 'utf8');
const atbSrc = fs.readFileSync(ATB, 'utf8');
const storeSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'lib', 'commit-store.mjs'), 'utf8');
const serverSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'server.mjs'), 'utf8');

function git(root, args) {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r.stdout || '';
}

function mkProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-cmt-rollback-')));
  git(root, ['init', '-q']);
  fs.writeFileSync(path.join(root, 'README.md'), '# t\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 初始化测试仓库']);
  core.initData(root);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 初始化看板数据']);
  return root;
}

function mkDoneItem(dataDir, title) {
  const x = core.createItem(dataDir, { type: 'requirement', title });
  core.setStatus(dataDir, x.id, 'accepted', { by: 'human' });
  core.setStatus(dataDir, x.id, 'planned', { by: 'human' });
  core.claim(dataDir, x.id, 'dev');
  core.report(dataDir, x.id, { summary: '实施完成', by: 'dev' });
  core.setStatus(dataDir, x.id, 'done', { by: 'human' });
  return x;
}

function atbRaw(root, args) {
  return spawnSync(process.execPath, [ATB, ...args, '--dir', root], { encoding: 'utf8', timeout: 60_000 });
}

function req(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 8000,
    }, (rs) => {
      let out = '';
      rs.on('data', (c) => { out += c; });
      rs.on('end', () => { try { resolve({ status: rs.statusCode, json: JSON.parse(out || '{}') }); } catch { resolve({ status: rs.statusCode, json: null, raw: out }); } });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (payload) r.write(payload);
    r.end();
  });
}

async function startServer(root, tmp) {
  const port = 33000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(tmp, 'reg.json') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    try { await req(port, 'GET', '/api/health'); return { server, port }; } catch {}
  }
  throw new Error('服务未启动');
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- R1/R2/R3 CLI 回退与索引命令保留 ---------- */

t('R1 CLI 回退：旧子命令全部非零退出并明确提示「已回退（REQ-20260911-010）」；usage 无批量 commit 分组', async () => {
  const root = mkProject();
  try {
    for (const sub of ['create', 'next', 'done', 'fail', 'release', 'check', 'summary', 'records', 'pause', 'abort']) {
      const args = sub === 'done' || sub === 'fail' || sub === 'release'
        ? ['commit', sub, 'run-20990101-000000-ffff']
        : ['commit', sub];
      const r = atbRaw(root, args);
      assert.notEqual(r.status, 0, `atb commit ${sub} 应非零退出`);
      const out = `${r.stdout || ''}${r.stderr || ''}`;
      assert.match(out, /已回退/, `atb commit ${sub} 应明确提示已回退`);
      assert.match(out, /REQ-20260911-010/, `atb commit ${sub} 提示应含回退单号`);
    }
    // usage 帮助：主 usage 与 commit 用法均无批量 commit 建批条目
    const help = atbRaw(root, []);
    const helpOut = `${help.stdout || ''}${help.stderr || ''}`;
    assert.doesNotMatch(helpOut, /批量 commit（REQ/, '主 usage 不应再含批量 commit 分组');
    assert.doesNotMatch(helpOut, /atb commit create/, '主 usage 不应再含 atb commit create');
    const cu = atbRaw(root, ['commit']);
    const cuOut = `${cu.stdout || ''}${cu.stderr || ''}`;
    assert.match(cuOut, /commit log/, 'commit 用法应保留 log（REQ-009 索引）');
    assert.match(cuOut, /commit which/, 'commit 用法应保留 which（REQ-009 索引）');
    assert.doesNotMatch(cuOut, /atb commit create/, 'commit 用法不应含 create');
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
});

t('R2 零副作用：旧命令不产生 git 提交、不落 commits/batches 账本', async () => {
  const root = mkProject();
  try {
    const before = git(root, ['rev-list', '--count', 'HEAD']).trim();
    for (const args of [['commit', 'create'], ['commit', 'next', '--by', 'w'], ['commit', 'check']]) {
      atbRaw(root, args); // 回退提示（非零）——不视为失败
    }
    const after = git(root, ['rev-list', '--count', 'HEAD']).trim();
    assert.equal(after, before, '旧命令不得产生任何 git 提交');
    assert.ok(!fs.existsSync(path.join(core.dataDirFrom(root), 'commits', 'batches')), '不得落 commits/batches 账本');
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
});

t('R3 索引命令保留：commit log（git 历史含单号）/ commit which 反查照常可用', async () => {
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  const x = mkDoneItem(dataDir, '索引单');
  try {
    fs.writeFileSync(path.join(root, 'feat.txt'), 'x\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-q', '-m', `feat: 索引能力 ${x.id}`]);
    const r = atbRaw(root, ['commit', 'log', x.id]);
    assert.equal(r.status, 0, `commit log 应可用（${r.stderr || r.stdout}）`);
    assert.match(r.stdout, new RegExp(x.id), 'log 输出应含单号');
    assert.match(r.stdout, /feat: 索引能力/, 'log 输出应含提交消息');
    const head = git(root, ['rev-parse', 'HEAD']).trim();
    const w = atbRaw(root, ['commit', 'which', head]);
    assert.equal(w.status, 0, `commit which 应可用（${w.stderr || w.stdout}）`);
    assert.match(w.stdout, new RegExp(x.id), 'which 应反查出单号');
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
});

/* ---------- R4 数据层裁剪与内核保留 ---------- */

t('R4 数据层：CMT 批次流程函数不再导出；共享内核保留且行为不变', () => {
  for (const gone of ['createCommitBatch', 'nextCommitItem', 'finishCommitRun', 'releaseCommitRun',
    'abortCommitBatch', 'pauseCommitBatch', 'checkCommitBatch', 'listCommitRuns', 'commitBatchPublicView',
    'commitBatchBrief', 'commitSummary', 'buildCommitPrompt', 'commitCandidates', 'getCommitBatch',
    'getCommitRun', 'listCommitBatches', 'unfinishedCommitBatches', 'queueHeadCommitBatch', 'ensureCommits',
    'validateItemCommits']) {
    assert.equal(commitStore[gone], undefined, `commit-store 不应再导出 ${gone}`);
    assert.ok(!storeSrc.includes(`function ${gone}`) && !storeSrc.includes(`export function ${gone}`), `源码不应残留 ${gone} 定义`);
  }
  // 内核：提交规范核验
  assert.equal(commitStore.validateCommitSubject('feat: 新能力 REQ-20990101-001', 'REQ-20990101-001'), null, '规范消息应通过');
  assert.match(commitStore.validateCommitSubject('坏消息', 'REQ-20990101-001'), /类型/, '坏消息应被拒');
  // 内核：幂等判定
  assert.equal(commitStore.itemCommittedInGit(null, 'REQ-20990101-001', 'fix: x REQ-20990101-001'), true, '历史含单号判定');
  assert.equal(commitStore.itemCommittedInGit(null, 'REQ-20990101-001', 'fix: x'), false, '历史不含单号判定');
});

/* ---------- R5/R6 服务端路由回退与 item-status 换源 ---------- */

t('R5+R6 服务端：5 条批量 Commit 路由 404；item-status 换源（账本+git 历史合并；一 commit 多单号；空索引）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-cmt-rollback-api-'));
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  const a = mkDoneItem(dataDir, '单甲');
  const b = mkDoneItem(dataDir, '单乙');
  // 一个 commit 消息含两个单号：一个 commit 关联多个单号
  fs.writeFileSync(path.join(root, 'shared.txt'), 'x\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', `feat: 共享改动 ${a.id} ${b.id}`]);
  const shared = git(root, ['rev-parse', 'HEAD']).trim();
  // REQ-009 自动提交账本形态记录（git-flow writeAutoCommitLedger 落盘形态）
  const runDir = path.join(dataDir, 'commits', 'runs', 'run-20990101-000000-aaaa');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({
    version: 1, runId: 'run-20990101-000000-aaaa', batchId: `auto:run-x`, itemId: a.id,
    itemTitle: '单甲', owner: 'auto-commit', phase: 'committed',
    createdAt: '2026-09-11T00:00:00.000Z', finishedAt: '2026-09-11T00:00:01.000Z',
    reason: null, summary: '到待测试自动提交', commits: [{ hash: shared, subject: `feat: 共享改动 ${a.id} ${b.id}` }],
  }));
  const { server, port } = await startServer(root, tmp);
  const P = `&project=${encodeURIComponent(root)}`;
  try {
    // R5：回退路由全部 404（未知接口）
    for (const [method, pathname, body] of [
      ['GET', `/api/commit/current?${P}`, null],
      ['POST', `/api/commit/create?${P}`, {}],
      ['POST', `/api/commit/pause?${P}`, { batchId: 'CMT-20260101-001' }],
      ['POST', `/api/commit/abort?${P}`, { batchId: 'CMT-20260101-001' }],
      ['GET', `/api/commit/records?${P}`, null],
    ]) {
      const r = await req(port, method, pathname, body);
      assert.equal(r.status, 404, `${pathname} 应回退为 404（实际 ${r.status}）`);
      assert.match(r.json?.error || '', /未知接口/, '404 应为未知接口口径');
    }
    // R6：item-status 换源——git 历史消息含单号即关联（甲乙都含 shared hash），账本记录同源并入
    const r = await req(port, 'GET', `/api/commit/item-status?${P}`);
    assert.equal(r.status, 200, `item-status 应保留（${JSON.stringify(r.json)}）`);
    const st = r.json.statuses;
    assert.ok(st[a.id], '单甲应有索引记录');
    assert.ok(st[b.id], '单乙应经 git 历史关联同一 commit（一 commit 多单号）');
    assert.ok(st[a.id].commits.includes(shared), '单甲 commits 应含共享 hash');
    assert.ok(st[b.id].commits.includes(shared), '单乙 commits 应含共享 hash');
    assert.equal(st[a.id].batches, undefined, '响应不应再含 CMT 批次字段 batches');
    assert.ok(st[a.id].lastCommittedAt, '应含最近提交时间');
  } finally {
    server.kill();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
});

t('R6b 空索引：无账本、git 历史无单号提交时 statuses={} 不报错（全部未提交口径）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-cmt-rollback-empty-'));
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  mkDoneItem(dataDir, '空单');
  const { server, port } = await startServer(root, tmp);
  const P = `&project=${encodeURIComponent(root)}`;
  try {
    const r = await req(port, 'GET', `/api/commit/item-status?${P}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.statuses, {}, '索引为空时 statuses 应为空对象');
  } finally {
    server.kill();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
});

/* ---------- R7~R11 前端与守卫静态契约 ---------- */

t('R7 任务模块回退：无批量 Commit 页签/面板/数据链路；快照不含 commitPane 与 batchMode commit', () => {
  for (const gone of ['批量 Commit</button>', 'renderCommitPanel', 'createCommitBatchAndCopy',
    'toggleCommitPause', 'abortCommitTask', 'commitRecordsHtml', 'COMMIT_RESULT_LABEL',
    'commitPane', '/api/commit/current', '/api/commit/create', '/api/commit/pause', '/api/commit/abort']) {
    assert.ok(!appJs.includes(gone), `app.js 不应残留 ${gone}`);
  }
  // state.commit 精确匹配（state.commitStatus 为保留状态，不得误伤）
  assert.doesNotMatch(appJs, /state\.commit\b/, '不应残留 state.commit 面板状态（commitStatus 除外）');
  // refreshCommit 精确匹配（refreshCommitStatus 为保留函数，不得误伤）
  assert.doesNotMatch(appJs, /refreshCommit\s*\(/, '不应有 refreshCommit 数据拉取（refreshCommitStatus 除外）');
  assert.match(appJs, /data-bmode="refine"/, '批量完善页签保留');
  assert.match(appJs, /data-bmode="develop"/, '批量开发页签保留');
  assert.doesNotMatch(appJs, /data-bmode="commit"/, '不应有批量 Commit 页签');
});

t('R8 已完成档快捷入口回退：无「▶ 开始 Commit」；done 档入口隐藏；accepted/planned 分支保留', () => {
  assert.ok(!appJs.includes('▶ 开始 Commit'), '不应再有「▶ 开始 Commit」文案');
  assert.ok(!appJs.includes("'done'\n          // BUG-20260911-005"), 'done 档快捷入口分支应移除');
  // 绑定只按 accepted→refine / 其余→develop 导航
  const bind = appJs.match(/\$\('#laneQuickEntry'\)\?\.addEventListener\('click',[^;]+;/);
  assert.ok(bind, '应保留快捷入口点击绑定');
  assert.match(bind[0], /accepted/, '绑定含 accepted 分支');
  assert.doesNotMatch(bind[0], /commit/, '绑定不得再有 commit 分支');
  assert.match(appJs, /开始完善/, 'accepted 文案保留');
  assert.match(appJs, /开始开发/, 'planned 文案保留');
});

t('R9 全局看板回退：类型档/标签/前缀兜底/计数分支无 commit；空态文案无批量 Commit；服务端不再聚合 CMT', () => {
  for (const gone of ["{ key: 'commit', label: '批量 Commit' }", "commit: '批量 Commit'", "['CMT-', 'commit']", "kind === 'commit'"]) {
    assert.ok(!appJs.includes(gone), `app.js 不应残留 ${gone}`);
  }
  assert.ok(!appJs.includes('批量开发 / 批量完善 / 批量 Commit'), '空态文案不应再含批量 Commit');
  assert.ok(!serverSrc.includes('commitBatchBrief'), '服务端不应再产出 CMT 简报行');
  assert.ok(!serverSrc.includes("unfinishedCommitBatches"), '服务端不应再读 CMT 批次账本');
});

t('R10 徽标保留（换源四态）：commitBadgeHtml/commitHashListHtml/refreshCommitStatus/retryCommitStatus 保留；数据源 /api/commit/item-status；多提交号展开保留', () => {
  for (const keep of ['function commitBadgeHtml', 'function commitHashListHtml', 'function commitStatusDetailHtml',
    'async function refreshCommitStatus', 'async function retryCommitStatus', 'function bindCommitWidgets',
    '/api/commit/item-status', 'commit-status-cell-wide', '提交状态加载失败', '未提交', '个提交号']) {
    assert.ok(appJs.includes(keep), `app.js 应保留 ${keep}`);
  }
  assert.match(appJs, /function commitBadgeHtml[\s\S]{0,600}cm-uncommitted/, '未提交态保留');
  assert.match(appJs, /function commitBadgeHtml[\s\S]{0,800}cm-committed/, '已提交态保留');
  assert.match(appJs, /function commitBadgeHtml[\s\S]{0,900}data-commit-retry/, '失败重试态保留');
  assert.match(appJs, /function commitHashListHtml[\s\S]{0,400}data-copy-hash/, 'hash 列表复制按钮保留');
  assert.match(appJs, /function commitStatusDetailHtml[\s\S]{0,400}commitHashListHtml/, '详情页复用 hash 列表渲染');
});

t('R11 state-guard：CMT 在途豁免移除；拦截提示不含批量 commit 通道', () => {
  for (const gone of ['hasActiveCommitBatchRun', 'COMMIT_RUN_FINAL']) {
    assert.ok(!guardSrc.includes(gone), `state-guard 不应残留 ${gone}`);
  }
  assert.doesNotMatch(guardSrc, /批量 commit|atb commit create/, '拦截提示不应再引用批量 commit 通道');
  assert.match(guardSrc, /自动提交/, '拦截提示应保留到待测试自动提交口径');
  assert.match(atbSrc, /run autocommit/, 'atb run autocommit（REQ-009）不受影响');
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
