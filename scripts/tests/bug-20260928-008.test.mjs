#!/usr/bin/env node
// BUG-20260928-008 AI 翻译图片语种对齐「不存在则保持基准原引用」措辞歧义 —— TDD 分层测试。
// 引入来源：BUG-20260928-003（翻译约束「不存在则保持基准原引用」被直白读作保持默认语言引用，
// tr-20260928-134647-4398 轮实际触发：README_en.md 保持 image/README/1790092127929.png）。
// 覆盖：
//   L1 纯逻辑（publish-flow.buildDocTranslatePrompt 翻译约束）：
//      - 本地图片引用一律改写为 <name>_<lang>.<原扩展名>（仅文件名加语种后缀、不改扩展名、
//        不换基名、不得指向不同基名的其他文件）；
//      - 图片文件是否存在不影响引用改写（不阻塞、不强求，由用户自行检查补图）；不得虚构图片文件；
//      - 不再含「不存在则保持基准原引用 / 保持基准原引用」歧义句式；
//      - 既有翻译约束不回归（基准唯一 / 链接文本保持基准原文）。
//   L2 产物契约（仓库 README_en.md）：本地图片引用一律为 _en 语种变体路径，不再指向默认语言图。
// 用法：node scripts/tests/bug-20260928-008.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as flow from '../lib/publish-flow.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function translatePrompt({ langs = ['cn', 'en'], customDocs = [] } = {}) {
  return flow.buildDocTranslatePrompt({
    projectRoot: '/tmp/proj-x', planId: 'BLD-20260928-008',
    runId: 'tr-20260928-070707-cd08', langs, customDocs, atbPath: '/tmp/atb.mjs',
  });
}

function constraintSection(tp) {
  const idx = tp.indexOf('翻译约束：');
  assert.ok(idx >= 0, '存在「翻译约束：」节');
  return tp.slice(idx);
}

/* ---------- L1 纯逻辑：翻译约束图片语种对齐新口径 ---------- */

t('L1-1 翻译约束：本地图片引用一律改写为 <name>_<lang> 语种变体（仅文件名加语种后缀，不改扩展名、不换基名）', () => {
  const section = constraintSection(translatePrompt());
  assert.ok(section.includes('图片'), '翻译约束节应覆盖图片引用');
  assert.ok(/一律改写|一律.*改写为/.test(section), '应明确「一律改写为」语种变体引用（不再以文件存在为前提）');
  assert.ok(/image\/foo_<目标语言>\.png|_<目标语言>/.test(section), '应给出 <name>_<目标语言>.png 改写示例');
  assert.ok(section.includes('仅文件名加语种后缀'), '应点明「仅文件名加语种后缀」');
  assert.ok(section.includes('不改扩展名') && section.includes('不换基名'), '不改扩展名、不换基名');
  assert.ok(section.includes('不同基名'), '不得指向不同基名的其他文件');
});

t('L1-2 翻译约束：图片文件是否存在不影响引用改写；不阻塞、不强求、用户自行检查补图；不虚构图片文件', () => {
  const section = constraintSection(translatePrompt());
  assert.ok(/是否存在不影响引用改写|存在与否不影响引用改写/.test(section), '图片文件存在与否不影响引用改写');
  assert.ok(section.includes('不阻塞') || section.includes('不强求'), '不阻塞、不强求口径');
  assert.ok(section.includes('自行检查') || section.includes('补图'), '界面显示不出图片由用户自行检查补图');
  assert.ok(section.includes('不') && section.includes('虚构'), '不得虚构图片文件');
});

t('L1-3 翻译约束：不再含「不存在则保持基准原引用 / 保持基准原引用」歧义句式', () => {
  const tp = translatePrompt();
  assert.ok(!tp.includes('保持基准原引用'), '不得再出现「保持基准原引用」歧义句式');
  assert.ok(!/不存在则保持/.test(tp), '不得再出现「不存在则保持…」歧义句式');
});

t('L1-4 翻译既有约束不回归：基准唯一 / 链接互链 / 链接文本保持基准原文', () => {
  const tp = translatePrompt();
  assert.ok(tp.includes('唯一翻译基准') || tp.includes('唯一基准'), '基准唯一约束保持');
  assert.ok(tp.includes('README_en.md → CHANGELOG_en.md / FEATURES_en.md'), 'README 同语言互链约束保持');
  assert.ok(tp.includes('[AGENTS.md](./AGENTS_en.md)'), '链接文本保持基准原文示例保持（BUG-20260923-004）');
});

/* ---------- L2 产物契约：README_en.md 图片引用语种变体 ---------- */

t('L2-1 README_en.md 本地图片引用一律为 _en 语种变体路径，不再指向默认语言图（1790092127929 → _en）', () => {
  const file = path.join(repoRoot, 'README_en.md');
  assert.ok(fs.existsSync(file), 'README_en.md 存在');
  const md = fs.readFileSync(file, 'utf8');
  const refs = [...md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1])
    .filter((p) => !/^(https?:|\/|#|data:)/.test(p));
  assert.ok(refs.length > 0, 'README_en.md 应至少含一条本地图片引用（当前轮界面截图）');
  for (const ref of refs) {
    assert.ok(/_en\.[A-Za-z0-9]+$/.test(ref), `本地图片引用应为 _en 语种变体路径：${ref}`);
  }
  assert.ok(md.includes('image/README/1790092127929_en.png'), '本轮界面截图引用应已改写为 image/README/1790092127929_en.png');
});

/* ---------- 执行 ---------- */

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`✗ ${name}`);
    console.error(`  ${err.message.split('\n').join('\n  ')}`);
  }
}
if (failed) {
  console.error(`\n${failed} case(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} cases passed`);
