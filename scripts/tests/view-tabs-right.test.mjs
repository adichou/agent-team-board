#!/usr/bin/env node
// REQ-20260906-008 视图切换栏位置契约（REQ-20260907-004 更新：切换栏为第二行 .module-nav）
// 零依赖（node:assert），静态断言 style.css / index.html / app.js。
// 用法：node scripts/tests/view-tabs-right.test.mjs
// 原意图「切换栏靠右、不参与顶栏布局」延续为「独立第二行，顶栏不再承载切换」。

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

t('T1 结构：模块导航并入顶栏（REQ-20260910-012：brand 之后、top-actions 之前），顶栏之后直接进入第三行', () => {
  const iTop = html.indexOf('<header class="topbar"');
  const iNav = html.indexOf('<nav class="module-nav"');
  const iHeadEnd = html.indexOf('</header>', iTop);
  const iHead = html.indexOf('<section id="pageHead"');
  assert.ok(iTop !== -1 && iNav !== -1 && iHead !== -1, '应有 topbar / module-nav / pageHead');
  assert.ok(iTop < iNav && iNav < iHeadEnd, 'module-nav 应位于顶栏内（页签上移，原独立第二行取消）');
  assert.ok(iHeadEnd < iHead, '顶栏结束后直接为第三行（副标题 + 搜索）');
  const topbar = html.slice(iTop, iHeadEnd);
  assert.match(topbar, /view-tab/, '顶栏应含模块页签（REQ-20260910-012 新契约）');
  assert.doesNotMatch(topbar, /projectSel.*view-tabs|view-tabs.*projectSel/, '顶栏不得混入旧 .view-tabs 切换栏');
});

t('T2 布局：module-nav 不被压缩（flex:none），窄窗口横向可滑动、不画分隔线（顶栏自带 border-bottom）', () => {
  assert.match(rule('.module-nav'), /flex:\s*none/, '页签组不被压缩');
  assert.match(rule('.module-nav'), /overflow-x:\s*auto/, '页签溢出时横滑');
  assert.doesNotMatch(rule('.module-nav'), /border-bottom/, '顶栏内的页签组不再画分隔线');
});

t('T3 切换样式：激活项用视图栏专属靛蓝，tab 带平滑过渡', () => {
  const tab = rule('.module-nav .view-tab');
  assert.match(tab, /transition:[^;]*background-color/, 'tab 需有背景色平滑过渡');
  const active = rule('.module-nav .view-tab.active');
  assert.match(active, /background:\s*var\(--viewrail-accent-soft\)/, '激活态为视图栏专属靛蓝底');
  assert.match(active, /color:\s*var\(--viewrail-accent\)/, '激活态靛蓝文字');
});

t('T4 窄屏回归（≤1020）：module-nav 保持横向单行可滑动，不再固定左缘竖排', () => {
  assert.doesNotMatch(flat, /\.module-nav[^{]*\{[^}]*writing-mode/, '导航项不得竖排');
  assert.doesNotMatch(js, /--viewrail-h/, '旧左缘让位机制已随布局移除');
});

t('T5 交互契约：类名/DOM 数据不变，app.js 仍按 .view-tab 绑定与同步（REQ-20260909-013：讨论 / 文件 tab 暂态隐藏，恢复时按条目 design.md 加回）', () => {
  assert.match(html, /<nav class="module-nav"/, '模块导航容器类名稳定');
  assert.match(html, /class="view-tab active" data-view="status"/, '「需求」tab 存在且默认激活');
  assert.match(html, /class="view-tab" data-view="runs"/, '「任务」tab 存在');
  assert.doesNotMatch(html, /data-view="files"/, '「文件」tab 随 REQ-20260909-013 暂态隐藏');
  assert.doesNotMatch(html, /data-view="oncall"/, '「讨论」tab 随 REQ-20260909-013 暂态隐藏');
  assert.match(js, /querySelectorAll\('\.view-tab'\)/, 'app.js 仍按 .view-tab 绑定/同步激活态');
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
