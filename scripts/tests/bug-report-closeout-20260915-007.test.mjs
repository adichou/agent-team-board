// BUG-20260915-007：无 run 的手动 report 上报后系统收口提交——与批量 run receipt 同口径。
// 覆盖验收：自动提交（claim 快照归因）、幂等（重复 report 不重复提交）、提交失败挂起
// （不阻断上报、走待人工确认闭环）、认领受阻例外分支（status → in-progress 快照兜底）、
// 非 git 项目跳过（不报错、不伪造提交）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as core from '../lib/core.mjs';

const atb = new URL('../atb.mjs', import.meta.url).pathname;

function mkProject(prefix) {
  // realpathSync 对齐 macOS 临时目录符号链接（/var → /private/var）：git --show-toplevel
  // 返回真实路径，projectRoot 必须同源，否则看板相对前缀归因失效（既有测试同口径）。
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const exec = (cmd, args) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8', timeout: 60_000 });
  const run = (...args) => {
    const r = exec(process.execPath, [atb, ...args, '--dir', root]);
    assert.equal(r.status, 0, `atb ${args.join(' ')} 失败\n${r.stderr}${r.stdout}`);
    return `${r.stdout}${r.stderr}`.trim();
  };
  const git = (...args) => {
    const r = exec('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', ...args]);
    assert.equal(r.status, 0, `git ${args.join(' ')} 失败\n${r.stderr}${r.stdout}`);
    return String(r.stdout).trim();
  };
  const tryRun = (...args) => exec(process.execPath, [atb, ...args, '--dir', root]);
  return { root, exec, run, git, tryRun };
}

function seedPlannedBug(p, title) {
  core.initData(p.root);
  const data = core.dataDirFrom(p.root);
  const item = core.createItem(data, { type: 'bug', title });
  core.setStatus(data, item.id, 'accepted', { by: 'fixture-human' });
  core.setStatus(data, item.id, 'planned', { by: 'fixture-human' });
  return { data, item };
}

const write = (root, rel, text) => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
};

try {
  // ---------- 场景 A：claim → 开发 → report（无 run）→ 系统自动提交 doc/test/业务 ----------
  const a = mkProject('atb-rc-a-');
  {
    const { data, item } = seedPlannedBug(a, '手动收口自动提交');
    const itemRel = path.relative(a.root, core.resolveItemDir(data, item.id).dir);
    a.git('add', '.');
    a.git('commit', '-qm', 'fixture 基线');
    write(a.root, 'other-task.txt', '其他任务改动'); // 认领前已脏：不得卷入本单提交
    a.run('claim', item.id, '--by', 'w1');
    write(a.root, 'src/fix.js', '本单实现');
    write(a.root, 'scripts/tests/fix.test.mjs', '本单测试');
    const out = a.run('report', item.id, '--framework', 'node:test', '--summary', '通过', '--by', 'w1');
    assert.match(out, /系统收口提交 3 组/, 'report 输出应说明系统收口提交分组');

    const log = a.git('log', '--format=%s');
    for (const t of ['doc', 'test', 'fix']) {
      assert.match(log, new RegExp(`^${t}: 手动收口自动提交 ${item.id}$`, 'm'), `${t} 组提交消息带单号`);
    }
    assert.equal(a.git('status', '--porcelain', '--', 'src', 'scripts/tests', itemRel), '', '本单代码/测试/条目文档全部入库');
    assert.match(a.git('status', '--porcelain', '--', 'other-task.txt'), /other-task\.txt/, '其他任务改动保留');
    assert.equal(a.git('remote'), '', '只 commit 不 push（无远端）');

    // 手动收口 run 记录（dispatch/runs/manual-<ID>/）与提交索引
    const rec = JSON.parse(fs.readFileSync(path.join(data, 'dispatch', 'runs', `manual-${item.id}`, 'run.json'), 'utf8'));
    assert.equal(rec.itemId, item.id);
    assert.equal(rec.phase, 'reported');
    assert.equal(rec.autoCommit.status, 'committed');
    assert.ok(rec.treeSnapshot && rec.treeSnapshot.entries, '认领时快照作为归因基线');
    const commitLog = a.run('commit', 'log', item.id);
    assert.match(commitLog, /3 个/, 'atb commit log 可查本单全部提交');

    // ---------- 场景 B：重复 report 幂等——只补交报告状态变动，不重复提交代码/测试 ----------
    const head1 = a.git('rev-parse', 'HEAD');
    a.run('report', item.id, '--framework', 'node:test', '--summary', '复验仍通过', '--by', 'w1');
    const head2 = a.git('rev-parse', 'HEAD');
    assert.notEqual(head1, head2, '报告状态更新应补交（后续报告仍需补交）');
    assert.equal(a.git('rev-list', '--count', `${head1}..${head2}`), '1', '仅新增一个 doc 补交提交');
    assert.match(a.git('log', '--format=%s', '-1'), new RegExp(`^doc: 手动收口自动提交 ${item.id}$`));
    assert.equal(a.git('log', '--oneline', '--', 'src/fix.js').split('\n').length, 1, '实现不重复提交');
    assert.equal(a.git('log', '--oneline', '--', 'scripts/tests/fix.test.mjs').split('\n').length, 1, '测试不重复提交');
    assert.equal(a.git('status', '--porcelain', '--', 'src', 'scripts/tests'), '', '本单代码测试保持入库');
  }

  // ---------- 场景 C：提交失败不静默——挂起待人工确认，上报不受阻断 ----------
  const c = mkProject('atb-rc-c-');
  {
    const { data, item } = seedPlannedBug(c, '失败挂起验证');
    c.git('add', '.');
    c.git('commit', '-qm', 'fixture 基线');
    fs.mkdirSync(path.join(c.root, '.githooks'));
    fs.writeFileSync(path.join(c.root, '.githooks', 'pre-commit'), '#!/bin/sh\nexit 1\n');
    fs.chmodSync(path.join(c.root, '.githooks', 'pre-commit'), 0o755);
    c.git('config', 'core.hooksPath', '.githooks');
    c.run('claim', item.id, '--by', 'w1');
    write(c.root, 'src/fix.js', '本单实现');
    const out = c.run('report', item.id, '--framework', 'node:test', '--summary', '通过', '--by', 'w1');
    assert.match(out, /待人工确认/, '失败不静默：提示待人工确认');
    const st = core.readStatus(core.resolveItemDir(data, item.id).dir);
    assert.equal(st.status, 'in-progress', '上报不受阻断，条目仍进入待测试');
    assert.ok(st.agentCompletedAt, '本轮上报时间已落账');

    const runRec = JSON.parse(fs.readFileSync(path.join(data, 'dispatch', 'runs', `manual-${item.id}`, 'run.json'), 'utf8'));
    assert.equal(runRec.autoCommit.status, 'failed', '自动提交失败如实落账');
    const confirms = JSON.parse(fs.readFileSync(path.join(data, 'confirms', 'confirms.json'), 'utf8'));
    const rec = confirms.items[item.id];
    assert.ok(rec, '挂起确认已登记');
    assert.equal(rec.kind, 'develop');
    assert.equal(rec.state, 'waiting');
    assert.equal(rec.blockType, 'commit');
    assert.equal(rec.runId, `manual-${item.id}`);
    assert.match(rec.reason, /自动提交失败/, '挂起原因指向提交失败');
    assert.match(c.git('status', '--porcelain', '--', 'src/fix.js'), /fix\.js/, '失败改动保留在工作区可重试');
    const blocked = c.tryRun('claim', item.id, '--by', 'w2');
    assert.notEqual(blocked.status, 0, '挂起期间不得继续认领');
  }

  // ---------- 场景 D：认领受阻例外分支（status → in-progress，无 claim）同样收口 ----------
  const d = mkProject('atb-rc-d-');
  {
    const { data, item } = seedPlannedBug(d, '例外分支收口');
    d.git('add', '.');
    d.git('commit', '-qm', 'fixture 基线');
    write(d.root, 'other-task.txt', '其他任务改动');
    d.run('status', item.id, 'in-progress'); // 例外授权：无 claim 直接进入开发
    write(d.root, 'src/fix.js', '例外分支实现');
    d.run('report', item.id, '--framework', 'node:test', '--summary', '例外收口通过', '--by', 'w1');
    assert.match(d.git('log', '--format=%s'), new RegExp(`^fix: 例外分支收口 ${item.id}$`, 'm'), '例外分支同样系统收口提交');
    assert.equal(d.git('status', '--porcelain', '--', 'src'), '', '本单实现入库');
    assert.match(d.git('status', '--porcelain', '--', 'other-task.txt'), /other-task\.txt/, '其他任务改动保留');
    const rec = JSON.parse(fs.readFileSync(path.join(data, 'dispatch', 'runs', `manual-${item.id}`, 'run.json'), 'utf8'));
    assert.equal(rec.autoCommit.status, 'committed');
  }

  // ---------- 场景 E：非 git 项目——report 正常完成，跳过收口不报错 ----------
  const e = mkProject('atb-rc-e-');
  {
    const { data, item } = seedPlannedBug(e, '非 git 跳过');
    fs.rmSync(path.join(e.root, '.git'), { recursive: true, force: true });
    e.run('claim', item.id, '--by', 'w1');
    write(e.root, 'src/fix.js', '本单实现');
    const out = e.run('report', item.id, '--framework', 'node:test', '--summary', '通过', '--by', 'w1');
    assert.match(out, /不是 git 仓库/, '非 git 项目按既有口径跳过并说明');
    assert.ok(!fs.existsSync(path.join(data, 'confirms', 'confirms.json')), '非 git 跳过不产生挂起');
    const st = core.readStatus(core.resolveItemDir(data, item.id).dir);
    assert.equal(st.status, 'in-progress', '非 git 项目上报照常完成');
  }

  console.log('✓ BUG-20260915-007：无 run 手动 report 系统收口提交、幂等补交、失败挂起、例外分支、非 git 跳过');
} finally {
  for (const dir of fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('atb-rc-'))) {
    try { fs.rmSync(path.join(os.tmpdir(), dir), { recursive: true, force: true }); } catch { /* 并发清理容忍 */ }
  }
}
