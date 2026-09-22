#!/usr/bin/env node
// BUG-20260922-006 创建版本面板：版本名称 / 版本号输入框上移到面板 body 顶部（候选清单之前）
// 覆盖（test-cases.md）：U1 顺序契约 / U2 守卫与事件绑定不回归。
// 用法：node scripts/tests/bug-20260922-006.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const src = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'build.js'), 'utf8');

// 提取 renderPanel 函数体（起于函数声明，止于下一个同级 function 声明）
function renderPanelSrc() {
  const start = src.indexOf('function renderPanel(');
  assert.ok(start >= 0, 'build.js 应存在 renderPanel 函数');
  const end = src.indexOf('\n  function ', start + 10);
  assert.ok(end > start, '应能定位 renderPanel 函数体边界');
  return src.slice(start, end);
}

// ---------- U1 顺序契约 ----------

t('U1 顺序契约：两输入框位于 panel body 顶部（读取错误之后、候选清单 / 加载态之前），且不重复渲染', () => {
  const region = renderPanelSrc();
  const idx = {
    loadError: region.indexOf('p.loadError'),
    name: region.indexOf('bldNewName'),
    version: region.indexOf('bldNewVersion'),
    loading: region.indexOf('正在读取条目'),
    pickBar: region.indexOf('bld-pick-bar'),
    rows: region.indexOf('renderCandidateRows('),
    error: region.indexOf('p.error'),
  };
  for (const k of Object.keys(idx)) {
    assert.ok(idx[k] >= 0, `renderPanel 应包含标记 ${k}`);
  }
  assert.ok(idx.loadError < idx.name && idx.loadError < idx.version, '读取错误提示仍在最前（重试入口优先可见）');
  assert.ok(idx.name < idx.loading && idx.version < idx.loading, '加载态文案应在两输入框之后（候选加载中也可填写）');
  assert.ok(idx.name < idx.pickBar && idx.version < idx.pickBar, '版本名称 / 版本号输入框应在全选栏之前');
  assert.ok(idx.name < idx.rows && idx.version < idx.rows, '版本名称 / 版本号输入框应在候选行之前');
  assert.equal((region.match(/bldNewName/g) || []).length, 1, 'bldNewName 在 renderPanel 内只渲染一次');
  assert.equal((region.match(/bldNewVersion/g) || []).length, 1, 'bldNewVersion 在 renderPanel 内只渲染一次');
});

// ---------- U2 守卫与事件绑定不回归 ----------

t('U2 守卫与行为不回归：两框仍受 createPanel 守卫（addPanel 不出现）；input 监听绑定保留', () => {
  const region = renderPanelSrc();
  const guarded = (region.match(/p === state\.createPanel \?/g) || []).length;
  assert.ok(guarded >= 2, `两输入框应保持 createPanel 守卫（实际 ${guarded} 处）`);
  assert.ok(/p === state\.createPanel \? `<label class="field">版本名称（留空自动命名/.test(region), '版本名称输入框应带 createPanel 守卫');
  assert.ok(/p === state\.createPanel \? `<label class="field">版本号（x\.y\.z 语义化格式/.test(region), '版本号输入框应带 createPanel 守卫');
  assert.ok(src.includes("q('#bldNewName')") && src.includes("q('#bldNewVersion')"), '事件绑定选择器应保留');
  assert.ok(/bldNewName[\s\S]{0,400}addEventListener\('input'/.test(src), 'bldNewName 的 input 监听应保留');
  assert.ok(/bldNewVersion[\s\S]{0,400}addEventListener\('input'/.test(src), 'bldNewVersion 的 input 监听应保留');
});

// ---------- 执行 ----------

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
