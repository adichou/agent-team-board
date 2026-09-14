#!/usr/bin/env node
// BUG-20260914-003 本地 main 从未出生（分支浏览只见 dev + 「（无其他本地分支）」，
// 「合并入 main」报 main 分支不存在）—— 根因修复 + UI 可解释性测试。
// G1–G4：git-flow ensureDevWorkflow 幂等补建 main（真实临时 git 仓库）；
// U1–U3：build.js 分支浏览 main 缺失提示（vm 行为，载荷注入）。
// 用法：node scripts/tests/bug-branch-main-missing-20260914-003.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as gitFlow from '../lib/git-flow.mjs';
import * as buildGit from '../lib/build-git.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = path.join(pluginRoot, 'scripts', 'web');
const buildJs = fs.readFileSync(path.join(webRoot, 'build.js'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function git(root, args, opts = {}) {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
  if (!opts.canFail && r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r;
}

function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-main-missing-')));
}

// 复现「main 从未出生」的仓库形态（与本仓库同源，REQ-20260911-009 空仓库初始化路径）：
// git init -b main 后立即 switch -c dev（未出生分支改名），提交全部落 dev。
function mkDevOnlyRepo() {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['switch', '-q', '-c', 'dev']);
  fs.writeFileSync(path.join(root, 'a.md'), 'a\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 首个提交']);
  fs.writeFileSync(path.join(root, 'b.md'), 'b\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 第二个提交']);
  return root;
}

const revOf = (root, ref) => git(root, ['rev-parse', ref]).stdout.trim();
const branchOf = (root) => git(root, ['branch', '--show-current']).stdout.trim();

/* ---------- G1–G4 git-flow：ensureDevWorkflow 幂等补建 main ---------- */

t('G1 dev-only 仓库（main 从未出生）：ensure 补建 main 于根提交；不切分支不动 HEAD；幂等；合并校验恢复', () => {
  const root = mkDevOnlyRepo();
  const rootCommit = git(root, ['rev-list', '--max-parents=0', 'HEAD']).stdout.trim().split('\n')[0];
  const headBefore = revOf(root, 'HEAD');
  assert.equal(git(root, ['rev-parse', '--verify', '--quiet', 'refs/heads/main'], { canFail: true }).status, 1,
    '前置：本地确无 main（复现缺陷形态）');
  // 连带影响复现：合并入 main 前置校验报「main 分支不存在」
  assert.throws(() => buildGit.precheckMerge(root, []), /main 分支不存在/);

  const r = gitFlow.ensureDevWorkflow(root);
  assert.equal(r.mainCreated, true, '应补建 main（mainCreated=true）');
  assert.equal(git(root, ['rev-parse', '--verify', '--quiet', 'refs/heads/main']).status, 0, 'refs/heads/main 应存在');
  assert.equal(revOf(root, 'main'), rootCommit, 'main 基点应为根提交');
  assert.equal(branchOf(root), 'dev', '不得切换当前分支');
  assert.equal(revOf(root, 'HEAD'), headBefore, 'HEAD 不得移动（不触碰工作区）');
  assert.equal(git(root, ['remote']).stdout.trim(), '', '不得配置 / 推送远端');

  // 幂等：再次 ensure 不重建、基点不变
  const r2 = gitFlow.ensureDevWorkflow(root);
  assert.equal(r2.mainCreated, false, 'main 已存在：mainCreated=false');
  assert.equal(revOf(root, 'main'), rootCommit, '幂等：main 基点不变');

  // 连带修复：分支列表显示 main；合并前置校验通过
  assert.ok(buildGit.listBranches(root).local.includes('main'), '分支列表应包含 main（分支浏览可见）');
  assert.equal(buildGit.precheckMerge(root, []), 'dev', '合并入 main 前置校验应通过');
});

t('G2 空仓库：无基点不补建不报错；首个提交落 dev 后再次 ensure 补建 main 于该提交', () => {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['switch', '-q', '-c', 'dev']); // 未出生分支改名（空仓库路径）
  const r0 = gitFlow.ensureDevWorkflow(root);
  assert.equal(branchOf(root), 'dev');
  assert.equal(r0.mainCreated, false, '空仓库尚无提交：无补建基点，跳过不报错');
  fs.writeFileSync(path.join(root, 'x.txt'), 'x\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: 首次提交']);
  const r1 = gitFlow.ensureDevWorkflow(root);
  assert.equal(r1.mainCreated, true, '首个提交落 dev 后再次 ensure：补建 main');
  assert.equal(revOf(root, 'main'), revOf(root, 'HEAD'), 'main 基点=根提交（此时唯一提交）');
  assert.equal(branchOf(root), 'dev', '当前分支保持 dev');
});

t('G3 main 已存在的仓库：不重建、基点不动（既有 D2 口径不回归）', () => {
  const root = mkTmp();
  git(root, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'chore: base']);
  const mainBefore = revOf(root, 'main');
  const r = gitFlow.ensureDevWorkflow(root); // 创建 dev 并切换
  assert.equal(branchOf(root), 'dev');
  assert.equal(r.mainCreated, false, 'main 已存在：不补建');
  assert.equal(revOf(root, 'main'), mainBefore, 'main 基点不动');
});

/* ---------- U1–U3 build.js：分支浏览 main 缺失提示（vm） ---------- */

function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes, dataset: {}, innerHTML: '', textContent: '', value: '', title: '', disabled: false, checked: false, hidden: false,
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(sel) { if (!nodes.has(sel)) nodes.set(sel, element()); return nodes.get(sel); },
    querySelectorAll() { return []; },
    appendChild(c) { this.children.push(c); },
    replaceChildren(...c) { this.children = c; },
    setAttribute() {}, removeAttribute() {}, focus() {}, select() {}, remove() {},
    closest() { return null; },
  };
}

function statePayload(over = {}) {
  return {
    initialized: true,
    isRepo: true,
    currentBranch: 'dev',
    versions: [],
    ...over,
  };
}

function setup({ branches, state = statePayload() } = {}) {
  const document = element();
  document.createElement = element;
  document.body = element();
  document.nodes.set('#buildView', element());
  document.addEventListener = () => {};
  const sandbox = {
    document, console, URLSearchParams,
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    fetch: async (url) => {
      const up = new URL(String(url), 'http://local');
      if (up.pathname === '/api/build/state') return { ok: true, json: async () => JSON.parse(JSON.stringify(state)) };
      if (up.pathname === '/api/build/candidates') return { ok: true, json: async () => ({ items: [] }) };
      if (up.pathname === '/api/build/branches') return { ok: true, json: async () => JSON.parse(JSON.stringify(branches)) };
      return { ok: true, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  return { sandbox, run: (code) => vm.runInContext(code, sandbox) };
}

async function branchesInner(branches) {
  const h = setup({ branches });
  await h.run(`window.ATBBuild.enter('/p/a')`);
  await h.run(`window.ATBBuild.setTab('branches')`);
  await new Promise((r) => setTimeout(r, 10));
  return h.run(`document.querySelector('#buildView').innerHTML`);
}

t('U1 本地无 main（仅 dev）：渲染 main 缺失明确提示，与合并校验报错口径一致；空态文案保持', async () => {
  // BUG-20260914-006：远端空态三分支后，remotes=[]（未配置远端）保持本句既有文案
  const inner = await branchesInner({ isRepo: true, current: 'dev', local: ['dev'], remote: [], remotes: [] });
  assert.match(inner, /本地缺少 main 分支/, '应明确提示 main 缺失');
  assert.match(inner, /main 分支不存在/, '提示应与 precheckMerge 报错口径一致');
  assert.match(inner, /Git 工作流/, '应引导到设置页 Git 工作流初始化');
  assert.match(inner, /bld-main-hint/, '提示应有稳定样式钩子');
  assert.match(inner, /（无其他本地分支）/, '既有空态文案不回归（本地确无其他分支仍如实显示）');
  assert.match(inner, /（无远端分支/, '远端空态文案不回归');
});

t('U2 本地含 main：不渲染 main 缺失提示', async () => {
  const inner = await branchesInner({ isRepo: true, current: 'dev', local: ['dev', 'main'], remote: ['origin/dev'] });
  assert.doesNotMatch(inner, /本地缺少 main 分支/, 'main 存在时不得出现缺失提示');
  assert.match(inner, /data-branch="main"/, 'main 正常显示在本地分组');
});

t('U3 空仓库（无任何本地分支）：不渲染 main 缺失提示（无基点，补建不适用）', async () => {
  const inner = await branchesInner({ isRepo: true, current: null, local: [], remote: [] });
  assert.doesNotMatch(inner, /本地缺少 main 分支/, '无本地分支时不出现 main 缺失提示');
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
