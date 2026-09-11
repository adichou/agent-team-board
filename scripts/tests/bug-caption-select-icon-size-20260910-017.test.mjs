#!/usr/bin/env node
// BUG-20260910-017 全选 / 全不选图标视觉尺寸与列表卡片操作图标（⧉ / ✓ / ✎ / 🗑）统一
// —— 静态契约测试（引入来源：REQ-20260910-026 图标化沿用 .btn.icon-act 盒口径但未对齐字形视觉重量）
// BUG-20260910-019 同步：☑ / ☐ 投票框字形已改为自绘内联 SVG（13×13，等线宽描边），当初为字形单独
// 降字号的 icon-check 修补规则（治标）随之移除；本单「视觉尺寸统一」成果改由 SVG 固定尺寸 + 基础盒
// 口径承载。用例按新方案同步修正，保留「不回退」语义：
//   T1 视觉尺寸统一：两按钮不再携带 icon-check 修饰类、样式表无 icon-check 降字号规则；图标为固定
//      13×13 SVG（≤ 行内 13px 字形口径，不再近满 em 见方）；基础盒口径 .req-caption .btn.icon-act
//      保持 26×24 定宽等高 + 13px 基准 + 居中不变
//   T2 语义契约零变化：仅图标（内联 SVG，无中文 / 无投票框字形）、type=button、aria-label / title 口径、
//      两按钮 class 一致
//   T3 负向边界：行内操作图标（.req-row .row-acts .btn.icon-act）仍 13px，
//      工具栏容器布局口径（.req-caption wrap / .caption-actions nowrap / .sel-group wrap）不回退
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const htmlSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'index.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');
const appSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// 工具栏区段（#reqCaption 起至结果区前）
const captionHead = () => htmlSrc.match(/<div id="reqCaption"[\s\S]*?<div id="acceptResult"/)?.[0] || '';
// 按钮整段（含内联 SVG 子元素）
const btnHtml = (head, id) => head.match(new RegExp(`<button[^>]*id="${id}"[\\s\\S]*?</button>`));

t('T1 视觉尺寸统一（BUG-20260910-019 后口径）：#selectOperable / #selectNone 不再携带 icon-check 修饰类且样式表无 icon-check 降字号规则；图标为固定 13×13 内联 SVG（不超过行内 13px 字形口径）；基础盒口径 .req-caption .btn.icon-act 保持 26×24 定宽等高 + 13px + 居中不变', () => {
  const head = captionHead();
  assert.ok(head, '应存在列表头 #reqCaption');
  const selBtn = btnHtml(head, 'selectOperable');
  const noneBtn = btnHtml(head, 'selectNone');
  assert.ok(selBtn, '应存在全选按钮 #selectOperable');
  assert.ok(noneBtn, '应存在全不选按钮 #selectNone');
  // 字形时代的降字号修补（治标）随 SVG 方案移除：修饰类与规则均不残留
  assert.doesNotMatch(selBtn[0], /class="[^"]*\bicon-check\b[^"]*"/, '全选按钮不应再携带 icon-check 修饰类');
  assert.doesNotMatch(noneBtn[0], /class="[^"]*\bicon-check\b[^"]*"/, '全不选按钮不应再携带 icon-check 修饰类');
  assert.doesNotMatch(cssSrc, /\.icon-check\b/, '样式表不应残留 icon-check 降字号修补规则');
  // 视觉尺寸由 SVG 固定尺寸承载：13×13 不超过行内 13px 字形基准（不再近满 em 见方）
  for (const [name, btn] of [['全选', selBtn], ['全不选', noneBtn]]) {
    const svg = btn[0].match(/<svg\b[^>]*>/)?.[0] || '';
    assert.ok(svg, `${name}按钮应为内联 SVG 图标`);
    const w = Number(svg.match(/\bwidth="(\d+)"/)?.[1]);
    const h = Number(svg.match(/\bheight="(\d+)"/)?.[1]);
    assert.ok(w > 0 && h > 0, `${name}图标应声明固定 width / height（渲染不随字体回退漂移）`);
    assert.ok(w <= 13 && h <= 13, `${name}图标尺寸应不超过行内 13px 字形口径（实际 ${w}×${h}）`);
    assert.equal(w, h, `${name}图标应为正方形（复选框语汇）`);
  }
  // 基础盒口径不回退：.req-caption .btn.icon-act 仍 26×24 定宽等高 + 13px 基准 + 居中
  const baseRule = cssSrc.match(/\.req-caption \.btn\.icon-act\s*\{[^}]*\}/);
  assert.ok(baseRule, '基础规则 .req-caption .btn.icon-act 应保留');
  assert.match(baseRule[0], /min-width:\s*26px/, '基础口径 min-width:26px 不变');
  assert.match(baseRule[0], /min-height:\s*24px/, '基础口径 min-height:24px 不变');
  assert.match(baseRule[0], /font-size:\s*13px/, '基础口径基准字号 13px 不变');
  assert.match(baseRule[0], /text-align:\s*center/, '基础口径居中不变');
});

t('T2 语义契约零变化：两按钮内容仍仅图标（内联 SVG，无中文、无 ☑ / ☐ 字形）；type=button；aria-label="全选"/"全不选"；title 悬浮口径不变；两按钮 class 完全一致（等宽同源）；app.js 不向两按钮写回文字', () => {
  const head = captionHead();
  const selBtn = btnHtml(head, 'selectOperable');
  const noneBtn = btnHtml(head, 'selectNone');
  const inner = (m) => m[0].replace(/^<button[^>]*>/, '').replace(/<\/button>$/, '');
  assert.match(inner(selBtn), /^\s*<svg\b[\s\S]*<\/svg>\s*$/, '全选按钮内容应仅为内联 SVG 图标');
  assert.match(inner(noneBtn), /^\s*<svg\b[\s\S]*<\/svg>\s*$/, '全不选按钮内容应仅为内联 SVG 图标');
  assert.doesNotMatch(inner(selBtn), /[\u4e00-\u9fff☑☐]/, '全选按钮不得残留中文文字或投票框字形');
  assert.doesNotMatch(inner(noneBtn), /[\u4e00-\u9fff☑☐]/, '全不选按钮不得残留中文文字或投票框字形');
  assert.match(selBtn[0], /type="button"/, '全选为原生 button（键盘可达）');
  assert.match(noneBtn[0], /type="button"/, '全不选为原生 button');
  assert.match(selBtn[0], /aria-label="全选"/, '全选 aria-label 保留（屏幕阅读器念出「全选」）');
  assert.match(noneBtn[0], /aria-label="全不选"/, '全不选 aria-label 保留');
  assert.match(selBtn[0], /title="全选：仅勾选当前筛选档内可见的可操作条目[^"]*叠搜索范围[^"]*"/, '全选 title 口径不变（当前档 + 叠搜索）');
  assert.match(noneBtn[0], /title="全不选：仅取消当前筛选档的勾选"/, '全不选 title 口径不变（仅当前档）');
  // 两按钮 class 完全一致（同为 icon-act 盒口径），等宽等高同一条规则
  const cls = (m) => m[0].match(/class="([^"]*)"/)[1];
  assert.equal(cls(selBtn), cls(noneBtn), '两图标按钮 class 应一致（等宽等高同源）');
  assert.match(cls(selBtn), /\bicon-act\b/, 'class 应保留 icon-act（沿用 BUG-20260910-007 图标盒口径）');
  // 图标不被文案覆盖：app.js 不得向两按钮写 textContent
  assert.doesNotMatch(appSrc, /\$\('#selectOperable'\)[^;\n]*\.textContent\s*=/, '不得向全选按钮写回文字');
  assert.doesNotMatch(appSrc, /\$\('#selectNone'\)[^;\n]*\.textContent\s*=/, '不得向全不选按钮写回文字');
});

t('T3 负向边界：行内操作图标 .req-row .row-acts .btn.icon-act 字号仍 13px（工具栏图标调整不外溢到卡片操作区）；工具栏布局口径不回退——.req-caption 仍 wrap、.caption-actions 仍 nowrap + margin-left:auto、.sel-group 仍 wrap 且不抢靠右', () => {
  const rowRule = cssSrc.match(/\.req-row \.row-acts \.btn\.icon-act\s*\{[^}]*\}/);
  assert.ok(rowRule, '行内操作图标规则应保留');
  assert.match(rowRule[0], /font-size:\s*13px/, '卡片操作图标字号不受影响（仍 13px）');
  assert.match(rowRule[0], /min-width:\s*26px/, '卡片操作图标盒口径不变（min-width:26px）');
  assert.doesNotMatch(rowRule[0], /icon-check/, '行内操作图标不携带 icon-check 作用域');
  const capRule = cssSrc.match(/\.req-caption\s*\{[^}]*\}/);
  assert.ok(capRule, '应有 .req-caption 规则');
  assert.match(capRule[0], /flex-wrap:\s*wrap/, '.req-caption 保留 wrap（整组换行兜底）');
  const wrapRule = cssSrc.match(/\.caption-actions\s*\{[^}]*\}/);
  assert.ok(wrapRule, '应有 .caption-actions 容器规则');
  assert.match(wrapRule[0], /flex-wrap:\s*nowrap/, '.caption-actions 恒不拆散（nowrap）');
  assert.match(wrapRule[0], /margin-left:\s*auto/, '.caption-actions 整组靠右');
  const grpRule = cssSrc.match(/\.sel-group\s*\{[^}]*\}/);
  assert.ok(grpRule, '应有 .sel-group 规则');
  assert.match(grpRule[0], /flex-wrap:\s*wrap/, '.sel-group 组内 wrap 兜底保留');
  assert.doesNotMatch(grpRule[0], /margin-left:\s*auto/, '.sel-group 不得自带靠右');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
