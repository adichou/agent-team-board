#!/usr/bin/env node
// BUG-20260929-003 发布模块硬编码 main 分支：master 主干项目（本地无 main）「创建发布」
// 即抛 `git rev-parse 失败：fatal: ambiguous argument 'refs/heads/main'`。修复：build-publish
// 接入 git-flow 的 resolveMainBranch()——冻结 mainSha / 文档合并核验 / 条目包含性核验 /
// sync-source 一致性比对 / 推送 refspec 与远端回验统一按解析出的主分支名（main→master
// 回退）取用；resolveMainBranch() 返回 null 时回退 refs/heads/main 维持既有报错路径。
// 引入来源：BUG-20260916-001（构建发布执行器 build-publish.mjs 自诞生起硬编码 refs/heads/main）。
// 用法：node scripts/tests/bug-20260929-003.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as store from '../lib/build-publish-store.mjs';
import * as publish from '../lib/build-publish.mjs';
import { git, makeProject, makeVersion } from './lib/build-publish-fixture.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-bug-20260929-003-'));
process.env.ATB_BUILD_PUBLISH_CONFIG = path.join(root, 'global.json');

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

// 最小官网仓库夹具（与 bug-20260928-014 同构）：官网仓库必须仍有 main 分支（产品口径，
// validateRepo 不随本单放宽）。
function makeSite(id) {
  const repo = path.join(root, `site-${id}`);
  fs.mkdirSync(path.join(repo, 'src', 'data'), { recursive: true });
  git(repo, 'init', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'site', private: true, scripts: { build: 'node build.mjs' } }));
  fs.writeFileSync(path.join(repo, 'src', 'data', 'apps.js'), `export const apps = [{ id: '${id}' }]\n`);
  fs.writeFileSync(path.join(repo, 'build.mjs'), [
    "import fs from 'node:fs';",
    "fs.mkdirSync('dist/assets',{recursive:true});",
    "fs.writeFileSync('dist/index.html','<!doctype html><html lang=\"zh-CN\"><head><script type=\"module\" src=\"/assets/app.js\"></script></head><body><div id=\"app\"></div><a href=\"https://example.com/external\">external</a></body></html>');",
    `fs.writeFileSync('dist/assets/app.js',${JSON.stringify(`id:"${id}"`)});`,
  ].join('\n'));
  git(repo, 'add', '.');
  git(repo, '-c', 'user.name=T', '-c', 'user.email=t@e.c', 'commit', '-m', 'site');
  return repo;
}

// master 主干项目夹具：在 makeProject 基础上把本地 main 改名为 master（REQ-20260916-005
// 口径：master 主干不补建 main），模拟 cili_search / DarlingHelper 形态。
function makeMasterProject(name) {
  const fx = makeProject(root, name);
  git(fx.project, 'branch', '-m', 'main', 'master');
  return fx;
}

const hasBranch = (repo, ref) => {
  try { git(repo, 'rev-parse', '--verify', '--quiet', ref); return true; } catch { return false; }
};

test('P1 master 主干项目全链路发布成功：冻结 / 预检 / 计划 / 确认发布按 master 冻结口径，不推送远端', async () => {
  store.saveConfig(makeSite('p1'));
  const fx = makeMasterProject('p1');
  assert.equal(git(fx.project, 'branch', '--show-current'), 'dev', '夹具源码项目应从 dev 出发');
  assert.ok(!hasBranch(fx.project, 'refs/heads/main'), '夹具本地不应有 main 分支');
  const masterHead = git(fx.project, 'rev-parse', 'refs/heads/master');
  const v = makeVersion(fx, { itemId: 'BUG-20260929-003' });
  // 修复前：create() → inputs() 无捕获 rev-parse refs/heads/main，即抛 git rev-parse 失败（本 Bug 现场）
  const run = await publish.create(fx.db, fx.project, v, '1.0');
  assert.equal(run.frozen.mainBranch, 'master');
  assert.equal(run.frozen.mainSha, masterHead, '冻结 mainSha 应为 master 头（语义为主分支头）');
  const checked = await publish.precheck(fx.db, fx.project, run.id);
  assert.equal(checked.precheck.ok, true, JSON.stringify(checked.precheck.checks));
  const plan = await publish.plan(fx.db, fx.project, run.id);
  // REQ-20260929-002：计划仅 1 条（更新版本计划状态），无按分支名的推送 / 构建步骤
  assert.equal(plan.steps.length, 1);
  assert.ok(!/master|main|原子推送/.test(plan.steps[0]), `计划不应再含分支推送文案：${plan.steps[0]}`);
  const { run: started } = await publish.start(fx.db, fx.project, run.id, plan.token);
  const done = store.readRun(fx.db, run.id);
  assert.equal(started.status, 'succeeded', JSON.stringify(done));
  assert.equal(done.targets, undefined, 'REQ-20260929-002：新发布不产生 targets 数据');
  // 发布全程不推送：远端不出现任何分支（含 master / dev / main）
  const remote = path.join(root, 'remote-p1.git');
  assert.equal(git(remote, 'for-each-ref', '--format=%(refname)'), '', 'REQ-20260929-002：发布不推送远端');
  // 全程不切分支（BUG-20260928-014 口径回归）
  assert.equal(git(fx.project, 'branch', '--show-current'), 'dev', '发布结束后工作区仍在 dev');
  assert.equal(git(fx.project, 'rev-parse', 'HEAD'), git(fx.project, 'rev-parse', 'refs/heads/dev'), '发布全程 HEAD 未被移动');
});

test('P2 既有 main 项目行为不变：冻结记录 mainBranch=main、mainSha=rev-parse refs/heads/main', async () => {
  const fx = makeProject(root, 'p2');
  const v = makeVersion(fx, { itemId: 'BUG-20260929-003' });
  const run = await publish.create(fx.db, fx.project, v, '1.0');
  assert.equal(run.frozen.mainBranch, 'main');
  assert.equal(run.frozen.mainSha, git(fx.project, 'rev-parse', 'refs/heads/main'));
});

test('N1 master 项目冻结后 master 前进 → 发布仍成功（REQ-20260929-002：无 sync-source，不比对 / 不推送远端）', async () => {
  store.saveConfig(makeSite('n1'));
  const fx = makeMasterProject('n1');
  const headBefore = git(fx.project, 'rev-parse', 'HEAD');
  const v = makeVersion(fx, { itemId: 'BUG-20260929-003' });
  const run = await publish.create(fx.db, fx.project, v, '1.0');
  // 冻结后本地 master 前进：发布不再推送 / 比对远端（执行阶段已删），发布仍成功
  git(fx.project, 'checkout', 'master');
  git(fx.project, '-c', 'user.name=T', '-c', 'user.email=t@e.c', 'commit', '--allow-empty', '-m', 'advance');
  git(fx.project, 'checkout', 'dev');
  const checked = await publish.precheck(fx.db, fx.project, run.id);
  assert.equal(checked.precheck.ok, true, JSON.stringify(checked.precheck.checks));
  const plan = await publish.plan(fx.db, fx.project, run.id);
  const { run: done } = await publish.start(fx.db, fx.project, run.id, plan.token);
  assert.equal(done.status, 'succeeded');
  assert.equal(git(fx.project, 'branch', '--show-current'), 'dev', '发布全程不切换工作区分支');
  assert.equal(git(fx.project, 'rev-parse', 'HEAD'), headBefore, '发布后 HEAD 未被移动');
  assert.equal(git(path.join(root, 'remote-n1.git'), 'for-each-ref', '--format=%(refname)'), '', '发布不推送远端');
});

test('N2 本地既无 main 也无 master → create 即抛既有 git rev-parse 失败报错路径', async () => {
  const fx = makeMasterProject('n2');
  git(fx.project, 'branch', '-D', 'master'); // 仅剩 dev：resolveMainBranch() 返回 null
  const v = makeVersion(fx, { itemId: 'BUG-20260929-003' });
  await assert.rejects(
    () => publish.create(fx.db, fx.project, v, '1.0'),
    (e) => /git rev-parse 失败/.test(e.message) && /refs\/heads\/main/.test(e.message),
    '无主分支基点时应维持修复前的 rev-parse refs/heads/main 报错路径',
  );
});

for (const [name, fn] of cases) {
  await fn();
  console.log(`PASS ${name}`);
}
fs.rmSync(root, { recursive: true, force: true });
