#!/usr/bin/env node
// BUG-20260909-018 单详情也太矮了 —— 静态契约测试 G1–G4。
// 口径见 bugs/BUG-20260909-018/design.md：放宽 .doc-shot 默认展示（高度 260px →
// min(58vh, 640px)、宽度 420px → 640px）+ 文档页签内容区拉伸填满抽屉可用高度；
// 交互接线（lightbox / 失败占位 / lazy）不回退；讨论模块 .oncall-fig 豁免不动。
// 方式对齐 drawer-height.test.mjs（CSS 规则提取）；用法：node scripts/tests/doc-shot-size-20260909-018.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
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

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('G1 截图默认展示放宽：高度上限为 min(<vh>, <px>) 且像素上限 ≥480（显著大于 260）；宽度上限 >420；样式契约保留', () => {
  const r = rule('.doc-shot');
  const h = r.match(/max-height:\s*min\((\d+(?:\.\d+)?)vh,\s*(\d+)px\)/);
  assert.ok(h, `高度上限应为 min(<vh>, <px>) 动态形态，实际：${r}`);
  assert.ok(Number(h[2]) >= 480, `像素上限 ${h[2]}px 应显著大于旧口径 260px`);
  assert.doesNotMatch(r, /max-height:\s*260px/, '不得保留固定 260px 上限');
  const w = r.match(/max-width:\s*min\((\d+)px,\s*100%\)/);
  assert.ok(w, `宽度上限应保持 min(<px>, 100%) 形态，实际：${r}`);
  assert.ok(Number(w[1]) > 420, `宽度上限 ${w[1]}px 应宽于旧口径 420px（横版图受益）`);
  // 深浅色外观与交互不回退（REQ-20260909-009 交付项）
  assert.match(r, /border:\s*1px solid var\(--border\)/, '边框保留');
  assert.match(r, /border-radius:\s*8px/, '圆角保留');
  assert.match(r, /object-fit:\s*contain/, 'object-fit 保留');
  assert.match(r, /cursor:\s*zoom-in/, '点击放大入口（zoom-in 指针）保留');
  assert.match(r, /background:\s*var\(--bg\)/, '深浅色背景变量保留');
});

t('G2 内容区高度利用：body 撑满抽屉（flex:1 + min-height:0 + 纵向 flex，overflow-y:auto 不变）；文档页签与 .md 拉伸填满', () => {
  const body = rule('#drawer > .drawer-body');
  assert.match(body, /flex:\s*1/, 'body 应撑满抽屉剩余高度');
  assert.match(body, /min-height:\s*0/, 'flex 滚动子项需 min-height: 0');
  assert.match(body, /display:\s*flex/, 'body 应为 flex 容器');
  assert.match(body, /flex-direction:\s*column/, '纵向排布');
  assert.doesNotMatch(body, /overflow-y:\s*visible/, '不得覆盖为不滚动');
  // 滚动口径由基础规则承载（级联生效），scoped 规则只做拉伸增量
  const base = rule('.drawer-body');
  assert.match(base, /overflow-y:\s*auto/, '.drawer-body 基础规则保留滚动口径');
  const pane = rule('.drawer-pane[data-pane="doc"]');
  assert.match(pane, /flex:\s*1/, '文档页签应吃满 body 剩余高度');
  assert.match(pane, /display:\s*flex/, '文档页签为 flex 容器');
  assert.match(pane, /flex-direction:\s*column/, '纵向排布');
  const md = rule('.drawer-pane[data-pane="doc"] > .md');
  assert.match(md, /flex:\s*1/, 'markdown 文档框应拉伸填满（不足一屏不再大段空白）');
});

t('G3 交互接线不回退：linkupDocImages 仍接管类名 / lazy / lightbox / 失败占位', () => {
  assert.match(js, /classList\.add\('doc-shot'\)/, '仍添加 doc-shot 类');
  assert.match(js, /loading = 'lazy'/, '仍懒加载');
  assert.match(js, /\$oncallLightbox|#oncallLightbox/, '点击放大仍复用 #oncallLightbox');
  assert.match(js, /无法加载/, '失败占位文案保留');
});

t('G4 讨论模块豁免：.oncall-fig img 维持 260px 上限（本单不调整，理由见 design.md）', () => {
  const r = rule('.oncall-fig img');
  assert.match(r, /max-height:\s*260px/, '讨论侧缩略口径应保持不动');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`); }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
