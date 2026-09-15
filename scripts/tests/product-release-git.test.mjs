#!/usr/bin/env node
// REQ-20260915-002 产品发布 Git 执行层（product-release-git）测试 B1~B7（真实临时仓库）
// 用法：node scripts/tests/product-release-git.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prelGit from '../lib/product-release-git.mjs';

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
const exec = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { cwd: opts.cwd, encoding: 'utf8', env: GIT_ENV, timeout: 30000 });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
};
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV, timeout: 30000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr}`);
  return String(r.stdout).trim();
};

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function mkProj(name) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `atb-prel-git-${name}-`)));
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 't@e.co');
  git(dir, 'config', 'user.name', 'T');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'init');
  return dir;
}

function commitFile(dir, file, content, msg) {
  fs.writeFileSync(path.join(dir, file), content);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', msg);
  return git(dir, 'rev-parse', 'HEAD');
}

t('B1 远端解析：origin 优先 / 唯一远端 / 多远端歧义 / 无远端', async () => {
  const none = mkProj('none');
  await assert.rejects(() => prelGit.resolveSourceRemote(none, exec), (e) => /远端/.test(e.message));

  const only = mkProj('only');
  git(only, 'remote', 'add', 'upstream', '/tmp/up.git');
  assert.equal((await prelGit.resolveSourceRemote(only, exec)).remote, 'upstream');

  const both = mkProj('both');
  git(both, 'remote', 'add', 'origin', '/tmp/o.git');
  git(both, 'remote', 'add', 'mirror', '/tmp/m.git');
  assert.equal((await prelGit.resolveSourceRemote(both, exec)).remote, 'origin');

  const amb = mkProj('amb');
  git(amb, 'remote', 'add', 'a1', '/tmp/1.git');
  git(amb, 'remote', 'add', 'a2', '/tmp/2.git');
  await assert.rejects(() => prelGit.resolveSourceRemote(amb, exec), (e) => /歧义|无法确定/.test(e.message) && /a1/.test(e.message) && /a2/.test(e.message));
});

t('B2 条目包含性核验：全在 main → ok；不在 main → 报错含条目号', async () => {
  const proj = mkProj('contain');
  const c1 = commitFile(proj, 'b.txt', 'b\n', 'feat: REQ-1');
  const mainSha = git(proj, 'rev-parse', 'main');
  const ok = await prelGit.verifyItemsOnMain(proj, exec, [{ itemId: 'REQ-1', commit: c1 }], mainSha);
  assert.equal(ok.ok, true);
  // 独立提交（不在 main 历史内）
  const orphan = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-prel-orphan-')));
  git(orphan, 'init', '-b', 'main');
  git(orphan, 'config', 'user.email', 't@e.co');
  git(orphan, 'config', 'user.name', 'T');
  fs.writeFileSync(path.join(orphan, 'x.txt'), 'x\n');
  git(orphan, 'add', '-A');
  git(orphan, 'commit', '-m', 'orphan');
  const orphanCommit = git(orphan, 'rev-parse', 'HEAD');
  const bad = await prelGit.verifyItemsOnMain(proj, exec, [{ itemId: 'REQ-2', commit: orphanCommit }], mainSha);
  assert.equal(bad.ok, false);
  assert.ok(bad.missing.includes('REQ-2'));
});

t('B3 额外提交：计划外直接提交计入、本 BLD 合并提交不计入、他 BLD 合并计入', async () => {
  const proj = mkProj('extra');
  // 条目提交（在独立分支上，基于 main 基线）
  git(proj, 'checkout', '-b', 'feat-a');
  const itemCommit = commitFile(proj, 'feat.txt', 'f\n', 'feat: A');
  git(proj, 'checkout', 'main');
  git(proj, 'merge', '--no-ff', '-m', 'build: V1 合并 REQ-1（BLD-20260915-001）', itemCommit);
  // 计划外直接提交到 main
  commitFile(proj, 'direct.txt', 'd\n', 'chore: direct to main');
  const mainSha = git(proj, 'rev-parse', 'main');
  const extras = await prelGit.collectExtraCommits(proj, exec, { mainSha, itemCommits: [itemCommit], bldId: 'BLD-20260915-001' });
  const subjects = extras.map((x) => x.subject);
  assert.ok(subjects.includes('chore: direct to main'), `计划外直接提交计入：${JSON.stringify(subjects)}`);
  assert.ok(!subjects.some((s) => s.includes('BLD-20260915-001')), '本 BLD 合并提交不计入');
  // 他 BLD 合并提交计入（如实展示合并带入的额外变更）
  git(proj, 'checkout', '-b', 'feat-b');
  const c2 = commitFile(proj, 'feat2.txt', 'f2\n', 'feat: B');
  git(proj, 'checkout', 'main');
  git(proj, 'merge', '--no-ff', '-m', 'build: V0 合并 REQ-0（BLD-20260915-000）', c2);
  const mainSha2 = git(proj, 'rev-parse', 'main');
  const extras2 = await prelGit.collectExtraCommits(proj, exec, { mainSha: mainSha2, itemCommits: [itemCommit], bldId: 'BLD-20260915-001' });
  assert.ok(extras2.map((x) => x.subject).some((s) => s.includes('BLD-20260915-000')));
});

t('B4 切 main 校验 HEAD：一致 → 通过；main 前进 → plan-stale 不冒充', async () => {
  const proj = mkProj('switch');
  git(proj, 'checkout', '-b', 'dev');
  const mainSha = git(proj, 'rev-parse', 'main');
  const r = await prelGit.switchMainVerifyHead(proj, exec, { expectedMainSha: mainSha });
  assert.equal(r.ok, true);
  assert.equal(git(proj, 'branch', '--show-current'), 'main');
  // main 前进
  commitFile(proj, 'new.txt', 'n\n', 'advance main');
  const advanced = git(proj, 'rev-parse', 'main');
  assert.notEqual(advanced, mainSha);
  await assert.rejects(
    () => prelGit.switchMainVerifyHead(proj, exec, { expectedMainSha: mainSha }),
    (e) => e.kind === 'plan-stale',
  );
});

t('B5 脏工作区 / dev 缺失 / 分支被占用 → 明确报错，不自动暂存丢弃强切', async () => {
  const proj = mkProj('dirty');
  const mainSha = git(proj, 'rev-parse', 'main');
  git(proj, 'checkout', '-b', 'dev');
  // 脏工作区（看板目录以外的改动）
  fs.writeFileSync(path.join(proj, 'dirty.txt'), 'dirty\n');
  await assert.rejects(
    () => prelGit.switchMainVerifyHead(proj, exec, { expectedMainSha: mainSha }),
    (e) => e.kind === 'dirty' && /dirty.txt/.test(e.message),
  );
  assert.equal(git(proj, 'status', '--porcelain').includes('?? dirty.txt'), true, '不自动暂存/丢弃');
  fs.rmSync(path.join(proj, 'dirty.txt'));
  // 看板数据目录的改动不阻塞（与 REL 口径一致）
  fs.mkdirSync(path.join(proj, 'docs/agent-team-board/runs'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'docs/agent-team-board/runs/x.json'), '{}');
  const r = await prelGit.switchMainVerifyHead(proj, exec, { expectedMainSha: mainSha });
  assert.equal(r.ok, true);
  // 分支被其他 worktree 占用（先切离 main 再让其他工作树占用 main）
  git(proj, 'checkout', 'dev');
  const wt = path.join(os.tmpdir(), `atb-prel-wt-${Date.now()}`);
  git(proj, 'worktree', 'add', wt, 'main');
  try {
    await assert.rejects(
      () => prelGit.switchMainVerifyHead(proj, exec, { expectedMainSha: mainSha }),
      (e) => e.kind === 'occupied' || e.kind === 'checkout-failed',
    );
  } finally {
    git(proj, 'worktree', 'remove', '--force', wt);
  }
});

t('B6 原子推送双分支 + ls-remote 核验；单分支不一致不算完成', async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-prel-push-')));
  const remote = path.join(tmp, 'remote.git');
  git(tmp, 'init', '--bare', '-b', 'main', remote);
  const proj = mkProj('push');
  git(proj, 'remote', 'add', 'origin', remote);
  git(proj, 'checkout', '-b', 'dev');
  commitFile(proj, 'd.txt', 'd\n', 'dev work');
  git(proj, 'checkout', 'main');
  const mainSha = git(proj, 'rev-parse', 'main');
  const devSha = git(proj, 'rev-parse', 'dev');
  await prelGit.atomicPushBranches(proj, exec, { remote: 'origin' });
  const v = await prelGit.verifyRemoteBranches(proj, exec, { remote: 'origin', mainSha, devSha });
  assert.equal(v.ok, true);
  // 远端 dev 前进（单分支不一致）
  const other = path.join(tmp, 'other');
  fs.mkdirSync(other);
  git(other, 'clone', remote, 'clone');
  const cl = path.join(other, 'clone');
  git(cl, 'config', 'user.email', 't@e.co');
  git(cl, 'config', 'user.name', 'T');
  git(cl, 'checkout', 'dev');
  fs.writeFileSync(path.join(cl, 'z.txt'), 'z\n');
  git(cl, 'add', '-A');
  git(cl, 'commit', '-m', 'remote dev advance');
  git(cl, 'push', 'origin', 'dev');
  await assert.rejects(
    () => prelGit.verifyRemoteBranches(proj, exec, { remote: 'origin', mainSha, devSha }),
    (e) => e.kind === 'verify-mismatch' && /dev/.test(e.message),
  );
});

t('B7 非快进拒绝：远端 main 领先 → 原子推送被拒，不 force 不回退两次推送', async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-prel-ff-')));
  const remote = path.join(tmp, 'remote.git');
  git(tmp, 'init', '--bare', '-b', 'main', remote);
  const proj = mkProj('ff');
  git(proj, 'remote', 'add', 'origin', remote);
  const mainSha = git(proj, 'rev-parse', 'main');
  git(proj, 'push', 'origin', 'main');
  // 远端领先
  const other = path.join(tmp, 'other');
  fs.mkdirSync(other);
  git(other, 'clone', remote, 'clone');
  const cl = path.join(other, 'clone');
  git(cl, 'config', 'user.email', 't@e.co');
  git(cl, 'config', 'user.name', 'T');
  fs.writeFileSync(path.join(cl, 'r.txt'), 'r\n');
  git(cl, 'add', '-A');
  git(cl, 'commit', '-m', 'remote ahead');
  git(cl, 'push', 'origin', 'main');
  git(proj, 'checkout', '-b', 'dev');
  await assert.rejects(
    () => prelGit.atomicPushBranches(proj, exec, { remote: 'origin' }),
    (e) => /推送被拒|non-fast-forward|rejected/i.test(e.message),
  );
  // 本地未强推：本地 main 仍在冻结值
  assert.equal(git(proj, 'rev-parse', 'main'), mainSha);
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
console.log(`product-release-git：${cases.length - failed}/${cases.length} 通过`);
process.exit(failed ? 1 : 0);
