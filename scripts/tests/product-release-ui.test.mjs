#!/usr/bin/env node
// REQ-20260915-002 产品发布前端（build.js 入口 + release.js 产品页签）测试 H1~H4
// 用法：node scripts/tests/product-release-ui.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const itemDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'agent-team-board', 'requirements', 'REQ-20260915-002');
const buildJs = fs.readFileSync(path.join(webRoot, 'build.js'), 'utf8');
const relJs = fs.readFileSync(path.join(webRoot, 'release.js'), 'utf8');
const appJs = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const readme = fs.readFileSync(path.join(itemDir, 'README.md'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- vm 接缝（release-ui.test.mjs 同法） ---------- */

function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes, dataset: {}, innerHTML: '', textContent: '', value: '', title: '', disabled: false, checked: false, hidden: false,
    href: '',
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(sel) { if (!nodes.has(sel)) nodes.set(sel, element()); return nodes.get(sel); },
    querySelectorAll() { return []; },
    appendChild(c) { this.children.push(c); },
    replaceChildren(...c) { this.children = c; },
    setAttribute() {}, removeAttribute() {}, focus() {}, select() {}, remove() {}, click() {},
    closest() { return null; },
    get scrollTop() { return 0; }, set scrollTop(v) {},
  };
}

const SHA = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
const DEVS = 'b1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b1';

function prelRun(overrides = {}) {
  return {
    id: 'PREL-20260915-001',
    productId: 'proj',
    version: '1.2.0',
    versionName: '版本 V1',
    bldId: 'BLD-20260915-001',
    status: 'draft',
    createdAt: '2026-09-15T08:00:00.000Z',
    updatedAt: '2026-09-15T08:00:00.000Z',
    targets: { webapp: { status: 'pending' }, site: { status: 'pending' } },
    frozen: {
      version: '1.2.0', mainSha: SHA, devSha: DEVS, remote: 'origin', remoteUrl: '/tmp/remote.git',
      items: [{ itemId: 'REQ-20260915-010', title: 'webapp', commit: SHA }],
      extraCommits: [{ hash: 'c3d4', subject: 'chore: direct to main', author: 'T', date: '2026-09-15T02:00:00.000Z' }],
      homepage: { repoRoot: '/tmp/homepage', branch: 'main', contentDir: '/tmp/homepage/proj/' },
    },
    stages: [
      { key: 'sync-source', label: '源码同步（main/dev 原子推送）', status: 'pending' },
      { key: 'webapp-build', label: 'Web App 构建', status: 'pending' },
      { key: 'webapp-verify', label: 'Web App 部署回验', status: 'pending' },
      { key: 'site-materials', label: '官网材料核验', status: 'pending' },
      { key: 'site-deploy', label: '官网构建部署', status: 'pending' },
      { key: 'site-verify', label: '官网回验', status: 'pending' },
    ],
    precheck: null,
    webapp: null,
    evidence: [], history: [],
    ...overrides,
  };
}

function setup({ productState, productDetail, post = {} } = {}) {
  const document = element();
  document.createElement = element;
  document.body = element();
  document.querySelector = (sel) => document.nodes.get(sel) ?? null;
  document.nodes.set('#releaseView', element());
  document.addEventListener = () => {};
  const calls = [];
  const run = prelRun();
  const sandbox = {
    document, console, URLSearchParams, encodeURIComponent, decodeURIComponent,
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    setTimeout: (fn) => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    Date, Math, JSON,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { search: '' },
    fetch: async (url, opts) => {
      const u = String(url);
      const method = (opts?.method || 'GET').toUpperCase();
      calls.push({ url: u, method, body: opts?.body ? JSON.parse(opts.body) : null });
      for (const [frag, resp] of Object.entries(post)) {
        if (u.includes(frag)) {
          return { ok: !!resp.ok, status: resp.ok ? (resp.status || 200) : (resp.status || 400), json: async () => resp.json || {} };
        }
      }
      if (u.includes('/api/product-release/run/') && method === 'GET' && !/\/(precheck|start|retry|cancel|refreeze|plan)/.test(u)) {
        return { ok: true, status: 200, json: async () => (productDetail || { run, logs: {} }) };
      }
      if (u.includes('/api/product-release/state')) {
        return { ok: true, status: 200, json: async () => (productState || {
          initialized: true,
          runs: [run],
          config: { homepageRepoRoot: '/tmp/homepage' },
          env: { repo: true, remotes: ['origin'], branches: ['main', 'dev'], homepageConfigured: true },
        }) };
      }
      if (u.includes('/api/release/state')) {
        return { ok: true, status: 200, json: async () => { initialized: true; } };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    },
    navigator: {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(relJs, sandbox, { filename: 'release.js' });
  return { ...sandbox, calls };
}

const viewHtml = (h) => h.document.querySelector('#releaseView').innerHTML;
const node = (h, sel) => h.document.querySelector('#releaseView').querySelector(sel) || h.document.nodes.get(sel);

/* ---------- 静态契约 ---------- */

t('H1 build.js：merged 版本详情提供「创建发布 / 查看发布记录」；未合并禁用并说明前置条件', () => {
  assert.ok(/创建发布/.test(buildJs), '存在「创建发布」入口');
  assert.ok(/查看发布记录/.test(buildJs), '存在「查看发布记录」入口');
  // 未 merged 的禁用与前置条件说明（disabled + title 文案含「合并」）
  const m = buildJs.match(/data-ver-release="[^"]*"[\s\S]{0,300}/g) || [];
  assert.ok(m.some((x) => /disabled/.test(x) && /合并/.test(x)), '未合并版本禁用创建发布并说明前置条件');
  assert.ok(/\/api\/product-release\/from-build/.test(buildJs), '创建发布调用 from-build 接口');
});

t('H2 release.js：产品发布页签 + 两必备目标卡 + 冻结 SHA 与额外提交提示 + 操作按钮', async () => {
  const h = setup();
  await h.ATBRelease.enter('proj');
  h.ATBRelease.showProduct();
  await new Promise((r) => setTimeout(r, 0));
  const html = viewHtml(h);
  assert.ok(html.includes('产品发布'), '存在产品发布页签');
  assert.ok(html.includes('Web App'), 'Web App 目标卡');
  assert.ok(html.includes('官网与文档'), '官网与文档目标卡');
  assert.ok(html.includes('PREL-20260915-001'), '运行列表含 PREL 编号');
  assert.ok(html.includes(SHA.slice(0, 8)), '冻结 main SHA 展示');
  assert.ok(/额外提交/.test(html), '额外提交提示（不隐去合并带入的额外变更）');
  assert.ok(html.includes('预检'), '预检操作');
});

t('H3 官网根目录未配置：空态「前往设置」，保存后返回继续（草稿保留）', async () => {
  const h = setup({
    productState: {
      initialized: true, runs: [prelRun()],
      config: { homepageRepoRoot: null },
      env: { repo: true, remotes: ['origin'], branches: ['main', 'dev'], homepageConfigured: false },
    },
    post: { '/api/product-release/config': { ok: true, json: { ok: true, homepageRepoRoot: '/tmp/homepage' } } },
  });
  await h.ATBRelease.enter('proj');
  h.ATBRelease.showProduct();
  await new Promise((r) => setTimeout(r, 0));
  let html = viewHtml(h);
  assert.ok(html.includes('前往设置') || html.includes('设置官网仓库'), '未配置时引导设置');
  // 打开配置表单并保存
  const btn = node(h, '#relProdConfigBtn') || node(h, '[data-rel-prod-config]');
  assert.ok(btn, '存在配置入口按钮');
  btn.listeners.click?.();
  const input = node(h, '#relProdHomepageRoot');
  assert.ok(input, '配置输入框');
  input.value = '/tmp/homepage';
  const save = node(h, '#relProdConfigSave');
  assert.ok(save, '保存按钮');
  save.listeners.click?.();
  await new Promise((r) => setTimeout(r, 0));
  const cfgCall = h.calls.find((c) => c.url.includes('/api/product-release/config'));
  assert.ok(cfgCall, '调用配置保存接口');
  assert.equal(cfgCall.body.homepageRepoRoot, '/tmp/homepage');
});

t('H4 README 界面展示节链接单文件可交互演示 ui-demo.html', () => {
  assert.ok(/\.\/ui-demo\.html/.test(readme), 'README 链接 ./ui-demo.html');
  assert.ok(fs.existsSync(path.join(itemDir, 'ui-demo.html')), 'ui-demo.html 存在于条目目录');
});

t('H5 app.js：跨模块跳转事件接入（创建发布后跳产品发布页）', () => {
  assert.ok(/atb:goto-view/.test(appJs), 'app.js 监听 atb:goto-view');
  assert.ok(/showProduct/.test(relJs), 'release.js 暴露 showProduct');
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
console.log(`product-release-ui：${cases.length - failed}/${cases.length} 通过`);
process.exit(failed ? 1 : 0);
