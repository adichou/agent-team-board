// REQ-20260929-002：发布模块删除 Web App 构建目标，不再校验任何构建目标——
// 「构建」模块发布直线流程删除全部执行阶段（sync-source / webapp-build / webapp-verify /
// site-deploy / site-verify）与构建识别（profile），发布收敛为「检查 → 二次确认 → 更新版本
// 计划状态」：确认后仅将版本计划置为「已发布」（发布时间取确认时点），全程无 git push、
// 无官网仓库构建、无本机回验；发布不再依赖源码远端与官网仓库配置；存量旧运行记录原样兼容。
// 用法：node scripts/tests/build-publish-20260929-002.test.mjs
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as store from '../lib/build-publish-store.mjs';
import * as buildStore from '../lib/build-store.mjs';
import * as publish from '../lib/build-publish.mjs';
import { buildPublishApi } from '../lib/build-publish-api.mjs';
import { writeDocs, DOC_FILES, gcommit, docHashes } from './lib/build-publish-fixture.mjs';
import '../web/i18n.js';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const buildJs = fs.readFileSync(path.join(webRoot, 'build.js'), 'utf8');
const I18N = globalThis.ATBI18N;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-bpub-29002-'));
process.env.ATB_BUILD_PUBLISH_CONFIG = path.join(root, 'global.json'); // 官网配置文件不存在 → 空配置
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const gc = (cwd, ...args) => git(cwd, '-c', 'user.name=T', '-c', 'user.email=t@e.c', ...args);

// Chrome 扩展形态项目夹具（无 package.json / 无根 index.html，仅 manifest.json + popup.html；
// bare 远端可选）：main（扩展骨架 + 文档 cherry-pick）+ dev（条目提交 = 骨架提交 + 文档提交）。
// 与 build-publish-fixture 的 makeVersion 形状兼容（item = web 提交，本身在 main 历史内）。
function makeExtProject(name, { remote = true } = {}) {
  const project = path.join(root, name);
  fs.mkdirSync(project);
  git(project, 'init', '-b', 'main');
  fs.writeFileSync(path.join(project, 'manifest.json'), '{"manifest_version":3,"name":"ext"}');
  fs.writeFileSync(path.join(project, 'popup.html'), '<!doctype html><p>popup</p>');
  const web = gcommit(project, 'web: 扩展骨架', 'manifest.json', 'popup.html');
  git(project, 'branch', 'dev');
  if (remote) {
    const bare = path.join(root, `remote-${name}.git`);
    git(root, 'init', '--bare', bare);
    git(project, 'remote', 'add', 'origin', bare);
  }
  git(project, 'checkout', 'dev');
  writeDocs(project);
  const docs = gcommit(project, 'docs: 发布文档', ...DOC_FILES);
  git(project, 'checkout', 'main');
  gc(project, 'cherry-pick', docs);
  const mainDocs = git(project, 'rev-parse', 'HEAD');
  git(project, 'checkout', 'dev');
  return { project, db: path.join(project, 'agent-team-board'), bare: remote ? path.join(root, `remote-${name}.git`) : null, web, item: web, itemReplayed: null, docs, mainDocs };
}

// 版本计划夹具（merged + 文档审核 / 提交 / 合并落账），口径同 build-publish-fixture.makeVersion。
function makeVersion(fx, { itemId = 'REQ-20260929-002' } = {}) {
  const v = buildStore.createVersion(fx.db, {
    name: '测试版本', version: '1.0.0',
    items: [{ itemId, commits: [fx.item] }],
  });
  buildStore.beginMerge(fx.db, v.id);
  buildStore.finishMerge(fx.db, v.id, { results: [{ itemId, ok: true }], mainSha: fx.mainDocs });
  const h = docHashes(fx.project);
  for (const f of DOC_FILES) buildStore.recordDocsReview(fx.db, v.id, { file: f, hash: h[f] });
  buildStore.recordDocsCommit(fx.db, v.id, { commitHash: fx.docs, files: h, scopeFp: 'fp-29002' });
  if (fx.mainDocs !== fx.item) {
    buildStore.recordDocsMerge(fx.db, v.id, {
      commitHash: fx.docs, replayedHash: fx.mainDocs, mainSha: fx.mainDocs,
      replays: [{ itemId: 'docs', original: fx.docs, replayed: fx.mainDocs }],
    });
  }
  return buildStore.readVersion(fx.db, v.id);
}

// 全链路：create → precheck → plan → start（返回终态 run）。
async function publishThrough(fx, v, version = '1.0.0') {
  const run = await publish.create(fx.db, fx.project, v, version);
  const checked = await publish.precheck(fx.db, fx.project, run.id);
  assert.equal(checked.precheck.ok, true, JSON.stringify(checked.precheck.checks));
  const plan = await publish.plan(fx.db, fx.project, run.id);
  const { run: done } = await publish.start(fx.db, fx.project, run.id, plan.token);
  return { run, plan, done };
}

/* ---------- E1 / E7：Chrome 扩展形态全链路（无构建识别、无远端依赖、无推送） ---------- */

t('E1 Chrome 扩展形态（无 package.json / 无根 index.html / 无官网配置）全链路发布成功，无执行阶段数据与任何推送', async () => {
  const fx = makeExtProject('ext-e1');
  const v = makeVersion(fx);
  const { plan, done } = await publishThrough(fx, v, '1.0.0');
  // 计划仅 1 条，且为「更新版本计划状态」而非推送 / 构建
  assert.equal(plan.steps.length, 1, `发布计划应仅 1 条，实际 ${plan.steps.length}`);
  assert.match(plan.steps[0], /已发布/);
  for (const gone of ['原子推送', 'npm install', 'npm run build', 'Web App', '官网仓库执行']) {
    assert.ok(!plan.steps.some((s) => s.includes(gone)), `计划步骤不应再含「${gone}」`);
  }
  // 运行即确认即完成；新发布不产生 stages / targets / directories
  assert.equal(done.status, 'succeeded');
  assert.equal(done.stages, undefined);
  assert.equal(done.targets, undefined);
  assert.equal(done.directories, undefined);
  // 预检结果不含 profile（构建识别删除）
  const reread = store.readRun(fx.db, done.id);
  assert.equal(reread.precheck.profile, undefined, '预检结果不再含 profile 字段');
  assert.equal('profile' in reread.precheck, false);
  // 全程无 git push：bare 远端无任何被推 refs（空仓库 show-ref 非零退出，读 refs 目录判定）
  const heads = path.join(fx.bare, 'refs', 'heads');
  const pushed = fs.existsSync(heads) ? fs.readdirSync(heads) : [];
  assert.deepEqual(pushed, [], `bare 远端不应有任何被推 refs（实际：${pushed.join(',')}）`);
});

t('E7 无远端项目可完成发布：inputs / create / precheck 不再要求源码远端', async () => {
  const fx = makeExtProject('ext-e7', { remote: false });
  const v = makeVersion(fx);
  const run = await publish.create(fx.db, fx.project, v, '1.0.0');
  const checked = await publish.precheck(fx.db, fx.project, run.id);
  assert.equal(checked.precheck.ok, true, JSON.stringify(checked.precheck.checks));
  const plan = await publish.plan(fx.db, fx.project, run.id);
  const { run: done } = await publish.start(fx.db, fx.project, run.id, plan.token);
  assert.equal(done.status, 'succeeded');
});

/* ---------- E2 / E3 / E4：确认落账、token 守卫与已发布不可逆 ---------- */

t('E2 确认即落账：版本计划 confirmedAt 固化、isReleased=true、releasedAt=确认时点；成功后再次 start 拒绝', async () => {
  const fx = makeExtProject('ext-e2');
  const v = makeVersion(fx);
  const before = Date.now() - 1000;
  const { done } = await publishThrough(fx, v, '1.0.0');
  const after = Date.now() + 1000;
  const ver = buildStore.readVersion(fx.db, v.id);
  assert.ok(ver.release?.confirmedAt, '确认时点已固化到版本计划');
  const ts = Date.parse(ver.release.confirmedAt);
  assert.ok(ts >= before && ts <= after, 'confirmedAt 为本次确认时点');
  assert.equal(buildStore.isReleased(ver, fx.db), true);
  assert.equal(ver.releasedAt, ver.release.confirmedAt, '发布时间（releasedAt）取确认时点');
  assert.equal(ver.release.confirmedRunId, done.id, '确认关联发布运行编号');
  await assert.rejects(() => publish.start(fx.db, fx.project, done.id, 'any'), /状态不可发布/);
});

t('E3 token 错误拒绝发布；未合并版本不可创建发布', async () => {
  const fx = makeExtProject('ext-e3');
  const draft = buildStore.createVersion(fx.db, { name: '草稿', version: '0.1.0', items: [{ itemId: 'REQ-20260929-003', commits: [fx.item] }] });
  await assert.rejects(() => publish.create(fx.db, fx.project, draft, '1.0.0'), /仅已合并/);
  const v = makeVersion(fx);
  const run = await publish.create(fx.db, fx.project, v, '1.0.0');
  await publish.precheck(fx.db, fx.project, run.id);
  await assert.rejects(() => publish.start(fx.db, fx.project, run.id, 'invented-token'), /确认/);
  assert.equal(store.readRun(fx.db, run.id).status, 'draft', 'token 错误不改变运行状态');
});

t('E4 已发布不可逆：同版本号再发布拒绝；已发布版本信息与条目锁定（PUBLISHED_READ_ONLY）', async () => {
  const fx = makeExtProject('ext-e4');
  const v = makeVersion(fx);
  await publishThrough(fx, v, '1.0.0');
  const reread = buildStore.readVersion(fx.db, v.id);
  await assert.rejects(() => publish.create(fx.db, fx.project, reread, '1.0.0'), /已发布/);
  assert.throws(() => buildStore.saveInfo(fx.db, v.id, { name: '改名' }), /已发布，版本计划仅可查看/);
  assert.throws(() => buildStore.addItems(fx.db, v.id, [{ itemId: 'REQ-20260929-099', commits: [fx.item] }]), /已发布/);
});

/* ---------- E5：存量运行兼容 ---------- */

t('E5 存量旧运行（含 stages / targets / directories）原样读取；succeeded 存量口径不回退；目录查看 API 保留', async () => {
  const fx = makeExtProject('ext-e5');
  const v = makeVersion(fx);
  const legacyId = `BPUB-${crypto.randomUUID()}`;
  const legacyDir = path.join(fx.db, 'runtime', 'builds', 'publish-runs', legacyId);
  const outDir = path.join(root, 'legacy-out'); fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(legacyDir, { recursive: true });
  const legacyRun = {
    id: legacyId, productId: 'ext-e5', bldId: v.id, bldName: v.name, version: '0.9.0', status: 'succeeded',
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:05:00.000Z',
    stages: [{ key: 'sync-source', label: '源码 main/dev 原子推送', status: 'done' }],
    targets: { webapp: { status: 'done' }, site: { status: 'done' } },
    directories: { webapp: { path: outDir } }, logs: [], precheck: null, cancelRequested: false,
    frozen: { homepage: { repoRoot: '/tmp/legacy' } },
  };
  fs.writeFileSync(path.join(legacyDir, 'run.json'), JSON.stringify(legacyRun));
  // 原样读取
  const reread = store.readRun(fx.db, legacyId);
  assert.equal(reread.stages.length, 1);
  assert.equal(reread.targets.site.status, 'done');
  // 存量 succeeded 口径：版本计划无确认账仍推导已发布（不迁移、不回退、不解锁）
  const pub = buildStore.publishedByBld(fx.db);
  assert.ok(pub.has(v.id), '存量 succeeded 运行仍推导已发布');
  assert.throws(() => buildStore.saveInfo(fx.db, v.id, { name: '改名' }), /已发布，版本计划仅可查看/);
  // 目录查看 API 对旧运行保留
  const detail = await buildPublishApi({ method: 'GET', pathname: `/api/build-publish/run/${legacyId}`, body: {}, root: fx.project, dataDir: fx.db });
  assert.equal(detail.directories.webapp.available, true);
  const opened = await publish.openDirectory(fx.db, legacyId, 'webapp', { platform: 'darwin', open: async () => {} });
  assert.match(opened.message, /Finder/);
});

t('E5b 新口径并集：仅确认账（无 succeeded 运行）也推导已发布', async () => {
  const fx = makeExtProject('ext-e5b');
  const v = makeVersion(fx);
  // 不经 start，仅落确认账（模拟确认后 run 账本被清理的读取侧兜底：无 runId 按确认事实判定）
  buildStore.recordReleaseConfirm(fx.db, v.id, { runId: null });
  const pub = buildStore.publishedByBld(fx.db);
  assert.ok(pub.has(v.id), '确认动作直接写版本计划发布态 → 已发布');
});

/* ---------- E6：发布不依赖官网配置与物料 ---------- */

t('E6 官网仓库已配置但未注册产品 / 无任何物料：预检通过、发布成功（不再构建官网）', async () => {
  // 官网仓库：仅有 main 分支的空仓库（无 apps.js、无 content）
  const site = path.join(root, 'site-e6');
  fs.mkdirSync(site);
  git(site, 'init', '-b', 'main');
  gc(site, 'commit', '--allow-empty', '-m', 'empty site');
  store.saveConfig(site);
  const fx = makeExtProject('ext-e6');
  const v = makeVersion(fx);
  const { done } = await publishThrough(fx, v, '1.0.0');
  assert.equal(done.status, 'succeeded', '官网物料 / 注册缺失不再影响发布');
});

/* ---------- E11：确认落账失败反馈 ---------- */

t('E11 版本计划记录缺失时发布失败（run failed + 原因），不产生假成功', async () => {
  const fx = makeExtProject('ext-e11');
  const v = makeVersion(fx);
  const run = await publish.create(fx.db, fx.project, v, '1.0.0');
  await publish.precheck(fx.db, fx.project, run.id);
  const plan = await publish.plan(fx.db, fx.project, run.id);
  fs.rmSync(path.join(fx.db, 'runtime', 'builds', 'versions', v.id, 'version.json'));
  await assert.rejects(() => publish.start(fx.db, fx.project, run.id, plan.token), /版本/);
  const failed = store.readRun(fx.db, run.id);
  assert.equal(failed.status, 'failed', '状态更新失败 → 运行 failed 可重试');
  assert.match(failed.error?.message || '', /版本/);
});

/* ---------- E8 / E9：i18n 键清理与 build.js 残留断言 ---------- */

t('E8 i18n：被删错误消息的文案键已两语言同步移除', () => {
  const EN = I18N._dict.EN;
  for (const gone of [
    '请先配置官网仓库',
    '请先配置官网仓库后再发布',
    '无法识别冻结源码的 Web App 构建方式（预检已不含构建识别项；请检查冻结 main 的 package.json / index.html）',
  ]) {
    assert.ok(!(gone in EN), `EN 词典不应再含「${gone}」`);
    assert.ok(!Object.values(EN).includes(gone));
  }
});

t('E9 build.js：发布步无官网配置禁用 / 前往设置 / 推送主分支残留', () => {
  for (const gone of [
    '请先配置官网仓库',
    'data-publish-settings',
    'goPublishSettings',
    'atb:publish-settings',
    '推送主分支',
    '动作一 · 推送远端',
    '动作二 · 官网资料更新',
    'renderReleaseFlowPane',
    'pushMain',
    'siteScan',
    'startSiteTimer',
    'bld-push-main-remote',
  ]) {
    assert.ok(!buildJs.includes(gone), `build.js 不应再含「${gone}」`);
  }
});

/* ---------- E10：前端假 DOM（口径同 bug-20260928-012） ---------- */

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
    setAttribute() {}, removeAttribute() {}, focus() {}, select() {}, remove() {}, closest() { return null; },
  };
}

const H = (c) => c.repeat(40);
function verItem(i = 1) {
  return { itemId: `REQ-20260929-0${String(i).padStart(2, '0')}`, title: `条目 ${i}`, commit: H('a').slice(0, 39) + String(i % 10), mergedAt: null, mergeError: null };
}
function ver(id, name, status = 'merged', extra = {}) {
  return {
    id, name, description: `描述 ${name}`, status, version: '1.2.0',
    items: [verItem(1)], createdAt: '2026-09-29T01:00:00.000Z', updatedAt: '2026-09-29T02:00:00.000Z',
    merge: { startedAt: null, finishedAt: null, error: null, baseBranch: 'dev' }, ...extra,
  };
}
function relRun(o = {}) {
  return {
    id: 'BPUB-20260929-0001', productId: 'proj', bldId: 'BLD-A', bldName: 'v1.2',
    version: '1.2.0', status: 'draft',
    createdAt: '2026-09-29T08:00:00.000Z', updatedAt: '2026-09-29T08:30:00.000Z', logs: [], error: null, ...o,
  };
}

function setup({ versions = [ver('BLD-A', 'v1.2', 'merged'), ver('BLD-B', 'v2.0', 'draft')], runs = [], config = { homepageRepoRoot: '' }, planSteps = ['将版本计划 BLD-A 状态更新为「已发布」（v1.2.0；发布时间取确认时点，不推送远端、不构建官网仓库）'] } = {}) {
  const live = { versions: JSON.parse(JSON.stringify(versions)), runs: JSON.parse(JSON.stringify(runs)) };
  const state = () => ({ initialized: true, isRepo: true, currentBranch: 'dev', versions: live.versions });
  const document = element();
  document.createElement = element;
  document.body = element();
  document.nodes.set('#buildView', element());
  document.addEventListener = () => {};
  const toasts = [];
  const sandbox = {
    document, console, URLSearchParams,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    fetch: async (url, opts = {}) => {
      const u = new URL(String(url), 'http://local');
      const method = (opts.method || 'GET').toUpperCase();
      if (u.pathname === '/api/build/state') return { ok: true, json: async () => JSON.parse(JSON.stringify(state())) };
      if (u.pathname === '/api/build/candidates') return { ok: true, json: async () => ({ items: [] }) };
      if (u.pathname === '/api/build-publish/state') return { ok: true, json: async () => ({ runs: JSON.parse(JSON.stringify(live.runs)), config: JSON.parse(JSON.stringify(config)) }) };
      if (u.pathname === '/api/build-publish/from-build') {
        const run = relRun({ id: 'BPUB-NEW-1', version: (opts.body && JSON.parse(opts.body).version) || '9.9.9' });
        live.runs.push(JSON.parse(JSON.stringify(run)));
        return { ok: true, status: 201, json: async () => ({ run }) };
      }
      const m = u.pathname.match(/^\/api\/build-publish\/run\/([^/]+)\/?([a-z]*)$/);
      if (m) {
        const [, id, action] = m;
        const cur = () => live.runs.find((r) => r.id === id) || relRun({ id });
        if (action === 'plan') return { ok: true, json: async () => ({ plan: { token: 'fp-1', steps: planSteps } }) };
        if (action === 'precheck') {
          const run = cur();
          run.precheck = { ok: true, checks: [{ label: '发布文档', ok: true }, { label: '挑选条目', ok: true }], fingerprint: 'fp-1' };
          return { ok: true, json: async () => ({ run: JSON.parse(JSON.stringify(run)) }) };
        }
        if (action === 'start') {
          const run = cur(); run.status = 'succeeded'; run.updatedAt = '2026-09-29T09:00:00.000Z';
          return { ok: true, json: async () => ({ run: JSON.parse(JSON.stringify(run)) }) };
        }
        return { ok: true, json: async () => ({ run: JSON.parse(JSON.stringify(cur())), logs: [], directories: {} }) };
      }
      return { ok: true, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox;
  sandbox.window.toast = (msg) => toasts.push(String(msg));
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
  return {
    sandbox, live, toasts, tick,
    run: (code) => vm.runInContext(code, sandbox),
    inner: () => vm.runInContext(`document.querySelector('#buildView').innerHTML`, sandbox),
    enter: async () => { await vm.runInContext(`window.ATBBuild.enter('/p/proj')`, sandbox); },
  };
}

t('E10a 未配置官网仓库：发布按钮不再因未配置禁用，无「前往设置」入口，点击直接进入检查', async () => {
  const hh = setup({ config: { homepageRepoRoot: '' } });
  await hh.enter();
  hh.run(`window.ATBBuild.openReleaseTab('BLD-A')`);
  await hh.tick();
  const inner = hh.inner();
  assert.ok(!inner.includes('请先配置官网仓库'), '不再出现「未配置官网仓库」禁用提示');
  assert.ok(!inner.includes('前往设置'), '发布步不再有「前往设置」入口');
  assert.ok(!inner.includes('动作一 · 推送远端') && !inner.includes('推送主分支'), '发布步不再承载推送 / 官网动作');
  hh.run(`window.ATBBuild.openPublishConfirm('BLD-A')`);
  await hh.tick();
  const inner2 = hh.inner();
  assert.match(inner2, /发布前检查|发布二次确认/, '未配置官网仓库也可进入发布检查 / 确认');
  assert.ok(!hh.toasts.some((s) => s.includes('请先配置官网仓库')), '不再 toast 官网配置要求');
});

t('E10b 检查通过后二次确认弹窗展示发布计划（服务端 plan 步骤，1 条）', async () => {
  const hh = setup({});
  await hh.enter();
  hh.run(`window.ATBBuild.openReleaseTab('BLD-A')`);
  await hh.tick();
  hh.run(`window.ATBBuild.openPublishConfirm('BLD-A')`);
  await hh.tick();
  const inner = hh.inner();
  assert.match(inner, /发布二次确认（BLD-A）/, '进入二次确认');
  assert.match(inner, /发布计划/, '弹窗展示发布计划区');
  assert.match(inner, /将版本计划 BLD-A 状态更新为「已发布」/, '计划步骤（服务端数据）可见');
  assert.ok(!/原子推送|npm install|Web App/.test(inner), '确认弹窗无推送 / 构建残留文案');
});

t('E10c 确认发布后：start 带 token=预检指纹，结果面板显示发布成功', async () => {
  const hh = setup({});
  await hh.enter();
  hh.run(`window.ATBBuild.openReleaseTab('BLD-A')`);
  await hh.tick();
  hh.run(`window.ATBBuild.openPublishConfirm('BLD-A')`);
  await hh.tick();
  await hh.run(`window.ATBBuild.doPublishConfirm()`);
  await hh.tick();
  const inner = hh.inner();
  assert.match(inner, /✓ 发布成功/, '结果面板显示发布成功');
  assert.match(inner, /发布时间/, '显示发布时间');
});

for (const [name, fn] of cases) { await fn(); console.log(`PASS ${name}`); }
console.log(`\n${cases.length} cases passed`);
fs.rmSync(root, { recursive: true, force: true });
