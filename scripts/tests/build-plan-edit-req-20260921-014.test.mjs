#!/usr/bin/env node
// REQ-20260921-014 概况页签（详情第 1 步「版本计划」）显式编辑版本名称与描述 —— vm 行为测试
// E1~E10。加载实际 build.js（假 DOM 接缝同 build-answer-edit-20260913-006.test.mjs），
// fetch stub 桩 /api/build/state 与 /api/build/version/save；经绑定的 click / input 监听
// 驱动「显式编辑 → 校验 → 保存 / 取消 / 切换重置」全过程。
// 用法：node scripts/tests/build-plan-edit-req-20260921-014.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import '../web/i18n.js';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const buildJs = fs.readFileSync(path.join(webRoot, 'build.js'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes, dataset: {}, innerHTML: '', textContent: '', value: '', title: '', disabled: false, checked: false, hidden: false, focused: false,
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(sel) { if (!nodes.has(sel)) nodes.set(sel, element()); return nodes.get(sel); },
    querySelectorAll() { return []; },
    appendChild(c) { this.children.push(c); },
    replaceChildren(...c) { this.children = c; },
    setAttribute() {}, removeAttribute() {},
    focus() { this.focused = true; },
    select() {}, remove() {},
    closest() { return null; },
  };
}

const H1 = 'a'.repeat(40);
// 两个版本：draft（可编辑，列表首位即默认选中）与 merging（锁定态）
const VER = {
  id: 'BLD-20260921-014', name: 'v1.0', description: '首个版本', status: 'draft', targetBranch: 'main',
  items: [{ itemId: 'REQ-20260921-014', commit: H1, title: '概况页签编辑', mergedAt: null, mergeError: null }],
  createdAt: '2026-09-21T01:00:00.000Z', updatedAt: '2026-09-21T02:00:00.000Z',
  merge: { startedAt: null, finishedAt: null, error: null, baseBranch: 'dev' },
};
const VER_MERGING = {
  ...VER, id: 'BLD-20260921-015', name: '合并中版本', description: '', status: 'merging',
  merge: { startedAt: '2026-09-21T03:00:00.000Z', finishedAt: null, error: null, baseBranch: 'dev' },
};

// setup：live 数据可被保存请求改写（模拟服务端持久化），保存可注入失败 / 门闸
function setup({ emptyDesc = false } = {}) {
  const document = element();
  document.createElement = element;
  document.body = element();
  document.nodes.set('#buildView', element());
  document.addEventListener = () => {};
  const base = emptyDesc ? { ...VER, description: '' } : VER;
  const live = { version: JSON.parse(JSON.stringify(base)) };
  const saves = [];
  const toasts = [];
  let saveFail = null; // { status, error } 注入失败（含 merging 409）
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
        return { ok: true, json: async () => ({ initialized: true, isRepo: true, currentBranch: 'dev', versions: [JSON.parse(JSON.stringify(live.version)), JSON.parse(JSON.stringify(VER_MERGING))] }) };
      }
      if (u.pathname === '/api/build/version/save') {
        const body = JSON.parse(opts.body || '{}');
        saves.push(body);
        if (saveGate) await saveGate;
        if (saveFail) return { ok: false, status: saveFail.status, json: async () => ({ error: saveFail.error }) };
        live.version = { ...live.version, ...body, updatedAt: '2026-09-21T08:00:00.000Z' };
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
  const docEl = (sel) => document.querySelector(sel);
  const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
  return {
    sandbox, run, view, inner, el, docEl, flush, saves, toasts, live,
    setSaveFail: (status, error) => { saveFail = { status, error }; },
    clearSaveFail: () => { saveFail = null; },
    gateSave: () => { let release; saveGate = new Promise((res) => { release = res; }); return release; },
    async open() { await run(`window.ATBBuild.enter('/p/a')`); },
    openEdit: () => el('#bldEditInfo').listeners.click(),
    save: () => el('#bldPlanSave').listeners.click(),
    cancel: () => el('#bldPlanCancel').listeners.click(),
    setName: (v) => { el('.bld-plan-name').value = v; el('.bld-plan-name').listeners.input(); },
    setDesc: (v) => { el('.bld-plan-desc').value = v; el('.bld-plan-desc').listeners.input(); },
  };
}

/* ---------- E1 显式入口与表单预填 ---------- */

t('E1 概况页签显式「编辑」按钮可见；空描述占位「（无描述）」；点开就地出表单（预填 + 计数器 + 保存 / 取消），焦点落名称输入框', async () => {
  const h = setup({ emptyDesc: true });
  await h.open();
  const before = h.inner();
  assert.match(before, /id="bldEditInfo"[^>]*>编辑</, '概况页签存在显式可见的「编辑」按钮');
  assert.doesNotMatch(before, /id="bldEditInfo"[^>]*disabled/, 'draft 版本编辑按钮可用');
  assert.match(before, /（无描述）/, '空描述显示占位（不伪装成有内容）');
  assert.doesNotMatch(before, /bld-plan-name/, '未进入编辑态不出表单');
  h.openEdit();
  const editing = h.inner();
  assert.match(editing, /class="[^"]*bld-plan-edit[^"]*"/, '就地编辑表单容器出现（不弹窗不跳步）');
  assert.match(editing, /<input class="bld-plan-name"[^>]*value="v1\.0"/, '名称单行输入预填当前值');
  assert.match(editing, /<textarea class="bld-plan-desc"[^>]*><\/textarea>/, '描述多行文本域预填当前值（空）');
  assert.match(editing, /id="bldPlanSave"[^>]*>保存</, '保存按钮存在');
  assert.match(editing, /id="bldPlanCancel"[^>]*>取消</, '取消按钮存在');
  assert.match(editing, /data-plan-count="name"[^>]*>4 \/ 80</, '名称计数器 4 / 80');
  assert.match(editing, /data-plan-count="desc"[^>]*>0 \/ 4000</, '描述计数器 0 / 4000');
  assert.doesNotMatch(editing, /bld-desc-block/, '编辑态替换描述展示块（就地替换）');
  assert.equal(h.docEl('#bldPlanNameInput').focused, true, '打开后焦点落名称输入框');
});

/* ---------- E2 客户端校验不发请求 ---------- */

t('E2 校验就地拦截不发请求：名称空白 → 不能为空；名称 81 字 / 描述 4001 字 → 超长上限提示；错误就地展示', async () => {
  const h = setup();
  await h.open();
  h.openEdit();
  h.setName('   ');
  await h.save();
  await h.flush();
  assert.equal(h.saves.length, 0, '名称空白不发保存请求');
  assert.match(h.inner(), /版本名称不能为空/, '错误文案与数据层口径一致');
  assert.match(h.inner(), /bld-plan-err/, '就地错误区展示');

  h.setName('名'.repeat(81));
  await h.save();
  await h.flush();
  assert.equal(h.saves.length, 0, '名称 81 字不发保存请求');
  assert.match(h.inner(), /版本名称不超过 80 字/, '名称上限提示');

  h.setName('v2.0');
  h.setDesc('述'.repeat(4001));
  await h.save();
  await h.flush();
  assert.equal(h.saves.length, 0, '描述 4001 字不发保存请求');
  assert.match(h.inner(), /版本描述不超过 4000 字/, '描述上限提示');
  // 修正后可保存成功（同一表单重试）
  h.setDesc('述'.repeat(4000));
  await h.save();
  await h.flush();
  assert.equal(h.saves.length, 1, '改回合法值后重试发出保存请求');
});

/* ---------- E3 保存成功 ---------- */

t('E3 保存成功：名称与描述同一请求提交；退出编辑态、详情 / 左侧列表名称同步刷新；toast「✓ 已保存版本信息」', async () => {
  const h = setup();
  await h.open();
  h.openEdit();
  h.setName('v2.0 手动修订版');
  h.setDesc('经概况页签表单修订的描述。');
  await h.save();
  await h.flush();
  assert.equal(h.saves.length, 1, '只发一次保存请求');
  assert.deepEqual(
    { id: h.saves[0].id, name: h.saves[0].name, description: h.saves[0].description },
    { id: 'BLD-20260921-014', name: 'v2.0 手动修订版', description: '经概况页签表单修订的描述。' },
    '名称与描述经同一请求提交（一次保存同时修改两者）',
  );
  assert.ok(h.toasts.some((x) => x.m === '✓ 已保存版本信息'), '成功 toast 口径');
  const after = h.inner();
  assert.doesNotMatch(after, /bld-plan-name/, '成功后退出编辑态回展示');
  assert.match(after, /v2\.0 手动修订版/, '详情头部 / 列表名称同步更新');
  assert.match(after, /经概况页签表单修订的描述。/, '概况页签描述就地刷新');
});

/* ---------- E4 保存失败（含 merging 409）保留内容可重试 ---------- */

t('E4 保存失败（merging 409「版本合并中，暂不可修改」）：toast ✕ 保存失败：<原因> + 就地原因；表单与内容保留；重试成功', async () => {
  const h = setup();
  await h.open();
  h.openEdit();
  h.setName('v2.0 失败重试版');
  h.setDesc('先失败一次。');
  h.setSaveFail(409, '版本合并中，暂不可修改');
  await h.save();
  await h.flush();
  assert.equal(h.saves.length, 1, '失败的那次请求已发出');
  assert.ok(h.toasts.some((x) => x.isErr === true && x.m === '✕ 保存失败：版本合并中，暂不可修改'), '失败 toast：✕ 保存失败：<原因>');
  const failed = h.inner();
  assert.match(failed, /版本合并中，暂不可修改/, '就地显示失败原因');
  assert.match(failed, /value="v2\.0 失败重试版"/, '失败后表单内容保留');
  assert.match(failed, /id="bldPlanSave"[^>]*>保存</, '失败后保存键恢复可点（非禁用、非进行中）');
  h.clearSaveFail();
  h.setName('v2.0 重试成功版');
  await h.save();
  await h.flush();
  assert.equal(h.saves.length, 2, '重试发出第二次保存请求');
  assert.equal(h.saves[1].name, 'v2.0 重试成功版', '重试保存修改后的值');
  assert.ok(h.toasts.some((x) => x.m === '✓ 已保存版本信息'), '重试成功 toast');
  assert.doesNotMatch(h.inner(), /bld-plan-name/, '成功后退出编辑态');
});

/* ---------- E5 保存中防重复 ---------- */

t('E5 保存中：按钮「保存中…」且禁用；连点只发一次请求；完成后退出编辑态', async () => {
  const h = setup();
  await h.open();
  h.openEdit();
  h.setName('v2.0 防重复');
  h.setDesc('保存中不可重复触发。');
  const release = h.gateSave();
  const p = h.save();
  await Promise.resolve();
  const busy = h.inner();
  assert.match(busy, /id="bldPlanSave" disabled/, '保存中保存键禁用');
  assert.match(busy, /id="bldPlanSave"[^>]*>保存中…</, '保存键显示进行中状态');
  assert.match(busy, /id="bldPlanCancel" disabled/, '保存中取消键禁用');
  h.save(); // 在途再次点击：busy 守卫直接忽略
  release();
  await p;
  await h.flush();
  assert.equal(h.saves.length, 1, '完成后仅一次保存（防重复触发）');
  assert.doesNotMatch(h.inner(), /bld-plan-name/, '成功后退出编辑态');
});

/* ---------- E6 取消与切换重置（不误保存） ---------- */

t('E6 取消放弃修改回展示态；切换版本 / 步骤 / 项目编辑态重置为展示态、不发保存请求', async () => {
  const h = setup();
  await h.open();
  h.openEdit();
  h.setName('未保存草稿名');
  h.setDesc('未保存草稿描述。');
  h.cancel();
  assert.equal(h.saves.length, 0, '取消不发保存请求');
  const canceled = h.inner();
  assert.doesNotMatch(canceled, /bld-plan-name/, '取消退出编辑态');
  assert.doesNotMatch(canceled, /未保存草稿名/, '未保存修改不上屏');

  // 切换步骤：编辑态重置
  h.openEdit();
  h.setName('切步骤丢弃');
  h.run(`window.ATBBuild.setStep('link')`);
  assert.doesNotMatch(h.inner(), /bld-plan-name/, '切换步骤页签编辑态重置');
  h.run(`window.ATBBuild.setStep('plan')`);
  assert.doesNotMatch(h.inner(), /bld-plan-name/, '切回概况页签不恢复编辑态（草稿已丢弃）');

  // 切换版本：编辑态重置（换到 merging 版本后再切回，表单不再出现）
  h.openEdit();
  h.setName('切版本丢弃');
  h.run(`window.ATBBuild.selectVersion('BLD-20260921-015')`);
  h.run(`window.ATBBuild.setStep('plan')`);
  assert.doesNotMatch(h.inner(), /bld-plan-name/, '切换版本编辑态重置');
  h.run(`window.ATBBuild.selectVersion('BLD-20260921-014')`);
  h.run(`window.ATBBuild.setStep('plan')`);
  assert.doesNotMatch(h.inner(), /bld-plan-name/, '切回原版本不恢复编辑态');

  // 切换项目：编辑态重置
  h.openEdit();
  h.setName('切项目丢弃');
  await h.run(`window.ATBBuild.enter('/p/b')`);
  await h.flush();
  assert.doesNotMatch(h.inner(), /bld-plan-name/, '切换项目编辑态重置');
  assert.equal(h.saves.length, 0, '任何切换路径都不发保存请求（不误保存）');
});

/* ---------- E7 merging 锁定 ---------- */

t('E7 merging 版本：编辑按钮禁用 + title「版本合并中，暂不可修改」；行内点击入口同样收口不进编辑', async () => {
  const h = setup();
  await h.open();
  h.run(`window.ATBBuild.selectVersion('BLD-20260921-015')`);
  h.run(`window.ATBBuild.setStep('plan')`);
  const locked = h.inner();
  assert.match(locked, /id="bldEditInfo" disabled title="版本合并中，暂不可修改"/, 'merging 编辑入口禁用并带文字原因（不只靠颜色）');
  assert.match(locked, /合并中，请稍候/, '页签内就地合并提示');
  // 行内点击入口（遗留快捷路径）同样收口：不进编辑、toast 原因
  h.el('.bld-name').listeners.click();
  const afterName = h.inner();
  assert.doesNotMatch(afterName, /bld-name-input/, 'merging 行内点击不进入名称编辑');
  assert.ok(h.toasts.some((x) => x.isErr === true && x.m === '版本合并中，暂不可修改'), '行内点击 toast 锁定原因');
});

/* ---------- E8 后台重渲染不丢草稿 ---------- */

t('E8 后台重渲染（refresh）不冲掉表单未保存草稿（草稿经输入回写 / render 回同步保留）', async () => {
  const h = setup();
  await h.open();
  h.openEdit();
  h.setName('v2.0 重渲染幸存版');
  h.setDesc('重渲染后仍在的描述。');
  await h.run(`window.ATBBuild.refresh()`);
  await h.flush();
  const inner = h.inner();
  assert.match(inner, /value="v2\.0 重渲染幸存版"/, '重渲染后名称草稿保留');
  assert.match(inner, /<textarea class="bld-plan-desc"[^>]*>重渲染后仍在的描述。<\/textarea>/, '重渲染后描述草稿保留');
  await h.save();
  await h.flush();
  assert.equal(h.saves.length, 1, '草稿未被冲掉，保存提交草稿值');
  assert.equal(h.saves[0].name, 'v2.0 重渲染幸存版', '保存的是草稿值');
});

/* ---------- E9 纯函数 validateVersionInfo ---------- */

t('E9 validateVersionInfo：空白 / 空名称、80/81 与 4000/4001 边界、出错字段归因；合法输入返回 null', async () => {
  const h = setup();
  const v = h.run(`window.ATBBuild.validateVersionInfo`);
  assert.equal(v('  ', 'x').error, '版本名称不能为空', '空白名称视为空');
  assert.equal(v('', '').error, '版本名称不能为空', '空名称视为空');
  assert.equal(v('名'.repeat(80), '述'.repeat(4000)), null, '80 / 4000 恰好合法');
  const long = v('名'.repeat(81), '');
  assert.equal(long.error, '版本名称不超过 80 字');
  assert.equal(long.field, 'name', '出错字段归因名称');
  const longDesc = v('v1', '述'.repeat(4001));
  assert.equal(longDesc.error, '版本描述不超过 4000 字');
  assert.equal(longDesc.field, 'desc', '出错字段归因描述');
  assert.equal(v('  v1  ', ''), null, '合法输入（名称含首尾空白由数据层 trim）返回 null');
});

/* ---------- E10 i18n 同步 ---------- */

t('E10 i18n 同步（BUG-20260912-001）：本单新增与所涉欠账文案入 EN / EN_DYNAMIC 词典', () => {
  const I = globalThis.ATBI18N;
  const { EN, EN_DYNAMIC } = I._dict;
  for (const zh of [
    '版本名称', '版本描述', '版本名称不能为空', '版本名称不超过 80 字', '版本描述不超过 4000 字',
    '版本合并中，暂不可修改', '✓ 已保存版本信息', '（无描述）', '编辑版本信息',
    '点击编辑名称', '点击编辑描述',
  ]) {
    assert.ok(zh in EN, `EN 词典应含「${zh}」`);
  }
  assert.ok('✕ 保存失败：◇' in EN_DYNAMIC, 'EN_DYNAMIC 应含「✕ 保存失败：◇」');
  assert.ok(!('（无描述，点击补充）' in EN), '旧占位文案已随「（无描述）」清理');
});

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
if (failed) {
  console.error(`\n${failed} 个用例失败`);
  process.exit(1);
}
console.log(`\n全部通过（${cases.length} 例）`);
