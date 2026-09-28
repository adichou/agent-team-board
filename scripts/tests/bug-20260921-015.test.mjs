#!/usr/bin/env node
// BUG-20260921-015 一键加入依赖跳过已关联条目的其他提交，导致发布范围不完整及实现代码漏发风险。
// 引入来源：REQ-20260921-015（add-dependencies 接口按条目去重跳过 + 版本模型一条目一提交）。
// 分层回归：
//   G*（store / git 直连）：条目多提交模型（commits 数组 + 旧数据迁移 + appendItemCommits）、
//      隔离分析 / 合并重放 / finishMerge 使用一致提交集合、补入提交按 Git 依赖顺序重放、
//      已重放提交经 replays 幂等续传；
//   H*（HTTP + 真实临时 Git 仓库）：一键加入补齐已在本版本条目的其余依赖提交（不再按条目
//      「已在本版本」跳过）、同一新条目多个依赖提交全部保留、隔离分析收敛、幂等重复执行、
//      真正无法纳入的逐条说明原因；合并入 main 后主分支包含 doc/feat/test 真实内容（不能
//      只断言提示消失），发布包含性校验（assertItemsIncluded）用同一提交集合通过。
// 先红后绿：本文件在修复前对「补入其余提交 / 多提交全保留 / topo 重放」应失败。
// 用法：node scripts/tests/bug-20260921-015.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as buildStore from '../lib/build-store.mjs';
import * as buildGit from '../lib/build-git.mjs';
import * as buildPublish from '../lib/build-publish.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

function gitRaw(cwd, args, env = GIT_ENV) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', env, timeout: 20000 });
}
function git(cwd, args) {
  const r = gitRaw(cwd, args);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r.stdout.trim();
}
function gitAt(cwd, args, at) {
  const r = gitRaw(cwd, args, { ...GIT_ENV, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r.stdout.trim();
}
function tmpdir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const commitsOf = (it) => (Array.isArray(it?.commits) && it.commits.length ? it.commits : (it?.commit ? [it.commit] : []));
const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/* ---------- G*：store / git 直连（真实临时 Git 仓库） ---------- */

function mkRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@e.co']);
  git(dir, ['config', 'user.name', 'T']);
  fs.writeFileSync(path.join(dir, 'base.txt'), 'base\n');
  git(dir, ['add', '-A']);
  gitAt(dir, ['commit', '-m', 'init'], '2026-09-21T01:00:00 +0000');
  git(dir, ['switch', '-c', 'dev']);
  return dir;
}
function commitFile(dir, file, content, subject, at) {
  fs.writeFileSync(path.join(dir, file), `${content}\n`);
  // BUG-20260926-003：定向 add——只提交场景文件本身；看板条目目录不卷入场景提交，
  // 变更路径归属证据按真实 diff 判定（条目目录基线留在工作区不影响归因）
  git(dir, ['add', '--', file]);
  gitAt(dir, ['commit', '-m', subject], at);
  return git(dir, ['rev-parse', 'HEAD']);
}

t('G1 数据模型：commits 数组建版 / 旧单提交数据读取迁移 / appendItemCommits 追加去重并联动 scopeStale', () => {
  const dir = tmpdir('atb-bug20260921-015-g1-');
  // 建版直接带 commits 数组（多提交条目）
  const v1 = buildStore.createVersion(dir, {
    items: [{ itemId: 'REQ-20260921-015', commits: ['a'.repeat(40), 'b'.repeat(40)] }],
  });
  assert.deepEqual(commitsOf(v1.items[0]), ['a'.repeat(40), 'b'.repeat(40)], '建版支持一条目多提交');
  assert.equal(v1.items[0].commit, 'a'.repeat(40), 'commit 别名保留（首个提交，向后兼容）');
  // 旧单提交数据迁移：手写旧形状 version.json → 读取时补全 commits
  const legacyDir = path.join(dir, 'runtime', 'builds', 'versions', 'BLD-19990101-001');
  fs.mkdirSync(legacyDir, { recursive: true });
  const legacy = { schema: 1, id: 'BLD-19990101-001', name: '旧版', description: '', status: 'draft', targetBranch: 'main',
    items: [{ itemId: 'REQ-19990101-001', commit: 'c'.repeat(40), title: '', mergedAt: null, mergeError: null }],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    merge: { startedAt: null, finishedAt: null, error: null, baseBranch: null, mainSha: null }, by: 't' };
  fs.writeFileSync(path.join(legacyDir, 'version.json'), JSON.stringify(legacy));
  const read = buildStore.readVersion(dir, 'BLD-19990101-001');
  assert.deepEqual(commitsOf(read.items[0]), ['c'.repeat(40)], '旧单提交数据读取时迁移出 commits 数组');
  // appendItemCommits：追加新提交（保留原有关联）、重复追加幂等、重置合并态、scopeStale 联动
  buildStore.recordDocsCommit(dir, v1.id, { commitHash: 'e'.repeat(40), files: { 'README.md': 'f'.repeat(64) }, scopeFp: 'x' });
  const v2 = buildStore.appendItemCommits(dir, v1.id, [{ itemId: 'REQ-20260921-015', commits: ['b'.repeat(40), 'd'.repeat(40)] }]);
  assert.deepEqual(commitsOf(v2.items[0]), ['a'.repeat(40), 'b'.repeat(40), 'd'.repeat(40)], '追加去重（b 不重复添加）且保留原有关联');
  assert.equal(v2.docs.scopeStale, true, '补入提交 → 发布范围变化（scopeStale 联动）');
  assert.match(v2.docs.staleReason || '', /补入/, 'staleReason 说明补入来源');
  // 锁定态：merging / 已推送拒绝
  buildStore.beginMerge(dir, v1.id);
  assert.throws(() => buildStore.appendItemCommits(dir, v1.id, [{ itemId: 'REQ-20260921-015', commits: ['1'.repeat(40)] }]), /合并中/);
  buildStore.finishMerge(dir, v1.id, { results: [{ itemId: 'REQ-20260921-015', ok: true }] });
  buildStore.recordPushSuccess(dir, v1.id, { remote: 'origin', sha: 'a'.repeat(40) });
  buildStore.recordReleaseConfirm(dir, v1.id, { runId: 'BPUB-test' });
  assert.throws(() => buildStore.appendItemCommits(dir, v1.id, [{ itemId: 'REQ-20260921-015', commits: ['2'.repeat(40)] }]), /已正式发布/);
  // 非法输入：条目不在版本 / hash 不合法
  const dir2 = tmpdir('atb-bug20260921-015-g1b-');
  const v3 = buildStore.createVersion(dir2, { items: [{ itemId: 'REQ-20260921-015', commit: 'a'.repeat(40) }] });
  assert.throws(() => buildStore.appendItemCommits(dir2, v3.id, [{ itemId: 'REQ-19990101-009', commits: ['b'.repeat(40)] }]), /不在本版本/);
  assert.throws(() => buildStore.appendItemCommits(dir2, v3.id, [{ itemId: 'REQ-20260921-015', commits: ['xyz'] }]), /commit/);
});

t('G2 隔离分析与合并执行使用一致提交集合：多提交条目无未选祖先；按 Git 依赖顺序重放（同文件三提交乱序存储仍成功）', () => {
  const dir = mkRepo(tmpdir('atb-bug20260921-015-g2-'));
  // 同一条目同文件三提交（doc → feat → test，逐次追加行）：乱序存储时若不按依赖顺序重放将冲突
  const cDoc = commitFile(dir, 'app.txt', 'doc', `docs: A REQ-20260921-015`, '2026-09-21T02:00:00 +0000');
  const cFeat = commitFile(dir, 'app.txt', 'doc\nfeat', `feat: A REQ-20260921-015`, '2026-09-21T02:01:00 +0000');
  const cTest = commitFile(dir, 'app.txt', 'doc\nfeat\ntest', `test: A REQ-20260921-015`, '2026-09-21T02:02:00 +0000');
  const items = [{ itemId: 'REQ-20260921-015', commits: [cTest, cDoc, cFeat] }]; // 故意乱序
  // 分析：selected 含全部三个提交 → 无未选祖先（集合一致，不按条目去重）
  const an = buildGit.analyzePublishIsolation(dir, items);
  assert.ok((an.perItem || []).every((x) => (x.intermediates || []).length === 0), `分析应按全部提交集合判定无未选祖先：${JSON.stringify(an.perItem)}`);
  assert.equal((an.blocked || []).length, 0, '同条目多提交不是混合提交（不同 hash）');
  // 合并：乱序存储仍按 Git 依赖顺序重放成功，main 含全部三段内容
  const r = buildGit.mergeIsolatedIntoMain(dir, { versionId: 'BLD-20260921-001', versionName: '测试', items });
  assert.equal(r.results.length, 3, '逐提交重放（一条目多提交各自一行结果）');
  assert.ok(r.results.every((x) => x.ok), `应全部成功：${JSON.stringify(r.results)}`);
  assert.equal(git(dir, ['show', 'main:app.txt']), 'doc\nfeat\ntest', 'main 包含 doc+feat+test 全部内容');
  assert.equal(git(dir, ['branch', '--show-current']), 'dev', '当前目录仍在 dev');
});

t('G3 幂等续传：已重放提交经 replays 证据记成功不重放，main 不新增空提交', () => {
  const dir = mkRepo(tmpdir('atb-bug20260921-015-g3-'));
  const c1 = commitFile(dir, 'f1.txt', 'one', `feat: A REQ-20260921-015`, '2026-09-21T02:00:00 +0000');
  const c2 = commitFile(dir, 'f2.txt', 'two', `feat: B REQ-20260921-016`, '2026-09-21T02:01:00 +0000');
  const items = [
    { itemId: 'REQ-20260921-015', commits: [c1] },
    { itemId: 'REQ-20260921-016', commits: [c2] },
  ];
  const first = buildGit.mergeIsolatedIntoMain(dir, { versionId: 'BLD-20260921-002', versionName: '测试', items });
  assert.ok(first.results.every((x) => x.ok));
  const count = Number(git(dir, ['rev-list', '--count', 'main']));
  // 重试：同一提交集合 + 已记录 replays → 全部记成功（alreadyIncluded），不再 cherry-pick
  const retry = buildGit.mergeIsolatedIntoMain(dir, { versionId: 'BLD-20260921-002', versionName: '测试', items, replays: first.replays });
  assert.ok(retry.results.every((x) => x.ok), `重试应全部成功：${JSON.stringify(retry.results)}`);
  assert.equal(Number(git(dir, ['rev-list', '--count', 'main'])), count, 'main 不新增提交（幂等续传，不制造空提交失败）');
});

t('G4 finishMerge 多行结果：一条目多提交部分失败 → 条目失败并保留原因；重试全成功 → merged', () => {
  const dir = tmpdir('atb-bug20260921-015-g4-');
  const v = buildStore.createVersion(dir, { items: [{ itemId: 'REQ-20260921-015', commits: ['a'.repeat(40), 'b'.repeat(40)] }] });
  buildStore.beginMerge(dir, v.id);
  const f1 = buildStore.finishMerge(dir, v.id, {
    results: [
      { itemId: 'REQ-20260921-015', commit: 'a'.repeat(40), ok: true },
      { itemId: 'REQ-20260921-015', commit: 'b'.repeat(40), ok: false, error: '隔离合并冲突' },
    ],
  });
  assert.equal(f1.status, 'failed', '条目任一提交失败 → 版本 failed');
  assert.equal(f1.items[0].mergedAt, null, '部分成功不记条目已合并');
  assert.match(f1.items[0].mergeError || '', /隔离合并冲突/, '条目失败原因保留');
  // 重试：两提交均成功（其一 alreadyIncluded）→ 条目合并完成
  buildStore.beginMerge(dir, v.id);
  const f2 = buildStore.finishMerge(dir, v.id, {
    results: [
      { itemId: 'REQ-20260921-015', commit: 'a'.repeat(40), ok: true, alreadyIncluded: true },
      { itemId: 'REQ-20260921-015', commit: 'b'.repeat(40), ok: true },
    ],
  });
  assert.equal(f2.status, 'merged', '全部提交成功 → merged');
  assert.ok(f2.items[0].mergedAt, '条目记已合并');
});

/* ---------- H*：HTTP 接口 + 真实临时 Git 仓库（复现路径端到端） ---------- */

async function setupServer(prepare) {
  const tmp = tmpdir('atb-bug20260921-015-h-');
  const proj = path.join(tmp, 'proj');
  mkRepo(proj);
  core.initData(proj);
  const dataDir = core.dataDirFrom(proj);
  const ctx = {
    proj, dataDir,
    mkItem: (type, title) => core.createItem(dataDir, { type, title, by: 'test' }),
    markDone: (id) => { for (const s of ['accepted', 'in-progress', 'done']) core.setStatus(dataDir, id, s, { by: 'test' }); },
    commit: (file, content, subject, at) => commitFile(proj, file, content, subject, at),
    // 多文件定向提交（BUG-20260926-003：真实混合提交 = 变更同时触及多个条目目录，需多文件落盘）
    commitFiles: (files, subject, at) => {
      for (const f of files) fs.writeFileSync(path.join(proj, f), `${subject}\n`);
      git(proj, ['add', '--', ...files]);
      gitAt(proj, ['commit', '-m', subject], at);
      return git(proj, ['rev-parse', 'HEAD']);
    },
    createVersion: (items, name = '测试版本') => buildStore.createVersion(dataDir, { name, items }),
  };
  const ids = prepare ? (await prepare(ctx)) : {};
  const reg = path.join(tmp, 'reg.json');
  const spawnOnPort = async (port) => {
    const child = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
      cwd: proj,
      env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: reg },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try {
        const hh = await req(port, 'GET', '/api/health');
        if (hh.json && hh.json.port === port) return child;
      } catch {}
      if (child.exitCode !== null) break;
    }
    child.kill('SIGTERM');
    return null;
  };
  let server = null;
  let port = 0;
  for (let i = 0; i < 6 && !server; i++) {
    port = 34000 + Math.floor(Math.random() * 16000);
    server = await spawnOnPort(port);
  }
  assert.ok(server, `服务应启动（最后端口 ${port}）`);
  return {
    port, dataDir, proj, ...ids,
    P: `?project=${encodeURIComponent(proj)}`,
    close: async () => { server.kill('SIGTERM'); await sleep(200); },
  };
}

function req(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 10000,
    }, (rs) => {
      const chunks = [];
      rs.on('data', (c) => chunks.push(c));
      rs.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString() || '{}'); } catch {}
        resolve({ status: rs.statusCode, json, text: buf.toString() });
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (payload) r.write(payload);
    r.end();
  });
}

t('H1 补入提交数据路径（REQ-20260926-002 起经条目编辑补入，一键加入端点已下线）：appendItemCommits 补齐其余提交（原关联保留）；隔离分析收敛；补入幂等', async () => {
  const h = await setupServer((c) => {
    const A = c.mkItem('requirement', '需求A（doc+feat+test）');
    c.markDone(A.id);
    const cDoc = c.commit('a-doc.txt', 'doc', `docs: A ${A.id}`, '2026-09-21T03:00:00 +0000');
    const cFeat = c.commit('a-feat.txt', 'feat', `feat: A ${A.id}`, '2026-09-21T03:01:00 +0000');
    const cTest = c.commit('a-test.txt', 'test', `test: A ${A.id}`, '2026-09-21T03:02:00 +0000');
    return { A, cDoc, cFeat, cTest };
  });
  try {
    // 版本关联条目最新（test）提交：doc / feat 均为其未选祖先（复现前提）
    const created = await req(h.port, 'POST', `/api/build/version${h.P}`, { items: [{ itemId: h.A.id, commit: h.cTest }] });
    assert.equal(created.status, 201, `创建版本应成功：${created.text}`);
    const vid = created.json.version.id;
    // 前置：隔离分析发现 doc / feat 两个未选祖先
    let plan = await req(h.port, 'GET', `/api/build/publish-plan${h.P}&id=${encodeURIComponent(vid)}`);
    assert.ok((plan.json.mergeAnalysis.perItem || []).some((x) => (x.intermediates || []).length >= 2), '前置：应存在未选祖先');
    // 预置文档提交记录（验证 scopeStale 联动）
    buildStore.recordDocsCommit(h.dataDir, vid, { commitHash: 'e'.repeat(40), files: { 'README.md': 'f'.repeat(64) }, scopeFp: 'x' });
    // 补入：doc / feat 经数据层 appendItemCommits 补入条目 A（保留原有关联；端点下线后由条目编辑承接）
    const appendedV = buildStore.appendItemCommits(h.dataDir, vid, [{ itemId: h.A.id, commits: [h.cDoc, h.cFeat] }]);
    assert.ok(sameSet(commitsOf(appendedV.items[0]), [h.cDoc, h.cFeat, h.cTest]), `条目关联全部提交：${JSON.stringify(appendedV.items[0])}`);
    assert.equal(appendedV.items[0].commit, h.cTest, '条目原有关联保留（不替换）');
    assert.equal(appendedV.docs.scopeStale, true, '补入提交 → 发布范围变化（文档需重新核对 / 提交）');
    // 隔离分析收敛：无未选祖先
    plan = await req(h.port, 'GET', `/api/build/publish-plan${h.P}&id=${encodeURIComponent(vid)}`);
    assert.ok((plan.json.mergeAnalysis.perItem || []).every((x) => (x.intermediates || []).length === 0), `补入后应无未选祖先：${JSON.stringify(plan.json.mergeAnalysis)}`);
    // 幂等：重复补入不再重复添加
    const v2 = buildStore.appendItemCommits(h.dataDir, vid, [{ itemId: h.A.id, commits: [h.cDoc, h.cFeat] }]);
    assert.ok(sameSet(commitsOf(v2.items[0]), [h.cDoc, h.cFeat, h.cTest]), '重复补入不重复添加');
  } finally {
    await h.close();
  }
});

t('H2 数据路径验收（REQ-20260926-002 起经条目关联多提交，一键加入端点已下线）：新条目多提交全部保留，挑选合并入 main，主分支包含实现 / 测试 / 文档内容；包含性校验一致通过', async () => {
  const h = await setupServer((c) => {
    const A = c.mkItem('requirement', '所选需求A');
    const B = c.mkItem('requirement', '新依赖需求B（两提交）');
    c.markDone(A.id);
    c.markDone(B.id);
    const cB1 = c.commit('b1.txt', 'b-one', `feat: B1 ${B.id}`, '2026-09-21T04:00:00 +0000');
    const cB2 = c.commit('b2.txt', 'b-two', `feat: B2 ${B.id}`, '2026-09-21T04:01:00 +0000');
    const cADoc = c.commit('a-doc.txt', 'doc', `docs: A ${A.id}`, '2026-09-21T04:02:00 +0000');
    const cAFeat = c.commit('a-feat.txt', 'feat', `feat: A ${A.id}`, '2026-09-21T04:03:00 +0000');
    const cATest = c.commit('a-test.txt', 'test', `test: A ${A.id}`, '2026-09-21T04:04:00 +0000');
    return { A, B, cB1, cB2, cADoc, cAFeat, cATest };
  });
  try {
    const created = await req(h.port, 'POST', `/api/build/version${h.P}`, { items: [{ itemId: h.A.id, commit: h.cATest }] });
    assert.equal(created.status, 201, `创建版本应成功：${created.text}`);
    const vid = created.json.version.id;
    // 条目关联多提交：A 补入 doc / feat，B 以两个提交纳入（数据层直连；同条目多提交全保留）
    buildStore.appendItemCommits(h.dataDir, vid, [{ itemId: h.A.id, commits: [h.cADoc, h.cAFeat] }]);
    buildStore.addItems(h.dataDir, vid, [{ itemId: h.B.id, commit: h.cB1, commits: [h.cB1, h.cB2] }]);
    // 挑选合并入 main（数据层直连，真实临时 Git 仓库）
    let v = buildStore.readVersion(h.dataDir, vid);
    buildStore.beginMerge(h.dataDir, vid);
    const pending = v.items.filter((x) => !x.mergedAt);
    const m = buildGit.mergeIsolatedIntoMain(h.proj, { versionId: vid, versionName: '测试', items: pending });
    assert.ok((m.results || []).every((x) => x.ok), `合并应全部成功：${JSON.stringify(m.results)}`);
    assert.equal((m.results || []).length, 5, 'A 三提交 + B 两提交逐条重放');
    v = buildStore.finishMerge(h.dataDir, vid, { results: m.results });
    assert.equal(v.status, 'merged', '版本合并完成');
    buildStore.saveMergeReplays(h.dataDir, vid, m.replays);
    // 主分支包含实现、测试和文档内容（不能只断言提示消失）
    assert.equal(git(h.proj, ['show', 'main:a-doc.txt']).trim(), 'doc', 'main 含文档内容');
    assert.equal(git(h.proj, ['show', 'main:a-feat.txt']).trim(), 'feat', 'main 含实现内容');
    assert.equal(git(h.proj, ['show', 'main:a-test.txt']).trim(), 'test', 'main 含测试内容');
    assert.equal(git(h.proj, ['show', 'main:b1.txt']).trim(), 'b-one', 'main 含新条目第一提交内容');
    assert.equal(git(h.proj, ['show', 'main:b2.txt']).trim(), 'b-two', 'main 含新条目第二提交内容');
    // 发布包含性校验：隔离分析 / 合并执行 / 包含性校验同一提交集合（原始提交经重放证据认可）
    const finalV = buildStore.readVersion(h.dataDir, vid);
    const mainSha = git(h.proj, ['rev-parse', 'main']);
    await buildPublish.assertItemsIncluded(h.proj, finalV.items, mainSha, finalV.merge.replays);
  } finally {
    await h.close();
  }
});

t('H3 一键加入端点下线（REQ-20260926-002）：无法纳入场景不再经端点反馈——请求 404、版本范围不变；done 门禁与占用校验在条目纳入路径保留', async () => {
  const h = await setupServer((c) => {
    const A = c.mkItem('requirement', '所选需求A');
    const D = c.mkItem('requirement', '被占用依赖D');
    c.markDone(A.id);
    c.markDone(D.id);
    const cD = c.commit('d.txt', 'd', `feat: D ${D.id}`, '2026-09-21T05:02:00 +0000');
    const cA = c.commit('a.txt', 'a', `feat: A ${A.id}`, '2026-09-21T05:04:00 +0000');
    const occ = c.createVersion([{ itemId: D.id, commit: cD }], '占用版本');
    return { A, D, cD, cA, occId: occ.id };
  });
  try {
    const created = await req(h.port, 'POST', `/api/build/version${h.P}`, { items: [{ itemId: h.A.id, commit: h.cA }] });
    assert.equal(created.status, 201, `创建版本应成功：${created.text}`);
    const vid = created.json.version.id;
    // 端点下线：请求 404，版本范围不变
    const r = await req(h.port, 'POST', `/api/build/version/add-dependencies${h.P}`, { id: vid });
    assert.equal(r.status, 404, `一键加入端点应已下线（404）：${r.text}`);
    const version = (await req(h.port, 'GET', `/api/build/state${h.P}`)).json.versions.find((x) => x.id === vid);
    assert.equal(version.items.length, 1, '版本范围不变');
    // 既有校验不弱化（数据层口径）：跨版本占用条目不可纳入其他版本
    assert.throws(() => buildStore.addItems(h.dataDir, vid, [{ itemId: h.D.id, commit: h.cD }]), /已纳入版本/, '跨版本占用校验保留');
  } finally {
    await h.close();
  }
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
