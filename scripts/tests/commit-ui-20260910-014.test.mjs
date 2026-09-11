#!/usr/bin/env node
// BUG-20260910-014 批量 Commit UI —— REQ-20260911-010 回退后保留部分测试
// 批量 Commit 面板（页签/启动区/运行面板/记录/创建/暂停/终止）已随人工批量提交流程回退
// 移除（回退契约见 commit-rollback-20260911-010.test.mjs）；本文件只守保留下来的
// 已完成条目提交状态徽标与详情字段（未提交/已提交+提交号/加载失败重试/hash 复制）。
// 用法：node scripts/tests/commit-ui-20260910-014.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const web = path.join(pluginRoot, 'scripts', 'web');
const js = fs.readFileSync(path.join(web, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(web, 'style.css'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- U6/U7 已完成条目徽标 ---------- */

function commitBadgeVm(it, commitStatus) {
  const fn = js.match(/function commitBadgeHtml\([^)]*\)[\s\S]*?\n\}/);
  assert.ok(fn, '应存在 commitBadgeHtml');
  const hashList = js.match(/function commitHashListHtml\([^)]*\)[\s\S]*?\n\}/);
  assert.ok(hashList, '应存在 commitHashListHtml');
  const ctx = { state: { commitStatus }, esc: String };
  vm.createContext(ctx);
  return vm.runInContext(`${hashList[0]}\n${fn[0]}\ncommitBadgeHtml(${JSON.stringify(it)}, { expandable: true })`, ctx);
}

t('U6 徽标：done 默认未提交；有索引记录显示已提交并可展开全部 hash；非 done 不渲染', () => {
  const h1 = '3f7a1c9d2e4b5a6f7c8d9e0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c';
  const h2 = 'aa11bb22cc33dd44ee55ff6677889900aabbccddeeff00112233445566778899';
  const st = { map: {}, error: null };
  // 非 done / 待测试 条目：不渲染徽标
  assert.equal(commitBadgeVm({ id: 'REQ-1', status: 'in-progress' }, st), '', '开发中条目不渲染徽标');
  assert.equal(commitBadgeVm({ id: 'REQ-1', status: 'accepted' }, st), '', '已接受条目不渲染徽标');
  // done 默认未提交
  const un = commitBadgeVm({ id: 'REQ-1', status: 'done' }, st);
  assert.match(un, /未提交/, 'done 条目默认未提交');
  assert.doesNotMatch(un, /已提交/, '不得显示已提交');
  // 待测试（in-progress 已上报）同样渲染（REQ-20260911-009）
  const ip = commitBadgeVm({ id: 'REQ-1', status: 'in-progress', agentCompletedAt: '2026-09-11T00:00:00Z' }, st);
  assert.match(ip, /未提交/, '待测试条目默认未提交');
  // 有索引记录：已提交 + 全部完整 hash 可展开（REQ-20260911-010：一单可关联多 commit，多提交号展开保留）
  const cm = commitBadgeVm({ id: 'REQ-1', status: 'done' }, { map: { 'REQ-1': { commits: [h1, h2] } }, error: null });
  assert.match(cm, /已提交/, '有索引记录显示已提交');
  assert.ok(cm.includes(h1) && cm.includes(h2), '展开后可见全部完整 hash');
  assert.match(cm, new RegExp(`data-copy-hash="${h1}"`), 'hash 有复制按钮');
  assert.match(cm, /2 个提交号|提交号/, '可展开多提交号');
});

t('U7 加载失败：显示「提交状态加载失败」+ 重试入口，不伪装成未提交；列表签名含提交状态', () => {
  const err = commitBadgeVm({ id: 'REQ-1', status: 'done' }, { map: { 'REQ-1': { commits: [] } }, error: '网络错误' });
  assert.match(err, /提交状态加载失败/, '失败态明确文案');
  assert.match(err, /data-commit-retry/, '失败态提供重试入口');
  assert.doesNotMatch(err, /未提交/, '查询失败不得伪装成未提交');
  assert.match(js, /function retryCommitStatus|data-commit-retry[\s\S]{0,400}refreshCommitStatus/, '重试应重新拉取提交状态');
  // 列表签名：提交状态变化触发重绘（轮询剪枝不吞掉徽标更新）
  const sig = js.match(/const sig = JSON\.stringify\(\[state\.search\.q[\s\S]*?\]\)/);
  assert.ok(sig, '应存在列表签名');
  assert.match(sig[0], /commitStatus|commitParts/, '列表签名应含提交状态数据');
  // 拉取失败保留已加载数据（不伪装、不抹掉）
  const fn = js.match(/async function refreshCommitStatus\(\)[\s\S]*?\n\}/);
  assert.ok(fn, '应存在 refreshCommitStatus');
  assert.match(fn[0], /cs\.error = e\.message/, '失败记录错误信息');
  assert.doesNotMatch(fn[0], /catch[\s\S]*?cs\.map\s*=\s*\{\}/, '失败不得清空已加载的提交状态');
  // 数据源：/api/commit/item-status（REQ-20260911-010 换源后的唯一取数口）
  assert.match(fn[0], /\/api\/commit\/item-status/, '取数走 /api/commit/item-status');
});

/* ---------- U8 详情页提交状态 ---------- */

t('U8 详情页：done 条目基本信息区含「提交状态」字段（未提交 / 已提交 + hash 列表 / 失败 + 重试）', () => {
  const drawer = js.match(/function renderDrawer\(\)[\s\S]*?\n  \$\('#drawerClose'\)/);
  assert.ok(drawer, '应存在 renderDrawer');
  assert.match(drawer[0], /提交状态/, '详情 meta 区应含提交状态字段');
  assert.match(js, /function commitStatusDetailHtml|commitBadgeHtml\(it, \{ detail: true \}\)|commitStatusHtml/, '详情有提交状态渲染函数');
  // 详情 hash 复制与重试绑定（bindCommitWidgets 或等价绑定覆盖 drawer）
  assert.match(js, /bindCommitWidgets\(drawer\)|bindCopyHashButtons\(drawer\)/, '详情应绑定 hash 复制与重试');
  const det = js.match(/function commitStatusDetailHtml\([^)]*\)[\s\S]*?\n\}/);
  assert.ok(det, '应存在 commitStatusDetailHtml');
  assert.match(det[0], /data-commit-retry/, '失败态详情提供重试按钮');
});

/* ---------- U9 样式 ---------- */

t('U9 样式：徽标三态 / hash 列表样式保留', () => {
  assert.match(css, /\.commit-badge\b/, '徽标基础样式');
  assert.match(css, /\.cm-uncommitted\b/, '未提交态样式');
  assert.match(css, /\.cm-committed\b/, '已提交态样式');
  assert.match(css, /\.cm-error\b/, '加载失败态样式');
  assert.match(css, /\.commit-hash-list\b/, 'hash 列表样式');
  assert.match(css, /\.commit-hash\b/, 'hash 文本样式（完整 hash 换行可见）');
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
