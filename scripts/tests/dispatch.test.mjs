#!/usr/bin/env node
// REQ-20260907-007 删除详情页一键派单（派单只能通过批量实施）—— 静态契约测试
// 用法：node scripts/tests/dispatch.test.mjs
// 历史：REQ-20260902-004 引入一键派发，REQ-20260906-019 codex 改走调度器，本条目整体移除。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('R1 前端契约：一键派单函数与按钮全部移除（REQ-20260907-007）', () => {
  for (const fn of ['dispatchPrompt', 'dispatchBtnHtml', 'flashDispatchBtn', 'launchCodex', 'launchZcode']) {
    assert.doesNotMatch(js, new RegExp(`function ${fn}\\b`), `不得残留函数 ${fn}`);
    assert.doesNotMatch(js, new RegExp(`\\b${fn}\\(`), `不得残留调用 ${fn}`);
  }
  assert.doesNotMatch(js, /data-dispatch/, '不得残留 [data-dispatch] 按钮与事件绑定');
  assert.doesNotMatch(js, /dispatch-row/, '不得残留派发区容器');
  assert.doesNotMatch(js, /派发给 zcode/, '不得残留 zcode 派发按钮文案');
  assert.doesNotMatch(js, /派发给 codex/, '不得残留 codex 派发按钮文案');
  assert.doesNotMatch(js, /一键派发/, '不得残留一键派发文案');
});

t('R2 保留契约：copyDispatchText 剪贴板工具保留（批量实施提示词复制在用）', () => {
  const clipboardFn = js.match(/function copyDispatchText[\s\S]{0,400}/);
  assert.ok(clipboardFn, '应保留 copyDispatchText（批量实施提示词复制共用）');
  assert.match(clipboardFn[0], /navigator\.clipboard\.writeText/, '应使用剪贴板');
  const uses = js.match(/copyDispatchText\(/g) || [];
  assert.ok(uses.length >= 2, `批量实施等链路应仍在调用 copyDispatchText（实际 ${uses.length} 处）`);
});

t('R3 样式契约：派发按钮样式已删', () => {
  assert.doesNotMatch(css, /\.dispatch-row/, '不得残留 .dispatch-row 样式');
  assert.doesNotMatch(css, /\.dispatch-btn/, '不得残留 .dispatch-btn 样式');
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
