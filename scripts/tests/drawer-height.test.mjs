#!/usr/bin/env node
// REQ-20260908-005 详情页面高度不要超过列表，要低于状态筛选行 —— 静态契约测试
// 窄屏（≤1020px）覆盖式详情抽屉以需求工作区（.req-view）为定位基准：顶边低于状态筛选行，
// 高度与列表区一致；遮罩 #mask 与详情同域，不再压暗/拦截状态筛选行及其以上。
// 用法：node scripts/tests/drawer-height.test.mjs
// 覆盖 test-cases.md 的 D1–D5；M1 为浏览器人工核验。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');

const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 取顶层（媒体查询外）声明块
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

function mediaBody(cond) {
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
  return flat.slice(start, i - 1);
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('D1 窄屏详情抽屉不再全视口高：≤1020px 内为 absolute 而非 fixed，宽度上限不变', () => {
  const dr = mediaRule('max-width: 1020px', '.req-split > .drawer');
  assert.match(dr, /position:\s*absolute/, '窄屏抽屉应以工作区为定位基准（absolute）');
  assert.doesNotMatch(dr, /position:\s*fixed/, '不得再用 fixed 全视口覆盖（会高过列表、盖住状态筛选行）');
  assert.match(dr, /top:\s*0/, '顶边对齐工作区顶（状态筛选行下沿）');
  assert.match(dr, /bottom:\s*0/, '底边对齐工作区底（与列表等高）');
  assert.match(dr, /width:\s*min\(560px,\s*92vw\)/, '覆盖宽度上限保持');
});

t('D2 定位基准：.req-view 提供 position: relative（抽屉与列表同顶同底）', () => {
  const r = rule('.req-view');
  assert.match(r, /position:\s*relative/, '.req-view 应为覆盖层定位基准');
  assert.match(r, /overflow:\s*hidden/, '工作区裁剪收起态抽屉的溢出');
});

t('D3 遮罩同域：#mask 位于 #reqView 内，窄屏为工作区内 absolute（状态筛选行不被压暗/拦截）', () => {
  const main = html.slice(html.indexOf('<main id="reqView"'), html.indexOf('</main>'));
  assert.ok(main, '缺少 #reqView 工作区');
  assert.match(main, /id="mask"/, '#mask 应在 #reqView 内（随工作区定位）');
  const before = html.slice(0, html.indexOf('<main id="reqView"'));
  assert.doesNotMatch(before, /id="mask"/, 'body 级不应再保留 #mask');
  const mr = mediaRule('max-width: 1020px', '#mask');
  assert.match(mr, /position:\s*absolute/, '窄屏遮罩应为工作区内 absolute');
  assert.match(mr, /inset:\s*0/, '遮罩覆盖整个工作区（不再越过状态筛选行）');
});

t('D4 回归：窄屏滑入动画不动；需求侧冗余返回入口已移除（BUG-20260909-007）', () => {
  const body = mediaBody('max-width: 1020px');
  assert.match(body, /transform:\s*translateX\(100%\)/, '收起态仍移出');
  assert.match(body, /\.req-split > \.drawer\.has-item\s*\{\s*transform:\s*none/, 'has-item 时详情滑入');
  // BUG-20260909-007：「← 返回」与「✕」行为完全相同（同一 closeDrawer），需求侧返回按钮移除，
  // 关闭出口收敛为 ✕ / Escape / 遮罩；.drawer-back 样式规则保留给讨论模块 #ocBack（唯一出口）
  assert.doesNotMatch(js, /drawerBack/, '需求详情不得再渲染窄屏返回按钮（冗余出口已移除）');
  assert.match(body, /\.drawer-back\s*\{\s*display:\s*inline-flex/, '.drawer-back 规则保留（讨论模块 #ocBack 使用，宽屏隐藏）');
});

t('D5 回归：宽屏并排布局不变（.req-split > .drawer 仍 static 常驻右栏）', () => {
  const wide = rule('.req-split > .drawer');
  assert.match(wide, /position:\s*static/, '宽屏详情仍为网格内常驻右栏');
  assert.match(wide, /width:\s*auto/, '宽屏宽度交给网格轨道');
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
