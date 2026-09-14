#!/usr/bin/env node
// BUG-20260910-011 —— 涉及 UI 的 Bug 完善后仍无 ui-demo.html 却被记「已完善」。
// 覆盖四条修复线：done 回执完整性门槛（UI 演示三查）/ 领取探测纳入标题 + 词表「边框」/
// 存量冻结提示词展示层归一（Bug 演示口径）/ CLI 领取输出携带现行口径（长跑批次感知）。
// 用法：node scripts/tests/refine-ui-gate-20260910-011.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as refine from '../lib/refine-store.mjs';
import * as refineStates from '../lib/refine-states.mjs';
import * as taskSettings from '../lib/task-settings.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ATB = path.join(pluginRoot, 'scripts', 'atb.mjs');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function mkProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-ui-gate-011-')));
  core.initData(root);
  const dataDir = core.dataDirFrom(root);
  return { root, dataDir };
}

function accept(dataDir, id) {
  core.setStatus(dataDir, id, 'accepted', { by: 'human' });
}

// BUG 四节齐备 + 界面展示节（内容可定制）；titleWithKeyword 控制标题是否含 UI 关键词
// 注意：期望行为样板句不得含 UI 关键词（否则污染「非 UI Bug」夹具的探测文本）
function bugReadme({ title = 'b', phen, demoBody = null }) {
  const demo = demoBody === null ? '' : `\n## 界面展示\n\n${demoBody}\n`;
  return `# ${title}

## 现象
${phen}

## 复现步骤

1. 打开对应功能
2. 按步骤操作

## 期望行为
表现与期望一致，可按步骤验证。

## 验收说明

- 修复后可按上述步骤复现验证。${demo}`;
}

function atb(args, cwd) {
  const r = spawnSync(process.execPath, [ATB, ...args, '--dir', cwd], { encoding: 'utf8', timeout: 30_000 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

// ---------- G1/G2 done 完整性门槛（README 复现方式 B 端到端） ----------

t('G1 端到端（方式 B）：标题含 UI 关键词、正文占位的 Bug——只补四节与界面展示文字不建演示 → done 被拒；补齐演示与链接 → done 成功且 analyzeItemDocs complete', () => {
  const { root, dataDir } = mkProject();
  // 登记现象为界面问题的 Bug：标题含 UI 关键词（按钮），--desc 留空（现象/期望为占位）
  const bug = core.createItem(dataDir, { type: 'bug', title: '按钮置灰态缺失' });
  accept(dataDir, bug.id);
  const { batch } = refine.createRefineBatch(dataDir, { projectRoot: root });
  const got = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  assert.equal(got.itemId, bug.id);
  // 成因 3 修复：标题关键词参与探测 → 领取缺失原因出现 UI 演示提示
  assert.ok(got.reasons.includes('涉及 UI 需界面展示'), `领取原因应含 UI 提示（得到 ${got.reasons}）`);

  // 子代理只补四节 + 界面展示文字节（不建 ui-demo.html）→ done 被拒（成因 2 修复）
  fs.writeFileSync(path.join(got.itemDir, 'README.md'), bugReadme({
    title: '按钮置灰态缺失',
    phen: '点击保存按钮后按钮未进入置灰态，可被重复点击触发重复提交。',
    demoBody: '- 布局：保存按钮位于表单底部；提交中按钮置灰且不可重复点击。',
  }));
  assert.throws(
    () => refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '补四节与界面展示' }),
    /UI 演示三查.*涉及 UI 缺 ui-demo\.html 演示|涉及 UI 缺 ui-demo\.html 演示.*refine fail/,
    '缺演示文件的 done 应被完整性门槛拒绝',
  );
  assert.equal(refine.getRefineRun(dataDir, got.runId).phase, 'reserved', '拒绝后运行不得被记终态');
  assert.equal(refineStates.readRefineStates(dataDir)[bug.id].state, 'refining', '拒绝后完善状态不得提前置已完善');

  // 补四节 + 合格 ui-demo.html（README 界面展示节链接 ./ui-demo.html）→ done 成功、置已完善、判 complete
  fs.writeFileSync(path.join(got.itemDir, 'ui-demo.html'), '<!doctype html>\n<html><body><button>保存</button></body></html>\n');
  fs.writeFileSync(path.join(got.itemDir, 'README.md'), bugReadme({
    title: '按钮置灰态缺失',
    phen: '点击保存按钮后按钮未进入置灰态，可被重复点击触发重复提交。',
    demoBody: '- [交互演示（ui-demo.html）](./ui-demo.html)\n- 对照：开关切换「缺陷现象 / 期望修复后状态」——缺陷态按钮可重复点击；修复态提交中置灰不可重复触发。',
  }));
  const fin = refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '补四节 + ui-demo.html 演示' });
  assert.equal(fin.receipt.result, 'done');
  assert.equal(refineStates.readRefineStates(dataDir)[bug.id].state, 'refined', '补齐后回执置已完善');
  const a = refine.analyzeItemDocs(got.itemDir, 'bug');
  assert.equal(a.complete, true, `补齐后 analyzeItemDocs 应 complete（得到 ${a.reasons}）`);
});

t('G2 只补四节、无界面展示节 → done 被拒并提示「涉及 UI 需界面展示」', () => {
  const { root, dataDir } = mkProject();
  const bug = core.createItem(dataDir, { type: 'bug', title: '弹窗遮挡输入框' });
  accept(dataDir, bug.id);
  const { batch } = refine.createRefineBatch(dataDir, { projectRoot: root });
  const got = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  fs.writeFileSync(path.join(got.itemDir, 'README.md'), bugReadme({
    title: '弹窗遮挡输入框',
    phen: '错误弹窗弹出后遮挡了下方输入框，无法继续填写。',
  }));
  assert.throws(
    () => refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '补四节' }),
    /涉及 UI 需界面展示/,
    '无界面展示节的 UI Bug done 应被拒',
  );
});

// ---------- G3 需求侧门槛（演示三查口径不变，门槛补上） ----------

t('G3 需求侧：描述含 UI 关键词、补节但缺演示文件 → done 被拒；补齐演示与链接 → 通过', () => {
  const { root, dataDir } = mkProject();
  const req = core.createItem(dataDir, { type: 'requirement', title: '筛选面板' });
  accept(dataDir, req.id);
  const { batch } = refine.createRefineBatch(dataDir, { projectRoot: root });
  const got = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  const readmeNoDemo = `# x

## 描述
新增筛选面板与刷新按钮，点击后列表切换加载与结果状态，说明长度超过三十个字符。

## 验收标准

- [x] 可筛选

## 界面展示

- 布局：顶栏刷新按钮 + 候选清单。
`;
  fs.writeFileSync(path.join(got.itemDir, 'README.md'), readmeNoDemo);
  assert.throws(
    () => refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '补需求文档' }),
    /涉及 UI 缺 ui-demo\.html 演示/,
    '需求侧缺演示文件同样应被门槛拦截',
  );
  fs.writeFileSync(path.join(got.itemDir, 'ui-demo.html'), '<!doctype html>\n<html><body><button>筛选</button></body></html>\n');
  fs.writeFileSync(path.join(got.itemDir, 'README.md'), readmeNoDemo.replace('- 布局：顶栏刷新按钮 + 候选清单。',
    '- [交互演示（ui-demo.html）](./ui-demo.html)\n- 布局：顶栏刷新按钮 + 候选清单；点击切换正常/空/加载/失败状态。'));
  const fin = refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '补需求文档与演示' });
  assert.equal(fin.receipt.result, 'done');
});

// ---------- G4 零回归 ----------

t('G4 零回归：非 UI Bug 四节齐备可正常 done；现象误命中但界面展示节声明「不涉及界面改动」可正常 done', () => {
  const { root, dataDir } = mkProject();
  const plain = core.createItem(dataDir, { type: 'bug', title: '导出内容为空' });
  const uiButDeclared = core.createItem(dataDir, { type: 'bug', title: '点击导出按钮导出为空' });
  for (const x of [plain, uiButDeclared]) accept(dataDir, x.id);
  const { batch } = refine.createRefineBatch(dataDir, { projectRoot: root });
  // 非 UI Bug：无界面展示节、无演示 → done 正常（BUG-20260910-008 形态）
  const g1 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  assert.equal(g1.itemId, plain.id);
  fs.writeFileSync(path.join(g1.itemDir, 'README.md'), bugReadme({
    title: '导出内容为空',
    phen: '导出的账本文件内容为空，日志无报错。',
  }));
  const f1 = refine.finishRefineRun(dataDir, g1.runId, { result: 'done', summary: '补四节' });
  assert.equal(f1.receipt.result, 'done', '非 UI Bug 不受门槛影响');
  // 界面展示节声明「不涉及界面改动」→ 不做演示三查，done 正常（沿用 015 兜底）
  const g2 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w2' });
  assert.equal(g2.itemId, uiButDeclared.id);
  fs.writeFileSync(path.join(g2.itemDir, 'README.md'), bugReadme({
    title: '点击导出按钮导出为空',
    phen: '点击导出按钮后导出的文件内容为空，界面其余部分表现正常。',
    demoBody: '本缺陷不涉及界面改动，无需界面示意。',
  }));
  const f2 = refine.finishRefineRun(dataDir, g2.runId, { result: 'done', summary: '补四节与不涉及界面声明' });
  assert.equal(f2.receipt.result, 'done', '「不涉及界面改动」声明条目不受门槛影响');
});

// ---------- G5/G6 探测补漏：标题参与（Bug 侧）+ 词表「边框」 ----------

t('G5 标题探测：Bug 标题含 UI 关键词、现象/期望为占位 → 报「涉及 UI 需界面展示」；需求标题含关键词但描述不含 → 不报（需求侧探测不变）', () => {
  const { dataDir } = mkProject();
  // Bug：登记未带 --desc，现象/期望均为「（待补充）」占位，只有标题携带关键词
  const bug = core.createItem(dataDir, { type: 'bug', title: '列表顶栏在窄屏下消失' });
  const bdir = core.resolveItemDir(dataDir, bug.id).dir;
  const b = refine.analyzeItemDocs(bdir, 'bug');
  assert.ok(b.reasons.includes('涉及 UI 需界面展示'), `Bug 标题关键词应触发（得到 ${b.reasons}）`);
  // 词表外新增词「边框」：Bug 现象含「边框」→ 触发
  fs.writeFileSync(path.join(bdir, 'README.md'), bugReadme({ title: 'b', phen: '待测试列表出现了异常的紫蓝色边框，其余表现正常。' }));
  const b2 = refine.analyzeItemDocs(bdir, 'bug');
  assert.ok(b2.reasons.includes('涉及 UI 需界面展示'), `「边框」应触发（得到 ${b2.reasons}）`);

  // 需求侧探测文本不变：标题含「界面」，描述正文不含关键词 → 不报界面展示原因
  const req = core.createItem(dataDir, { type: 'requirement', title: '界面文案优化' });
  const rdir = core.resolveItemDir(dataDir, req.id).dir;
  fs.writeFileSync(path.join(rdir, 'README.md'), `# x

## 描述
调整账本冻结口径与出局落账顺序，全部改动位于数据层完成，说明长度超过三十个字符。

## 验收标准

- [x] 判定只看 README
`);
  const r = refine.analyzeItemDocs(rdir, 'requirement');
  assert.ok(!r.reasons.some((x) => x.includes('界面展示')), `需求侧探测不纳入标题（得到 ${r.reasons}）`);
  assert.equal(r.complete, true, `需求完整判定不受影响（得到 ${r.reasons}）`);
});

// ---------- G7 存量冻结提示词展示层归一（长跑批次口径同步） ----------

// RFB-20260909-022 时代冻结的 Bug 分支与约束行（与账本原文一致的整行形态）
const LEGACY_BUG_LINE = '   design/test-cases 留待开发阶段；Bug 补现象/复现步骤/期望行为/验收说明。';
const LEGACY_CONSTRAINT_LINE = '不要调用 claim/report、不要写 test-report.md、不要 git commit；只编辑条目目录下 markdown（涉及 UI 的需求可另建约定的 ui-demo.html）。';

t('G7 归一规则：022 时代冻结提示词的 Bug 演示口径在展示层归一为现行口径；现行提示词幂等；真实账本原文归一后不被回写', () => {
  const current = refine.buildRefinePrompt({ projectRoot: '/tmp/p', batchId: 'RFB-20260909-022' });
  assert.equal(taskSettings.normalizePromptForDisplay(current), current, '现行生成提示词归一应幂等');

  // 构造 RFB-20260909-022 时代冻结形态：现行 Bug 分支四行 → 旧单行；约束行演示许可去掉 Bug
  const lines = current.split('\n');
  const i = lines.findIndex((l) => l.includes('Bug 补现象/复现步骤/期望行为/验收说明——涉及 UI 的 Bug'));
  assert.ok(i >= 0 && lines[i + 3].includes('演示建议对照展示缺陷现象与期望修复后状态'), '现行 Bug 分支四行形态定位');
  const frozen = [
    ...lines.slice(0, i), LEGACY_BUG_LINE, ...lines.slice(i + 4),
  ].join('\n').replace('（涉及 UI 的需求或 Bug 可另建约定的 ui-demo.html）。', '（涉及 UI 的需求可另建约定的 ui-demo.html）。');
  assert.ok(frozen.includes(LEGACY_BUG_LINE) && frozen.includes(LEGACY_CONSTRAINT_LINE), '夹具应含两种旧口径整行');

  const norm = taskSettings.normalizePromptForDisplay(frozen);
  assert.ok(norm.includes('涉及 UI 的 Bug'), '归一后 Bug 分支应含「涉及 UI 的 Bug」口径');
  assert.ok(norm.includes('同样须提供界面展示'), '归一后应含 Bug 侧界面展示要求');
  assert.ok(norm.includes('（涉及 UI 的需求或 Bug 可另建约定的 ui-demo.html）。'), '归一后约束行演示许可应覆盖 Bug');
  assert.ok(!norm.includes(LEGACY_CONSTRAINT_LINE), '旧约束行不得残留');
  assert.ok(!norm.split('\n').includes(LEGACY_BUG_LINE), '旧 Bug 分支行不得残留');
  assert.equal(taskSettings.normalizePromptForDisplay(norm), norm, '归一幂等');

  // 真实存量账本（若存在）：冻结原文可被归一，且归一为纯展示操作——账本文件内容不变
  const ledger = path.join(pluginRoot, 'docs', 'agent-team-board', 'refine', 'batches', 'RFB-20260909-022', 'batch.json');
  if (fs.existsSync(ledger)) {
    const before = fs.readFileSync(ledger, 'utf8');
    const raw = JSON.parse(before);
    const shown = taskSettings.normalizePromptForDisplay(raw.prompt);
    assert.ok(shown.includes('涉及 UI 的 Bug'), '真实 022 账本提示词归一后应含 Bug 演示口径');
    assert.ok(!shown.split('\n').includes(LEGACY_BUG_LINE), '真实账本旧分支行应被归一');
    assert.equal(fs.readFileSync(ledger, 'utf8'), before, '账本文件不得被回写');
  }
});

// ---------- G8 CLI 领取输出携带现行口径（执行 Agent 感知，独立于冻结提示词） ----------

t('G8 CLI refine next 输出「下一步」行含 Bug 侧 UI 演示现行口径（长跑批次感知机制）', () => {
  const { root, dataDir } = mkProject();
  const bug = core.createItem(dataDir, { type: 'bug', title: '按钮置灰态缺失' });
  core.setStatus(dataDir, bug.id, 'accepted', { by: 'human' });
  assert.equal(atb(['refine', 'create'], root).code, 0, 'create 应成功');
  const r = atb(['refine', 'next', '--by', 'refine-001-1'], root);
  assert.equal(r.code, 0, `next 应成功（${r.err}）`);
  assert.match(r.out, /涉及 UI 的 Bug 同样须界面展示/, '领取输出应携带 Bug 侧界面展示要求');
  assert.match(r.out, /ui-demo\.html/, '领取输出应指明演示文件');
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
