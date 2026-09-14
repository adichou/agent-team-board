#!/usr/bin/env node
// BUG-20260910-007 列表行操作按钮图标化并与单号同行 —— 静态契约测试
// 用法：node scripts/tests/bug-row-acts-icon-20260910-007.test.mjs
// 覆盖 README「期望行为 / 验收说明」中可静态断言部分（B1–B8）；宽/中/窄容器实测、
// 键盘顺序与深浅色由浏览器人工验收，不在本文件范围。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// 需求列表行构造函数（app.js 的 function reqRowEl(it) { … }）
function reqRowFn() {
  const m = js.match(/function reqRowEl\(it\)[\s\S]*?\n\}/);
  assert.ok(m, '应存在 reqRowEl 函数');
  return m[0];
}

// 列表行操作区模板（reqRowEl 内 <span class="row-acts"> … </span>）
function rowActsTpl(fn) {
  const m = fn.match(/class="row-acts"[\s\S]*?<\/span>/);
  assert.ok(m, 'reqRowEl 应存在 .row-acts 操作区模板');
  return m[0];
}

// 操作区内的按钮（属性串 + 可见文字）
function buttons(tpl) {
  return [...tpl.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)];
}

// copyId 函数体（async function copyId(id, el) { … }）
function copyIdFn() {
  const m = js.match(/async function copyId\(id, el\)[\s\S]*?\n\}/);
  assert.ok(m, '应存在 copyId 函数');
  return m[0];
}

// 四个操作的图标（沿用项目既有字形，仅去掉中文）
const ICONS = { copy: '⧉', accept: '✓', rename: '✎', del: '🗑' };

t('B1 四操作仅图标：操作区按钮可见文字不含中文，接受 ✓ / 修改 ✎ / 删除 🗑，复制经 icon 模式渲染 ⧉', () => {
  const tpl = rowActsTpl(reqRowFn());
  const btns = buttons(tpl);
  assert.ok(btns.length >= 1, '操作区应有按钮');
  for (const [, , text] of btns) {
    assert.doesNotMatch(text, /[\u4e00-\u9fff]/, `按钮文字不得含中文（当前：${text}）`);
  }
  const textOf = (kw) => btns.find(([attrs]) => attrs.includes(kw))?.[2];
  assert.equal(textOf('data-accept-id'), ICONS.accept, '接受按钮应为图标 ✓');
  assert.equal(textOf('data-rename-id'), ICONS.rename, '修改按钮应为图标 ✎');
  assert.equal(textOf('data-delete-id'), ICONS.del, '删除按钮应为图标 🗑');
  assert.match(tpl, /copyIdBtnHtml\(it\.id, \{ icon: true \}\)/, '复制按钮应以图标模式渲染');
  const copyFn = js.match(/function copyIdBtnHtml\(id[^)]*\)[\s\S]*?\n\}/)?.[0] || '';
  assert.equal(buttons(copyFn).find(([attrs]) => attrs.includes('data-copy-id'))?.[2], ICONS.copy, 'copyIdBtnHtml 图标分支应为 ⧉');
});

t('B2 与单号同一工具行：.req-row .card-top 不换行；标题模板仍独立位于 card-top 之后', () => {
  const rule = css.match(/\.req-row \.card-top\s*\{[^}]*\}/);
  assert.ok(rule, '应为 .req-row .card-top 定义工具行样式');
  assert.match(rule[0], /flex-wrap:\s*nowrap/, '工具行不得换行（勾选框/单号/操作图标同排）');
  const fn = reqRowFn();
  const topAt = fn.indexOf('class="card-top"');
  const titleAt = fn.indexOf('class="card-title"');
  assert.ok(topAt >= 0 && titleAt > topAt, '标题应独占 card-top 之后的下一行');
});

t('B3 窄容器不溢出不遮单号：单号可收缩省略（min-width:0 + ellipsis），操作区保持 nowrap/局部滚动/最大宽 100%', () => {
  const idRule = css.match(/\.req-row \.item-id\s*\{[^}]*\}/);
  assert.ok(idRule, '应为 .req-row .item-id 定义收缩规则');
  assert.match(idRule[0], /min-width:\s*0/, '单号容器需可收缩，避免挤爆工具行');
  const cidRule = css.match(/\.req-row \.item-id \.cid\s*\{[^}]*\}/);
  assert.ok(cidRule, '应为 .req-row .item-id .cid 定义溢出规则');
  assert.match(cidRule[0], /overflow:\s*hidden/, '超宽单号应隐藏溢出');
  assert.match(cidRule[0], /text-overflow:\s*ellipsis/, '超宽单号应显示省略号（非静默裁切）');
  const fn = reqRowFn();
  assert.match(fn, /querySelector\('\.cid'\)[\s\S]*?\.title\s*=\s*it\.id/, '省略时悬停应可看完整单号（.cid title 补全）');
  const acts = css.match(/\.req-row \.row-acts\s*\{[^}]*\}/);
  assert.ok(acts, '应存在 .req-row .row-acts 容器样式');
  assert.match(acts[0], /flex-wrap:\s*nowrap/, '操作区内部不得换行');
  assert.match(acts[0], /overflow-x:\s*auto/, '极窄容器下操作区应局部横向滚动');
  assert.match(acts[0], /max-width:\s*100%/, '操作区不超过卡片宽度，避免页面级横向溢出');
});

t('B4 图标按钮定宽等尺寸：.req-row .row-acts .btn.icon-act 有最小宽度，行内按钮仍 flex:none + nowrap', () => {
  const rule = css.match(/\.req-row \.row-acts \.btn\.icon-act\s*\{[^}]*\}/);
  assert.ok(rule, '应为图标操作按钮定义尺寸规则');
  assert.match(rule[0], /min-width:\s*\d+px/, '图标按钮应定宽（复制反馈图标切换不改变行宽）');
  const btn = css.match(/\.req-row \.row-acts \.btn\s*\{[^}]*\}/);
  assert.ok(btn, '行内按钮规则应保留');
  assert.match(btn[0], /flex:\s*none/, '行内按钮不应被压缩');
  assert.match(btn[0], /white-space:\s*nowrap/, '按钮内容不应折行');
});

t('B5 可访问名称与悬停提示：四类按钮均有 aria-label 与 title，动作语义含对应单号', () => {
  const tpl = rowActsTpl(reqRowFn());
  const expects = [
    ['data-accept-id', /aria-label="接受 \$\{esc\(it\.id\)\}"/, /title="[^"]*接受[^"]*"/],
    ['data-rename-id', /aria-label="编辑 \$\{esc\(it\.id\)\}[^"]*"/, /title="[^"]*(标题|描述)[^"]*"/],
    ['data-delete-id', /aria-label="删除 \$\{esc\(it\.id\)\}"/, /title="[^"]*删除[^"]*"/],
  ];
  for (const [kw, labelRe, titleRe] of expects) {
    const btn = buttons(tpl).find(([attrs]) => attrs.includes(kw));
    assert.ok(btn, `操作区应含 ${kw} 按钮`);
    assert.match(btn[0], labelRe, `${kw} 的 aria-label 应说明动作并带单号`);
    assert.match(btn[0], titleRe, `${kw} 应有悬停提示 title`);
  }
  // 复制按钮经 copyIdBtnHtml(it.id, { icon: true }) 渲染：图标分支应有 aria-label 与 title
  assert.match(tpl, /copyIdBtnHtml\(it\.id, \{ icon: true \}\)/, '操作区应以图标模式渲染复制按钮');
  const copyFn = js.match(/function copyIdBtnHtml\(id[^)]*\)[\s\S]*?\n\}/)?.[0] || '';
  const copyBtn = buttons(copyFn).find(([attrs]) => attrs.includes('data-copy-id'));
  assert.ok(copyBtn, 'copyIdBtnHtml 图标分支应输出含 data-copy-id 的按钮');
  assert.match(copyBtn[0], /aria-label="复制单号 \$\{esc\(id\)\}"/, '复制的 aria-label 应说明动作并带单号');
  assert.match(copyBtn[0], /title="复制单号 \$\{esc\(id\)\}"/, '复制应有悬停提示 title');
});

t('B6 回归：接受/修改/删除仍仅 submitted 渲染；顺序 复制 → 接受 → 修改 → 删除', () => {
  const tpl = rowActsTpl(reqRowFn());
  const copyAt = tpl.indexOf('data-copy-id');
  const acceptAt = tpl.indexOf('data-accept-id');
  const renameAt = tpl.indexOf('data-rename-id');
  const deleteAt = tpl.indexOf('data-delete-id');
  assert.ok(copyAt < acceptAt && acceptAt < renameAt && renameAt < deleteAt, '按钮顺序应为 复制 → 接受 → 修改 → 删除');
  for (const kw of ['data-accept-id', 'data-rename-id', 'data-delete-id']) {
    const at = tpl.indexOf(kw);
    assert.ok(at >= 0, `操作区应含 ${kw} 按钮`);
    const cond = tpl.slice(0, at).match(/it\.status === 'submitted' \?/g) || [];
    assert.ok(cond.length > 0, `${kw} 应以 submitted 为渲染条件`);
  }
  assert.doesNotMatch(tpl, /'submitted' \?[\s\S]{0,80}data-copy-id/, '复制图标不得被 submitted 条件包裹');
});

t('B7 复制反馈不塞长文案回工具行：icon-act 分支换 ✓ 图标 + 就近 title「已复制 <单号>」；「已复制 ✓」文案仅保留给非图标按钮', () => {
  const fn = copyIdFn();
  const branchAt = fn.indexOf("classList.contains('icon-act')");
  assert.ok(branchAt >= 0, 'copyId 应识别图标按钮分支');
  const textAt = fn.indexOf("el.textContent = '已复制 ✓'");
  assert.ok(textAt > branchAt, '应存在非图标分支的「已复制 ✓」长文案赋值');
  const iconBranch = fn.slice(branchAt, textAt);
  assert.match(iconBranch, /el\.textContent = '✓';/, '图标按钮反馈应换成 ✓ 图标（不放大段中文）');
  assert.match(iconBranch, /el\.title = `已复制 \$\{id\}`;/, '反馈应写入就近 title 提示');
  assert.match(fn.slice(branchAt), /else\s*\{\s*el\.textContent = '已复制 ✓';/, '长文案应以 else 分支与图标分支互斥');
  assert.match(fn, /el\.textContent = original;/, '反馈结束后应恢复原图标');
  assert.match(fn, /el\.title = originalTitle;/, '反馈结束后应恢复原 title');
});

t('B8 回归：详情抽屉仍用文本复制按钮（copyIdBtnHtml 默认输出「复制」），itemIdHtml 默认行为不变', () => {
  const fn = js.match(/function copyIdBtnHtml\(id[^)]*\)[\s\S]*?\n\}/);
  assert.ok(fn, '应存在 copyIdBtnHtml 函数');
  assert.match(fn[0], />复制<\/button>/, '默认（非图标）输出仍为文本「复制」');
  assert.match(fn[0], /\{ icon = false \}/, '图标模式应作为可选参数，不影响既有调用');
  const drawer = js.match(/function renderDrawer\(\)[\s\S]*?\n\}/);
  assert.ok(drawer, '应存在 renderDrawer 函数');
  assert.match(drawer[0], /\$\{itemIdHtml\(it\.id\)\}/, '抽屉头部单号应保留内嵌文本复制按钮');
  assert.match(drawer[0], /\$\{itemIdHtml\(b\.id\)\}/, '抽屉 Bug 子项单号应保留内嵌文本复制按钮');
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
