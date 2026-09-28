#!/usr/bin/env node
// BUG-20260928-011 构建发布预检口径重构：必选 2 项（发布文档审核/提交/合并 main、挑选条目
// 合并 main）+ 可选提醒 1 项（已完成未挑选条目，不阻塞）；旧 7 检中其余检查（冻结范围 /
// 工作区 / 官网全局配置 / 双语材料 / Web App 构建识别 / 原子推送预演）全部移除——相应
// 失败后移执行阶段暴露（人工已定夺）。真实临时 Git 夹具复用 build-publish 既有测试口径。
// 用法：node scripts/tests/bug-20260928-011.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as publish from '../lib/build-publish.mjs';
import * as buildStore from '../lib/build-store.mjs';
import * as core from '../lib/core.mjs';
import { git, gcommit, DOC_FILES, docHashes, makeProject, makeVersion } from './lib/build-publish-fixture.mjs';
import '../web/i18n.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-bug-20260928-011-'));
process.env.ATB_BUILD_PUBLISH_CONFIG = path.join(root, 'global.json');
const I = globalThis.ATBI18N;

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

const label = (run, name) => (run.precheck.checks || []).find((c) => c.label === name);

/* ---------- 必选项 ① 发布文档（审核 / 提交 / 合并 main） ---------- */

test('H1 全就绪：预检仅 2 项必选检查全通过，无提醒项；旧 7 检标签不再出现', async () => {
  const fx = makeProject(root, 'h1');
  const v = makeVersion(fx);
  const run = await publish.create(fx.db, fx.project, v, '1.0.0');
  const checked = await publish.precheck(fx.db, fx.project, run.id);
  assert.equal(checked.precheck.ok, true, JSON.stringify(checked.precheck.checks));
  assert.deepEqual(checked.precheck.checks.map((c) => c.label), ['发布文档', '挑选条目']);
  for (const c of checked.precheck.checks) assert.equal(c.advisory, undefined, '必选项不带提醒标记');
  for (const old of ['冻结范围', '工作区', '官网全局配置', '双语材料', '条目包含性', 'Web App 构建识别', '原子推送预演']) {
    assert.ok(!checked.precheck.checks.some((c) => c.label === old), `旧检查「${old}」不应再出现在预检结果中`);
  }
  // Web App 构建识别仍照实计算（执行阶段数据），但不再作为检查项
  assert.equal(checked.precheck.profile?.kind, 'static');
});

test('B1-a 文档未全部审核 → 阻塞并逐项列出缺口（文件 + 状态）', async () => {
  const fx = makeProject(root, 'b1a');
  const v = makeVersion(fx, { withDocs: false });
  // 只落提交与合并账，不做任何人工审核记录 → 全部文件未审核
  const h = docHashes(fx.project);
  buildStore.recordDocsCommit(fx.db, v.id, { commitHash: fx.docs, files: h, scopeFp: 'fp-test' });
  buildStore.recordDocsMerge(fx.db, v.id, {
    commitHash: fx.docs, replayedHash: fx.mainDocs,
    replays: [{ itemId: 'docs', original: fx.docs, replayed: fx.mainDocs }],
  });
  const run = await publish.create(fx.db, fx.project, buildStore.readVersion(fx.db, v.id), '1.0.0');
  const checked = await publish.precheck(fx.db, fx.project, run.id);
  assert.equal(checked.precheck.ok, false);
  const doc = label(checked, '发布文档');
  assert.equal(doc.ok, false);
  assert.match(doc.detail, /未全部审核通过/);
  assert.match(doc.detail, /缺 9 个/);
  assert.match(doc.detail, /README\.md（未总结）/);
  assert.match(doc.detail, /README_en\.md（未翻译）/);
  assert.match(doc.detail, /LICENSE\.md（待审核）/);
});

test('B1-b 文档已审核但未提交 → 阻塞并复用提交口径原因', async () => {
  const fx = makeProject(root, 'b1b');
  const v = makeVersion(fx, { withDocs: false });
  const h = docHashes(fx.project);
  for (const f of DOC_FILES) buildStore.recordDocsReview(fx.db, v.id, { file: f, hash: h[f] });
  const run = await publish.create(fx.db, fx.project, buildStore.readVersion(fx.db, v.id), '1.0.0');
  const checked = await publish.precheck(fx.db, fx.project, run.id);
  const doc = label(checked, '发布文档');
  assert.equal(doc.ok, false);
  assert.match(doc.detail, /尚未提交/);
});

test('B1-c 文档已审核已提交但未合并入 main → 阻塞并指向「文档合并」步（挑选条目不受影响）', async () => {
  const fx = makeProject(root, 'b1c', { pickDocs: false });
  const v = makeVersion(fx, { withDocs: false });
  const h = docHashes(fx.project);
  for (const f of DOC_FILES) buildStore.recordDocsReview(fx.db, v.id, { file: f, hash: h[f] });
  buildStore.recordDocsCommit(fx.db, v.id, { commitHash: fx.docs, files: h, scopeFp: 'fp-test' });
  const run = await publish.create(fx.db, fx.project, buildStore.readVersion(fx.db, v.id), '1.0.0');
  const checked = await publish.precheck(fx.db, fx.project, run.id);
  const doc = label(checked, '发布文档');
  assert.equal(doc.ok, false);
  assert.match(doc.detail, /尚未合并到 main/);
  assert.match(doc.detail, /文档合并/);
  // 条目提交（web）在 main 历史内：另一必选项不受文档未合并影响
  assert.equal(label(checked, '挑选条目').ok, true);
});

/* ---------- 必选项 ② 挑选条目（合并 main，含重放证据） ---------- */

test('B2 条目提交未合并入 main → 阻塞并指出具体条目与提交', async () => {
  const fx = makeProject(root, 'b2');
  const v = makeVersion(fx);
  const run = await publish.create(fx.db, fx.project, buildStore.readVersion(fx.db, v.id), '1.0.0');
  // 冻结后向版本计划补入一个仅存在于 dev 的条目提交（按当前计划清单核验，非冻结快照）
  fs.writeFileSync(path.join(fx.project, 'extra.txt'), 'extra');
  const side = gcommit(fx.project, 'side', 'extra.txt');
  buildStore.addItems(fx.db, v.id, [{ itemId: 'REQ-20260928-102', commits: [side] }]);
  const checked = await publish.precheck(fx.db, fx.project, run.id);
  const item = label(checked, '挑选条目');
  assert.equal(item.ok, false);
  assert.match(item.detail, /REQ-20260928-102/);
  assert.match(item.detail, /未包含在主分支/);
});

test('B3 条目提交经 cherry-pick 重放进 main → 认可重放证据，必选项通过', async () => {
  const fx = makeProject(root, 'b3', { itemReplay: true });
  const v = makeVersion(fx, { itemId: 'REQ-20260928-103' });
  const run = await publish.create(fx.db, fx.project, v, '1.0.0');
  const checked = await publish.precheck(fx.db, fx.project, run.id);
  assert.equal(checked.precheck.ok, true, JSON.stringify(checked.precheck.checks));
  assert.equal(label(checked, '挑选条目').ok, true);
  assert.equal(label(checked, '发布文档').ok, true);
});

/* ---------- 可选提醒：已完成未挑选条目（不阻塞） ---------- */

test('C1 存在已完成但未纳入任何版本计划的条目 → 预检通过并出现提醒（advisory，不阻塞）', async () => {
  const fx = makeProject(root, 'c1');
  const v = makeVersion(fx);
  const run = await publish.create(fx.db, fx.project, buildStore.readVersion(fx.db, v.id), '1.0.0');
  const st = core.createItem(fx.db, { type: 'requirement', title: '已完成未挑选需求', by: '测试' });
  const sf = path.join(fx.db, 'runtime', 'status', `${st.id}.json`);
  const s = JSON.parse(fs.readFileSync(sf, 'utf8'));
  s.status = 'done';
  fs.writeFileSync(sf, JSON.stringify(s, null, 2) + '\n');
  const checked = await publish.precheck(fx.db, fx.project, run.id);
  assert.equal(checked.precheck.ok, true, JSON.stringify(checked.precheck.checks));
  const adv = label(checked, '已完成未挑选条目');
  assert.ok(adv, '应出现提醒项');
  assert.equal(adv.ok, true, '提醒项不阻塞');
  assert.equal(adv.advisory, true);
  assert.match(adv.detail, new RegExp(st.id));
  assert.match(adv.detail, /不阻塞/);
});

test('C2 已完成条目已纳入其他版本计划 → 不提醒、不打扰（跨版本不重复提醒）', async () => {
  const fx = makeProject(root, 'c2');
  const v = makeVersion(fx);
  const run = await publish.create(fx.db, fx.project, buildStore.readVersion(fx.db, v.id), '1.0.0');
  const st = core.createItem(fx.db, { type: 'requirement', title: '已完成已挑选需求', by: '测试' });
  const sf = path.join(fx.db, 'runtime', 'status', `${st.id}.json`);
  const s = JSON.parse(fs.readFileSync(sf, 'utf8'));
  s.status = 'done';
  fs.writeFileSync(sf, JSON.stringify(s, null, 2) + '\n');
  buildStore.createVersion(fx.db, { name: '下一版', version: '1.1.0', items: [{ itemId: st.id, commits: [fx.web] }] });
  const checked = await publish.precheck(fx.db, fx.project, run.id);
  assert.equal(checked.precheck.ok, true);
  assert.equal(checked.precheck.checks.length, 2, '仅 2 项必选，无提醒项');
  assert.ok(!checked.precheck.checks.some((c) => c.advisory), '已纳入版本计划的完成条目不提醒');
});

/* ---------- 旧检查移除：脏工作区 / 官网未配置 / main 前进不再阻塞预检 ---------- */

test('D2 工作区脏且官网未配置 → 预检仍通过（相应失败后移执行阶段暴露）', async () => {
  const fx = makeProject(root, 'd2');
  const v = makeVersion(fx);
  const run = await publish.create(fx.db, fx.project, buildStore.readVersion(fx.db, v.id), '1.0.0');
  fs.writeFileSync(path.join(fx.project, 'dirty.txt'), 'uncommitted'); // agent-team-board 外的脏文件
  const checked = await publish.precheck(fx.db, fx.project, run.id);
  assert.equal(checked.precheck.ok, true, JSON.stringify(checked.precheck.checks));
  assert.ok(!checked.precheck.checks.some((c) => ['工作区', '官网全局配置', '双语材料'].includes(c.label)));
});

test('D3 main 前进不再由预检拦截：预检通过，plan 因指纹失效拒绝；重新预检仍通过', async () => {
  const fx = makeProject(root, 'd3');
  const v = makeVersion(fx);
  const run = await publish.create(fx.db, fx.project, buildStore.readVersion(fx.db, v.id), '1.0.0');
  const first = await publish.precheck(fx.db, fx.project, run.id);
  assert.equal(first.precheck.ok, true);
  git(fx.project, 'checkout', 'main');
  git(fx.project, '-c', 'user.name=T', '-c', 'user.email=t@e.c', 'commit', '--allow-empty', '-m', 'advance');
  git(fx.project, 'checkout', 'dev');
  await assert.rejects(() => publish.plan(fx.db, fx.project, run.id), /失效/);
  const again = await publish.precheck(fx.db, fx.project, run.id);
  assert.equal(again.precheck.ok, true, JSON.stringify(again.precheck.checks));
});

/* ---------- UI 与 i18n（中英文同步） ---------- */

test('E1 i18n：新增预检文案中英文同步（静态词条 + 动态插值可翻译）', () => {
  const { EN, EN_DYNAMIC } = I._dict;
  assert.ok(EN['发布文档'], '词条：发布文档');
  assert.ok(EN['挑选条目'], '词条：挑选条目');
  assert.ok(EN['已完成未挑选条目'], '词条：已完成未挑选条目');
  assert.ok(EN_DYNAMIC['发布文档未全部审核通过：缺 ◇ 个（◇）'], '动态词条：审核缺口');
  assert.ok(EN_DYNAMIC['发布文档未提交或已变化：◇'], '动态词条：未提交');
  assert.ok(EN_DYNAMIC['发布文档尚未合并到 main：请先完成「文档合并」步（文档提交 ◇ 不在 main 历史中）'], '动态词条：未合并');
  assert.ok(EN_DYNAMIC['条目 ◇ 的提交（◇）未包含在主分支（含重放证据核对）'], '动态词条：条目未包含');
  assert.ok(EN_DYNAMIC['存在 ◇ 个已完成但未纳入任何版本计划的条目：◇（不阻塞本次发布，可考虑纳入后续版本）'], '动态词条：提醒');
  I.setLang('en');
  assert.equal(I.t('发布文档'), 'Release docs');
  assert.equal(I.t('挑选条目'), 'Picked items');
  const itemMsg = `条目 REQ-20260928-102 的提交（${'a'.repeat(12)}）未包含在主分支（含重放证据核对）`;
  const itemEn = I.t(itemMsg);
  assert.ok(itemEn.startsWith('Item REQ-20260928-102 commit ('), `条目句可译：${itemEn}`);
  assert.ok(!/未包含/.test(itemEn), '条目句模板部分不再残留中文');
  const advMsg = `存在 1 个已完成但未纳入任何版本计划的条目：REQ-20260928-099（不阻塞本次发布，可考虑纳入后续版本）`;
  const advEn = I.t(advMsg);
  assert.ok(!/存在|不阻塞|条目/.test(advEn), `提醒句模板部分不再残留中文：${advEn}`);
  assert.ok(/REQ-20260928-099/.test(advEn), '提醒句数据保留');
  I.setLang('zh');
});

test('E2 预检结果渲染：必选项与提醒项区分展示（标签独立文本节点可被 i18n 翻译）', () => {
  const webRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'web');
  const src = fs.readFileSync(path.join(webRoot, 'build.js'), 'utf8');
  // 提醒项分支（advisory）独立渲染，不与必选项的「通过 / 未通过」混排
  assert.match(src, /c\.advisory/, '渲染层须有提醒项分支');
  // 标签包在独立元素内（与「：通过」分离为不同文本节点，保证 i18n 全文匹配可命中）
  assert.match(src, /<strong>\$\{esc\(c\.label\)\}<\/strong>/, '标签应包在独立元素中');
  const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');
  assert.match(css, /\.rel-check-advisory/, '提醒项样式类存在');
});

for (const [name, fn] of cases) {
  await fn();
  console.log(`PASS ${name}`);
}
publish.stopServers();
fs.rmSync(root, { recursive: true, force: true });
