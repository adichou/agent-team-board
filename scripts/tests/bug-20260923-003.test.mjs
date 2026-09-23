#!/usr/bin/env node
// BUG-20260923-003 AI 翻译提示词优化 —— TDD 分层测试（L1 纯逻辑：publish-flow.buildDocTranslatePrompt）。
// L1-1 提示词不携带条目单号：构造含 REQ / BUG 关联范围的调用，提示词无 REQ- / BUG- 编号行、
//    无「修复了 N 个 bug」汇总句、无条目说明文件路径规则行，「关联范围」节整体不再输出
//    （AI 总结提示词阶段一口径不在本单范围，不动）。
// L1-2 提示词不内嵌基准全文：无 ===== 内嵌块与基准正文片段；含基准 → 目标文件名对应清单
//    （如 README.md → README_en.md）与项目路径锚点；指引子代理翻译时自行读盘；基准文件
//    缺失口径明确（跳过该文件翻译并在回执说明，不得编造）。
// L1-3 并行派发口径：对每个目标文件各派发一个子代理、全部并行（并行子代理数 = 目标文件数，
//    不设上限）；单文件任务边界（只读自己名下基准、只写自己名下目标）；目标计数与构成随
//    清单联动（BUG-20260922-002 口径：4 类 + 自定义 × 剩余语言，LICENSE 不进范围）。
// L1-4 回执链路与翻译约束不回归：atb translate file/done/fail 逐文件回执、唯一基准 /
//    不增删信息 / 不得编造 / 各语言地道行文 / README 同语言链接 / 短回执不粘贴全文；
//    无 runId 沿用既有门控（不输出回执指令段）。
// 用法：node scripts/tests/bug-20260923-003.test.mjs

import assert from 'node:assert/strict';
import * as flow from '../lib/publish-flow.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const ITEMS = [
  { itemId: 'REQ-20260923-001', commit: 'a'.repeat(40), title: '需求标题甲' },
  { itemId: 'REQ-20260923-002', commit: 'b'.repeat(40), title: '需求标题乙' },
  { itemId: 'BUG-20260923-001', commit: 'c'.repeat(40), title: '缺陷标题甲' },
  { itemId: 'BUG-20260923-002', commit: 'd'.repeat(40), title: '缺陷标题乙' },
];

const BASE_DOCS = {
  'README.md': '# 默认语言基准内容\n', 'CHANGELOG.md': '# 更新\n', 'FEATURES.md': '# 功能\n', 'AGENTS.md': '# 规则\n',
};
const readsOf = (contents) => (f) => (Object.prototype.hasOwnProperty.call(contents, f) ? contents[f] : null);

// 故意仍传入旧签名参数 items / readFile：新口径下函数应完全忽略（items 不进提示词、
// readFile 不再内嵌全文），以此证明关联范围与全文注入链路已摘除。
function translatePrompt({ items = ITEMS, langs = ['cn', 'en'], customDocs = [], runId = 'tr-20260923-010101-cd01' } = {}) {
  return flow.buildDocTranslatePrompt({
    projectRoot: '/tmp/proj-x', planId: 'BLD-20260923-003', items,
    runId, langs, customDocs,
    readFile: readsOf(BASE_DOCS),
    atbPath: '/tmp/atb.mjs',
  });
}

/* ---------- L1-1 不携带条目单号 ---------- */

t('L1-1 翻译提示词不携带条目单号（含 REQ / BUG 关联范围也不出现）', () => {
  const tp = translatePrompt();
  assert.ok(!tp.includes('REQ-2026') && !tp.includes('BUG-2026'), '全文无 REQ- / BUG- 编号');
  assert.ok(!/- (REQ|BUG)-\d/.test(tp), '无条目编号清单行');
  assert.ok(!tp.includes('修复了'), '无「修复了 N 个 bug」汇总句');
  assert.ok(!tp.includes('关联范围'), '「关联范围」节不再输出');
  assert.ok(!tp.includes('data/requirements/'), '无条目说明文件路径规则行');
});

/* ---------- L1-2 不内嵌基准全文 ---------- */

t('L1-2 翻译提示词不内嵌基准全文：只给路径与对应清单，缺失口径明确', () => {
  const tp = translatePrompt();
  assert.ok(!tp.includes('# 默认语言基准内容'), '基准正文不内嵌（readFile 注入口径废弃）');
  assert.ok(!tp.includes('=====') && !tp.includes('基准结束'), '无 ===== 内嵌块');
  for (const pair of ['README.md → README_en.md', 'CHANGELOG.md → CHANGELOG_en.md', 'FEATURES.md → FEATURES_en.md', 'AGENTS.md → AGENTS_en.md']) {
    assert.ok(tp.includes(pair), `基准 → 目标对应清单含 ${pair}`);
  }
  assert.ok(tp.includes('/tmp/proj-x'), '给出项目路径（磁盘路径锚点）');
  assert.ok(tp.includes('自行读取'), '指引子代理翻译时自行读盘');
  assert.ok(tp.includes('基准文件缺失') && tp.includes('回执中说明'), '基准缺失口径明确（跳过并在回执说明）');
  assert.ok(tp.includes('不得编造基准内容'), '缺失时不得编造基准内容');
});

/* ---------- L1-3 并行派发口径 ---------- */

t('L1-3 并行派发口径：每文件一个子代理、全部并行；单文件边界；计数随清单联动', () => {
  const tp = translatePrompt();
  assert.ok(tp.includes('每个目标文件各派发一个子代理'), '按目标文件逐个派发');
  assert.ok(/并行子代理数\s*=\s*目标文件数/.test(tp), '并行子代理数 = 目标文件数（不设上限）');
  assert.ok(tp.includes('全部并行'), '全部并行口径');
  assert.ok(tp.includes('只负责翻译自己名下的一个文件'), '单文件任务边界');
  assert.ok(tp.includes('共 4 个目标文件，4 类 × 1 语言，剩余语言 en'), '目标计数 4 × (N−1) 口径');

  const tpCustom = translatePrompt({ customDocs: ['MIGRATION'] });
  assert.ok(tpCustom.includes('共 5 个目标文件，4 类 + 1 自定义 × 1 语言，剩余语言 en'), '自定义计数联动（BUG-20260922-002 口径）');
  assert.ok(tpCustom.includes('MIGRATION.md → MIGRATION_en.md（English / MIGRATION / 自定义）'), '自定义基准 → 目标对应行');
  assert.ok(!tp.includes('LICENSE'), 'LICENSE 单文件类不进 AI 翻译范围（REQ-20260922-002 不回归）');
});

/* ---------- L1-4 回执链路与翻译约束不回归 ---------- */

t('L1-4 回执链路与翻译约束不回归；无 runId 沿用门控', () => {
  const tp = translatePrompt();
  assert.ok(tp.includes('tr-20260923-010101-cd01'), '带执行编号');
  assert.ok(tp.includes('translate file') && tp.includes('--state translating') && tp.includes('--state translated'), '逐文件回执指令');
  assert.ok(tp.includes('translate done') && tp.includes('translate fail'), '收尾 / 中断回执指令');
  assert.ok(tp.includes('唯一') && tp.includes('基准'), '唯一基准约束');
  assert.ok(tp.includes('不增删信息') && tp.includes('不得编造'), '不增删信息 / 不得编造');
  assert.ok(tp.includes('README_en.md → CHANGELOG_en.md / FEATURES_en.md'), 'README 同语言链接');
  assert.ok(tp.includes('不粘贴全文'), '短回执不粘贴全文');

  const tpNoRun = translatePrompt({ runId: null });
  assert.ok(!tpNoRun.includes('translate file'), '无 runId 不输出回执指令段（沿用既有门控）');
  assert.ok(!tpNoRun.includes('tr-20260923-010101-cd01'), '无 runId 不输出执行编号行');
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
