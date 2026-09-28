#!/usr/bin/env node
// BUG-20260928-009 发布文档语言变体缺少中英文切换行，旧 README.en.md 残留未清理 —— TDD 分层测试。
// 引入来源：REQ-20260921-012（两阶段流水线上线，总结提示词无「生成 / 保留语言切换行」要求，
// REQ-20260918-001 手工切换行随 f1d15c7 整体重写丢失；同轮 <KEY>_<lang>.md 取代旧双语机制，
// 点号命名 README.en.md 成为孤儿未清理）。
// 覆盖（按 BUG-20260922-003 口径：不测文档内容本身，测流水线行为——提示词生成）：
//   L1 纯逻辑（publish-flow）：
//      - docLangSwitchLine(key, langs)：语言集内全互链，首语言不带后缀、其余 <KEY>_<lang>，
//        语言显示名用 LANG_NAMES（中文 / English），多语言随语言集动态展开；
//      - AI 总结提示词写作约束含切换行规则（首行一级标题下 / 全互链示例 / 链接真实可达 /
//        自定义文档同口径、LICENSE 除外 / 重写保留跨轮稳定）；
//      - AI 翻译提示词翻译约束含切换行镜像规则（保留与基准完全一致的行、已按语言变体互链
//        不改写、不视为基准外新增信息），且与「链接文本保持基准原文」口径并存不回归；
//      - AI 校对提示词校对约束含切换行核查项（存在性 / 语言集全 / 链接目标正确、缺失必报）；
//      - 三处提示词的切换行示例随语言集动态生成（cn,en,ja 三语展开）。
//   L2 产物契约（仓库状态）：
//      - 旧点号命名 README.en.md 不再被 git 跟踪（git ls-files 不含）且磁盘不存在；
//      - 根第一层发布文档（标准 4 类 + _en 变体 + DESIGN / DESIGN_en）无指向 README.en.md 的链接。
// 用法：node scripts/tests/bug-20260928-009.test.mjs

import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as flow from '../lib/publish-flow.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function summaryPrompt({ langs = ['cn', 'en'], customDocs = [] } = {}) {
  return flow.buildDocSummaryPrompt({
    projectRoot: '/tmp/proj-x', planId: 'BLD-20260928-009',
    runId: 'sm-20260928-080808-9f09', langs, customDocs, atbPath: '/tmp/atb.mjs',
  });
}
function translatePrompt({ langs = ['cn', 'en'], customDocs = [] } = {}) {
  return flow.buildDocTranslatePrompt({
    projectRoot: '/tmp/proj-x', planId: 'BLD-20260928-009',
    runId: 'tr-20260928-080808-9f09', langs, customDocs, atbPath: '/tmp/atb.mjs',
  });
}
function proofreadPrompt({ langs = ['cn', 'en'], customDocs = [] } = {}) {
  return flow.buildDocProofreadPrompt({
    projectRoot: '/tmp/proj-x', planId: 'BLD-20260928-009',
    runId: 'ck-20260928-080808-9f09', langs, customDocs, atbPath: '/tmp/atb.mjs',
  });
}

/* ---------- L1 纯逻辑：docLangSwitchLine 切换行生成器 ---------- */

t('L1-1 docLangSwitchLine：cn,en 语言集 README 全互链——首语言不带后缀、其余 _lang，显示名用语言名', () => {
  assert.strictEqual(
    flow.docLangSwitchLine('README', ['cn', 'en']),
    '[中文](./README.md) | [English](./README_en.md)'
  );
});

t('L1-2 docLangSwitchLine：自定义文档 KEY 与多语言集动态展开（cn,en,ja；语言集首语言变序同理）', () => {
  assert.strictEqual(
    flow.docLangSwitchLine('MIGRATION', ['cn', 'en', 'ja']),
    '[中文](./MIGRATION.md) | [English](./MIGRATION_en.md) | [日本語](./MIGRATION_ja.md)'
  );
  assert.strictEqual(
    flow.docLangSwitchLine('README', ['en', 'cn']),
    '[English](./README.md) | [中文](./README_cn.md)'
  );
});

/* ---------- L1 纯逻辑：AI 总结提示词切换行规则 ---------- */

t('L1-3 总结提示词写作约束：首行一级标题下生成语言切换行，全互链示例随语言集生成、链接真实可达', () => {
  const sp = summaryPrompt();
  const idx = sp.indexOf('写作约束：');
  assert.ok(idx >= 0, '存在「写作约束：」节');
  const section = sp.slice(idx);
  assert.ok(section.includes('语言切换行'), '写作约束应含语言切换行规则');
  assert.ok(/一级标题下|首行.*标题下/.test(section), '应定位到首行一级标题之下');
  assert.ok(section.includes('[中文](./README.md) | [English](./README_en.md)'), '应给出随语言集生成的全互链示例行');
  assert.ok(section.includes('真实可达'), '切换行链接必须真实可达');
});

t('L1-4 总结提示词写作约束：各语言变体该行完全一致；重写 / 总结既有文档时保留（跨轮稳定）', () => {
  const section = summaryPrompt().slice(summaryPrompt().indexOf('写作约束：'));
  assert.ok(/完全一致|同一行/.test(section), '应点明各语言变体中该行完全一致');
  assert.ok(section.includes('保留该行') || /保留.*切换行/.test(section), '重写既有文档时保留该行（跨轮稳定）');
});

t('L1-5 总结提示词：自定义文档同口径（含自定义时点明；无自定义不出「自定义」字样）；LICENSE 不进总结提示词', () => {
  const withCustom = summaryPrompt({ customDocs: ['MIGRATION'] });
  const section = withCustom.slice(withCustom.indexOf('写作约束：'));
  assert.ok(/自定义文档同口径/.test(section), '含自定义文档时写作约束点明同口径');
  const bare = summaryPrompt();
  assert.ok(!bare.includes('自定义'), '无自定义时全文不出现「自定义」字样（REQ-20260922-003 字节稳定口径）');
  assert.ok(!bare.includes('LICENSE'), 'LICENSE 单文件类不进总结提示词（清单天然不含）');
});

/* ---------- L1 纯逻辑：AI 翻译提示词切换行镜像规则 ---------- */

t('L1-6 翻译提示词翻译约束：镜像基准切换行——同样位置保留与基准完全一致的行，已按语言变体互链不改写', () => {
  const tp = translatePrompt();
  const idx = tp.indexOf('翻译约束：');
  assert.ok(idx >= 0, '存在「翻译约束：」节');
  const section = tp.slice(idx);
  assert.ok(section.includes('语言切换行'), '翻译约束应含语言切换行规则');
  assert.ok(/完全一致/.test(section), '目标文档保留与基准完全一致的切换行');
  assert.ok(section.includes('[中文](./README.md) | [English](./README_en.md)'), '应给出切换行示例');
  assert.ok(/镜像/.test(section), '镜像基准行表述');
  assert.ok(/不改写链接文本|无需改写|不改写/.test(section), '该行不改写（链接已按语言变体互链）');
});

t('L1-7 翻译提示词翻译约束：切换行是「不增删信息」约束的显式例外（不视为基准外新增信息）', () => {
  const section = translatePrompt().slice(translatePrompt().indexOf('翻译约束：'));
  assert.ok(/不视为基准外新增信息|不属.*基准外新增|固定结构/.test(section), '切换行属固定结构、不视为基准外新增信息');
});

t('L1-8 翻译既有约束不回归：基准唯一 / README 同语言互链 / 链接文本保持基准原文', () => {
  const tp = translatePrompt();
  assert.ok(tp.includes('唯一翻译基准') || tp.includes('唯一基准'), '基准唯一约束保持');
  assert.ok(tp.includes('README_en.md → CHANGELOG_en.md / FEATURES_en.md'), 'README 同语言互链约束保持');
  assert.ok(tp.includes('[AGENTS.md](./AGENTS_en.md)'), '链接文本保持基准原文示例保持（BUG-20260923-004）');
});

/* ---------- L1 纯逻辑：AI 校对提示词切换行核查项 ---------- */

t('L1-9 校对提示词校对约束：切换行核查——存在性（首行一级标题下）+ 语言集全互链 + 链接目标为本 KEY 各语言变体', () => {
  const pp = proofreadPrompt();
  const idx = pp.indexOf('校对约束：');
  assert.ok(idx >= 0, '存在「校对约束：」节');
  const section = pp.slice(idx);
  assert.ok(section.includes('语言切换行核查') || section.includes('切换行核查'), '校对约束应含切换行核查项');
  assert.ok(/一级标题下|标题下/.test(section), '核查位置为首行一级标题下');
  assert.ok(section.includes('[中文](./README.md) | [English](./README_en.md)'), '应给出切换行基准形态示例');
  assert.ok(/语言变体/.test(section), '链接目标为本 KEY 各语言变体文件');
});

t('L1-10 校对提示词校对约束：切换行缺失 / 语言集不全 / 链接目标不正确必须显式报问题', () => {
  const section = proofreadPrompt().slice(proofreadPrompt().indexOf('校对约束：'));
  assert.ok(/缺失/.test(section), '缺失切换行必须报');
  assert.ok(/语言集不全|语言集.*全/.test(section), '语言集不全必须报');
  assert.ok(/显式提示|报问题|以问题形式/.test(section), '按回执格式显式提示');
});

t('L1-11 校对既有约束不回归：只读不改 / 链接核查 / 图片语种核查保持', () => {
  const pp = proofreadPrompt();
  assert.ok(pp.includes('只读核查'), '只读不改口径保持');
  assert.ok(pp.includes('链接核查'), '链接核查项保持（REQ-20260924-006）');
  assert.ok(pp.includes('图片语种核查'), '图片语种核查项保持（BUG-20260928-003）');
});

/* ---------- L1 纯逻辑：示例行随语言集动态展开（扩展位） ---------- */

t('L1-12 三处提示词切换行示例随语言集动态展开（cn,en,ja 三语全互链示例）', () => {
  const langs = ['cn', 'en', 'ja'];
  const line = flow.docLangSwitchLine('README', langs);
  for (const p of [summaryPrompt({ langs }), translatePrompt({ langs }), proofreadPrompt({ langs })]) {
    assert.ok(p.includes(line), `提示词应含三语切换行示例：${line}`);
  }
});

/* ---------- L2 产物契约：旧 README.en.md 清理 ---------- */

t('L2-1 旧点号命名 README.en.md 不再被 git 跟踪（git ls-files 不含）且磁盘不存在', () => {
  const tracked = execSync('git ls-files README.en.md', { cwd: repoRoot, encoding: 'utf8' }).trim();
  assert.strictEqual(tracked, '', `README.en.md 应已出 git 索引，实际：${tracked}`);
  assert.ok(!fs.existsSync(path.join(repoRoot, 'README.en.md')), 'README.en.md 应已从磁盘删除');
});

t('L2-2 根第一层发布文档无指向 README.en.md 的悬空链接', () => {
  const docs = [
    'README.md', 'CHANGELOG.md', 'FEATURES.md', 'AGENTS.md', 'DESIGN.md',
    'README_en.md', 'CHANGELOG_en.md', 'FEATURES_en.md', 'AGENTS_en.md', 'DESIGN_en.md',
  ];
  for (const doc of docs) {
    const file = path.join(repoRoot, doc);
    if (!fs.existsSync(file)) continue;
    const md = fs.readFileSync(file, 'utf8');
    assert.ok(!md.includes('README.en.md'), `${doc} 不应再引用 README.en.md`);
  }
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
