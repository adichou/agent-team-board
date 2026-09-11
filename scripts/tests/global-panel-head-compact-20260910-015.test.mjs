#!/usr/bin/env node
// BUG-20260910-015 全局任务面板头部紧凑化：副标题精简并与搜索框同排 —— 零依赖（node:assert），
// 静态断言 index.html / app.js / style.css（沿用 global-entry-panel-20260910-004.test.mjs 契约风格）。
// 用法：node scripts/tests/global-panel-head-compact-20260910-015.test.mjs
// 覆盖条目 test-cases.md 的 U1–U9；默认 560px 面板同排视觉与窄屏折行按 README 验收标准人工核对。

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

function rule(sel) {
  const m = flat.match(new RegExp(`(?:^|[{}])\\s*${escapeRe(sel)}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `缺少规则 ${sel}`);
  return m[1];
}

function fnBody(src, name) {
  const m = src.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(m, `未找到函数 ${name}`);
  return m[1];
}

const panel = html.match(/<aside id="globalPanel"[\s\S]*?<\/aside>/);
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('U1 副标题精简为「跨项目批量任务」，不再含原长句', () => {
  assert.ok(panel, '应有 #globalPanel');
  const scope = panel[0].match(/<p class="global-panel-scope"[^>]*>([^<]*)<\/p>/);
  assert.ok(scope, '应有 .global-panel-scope 副标题');
  assert.equal(scope[1].trim(), '跨项目批量任务', '副标题应为精简文案（保留跨项目 + 批量任务两层含义）');
  assert.doesNotMatch(scope[1], /全部注册项目|不随顶栏项目选择变化/, '原长句说明不得保留在正文副标题中');
});

t('U2 原语义以 title 辅助说明保留', () => {
  const scope = panel[0].match(/<p class="global-panel-scope"[^>]*>/);
  assert.ok(scope, '应有 .global-panel-scope 开始标签');
  assert.match(scope[0], /title="不随顶栏项目选择变化"/, '「不随顶栏项目选择变化」语义经 title 保留');
});

t('U3 同排结构：副标题与搜索同在 .global-panel-tools；标题区只余 h2', () => {
  const tools = panel[0].match(/<div class="global-panel-tools">([\s\S]*?)<\/div>/);
  assert.ok(tools, '应有 .global-panel-tools 工具行');
  assert.match(tools[1], /class="global-panel-scope"/, '工具行内应含精简副标题（左侧）');
  assert.match(tools[1], /id="globalSearchInput"/, '工具行内应含搜索输入（右侧，与副标题同排）');
  const iScope = tools[1].indexOf('global-panel-scope');
  const iSearch = tools[1].indexOf('globalSearchInput');
  assert.ok(iScope !== -1 && iSearch !== -1 && iScope < iSearch, '副标题在前、搜索在后（左副标题右搜索）');
  const title = panel[0].match(/<div class="global-panel-title">([\s\S]*?)<\/div>/);
  assert.ok(title, '应有 .global-panel-title 标题区');
  assert.match(title[1], /<h2>全局任务<\/h2>/, '标题区含「全局任务」标题');
  assert.doesNotMatch(title[1], /global-panel-scope/, '副标题不得再位于标题区内（已移至与搜索同排）');
});

t('U4 首行独立：标题 + 关闭按钮；常驻头部节点均在内容区之前', () => {
  const head = panel[0].match(/<header class="global-panel-head">([\s\S]*?)<\/header>/);
  assert.ok(head, '应有 .global-panel-head 首行');
  assert.match(head[1], /<h2>全局任务<\/h2>/, '首行含标题');
  assert.match(head[1], /id="globalPanelClose"/, '首行含右上关闭按钮');
  assert.doesNotMatch(head[1], /globalSearchInput|global-panel-scope/, '首行只有标题与关闭（副标题+搜索在次行）');
  // 常驻节点顺序：关闭按钮、搜索输入均位于内容区之前（不随内容重渲染）
  const iClose = panel[0].indexOf('id="globalPanelClose"');
  const iSearch = panel[0].indexOf('id="globalSearchInput"');
  const iBody = panel[0].indexOf('id="globalPanelBody"');
  assert.ok(iClose !== -1 && iSearch !== -1 && iBody !== -1, '关闭按钮 / 搜索 / 内容区均存在');
  assert.ok(iClose < iBody && iSearch < iBody, '关闭按钮与搜索输入应在内容区之前（常驻头部）');
});

t('U5 搜索输入契约不变：type / placeholder / aria-label / enterkeyhint / autocomplete', () => {
  const input = panel[0].match(/<input id="globalSearchInput"[^>]*>/);
  assert.ok(input, '应有 #globalSearchInput');
  assert.match(input[0], /type="search"/, 'type=search');
  assert.match(input[0], /placeholder="搜项目 \/ 批次号 \/ 条目编号…"/, '占位符沿用全局口径');
  assert.match(input[0], /aria-label="搜索全局任务（跨项目）"/, '可访问名称标注跨项目语义');
  assert.match(input[0], /enterkeyhint="search"/, 'enterkeyhint=search 保留');
  assert.match(input[0], /autocomplete="off"/, 'autocomplete=off 保留');
});

t('U6 同排样式：工具行 flex + wrap + 单条分隔；搜索输入伸缩而非全宽；副标题 margin 收敛', () => {
  const tools = rule('.global-panel-tools');
  assert.match(tools, /display:\s*flex/, '工具行应为弹性同排布局');
  assert.match(tools, /flex-wrap:\s*wrap/, '窄屏空间不足时行内自然折为两行');
  assert.match(tools, /align-items:\s*center/, '副标题与搜索垂直居中对齐');
  const search = rule('.global-panel-tools .search-input');
  assert.match(search, /flex:\s*1 1 \d+px/, '搜索输入应为伸缩项（默认面板内与副标题同排靠右）');
  assert.match(search, /min-width:\s*\d+px/, '搜索输入需 min-width（配合 wrap 触发折行、防过度压缩）');
  assert.doesNotMatch(search, /width:\s*100%/, '搜索输入不得再全宽独占（width:100% 为缺陷布局）');
  const scope = rule('.global-panel-scope');
  assert.match(scope, /margin:\s*0\b/, '副标题不再需要标题下间距（与搜索同排）');
});

t('U7 消除重复分隔与留白：头部区只余工具行一条 border-bottom', () => {
  const head = rule('.global-panel-head');
  assert.doesNotMatch(head, /border-bottom/, '.global-panel-head 不得再有 border-bottom（分隔统一由工具行承担）');
  const tools = rule('.global-panel-tools');
  assert.match(tools, /border-bottom:\s*1px solid var\(--border\)/, '工具行保留唯一一条与内容区的分隔线');
  // 纵向留白收敛：head 底 padding 小于顶 padding（次行与首行视觉同组，不再两层 padding 叠加）
  const m = head.match(/padding:\s*(\d+)px\s+\d+px\s+(\d+)px/);
  assert.ok(m, '头部 padding 应为三段写法（顶 左右 底）');
  assert.ok(Number(m[2]) < Number(m[1]), '头部底 padding 应小于顶 padding（消除重复留白）');
});

t('U8 窄屏适配：≤640px 媒体查询保留密排与折行防御', () => {
  // style.css 有多个 640px 断点块，取全局面板所在的那一个
  const blocks = flat.match(/@media \(max-width: 640px\) \{[\s\S]*?\}\s*\}/g);
  assert.ok(blocks, '应有 ≤640px 窄屏适配');
  const narrow = blocks.find((b) => b.includes('.global-panel'));
  assert.ok(narrow, '全局面板应有窄屏适配块');
  assert.match(narrow, /\.global-panel-tools\s*\{[^}]*padding/, '窄屏应调整工具行 padding');
  assert.match(narrow, /\.global-panel-head\s*\{[^}]*padding/, '窄屏应同步调整首行 padding（密排）');
  assert.match(flat, /\.global-panel-head\s*\{[^}]*flex-wrap:\s*wrap/, '头部保留 flex-wrap（极窄窗口关闭按钮不被挤压遮挡）');
  assert.doesNotMatch(flat, /\.global-panel-head[^{]*\{[^}]*overflow:\s*hidden/, '头部不得裁切（关闭按钮可达）');
});

t('U9 行为不回归：搜索常驻不重建、Esc 不冒泡、Enter 立即过滤、快照恢复回填', () => {
  const render = fnBody(js, 'renderGlobalView');
  assert.match(render, /\$\('#globalPanelBody'\)/, '渲染只写 #globalPanelBody（头部与搜索不随内容重渲染）');
  assert.doesNotMatch(render, /#globalSearchInput/, 'renderGlobalView 不得重建 / 改写搜索输入（不丢焦点与输入值）');
  const bind = fnBody(js, 'bindGlobalPanelOnce');
  assert.match(bind, /#globalSearchInput/, '搜索输入事件绑定保留');
  assert.match(bind, /e\.key === 'Escape'[\s\S]{0,160}stopPropagation/, '输入框内 Esc 只清空不冒泡（不触发关面板链）');
  assert.match(bind, /e\.key === 'Enter'/, 'Enter 立即按当前关键词过滤保留');
  const apply = fnBody(js, 'applyViewSnapshot');
  assert.match(apply, /#globalSearchInput/, '快照恢复仍回填面板搜索输入');
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
