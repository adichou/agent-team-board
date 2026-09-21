#!/usr/bin/env node
// REQ-20260921-006 契约测试 —— 四条 AI 流水线提示词重组提升提示词缓存命中率：
// 不变内容（角色/规则/流程/约束/回执语义/质量门槛）构成稳定静态前缀；随调用变化的值
// （项目根、atbPath、条目信息、runId、计划号/版本号、关联清单、开关态说明）收敛至尾部
// 统一「运行参数」区；条件行（模型跟随行 / autoPlan 分态 / runId 回执段）不再改变公共前缀。
// 覆盖（test-cases.md T1–T8）：开发主调度 / 分析主调度 / 分析单项 / AI 总结 / AI 完善（web vm）
// 的前缀一致性与动态值位置断言；展示层归一幂等与旧形态兼容；关键命令锚点不回退。
// 用法：node scripts/tests/req-20260921-006.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as batch from '../lib/batch.mjs';
import * as refine from '../lib/refine-store.mjs';
import * as taskSettings from '../lib/task-settings.mjs';
import * as flow from '../lib/publish-flow.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// ---------- 结构断言口径（test-cases.md 头部约定） ----------

const MARK = '运行参数（';
// 静态前缀 = 开头至「运行参数（」标记行之前；标记缺失视为不合规（直接抛错断言红）
function staticPrefix(text, label) {
  const i = String(text).indexOf(MARK);
  assert.ok(i > 0, `${label} 应含「${MARK}」运行参数区标记`);
  return String(text).slice(0, i);
}
function tail(text, label) {
  const i = String(text).indexOf(MARK);
  assert.ok(i > 0, `${label} 应含「${MARK}」运行参数区标记`);
  return String(text).slice(i);
}
// 动态值不得出现在静态前缀（前缀缓存命中会被其破坏）
function assertNotInPrefix(text, values, label) {
  const prefix = staticPrefix(text, label);
  for (const v of values) {
    assert.ok(!prefix.includes(v), `${label} 静态前缀不得包含动态值「${v}」`);
  }
}

// ---------- T1/T2/T8 AI 开发主调度（batch.generatePrompt） ----------

t('T1 开发主调度：不同 projectRoot / workerSpecPath 的输出静态前缀逐字一致；动态值只出现在运行参数区', () => {
  const a = batch.generatePrompt({ projectRoot: '/tmp/projA', batchId: 'batch-20990922-001', workerSpecPath: '/tmp/projA/spec/w.md', modelSource: 'follow' });
  const b = batch.generatePrompt({ projectRoot: '/tmp/projB/深路径', batchId: 'batch-20990922-002', workerSpecPath: '/tmp/projB/other-spec.md', modelSource: 'follow' });
  assert.equal(staticPrefix(a, '开发A'), staticPrefix(b, '开发B'), '不同项目/规范路径的静态前缀逐字一致');
  for (const [p, dyn] of [[a, ['/tmp/projA', '/tmp/projA/spec/w.md']], [b, ['/tmp/projB', '/tmp/projB/other-spec.md']]]) {
    assertNotInPrefix(p, dyn, '开发主调度');
    const tp = tail(p, '开发主调度');
    for (const v of dyn) assert.ok(tp.includes(v), `运行参数区应绑定动态值「${v}」`);
  }
});

t('T2 开发主调度：模型跟随行只在尾部——follow 与无模型入参共享同一静态前缀；无模型入参全文无跟随行', () => {
  const follow = batch.generatePrompt({ projectRoot: '/tmp/p', batchId: 'b-1', workerSpecPath: '/s.md', modelSource: 'follow' });
  const bare = batch.generatePrompt({ projectRoot: '/tmp/p', batchId: 'b-1', workerSpecPath: '/s.md' });
  assert.equal(staticPrefix(follow, 'follow'), staticPrefix(bare, 'bare'), '模型跟随行不得改变公共前缀');
  assert.ok(follow.includes(taskSettings.FOLLOW_SESSION_PROMPT_LINE), 'follow 注入跟随指令行（尾部）');
  assert.ok(tail(follow, 'follow').includes(taskSettings.FOLLOW_SESSION_PROMPT_LINE), '跟随指令行位于运行参数区');
  assert.ok(!bare.includes(taskSettings.FOLLOW_SESSION_PROMPT_LINE), '无模型入参不注入跟随行');
});

// ---------- T3/T8 AI 分析主调度（buildRefinePrompt） ----------

t('T3a 分析主调度：不同 projectRoot / atbPath 前缀一致；动态值仅在运行参数区', () => {
  const a = refine.buildRefinePrompt({ projectRoot: '/tmp/projA', batchId: 'RFB-20990922-001', modelSource: 'follow', atbPath: '/tmp/projA/scripts/atb.mjs' });
  const b = refine.buildRefinePrompt({ projectRoot: '/tmp/projB', batchId: 'RFB-20990922-002', modelSource: 'follow', atbPath: '/tmp/projB/other/atb.mjs' });
  assert.equal(staticPrefix(a, '分析A'), staticPrefix(b, '分析B'), '不同项目根/atbPath 的静态前缀逐字一致');
  for (const [p, dyn] of [[a, ['/tmp/projA']], [b, ['/tmp/projB']]]) {
    assertNotInPrefix(p, dyn, '分析主调度');
    assert.ok(tail(p, '分析主调度').includes(dyn[0]), '运行参数区应绑定项目根');
  }
});

t('T3b 分析主调度：autoPlan 开/关共享同一静态前缀；关无「自动转入计划」且 OFF 行整行保留，开 ON 段整段保留且无 OFF 行；跟随行仅尾部', () => {
  const off = refine.buildRefinePrompt({ projectRoot: '/tmp/p', batchId: 'RFB-1', modelSource: 'follow' });
  const on = refine.buildRefinePrompt({ projectRoot: '/tmp/p', batchId: 'RFB-1', modelSource: 'follow', autoPlan: true });
  assert.equal(staticPrefix(off, 'OFF'), staticPrefix(on, 'ON'), 'autoPlan 分态不得改变公共前缀');
  assert.ok(off.includes(taskSettings.REFINE_SCHEDULER_KEEP_ACCEPTED_LINE), 'OFF 约束行整行保留');
  assert.ok(!off.includes('自动转入计划'), 'OFF 全文无自动转入计划说明');
  assert.ok(on.includes(taskSettings.REFINE_SCHEDULER_AUTO_PLAN_LINES.join('\n')), 'ON 约束段整段保留');
  assert.ok(!on.includes(taskSettings.REFINE_SCHEDULER_KEEP_ACCEPTED_LINE), 'ON 不含 OFF 约束行');
  const bare = refine.buildRefinePrompt({ projectRoot: '/tmp/p', batchId: 'RFB-1' });
  assert.equal(staticPrefix(off, 'follow'), staticPrefix(bare, 'bare'), '模型跟随行不得改变公共前缀');
  assert.ok(!bare.includes(taskSettings.FOLLOW_SESSION_PROMPT_LINE), '无模型入参不注入跟随行');
});

// ---------- T4 AI 分析单项（buildRefineWorkerPrompt） ----------

const workerItemA = { id: 'REQ-20990922-001', title: '示例条目甲', itemDir: '/tmp/projA/agent-team-board/data/requirements/REQ-20990922-001', reasons: ['README 描述待补充'] };
const workerItemB = { id: 'BUG-20990922-002', title: '缺陷乙', itemDir: '/tmp/projB/agent-team-board/data/bugs/BUG-20990922-002', reasons: ['缺现象说明', '缺复现步骤'] };

t('T4 分析单项：不同条目/执行编号静态前缀逐字一致；autoPlan 分态前缀一致；条目目录/缺失原因/执行编号仍是整行稳定形态', () => {
  const a = refine.buildRefineWorkerPrompt({ item: workerItemA, projectRoot: '/tmp/projA', runId: 'run-20990922-000000-0001' });
  const b = refine.buildRefineWorkerPrompt({ item: workerItemB, projectRoot: '/tmp/projB', runId: 'run-20990922-000000-0002' });
  assert.equal(staticPrefix(a, '单项A'), staticPrefix(b, '单项B'), '不同条目/项目根/执行编号的静态前缀逐字一致');
  assertNotInPrefix(a, [workerItemA.id, workerItemA.title, workerItemA.itemDir, workerItemA.reasons[0], 'run-20990922-000000-0001', '/tmp/projA'], '分析单项A');
  const off = refine.buildRefineWorkerPrompt({ item: workerItemA, projectRoot: '/tmp/p', runId: 'run-20990922-000000-0003' });
  const on = refine.buildRefineWorkerPrompt({ item: workerItemA, projectRoot: '/tmp/p', runId: 'run-20990922-000000-0003', autoPlan: true });
  assert.equal(staticPrefix(off, '单项OFF'), staticPrefix(on, '单项ON'), 'autoPlan 分态不得改变公共前缀');
  assert.ok(off.includes(taskSettings.REFINE_WORKER_KEEP_ACCEPTED_LINE) && !off.includes('自动转入计划'), 'OFF 约束行保留且无自动转入计划说明');
  assert.ok(on.includes(taskSettings.REFINE_WORKER_AUTO_PLAN_LINES.join('\n')), 'ON 约束段保留');
  // 运行核验解析口径：整行稳定形态（值移入参数区，行前缀不变）
  for (const p of [a, b]) {
    assert.ok(p.split('\n').includes(`条目目录：${p === a ? workerItemA.itemDir : workerItemB.itemDir}`), '「条目目录：<目录>」整行形态保留');
    assert.ok(p.split('\n').some((l) => l.startsWith('缺失原因：')), '「缺失原因：…」整行形态保留');
    assert.ok(p.split('\n').some((l) => l.startsWith('执行编号：')), '「执行编号：…」整行形态保留');
  }
});

// ---------- T5 AI 总结（buildDocSummaryPrompt） ----------

t('T5 AI 总结：不同 planId / runId / 关联条目前缀逐字一致；回执命令段恒定形态（无 runId 也含回执命令与占位符）；动态值仅在参数区', () => {
  const a = flow.buildDocSummaryPrompt({
    projectRoot: '/tmp/projA', planId: 'BLD-20260921-001', runId: 'sum-20260922-010101-aa01',
    items: [{ itemId: 'REQ-20260921-001', commit: 'a'.repeat(40), title: '甲' }, { itemId: 'BUG-20260921-009', commit: 'b'.repeat(40), title: '乙' }],
    atbPath: '/tmp/atb.mjs',
  });
  const b = flow.buildDocSummaryPrompt({
    projectRoot: '/tmp/projB', planId: 'BLD-20260922-042', runId: 'sum-20260922-020202-bb02',
    items: [{ itemId: 'REQ-20260922-010', commit: 'c'.repeat(40), title: '丙' }],
    atbPath: '/tmp/other/atb.mjs', langs: ['en', 'cn'],
  });
  assert.equal(staticPrefix(a, '总结A'), staticPrefix(b, '总结B'), '不同计划号/执行编号/关联范围/语言集首语言的静态前缀逐字一致');
  assertNotInPrefix(a, ['BLD-20260921-001', '20260921-001', 'sum-20260922-010101-aa01', '/tmp/projA', 'REQ-20260921-001'], 'AI 总结');
  // 回执命令段恒定形态：不传 runId 仍输出命令模板（占位符）与写作约束
  const noRun = flow.buildDocSummaryPrompt({ projectRoot: '/tmp/projA', planId: 'BLD-20260921-001', items: [] });
  const prefixNoRun = staticPrefix(noRun, '总结无runId');
  for (const s of ['atb summary file <执行编号> --file <文件名> --state summarizing', 'atb summary done <执行编号>', 'atb summary fail <执行编号>', '不得编造', 'README.md → CHANGELOG.md / FEATURES.md']) {
    assert.ok(prefixNoRun.includes(s), `静态前缀应含恒定命令/约束「${s}」`);
  }
  for (const p of [a, b]) {
    const tp = tail(p, 'AI 总结');
    for (const s of ['summarizing', 'summarized']) assert.ok(tp.includes(s) || staticPrefix(p, 'AI 总结').includes(s), `回执命令段保留「${s}」`);
  }
  assert.ok(tail(a, 'AI 总结').includes('sum-20260922-010101-aa01'), '执行编号在运行参数区绑定');
});

// ---------- T6 AI 完善（web/build.js vm 装载） ----------

function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes, dataset: {}, innerHTML: '', textContent: '', value: '', title: '', disabled: false, checked: false, hidden: false,
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(sel) { if (!nodes.has(sel)) nodes.set(sel, element()); return nodes.get(sel); },
    querySelectorAll() { return []; },
    appendChild(c) { this.children.push(c); },
    replaceChildren(...c) { this.children = c; },
    setAttribute() {}, removeAttribute() {}, focus() {}, select() {}, remove() {},
    closest() { return null; },
  };
}

function loadBuildModule() {
  const buildJs = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'build.js'), 'utf8');
  const document = element();
  document.createElement = element;
  document.body = element();
  document.addEventListener = () => {};
  document.nodes.set('#buildView', element());
  const sandbox = {
    document, console, URLSearchParams,
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    navigator: { clipboard: { writeText: async () => {} } },
    location: {},
    toast: () => {},
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  };
  sandbox.window = sandbox;
  sandbox.window.location = sandbox.location;
  vm.createContext(sandbox);
  vm.runInContext(buildJs, sandbox, { filename: 'build.js' });
  return sandbox.window.ATBBuild;
}

t('T6 AI 完善 buildPrompt：不同版本静态前缀逐字一致；回答格式在静态段；动态值只在参数区；parseAnswer 约定不变', () => {
  const m = loadBuildModule();
  assert.equal(typeof m.buildPrompt, 'function', 'buildPrompt 纯函数接缝保留');
  const H = 'd'.repeat(40);
  const va = { id: 'BLD-20260922-001', name: 'v1.0', description: '首个版本', items: [{ itemId: 'REQ-20260922-001', commit: H, title: '甲需求' }] };
  const vb = { id: 'BLD-20260922-002', name: '', description: '', items: [] };
  const pa = m.buildPrompt(va);
  const pb = m.buildPrompt(vb);
  assert.equal(staticPrefix(pa, '完善A'), staticPrefix(pb, '完善B'), '不同版本/名称/描述/关联条目的静态前缀逐字一致');
  assertNotInPrefix(pa, ['BLD-20260922-001', 'v1.0', '首个版本', 'REQ-20260922-001'], 'AI 完善');
  const prefix = staticPrefix(pa, 'AI 完善');
  assert.ok(prefix.includes('版本名称：<一行>') && prefix.includes('版本描述：<可多行>'), '回答格式约定位于静态前缀');
  assert.ok(tail(pa, 'AI 完善').includes('BLD-20260922-001'), '版本号在运行参数区绑定');
  assert.ok(tail(pa, 'AI 完善').includes('REQ-20260922-001'), '关联条目清单在运行参数区');
  // parseAnswer 约定不变（行为零回归）
  const parsed = m.parseAnswer('版本名称：v2.0 智能版\n版本描述：\n综合本轮条目。');
  assert.equal(parsed.ok, true, 'parseAnswer 仍按约定解析');
  assert.equal(parsed.name, 'v2.0 智能版');
  assert.equal(parsed.description, '综合本轮条目。');
});

// ---------- T7 展示层兼容（normalizePromptForDisplay） ----------

t('T7 展示层兼容：新提示词归一幂等；存量冻结旧形态归一不回退', () => {
  const norm = taskSettings.normalizePromptForDisplay;
  const prompts = [
    batch.generatePrompt({ projectRoot: '/tmp/p', batchId: 'b-1', workerSpecPath: '/s.md', modelSource: 'follow' }),
    refine.buildRefinePrompt({ projectRoot: '/tmp/p', batchId: 'RFB-1', modelSource: 'follow' }),
    refine.buildRefinePrompt({ projectRoot: '/tmp/p', batchId: 'RFB-1', modelSource: 'follow', autoPlan: true }),
    refine.buildRefineWorkerPrompt({ item: workerItemA, projectRoot: '/tmp/p', runId: 'run-20990922-000000-0009' }),
    refine.buildRefineWorkerPrompt({ item: workerItemA, projectRoot: '/tmp/p', runId: 'run-20990922-000000-0009', autoPlan: true }),
  ];
  const devPrompt = prompts[0];
  const rfOff = prompts[1];
  const rfOn = prompts[2];
  const wOff = prompts[3];
  const wOn = prompts[4];
  for (const [i, p] of prompts.entries()) {
    assert.equal(norm(p), p, `新提示词 ${i + 1} 无选项归一应幂等`);
  }
  assert.equal(norm(rfOn, { autoPlan: true }), rfOn, 'ON 提示词 autoPlan:true 归一幂等');
  assert.equal(norm(wOn, { autoPlan: true }), wOn, 'ON 单项提示词 autoPlan:true 归一幂等');
  // 实时分态归一（展示层沿 BUG-20260910-008 语义）：OFF → ON 的转换只发生在尾部参数区，公共前缀不受影响
  const rfOffToOn = norm(rfOff, { autoPlan: true });
  assert.ok(rfOffToOn.includes(taskSettings.REFINE_SCHEDULER_AUTO_PLAN_LINES.join('\n')), 'OFF 主调度按开关归一为 ON 段');
  assert.equal(staticPrefix(rfOffToOn, 'OFF→ON'), staticPrefix(rfOff, 'OFF'), '归一转换不影响静态前缀');
  const wOffToOn = norm(wOff, { autoPlan: true });
  assert.ok(wOffToOn.includes(taskSettings.REFINE_WORKER_AUTO_PLAN_LINES.join('\n')), 'OFF 单项按开关归一为 ON 段');
  assert.equal(staticPrefix(wOffToOn, '单项OFF→ON'), staticPrefix(wOff, '单项OFF'), '单项归一转换不影响静态前缀');
  assert.equal(norm(devPrompt, { autoPlan: true }), devPrompt, '开发提示词不含完善约束行，autoPlan 选项不影响');
  // 存量旧形态：批次行删除 / 旧前缀归一 / 头行归一仍生效（沿用既有口径抽查）
  const legacy = [
    '你是当前项目的批次调度员，只负责派发与接收短回执。',
    '项目：/tmp/p',
    '批次：batch-20260901-001',
    taskSettings.FOLLOW_SESSION_PROMPT_LINE,
    '执行规范：/tmp/w.md',
    '批次摘要入口：node /x/atb.mjs batch check --batch batch-20260901-001 --dir /tmp/p',
    '',
    '每轮新启动一个子代理，按执行规范自行选择本批一个可实施条目，认领、实施、测试并上报。',
    '每个子代理只做一项；子代理会话命名统一为：<条目编号>（与主调度会话区分）。',
    '收尾只给批次计数和异常入口。不得代替人工接受需求或确认完成。',
  ].join('\n');
  const out = norm(legacy);
  for (const w of ['批次', 'batchId', '--batch', 'nextBatch']) assert.ok(!out.includes(w), `存量旧形态归一后仍不含「${w}」`);
  assert.ok(out.includes('AI 开发调度员') && out.includes('batch check --dir'), '旧形态归一为现行口径');
});

// ---------- T8 语义护栏（关键命令与角色锚点不回退） ----------

t('T8 语义护栏：新生成提示词保留各流程关键命令与角色锚点', () => {
  const dev = batch.generatePrompt({ projectRoot: '/tmp/p', batchId: 'b-1', workerSpecPath: '/s.md', modelSource: 'follow' });
  assert.ok(dev.includes('你是当前项目的 AI 开发调度员，只负责派发与接收短回执。'), '开发主调度首行角色句');
  assert.ok(dev.includes('batch check --dir'), '开发核对入口命令');
  assert.ok(dev.includes('实时取单') && dev.includes('最旧优先'), '实时取单指令');

  const rf = refine.buildRefinePrompt({ projectRoot: '/tmp/p', batchId: 'RFB-1', modelSource: 'follow' });
  assert.ok(rf.includes('你是当前项目的 AI 分析调度员，只负责派发与接收短回执。'), '分析主调度首行角色句');
  assert.ok(rf.includes('atb refine next --by refine-<序号>'), '分析领取命令（通用前缀）');
  assert.ok(rf.includes('atb refine done') && rf.includes('atb refine fail'), '分析回执命令');
  assert.ok(rf.includes('refine check --dir'), '分析核对入口');

  const sum = flow.buildDocSummaryPrompt({ projectRoot: '/tmp/p', planId: 'BLD-20260921-001', runId: 'sum-20260922-010101-aa01', items: [] });
  assert.ok(sum.includes('atb summary file <执行编号>') && sum.includes('atb summary done <执行编号>') && sum.includes('atb summary fail <执行编号>'), '总结逐文件回执命令模板');

  const m = loadBuildModule();
  assert.ok(m.buildPrompt({ id: 'BLD-20260922-001', name: '', description: '', items: [] }).includes('版本名称：<一行>'), 'AI 完善回答格式锚点');
});

// ---------- 执行 ----------

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
