#!/usr/bin/env node
// REQ-20260926-002 发布模块简化为条目与提交组版、挑选合并、文档翻译合并及官网更新流程。
// L1 纯逻辑（publish-flow：五步重定义与门禁重写）；
// L2 数据层（build-store：文档合并落账 / 已合入事实不可静默抹除 / docs 合并门禁移除）；
// L3 Git 层（build-git：共享提交只执行一次 / 分析不再判混合 / 冲突文件明细 / 文档提交合入 main）；
// L4 服务接口（合并无文档门禁 / add-dependencies 下线 / docs/merge 端点 / 发布推送门禁 / 快照保留）；
// L5 前端静态契约（五步导航 / 合并页无一键加入 / 发布步两动作 / i18n 同步）。
// 用法：node scripts/tests/req-20260926-002.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as flow from '../lib/publish-flow.mjs';
import * as buildStore from '../lib/build-store.mjs';
import * as buildGit from '../lib/build-git.mjs';
import '../web/i18n.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

function git(cwd, args, env = GIT_ENV) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env, timeout: 20000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r.stdout.trim();
}
function gitAt(cwd, args, at) {
  return git(cwd, args, { ...GIT_ENV, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at });
}
function tmpdir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}
function mkRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@e.co']);
  git(dir, ['config', 'user.name', 'T']);
  return dir;
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- L1 纯逻辑（publish-flow.mjs） ---------- */

t('L1-1 五步重定义：选择条目与提交 → 挑选合并 → 文档与翻译 → 文档合并 → 发布', () => {
  assert.deepEqual(flow.PUBLISH_STEPS.map((s) => s.key), ['plan', 'merge', 'docs', 'docmerge', 'release']);
  assert.deepEqual(flow.PUBLISH_STEPS.map((s) => s.label), ['选择条目与提交', '挑选合并', '文档与翻译', '文档合并', '发布']);
  assert.ok(!flow.PUBLISH_STEPS.some((s) => s.key === 'link'), '「关联条目与提交」并入第一步');
});

t('L1-2 五步门禁：挑选合并不再要求文档已提交；文档编写在挑选合并完成后解锁；文档合并要求文档已提交；发布要求已合并且文档已合并入 main', () => {
  const items = [{ itemId: 'REQ-20260926-002', commit: 'a'.repeat(40) }];
  const mk = (over = {}) => ({ status: 'draft', items, docs: null, ...over });
  const by = (steps, k) => steps.find((s) => s.key === k);
  // draft 有条目 + 无文档：挑选合并解锁（无需先完成文档）
  let steps = flow.publishStepsState(mk(), { overall: 'none' });
  assert.ok(!by(steps, 'merge').locked, '挑选合并不再被文档门禁锁定');
  assert.ok(by(steps, 'docs').locked && /挑选合并|合入/.test(by(steps, 'docs').reason), '未合并前文档编写锁定并说明依据实际合入内容');
  assert.ok(by(steps, 'docmerge').locked, '文档未提交锁文档合并');
  assert.ok(by(steps, 'release').locked, '未合并不可发布');
  // 空计划：挑选合并提示先关联
  steps = flow.publishStepsState(mk({ items: [] }), { overall: 'none' });
  assert.ok(by(steps, 'merge').locked && /关联/.test(by(steps, 'merge').reason), '空计划挑选合并提示先关联条目');
  // merged + 文档已提交 + 文档未合并：发布被文档合并门禁锁定
  steps = flow.publishStepsState(mk({ status: 'merged' }), { overall: 'committed' });
  assert.ok(!by(steps, 'merge').locked, '已合并挑选合并可重开（增量）');
  assert.ok(!by(steps, 'docs').locked, '合并完成后文档编写解锁');
  assert.ok(!by(steps, 'docmerge').locked, '文档已提交解锁文档合并');
  assert.ok(by(steps, 'release').locked && /文档合并|文档/.test(by(steps, 'release').reason), '文档未合并入 main 不可发布');
  // merged + 文档已合并：发布解锁
  steps = flow.publishStepsState(mk({ status: 'merged', docsMerge: { commitHash: 'c'.repeat(40), mergedAt: '2026-09-26T10:00:00.000Z' } }), { overall: 'committed' });
  assert.ok(!by(steps, 'release').locked, '文档合并后发布解锁');
  // 旧计划兼容：draft 但已有文档提交记录（旧流程先文档后合并）→ 文档步不锁
  steps = flow.publishStepsState(mk({ docs: { commitHash: 'c'.repeat(40) } }), { overall: 'committed' });
  assert.ok(!by(steps, 'docs').locked, '旧计划已有文档提交记录不锁文档步（不要求重新执行）');
  // 已发布（BUG-20260928-005：发布按钮二次确认落账 confirmedAt 才是正式发布——仅推送不锁）：合并锁定、发布可查看
  steps = flow.publishStepsState(mk({ status: 'merged', release: { pushedAt: '2026-09-26T11:00:00.000Z', confirmedAt: '2026-09-26T12:00:00.000Z' } }), { overall: 'committed' });
  assert.ok(by(steps, 'merge').locked && /正式发布/.test(by(steps, 'merge').reason), '已正式发布锁定挑选合并');
  assert.ok(by(steps, 'docs').locked && /正式发布/.test(by(steps, 'docs').reason), '已正式发布锁定文档编写');
  assert.ok(by(steps, 'docmerge').locked && /正式发布/.test(by(steps, 'docmerge').reason), '已正式发布锁定文档合并');
  assert.ok(!by(steps, 'release').locked, '已正式发布可进入发布步查看结果');
  // merging：各步锁定
  steps = flow.publishStepsState(mk({ status: 'merging' }), { overall: 'committed' });
  assert.ok(by(steps, 'merge').locked && /合并执行中/.test(by(steps, 'merge').reason), '合并执行中防重复');
  assert.ok(by(steps, 'docmerge').locked && /合并执行中/.test(by(steps, 'docmerge').reason), '合并执行中锁文档合并');
});

/* ---------- L2 数据层（build-store.mjs） ---------- */

t('L2-1 文档合并落账：docsMerge 记录提交 / 重放 / main 头，重复合并累积去重不丢证据', () => {
  const dir = tmpdir('atb-req-002-store-');
  const v = buildStore.createVersion(dir, { items: [{ itemId: 'REQ-20260926-002', commit: 'a'.repeat(40) }] });
  const c1 = 'c'.repeat(40);
  let out = buildStore.recordDocsMerge(dir, v.id, { commitHash: c1, replayedHash: 'd'.repeat(40), mainSha: 'e'.repeat(40), replays: [{ itemId: 'docs', original: c1, replayed: 'd'.repeat(40) }] });
  assert.equal(out.docsMerge.commitHash, c1);
  assert.equal(out.docsMerge.replayedHash, 'd'.repeat(40));
  assert.equal(out.docsMerge.replays.length, 1, '重放证据落账');
  // 范围变化后新文档提交再次合并：history 累积、replays 按 original 去重合并
  const c2 = 'f'.repeat(40);
  out = buildStore.recordDocsMerge(dir, v.id, { commitHash: c2, replayedHash: '1'.repeat(40), mainSha: '2'.repeat(40), replays: [{ itemId: 'docs', original: c2, replayed: '1'.repeat(40) }] });
  assert.equal(out.docsMerge.commitHash, c2, 'docsMerge 指向最新文档合并');
  assert.equal(out.docsMerge.history.length, 2, '合并历史累积（已合入事实不抹除）');
  assert.equal(out.docsMerge.replays.length, 2);
  out = buildStore.recordDocsMerge(dir, v.id, { commitHash: c2, replayedHash: '1'.repeat(40), mainSha: '2'.repeat(40), replays: [{ itemId: 'docs', original: c2, replayed: '1'.repeat(40) }] });
  assert.equal(out.docsMerge.replays.length, 2, '重复合并按 original 去重不重复累积');
});

t('L2-2 已合入事实不可静默移除：mergedAt 条目不可移出、不可更换提交关联；未合入条目不受限', () => {
  const dir = tmpdir('atb-req-002-store2-');
  const v = buildStore.createVersion(dir, { items: [{ itemId: 'REQ-20260926-002', commit: 'a'.repeat(40) }, { itemId: 'BUG-20260926-002', commit: 'b'.repeat(40) }] });
  buildStore.beginMerge(dir, v.id, { baseBranch: 'dev' });
  buildStore.finishMerge(dir, v.id, { results: [{ itemId: 'REQ-20260926-002', ok: true }] });
  assert.throws(() => buildStore.removeItems(dir, v.id, ['REQ-20260926-002']), /已合并入 main/, '已合入条目移出被拦（不静默抹除已合入事实）');
  assert.throws(() => buildStore.setItemCommit(dir, v.id, 'REQ-20260926-002', 'c'.repeat(40)), /已合并入 main/, '已合入条目换提交被拦');
  // 未合入条目照常可换提交 / 移出（既有口径不回归）
  let out = buildStore.setItemCommit(dir, v.id, 'BUG-20260926-002', 'c'.repeat(40));
  assert.equal(out.items.find((x) => x.itemId === 'BUG-20260926-002').commit, 'c'.repeat(40));
  out = buildStore.removeItems(dir, v.id, ['BUG-20260926-002']);
  assert.deepEqual(out.items.map((i) => i.itemId), ['REQ-20260926-002']);
});

t('L2-3 合并文档门禁移除：assertMergeDocsGate 不再存在（挑选合并不再要求先完成文档）', () => {
  assert.equal(buildStore.assertMergeDocsGate, undefined, '文档门禁随流程重排移除');
});

/* ---------- L3 Git 层（build-git.mjs） ---------- */

t('L3-1 共享提交只执行一次：一个提交关联多个条目按 hash 去重 cherry-pick 一次，各条目结果一致、重放证据一条', () => {
  const dir = mkRepo(tmpdir('atb-req-002-git1-'));
  fs.writeFileSync(path.join(dir, 'base.txt'), 'base');
  git(dir, ['add', '-A']); gitAt(dir, ['commit', '-m', 'init'], '2026-09-26T01:00:00 +0000');
  git(dir, ['switch', '-c', 'dev']);
  fs.writeFileSync(path.join(dir, 'y.txt'), 'y');
  git(dir, ['add', '-A']); gitAt(dir, ['commit', '-m', 'feat: A+B REQ-20260926-002 REQ-20260926-003'], '2026-09-26T01:01:00 +0000');
  const c = git(dir, ['rev-parse', 'HEAD']);
  const items = [
    { itemId: 'REQ-20260926-002', commit: c },
    { itemId: 'REQ-20260926-003', commit: c },
  ];
  const r = buildGit.mergeIsolatedIntoMain(dir, { versionId: 'BLD-20260926-009', versionName: '测试', items });
  const okRows = r.results.filter((x) => x.ok);
  assert.deepEqual(okRows.map((x) => x.itemId).sort(), ['REQ-20260926-002', 'REQ-20260926-003'], '各关联条目均记成功（一致结果）');
  assert.equal(r.replays.length, 1, '共享提交只重放一次（一条重放证据）');
  assert.equal(Number(git(dir, ['rev-list', '--count', 'main'])), 2, 'main 只新增一个重放提交');
  assert.equal(git(dir, ['show', 'main:y.txt']).trim(), 'y', '变更内容在 main');
  assert.equal(buildGit.isAncestorOf(dir, c, 'main'), false, '原始提交非 main 祖先（重放）');
  assert.equal(buildGit.isAncestorOf(dir, r.replays[0].replayed, 'main'), true, '重放提交在 main');
});

t('L3-2 分析不再判混合提交：共享提交无 blocked，shared 如实记录，notes 说明只执行一次', () => {
  const dir = mkRepo(tmpdir('atb-req-002-git2-'));
  fs.writeFileSync(path.join(dir, 'x.txt'), 'x');
  git(dir, ['add', '-A']); git(dir, ['commit', '-m', 'init']);
  git(dir, ['switch', '-c', 'dev']);
  fs.writeFileSync(path.join(dir, 'y.txt'), 'y');
  git(dir, ['add', '-A']); git(dir, ['commit', '-m', 'feat: A+B REQ-20260926-002 REQ-20260926-003']);
  const c = git(dir, ['rev-parse', 'HEAD']);
  const an = buildGit.analyzePublishIsolation(dir, [
    { itemId: 'REQ-20260926-002', commit: c },
    { itemId: 'REQ-20260926-003', commit: c },
  ]);
  assert.deepEqual(an.blocked, undefined, '混合提交阻断随流程移除');
  assert.equal(an.shared.length, 1, '共享提交如实记录');
  assert.deepEqual(an.shared[0].itemIds.sort(), ['REQ-20260926-002', 'REQ-20260926-003']);
  assert.ok(an.notes.some((n) => /一次/.test(n)), 'notes 说明共享提交只执行一次');
  assert.equal(an.targetBranch, 'main');
});

t('L3-3 冲突可诊断：cherry-pick 失败原因含冲突文件与提交说明', () => {
  const dir = mkRepo(tmpdir('atb-req-002-git3-'));
  fs.writeFileSync(path.join(dir, 's.txt'), 'line\n');
  git(dir, ['add', '-A']); gitAt(dir, ['commit', '-m', 'init'], '2026-09-26T01:00:00 +0000');
  git(dir, ['switch', '-c', 'dev']);
  fs.writeFileSync(path.join(dir, 's.txt'), 'A 改了这一行\n');
  git(dir, ['add', '-A']); gitAt(dir, ['commit', '-m', 'feat: A REQ-20260926-003'], '2026-09-26T01:01:00 +0000');
  fs.writeFileSync(path.join(dir, 's.txt'), 'B 也改了这一行\n');
  git(dir, ['add', '-A']); gitAt(dir, ['commit', '-m', 'feat: B 修改同一行 REQ-20260926-002'], '2026-09-26T01:02:00 +0000');
  const commitB = git(dir, ['rev-parse', 'HEAD']);
  const r = buildGit.mergeIsolatedIntoMain(dir, { versionId: 'BLD-20260926-009', versionName: '测试', items: [{ itemId: 'REQ-20260926-002', commit: commitB }] });
  assert.equal(r.results[0].ok, false);
  assert.match(r.results[0].error, /s\.txt/, '失败原因含冲突文件名');
  assert.match(r.results[0].error, /修改同一行/, '失败原因含提交主题');
  assert.equal(git(dir, ['show', 'main:s.txt']).trim(), 'line', 'main 保持不变（现场保护）');
});

t('L3-4 文档提交合入 main：cherry-pick 重放 + 重放证据；重试幂等不重复执行', () => {
  const dir = mkRepo(tmpdir('atb-req-002-git4-'));
  fs.writeFileSync(path.join(dir, 'base.txt'), 'base');
  git(dir, ['add', '-A']); gitAt(dir, ['commit', '-m', 'init'], '2026-09-26T01:00:00 +0000');
  git(dir, ['switch', '-c', 'dev']);
  fs.writeFileSync(path.join(dir, 'README.md'), '# R\n');
  git(dir, ['add', '-A']); gitAt(dir, ['commit', '-m', 'docs: 发布文档 BLD-20260926-009'], '2026-09-26T01:01:00 +0000');
  const doc = git(dir, ['rev-parse', 'HEAD']);
  const r1 = buildGit.mergeDocsCommitIntoMain(dir, { versionId: 'BLD-20260926-009', commitHash: doc });
  assert.equal(r1.ok, true, `文档合入应成功：${r1.error || ''}`);
  assert.ok(/^[0-9a-f]{40}$/.test(r1.replayedHash), '返回重放提交');
  assert.equal(git(dir, ['show', 'main:README.md']).trim(), '# R', 'main 含文档');
  // 重试：重放提交已在 main → 幂等 alreadyIncluded
  const r2 = buildGit.mergeDocsCommitIntoMain(dir, { versionId: 'BLD-20260926-009', commitHash: doc, replays: r1.replays });
  assert.equal(r2.ok, true);
  assert.equal(r2.alreadyIncluded, true, '重试幂等：不重复 cherry-pick');
  assert.equal(Number(git(dir, ['rev-list', '--count', 'main'])), 2, 'main 不新增重复提交');
});

/* ---------- L4 服务接口 ---------- */

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

t('L4 服务接口：挑选合并无文档门禁 → 文档编写提交 → 文档合并入 main → 发布推送门禁；add-dependencies 下线；快照保留', async () => {
  const tmp = tmpdir('atb-req-002-serve-');
  const proj = mkRepo(path.join(tmp, 'proj'));
  const remote = path.join(tmp, 'remote.git');
  git(tmp, ['init', '--bare', '-b', 'main', remote]);
  git(proj, ['remote', 'add', 'origin', remote]);
  fs.writeFileSync(path.join(proj, 'base.txt'), 'base');
  git(proj, ['add', '-A']); gitAt(proj, ['commit', '-m', 'init'], '2026-09-26T02:00:00 +0000');
  git(proj, ['switch', '-c', 'dev']);
  fs.writeFileSync(path.join(proj, 'b.txt'), 'B');
  git(proj, ['add', '-A']); gitAt(proj, ['commit', '-m', 'feat: B REQ-20260926-002'], '2026-09-26T02:01:00 +0000');
  const commitB = git(proj, ['rev-parse', 'HEAD']);
  core.initData(proj);
  const dataDir = core.dataDirFrom(proj);
  const reqB = core.createItem(dataDir, { type: 'requirement', title: '条目 B', by: 'test' });
  for (const s of ['accepted', 'in-progress', 'done']) core.setStatus(dataDir, reqB.id, s, { by: 'test' });

  const reg = path.join(tmp, 'reg.json');
  let server = null;
  let port = 0;
  for (let i = 0; i < 6 && !server; i++) {
    const p = 33500 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
      cwd: proj,
      env: { ...process.env, ATB_PORT: String(p), ATB_REGISTRY: reg, ATB_BUILD_PUBLISH_CONFIG: path.join(tmp, 'bp.json') },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    for (let k = 0; k < 40; k++) {
      await sleep(150);
      try { const h = await req(p, 'GET', '/api/health'); if (h.json && h.json.port === p) { server = child; port = p; break; } } catch {}
      if (child.exitCode !== null) break;
    }
    if (!server) child.kill('SIGTERM');
  }
  assert.ok(server, '服务应启动');
  const P = `?project=${encodeURIComponent(proj)}`;
  try {
    // 创建版本（挑选条目与提交）
    let r = await req(port, 'POST', `/api/build/version${P}`, { items: [{ itemId: reqB.id, commit: commitB }] });
    assert.equal(r.status, 201, `创建版本：${r.text}`);
    const vid = r.json.version.id;

    // publish-plan：新五步键序
    r = await req(port, 'GET', `/api/build/publish-plan${P}&id=${vid}`);
    assert.equal(r.status, 200, `publish-plan：${r.text}`);
    assert.deepEqual(r.json.steps.map((s) => s.key), ['plan', 'merge', 'docs', 'docmerge', 'release'], '五步键序');
    assert.ok(!r.json.steps.find((s) => s.key === 'merge').locked, '挑选合并无文档门禁');

    // 无文档直接挑选合并：成功（不再要求先完成发布文档）
    r = await req(port, 'POST', `/api/build/version/merge${P}`, { id: vid });
    assert.equal(r.status, 200, `无文档挑选合并应成功：${r.text}`);
    assert.equal(r.json.version.status, 'merged', '合并完成');
    assert.ok(git(proj, ['ls-tree', '--name-only', 'main']).includes('b.txt'), 'main 含所选提交变更');

    // 一键加入所有依赖提交端点下线
    r = await req(port, 'POST', `/api/build/version/add-dependencies${P}`, { id: vid });
    assert.equal(r.status, 404, 'add-dependencies 已移除（404）');

    // 发布推送在文档合并前被拦
    r = await req(port, 'POST', `/api/build/release/push${P}`, { id: vid, remote: 'origin' });
    assert.equal(r.status, 400, '文档未合并入 main 推送被拦');
    assert.match(r.json.error || '', /文档合并|文档/);

    // 文档编写 → 审核 → 提交（dev）
    const contents = {};
    for (const f of flow.publishDocFiles()) contents[f.file] = `# ${f.key} ${f.lang}\n`;
    contents['README.md'] = '# README\n[更新日志](CHANGELOG.md) [功能](FEATURES.md)\n';
    contents['README_en.md'] = '# README\n[Changelog](CHANGELOG_en.md) [Features](FEATURES_en.md)\n';
    for (const [file, content] of Object.entries(contents)) {
      r = await req(port, 'POST', `/api/build/docs/save${P}`, { id: vid, file, content });
      assert.equal(r.status, 200, `保存 ${file}：${r.text}`);
    }
    for (const f of flow.publishDocFiles()) {
      r = await req(port, 'POST', `/api/build/docs/review${P}`, { id: vid, file: f.file });
      assert.equal(r.status, 200, `审核 ${f.file}：${r.text}`);
    }
    r = await req(port, 'POST', `/api/build/docs/commit${P}`, { id: vid });
    assert.equal(r.status, 200, `文档提交：${r.text}`);
    const docCommitHash = r.json.commitHash;
    assert.match(git(proj, ['log', '-1', '--format=%s', docCommitHash]), new RegExp(vid), '文档提交直接关联 BLD 计划号');

    // 文档合并入 main（单独提交通道；合并前 main 无 README）
    assert.ok(!git(proj, ['ls-tree', '--name-only', 'main']).includes('README.md'), '合并前 main 无文档');
    r = await req(port, 'POST', `/api/build/docs/merge${P}`, { id: vid });
    assert.equal(r.status, 200, `文档合并：${r.text}`);
    assert.ok(r.json.version.docsMerge?.commitHash === docCommitHash, 'docsMerge 落账指向文档提交');
    assert.ok(r.json.version.docsMerge?.replayedHash, '重放证据落账');
    assert.ok(git(proj, ['ls-tree', '--name-only', 'main']).includes('README.md'), 'main 含发布文档');
    assert.equal(git(proj, ['ls-tree', '--name-only', 'main']).includes('b.txt'), true, '既有功能合入保留（不回滚）');
    // 重试幂等
    r = await req(port, 'POST', `/api/build/docs/merge${P}`, { id: vid });
    assert.equal(r.status, 200, `文档合并重试幂等：${r.text}`);
    assert.equal(r.json.alreadyIncluded, true, '已合入不重复执行');

    // 文档合并后推送成功
    r = await req(port, 'POST', `/api/build/release/push${P}`, { id: vid, remote: 'origin' });
    assert.equal(r.status, 200, `推送：${r.text}`);
    assert.ok(r.json.version.release.pushedAt, '推送完成时间落盘');
    const refs = git(proj, ['ls-remote', 'origin']);
    assert.match(refs, /refs\/heads\/main/);
    assert.doesNotMatch(refs, /refs\/heads\/dev/, '不顺带推送 dev');

    // 快照保留：删除看板条目后版本计划仍保留编号 / 标题 / 提交关联
    const title = r.json.version.items[0].title;
    assert.ok(title, '计划内快照含标题');
    // 模拟条目删除（core.deleteItem 仅允许 submitted，done 条目按状态机不可删——这里按其
    // 落盘效果移除条目目录与状态文件，构造「条目已删除」fixture 验证快照不受影响）
    const itemDir = path.join(dataDir, 'requirements', reqB.id);
    fs.rmSync(itemDir, { recursive: true, force: true });
    fs.rmSync(path.join(dataDir, 'runtime', 'status', `${reqB.id}.json`), { force: true });
    r = await req(port, 'GET', `/api/build/publish-plan${P}&id=${vid}`);
    assert.equal(r.status, 200, '条目删除后计划仍可读取');
    assert.equal(r.json.version.items[0].itemId, reqB.id, '快照保留条目编号');
    assert.equal(r.json.version.items[0].title, title, '快照保留标题');
    assert.equal(r.json.version.items[0].commits[0], commitB, '快照保留提交关联');
  } finally {
    server.kill('SIGTERM');
  }
});

/* ---------- L5 前端静态契约 ---------- */

t('L5-1 前端五步导航与页面契约：新步骤标签、无一键加入、文档合并步与发布步两动作', () => {
  const buildJs = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'build.js'), 'utf8');
  for (const label of ['选择条目与提交', '挑选合并', '文档与翻译', '文档合并', '发布']) {
    assert.ok(buildJs.includes(`'${label}'`) || buildJs.includes(label), `导航含「${label}」`);
  }
  assert.ok(!buildJs.includes('一键加入所有未选祖先提交'), '一键加入引导移除');
  assert.ok(!buildJs.includes('data-iso-add-deps'), '一键加入交互入口移除');
  assert.ok(buildJs.includes('data-docs-merge'), '文档合并动作入口存在');
  assert.ok(buildJs.includes('data-pf-push'), '推送远端动作入口存在');
  assert.ok(buildJs.includes('官网资料更新'), '官网资料更新动作语义存在');
  // 'link' 步骤键随合并入第一步清理（快照恢复归一除外）
  assert.ok(!/"link"\s*\]/.test(buildJs) && !/'link'\s*\]/.test(buildJs), '五步导航数组不再含 link');
});

t('L5-2 i18n 同步：五步新标签与文档合并 / 发布两动作 EN 词条齐备', () => {
  const I = globalThis.ATBI18N;
  const { EN } = I._dict;
  for (const zh of ['选择条目与提交', '挑选合并', '文档与翻译', '文档合并', '发布']) {
    assert.ok(zh in EN, `EN 词典应含「${zh}」`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN[zh]), `「${zh}」译文不含中文`);
  }
});

/* ---------- 执行 ---------- */

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n${e && e.stack ? e.stack : e}`);
  }
}
if (failed) {
  console.error(`\n${failed} 个用例失败`);
  process.exit(1);
}
console.log(`\n全部通过（${cases.length} 例）`);
