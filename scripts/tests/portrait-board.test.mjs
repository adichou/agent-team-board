#!/usr/bin/env node
// 窄屏需求工作台契约测试 —— 零依赖（node:assert），静态断言 style.css / app.js
// 用法：node scripts/tests/portrait-board.test.mjs
// 原 REQ-20260903-002 竖屏看板横滑 + 竖 tab 条已随 REQ-20260907-004 布局重构移除；
// 本文件改守窄屏需求工作区：单列列表 + 详情覆盖抽屉（has-item 滑入；需求侧返回入口已随 BUG-20260909-007 移除）。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');
const js = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');

// 压平：去注释、压缩空白，便于对声明做正则断言
const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 取所有匹配 cond 的 @media 块体拼接：花括号配平截取
function mediaBody(cond) {
  const re = new RegExp(`@media\\s*\\(${escapeRe(cond)}\\)\\s*\\{`, 'g');
  let out = '';
  let found = false;
  let m;
  while ((m = re.exec(flat)) !== null) {
    found = true;
    const start = m.index + m[0].length;
    let i = start;
    let depth = 1;
    while (i < flat.length && depth > 0) {
      if (flat[i] === '{') depth++;
      else if (flat[i] === '}') depth--;
      i++;
    }
    out += flat.slice(start, i - 1) + ' ';
  }
  assert.ok(found, `缺少媒体查询 @media (${cond})`);
  return out;
}

function ruleIn(scope, sel) {
  const m = scope.match(new RegExp(`(?:^|[{}])\\s*${escapeRe(sel)}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `在指定作用域缺少规则 ${sel}`);
  return m[1];
}

function rule(sel) {
  return ruleIn(flat, sel);
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('P1 ≤1020 断点 .req-split 退化为单列（窄屏不再并排列表与详情）', () => {
  const body = mediaBody('max-width: 1020px');
  const split = ruleIn(body, '.req-split');
  assert.match(split, /grid-template-columns:\s*minmax\(0,\s*1fr\)/, '窄屏应为单列列表');
});

t('P2 ≤1020 断点详情为覆盖式抽屉：默认移出屏外，has-item 滑入；需求侧返回入口已移除（BUG-20260909-007）', () => {
  const body = mediaBody('max-width: 1020px');
  const drawer = ruleIn(body, '.req-split > .drawer');
  // REQ-20260908-005：覆盖基准从视口改为工作区（.req-view）——顶边低于状态筛选行，
  // 高度与列表区一致，不再 fixed 全视口高盖住头部四行
  assert.match(drawer, /position:\s*absolute/, '详情窄屏以工作区为基准绝对定位覆盖');
  assert.doesNotMatch(drawer, /position:\s*fixed/, '不得再固定全视口覆盖（REQ-20260908-005）');
  assert.match(rule('.req-view'), /position:\s*relative/, '工作区提供定位基准');
  assert.match(drawer, /width:\s*min\(560px,\s*92vw\)/, '宽度随视口收缩');
  assert.match(drawer, /transform:\s*translateX\(100%\)/, '默认移出屏外（空态不可见）');
  assert.match(ruleIn(body, '.req-split > .drawer.has-item'), /transform:\s*none/, 'has-item 时滑入');
  // BUG-20260909-007：窄屏「← 返回」与「✕」同为 closeDrawer，需求侧返回按钮移除；
  // .drawer-back 规则保留给讨论模块 #ocBack（返回是其唯一出口，宽屏隐藏、窄屏显示）
  assert.doesNotMatch(js, /drawerBack/, '需求详情不得再渲染返回列表入口（冗余出口已移除）');
  assert.match(ruleIn(body, '.drawer-back'), /display:\s*inline-flex/, '.drawer-back 窄屏显示（讨论模块 #ocBack 保留使用）');
});

t('P3 看板横滑与竖 tab 遗迹已全部移除（REQ-20260907-004）', () => {
  const body = mediaBody('max-width: 1020px');
  assert.doesNotMatch(body, /scroll-snap-type/, '不得残留看板列吸附');
  assert.doesNotMatch(css, /\.board-tabs/, '竖 tab 条样式应移除');
  assert.doesNotMatch(js, /board-tabs|scrollToCol|markActiveTab/, '看板 tab 机制应移除');
});

t('P4 桌面（>1020）列表+详情双栏不回归（BUG-20260910-002：比例恒定 1 : 2）', () => {
  assert.match(rule('.req-split'), /display:\s*grid/);
  assert.match(rule('.req-split'), /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*2fr\)/, '宽屏列表 : 详情应为 1 : 2，随视口同步伸缩');
});

t('P6 app.js 窄屏行为：详情打开按视口决定遮罩，关闭渲染空态', () => {
  assert.match(js, /drawerOverlayMode/, '需按视口宽度判断覆盖形态');
  assert.match(js, /matchMedia\('\(max-width: 1020px\)'\)/, '断点与 CSS 一致');
  assert.match(js, /classList\.add\('has-item'\)/, '打开详情应标记 has-item');
  assert.match(js, /renderDrawerEmpty/, '关闭详情渲染空态引导');
});

t('P8 ≤640 顶栏紧凑化：路径隐藏、指示恢复、切换器自适应', () => {
  const narrow = mediaBody('max-width: 640px');
  assert.match(ruleIn(narrow, '.path'), /display:\s*none/, '项目路径不再显示');
  assert.doesNotMatch(narrow, /\.poll \{/, '连接指示「●」恢复显示（不得再隐藏）');
  assert.doesNotMatch(narrow, /max-width:\s*110px/, '项目切换器按内容自适应宽度（不截断）');
  const brand = ruleIn(narrow, '.brand');
  assert.match(brand, /flex:\s*1\s+1\s+auto/, '标题占位伸缩，操作区靠右');
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
