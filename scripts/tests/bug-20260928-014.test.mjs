#!/usr/bin/env node
// BUG-20260928-014 发布执行不应切换工作区到 main 分支：sync-source 去掉 `git checkout main`，
// 本地一致性校验改为只读 ref 比对（`git rev-parse refs/heads/main` === 冻结 mainSha，错误信息
// 不变），原子推送（显式 SHA refspec）与 ls-remote 远端回验口径不变；发布全程及结束后工作区
// 分支与 HEAD 不变（dev 上发布则仍在 dev）。引入来源：BUG-20260916-001（构建发布执行器）。
// 用法：node scripts/tests/bug-20260928-014.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as store from '../lib/build-publish-store.mjs';
import * as publish from '../lib/build-publish.mjs';
import { git, makeProject, makeVersion } from './lib/build-publish-fixture.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-bug-20260928-014-'));
process.env.ATB_BUILD_PUBLISH_CONFIG = path.join(root, 'global.json');

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

// 最小官网仓库夹具：src/data/apps.js 注册 + npm run build 产出模拟 dist（壳引用 assets、
// assets 内联产品注册串——site-verify 的 SPA / 注册回验契约）。register=false 或 id 与源码
// 项目目录名不同 → site-deploy 阶段失败（复现发布中途失败场景）。
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

// 全链路执行（源码项目工作区位于 dev）：预检 → 计划 → 确认发布（REQ-20260929-002：确认即
// 终态 succeeded，无执行阶段），返回最终 run 与冻结值。
async function runThrough(name, version) {
  const fx = makeProject(root, name);
  assert.equal(git(fx.project, 'branch', '--show-current'), 'dev', '夹具源码项目应从 dev 出发');
  const v = makeVersion(fx, { itemId: 'BUG-20260928-014' });
  const run = await publish.create(fx.db, fx.project, v, version);
  const checked = await publish.precheck(fx.db, fx.project, run.id);
  assert.equal(checked.precheck.ok, true, JSON.stringify(checked.precheck.checks));
  const plan = await publish.plan(fx.db, fx.project, run.id);
  const { run: started } = await publish.start(fx.db, fx.project, run.id, plan.token);
  return { fx, plan, run, done: store.readRun(fx.db, run.id), started };
}

test('P1 从 dev 发布全链路成功：全程不切分支（REQ-20260929-002：确认即成功，无推送 / 执行阶段）', async () => {
  store.saveConfig(makeSite('p1'));
  const { fx, plan, done } = await runThrough('p1', '1.0');
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  assert.equal(done.targets, undefined, 'REQ-20260929-002：新发布不产生 targets 数据');
  assert.ok(!/切换源码|切换工作区/.test(plan.steps[0]), `计划文案不应再宣称切换源码分支：${plan.steps[0]}`);
  assert.equal(plan.steps.length, 1, '计划仅 1 条（更新版本计划状态）');
  // 发布结束后工作区仍在 dev（原实现 checkout main 后不切回，此处即本 Bug 的核心断言；
  // REQ-20260929-002 起发布不再有任何 git 操作，天然满足）
  assert.equal(git(fx.project, 'branch', '--show-current'), 'dev', '发布结束后工作区仍在 dev');
  const devHead = git(fx.project, 'rev-parse', 'refs/heads/dev');
  assert.equal(git(fx.project, 'rev-parse', 'HEAD'), devHead, '发布全程 HEAD 未被移动');
  // REQ-20260929-002：发布全程无 git push——bare 远端不出现任何 ref
  assert.equal(git(path.join(root, 'remote-p1.git'), 'for-each-ref', '--format=%(refname)'), '', '发布不推送远端');
});

test('N1 本地 main 与冻结 SHA 不一致 → 发布仍成功（REQ-20260929-002：无 sync-source 比对拦截，发布不推送远端）', async () => {
  store.saveConfig(makeSite('n1'));
  const fx = makeProject(root, 'n1');
  const headBefore = git(fx.project, 'rev-parse', 'HEAD');
  const v = makeVersion(fx, { itemId: 'BUG-20260928-014' });
  const run = await publish.create(fx.db, fx.project, v, '1.0');
  // 冻结后本地 main 前进（预检不再拦截 main 前进——BUG-20260928-011 D3 口径，交执行阶段暴露）
  git(fx.project, 'checkout', 'main');
  git(fx.project, '-c', 'user.name=T', '-c', 'user.email=t@e.c', 'commit', '--allow-empty', '-m', 'advance');
  git(fx.project, 'checkout', 'dev');
  const checked = await publish.precheck(fx.db, fx.project, run.id);
  assert.equal(checked.precheck.ok, true, JSON.stringify(checked.precheck.checks));
  const plan = await publish.plan(fx.db, fx.project, run.id);
  const { run: done } = await publish.start(fx.db, fx.project, run.id, plan.token);
  assert.equal(done.status, 'succeeded', '主分支前进不再拦截（一致性比对随执行阶段删除）');
  assert.equal(git(fx.project, 'branch', '--show-current'), 'dev', '发布全程不切换工作区分支');
  assert.equal(git(fx.project, 'rev-parse', 'HEAD'), headBefore, '发布后 HEAD 未被移动');
  // 发布不推送：远端（夹具初始无任何 ref）不应出现 main / dev
  assert.equal(git(path.join(root, 'remote-n1.git'), 'for-each-ref', '--format=%(refname)'), '', '发布不推送远端');
});

test('N2 官网未注册产品 → 发布仍成功（REQ-20260929-002：site-deploy 已删，官网形态与发布解耦）', async () => {
  store.saveConfig(makeSite('registered-elsewhere'));
  const { fx, done } = await runThrough('n2', '1.0'); // 产品 id = 项目目录名 n2，site 未注册 n2
  assert.equal(done.status, 'succeeded', '官网未注册不再使发布失败');
  assert.equal(git(fx.project, 'branch', '--show-current'), 'dev', '发布后工作区仍在 dev');
  assert.equal(git(path.join(root, 'remote-n2.git'), 'for-each-ref', '--format=%(refname)'), '', '发布全程不推送远端');
});

for (const [name, fn] of cases) {
  await fn();
  console.log(`PASS ${name}`);
}
fs.rmSync(root, { recursive: true, force: true });
