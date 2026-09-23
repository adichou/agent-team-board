#!/usr/bin/env node
// BUG-20260923-004 AI 翻译的 README_en.md 中 AGENTS.md 的超链接文本不对 —— TDD 分层测试
// （L1 纯逻辑：publish-flow.buildDocTranslatePrompt 翻译约束）。
// 现象：AI 翻译把文内链接（如基准 README.md 的 [AGENTS.md](./AGENTS.md)）重定向到同语言
//    变体文件时，把带语言后缀的目标文件名一并写进了可见链接文本（[AGENTS_en.md](./AGENTS_en.md)）。
// 根因：翻译提示词只约束了「README 按语言链接同语言 CHANGELOG 与 FEATURES，链接必须真实可达」，
//    未约束「重定向只改链接目标、链接文本保持基准原文」，AI 为满足「真实可达」连文本一起改写。
// 修复口径：翻译约束补一条——文内链接指向同语言变体文件时只改链接目标；可见链接文本保持
//    基准原文（如 [AGENTS.md](./AGENTS_en.md)），不得把带语言后缀的文件名写进链接文本。
// 用法：node scripts/tests/bug-20260923-004.test.mjs

import assert from 'node:assert/strict';
import * as flow from '../lib/publish-flow.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function translatePrompt({ langs = ['cn', 'en'], customDocs = [], runId = 'tr-20260923-040404-ab04' } = {}) {
  return flow.buildDocTranslatePrompt({
    projectRoot: '/tmp/proj-x', planId: 'BLD-20260923-004',
    runId, langs, customDocs, atbPath: '/tmp/atb.mjs',
  });
}

/* ---------- L1-1 链接文本保持基准原文的约束存在 ---------- */

t('L1-1 翻译约束含「链接目标重定向、链接文本保持基准原文」规则与具体示例', () => {
  const tp = translatePrompt();
  assert.ok(tp.includes('链接目标') && tp.includes('链接文本'), '同时点明「链接目标」与「链接文本」两个概念');
  assert.ok(tp.includes('保持基准原文') || tp.includes('保持基准'), '可见链接文本保持基准原文（不跟随后缀改写）');
  assert.ok(tp.includes('[AGENTS.md](./AGENTS_en.md)'), '给出正确形态示例 [AGENTS.md](./AGENTS_en.md)（文本不变、目标换同语言变体）');
  assert.ok(tp.includes('不得把带语言后缀的文件名写进链接文本'), '明确禁止把 AGENTS_en.md 这类带后缀文件名写进文本');
});

/* ---------- L1-2 约束落在「翻译约束」节内 ---------- */

t('L1-2 新约束位于「翻译约束」节内（对每个目标文件的翻译行为生效）', () => {
  const tp = translatePrompt();
  const idx = tp.indexOf('翻译约束：');
  assert.ok(idx >= 0, '存在「翻译约束：」节');
  const section = tp.slice(idx);
  assert.ok(section.includes('链接文本'), '约束在翻译约束节内（而非派发 / 回执说明段）');
});

/* ---------- L1-3 既有约束与对应清单不回归 ---------- */

t('L1-3 既有翻译约束与基准 → 目标对应清单不回归', () => {
  const tp = translatePrompt();
  assert.ok(tp.includes('README_en.md → CHANGELOG_en.md / FEATURES_en.md'), 'README 同语言互链约束保留（链接必须真实可达口径不动）');
  for (const pair of ['README.md → README_en.md', 'AGENTS.md → AGENTS_en.md']) {
    assert.ok(tp.includes(pair), `基准 → 目标对应清单保留 ${pair}`);
  }
  assert.ok(tp.includes('不增删信息') && tp.includes('不得编造'), '唯一基准 / 不增删 / 不得编造约束保留');
});

/* ---------- L1-4 多语言与自定义文档形态下约束仍成立 ---------- */

t('L1-4 多语言（cn,en,fr）与自定义文档下约束仍输出且示例随首个剩余语言', () => {
  const tpMulti = translatePrompt({ langs: ['cn', 'en', 'fr'] });
  assert.ok(tpMulti.includes('[AGENTS.md](./AGENTS_en.md)'), '示例用首个剩余语言 en');
  const tpCustom = translatePrompt({ customDocs: ['MIGRATION'] });
  assert.ok(tpCustom.includes('不得把带语言后缀的文件名写进链接文本'), '自定义文档形态下约束仍在');
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
