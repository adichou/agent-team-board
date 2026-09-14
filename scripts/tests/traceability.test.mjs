#!/usr/bin/env node
// REQ-20260830-004 引入来源规范静态契约测试
// 用法：node scripts/tests/traceability.test.mjs
// 覆盖 test-cases.md 的 R1–R6；R7 为回归（另跑三组既有测试）。
// REQ-20260908-012：归因在 Bug README 开头头部 `- 引入来源：` 行速览（R2/R4 增补、R5b 正例守护）。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...seg) => fs.readFileSync(path.join(pluginRoot, ...seg), 'utf8');

const bugCmd = read('commands', 'bug.md');
const devCmd = read('commands', 'dev.md');
const skill = read('skills', 'agent-team-board', 'SKILL.md');
const reqCmd = read('commands', 'req.md');
const boardCmd = read('commands', 'board.md');

// 样例：BUG-20260830-001 的 README（独立 bug 目录）
const dataRoot = path.join(pluginRoot, 'docs', 'agent-team-board');
const bugDirs = [
  path.join(dataRoot, 'bugs'),
  ...fs.readdirSync(path.join(dataRoot, 'requirements'))
    .map((r) => path.join(dataRoot, 'requirements', r, 'bugs')),
];
let exemplar = null;
for (const d of bugDirs) {
  const f = path.join(d, 'BUG-20260830-001', 'README.md');
  if (fs.existsSync(f)) { exemplar = fs.readFileSync(f, 'utf8'); break; }
}
// 正例（REQ-20260908-012）：BUG-20260907-017 README 头部元信息区含引入来源行
let headOriginExemplar = null;
for (const d of bugDirs) {
  const f = path.join(d, 'BUG-20260907-017', 'README.md');
  if (fs.existsSync(f)) { headOriginExemplar = fs.readFileSync(f, 'utf8'); break; }
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('R1 /bug 登记阶段不要求引入来源（归因留待修复阶段）', () => {
  assert.match(bugCmd, /不在登记阶段|登记.*不.*填写|修复阶段/, '须说明引入来源不在登记时填写');
  assert.doesNotMatch(bugCmd, /引入来源（必填/, '登记阶段不得要求必填引入来源');
  assert.doesNotMatch(bugCmd, /三选一/, '登记阶段不得要求三选一');
});

t('R2 /dev 修复 Bug 归因必填：三选一 + atb 核验 + 写入 design「引入来源（源单）」节 + README 开头头部行', () => {
  assert.match(devCmd, /引入来源/, '修复 Bug 需引入来源归因');
  assert.match(devCmd, /atb(\.mjs)? (list|show)/, '须用 atb list/show 核验来源 ID 存在');
  assert.match(devCmd, /YYYYMMDD-NNN|REQ-\/BUG-编号/, '须给出 ID 格式');
  // REQ-20260908-009：归因详述落点为 design.md「引入来源（源单）」节
  assert.match(devCmd, /引入来源（源单）/, '须写入 design.md「引入来源（源单）」节');
  // REQ-20260908-012：README 开头头部 `- 引入来源：` 行速览（第一屏可见）
  assert.match(devCmd, /README 开头头部/, '须要求在 Bug README 开头头部补写 `- 引入来源：` 行');
  assert.doesNotMatch(devCmd, /末尾[^。\n]*关联（引入来源）|关联（引入来源）[^。\n]*末尾/,
    '不得再要求写入 README 末尾「关联（引入来源）」节');
  assert.match(devCmd, /未定位/, '须有「未定位」规则');
  assert.match(devCmd, /排查过程/, '未定位须附排查过程');
  assert.match(devCmd, /编造|猜测/, '须明确禁止猜测编造');
});

t('R3 /dev 修复 Bug 时根因分析与 test-report 写明来源', () => {
  assert.match(devCmd, /引入来源/, '需含引入来源要求');
  assert.match(devCmd, /test-report/, 'test-report 须包含来源');
  assert.match(devCmd, /根因|design\.md/, '根因分析（design.md 或 README）须包含来源');
  assert.match(devCmd, /未定位/, '未定位情形须有规则');
});

t('R4 SKILL.md 数据规范与 TDD 流程含归因标准（修复阶段）', () => {
  // REQ-20260908-009：归因详述落点为 design.md「引入来源（源单）」节
  assert.match(skill, /引入来源（源单）/, '数据规范需说明 Bug design.md「引入来源（源单）」节');
  // REQ-20260908-012：README 开头头部 `- 引入来源：` 行速览口径 + 防旧口径回潮
  assert.match(skill, /README 开头头部/, '数据规范须要求来源行写入 Bug README 开头头部');
  assert.doesNotMatch(skill, /末尾[^。\n]*关联（引入来源）|关联（引入来源）[^。\n]*末尾/,
    '不得再表述为写入 README 末尾「关联（引入来源）」节');
  assert.match(skill, /修复阶段|修复时/, '归因须发生在修复阶段');
  assert.match(skill, /登记.*不|不在登记|登记时可暂空/, '须写明登记阶段不要求引入来源');
  assert.match(skill, /未定位/);
  assert.match(skill, /排查过程|编造/, 'SKILL 同样要求排查说明或禁止编造');
});

t('R5 样例 BUG-20260830-001 README 含来源链', () => {
  assert.ok(exemplar, '找不到 BUG-20260830-001 的 README');
  assert.match(exemplar, /## 关联/, '样例需有「关联」节');
  assert.match(exemplar, /REQ-20260830-002/, '样例来源链需指向 REQ-20260830-002');
});

t('R5b 正例 BUG-20260907-017 README 开头头部含引入来源行（REQ-20260908-012）', () => {
  assert.ok(headOriginExemplar, '找不到 BUG-20260907-017 的 README');
  assert.match(headOriginExemplar, /^- 引入来源：REQ-20260907-003/m, '头部须含来源行');
  const lines = headOriginExemplar.split('\n');
  const originIdx = lines.findIndex((l) => l.startsWith('- 引入来源：'));
  const reqIdx = lines.findIndex((l) => l.startsWith('- 归属需求：'));
  const createdIdx = lines.findIndex((l) => l.startsWith('- 创建：'));
  assert.ok(originIdx > 0, '来源行须位于头部元信息区');
  if (reqIdx >= 0) assert.ok(originIdx > reqIdx, '来源行须在「归属需求」行之后');
  assert.ok(createdIdx > originIdx, '来源行须在「创建」行之前');
});

t('R6 未泄漏到 /req、/board，且核心步骤保留', () => {
  assert.doesNotMatch(reqCmd, /引入来源/, '/req 不应包含引入来源要求');
  assert.doesNotMatch(boardCmd, /引入来源/, '/board 不应包含引入来源要求');
  assert.match(reqCmd, /标题/, '/req 核心步骤（提炼标题）保留');
  assert.match(boardCmd, /api\/health|8888/, '/board 核心步骤（探测服务）保留');
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
