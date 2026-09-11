#!/usr/bin/env node
// BUG-20260911-002 发布模块副标题以「Git 远端与 App Store」限定模块范围，与已含桌面应用
// （Electron，REQ-20260910-030）的目标列表不一致——静态契约测试（沿用本项目源文本断言模式）。
// 引入来源：REQ-20260910-029（发布模块需求的副标题口径；仓库仅一次初始化提交无法定位具体提交，
//   以 app.js 行内注释 // REQ-20260910-029 与条目 design.md「模块副标题」改动面核验）。
// 覆盖用例 C1–C5：
//   C1 副标题通用化口径保持：release 键随 REQ-20260911-002 入口暂隐藏移出 MODULE_SUB，
//      通用文案「构建与发布流程：预检 → 计划确认 → 执行 → 核验」在恢复步骤中原样保留（含本单溯源）
//   C2 旧受限文案全网页源码清零：scripts/web/*.js / index.html 不再出现
//      「Git 远端与 App Store 发布流水线」（枚举渠道的模块概述不复存在）
//   C3 其他模块副标题不回退：status/runs 文案保留、settings 保持空串占位；
//      oncall / files（REQ-20260909-013）与 marketing / release（REQ-20260911-002）随入口暂隐藏移出
//   C4 目标能力不受文案变更影响：release.js 目标列表仍含 git / apple / electron 三项与「桌面应用（Electron）」入口
//   C5 ui-demo 离线自包含守护：条目目录演示含修复后文案，无外网资源引用
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const appSrc = fs.readFileSync(path.join(root, 'scripts', 'web', 'app.js'), 'utf8');
const relSrc = fs.readFileSync(path.join(root, 'scripts', 'web', 'release.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(root, 'scripts', 'web', 'index.html'), 'utf8');
const itemDir = path.join(root, 'docs', 'agent-team-board', 'bugs', 'BUG-20260911-002');
const demoSrc = fs.readFileSync(path.join(itemDir, 'ui-demo.html'), 'utf8');
// REQ-20260911-002：发布模块入口暂态隐藏，副标题恢复口径落在该条目 design.md 恢复步骤
const hideDesignSrc = fs.readFileSync(path.join(root, 'docs', 'agent-team-board', 'requirements', 'REQ-20260911-002', 'design.md'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const NEW_SUB = '构建与发布流程：预检 → 计划确认 → 执行 → 核验';

// C1 副标题通用化：目标无关、不枚举渠道——键随 REQ-20260911-002 暂隐藏移出后，
// 通用文案由 REQ-20260911-002 design.md「恢复步骤」原样承载（恢复时不回退渠道枚举口径）
t('C1 MODULE_SUB.release 键随 REQ-20260911-002 暂隐藏移出；通用文案「' + NEW_SUB + '」在恢复步骤原样保留且不枚举渠道', () => {
  const m = appSrc.match(/const MODULE_SUB = \{[\s\S]*?\};/);
  assert.ok(m, '应存在 MODULE_SUB');
  assert.doesNotMatch(m[0], /release:\s*'/, 'release 副标题键随 REQ-20260911-002 入口暂隐藏移出（恢复按条目 design.md）');
  assert.match(hideDesignSrc, new RegExp(`release:\\s*'${NEW_SUB}'`), '恢复步骤应原样保留通用文案');
  const relLine = hideDesignSrc.split('\n').find((l) => l.includes(`release: '${NEW_SUB}'`));
  assert.match(relLine, /BUG-20260911-002/, '恢复文案行保留 BUG-20260911-002 溯源');
  assert.doesNotMatch(relLine, /Git 远端与 App Store/, '恢复文案不得回退渠道枚举口径');
});

// C2 旧受限文案清零：模块概述不再以两个具体目标定义模块范围
t('C2 网页源码（app.js / release.js / index.html）不再出现旧文案「Git 远端与 App Store 发布流水线」', () => {
  for (const [name, src] of [['app.js', appSrc], ['release.js', relSrc], ['index.html', htmlSrc]]) {
    assert.ok(!src.includes('Git 远端与 App Store 发布流水线'), `${name} 不应再含旧副标题文案`);
  }
});

// C3 其他模块副标题不回退（BUG-20260909-002 settings 空串 / BUG-20260909-013 讨论精简口径等既有成果保持；
// REQ-20260909-013：oncall / files 副标题随讨论与文件入口暂态隐藏移出；
// REQ-20260911-002：marketing / release 副标题随营销与发布入口暂态隐藏移出，恢复时按各条目 design.md 加回）
t('C3 其他模块副标题保持原有含义：status/runs 文案不变，settings 仍为空串占位；oncall / files / marketing / release 随入口暂隐藏移出', () => {
  const m = appSrc.match(/const MODULE_SUB = \{[\s\S]*?\};/);
  assert.ok(m, '应存在 MODULE_SUB');
  const seg = m[0];
  assert.match(seg, /status:\s*'从想法到验收，跟进每一项工作'/, 'status 副标题保留');
  assert.doesNotMatch(seg, /oncall:\s*'开放式讨论，看板沉淀成果'/, 'oncall 副标题随 REQ-20260909-013 暂隐藏移出');
  assert.match(seg, /runs:\s*'进度、队列与结果集中在这里'/, 'runs 副标题保留');
  assert.doesNotMatch(seg, /files:\s*'项目资料与源码，专注阅读'/, 'files 副标题随 REQ-20260909-013 暂隐藏移出');
  assert.doesNotMatch(seg, /marketing:\s*'项目营销档案：定位、证据与定价版本'/, 'marketing 副标题随 REQ-20260911-002 暂隐藏移出');
  assert.doesNotMatch(seg, /release:\s*'/, 'release 副标题随 REQ-20260911-002 暂隐藏移出');
  assert.match(seg, /settings:\s*''/, 'settings 副标题保持空串（键保留）');
});

// C4 文案变更不触碰目标能力：release.js 目标列表仍含三项目标与桌面应用入口
t('C4 release.js 目标列表保留 git / apple / electron 三项，「桌面应用（Electron）」入口不变', () => {
  assert.match(relSrc, /\{ key: 'git', label: 'Git 远端', enabled: true \}/, 'git 目标保留');
  assert.match(relSrc, /\{ key: 'apple', label: 'Apple App Store', enabled: true \}/, 'apple 目标保留');
  assert.match(relSrc, /\{ key: 'electron', label: '桌面应用（Electron）', enabled: true \}/, 'electron 桌面应用目标保留');
});

// C5 条目目录 ui-demo 离线自包含且展示修复后文案（验收：演示可直接打开、对照缺陷/修复）
t('C5 ui-demo.html 离线自包含（无外网资源引用）且包含修复后通用文案', () => {
  const external = demoSrc.match(/(?:src|href)\s*=\s*["']https?:\/\//gi) || [];
  assert.equal(external.length, 0, `演示不应有外部资源引用：${external.join(', ')}`);
  assert.ok(demoSrc.includes(NEW_SUB), '演示应包含修复后副标题文案');
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
