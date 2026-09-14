#!/usr/bin/env node
// BUG-20260912-003 提交号显示优化 —— 短提交号直显 / 去掉「已提交」徽标 / 双击复制完整 hash
// 口径（README「待确认」默认）：提交号只显示前 5 位；有记录不再渲染「已提交」徽标与
// 「N 个提交号」折叠层，原徽标位直显短提交号；双击短号复制完整 40 位 hash（不冒泡开详情）；
// 「未提交」「提交状态加载失败（重试）」保持现状；纯前端展示裁剪，不动数据源与提交账本。
// 用法：node scripts/tests/bug-commit-hash-display-20260912-003.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import '../web/i18n.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const web = path.join(pluginRoot, 'scripts', 'web');
const js = fs.readFileSync(path.join(web, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(web, 'style.css'), 'utf8');
const I = globalThis.ATBI18N;
assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
const { EN, EN_DYNAMIC } = I._dict;

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const H1 = '8c57c9d2e4b5a6f7c8d9e0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1';
const H2 = 'aa11bb22cc33dd44ee55ff6677889900aabbccddeeff00112233445566778899';

/* ---------- VM 提取（与 commit-ui-20260910-014 同套路） ---------- */

function commitVm(it, commitStatus, opts) {
  const shortFn = js.match(/function commitShortHash\([^)]*\)[\s\S]*?\n\}/);
  assert.ok(shortFn, '应存在 commitShortHash');
  const hashList = js.match(/function commitHashListHtml\([^)]*\)[\s\S]*?\n\}/);
  assert.ok(hashList, '应存在 commitHashListHtml');
  const badge = js.match(/function commitBadgeHtml\([^)]*\)[\s\S]*?\n\}/);
  assert.ok(badge, '应存在 commitBadgeHtml');
  const ctx = { state: { commitStatus }, esc: String };
  vm.createContext(ctx);
  return vm.runInContext(
    `${shortFn[0]}\n${hashList[0]}\n${badge[0]}\ncommitBadgeHtml(${JSON.stringify(it)}, ${JSON.stringify(opts || {})})`,
    ctx
  );
}

function hashListVm(hashes) {
  const shortFn = js.match(/function commitShortHash\([^)]*\)[\s\S]*?\n\}/);
  const hashList = js.match(/function commitHashListHtml\([^)]*\)[\s\S]*?\n\}/);
  const ctx = { esc: String };
  vm.createContext(ctx);
  return vm.runInContext(`${shortFn[0]}\n${hashList[0]}\ncommitHashListHtml(${JSON.stringify(hashes)})`, ctx);
}

/* ---------- T1 徽标移除：原徽标位直显短提交号，无折叠层 ---------- */

t('T1 徽标移除：有记录不渲染「已提交」徽标与折叠层，列表卡原位直显提交号列表；详情位不重复渲染', () => {
  const st = { map: { REQ1: { commits: [H1, H2] } }, error: null };
  const card = commitVm({ id: 'REQ1', status: 'done' }, st, { inline: true });
  assert.doesNotMatch(card, /已提交/, '不渲染「已提交」徽标');
  assert.doesNotMatch(card, /commit-hashes\b|个提交号|<details/, '不再有「N 个提交号」折叠层');
  assert.match(card, /commit-hash-list/, '原徽标位直接渲染提交号列表');
  // 详情抽屉（非 inline）：徽标部分为空，列表由 commitStatusDetailHtml 渲染，两处口径一致不重复
  const drawer = commitVm({ id: 'REQ1', status: 'done' }, st, {});
  assert.equal(drawer, '', '详情位徽标部分返回空（列表由 commitStatusDetailHtml 负责）');
  assert.match(js, /commitBadgeHtml\(it\)\}\$\{commitStatusDetailHtml\(it\)\}/, '详情调用点保持两段拼接');
  assert.match(js, /commitBadgeHtml\(it, \{ inline: true \}\)/, '列表卡以 inline 直显提交号');
});

/* ---------- T2 短号展示：前 5 位 + title 完整值 + 无独立复制按钮 ---------- */

t('T2 短号展示：code.commit-hash 文本为前 5 位，title 含完整 40 位 hash，不再有「复制」按钮', () => {
  const html = hashListVm([H1, H2]);
  const codes = html.match(/<code class="commit-hash"/g) || [];
  assert.equal(codes.length, 2, '两个提交号并列各渲染一个短号');
  assert.match(html, new RegExp(`>${H1.slice(0, 5)}</code>`), '短号文本为前 5 位');
  assert.match(html, new RegExp(`>${H2.slice(0, 5)}</code>`), '第二个短号同为前 5 位');
  assert.doesNotMatch(html, new RegExp(`>${H1}</code>`), '正文不再直出完整 40 位 hash');
  assert.match(html, new RegExp(`title="完整提交号：${H1}（双击复制完整值）"`), '悬停 title 可见完整 hash');
  assert.match(html, new RegExp(`data-copy-hash="${H1}"`), '复制口径保留完整 hash');
  assert.match(html, new RegExp(`data-copy-hash="${H2}"`), '第二个 hash 同样保留完整复制口径');
  assert.doesNotMatch(html, /copy-hash-btn|>复制<\/button>/, '独立「复制」按钮移除（双击即复制）');
  assert.match(js, /function commitShortHash[\s\S]{0,120}slice\(0, 5\)/, '展示口径固定前 5 位');
});

/* ---------- T3 双击复制：dblclick 触发且不冒泡开详情 ---------- */

t('T3 双击复制：[data-copy-hash] 绑定 dblclick → copyHash，click/dblclick 均不冒泡打开详情', () => {
  const bind = js.match(/function bindCommitWidgets\([^)]*\)[\s\S]*?\n\}/);
  assert.ok(bind, '应存在 bindCommitWidgets');
  assert.match(bind[0], /querySelectorAll\('\[data-copy-hash\]'\)/, '仍以 data-copy-hash 识别复制入口');
  assert.match(bind[0], /addEventListener\('dblclick'[\s\S]{0,200}copyHash\(el\.dataset\.copyHash/, '双击触发复制');
  assert.match(bind[0], /addEventListener\('dblclick'[\s\S]{0,60}stopPropagation/, '双击不冒泡');
  assert.match(bind[0], /addEventListener\('click'[^]*?stopPropagation\(\)/, '双击前的单击不冒泡（不误开详情抽屉）');
  assert.doesNotMatch(bind[0], /addEventListener\('click'[\s\S]{0,120}copyHash/, '单击不复制（口径为双击）');
  // 列表卡上复制绑定先于行点击绑定（openDrawer），短号上的 stopPropagation 才能拦住开抽屉
  assert.match(js, /bindCommitWidgets\(el\);[\s\S]{0,120}openDrawer\(it\.id\)/, '卡片仍保留 bindCommitWidgets → 行点击顺序');
  assert.match(js, /bindCommitWidgets\(drawer\)/, '详情抽屉同样绑定双击复制');
});

/* ---------- T4 复制口径与反馈：完整 hash + 成功/失败反馈 ---------- */

t('T4 复制口径：copyHash 复制完整 40 位 hash（clipboard → execCommand 降级），成功有反馈、失败提示保留', () => {
  const cp = js.match(/async function copyHash\([^)]*\)[\s\S]*?\n\}/);
  assert.ok(cp, '应存在 copyHash');
  assert.match(cp[0], /navigator\.clipboard\.writeText\(hash\)/, '剪贴板写入完整 hash（非 5 位短号）');
  assert.match(cp[0], /execCommand\('copy'\)/, '剪贴板不可用时 execCommand 降级保留');
  assert.match(cp[0], /classList\.add\('copied'\)/, '复制成功短号高亮反馈');
  assert.match(cp[0], /已复制完整提交号/, '复制成功有可读 toast 反馈');
  assert.match(cp[0], /复制失败，请手动框选完整提交号/, '复制失败降级提示保留（可手动框选完整值）');
});

/* ---------- T5 未受影响状态回归 ---------- */

t('T5 回归：无记录仍「未提交」；查询失败仍「提交状态加载失败」+ 重试；非完成条目不渲染', () => {
  const st = { map: {}, error: null };
  const un = commitVm({ id: 'REQ1', status: 'done' }, st, { inline: true });
  assert.match(un, /未提交/, 'done 无记录显示未提交');
  assert.match(un, /cm-uncommitted/, '未提交态样式类保留');
  const ip = commitVm({ id: 'REQ1', status: 'in-progress', agentCompletedAt: '2026-09-11T00:00:00Z' }, st, { inline: true });
  assert.match(ip, /未提交/, '待测试（in-progress 已上报）条目同样渲染');
  const dev = commitVm({ id: 'REQ1', status: 'in-progress' }, st, { inline: true });
  assert.equal(dev, '', '开发中条目不渲染');
  const acc = commitVm({ id: 'REQ1', status: 'accepted' }, st, { inline: true });
  assert.equal(acc, '', '已接受条目不渲染');
  const err = commitVm({ id: 'REQ1', status: 'done' }, { map: { REQ1: { commits: [H1] } }, error: '网络错误' }, { inline: true });
  assert.match(err, /提交状态加载失败/, '失败态明确文案');
  assert.match(err, /data-commit-retry/, '失败态提供重试入口');
  assert.doesNotMatch(err, /未提交/, '查询失败不伪装成未提交');
});

/* ---------- T6 i18n 同步 ---------- */

t('T6 i18n：新增动态词条入 EN_DYNAMIC（◇ ↔ $1），不可达旧键（已提交/个提交号/复制提交号）清理', () => {
  assert.equal(
    EN_DYNAMIC['完整提交号：◇（双击复制完整值）'],
    'Full commit hash: $1 (double-click to copy)',
    'title 悬停提示词条（英文）'
  );
  assert.equal(EN_DYNAMIC['✓ 已复制完整提交号 ◇…'], '✓ Copied full commit hash $1…', '复制成功 toast 词条（英文）');
  assert.ok(!('已提交' in EN), '「已提交」徽标词条随 UI 移除清理');
  assert.ok(!('◇ 个提交号' in EN_DYNAMIC), '折叠 summary 词条清理');
  assert.ok(!('复制提交号 ◇' in EN_DYNAMIC), '复制按钮 aria 词条清理');
});

/* ---------- T7 样式 ---------- */

t('T7 样式：cm-committed 徽标样式移除；短号 cursor: copy + copied 高亮；折叠层死样式清理', () => {
  assert.doesNotMatch(css, /cm-committed/, '「已提交」徽标样式随 UI 移除');
  assert.match(css, /\.commit-hash\b[\s\S]{0,200}cursor: copy/, '短号提示可复制光标');
  assert.match(css, /\.commit-hash\.copied/, '复制成功高亮样式');
  assert.match(css, /\.commit-hash-list\b/, '提交号列表样式保留');
  assert.match(css, /\.commit-hash\b/, '短号文本样式保留');
  assert.doesNotMatch(css, /\.commit-hashes\b/, '折叠层死样式清理');
  assert.doesNotMatch(css, /\.commit-hash-row\b/, '旧行布局死样式清理');
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
