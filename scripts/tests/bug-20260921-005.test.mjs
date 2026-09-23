#!/usr/bin/env node
// BUG-20260921-005 AI 总结 / AI 翻译提示词不再逐条内嵌条目标题 —— TDD 分层测试。
// L1-1 关联范围精简（AI 总结口径；BUG-20260923-003 起翻译提示词不再携带关联范围）：
//    REQ 条目仅列编号（不带 commit 短 hash、不带标题）；BUG 条目不逐条罗列、不引导读取，
//    汇总一句「修复了 N 个 bug」；提示词全文不再出现任何条目标题。
// L1-2 路径规则：给出条目说明文件路径规则 <项目根>/agent-team-board/data/requirements/
//    <REQ-ID>/，引导子代理按编号自行读取 REQ 条目文件；BUG 无需逐条了解。
//    BUG-20260923-003：翻译提示词不再输出关联范围节 / 编号 / 汇总句 / 路径规则。
// L1-3 其余要素保持既有口径：项目路径 / 计划号 / 版本号 / 执行编号 / 文档清单（按语言集
//    展开）/ atb summary / translate 逐文件回执指令 / 写作与翻译约束 / 翻译唯一基准
//    （BUG-20260923-003 起翻译基准为路径化口径，全文不内嵌）。
// L1-4 量化缩短：341 条（165 REQ + 176 BUG，各 200 字标题）场景下，整份提示词长度 <
//    旧口径「关联范围」逐条标题块（编号 + 短 hash + 标题）长度的 50%。
// L1-5 边界：无 BUG 条目不出现汇总句；无 REQ 条目不出现路径规则行；items 为空时
//    「关联范围」小节仅保留标题行（与既有空态一致）。
// 用法：node scripts/tests/bug-20260921-005.test.mjs

import assert from 'node:assert/strict';
import * as flow from '../lib/publish-flow.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const ITEMS = [
  { itemId: 'REQ-20260921-001', commit: 'a'.repeat(40), title: '需求标题甲（不应内嵌进提示词）' },
  { itemId: 'REQ-20260921-002', commit: 'b'.repeat(40), title: '需求标题乙（不应内嵌进提示词）' },
  { itemId: 'BUG-20260921-001', commit: 'c'.repeat(40), title: '缺陷标题甲（不应内嵌进提示词）' },
  { itemId: 'BUG-20260921-002', commit: 'd'.repeat(40), title: '缺陷标题乙（不应内嵌进提示词）' },
];

const BASE_DOCS = {
  'README.md': '# 基准\n', 'CHANGELOG.md': '# 更新\n', 'FEATURES.md': '# 功能\n', 'AGENTS.md': '# 规则\n',
};
const readsOf = (contents) => (f) => (Object.prototype.hasOwnProperty.call(contents, f) ? contents[f] : null);

function summaryPrompt(items = ITEMS) {
  return flow.buildDocSummaryPrompt({
    projectRoot: '/tmp/proj-x', planId: 'BLD-20260921-005', items,
    runId: 'sum-20260921-010101-ab01', atbPath: '/tmp/atb.mjs',
  });
}
function translatePrompt(items = ITEMS) {
  return flow.buildDocTranslatePrompt({
    projectRoot: '/tmp/proj-x', planId: 'BLD-20260921-005', items,
    runId: 'tr-20260921-010101-cd01', langs: ['cn', 'en'],
    readFile: readsOf(BASE_DOCS), atbPath: '/tmp/atb.mjs',
  });
}

/* ---------- L1-1 / L1-2 关联范围精简（AI 总结口径；BUG-20260923-003 起翻译不再携带关联范围） ---------- */

t('L1-1 AI 总结提示词不逐条内嵌标题：REQ 仅编号、BUG 汇总一句', () => {
  const p = summaryPrompt();
  for (const it of ITEMS) {
    assert.ok(!p.includes(it.title), `总结提示词不应内嵌标题「${it.title}」`);
  }
  assert.ok(p.includes('- REQ-20260921-001') && p.includes('- REQ-20260921-002'), 'REQ 条目保留编号清单');
  assert.ok(!/- REQ-20260921-\d+（commit/.test(p) && !/- BUG-20260921-\d+（commit/.test(p), '编号行不再附带 commit 短 hash');
  assert.ok(!p.includes('- BUG-20260921-001') && !p.includes('- BUG-20260921-002'), 'BUG 编号不逐条罗列');
  assert.ok(p.includes('修复了 2 个 bug'), 'BUG 条目汇总为一句并带条数');
  assert.ok(p.includes('关联范围'), '关联范围小节保留');
});

t('L1-2 AI 总结提示词给出 REQ 条目文件路径规则，引导自行读取', () => {
  const p = summaryPrompt();
  assert.ok(
    p.includes('<项目根>/agent-team-board/data/requirements/<REQ-ID>/'),
    '条目说明文件路径规则（占位符形态，项目路径已在提示词头部给出）',
  );
  assert.ok(!p.includes('data/bugs/'), '不引导读取 BUG 条目文件');
});

t('L1-2b AI 翻译提示词不再携带关联范围（BUG-20260923-003：翻译以基准文档为唯一语境）', () => {
  const tp = translatePrompt();
  assert.ok(!tp.includes('- REQ-20260921-001') && !tp.includes('- REQ-20260921-002'), '翻译提示词不再列出 REQ 编号');
  assert.ok(!tp.includes('- BUG-20260921-001') && !tp.includes('- BUG-20260921-002'), 'BUG 编号不出现');
  assert.ok(!tp.includes('修复了'), '无 BUG 汇总句');
  assert.ok(!tp.includes('关联范围'), '「关联范围」节不再输出');
  assert.ok(!tp.includes('<项目根>/agent-team-board/data/requirements/<REQ-ID>/'), '无条目路径规则行');
});

/* ---------- L1-3 其余要素保持既有口径 ---------- */

t('L1-3 AI 总结提示词其余要素保持：项目路径/计划号/版本号/执行编号/文档清单/回执指令/写作约束', () => {
  const p = summaryPrompt();
  for (const s of ['/tmp/proj-x', 'BLD-20260921-005', '20260921-005', 'sum-20260921-010101-ab01']) {
    assert.ok(p.includes(s), `总结提示词应含 ${s}`);
  }
  for (const f of ['README.md', 'CHANGELOG.md', 'FEATURES.md', 'AGENTS.md']) {
    assert.ok(p.includes(`${f}（`), `总结清单含默认语言 ${f}`);
  }
  assert.ok(p.includes('summary file') && p.includes('summary done') && p.includes('summary fail'), 'atb summary 回执指令');
  assert.ok(p.includes('不得编造'), '写作约束保留');
});

t('L1-3 AI 翻译提示词其余要素保持：目标清单/回执指令/翻译约束；基准改路径化（BUG-20260923-003）', () => {
  const tp = translatePrompt();
  assert.ok(tp.includes('tr-20260921-010101-cd01'), '翻译提示词带 runId');
  assert.ok(!tp.includes('# 基准'), '翻译基准全文不再内嵌提示词（BUG-20260923-003 路径化口径）');
  assert.ok(tp.includes('唯一') && tp.includes('基准'), '唯一基准约束');
  for (const f of ['README_en.md', 'CHANGELOG_en.md', 'FEATURES_en.md', 'AGENTS_en.md']) {
    assert.ok(tp.includes(f), `翻译目标清单含 ${f}`);
  }
  assert.ok(tp.includes('translate file') && tp.includes('translate done') && tp.includes('translate fail'), 'atb translate 回执指令');
});

/* ---------- L1-4 量化缩短（大条目数场景） ---------- */

function bigItems() {
  const items = [];
  for (let i = 1; i <= 165; i += 1) {
    items.push({ itemId: `REQ-20260920-${String(i).padStart(3, '0')}`, commit: 'a'.repeat(40), title: '长'.repeat(200) });
  }
  for (let i = 1; i <= 176; i += 1) {
    items.push({ itemId: `BUG-20260920-${String(i).padStart(3, '0')}`, commit: 'b'.repeat(40), title: '陷'.repeat(200) });
  }
  return items;
}

t('L1-4 量化：341 条（200 字标题）场景下整份提示词 < 旧口径标题块长度的 50%', () => {
  const items = bigItems();
  const legacyBlock = items
    .map((it) => `- ${it.itemId}（commit ${String(it.commit).slice(0, 12)}）${it.title}`)
    .join('\n');
  assert.ok(legacyBlock.length > 70_000, '夹具口径对齐 BLD-20260920-001 量级（341 行 × 200 字标题）');
  for (const [name, p] of [['AI 总结', summaryPrompt(items)], ['AI 翻译', translatePrompt(items)]]) {
    assert.ok(p.length < legacyBlock.length * 0.5, `${name}提示词显著缩短（${p.length} < ${legacyBlock.length} × 50%）`);
  }
});

/* ---------- L1-5 边界 ---------- */

t('L1-5 边界：无 BUG 不出汇总句；无 REQ 不出路径规则行；空 items 保持空段', () => {
  const reqOnly = [{ itemId: 'REQ-20260921-001', commit: 'a'.repeat(40), title: '仅需求' }];
  const pReq = summaryPrompt(reqOnly);
  assert.ok(!pReq.includes('修复了'), '无 BUG 条目时不出现汇总句');
  assert.ok(pReq.includes('<项目根>/agent-team-board/data/requirements/<REQ-ID>/'), '有 REQ 条目时给出路径规则');

  const bugOnly = [{ itemId: 'BUG-20260921-001', commit: 'c'.repeat(40), title: '仅缺陷' }];
  const pBug = summaryPrompt(bugOnly);
  assert.ok(pBug.includes('修复了 1 个 bug'), '仅 BUG 条目时汇总句条数正确');
  assert.ok(!pBug.includes('<项目根>/agent-team-board/data/requirements/<REQ-ID>/'), '无 REQ 条目时不出现路径规则行');

  const pEmpty = summaryPrompt([]);
  assert.ok(pEmpty.includes('关联范围'), '空 items 保留小节标题行');
  assert.ok(!pEmpty.includes('修复了') && !pEmpty.includes('<REQ-ID>'), '空 items 不产出条目行与路径规则');

  const tReq = translatePrompt(reqOnly);
  assert.ok(!tReq.includes('修复了') && !tReq.includes('REQ-20260921-001'), '翻译提示词不携带条目单号（BUG-20260923-003：无 BUG 也不列 REQ）');
});

/* ---------- 汇总输出 ---------- */

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`✗ ${name}\n  ${err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n  ') : err}`);
  }
}
if (failed) {
  console.error(`\n${failed}/${cases.length} 用例失败`);
  process.exit(1);
}
console.log(`\n全部通过（${cases.length} 用例）`);
