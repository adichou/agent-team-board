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

// 全链路执行（源码项目工作区位于 dev）：预检 → 计划 → 启动，返回最终 run 与冻结值。
async function runThrough(name, version) {
  const fx = makeProject(root, name);
  assert.equal(git(fx.project, 'branch', '--show-current'), 'dev', '夹具源码项目应从 dev 出发');
  const v = makeVersion(fx, { itemId: 'BUG-20260928-014' });
  const run = await publish.create(fx.db, fx.project, v, version);
  const checked = await publish.precheck(fx.db, fx.project, run.id);
  assert.equal(checked.precheck.ok, true, JSON.stringify(checked.precheck.checks));
  const plan = await publish.plan(fx.db, fx.project, run.id);
  const result = await publish.start(fx.db, fx.project, run.id, plan.token);
  await result.completion;
  return { fx, plan, run, done: store.readRun(fx.db, run.id) };
}

test('P1 从 dev 发布全链路成功：全程不切分支（分支与 HEAD 均不变），推送 / 远端回验口径不变', async () => {
  store.saveConfig(makeSite('p1'));
  const { fx, plan, run, done } = await runThrough('p1', '1.0');
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  assert.equal(done.targets.webapp.status, 'done');
  assert.equal(done.targets.site.status, 'done');
  assert.ok(!/切换源码/.test(plan.steps[0]), `计划文案不应再宣称切换源码分支：${plan.steps[0]}`);
  assert.match(plan.steps[0], /原子推送/);
  assert.match(plan.steps[0], /不切换工作区分支/);
  // 发布结束后工作区仍在 dev（原实现 checkout main 后不切回，此处即本 Bug 的核心断言）
  assert.equal(git(fx.project, 'branch', '--show-current'), 'dev', '发布结束后工作区仍在 dev');
  const devHead = git(fx.project, 'rev-parse', 'refs/heads/dev');
  assert.equal(git(fx.project, 'rev-parse', 'HEAD'), devHead, '发布全程 HEAD 未被移动');
  // 推送与远端回验口径不变：bare 远端两分支 SHA = 冻结值
  assert.equal(git(path.join(root, 'remote-p1.git'), 'rev-parse', 'main'), run.frozen.mainSha);
  assert.equal(git(path.join(root, 'remote-p1.git'), 'rev-parse', 'dev'), run.frozen.devSha);
});

test('N1 本地 main 与冻结 SHA 不一致 → sync-source 以只读 ref 比对拦截，且不切分支', async () => {
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
  const result = await publish.start(fx.db, fx.project, run.id, plan.token);
  await result.completion;
  const done = store.readRun(fx.db, run.id);
  assert.equal(done.status, 'failed');
  assert.equal(done.error.stage, 'sync-source');
  assert.match(done.error.message, /main 与冻结源码不一致/);
  assert.equal(git(fx.project, 'branch', '--show-current'), 'dev', '拦截时同样不切换工作区分支');
  assert.equal(git(fx.project, 'rev-parse', 'HEAD'), headBefore, '拦截后 HEAD 未被移动');
  // 未通过本地一致性校验 → 不推送：远端（夹具初始无任何 ref）不应出现 main / dev
  assert.equal(git(path.join(root, 'remote-n1.git'), 'for-each-ref', '--format=%(refname)'), '', '未通过校验不应推送');
});

test('N2 site-deploy 中途失败（产品未注册）→ 发布失败后工作区仍在 dev（复现 BPUB-711ea71f 场景）', async () => {
  store.saveConfig(makeSite('registered-elsewhere'));
  const { fx, run, done } = await runThrough('n2', '1.0'); // 产品 id = 项目目录名 n2，site 未注册 n2
  assert.equal(done.status, 'failed');
  assert.equal(done.error.stage, 'site-deploy');
  assert.match(done.error.message, /apps\.js/);
  assert.equal(git(fx.project, 'branch', '--show-current'), 'dev', '中途失败后工作区仍在 dev');
  // 失败前 sync-source 已完成：推送仍到位（远端 = 冻结值），证明推送不依赖本地检出 main
  assert.equal(git(path.join(root, 'remote-n2.git'), 'rev-parse', 'main'), run.frozen.mainSha);
  assert.equal(git(path.join(root, 'remote-n2.git'), 'rev-parse', 'dev'), run.frozen.devSha);
});

for (const [name, fn] of cases) {
  await fn();
  console.log(`PASS ${name}`);
}
publish.stopServers(); // 回验本机服务不关会挂住事件循环，进程无法退出
fs.rmSync(root, { recursive: true, force: true });
