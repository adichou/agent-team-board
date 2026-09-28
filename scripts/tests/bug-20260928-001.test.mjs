#!/usr/bin/env node
// BUG-20260928-001 版本计划的「已合并」标签应在文档与翻译合并后再显示。
// 现象：挑选合并完成（status = merged）即显示绿色「已合并」（st-ok），早于「文档合并」步
// （v.docsMerge 落账），与发布门禁「发布文档尚未合并入 main」自相矛盾。
// 修复口径（只收敛显示，不改状态机与门禁）：
//   - merged 且 docsMerge 已落账 → 绿色「已合并」（st-ok，原样）；
//   - merged 且 docsMerge 无落账 → 中间态「代码已并入 · 文档与翻译未合并」（st-wait），三处
//     （列表卡片 versionChip / 详情标题 / 删除确认弹窗）一致；卡片 meta「阶段」同步该口径；
//   - release.published 优先显示「已发布」（versionChip 既有优先级不变）；
//   - draft / merging / failed 三态不变；新增中文文案同步 i18n 英文词典。
// 用法：node scripts/tests/bug-20260928-001.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import '../web/i18n.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = path.join(pluginRoot, 'scripts', 'web');
const buildJs = fs.readFileSync(path.join(webRoot, 'build.js'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- 公共：vm 装载 build.js（取纯函数接缝） ---------- */

function loadBuild() {
  const el = () => ({
    innerHTML: '', textContent: '', value: '', dataset: {}, disabled: false,
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    appendChild() {}, setAttribute() {}, focus() {},
  });
  const document = { addEventListener() {}, body: el(), querySelector: () => null, querySelectorAll: () => [] };
  const sandbox = {
    document, console, URLSearchParams,
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  return sandbox.window.ATBBuild;
}

const HASH = 'a'.repeat(40);
// 取标签文本（span 内层文字），按整词断言（中间态文案含「已合并」子串属预期，不能按子串判）
const chipText = (chip) => (/<span class="st[^"]*">([^<]*)<\/span>/.exec(chip) || [])[1] || '';
// 版本桩：merged（挑选合并完成）；docsMerge 有 / 无两种形态（含存量遗留形态）。
const ver = (over = {}) => ({
  id: 'BLD-20260928-001', name: '版本 20260928-00', status: 'merged',
  items: [{ itemId: 'REQ-20260901-001', commit: HASH, commits: [HASH], mergedAt: '2026-09-28T00:00:00.000Z', mergeError: null }],
  merge: { startedAt: '2026-09-28T00:00:00.000Z', finishedAt: '2026-09-28T00:10:00.000Z', error: null, mainSha: HASH },
  docsMerge: null,
  release: null, released: false,
  ...over,
});

/* ---------- A 组：状态标签口径（三处共用纯函数） ---------- */

t('A1 merged 且 docsMerge 已落账：显示绿色「已合并」（st-ok），口径不回退', () => {
  const ATB = loadBuild();
  const v = ver({ docsMerge: { commitHash: HASH, replayedHash: HASH, mainSha: HASH, replays: [], mergedAt: '2026-09-28T01:00:00.000Z', history: [] } });
  const chip = ATB.statusChipFor(v);
  assert.ok(chip.includes('已合并'), '文案为「已合并」');
  assert.ok(chip.includes('st-ok'), '样式为绿色 st-ok');
  assert.ok(!chip.includes('文档未合并'), '不再叠加中间态文案');
});

t('A2 merged 且 docsMerge 无落账：不显示「已合并」标签，显示中间态「代码已并入 · 文档与翻译未合并」（st-wait，非绿）', () => {
  const ATB = loadBuild();
  for (const v of [ver(), ver({ docsMerge: {} }), ver({ docsMerge: { commitHash: null } })]) {
    const chip = ATB.statusChipFor(v);
    assert.notEqual(chipText(chip), '已合并', '标签文本不得为「已合并」');
    assert.ok(chip.includes('代码已并入 · 文档与翻译未合并'), '中间态文案含「文档未合并」语义');
    assert.ok(chip.includes('st-wait'), '中间态样式 st-wait（与绿色已合并可区分）');
    assert.ok(!chip.includes('st-ok'), '不得使用绿色 st-ok');
  }
});

t('A3 draft / merging / failed 三态口径不变（st-mute / st-run / st-fail）', () => {
  const ATB = loadBuild();
  assert.ok(ATB.statusChipFor(ver({ status: 'draft' })).includes('计划中'));
  assert.ok(ATB.statusChipFor(ver({ status: 'merging' })).includes('合并中'));
  assert.ok(ATB.statusChipFor(ver({ status: 'merging' })).includes('st-run'));
  const f = ATB.statusChipFor(ver({ status: 'failed', merge: { error: '冲突' } }));
  assert.ok(f.includes('失败') && f.includes('st-fail'));
});

t('A4 已发布优先级不变：release.published → 「已发布」，不受合并标签口径影响（卡片 versionChip）', () => {
  const ATB = loadBuild();
  const pub = { ...ver(), release: { published: true, runId: 'REL-1', version: '1.0.0' } };
  const chip = ATB.versionChip(pub);
  assert.ok(chip.includes('已发布'), '已发布仍最优先');
  assert.ok(chip.includes('st-ok'));
  // 存量兼容：已发布但 docsMerge 无落账（旧数据），卡片仍显示「已发布」，不误显中间态
  assert.ok(!chip.includes('文档未合并'));
});

t('A5 中间态标签文本与四态标签（计划中 / 合并中 / 已合并 / 失败）及「已发布」均可区分', () => {
  const ATB = loadBuild();
  assert.equal(chipText(ATB.statusChipFor(ver())), '代码已并入 · 文档与翻译未合并');
  for (const label of ['计划中', '合并中', '已合并', '失败', '已发布']) {
    assert.notEqual(chipText(ATB.statusChipFor(ver())), label, `中间态标签文本不得等于既有标签「${label}」`);
  }
});

/* ---------- B 组：三处渲染位收敛（源级契约：不再有直连 statusChip(v.status) 的调用点） ---------- */

t('B1 列表卡片 / 详情标题 / 删除确认弹窗三处统一走 statusChipFor（v），不再直读 status', () => {
  assert.ok(!buildJs.includes('statusChip(v.status)'), '不应残留 statusChip(v.status) 直连调用（三处均已换 statusChipFor）');
  assert.ok(buildJs.includes('function statusChipFor('), '暴露 statusChipFor 纯函数接缝');
  // 卡片 meta「阶段」与标签口径一致：merged 阶段文案经 stageOf 计算
  assert.ok(buildJs.includes('function stageOf(') || buildJs.includes('const stageOf ='), '阶段文案纯函数 stageOf 接缝');
});

t('B2 阶段文案与标签口径一致：merged 无 docsMerge 不再显示「正式发布」，与中间态同文案；docsMerge 落账后维持「正式发布」', () => {
  const ATB = loadBuild();
  assert.equal(ATB.stageOf(ver()), '代码已并入 · 文档与翻译未合并', '中间态阶段文案与标签一致（不再误显示「正式发布」）');
  assert.equal(ATB.stageOf(ver({ docsMerge: { commitHash: HASH } })), '正式发布', '文档合并后维持既有「正式发布」');
  assert.equal(ATB.stageOf(ver({ status: 'merging', items: [] })), '合并中');
  assert.equal(ATB.stageOf(ver({ status: 'failed', items: [] })), '失败（可重试）');
  assert.equal(ATB.stageOf(ver({ status: 'draft', items: [] })), '计划中');
});

/* ---------- C 组：i18n 中英同步 ---------- */

t('C1 新增中文文案在英文词典有对应翻译（i18n.js EN 静态精确键）', () => {
  const { EN } = globalThis.ATBI18N._dict;
  assert.equal(EN['代码已并入 · 文档与翻译未合并'], 'Code merged · docs & translation not merged');
});

t('C2 英文词典无自碰：新键不是其他词条的译文（往返不串）', () => {
  const { EN, ZH_EXACT } = (() => {
    const d = globalThis.ATBI18N._dict;
    return { EN: d.EN, ZH_EXACT: null };
  })();
  assert.ok(!Object.values(EN).includes('代码已并入 · 文档与翻译未合并'), '新中文键不得同时是某词条的英文译文');
  assert.ok(ZH_EXACT === null);
});

/* ---------- 运行 ---------- */

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✕ ${name}\n  ${e.message}`);
  }
}
if (failed) {
  console.error(`\n${failed} / ${cases.length} 例失败`);
  process.exit(1);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
