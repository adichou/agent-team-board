#!/usr/bin/env node
// REQ-20260913-006 AI 完善弹窗回填可编辑——vm 行为测试 E1~E7。
// 加载实际 build.js（假 DOM 接缝同 build-ui.test.mjs），fetch stub 桩
// /api/build/state 与 /api/build/version/save；经绑定的 click / input 监听
// 驱动「粘贴回答 → 解析并预览 → 编辑 → 应用」全过程。
// 用法：node scripts/tests/build-answer-edit-20260913-006.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const buildJs = fs.readFileSync(path.join(webRoot, 'build.js'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

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

const H1 = 'a'.repeat(40);
const VER = {
  id: 'BLD-20260913-006', name: 'v1.0', description: '首个版本', status: 'draft', targetBranch: 'main',
  items: [{ itemId: 'REQ-20260913-006', commit: H1, title: '回填可编辑', mergedAt: null, mergeError: null }],
  createdAt: '2026-09-13T01:00:00.000Z', updatedAt: '2026-09-13T02:00:00.000Z',
  merge: { startedAt: null, finishedAt: null, error: null, baseBranch: 'dev' },
};

const GOOD_ANSWER = '版本名称：v2.0 智能润色版\n版本描述：\n综合本轮条目，支持回填前人工微调。';

// setup：live 数据可被保存请求改写（模拟服务端持久化），保存可注入失败 / 门闸
function setup() {
  const document = element();
  document.createElement = element;
  document.body = element();
  document.nodes.set('#buildView', element());
  document.addEventListener = () => {};
  const live = { version: JSON.parse(JSON.stringify(VER)) };
  const saves = [];
  const toasts = [];
  let saveFail = null; // { status, error } 注入失败
  let saveGate = null; // Promise 门闸：暂停在途保存
  const sandbox = {
    document, console, URLSearchParams,
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    fetch: async (url, opts) => {
      const u = new URL(String(url), 'http://local');
      if (u.pathname === '/api/build/state') {
        return { ok: true, json: async () => ({ initialized: true, isRepo: true, currentBranch: 'dev', versions: [JSON.parse(JSON.stringify(live.version))] }) };
      }
      if (u.pathname === '/api/build/version/save') {
        const body = JSON.parse(opts.body || '{}');
        saves.push(body);
        if (saveGate) await saveGate;
        if (saveFail) return { ok: false, status: saveFail.status, json: async () => ({ error: saveFail.error }) };
        live.version = { ...live.version, ...body, updatedAt: '2026-09-14T01:00:00.000Z' };
        return { ok: true, json: async () => ({ ok: true, id: body.id }) };
      }
      return { ok: true, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox;
  sandbox.toast = (m, isErr) => toasts.push({ m, isErr });
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const view = () => run(`document.querySelector('#buildView')`);
  const inner = () => view().innerHTML;
  const el = (sel) => view().querySelector(sel);
  const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
  return {
    sandbox, run, view, inner, el, flush, saves, toasts, live,
    setSaveFail: (status, error) => { saveFail = { status, error }; },
    clearSaveFail: () => { saveFail = null; },
    gateSave: () => { let release; saveGate = new Promise((res) => { release = res; }); return release; },
    async open() {
      await run(`window.ATBBuild.enter('/p/a')`);
      run(`window.ATBBuild.openAnswerModal('BLD-20260913-006')`);
    },
    setAnswer: (text) => { el('.bld-answer-input').value = text; },
    parse: () => el('#bldParseBtn').listeners.click(),
    setName: (v) => { el('.bld-name-edit').value = v; el('.bld-name-edit').listeners.input(); },
    setDesc: (v) => { el('.bld-desc-edit').value = v; el('.bld-desc-edit').listeners.input(); },
    apply: () => el('#bldApplyBtn').listeners.click(),
  };
}

/* ---------- E1 解析成功出编辑表单 ---------- */

t('E1 解析成功：预览区改编辑表单——引导语 / 名称输入框 / 描述文本域预填解析值 / muted 当前值对照；旧只读对照样式不再出现', async () => {
  const h = setup();
  await h.open();
  h.setAnswer(GOOD_ANSWER);
  h.parse();
  const inner = h.inner();
  assert.match(inner, /解析结果可直接修改，点「应用」保存修改后的值/, '引导语：可直接修改后再应用');
  assert.match(inner, /<input class="bld-name-edit" type="text" value="v2\.0 智能润色版">/, '名称单行输入框预填解析值');
  assert.match(inner, /<textarea class="bld-desc-edit" rows="4">综合本轮条目，支持回填前人工微调。<\/textarea>/, '描述多行文本域预填解析值');
  assert.match(inner, /版本名称（当前：v1\.0）/, '名称 label 带 muted 当前值对照');
  assert.match(inner, /版本描述（当前：首个版本）/, '描述 label 带 muted 当前值对照');
  assert.match(inner, /class="bld-preview bld-edit-form"/, '编辑表单容器沿用 bld-preview 骨架');
  assert.doesNotMatch(inner, /→/, '旧只读「旧值 → 新值」对照样式不再出现');
  assert.match(inner, /id="bldApplyBtn"[^>]*>应用</, '名称非空：应用键可用');
  assert.doesNotMatch(inner, /id="bldApplyBtn"[^>]*disabled/, '解析成功且名称非空不禁用应用');
  assert.match(inner, /class="rel-form-err bld-name-err hidden"/, '名称非空：错误提示隐藏');
});

/* ---------- E2 编辑后应用保存编辑值 ---------- */

t('E2 编辑后应用：保存接口收到编辑后的值；未修改直接应用保存解析原值；成功关弹窗 + toast', async () => {
  const h = setup();
  await h.open();
  h.setAnswer(GOOD_ANSWER);
  h.parse();
  h.setName('v2.0 智能润色版（人工定稿）');
  h.setDesc('综合本轮条目，支持回填前人工微调。\n另补一行人工备注。');
  await h.apply();
  await h.flush();
  assert.equal(h.saves.length, 1, '只发一次保存请求');
  assert.deepEqual(
    { id: h.saves[0].id, name: h.saves[0].name, description: h.saves[0].description },
    { id: 'BLD-20260913-006', name: 'v2.0 智能润色版（人工定稿）', description: '综合本轮条目，支持回填前人工微调。\n另补一行人工备注。' },
    '保存的是编辑后的名称与描述（非解析原值）',
  );
  assert.ok(h.toasts.some((x) => x.m === '✓ 已应用回填：版本名称与描述已更新'), '成功 toast 口径不变');
  assert.doesNotMatch(h.inner(), /AI 完善（BLD-20260913-006）/, '成功后关闭弹窗');
  assert.match(h.inner(), /v2\.0 智能润色版（人工定稿）/, '刷新后卡片 / 详情反映编辑后的名称');

  // 未修改直接应用：保存解析原值（与现状一致）
  // （假 DOM 不解析 innerHTML：先按渲染出的预填值落到输入节点，模拟真实 DOM 状态、用户未改动）
  const h2 = setup();
  await h2.open();
  h2.setAnswer(GOOD_ANSWER);
  h2.parse();
  h2.setName('v2.0 智能润色版');
  h2.setDesc('综合本轮条目，支持回填前人工微调。');
  await h2.apply();
  await h2.flush();
  assert.equal(h2.saves.length, 1, '未修改场景只发一次保存请求');
  assert.equal(h2.saves[0].name, 'v2.0 智能润色版', '未修改时保存解析出的名称原值');
  assert.equal(h2.saves[0].description, '综合本轮条目，支持回填前人工微调。', '未修改时保存解析出的描述原值');
  assert.equal(h2.saves[0].id, 'BLD-20260913-006', '保存请求携带版本号');

  // 描述编辑为空：允许保存成功（与数据层「描述可空」口径一致）
  const h3 = setup();
  await h3.open();
  h3.setAnswer(GOOD_ANSWER);
  h3.parse();
  h3.setName('v2.0 清空描述版');
  h3.setDesc('');
  await h3.apply();
  await h3.flush();
  assert.equal(h3.saves.length, 1, '描述清空不拦截保存');
  assert.equal(h3.saves[0].name, 'v2.0 清空描述版', '保存编辑后的名称');
  assert.equal(h3.saves[0].description, '', '描述编辑为空可成功保存');
  assert.ok(h3.toasts.some((x) => x.m === '✓ 已应用回填：版本名称与描述已更新'), '描述空保存成功 toast');
});

/* ---------- E3 名称空拒绝应用 ---------- */

t('E3 名称空：解析出空名称即显错误并禁用应用（带 title）；清空输入即时提示；此时点应用不发请求；改回非空恢复并成功应用', async () => {
  const h = setup();
  await h.open();
  // 场景 1：Agent 回答名称行为空 → 解析成功但名称空（名称行置于末行，正则捕获到空串）
  h.setAnswer('版本描述：先把描述写在前面\n版本名称：\n');
  h.parse();
  let inner = h.inner();
  assert.match(inner, /class="rel-form-err bld-name-err"/, '解析出空名称：错误提示即时可见（无 hidden）');
  assert.match(inner, /版本名称不能为空/, '错误文案口径与数据层一致');
  assert.match(inner, /id="bldApplyBtn" disabled title="版本名称不能为空"/, '应用键禁用并带 title 说明');
  await h.apply();
  await h.flush();
  assert.equal(h.saves.length, 0, '名称空点应用不发保存请求（前端即时校验）');

  // 场景 2：解析正常后清空输入 → input 事件即时校验（不整页重渲染）
  const h2 = setup();
  await h2.open();
  h2.setAnswer(GOOD_ANSWER);
  h2.parse();
  const nameEl = h2.el('.bld-name-edit');
  const errEl = h2.el('.bld-name-err');
  const applyBtn = h2.el('#bldApplyBtn');
  nameEl.value = '   '; // 纯空白同样视为空
  nameEl.listeners.input();
  assert.equal(errEl.classList.contains('hidden'), false, '清空名称：错误提示即时显示');
  assert.equal(applyBtn.disabled, true, '清空名称：应用键即时禁用');
  assert.equal(applyBtn.title, '版本名称不能为空', '禁用态 title 说明原因');
  await h2.apply();
  await h2.flush();
  assert.equal(h2.saves.length, 0, '空白名称点应用仍不发请求');
  // 改回非空：即时恢复可用并可成功应用（描述节点同步渲染预填值，模拟真实 DOM 未改动状态）
  nameEl.value = 'v2.0 重新填好';
  nameEl.listeners.input();
  assert.equal(errEl.classList.contains('hidden'), true, '改回非空：错误提示即时隐藏');
  assert.equal(applyBtn.disabled, false, '改回非空：应用键即时恢复');
  h2.setDesc('综合本轮条目，支持回填前人工微调。');
  await h2.apply();
  await h2.flush();
  assert.equal(h2.saves.length, 1, '恢复后应用发出保存请求');
  assert.equal(h2.saves[0].name, 'v2.0 重新填好', '保存改回后的名称');
});

/* ---------- E4 重新解析覆盖未保存修改 ---------- */

t('E4 重新解析：回答更新后再解析以最新结果预填，未保存的手工修改被覆盖；解析失败不出编辑表单、原文保留', async () => {
  const h = setup();
  await h.open();
  h.setAnswer(GOOD_ANSWER);
  h.parse();
  h.setName('手工改的名称（未保存）');
  h.setDesc('手工改的描述（未保存）');
  // 更新回答原文后重新解析
  h.setAnswer('版本名称：v3.0 最新解析\n版本描述：\n以最新回答为准。');
  h.parse();
  const inner = h.inner();
  assert.match(inner, /value="v3\.0 最新解析"/, '重新解析后名称预填最新解析值');
  assert.match(inner, /<textarea class="bld-desc-edit"[^>]*>以最新回答为准。<\/textarea>/, '重新解析后描述预填最新解析值');
  assert.doesNotMatch(inner, /手工改的名称（未保存）|手工改的描述（未保存）/, '未保存的手工修改被覆盖');
  assert.doesNotMatch(inner, /value="v2\.0 智能润色版"/, '旧解析值同样被覆盖');
  assert.equal(h.el('.bld-answer-input').value, '版本名称：v3.0 最新解析\n版本描述：\n以最新回答为准。', '回答原文保留在输入框');
  // 解析失败：错误提示 + 原文保留 + 不出编辑表单（旧表单一并收起）
  h.setAnswer('这段回答不符合约定格式');
  h.parse();
  const bad = h.inner();
  assert.match(bad, /未解析到「版本名称：」行/, '解析失败错误提示口径不变');
  assert.match(bad, /这段回答不符合约定格式/, '原文保留可重试');
  assert.doesNotMatch(bad, /bld-edit-form|bld-name-edit/, '解析失败不出编辑表单');
});

/* ---------- E5 应用失败保留弹窗与编辑内容可重试 ---------- */

t('E5 应用失败：toast ✕ 保存失败：<原因>；弹窗与编辑内容保留、按钮恢复；修改后重试成功', async () => {
  const h = setup();
  await h.open();
  h.setAnswer(GOOD_ANSWER);
  h.parse();
  h.setName('v2.0 失败重试版');
  h.setDesc('先失败一次的描述。');
  h.setSaveFail(409, '版本合并中，暂不可修改');
  await h.apply();
  await h.flush();
  assert.equal(h.saves.length, 1, '失败的那次请求已发出');
  assert.ok(h.toasts.some((x) => x.isErr === true && x.m === '✕ 保存失败：版本合并中，暂不可修改'), '失败 toast：✕ 保存失败：<原因>');
  const inner = h.inner();
  assert.match(inner, /AI 完善（BLD-20260913-006）/, '失败后弹窗保留');
  assert.match(inner, /value="v2\.0 失败重试版"/, '失败后编辑内容保留');
  assert.match(inner, /<textarea class="bld-desc-edit"[^>]*>先失败一次的描述。<\/textarea>/, '失败后描述编辑内容保留');
  assert.match(inner, /id="bldApplyBtn"[^>]*>应用</, '失败后应用键恢复可点（非禁用、非进行中）');
  // 修改后重试成功
  h.clearSaveFail();
  h.setName('v2.0 重试成功版');
  await h.apply();
  await h.flush();
  assert.equal(h.saves.length, 2, '重试发出第二次保存请求');
  assert.equal(h.saves[1].name, 'v2.0 重试成功版', '重试保存重试前修改的值');
  assert.ok(h.toasts.some((x) => x.m === '✓ 已应用回填：版本名称与描述已更新'), '重试成功 toast');
  assert.doesNotMatch(h.inner(), /AI 完善（BLD-20260913-006）/, '重试成功后关闭弹窗');
});

/* ---------- E6 应用进行中防重复 ---------- */

t('E6 应用进行中：应用 / 解析并预览禁用，应用显示进行中状态；完成后恢复', async () => {
  const h = setup();
  await h.open();
  h.setAnswer(GOOD_ANSWER);
  h.parse();
  // 假 DOM 按渲染预填值落到输入节点（模拟真实 DOM 未改动状态）
  h.setName('v2.0 智能润色版');
  h.setDesc('综合本轮条目，支持回填前人工微调。');
  const release = h.gateSave();
  const p = h.apply();
  await Promise.resolve();
  const busy = h.inner();
  assert.match(busy, /id="bldParseBtn" disabled/, '进行中「解析并预览」禁用');
  assert.match(busy, /id="bldApplyBtn" disabled/, '进行中「应用」禁用');
  assert.match(busy, /id="bldApplyBtn"[^>]*>应用中…</, '应用键显示进行中状态');
  release();
  await p;
  await h.flush();
  assert.equal(h.saves.length, 1, '完成后仅一次保存（防重复触发）');
  assert.doesNotMatch(h.inner(), /AI 完善（BLD-20260913-006）/, '成功后关闭弹窗');
});

/* ---------- E7 后台重渲染不丢编辑 ---------- */

t('E7 后台重渲染不丢编辑：弹窗打开且已编辑时触发其他重渲染（复制提示词），编辑值与回答草稿保留', async () => {
  const h = setup();
  await h.open();
  h.setAnswer(GOOD_ANSWER);
  h.parse();
  h.setName('v2.0 重渲染幸存版');
  h.setDesc('重渲染后仍在的描述。');
  // 复制提示词会触发一次弹窗重渲染（a.copied 标记）
  h.el('#bldCopyPrompt').listeners.click();
  await h.flush();
  const inner = h.inner();
  assert.match(inner, /value="v2\.0 重渲染幸存版"/, '重渲染后名称编辑值保留');
  assert.match(inner, /<textarea class="bld-desc-edit"[^>]*>重渲染后仍在的描述。<\/textarea>/, '重渲染后描述编辑值保留');
  // 未解析的回答草稿同样不丢（粘贴后先点了复制提示词的场景）
  const h2 = setup();
  await h2.open();
  h2.setAnswer('版本名称：草稿\n版本描述：\n还没解析。');
  h2.el('#bldCopyPrompt').listeners.click();
  await h2.flush();
  assert.match(h2.inner(), /版本名称：草稿[\s\S]*?还没解析。/, '重渲染后回答草稿保留');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
