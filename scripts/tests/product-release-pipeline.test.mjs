#!/usr/bin/env node
// REQ-20260915-002 产品发布流水线（product-release-pipeline）测试 F1~F5
// 真实临时仓库 + bare 远端 + 静态 fixture，不访问外网。
// 用法：node scripts/tests/product-release-pipeline.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as buildStore from '../lib/build-store.mjs';
import * as prelGit from '../lib/product-release-git.mjs';
import * as store from '../lib/product-release-store.mjs';
import * as materials from '../lib/site-materials.mjs';
import {
  runProductPrecheck, runProductPipeline, collectCurrentInputs,
  refreezeProductRun, buildWebAppFromFrozen, stopProductDeploy,
} from '../lib/product-release-pipeline.mjs';

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
const exec = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { cwd: opts.cwd, encoding: 'utf8', env: GIT_ENV, timeout: opts.timeoutMs || 60000 });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
};
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV, timeout: 30000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr}`);
  return String(r.stdout).trim();
};

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const fetchRes = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => {
    let s = '';
    res.on('data', (c) => { s += c; });
    res.on('end', () => resolve({ status: res.statusCode, body: s }));
  }).on('error', reject);
});

const VERSION = '1.2.0';

function commitFile(dir, file, content, msg) {
  fs.writeFileSync(path.join(dir, file), content);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', msg);
  return git(dir, 'rev-parse', 'HEAD');
}

// 场景装配：项目（静态 Web App fixture + dev 分支 + 已合并 BLD）+ bare 远端 + 官网仓库
async function setup({ sitePages = null } = {}) {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-prel-pipe-')));
  const proj = path.join(tmp, 'proj');
  const remote = path.join(tmp, 'remote.git');
  const homepage = path.join(tmp, 'homepage');
  fs.mkdirSync(proj);
  fs.mkdirSync(homepage);
  git(tmp, 'init', '--bare', '-b', 'main', remote);
  git(proj, 'init', '-b', 'main');
  git(proj, 'config', 'user.email', 't@e.co');
  git(proj, 'config', 'user.name', 'T');
  fs.writeFileSync(path.join(proj, 'a.txt'), 'a\n');
  git(proj, 'add', '-A');
  git(proj, 'commit', '-m', 'init');
  // 静态 Web App fixture（冻结源码根 index.html 携带版本标识）
  fs.writeFileSync(path.join(proj, 'index.html'), `<!doctype html><title>app</title><meta name="app-version" content="${VERSION}">hello app`);
  git(proj, 'add', '-A');
  git(proj, 'commit', '-m', 'feat: REQ-20260915-010 webapp');
  const itemCommit = git(proj, 'rev-parse', 'HEAD');
  // dev 分支
  git(proj, 'checkout', '-b', 'dev');
  commitFile(proj, 'dev.txt', 'd\n', 'dev work');
  git(proj, 'checkout', 'main');
  git(proj, 'remote', 'add', 'origin', remote);
  // 官网仓库（独立 git 仓库 + 双语内容）
  git(homepage, 'init', '-b', 'main');
  git(homepage, 'config', 'user.email', 't@e.co');
  git(homepage, 'config', 'user.name', 'T');
  const contentDir = path.join(homepage, 'proj');
  const writeSite = (pages) => {
    for (const lang of ['zh', 'en']) {
      fs.mkdirSync(path.join(contentDir, lang), { recursive: true });
      for (const page of ['index', 'usage', 'guide', 'changelog']) {
        const body = pages?.[`${lang}/${page}`];
        if (body === null) continue; // null = 刻意缺失
        fs.writeFileSync(path.join(contentDir, lang, `${page}.html`),
          body ?? `<!doctype html><html lang="${lang}"><meta name="site-version" content="${VERSION}"><a href="#" data-webapp-entry>App</a><a href="#" data-lang-switch>切换</a>${page}-${lang}`);
      }
    }
    git(homepage, 'add', '-A');
    git(homepage, 'commit', '-m', 'site content');
  };
  writeSite(sitePages);
  // 看板数据目录 + 模块配置（官网仓库根目录）
  core.initData(proj);
  const dataDir = path.join(proj, 'docs', 'agent-team-board');
  fs.mkdirSync(path.join(dataDir, 'releases'), { recursive: true });
  core.writeJsonAtomic(path.join(dataDir, 'releases', 'config.json'), { homepageRepoRoot: homepage });
  // 已合并 BLD
  const v = buildStore.createVersion(dataDir, {
    name: '版本 V1', items: [{ itemId: 'REQ-20260915-010', commit: itemCommit, title: 'webapp' }],
  });
  buildStore.beginMerge(dataDir, v.id);
  const mainSha0 = git(proj, 'rev-parse', 'main');
  buildStore.finishMerge(dataDir, v.id, { results: [{ itemId: 'REQ-20260915-010', ok: true }], mainSha: mainSha0 });
  // 创建 PREL（冻结）
  const run = await createFromFacts(dataDir, proj, homepage, v, 'proj');
  return { tmp, proj, remote, homepage, contentDir, dataDir, run, itemCommit, writeSite };
}

async function createFromFacts(dataDir, proj, homepage, bld, productId) {
  const remoteInfo = await prelGit.resolveSourceRemote(proj, exec);
  const freeze = {
    mainSha: git(proj, 'rev-parse', 'main'),
    devSha: git(proj, 'rev-parse', 'dev'),
    remote: remoteInfo.remote,
    remoteUrl: remoteInfo.sanitizedUrl,
    extraCommits: await prelGit.collectExtraCommits(proj, exec, {
      mainSha: git(proj, 'rev-parse', 'main'), itemCommits: bld.items.map((x) => x.commit), bldId: bld.id,
    }),
    homepage: { repoRoot: homepage, branch: 'main', contentDir: materials.safeContentDir(homepage, productId) },
  };
  return store.createProductRun(dataDir, {
    productId, bld: buildStore.readVersion(dataDir, bld.id), freeze, version: VERSION, versionName: bld.name, by: 'board',
  });
}

t('F1 全链路成功：原子推送双分支 → Web App 部署回验 → 官网双语回验 → succeeded', async () => {
  const s = await setup();
  try {
    const pre = await runProductPrecheck({ dataDir: s.dataDir, projectRoot: s.proj, runId: s.run.id, exec });
    assert.equal(pre.precheck.ok, true, JSON.stringify(pre.precheck.checks));
    const inputs = await collectCurrentInputs({ dataDir: s.dataDir, projectRoot: s.proj, run: pre, exec });
    store.assertPrecheckFresh(pre, inputs);
    const done = await runProductPipeline({ dataDir: s.dataDir, projectRoot: s.proj, runId: s.run.id, exec });
    assert.equal(done.status, 'succeeded', JSON.stringify(done.stages.map((x) => [x.key, x.status, x.error])));
    // 远端双分支等于冻结值
    const ls = git(s.tmp, 'ls-remote', s.remote);
    assert.ok(ls.includes(done.frozen.mainSha), '远端 main === 冻结');
    assert.ok(ls.includes(done.frozen.devSha), '远端 dev === 冻结');
    // 工作目录保持在 main
    assert.equal(git(s.proj, 'branch', '--show-current'), 'main');
    // 两目标 done 且本机入口可访问
    assert.equal(done.targets.webapp.status, 'done');
    assert.equal(done.targets.site.status, 'done');
    const wa = await fetchRes(`${done.targets.webapp.localUrl}/`);
    assert.equal(wa.status, 200);
    assert.ok(wa.body.includes(VERSION));
    const zh = await fetchRes(`${done.targets.site.localUrl}/zh/index.html`);
    assert.equal(zh.status, 200);
    const en = await fetchRes(`${done.targets.site.localUrl}/en/index.html`);
    assert.equal(en.status, 200);
    // 构建来自冻结 main 源码；推送与双目标回验留有证据
    assert.equal(done.webapp.build.sourceSha, done.frozen.mainSha);
    assert.ok(done.evidence.some((e) => e.kind === 'sync-source' && /核验一致/.test(e.note)), '推送核验证据');
    assert.ok(done.evidence.some((e) => e.kind === 'webapp-verify'));
    assert.ok(done.evidence.some((e) => e.kind === 'site-verify'));
  } finally {
    stopProductDeploy(s.run.id);
  }
});

t('F2 官网回验失败 → 部分上线：webapp 保留 done；修复后 retry 只补官网阶段', async () => {
  const s = await setup({
    sitePages: { 'en/index': `<!doctype html><html lang="en"><meta name="site-version" content="${VERSION}"><a href="#" data-lang-switch>Switch</a>index-en（缺 Web App 入口）` },
  });
  try {
    const pre = await runProductPrecheck({ dataDir: s.dataDir, projectRoot: s.proj, runId: s.run.id, exec });
    assert.equal(pre.precheck.ok, true, '材料齐全（语义问题不进预检指纹）');
    const failed = await runProductPipeline({ dataDir: s.dataDir, projectRoot: s.proj, runId: s.run.id, exec });
    assert.equal(failed.status, 'failed');
    assert.equal(failed.targets.webapp.status, 'done', 'Web App 已上线事实保留');
    assert.equal(failed.targets.site.status, 'failed');
    const failedStage = failed.stages.find((x) => x.status === 'failed');
    assert.equal(failedStage.key, 'site-verify');
    // 修复英文页（补 Web App 入口）→ retry 只补未完成阶段
    fs.writeFileSync(path.join(s.contentDir, 'en/index.html'),
      `<!doctype html><html lang="en"><meta name="site-version" content="${VERSION}"><a href="#" data-webapp-entry>App</a><a href="#" data-lang-switch>Switch</a>index-en fixed`);
    const r2 = store.mutateProductRun(s.dataDir, s.run.id, (r) => store.resetForRetry(r), { action: 'retry' });
    assert.equal(r2.stages.find((x) => x.key === 'sync-source').status, 'done', '已完成阶段不重跑');
    const done = await runProductPipeline({ dataDir: s.dataDir, projectRoot: s.proj, runId: s.run.id, exec });
    assert.equal(done.status, 'succeeded');
    assert.equal(done.targets.webapp.status, 'done');
    assert.equal(done.targets.site.status, 'done');
  } finally {
    stopProductDeploy(s.run.id);
  }
});

t('F3 main 前进 → 启动被 stale 阻塞并指明变化；refreeze 后可启动', async () => {
  const s = await setup();
  try {
    const pre = await runProductPrecheck({ dataDir: s.dataDir, projectRoot: s.proj, runId: s.run.id, exec });
    // initData 后工作区在 dev（项目工作流口径）；让 main 前进需显式在 main 上提交
    git(s.proj, 'checkout', 'main');
    commitFile(s.proj, 'later.txt', 'l\n', 'chore: main advanced');
    const inputs = await collectCurrentInputs({ dataDir: s.dataDir, projectRoot: s.proj, run: pre, exec });
    assert.throws(() => store.assertPrecheckFresh(pre, inputs), (e) => /main 分支头/.test(e.message));
    // 重新冻结（用当前 main，不冒充旧 SHA）
    const rf = await refreezeProductRun({ dataDir: s.dataDir, projectRoot: s.proj, runId: s.run.id, exec });
    assert.equal(rf.frozen.mainSha, git(s.proj, 'rev-parse', 'main'));
    const pre2 = await runProductPrecheck({ dataDir: s.dataDir, projectRoot: s.proj, runId: s.run.id, exec });
    assert.equal(pre2.precheck.ok, true);
    const done = await runProductPipeline({ dataDir: s.dataDir, projectRoot: s.proj, runId: s.run.id, exec });
    assert.equal(done.status, 'succeeded');
  } finally {
    stopProductDeploy(s.run.id);
  }
});

t('F4 取消后续阶段：已执行阶段保留、未执行阶段 canceled、不误报完成', async () => {
  const s = await setup();
  try {
    // 包装 exec：原子推送完成后立即取消
    let pushed = false;
    let canceled = false;
    const wrapExec = (cmd, args, opts = {}) => {
      if (!canceled && pushed) {
        store.mutateProductRun(s.dataDir, s.run.id, (r) => store.cancelRemaining(r, '流水线中途取消'), { action: 'cancel' });
        canceled = true;
      }
      if (cmd === 'git' && args.includes('push')) pushed = true;
      return exec(cmd, args, opts);
    };
    const done = await runProductPipeline({ dataDir: s.dataDir, projectRoot: s.proj, runId: s.run.id, exec: wrapExec });
    assert.equal(done.status, 'canceled');
    assert.equal(done.stages.find((x) => x.key === 'sync-source').status, 'done');
    assert.ok(done.stages.slice(1).every((x) => x.status === 'canceled'));
    assert.equal(done.targets.webapp.status, 'canceled', '未执行的目标不得标完成');
  } finally {
    stopProductDeploy(s.run.id);
  }
});

t('F5 构建基于冻结 main 源码：main 前进后仍从冻结 SHA 构建部署', async () => {
  const s = await setup();
  const frozenSha = s.run.frozen.mainSha;
  commitFile(s.proj, 'index.html', `<!doctype html><title>app</title><meta name="app-version" content="9.9.9">newer`, 'chore: newer page');
  const built = await buildWebAppFromFrozen({ dataDir: s.dataDir, projectRoot: s.proj, runId: s.run.id, mainSha: frozenSha, exec });
  assert.equal(built.sourceSha, frozenSha);
  const index = fs.readFileSync(path.join(built.deployDir, 'index.html'), 'utf8');
  assert.ok(index.includes('1.2.0'), '产物来自冻结源码（非执行时最新 main）');
  assert.ok(!index.includes('9.9.9'));
  fs.rmSync(built.deployDir, { recursive: true, force: true });
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
console.log(`product-release-pipeline：${cases.length - failed}/${cases.length} 通过`);
process.exit(failed ? 1 : 0);
