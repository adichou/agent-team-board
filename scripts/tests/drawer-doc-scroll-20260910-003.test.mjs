#!/usr/bin/env node
// BUG-20260910-003 详情页面中的说明、方案等内容的呈现没有滚动条 —— 静态契约测试
// 根因（离屏 Electron 实测，2026-09-10）：宽屏 split 布局中 .req-split 的隐式 grid 行为 auto，
// 行高随抽屉内容（长 README/design 文档）增长（实测 900px 视口下抽屉被撑到 3343px），
// 溢出被 .req-view { overflow: hidden } 直接裁剪，祖先链上无任何可滚容器——
// 文档下半部分不可达，表现为「没有滚动条」。
// 修复：.req-split 显式 grid-template-rows: minmax(0, 1fr)，行高锁定为工作区高度；
// 抽屉列获得确定高度后，.drawer-body（overflow-y: auto + flex:1 + min-height: 0）成为滚动容器。
// 用法：node scripts/tests/drawer-doc-scroll-20260910-003.test.mjs
// 本文件覆盖 S1–S4；浏览器实测证据见条目 test-report.md。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');

const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 取顶层（媒体查询外）声明块（与 drawer-height.test.mjs 同款解析器）
function rule(sel) {
  const m = flat.match(new RegExp(`(?:^|[{}])\\s*${escapeRe(sel)}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `缺少规则 ${sel}`);
  return m[1];
}

// 窄屏媒体查询块内、指定选择器的声明块
function mediaRule(cond, sel) {
  const re = new RegExp(`@media\\s*\\(${escapeRe(cond)}\\)\\s*\\{`);
  const m = flat.match(re);
  assert.ok(m, `缺少媒体查询 @media (${cond})`);
  const start = m.index + m[0].length;
  let i = start;
  let depth = 1;
  while (i < flat.length && depth > 0) {
    if (flat[i] === '{') depth++;
    else if (flat[i] === '}') depth--;
    i++;
  }
  const body = flat.slice(start, i - 1);
  const r = body.match(new RegExp(`${escapeRe(sel)}\\s*\\{([^}]*)\\}`));
  assert.ok(r, `窄屏媒体块内缺少规则 ${sel}`);
  return r[1];
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('S1 根因修复：.req-split 行高锁定 minmax(0, 1fr)，不再随抽屉内容增长', () => {
  const r = rule('.req-split');
  assert.match(r, /grid-template-rows:\s*minmax\(0,\s*1fr\)/,
    '.req-split 需显式 grid-template-rows: minmax(0, 1fr)（min 0 防内容撑爆；纯 1fr 的 auto 最小值仍会随内容增长）');
});

t('S2 滚动链：drawer-body 保持唯一滚动容器（overflow-y: auto + flex:1 + min-height: 0）', () => {
  const base = rule('.drawer-body');
  assert.match(base, /overflow-y:\s*auto/, '.drawer-body 应可纵向滚动');
  const flex = rule('#drawer > .drawer-body');
  assert.match(flex, /flex:\s*1/, 'drawer-body 应撑满抽屉剩余高度');
  assert.match(flex, /min-height:\s*0/, 'min-height: 0 保滚动（不得回退）');
});

t('S3 BUG-20260909-018 不回退：文档页签拉伸填满（doc pane 与 .md 均 flex: 1）', () => {
  assert.match(rule('.drawer-pane[data-pane="doc"]'), /flex:\s*1/, '文档页签应填满 drawer-body');
  assert.match(rule('.drawer-pane[data-pane="doc"] > .md'), /flex:\s*1/, 'markdown 框应拉伸填满短文档时的高度');
});

t('S4 窄屏（≤1020px）不回退：覆盖式抽屉仍有确定高度（absolute top/bottom 对齐工作区）', () => {
  const split = mediaRule('max-width: 1020px', '.req-split');
  assert.match(split, /grid-template-columns:\s*minmax\(0,\s*1fr\)/, '窄屏仍为单列');
  const dr = mediaRule('max-width: 1020px', '.req-split > .drawer');
  assert.match(dr, /position:\s*absolute/, '窄屏抽屉仍为工作区内 absolute');
  assert.match(dr, /top:\s*0/, '顶边对齐工作区');
  assert.match(dr, /bottom:\s*0/, '底边对齐工作区（确定高度 → drawer-body 可滚）');
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
