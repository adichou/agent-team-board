#!/usr/bin/env node
// REQ-20260906-015 全局搜索 UI 契约测试 —— 零依赖（node:assert），
// 静态断言 index.html / app.js / style.css（参照 view-tabs-style.test.mjs 风格）。
// 用法：node scripts/tests/global-search-ui.test.mjs
// 覆盖 test-cases.md 的 U1–U6；M1 为浏览器人工视觉验收。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');
const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');

let failed = 0;
const t = (name, fn) => {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
  }
};

t('U1 第三行含模块搜索输入框（.global-search 容器 + #searchInput），位于 #pageHead 内（REQ-20260907-004）', () => {
  const pageHead = html.match(/<section id="pageHead" class="page-head">([\s\S]*?)<\/section>/);
  assert.ok(pageHead, '未找到 #pageHead 容器');
  assert.match(pageHead[1], /class="global-search module-search"/, '#pageHead 内需有 .global-search 搜索容器');
  assert.match(pageHead[1], /id="searchInput"/, '.global-search 内需有 #searchInput 输入框');
  assert.match(pageHead[1], /id="moduleSub"/, '第三行应同时承载模块副标题');
  const topbar = html.match(/<header class="topbar">([\s\S]*?)<\/header>/);
  assert.ok(topbar && !topbar[1].includes('searchInput'), '顶栏不得再放搜索框');
});

t('U2 输入防抖 250ms 调 /api/search，seq 竞态防护', () => {
  assert.match(js, /SEARCH_DEBOUNCE_MS\s*=\s*250/, '需定义 250ms 防抖常量');
  assert.match(js, /\/api\/search\?q=/, '需调用 /api/search');
  assert.match(js, /search\.seq|seq:\s*\d|state\.search\.seq/, '搜索状态需含 seq 序号');
  assert.match(js, /setTimeout[^\n]*SEARCH_DEBOUNCE_MS/, '防抖用 setTimeout + 常量');
});

t('U3 需求视图按 items id 集合过滤看板卡片，列签名包含 q；docs 命中渲染条带并可定位文档', () => {
  assert.match(js, /searchHitIds|searchVisible|searchFilter/, '需有按搜索结果过滤卡片的逻辑');
  assert.match(js, /docHits|renderDocHits/, '需渲染文档命中条带');
  assert.match(js, /loadDoc\(/, '点击文档命中需定位到文档（loadDoc）');
  const sigSource = js.match(/const sig = JSON\.stringify\(([^)]*)\)/);
  assert.ok(sigSource, '未找到列签名逻辑');
  assert.match(sigSource[1], /search|state\.search|q\b/, `列签名需包含搜索关键词（实际：${sigSource[1]}）`);
});

t('U4 文件视图 files 命中渲染为结果条带 chip，点击调用 openFile', () => {
  assert.match(js, /fileSearchHits|renderFileHits/, '需渲染文件搜索结果条带');
  assert.match(js, /openFile\(/, '点击文件命中需调用 openFile');
});

t('U5 setView 同步 placeholder；输入框内 Esc 清空且不冒泡关抽屉（REQ-20260909-013：文件视图 placeholder 随入口暂隐藏移出）', () => {
  assert.match(js, /搜需求 \/ Bug \/ 文档/, '需求视图 placeholder 文案');
  assert.doesNotMatch(js, /搜文件/, '文件视图 placeholder 随 REQ-20260909-013 暂态隐藏移出（恢复时按条目 design.md 加回）');
  assert.match(js, /updateSearchPlaceholder|searchPlaceholder/, '需有 placeholder 同步函数');
  assert.match(js, /stopPropagation/, '输入框内 Esc 需 stopPropagation（避免触发全局 Esc 关抽屉）');
});

t('U6 style.css 含 .global-search 与结果条带样式；窄屏不破版', () => {
  assert.match(flat, /\.global-search\s*\{/, '需有 .global-search 基础规则');
  assert.match(flat, /\.hits-strip|\.doc-hits|\.file-hits/, '需有结果条带样式');
  // 窄屏：沿用 topbar wrap 降级即可（topbar-overflow 契约），搜索框自身允许收缩
  assert.match(flat, /\.global-search\s*\{[^}]*min-width:\s*\d+px/, '搜索框需有 min-width 防过度压缩');
  assert.match(flat, /\.global-search[^{]*\{|\.search-input\s*\{/, '搜索输入框样式存在');
});

if (failed) {
  console.error(`\n${failed} 个用例失败`);
  process.exit(1);
}
console.log('\n全部通过');
