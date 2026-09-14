#!/usr/bin/env node
// REQ-20260829-001 布局契约测试 —— 零依赖（node:assert），静态断言 index.html / style.css / app.js
// 用法：node scripts/tests/layout.test.mjs
// 对应 test-cases.md 的 T1–T9；T10 为浏览器多尺寸人工核验。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');

// 压平：去注释、压缩空白，便于对声明做正则断言
const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 取选择器在顶层（媒体查询之前）的声明块；左边界为 { } 或行首，
// 避免把 "html, body" 这类联合选择器误认成 "body"
function rule(sel) {
  const m = flat.match(new RegExp(`(?:^|[{}])\\s*${escapeRe(sel)}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `缺少规则 ${sel}`);
  return m[1];
}

function mediaBlock(cond) {
  const m = flat.match(new RegExp(`@media\\s*\\(${cond}\\)\\s*\\{`));
  assert.ok(m, `缺少媒体查询 @media (${cond})`);
  const start = m.index + m[0].length;
  const rest = flat.slice(start);
  const next = rest.indexOf('@media');
  return next === -1 ? rest : rest.slice(0, next);
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('T1 index.html 含 viewport meta', () => {
  assert.match(html, /<meta\s+name="viewport"/);
});

t('T2 html,body 高度 100%', () => {
  assert.match(rule('html, body'), /height:\s*100%/);
});

t('T3 body overflow hidden（无页面级滚动）', () => {
  assert.match(rule('body'), /overflow:\s*hidden/);
});

t('T4 .req-split 双栏首轨 minmax(0,1fr)（BUG-20260910-002 后列表轨，防内容撑破网格）', () => {
  const r = rule('.req-split');
  assert.match(r, /grid-template-columns:\s*minmax\(0,\s*1fr\)/, '.req-split 需要 minmax(0,1fr) 列（防内容撑破网格）');
  assert.match(r, /min-height:\s*0/, '.req-split 需要 min-height: 0（允许内部滚动）');
});

t('T5 列表容器 flex column + .req-list 内滚动 + app.js 挂载', () => {
  const wrap = rule('.req-list-wrap');
  assert.match(wrap, /display:\s*flex/);
  assert.match(wrap, /flex-direction:\s*column/);
  const list = rule('.req-list');
  assert.match(list, /flex:\s*1/);
  assert.match(list, /min-height:\s*0/);
  assert.match(list, /overflow-y:\s*auto/);
  assert.match(js, /reqList/, 'app.js 需要把行渲染进 #reqList 容器');
});

t('T6 详情右栏 2fr 随视口伸缩，列表 : 详情恒定 1 : 2（BUG-20260910-002 取代固定 460px 上限口径）', () => {
  const r = rule('.req-split');
  const m = r.match(/grid-template-columns:\s*minmax\(0,\s*([\d.]+)fr\)\s*minmax\(0,\s*([\d.]+)fr\)/);
  assert.ok(m, '.req-split 应为双 fr 轨道（列表 + 详情随视口同步伸缩，详情不再被 px 上限锁死）');
  const [a, b] = [Number(m[1]), Number(m[2])];
  assert.ok(Math.abs(b / a - 2) < 0.01, `详情栏应为列表栏的 2 倍（实测 ${a}fr : ${b}fr）`);
});

t('T7 窄屏断点：≤1020px 单列列表 + 详情覆盖抽屉（REQ-20260907-004 取代横滑看板）', () => {
  const wide = mediaBlock('max-width: 1020px');
  assert.match(wide, /grid-template-columns:\s*minmax\(0,\s*1fr\)/, '窄屏 .req-split 应退化为单列');
  assert.match(wide, /transform:\s*translateX\(100%\)/, '详情栏窄屏应为覆盖式抽屉（默认移出）');
  assert.match(wide, /\.req-split > \.drawer\.has-item\s*\{\s*transform:\s*none/, 'has-item 时详情滑入');
  assert.doesNotMatch(wide, /scroll-snap-type:\s*x mandatory/, '看板横滑吸附已随布局移除');
});

t('T8 顶栏不换行 + 路径超长省略', () => {
  assert.match(rule('.topbar'), /flex-wrap:\s*nowrap/);
  const p = rule('.path');
  assert.match(p, /white-space:\s*nowrap/);
  assert.match(p, /text-overflow:\s*ellipsis/);
});

t('T9 抽屉/弹窗宽度带 vw 上限', () => {
  assert.match(rule('.drawer'), /width:\s*min\(560px,\s*92vw\)/);
  assert.match(rule('.modal'), /width:\s*min\(480px,\s*92vw\)/);
});

t('T10 连接指示配色：在线绿、离线灰，仅保留图标（REQ-20260903-002 验收反馈）', () => {
  assert.match(rule('.poll'), /color:\s*var\(--done\)/, '「●」应为绿色');
  assert.match(rule('.poll.off'), /color:\s*var\(--muted\)/, '「○」应为灰色');
  assert.match(js, /pollState'\)\.textContent = '●'/, '在线仅保留圆点图标');
  assert.match(js, /pollState'\)\.textContent = '○'/, '离线仅保留空心圆图标');
  assert.doesNotMatch(js, /textContent = '[●○] /, '图标后不得再跟文字（说明放 title 悬停提示）');
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
