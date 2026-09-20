#!/usr/bin/env node
// BUG-20260920-001 契约测试 —— 旧布局项目设置页整页失败阻断「数据布局迁移」入口
// 根因：renderSettingsView 对 /api/dispatch/settings 的读取失败时整页替换设置视图并返回；
// 旧布局项目（无 agent-team-board/ 数据目录）该接口必然失败（服务端 /api/dispatch/* 在
// dataDir 缺失时 400「未找到 agent-team-board，请先初始化」），并行发起的 /api/layout/state
// 结果被丢弃，「一键迁移到新布局」入口随整页错误一起消失。
// 修复口径（条目 README 期望行为）：
//   1) 派发设置读取失败只局部显示原因 + 重试，不再整页替换；迁移入口保留可用
//   2) 派发设置失败与布局检测失败互相独立；检测失败可重试，不误显示「无可迁移数据」
//   3) 失败配置下迁移全链路仍可用：取消不发起迁移；确认后仅迁移当前项目、执行中防重复；
//      成功后转「已是新布局」并刷新看板；失败保留原因可重试
// 服务端 /api/layout/state、/api/migrate 本就不要求已初始化（layout-migration-20260916-007 已覆盖），
// 本单不改服务端。
// 用法：node scripts/tests/bug-20260920-001.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const i18nSource = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'i18n.js'), 'utf8');

// DOM 接缝：控件级 stub（settings-simplify-20260909-002.test.mjs 同法）
function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes,
    dataset: {}, innerHTML: '', textContent: '', title: '', value: '', disabled: false, checked: false, indeterminate: false,
    tagName: 'DIV',
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: () => true, toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); },
    prepend(child) { this.children.unshift(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, removeAttribute() {},
    fire(event) { const e = { target: this, currentTarget: this, stopped: false, stopPropagation() { this.stopped = true; } }; return { e, result: this.listeners[event]?.(e) }; },
  };
}

// 沙箱：按路径分发响应，支持每用例覆写；migrate 门闩手动放行以观察执行中防重复态
function harness() {
  const document = element();
  document.createElement = element;
  const seed = (selector, el) => document.nodes.set(selector, el);
  document.querySelector = (selector) => { if (!document.nodes.has(selector)) document.nodes.set(selector, element()); return document.nodes.get(selector); };
  const ctl = {
    dispatchSettings: 'fail', // 'fail' | 'ok'
    layout: 'legacy',         // 'legacy' | 'modern' | 'none' | 'fail'
    migrateGate: null,        // Promise.resolve 后放行 /api/migrate 响应
    migrateFail: null,        // 非 null：/api/migrate 以该 message 失败
  };
  const polls = [];
  const posted = [];
  const resp = (ok, body) => ({ ok, status: ok ? 200 : 400, statusText: ok ? 'OK' : 'ERR', json: async () => body });
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    window: { addEventListener() {}, confirm: () => true },
    fetch: async (url, opts) => {
      const p = String(url).split('?')[0];
      if (opts && opts.method === 'POST') posted.push({ url: p, body: JSON.parse(opts.body || '{}') });
      if (p === '/api/dispatch/settings') {
        return ctl.dispatchSettings === 'fail'
          ? resp(false, { error: '未找到 agent-team-board，请先初始化' })
          : resp(true, { settings: { codex: { cliPath: null, timeoutMin: 60, retries: 2 } } });
      }
      if (p === '/api/layout/state') {
        if (ctl.layout === 'fail') return resp(false, { error: '布局探测失败' });
        if (ctl.layout === 'legacy') return resp(true, { root: '/project/a', legacy: true, modern: false, hint: '检测到旧布局（docs/agent-team-board/）' });
        if (ctl.layout === 'modern') return resp(true, { root: '/project/a', legacy: false, modern: true, hint: '已是新布局' });
        return resp(true, { root: '/project/a', legacy: false, modern: false, hint: '未检测到看板数据' });
      }
      if (p === '/api/migrate') {
        await ctl.migrateGate;
        if (ctl.migrateFail) return resp(false, { error: ctl.migrateFail });
        return resp(true, { ok: true, changed: true, reason: null });
      }
      return resp(true, {});
    },
  };
  sandbox.__ctl = ctl; sandbox.__posted = posted; sandbox.__polls = polls;
  vm.createContext(sandbox);
  vm.runInContext(source.split('/* ---------- 启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  run('toast = () => {}; poll = async () => { __polls.push(1); }; refreshDrawer = async () => {}; refreshBatch = async () => {}; renderBatchDrawer = () => {};');
  return { sandbox, document, state, run, seed, ctl, posted, polls };
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// ---------- T1 旧布局 + 派发设置失败：迁移入口保留，失败局部显示 ----------

t('T1 旧布局项目派发设置失败：不再整页替换设置视图，「数据布局迁移」卡片与「一键迁移到新布局」按钮保留可用，失败原因局部显示并可重试', async () => {
  const h = harness();
  const view = element();
  h.seed('#settingsView', view);
  await h.run('renderSettingsView()');
  const out = view.innerHTML;
  // 整页失败形态消失：不再出现旧的整页替换错误（含旧重试按钮 id）
  //（旧整页形态是唯一子结点 <div class="notice err">设置加载失败：…；据此与新局部错误区分）
  assert.doesNotMatch(out, /<div class="notice err">设置加载失败：/, '旧整页替换错误「设置加载失败：」不应再出现');
  assert.doesNotMatch(out, /id="stRetry"/, '旧整页重试按钮 stRetry 不应再出现');
  // 迁移入口保留（缺陷中随整页错误一起消失的部分）
  assert.match(out, /<h4>数据布局迁移<\/h4>/, '「数据布局迁移」卡片保留');
  assert.match(out, /id="lmMigrate">一键迁移到新布局</, '旧布局下迁移按钮可用（非禁用态）');
  assert.match(out, /检测到旧布局/, '布局检测提示保留（并行加载结果不被丢弃）');
  // 派发设置失败局部显示：独立区域 + 原因 + 重试
  assert.match(out, /派发设置加载失败：/, '派发设置失败局部显示原因');
  assert.match(out, /未找到 agent-team-board，请先初始化/, '服务端原因可见');
  assert.match(out, /id="csRetry"/, '派发设置失败提供重试按钮');
  // 迁移入口与失败反馈互相独立：错误区域不吞掉其余分区
  assert.match(out, /<h4>批量任务<\/h4>/, '「批量任务」分区不受派发设置失败影响');
});

// ---------- T2 布局检测失败：不误显示「无可迁移数据」，与派发设置失败互相独立 ----------

t('T2 布局检测失败：显示「布局检测失败」与重试，不误显示「无可迁移数据」；与派发设置失败同时可见（互相独立）', async () => {
  const h = harness();
  h.ctl.layout = 'fail';
  const view = element();
  h.seed('#settingsView', view);
  await h.run('renderSettingsView()');
  const out = view.innerHTML;
  assert.match(out, /布局检测失败：/, '检测失败就近显示原因');
  assert.match(out, /id="lmRetry"/, '检测失败提供重试按钮');
  assert.doesNotMatch(out, /无可迁移数据/, '检测失败不得误显示「无可迁移数据」');
  assert.doesNotMatch(out, /id="lmMigrate"/, '检测失败不渲染迁移按钮（避免误操作）');
  assert.match(out, /派发设置加载失败：/, '派发设置失败反馈与检测失败同时可见（互相独立）');
});

// ---------- T3 派发设置失败重试恢复 ----------

t('T3 派发设置失败后点重试：重新读取成功则局部错误消失，迁移卡片照常渲染', async () => {
  const h = harness();
  const view = element();
  h.seed('#settingsView', view);
  await h.run('renderSettingsView()');
  assert.match(view.innerHTML, /派发设置加载失败：/, '前置：失败已局部显示');
  h.ctl.dispatchSettings = 'ok';
  await view.querySelector('#csRetry').fire('click').result;
  const out = view.innerHTML;
  assert.doesNotMatch(out, /派发设置加载失败：/, '重试成功后局部错误消失');
  assert.doesNotMatch(out, /id="csRetry"/, '重试成功后重试按钮随之消失');
  assert.match(out, /<h4>数据布局迁移<\/h4>/, '重试后迁移卡片仍保留');
});

// ---------- T4 失败配置下迁移全链路：取消不发起 / 确认防重复 / 成功转新布局并刷新看板 ----------

t('T4 迁移确认取消不发起 /api/migrate；确认后仅带当前项目路径、执行中按钮禁用；成功后转「已是新布局」并刷新看板', async () => {
  const h = harness();
  const view = element();
  h.seed('#settingsView', view);
  await h.run('renderSettingsView()');
  const lm = view.querySelector('#lmMigrate');
  assert.match(view.innerHTML, /id="lmMigrate">一键迁移到新布局</, '前置：迁移按钮可用');

  // 取消：不发起迁移
  h.run('uiConfirm = async () => false');
  await lm.fire('click').result;
  assert.equal(h.posted.filter((p) => p.url === '/api/migrate').length, 0, '取消确认不得发起 /api/migrate');

  // 确认：门闩压住迁移响应，观察执行中防重复态
  let release;
  h.ctl.migrateGate = new Promise((r) => { release = r; });
  h.run('uiConfirm = async () => true');
  const clickP = lm.fire('click').result;
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(lm.disabled, true, '迁移执行中按钮禁用（防重复提交）');
  h.ctl.layout = 'modern'; // 迁移成功后服务端重检应得新布局
  release();
  await clickP;
  const mig = h.posted.filter((p) => p.url === '/api/migrate');
  assert.equal(mig.length, 1, '确认后恰好发起一次 /api/migrate');
  assert.equal(mig[0].body.path, '/project/a', '迁移仅作用于当前选中项目');
  // 成功后：布局重检为新布局，按钮转「已是新布局」禁用态，看板刷新
  assert.match(view.innerHTML, /id="lmMigrate" disabled>已是新布局</, '成功后布局卡片转「已是新布局」且按钮禁用');
  assert.ok(h.polls.length >= 1, '迁移成功后刷新当前项目看板（poll）');
});

// ---------- T5 迁移失败：保留原因与重试，不误报成功 ----------

t('T5 迁移失败：就近显示具体错误并可重试，不误显示「已是新布局」/成功态', async () => {
  const h = harness();
  const view = element();
  h.seed('#settingsView', view);
  await h.run('renderSettingsView()');
  // 迁移失败：fetch 返回错误经 api() 抛出
  h.ctl.migrateFail = 'git mv 失败：文件被占用';
  h.run('uiConfirm = async () => true');
  const lm = view.querySelector('#lmMigrate');
  await lm.fire('click').result;
  const out = view.innerHTML;
  assert.doesNotMatch(out, /已是新布局/, '迁移失败不得显示「已是新布局」');
  const st = view.querySelector('#lmStatus').textContent;
  assert.match(st, /git mv 失败：文件被占用/, '失败原因就近可见');
  assert.match(st, /可重试/, '失败后提示可重试');
  assert.match(out, /id="lmMigrate">一键迁移到新布局</, '失败后迁移按钮恢复可点（迁移幂等，可重试）');
  assert.doesNotMatch(out, /id="lmMigrate" disabled/, '失败后迁移按钮不得保持禁用');
});

// ---------- T6 i18n 同步：新增文案两语言成对 ----------

t('T6 新增界面文案中英同步：「派发设置」「派发设置加载失败：◇」均有英文词条（静态/动态各归其位）', () => {
  assert.match(i18nSource, /'派发设置':\s*'Dispatch settings'/, '「派发设置」静态词条应同步英文');
  assert.match(i18nSource, /'派发设置加载失败：◇':\s*'Failed to load dispatch settings: \$1'/, '「派发设置加载失败：◇」动态词条应同步英文');
  // ◇ 动态键不得混入静态词典（i18n-coverage C1b 同口径，此处直接锁新增两条）
  const staticSeg = i18nSource.match(/const EN = \{[\s\S]*?\n\};/);
  assert.ok(staticSeg, '应存在静态词典 EN');
  assert.ok(!staticSeg[0].includes('派发设置加载失败：◇'), '动态键不得进入静态词典');
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
