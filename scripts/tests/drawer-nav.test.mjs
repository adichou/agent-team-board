#!/usr/bin/env node
// REQ-20260901-001 详情页上一条/下一条导航 —— 静态契约测试
// 用法：node scripts/tests/drawer-nav.test.mjs
// 覆盖 test-cases.md 的 D1–D4；D5 为浏览器实测。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const web = path.join(pluginRoot, 'scripts', 'web');
const js = fs.readFileSync(path.join(web, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(web, 'style.css'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('D1 导航两翼化：按钮在底部 .drawer-actions 两侧，与操作按钮行对齐；说明文字独立成行不受影响（2026-09-01 三次修订）', () => {
  assert.match(js, /drawer-nav-btn/, '应存在导航按钮样式类');
  assert.match(js, /data-nav=/, '应含 data-nav 导向属性');
  assert.match(js, /aria-disabled/, '首尾应有禁用语义');
  // notice（操作描述）与按钮拆分：notice 独立渲染在操作行上方，不进中栏
  assert.match(js, /function drawerActionsNoticeHtml/, '应存在独立的 notice 渲染函数');
  assert.match(js, /function drawerActionsButtonHtml/, '应存在独立的操作按钮渲染函数');
  assert.match(js, /drawerActionsNoticeHtml\(it\)[\s\S]{0,120}<div class="drawer-actions">/, 'notice 应在 .drawer-actions 行之前独立成行');
  // 中栏只含按钮与序号，不含 notice
  const tpl = js.match(/drawer-actions-center[\s\S]{0,300}/);
  assert.ok(tpl, '应存在中栏模板');
  assert.doesNotMatch(tpl[0], /notice/, '中栏不得包含说明文字');
  assert.match(tpl[0], /drawerActionsButtonHtml/, '中栏应放操作按钮');
  // 顶部导航条方案废弃
  assert.doesNotMatch(js, /drawerNavHtml/, '顶部导航条渲染函数应移除');
  assert.doesNotMatch(js, /class="drawer-nav"/, '顶部不应再有导航条');
});

t('D2 切换复用 openDrawer 且重置文档页签；同状态遍历范围在打开时冻结（2026-09-05 五次修订，BUG-20260903-001）', () => {
  const scopeFn = js.match(/function scopeIdsFor[\s\S]{0,400}/);
  assert.ok(scopeFn, '应存在导航范围快照函数 scopeIdsFor');
  assert.match(scopeFn[0], /filter\(/, '应按条件过滤条目列表');
  assert.match(scopeFn[0], /\.status === me\.status/, '范围应为打开时刻的同状态条目');
  assert.match(js, /openDrawer\(/, '切换应复用 openDrawer');
  // openDrawer 重置 doc（抽屉状态初始化 doc: null），并落盘冻结的导航范围
  assert.match(js, /state\.drawer = \{ id, item: null, doc: null, navIds/, 'openDrawer 应重置 doc 并写入导航范围');
});

t('B1 范围冻结：drawerNeighbors 优先用打开时快照，状态流转后导航不漂移（BUG-20260903-001）', () => {
  const navFn = js.match(/function drawerNeighbors[\s\S]{0,800}/);
  assert.ok(navFn, '应存在 drawerNeighbors 函数');
  assert.match(navFn[0], /state\.drawer\.navIds/, '应优先使用打开时冻结的导航范围');
  assert.match(navFn[0], /\.status === me\.status/, '快照缺失时回退实时同状态过滤');
});

t('B2 导航沿用范围：prev/next 不重算；点卡片/跳转链接才按新条目重算（BUG-20260903-001）', () => {
  assert.match(js, /openDrawer\(target\.id, true\)/, '导航切换应沿用冻结范围');
  assert.match(js, /openDrawer\(b\.dataset\.goto\)/, '跳转链接应按新条目重算范围');
  assert.match(js, /openDrawer\(it\.id\)/, '卡片点开应按新条目重算范围');
});

t('B3 快照剔除失效条目：被删单号不产生打不开的相邻项（BUG-20260903-001）', () => {
  const navFn = js.match(/function drawerNeighbors[\s\S]{0,800}/);
  assert.match(navFn[0], /alive/, '应按存活条目剔除快照失效项');
});

t('D3 键盘 ArrowLeft/Right 切换，输入态与弹窗让位', () => {
  assert.match(js, /function navDrawer/, '应存在导航切换函数');
  assert.match(js, /ArrowLeft/, '应监听 ArrowLeft');
  assert.match(js, /ArrowRight/, '应监听 ArrowRight');
  assert.match(js, /ArrowLeft[\s\S]{0,80}'prev'[\s\S]{0,80}'next'/, '键盘应映射 prev/next 两个方向');
  assert.match(js, /INPUT|TEXTAREA|SELECT/, '输入元素聚焦时应让位');
  assert.match(js, /modalWrap/, '新建弹窗打开时应让位');
});

t('D4 样式：两翼按钮用全局变量、禁用态视觉反馈；中栏容器存在', () => {
  assert.match(css, /\.drawer-nav-btn/, '应存在导航按钮样式');
  assert.match(css, /drawer-nav-btn\[aria-disabled="true"\]/, '应有禁用态样式');
  assert.match(css, /drawer-nav-btn[^{]*{[^}]*var\(--/, '导航按钮应使用全局主题变量');
  assert.match(css, /\.drawer-actions-center/, '应有中栏容器样式');
  assert.doesNotMatch(css, /\.drawer-nav\s*{/, '顶部导航条样式应移除');
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
