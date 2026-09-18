#!/usr/bin/env node
// REQ-20260916-005 主分支解析回退（本地 main 不存在而 master 存在 → 以 master 为主分支）
// —— 真实临时 git 仓库（三类夹具：仅 master / main+master 并存 / 两者皆无 + main 回归）
// + product-release exec 注入 + 前端源码/载荷断言（设置页描述文案、build.js mainHint）。
// 用法：node scripts/tests/req-main-branch-fallback-20260916-005.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import '../web/i18n.js';
import * as gitFlow from '../lib/git-flow.mjs';
import * as buildGit from '../lib/build-git.mjs';
import * as buildStore from '../lib/build-store.mjs';
import * as prelGit from '../lib/product-release-git.mjs';
import {
  resolveMainBranchName,
  collectCurrentInputs,
} from '../lib/product-release-pipeline.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = path.join(pluginRoot, 'scripts', 'web');
const appSrc = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const i18nSrc = fs.readFileSync(path.join(webRoot, 'i18n.js'), 'utf8');
const buildJs = fs.readFileSync(path.join(webRoot, 'build.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'server.mjs'), 'utf8');

const I = globalThis.ATBI18N;
assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function git(root, args, opts = {}) {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
  if (!opts.canFail && r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r;
}

function mkTmp(prefix = 'atb-main-fb-') {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

// 异步 exec 包装（product-release 注入口径：与 release-git realExec 同形 {code,stdout,stderr}）
const realExec = async (bin, args, opts = {}) => {
  const r = spawnSync(bin, args, { cwd: opts.cwd, encoding: 'utf8', timeout: opts.timeoutMs || 30_000 });
  return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
};

const revOf = (root, ref) => git(root, ['rev-parse', ref]).stdout.trim();
const branchesOf = (root) => git(root, ['branch', '--format=%(refname:short)']).stdout.trim().split('\n').filter(Boolean);

function commit(root, file, msg) {
  fs.writeFileSync(path.join(root, file), `${msg}\n`);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', msg]);
  return revOf(root, 'HEAD');
}

// 夹具 1：仅 master（历史仓库，本单核心场景）
function mkMasterOnlyRepo() {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'master']);
  commit(root, 'a.md', 'chore: 历史首个提交');
  return root;
}

// 夹具 2：main + master 并存
function mkBothRepo() {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'master']);
  commit(root, 'a.md', 'chore: 历史首个提交');
  git(root, ['branch', 'main']);
  return root;
}

// 夹具 3：两者皆无（dev-only，与 BUG-20260914-003 同源形态）
function mkDevOnlyRepo() {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['switch', '-q', '-c', 'dev']); // 未出生分支改名：main 从未出生
  commit(root, 'a.md', 'chore: 首个提交');
  return root;
}

// 夹具 4：main 存在（常规仓库，回归基线）
function mkMainRepo() {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'main']);
  commit(root, 'a.md', 'chore: 首个提交');
  return root;
}

/* ---------- G 组：git-flow 主分支解析与初始化 ---------- */

t('G1 仅 master：resolveMainBranch=master；ensureDevWorkflow 创建 dev 且不补建 main', () => {
  const root = mkMasterOnlyRepo();
  assert.equal(gitFlow.resolveMainBranch(root), 'master', '仅 master 仓库应解析为 master');
  const r = gitFlow.ensureDevWorkflow(root);
  assert.equal(r.devCreated, true, '应创建 dev 分支');
  assert.equal(git(root, ['branch', '--show-current']).stdout.trim(), 'dev', '工作区应切到 dev');
  assert.equal(r.mainCreated, false, '回退场景不得补建 main');
  assert.ok(!branchesOf(root).includes('main'), 'git branch 列表不得出现新增 main');
  assert.ok(branchesOf(root).includes('master'), 'master 保持不动');
  // 幂等：再次 ensure 仍不补建
  const r2 = gitFlow.ensureDevWorkflow(root);
  assert.equal(r2.mainCreated, false);
  assert.ok(!branchesOf(root).includes('main'), '幂等：仍无 main');
});

t('G2 main+master 并存：resolveMainBranch=main（无回归）；gitBranchState 如实返回', () => {
  const root = mkBothRepo();
  assert.equal(gitFlow.resolveMainBranch(root), 'main', '并存时一律取 main');
  const st = gitFlow.gitBranchState(root);
  assert.equal(st.mainBranch, 'main');
  const r = gitFlow.ensureDevWorkflow(root);
  assert.equal(r.mainCreated, false, 'main 已存在：不补建');
  assert.ok(branchesOf(root).includes('master'), 'master 不被重命名/删除');
});

t('G3 两者皆无（dev-only）：resolveMainBranch=null；ensureMainBranch 维持根提交补建 main 口径', () => {
  const root = mkDevOnlyRepo();
  assert.equal(gitFlow.resolveMainBranch(root), null, '两者皆无 → null');
  const rootCommit = git(root, ['rev-list', '--max-parents=0', 'HEAD']).stdout.trim().split('\n')[0];
  const r = gitFlow.ensureDevWorkflow(root);
  assert.equal(r.mainCreated, true, 'BUG-20260914-003 口径：根提交补建 main');
  assert.equal(revOf(root, 'main'), rootCommit, '补建基点为根提交');
});

t('G3b main 存在（常规仓库）：解析与初始化行为无回归', () => {
  const root = mkMainRepo();
  assert.equal(gitFlow.resolveMainBranch(root), 'main');
  const before = revOf(root, 'main');
  const r = gitFlow.ensureDevWorkflow(root);
  assert.equal(r.mainCreated, false);
  assert.equal(revOf(root, 'main'), before, 'main 基点不动');
});

t('G4 gitBranchState：非仓库 mainBranch=null；master-only=master；dev-only=null', () => {
  const notRepo = mkTmp();
  assert.equal(gitFlow.gitBranchState(notRepo).mainBranch, null, '非 git 仓库 → null');
  const m = mkMasterOnlyRepo();
  assert.equal(gitFlow.gitBranchState(m).mainBranch, 'master');
  const d = mkDevOnlyRepo();
  assert.equal(gitFlow.gitBranchState(d).mainBranch, null, '两者皆无 → null');
});

/* ---------- B 组：build-git / build-store ---------- */

t('B1 仅 master：precheckMerge 通过；mergeCommitsIntoMain 以 master 为目标 --no-ff 合并且消息含版本与条目号', () => {
  const root = mkMasterOnlyRepo();
  git(root, ['switch', '-q', '-c', 'dev']);
  const c1 = commit(root, 'b.md', 'feat: 功能一 REQ-20260916-005');
  const masterBefore = revOf(root, 'master');
  assert.equal(buildGit.precheckMerge(root, [{ itemId: 'REQ-20260916-005', commit: c1 }]), 'dev',
    'master-only 仓库合并前置校验应通过（不再报 main 分支不存在）');
  const r = buildGit.mergeCommitsIntoMain(root, {
    versionId: 'BLD-20260918-001', versionName: '版本 1', items: [{ itemId: 'REQ-20260916-005', commit: c1 }],
  });
  assert.ok(r.results.every((x) => x.ok), `合并应全部成功：${JSON.stringify(r.results)}`);
  assert.notEqual(revOf(root, 'master'), masterBefore, 'master 分支头应前进');
  assert.ok(!branchesOf(root).includes('main'), '合并全程不得凭空创建 main');
});

t('B1b 仅 master：合并提交消息含版本与条目号（--no-ff 合并语义落在 master）', () => {
  const root = mkMasterOnlyRepo();
  git(root, ['switch', '-q', '-c', 'dev']);
  const c1 = commit(root, 'b.md', 'feat: 功能二 REQ-20260916-005');
  buildGit.mergeCommitsIntoMain(root, {
    versionId: 'BLD-20260918-002', versionName: '版本 2', items: [{ itemId: 'REQ-20260916-005', commit: c1 }],
  });
  const subjects = git(root, ['log', 'master', '--format=%s']).stdout.trim().split('\n');
  assert.ok(subjects.some((s) => s.includes('BLD-20260918-002') && s.includes('REQ-20260916-005') && s.includes('合并')),
    `master 历史应含带版本与条目号的合并提交：${subjects.join(' | ')}`);
  const parents = git(root, ['log', '-1', 'master', '--format=%P']).stdout.trim().split(/\s+/);
  assert.equal(parents.length, 2, '--no-ff 合并提交应有双亲');
  assert.ok(!branchesOf(root).includes('main'), '合并全程不得凭空创建 main');
});

t('B2 dev-only：precheckMerge 仍报「main 分支不存在」（BUG-20260914-003 口径不回归）；main 存在仓库合并入 main', () => {
  const d = mkDevOnlyRepo();
  assert.throws(() => buildGit.precheckMerge(d, []), /main 分支不存在/, '两者皆无时仍按 main 报缺失');
  // main 存在仓库：合并入 main（既有行为）
  const root = mkMainRepo();
  git(root, ['switch', '-q', '-c', 'dev']);
  const c1 = commit(root, 'b.md', 'feat: 功能三 REQ-20260916-005');
  const mainBefore = revOf(root, 'main');
  buildGit.precheckMerge(root, [{ itemId: 'REQ-20260916-005', commit: c1 }]);
  const r = buildGit.mergeCommitsIntoMain(root, {
    versionId: 'BLD-20260918-003', versionName: '版本 3', items: [{ itemId: 'REQ-20260916-005', commit: c1 }],
  });
  assert.ok(r.results.every((x) => x.ok));
  assert.notEqual(revOf(root, 'main'), mainBefore, 'main 存在时仍合并入 main');
});

t('B3 listBranches 返回 mainBranch（三类夹具）', () => {
  assert.equal(buildGit.listBranches(mkMasterOnlyRepo()).mainBranch, 'master');
  assert.equal(buildGit.listBranches(mkBothRepo()).mainBranch, 'main', '并存取 main');
  assert.equal(buildGit.listBranches(mkDevOnlyRepo()).mainBranch, null, '皆无 → null');
  const notRepo = mkTmp();
  assert.equal(buildGit.listBranches(notRepo).mainBranch, null, '非仓库 → null（isRepo=false 既有形态）');
});

t('B4 syncRemote：master-only 跳过名单含 master；并存只跳 main；dev 照常推送', () => {
  const base = mkTmp();
  git(base, ['init', '-q', '--bare', 'origin.git']);
  const origin = path.join(base, 'origin.git');

  const root = mkMasterOnlyRepo();
  git(root, ['remote', 'add', 'origin', origin]);
  git(root, ['switch', '-q', '-c', 'dev']);
  commit(root, 'c.md', 'chore: dev 提交');
  const r = buildGit.syncRemote(root);
  assert.ok(r.ok, `master-only 同步应成功：${JSON.stringify(r.failed)}`);
  assert.deepEqual(r.skipped, ['master'], 'master-only：跳过名单应为 master（与解析结果一致）');
  assert.ok(r.pushed.some((p) => p.branch === 'dev'), 'dev 应照常推送');
  assert.ok(!branchesOf(root).includes('main'), '同步全程不创建 main');
  const remoteRefs = git(root, ['ls-remote', '--heads', 'origin']).stdout;
  assert.ok(!/refs\/heads\/master/.test(remoteRefs), 'master 不得被同步推送（受控）');
  assert.ok(/refs\/heads\/dev/.test(remoteRefs), 'dev 应到达远端');

  // 并存场景用独立 bare 远端：两个夹具的 dev 历史互不相关，共用同一远端时第二次推送
  // 会因非快进被拒（是否同 SHA 取决于提交时间戳，偶发不稳定），故各自隔离验证。
  const both = mkBothRepo();
  const bothBase = mkTmp();
  git(bothBase, ['init', '-q', '--bare', 'origin-both.git']);
  git(both, ['remote', 'add', 'origin', path.join(bothBase, 'origin-both.git')]);
  git(both, ['switch', '-q', '-c', 'dev']);
  commit(both, 'c.md', 'chore: dev 提交');
  const r2 = buildGit.syncRemote(both);
  assert.deepEqual(r2.skipped, ['main'], '并存：只跳 main（现状无回归）');
  assert.ok(r2.pushed.some((p) => p.branch === 'dev'), '并存：dev 照常推送');
});

t('B5 createVersion：传 targetBranch=master 如实记录；缺省 main（既有口径）', () => {
  const dataDir = mkTmp('atb-main-fb-data-');
  const v1 = buildStore.createVersion(dataDir, {
    items: [{ itemId: 'REQ-20260916-005', commit: 'a'.repeat(40) }], targetBranch: 'master',
  });
  assert.equal(v1.targetBranch, 'master', '回退场景版本计划应记录解析后的主分支');
  const v2 = buildStore.createVersion(dataDir, {
    items: [{ itemId: 'BUG-20260916-099', commit: 'b'.repeat(40) }],
  });
  assert.equal(v2.targetBranch, 'main', '缺省仍为 main（不传时不猜测）');
});

/* ---------- P 组：product-release（exec 注入） ---------- */

t('P1 resolveMainBranchName：master-only→master；并存→main；皆无→null', async () => {
  assert.equal(await resolveMainBranchName(mkMasterOnlyRepo(), realExec), 'master');
  assert.equal(await resolveMainBranchName(mkBothRepo(), realExec), 'main');
  assert.equal(await resolveMainBranchName(mkDevOnlyRepo(), realExec), null);
});

t('P2 switchMainVerifyHead({mainBranch:master})：master-only 夹具 checkout master 并核对 HEAD；缺省 main 兼容', async () => {
  const root = mkMasterOnlyRepo();
  const masterHead = revOf(root, 'master');
  git(root, ['switch', '-q', '-c', 'dev']);
  const r = await prelGit.switchMainVerifyHead(root, realExec, { expectedMainSha: masterHead, mainBranch: 'master' });
  assert.equal(r.ok, true);
  assert.equal(git(root, ['branch', '--show-current']).stdout.trim(), 'master', '应切换到 master');
  // 缺省 main：master-only 夹具上 checkout main 应明确失败（不猜分支）
  git(root, ['switch', '-q', 'dev']);
  await assert.rejects(
    () => prelGit.switchMainVerifyHead(root, realExec, { expectedMainSha: masterHead }),
    /main/,
    '缺省口径仍指向 main（旧调用兼容）',
  );
});

t('P3 原子推送 / dry-run / 远端核验：git 参数按 mainBranch 取 master；缺省 main 兼容', async () => {
  const mkFake = (mainRef = 'refs/heads/master') => {
    const calls = [];
    const exec = async (bin, args) => {
      calls.push(args);
      return { code: 0, stdout: `${'a'.repeat(40)}\t${mainRef}\n${'b'.repeat(40)}\trefs/heads/dev\n`, stderr: '' };
    };
    return { calls, exec };
  };
  const f1 = mkFake();
  await prelGit.atomicPushBranches('/any', f1.exec, { remote: 'origin', mainBranch: 'master' });
  assert.ok(f1.calls.some((a) => a.join(' ') === 'push --atomic origin master dev'), `原子推送参数应为 master dev：${JSON.stringify(f1.calls)}`);

  const f2 = mkFake();
  await prelGit.atomicPushBranches('/any', f2.exec, { remote: 'origin' });
  assert.ok(f2.calls.some((a) => a.join(' ') === 'push --atomic origin main dev'), '缺省 main 兼容');

  const f3 = mkFake();
  await prelGit.precheckAtomicPushDryRun('/any', f3.exec, { remote: 'origin', mainBranch: 'master' });
  assert.ok(f3.calls.some((a) => a.join(' ').includes('push --dry-run --atomic origin master dev')), 'dry-run 参数应含 master');

  const f4 = mkFake();
  await prelGit.verifyRemoteBranches('/any', f4.exec, {
    remote: 'origin', mainSha: 'a'.repeat(40), devSha: 'b'.repeat(40), mainBranch: 'master',
  });
  assert.ok(f4.calls.some((a) => a.join(' ') === 'ls-remote origin refs/heads/master refs/heads/dev'), '核验应读 refs/heads/master');

  const f5 = mkFake('refs/heads/main');
  await prelGit.verifyRemoteBranches('/any', f5.exec, { remote: 'origin', mainSha: 'a'.repeat(40), devSha: 'b'.repeat(40) });
  assert.ok(f5.calls.some((a) => a.join(' ') === 'ls-remote origin refs/heads/main refs/heads/dev'), '核验缺省 main 兼容');
});

t('P4 collectCurrentInputs（master-only）：inputs.mainBranch=master、mainSha=master 分支头', async () => {
  const root = mkMasterOnlyRepo();
  const dataDir = mkTmp('atb-main-fb-prel-');
  const inputs = await collectCurrentInputs({
    dataDir, projectRoot: root,
    run: { productId: 'p', frozen: { version: '1.0.0' } },
    exec: realExec,
  });
  assert.equal(inputs.mainBranch, 'master');
  assert.equal(inputs.mainSha, revOf(root, 'master'));
});

/* ---------- S 组：server 接线（源码静态断言） ---------- */

t('S1 server.mjs：from-build 冻结走解析（frozen.mainBranch 落库）；merge 后主分支头按解析读取；createVersion 传 targetBranch', () => {
  assert.ok(serverSrc.includes('resolveMainBranchName'), 'from-build 冻结应经 resolveMainBranchName 解析主分支');
  assert.ok(/freeze:\s*\{\s*mainBranch,/.test(serverSrc), 'freeze 应落 mainBranch 字段');
  assert.ok(serverSrc.includes('gitFlow.resolveMainBranch(root)'), '合并后主分支头读取应按解析结果');
  assert.ok(/targetBranch:\s*gitFlow\.resolveMainBranch\(root\)/.test(serverSrc), 'createVersion 应传解析后的 targetBranch');
});

/* ---------- U 组：前端（设置页描述文案 / build.js mainHint） ---------- */

function fnSrc(src, name) {
  const i = src.indexOf(`function ${name}`);
  assert.ok(i >= 0, `应定义 ${name}`);
  const j = src.indexOf('\nfunction ', i + 1);
  return src.slice(i, j === -1 ? src.length : j);
}

t('U1 app.js：职责句主分支名动态插值（span 拆分，i18n 可逐段命中）；默认输出等价原句', () => {
  const descFn = fnSrc(appSrc, 'gitWorkflowDescHtml');
  assert.match(descFn, /function gitWorkflowDescHtml\(mainBranch/, '函数应接受 mainBranch 参数');
  assert.match(descFn, /分支承载版本构建，发布构建物。/, '职责句后半段应保留');
  assert.match(descFn, /<span>\$\{/, '主分支名应以 span 拆分为独立文本节点（i18n 全文匹配前提）');
  const areaFn = fnSrc(appSrc, 'gitWorkflowAreaHtml');
  assert.match(areaFn, /gitWorkflowDescHtml\(d\.mainBranch\)/, '分区应把 branch-state 的 mainBranch 传入描述');
  // 默认场景（main）：拆分后三段拼回应与原整句一致（默认行为无回归）
  const zh = 'dev 分支承载需求设计、开发和测试；' + 'main' + ' 分支承载版本构建，发布构建物。';
  assert.equal(zh, 'dev 分支承载需求设计、开发和测试；main 分支承载版本构建，发布构建物。');
});

t('U2 i18n：职责句拆分键中英同步（en 渲染 + 往返 zh）；旧整句键移除', () => {
  const KEY_A = 'dev 分支承载需求设计、开发和测试；';
  const KEY_B = '分支承载版本构建，发布构建物。';
  const OLD = 'dev 分支承载需求设计、开发和测试；main 分支承载版本构建，发布构建物。';
  I.setLang('en');
  try {
    const a = I.t(KEY_A);
    const b = I.t(KEY_B);
    assert.notEqual(a, KEY_A, '前段应有 EN 词条');
    assert.notEqual(b, KEY_B, '后段应有 EN 词条');
    assert.match(a, /dev branch/i);
    assert.match(b, /branch carries version builds/i);
    // 往返：EN 段可译回中文（前段保留尾随空格——与词典值全等命中 ZH_EXACT）
    I.setLang('zh');
    assert.equal(I.t(a), KEY_A, '前段 EN→zh 往返一致');
    assert.equal(I.t(b), KEY_B, '后段 EN→zh 往返一致');
  } finally {
    I.setLang('zh');
  }
  assert.ok(i18nSrc.includes(`'${KEY_A}':`), '词典源应含前段词条');
  assert.ok(i18nSrc.includes(`'${KEY_B}':`), '词典源应含后段词条');
  assert.ok(!i18nSrc.includes(`'${OLD}':`), '旧整句键应移除（避免死词条）');
});

function buildElement() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes, dataset: {}, innerHTML: '', textContent: '', value: '', title: '', disabled: false, checked: false, hidden: false,
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(sel) { if (!nodes.has(sel)) nodes.set(sel, buildElement()); return nodes.get(sel); },
    querySelectorAll() { return []; },
    appendChild(c) { this.children.push(c); },
    replaceChildren(...c) { this.children = c; },
    setAttribute() {}, removeAttribute() {}, focus() {}, select() {}, remove() {},
    closest() { return null; },
  };
}

async function branchesInner(branches) {
  const document = buildElement();
  document.createElement = buildElement;
  document.body = buildElement();
  document.nodes.set('#buildView', buildElement());
  document.addEventListener = () => {};
  const sandbox = {
    document, console, URLSearchParams,
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    fetch: async (url) => {
      const up = new URL(String(url), 'http://local');
      if (up.pathname === '/api/build/state') return { ok: true, json: async () => ({ initialized: true, isRepo: true, currentBranch: 'dev', versions: [] }) };
      if (up.pathname === '/api/build/candidates') return { ok: true, json: async () => ({ items: [] }) };
      if (up.pathname === '/api/build/branches') return { ok: true, json: async () => JSON.parse(JSON.stringify(branches)) };
      return { ok: true, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  await vm.runInContext(`window.ATBBuild.enter('/p/a')`, sandbox);
  await vm.runInContext(`window.ATBBuild.setTab('branches')`, sandbox);
  await new Promise((r) => setTimeout(r, 10));
  return vm.runInContext(`document.querySelector('#buildView').innerHTML`, sandbox);
}

t('U3 build.js mainHint：master-only 不再渲染「本地缺少 main」误导提示；旧载荷（无 mainBranch 字段）不误报', async () => {
  const masterOnly = await branchesInner({ isRepo: true, current: 'dev', local: ['dev', 'master'], remote: [], remotes: [], mainBranch: 'master' });
  assert.doesNotMatch(masterOnly, /本地缺少 main 分支/, 'master-only：主分支已解析为 master，不得显示 main 缺失误导');
  assert.match(masterOnly, /data-branch="master"/, 'master 行正常展示');

  const legacyMain = await branchesInner({ isRepo: true, current: 'dev', local: ['dev', 'main'], remote: ['origin/dev'], remotes: ['origin'] });
  assert.doesNotMatch(legacyMain, /本地缺少 main 分支/, '旧载荷（local 含 main）不误报');

  const devOnly = await branchesInner({ isRepo: true, current: 'dev', local: ['dev'], remote: [], remotes: [] });
  assert.match(devOnly, /本地缺少 main 分支/, 'dev-only（两者皆无）：缺失提示保留（口径不回归）');
});

/* ---------- 执行 ---------- */

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}`);
    console.error(`  ${String(e && e.message ? e.message : e).split('\n').join('\n  ')}`);
  }
}
console.log(`\n${cases.length} 用例，失败 ${failed}`);
process.exit(failed ? 1 : 0);
