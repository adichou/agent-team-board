#!/usr/bin/env node
// REQ-20260906-001 视图切换栏视觉区分契约（REQ-20260907-004 更新：切换栏为第二行 .module-nav；
// 需求分类列 tab 已随看板移除）。零依赖（node:assert），静态断言 style.css / index.html / app.js。
// 用法：node scripts/tests/view-tabs-style.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');

const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rule(sel) {
  const m = flat.match(new RegExp(`(?:^|[{}])\\s*${escapeRe(sel)}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `缺少规则 ${sel}`);
  return m[1];
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('V1 --viewrail-accent(-soft) 深浅色主题各定义一份，且不等于同主题 --primary', () => {
  const root = rule(':root');
  assert.match(root, /--viewrail-accent:/, '亮色应定义 --viewrail-accent');
  assert.match(root, /--viewrail-accent-soft:/, '亮色应定义 --viewrail-accent-soft');
  const dark = flat.match(/prefers-color-scheme:\s*dark\)\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(dark, /--viewrail-accent:/, '暗色应定义 --viewrail-accent');
  assert.match(dark, /--viewrail-accent-soft:/, '暗色应定义 --viewrail-accent-soft');
  const lightAccent = root.match(/--viewrail-accent:\s*([^;]+);/)?.[1];
  const lightPrimary = root.match(/--primary:\s*([^;]+);/)?.[1];
  assert.notEqual(lightAccent, lightPrimary, '视图栏专属色应区别于主题蓝');
});

t('V2 桌面端模块导航换色：激活项淡靛蓝底 + 靛蓝文字（不再是白胶囊）', () => {
  const active = rule('.module-nav .view-tab.active');
  assert.match(active, /background:\s*var\(--viewrail-accent-soft\)/, '激活态底色为淡靛蓝');
  assert.match(active, /color:\s*var\(--viewrail-accent\)/, '激活态文字为靛蓝');
  const idle = rule('.module-nav .view-tab');
  assert.match(idle, /color:\s*var\(--muted\)/, '非激活项灰字（与激活态成组可辨）');
});

t('V3 造型区分：模块导航 tab 为 8px 圆角矩形（非胶囊）；筛选 chip 已恢复（BUG-20260907-016）', () => {
  assert.match(rule('.module-nav .view-tab'), /border-radius:\s*8px/, '导航 tab 圆角矩形');
  assert.doesNotMatch(rule('.module-nav .view-tab'), /border-radius:\s*99px/, '导航 tab 不再用胶囊造型');
  assert.match(rule('.filter-chip'), /border-radius:\s*8px/, '筛选 chip 8px 圆角矩形');
  assert.ok(css.includes('.filter-count'), '筛选计数样式应恢复（BUG-20260907-016）');
});

t('V4 分类 tab 随看板移除：不得残留 .board-tab 样式与机制', () => {
  assert.doesNotMatch(css, /\.board-tab[\s.,{]/, '分类 tab 样式应移除');
  assert.doesNotMatch(js, /\.board-tab/, '分类 tab 机制应移除');
});

t('V5 设置入口为行末辅助样式（弱化呈现，与功能模块区分）', () => {
  assert.match(rule('.module-nav .view-tab.nav-extra'), /margin-left:\s*auto/, '行末右对齐');
  assert.match(html, /class="view-tab nav-extra" data-view="settings"/, '设置为辅助入口');
});

t('V6 结构契约：类名与 DOM 不变，app.js 模块导航协同机制保留', () => {
  assert.match(html, /<nav class="module-nav"/, '模块导航容器');
  assert.match(js, /querySelectorAll\('\.view-tab'\)/, 'app.js 按类名绑定/同步');
  assert.match(js, /MODULE_SUB/, '第三行副标题随模块同步');
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
