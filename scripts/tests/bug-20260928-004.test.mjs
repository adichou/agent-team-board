#!/usr/bin/env node
// BUG-20260928-004 原验证「动作二 · 官网资料更新」官网提示词折叠布局（引入来源
// REQ-20260920-003 / REQ-20260926-002）。REQ-20260929-002 人工定夺：发布步「动作一 ·
// 推送远端 / 动作二 · 官网资料更新」两动作区整体删除——源码远端推送与官网物料不再由
// 「构建」模块发布步承担（发布收敛为「检查 → 二次确认 → 更新版本计划状态」）。本测试
// 改为删除契约：
//   D1 前端入口与渲染删除：renderReleaseFlowPane / 官网提示词折叠盒 / 复制与检测按钮 /
//      推送主分支动作 / 官网轮询定时器全部移除；
//   D2 服务端能力不动：publish-flow.buildSiteWritingPrompt 保留（「发布」模块官网物料链路
//      仍用，本条目不删除服务端提示词构建）；
//   D3 i18n 同步：发布步两动作区专属文案键（中英）随入口删除，词条不残留。
// 用法：node scripts/tests/bug-20260928-004.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../web/i18n.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildJs = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'build.js'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- D1 前端入口与渲染删除 ---------- */

t('D1-1 发布步两动作区渲染入口整体移除（renderReleaseFlowPane 及其专属控件 / 标签）', () => {
  for (const gone of [
    'renderReleaseFlowPane',
    'bld-site-prompt-box',
    'bld-site-prompt',
    'data-pf-copy-site',
    'data-pf-scan',
    'data-pf-push',
    'bld-push-main-remote',
    'SITE_STATE_LABEL',
  ]) {
    assert.ok(!buildJs.includes(gone), `build.js 不应再含「${gone}」`);
  }
});

t('D1-2 推送主分支 / 官网检测动作与轮询定时器移除（pushMain / siteScan / siteTimer）', () => {
  for (const gone of ['function pushMain', 'function siteScan', 'startSiteTimer', 'stopSiteTimer', 'siteTimer']) {
    assert.ok(!buildJs.includes(gone), `build.js 不应再含「${gone}」`);
  }
  assert.ok(!buildJs.includes('动作一 · 推送远端') && !buildJs.includes('动作二 · 官网资料更新'), '发布步无两动作标题');
  assert.ok(!buildJs.includes('推送主分支') && !buildJs.includes('立即检测'), '发布步无推送 / 检测按钮文案');
});

t('D1-3 ATBBuild 导出接缝随动作删除（pushMain / siteScan 不再导出）', () => {
  assert.ok(!/export[^]*pushMain/.test(buildJs) || !/loadReviewPair, approveReviewFile, commitDocs, pushMain/.test(buildJs), 'pushMain 不再出现在导出接缝');
  assert.ok(!buildJs.includes('pushMain, siteScan'), '导出列表不再含 pushMain / siteScan');
});

/* ---------- D2 服务端能力不动 ---------- */

t('D2 提示词构建保留：publish-flow.mjs 仍导出 buildSiteWritingPrompt（服务端官网物料链路不变）', async () => {
  const flow = await import('../lib/publish-flow.mjs');
  assert.equal(typeof flow.buildSiteWritingPrompt, 'function', 'buildSiteWritingPrompt 保留（本条目只删发布步入口，不动服务端能力）');
});

/* ---------- D3 i18n 同步 ---------- */

t('D3-1 发布步两动作区专属文案键随入口删除（EN 词典两语言键集一致由 i18n 既有测试把关）', () => {
  const { EN } = globalThis.ATBI18N._dict;
  for (const gone of [
    '动作一 · 推送远端',
    '动作二 · 官网资料更新',
    '推送主分支',
    '官网提示词（默认折叠，点击展开查看全文；复制后在官网仓库会话粘贴执行，提交消息须含完整计划号）',
    '复制官网提示词',
    '未配置官网仓库：先在设置中配置官网仓库根目录。',
    '尚未推送到远端（推送成功时间将作为官网资料更新的检测起点）。',
    '推送完成不等于正式发布：正式发布以「发布」按钮二次确认为准，确认后版本范围锁定。',
  ]) {
    assert.ok(!(gone in EN), `EN 词典不应再含发布步两动作区键「${gone}」`);
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
