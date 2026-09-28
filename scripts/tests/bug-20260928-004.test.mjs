#!/usr/bin/env node
// BUG-20260928-004 发布界面布局优化：「动作二 · 官网资料更新」官网提示词改折叠布局。
// 引入来源：REQ-20260920-003（renderReleaseFlowPane 引入常驻展开的 bld-site-prompt textarea；
// REQ-20260926-002 五步重排沿用，未随 REQ-20260921-007 折叠口径收敛）。
// 本测试为前端静态契约 + i18n 同步（BUG-20260912-001）：
//   L1 折叠布局：提示词区包 <details class="bld-docs-prompt-box bld-site-prompt-box">（无 open 属性，
//      默认收起），<summary> 摘要行说明用途与复制口径；
//   L2 能力保留：textarea（readonly）与「复制官网提示词」按钮在折叠区内、复制链路（handler 读
//      .bld-site-prompt + toast 文案）不变；官网同步状态标签与「立即检测」在折叠区外（收起态同屏可达）；
//      未配置官网仓库 fallback 文案不变；
//   L3 内容与逻辑不变：buildSiteWritingPrompt 仍在 publish-flow.mjs、server 仍以 homepageRepoRoot 门控；
//   L4 i18n 同步：摘要行 EN 词条齐备且译文无中文。
// 用法：node scripts/tests/bug-20260928-004.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../web/i18n.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildJs = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'build.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(pluginRoot, 'scripts', 'server.mjs'), 'utf8');

// 截取 renderReleaseFlowPane 函数体（到下一个顶层 function 定义为止）作为契约范围
const fnStart = buildJs.indexOf('function renderReleaseFlowPane');
assert.ok(fnStart > 0, 'build.js 应存在 renderReleaseFlowPane');
const fnEnd = buildJs.indexOf('\n  function ', fnStart);
const pane = buildJs.slice(fnStart, fnEnd > 0 ? fnEnd : undefined);

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- L1 折叠布局 ---------- */

t('L1-1 官网提示词包 details 折叠盒：复用 bld-docs-prompt-box 折叠样式并加 bld-site-prompt-box 标识类', () => {
  assert.ok(pane.includes('<details class="bld-docs-prompt-box bld-site-prompt-box">'), '提示词区应为默认折叠的 details（复用 REQ-20260921-007 折叠盒样式）');
});

t('L1-2 默认收起：details 无 open 属性（刷新 / 重新进入发布步仍默认折叠，不记忆展开状态）', () => {
  const open = pane.match(/<details[^>]*>/g) || [];
  assert.ok(open.length > 0, '发布步应存在 details 折叠盒');
  for (const tag of open) assert.ok(!/ open(=|>|\s)/.test(tag), `details 不应带 open 属性：${tag}`);
});

t('L1-3 摘要行：summary 说明用途与复制口径（查看全文可选、官网仓库执行、提交消息须含完整计划号）', () => {
  const m = pane.match(/<summary>([^<]*)<\/summary>/);
  assert.ok(m, '折叠盒应有 summary 摘要行');
  assert.match(m[1], /^官网提示词（/, '摘要行以「官网提示词（」开头');
  assert.match(m[1], /展开|查看全文/, '摘要行说明按需展开查看全文');
  assert.match(m[1], /官网仓库/, '摘要行说明在官网仓库执行');
  assert.match(m[1], /完整计划号/, '摘要行含提交消息须含完整计划号的复制口径');
});

/* ---------- L2 能力保留 ---------- */

t('L2-1 提示词全文与复制按钮在折叠区内：textarea.bld-site-prompt（readonly）+ data-pf-copy-site 按钮', () => {
  const dOpen = pane.indexOf('<details class="bld-docs-prompt-box bld-site-prompt-box">');
  const dClose = pane.indexOf('</details>', dOpen);
  assert.ok(dOpen > -1 && dClose > dOpen, '折叠盒应闭合');
  const ta = pane.indexOf('class="bld-site-prompt"');
  const btn = pane.indexOf('data-pf-copy-site');
  assert.ok(ta > dOpen && ta < dClose, '提示词 textarea 应在折叠区内');
  assert.ok(pane.slice(ta - 200, ta + 200).includes('readonly'), 'textarea 保持只读');
  assert.ok(btn > dOpen && btn < dClose, '「复制官网提示词」按钮应在折叠区内（展开后可达）');
});

t('L2-2 收起态同屏可达：官网同步状态标签与「立即检测」渲染在折叠盒之后（不被长提示词推挤）', () => {
  const dClose = pane.indexOf('</details>');
  const scan = pane.indexOf('data-pf-scan');
  const stLabel = pane.indexOf('SITE_STATE_LABEL');
  assert.ok(scan > dClose, '「立即检测」按钮应在折叠盒之后');
  assert.ok(stLabel > dClose, '官网同步状态标签应在折叠盒之后');
});

t('L2-3 复制链路不变：handler 仍读 .bld-site-prompt 值，成功 / 降级 toast 文案与现状一致', () => {
  assert.ok(buildJs.includes("const box = q('.bld-site-prompt');"), '复制 handler 仍从 .bld-site-prompt 读取全文');
  assert.ok(buildJs.includes('✓ 官网提示词已复制：请切换到官网仓库会话粘贴执行（提交消息须含完整计划号）'), '成功 toast 文案不变');
  assert.ok(buildJs.includes('剪贴板不可用：请在提示词文本框中全选（⌘A）并手动复制'), '剪贴板降级提示不变');
});

t('L2-4 未配置官网仓库 fallback 不变：仍显示未配置提示、不渲染折叠区', () => {
  assert.ok(pane.includes('未配置官网仓库：先在设置中配置官网仓库根目录。'), '未配置官网仓库提示文案保持现状');
  const fallback = pane.indexOf('未配置官网仓库：先在设置中配置官网仓库根目录。');
  const ternarySite = pane.indexOf('p.sitePrompt ?');
  assert.ok(ternarySite > -1 && fallback > ternarySite, '未配置提示仍在 sitePrompt 三元分支内（无提示词不渲染折叠区）');
});

/* ---------- L3 内容与服务端逻辑不变 ---------- */

t('L3-1 提示词构建不变：publish-flow.mjs 仍导出 buildSiteWritingPrompt，server 仍以 homepageRepoRoot 门控', async () => {
  const flow = await import('../lib/publish-flow.mjs');
  assert.equal(typeof flow.buildSiteWritingPrompt, 'function', 'buildSiteWritingPrompt 保留（提示词内容不改）');
  assert.ok(serverJs.includes('homepageRepoRoot'), '服务端仍以官网仓库根目录配置门控提示词构建');
});

/* ---------- L4 i18n 同步 ---------- */

t('L4-1 i18n 同步：摘要行与涉及文案 EN 词条齐备且译文无中文', () => {
  const { EN } = globalThis.ATBI18N._dict;
  const m = pane.match(/<summary>([^<]*)<\/summary>/);
  const zh = m[1];
  assert.ok(zh in EN, `EN 词典应含摘要行词条「${zh}」`);
  assert.ok(!/[\u4e00-\u9fff]/.test(EN[zh]), '摘要行译文不含中文');
  for (const key of ['复制官网提示词', '未配置官网仓库：先在设置中配置官网仓库根目录。']) {
    assert.ok(key in EN, `EN 词典应含「${key}」`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN[key]), `「${key}」译文不含中文`);
  }
});

/* ---------- 执行 ---------- */

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n${e && e.stack ? e.stack : e}`);
  }
}
if (failed) {
  console.error(`\n${failed} 个用例失败`);
  process.exit(1);
}
console.log(`\n全部通过（${cases.length} 例）`);
