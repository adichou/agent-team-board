#!/usr/bin/env node
// REQ-20260913-005 契约测试 —— 「批量完善→AI 分析」「批量开发→AI 开发」全面文案整改
// 覆盖 test-cases.md 用例 W1-W3 / C1-C2（R1 由同步更新后的存量 UI 测试守）。
// 范围：用户可见文案（按钮/页签/徽标/弹窗/toast/空态/CLI 帮助与日志/i18n 中英对照）；
// 标识符与接口契约（data-bmode、'refine'/'develop' 取值、子命令、API 路径）不动。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as taskSettings from '../lib/task-settings.mjs';
import * as batch from '../lib/batch.mjs';
import * as refine from '../lib/refine-store.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const appJs = read('web', 'app.js');
const html = read('web', 'index.html');
const i18n = read('web', 'i18n.js');
const css = read('web', 'style.css');
const atb = read('atb.mjs');
const core = read('lib', 'core.mjs');
const libBatch = read('lib', 'batch.mjs');
const refineStore = read('lib', 'refine-store.mjs');
const gitFlow = read('lib', 'git-flow.mjs');
const stateGuard = read('state-guard.mjs');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const OLD_WORDS = ['批量完善', '批量开发', '开始完善', '开始开发'];

// 剔除注释（JS 行/块注释、HTML 注释）后做旧词零命中检查：
// 剥离只在「多剥」方向偏差（字符串内 // 或 /* 会连注释外内容一并剥掉），
// 只可能弱化检查、不可能误报失败，对零命中断言是保守安全的。
function stripJsComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
}
function stripHtmlComments(src) {
  return src.replace(/<!--[\s\S]*?-->/g, '');
}

// ---------- W1 / W2 Web 前端 ----------

t('W1a index.html：档位快捷入口 aria-label / title / 可见文案、驳回按钮 title 换新词', () => {
  assert.ok(html.includes('aria-label="AI 分析"'), '快捷入口 aria-label 应为新词（与可见文字同源；REQ-20260914-005 去「开始」）');
  assert.ok(html.includes('▶ AI 分析</button>'), '快捷入口可见文案应为「▶ AI 分析」');
  assert.ok(html.includes('进入任务模块 AI 分析面板：对已接受未完善条目批量补全文档（与勾选无关）'), '快捷入口 title 应指向 AI 分析面板');
  assert.ok(html.includes('完善中的单待本轮 AI 分析结束后再驳回'), '驳回待接受按钮 title 应为新词');
  for (const w of OLD_WORDS) assert.ok(!stripHtmlComments(html).includes(w), `index.html 可见文案不应再出现「${w}」`);
});

t('W1b app.js 用户可见文案：页签/筛选档/徽标/弹窗/toast/空态/快捷入口全部换新词', () => {
  const pairs = [
    ['▶ 开始完善', '▶ AI 分析'],
    ['▶ 开始开发', '▶ AI 开发'],
    ['进入任务模块批量完善面板：对已接受未完善条目批量补全文档（与勾选无关）', '进入任务模块 AI 分析面板：对已接受未完善条目批量补全文档（与勾选无关）'],
    ['进入任务模块批量开发面板：以已计划队列（最旧优先）为范围，由面板内「启动」创建任务', '进入任务模块 AI 开发面板：以已计划队列（最旧优先）为范围，由面板内「启动」创建任务'],
    ['已接受未完善：可由批量完善任务补全文档；点击查看批量完善面板', '已接受未完善：可由 AI 分析任务补全文档；点击查看 AI 分析面板'],
    ['子代理正在完善本文档；点击查看批量完善面板', '子代理正在完善本文档；点击查看 AI 分析面板'],
    ['文档已由批量完善补全；点击查看批量完善面板', '文档已由 AI 分析补全；点击查看 AI 分析面板'],
    ['决策已齐备：条目回已计划队列，可被批量开发重新取单', '决策已齐备：条目回已计划队列，可被 AI 开发重新取单'],
    ['：回到已计划队列，可被批量开发重新取单', '：回到已计划队列，可被 AI 开发重新取单'],
    ['完善中，待本轮批量完善结束后再驳回', '完善中，待本轮 AI 分析结束后再驳回'],
    ["{ key: 'develop', label: '批量开发' }", "{ key: 'develop', label: 'AI 开发' }"],
    ["{ key: 'refine', label: '批量完善' }", "{ key: 'refine', label: 'AI 分析' }"],
    ['GLOBAL_KIND_LABEL = { develop: \'批量开发\', refine: \'批量完善\' }', 'GLOBAL_KIND_LABEL = { develop: \'AI 开发\', refine: \'AI 分析\' }'],
    ['可启动新的批量开发 / 批量完善任务', '可启动新的 AI 开发 / AI 分析任务'],
    ['data-bmode="refine">批量完善<', 'data-bmode="refine">AI 分析<'],
    ['data-bmode="develop">批量开发<', 'data-bmode="develop">AI 开发<'],
    ['批量完善：对已接受条目批量补全文档', 'AI 分析：对已接受条目批量补全文档'],
    ['终止批量完善任务？', '终止 AI 分析任务？'],
    ['终止批量开发任务？', '终止 AI 开发任务？'],
  ];
  for (const [oldS, newS] of pairs) {
    assert.ok(!appJs.includes(oldS), `app.js 旧文案应删除：${oldS}`);
    assert.ok(appJs.includes(newS), `app.js 新文案应存在：${newS}`);
  }
  // 标识符不动：内部取值 / 深链 / API 契约保留
  for (const id of ['data-bmode="refine"', 'data-bmode="develop"', "gotoRuns('refine')", "gotoRuns('develop')"]) {
    assert.ok(appJs.includes(id), `标识符应保留：${id}`);
  }
});

t('W2 剔除注释后 web 四文件旧词零命中（注释按规范不作验收项）', () => {
  const stripped = {
    'web/app.js': stripJsComments(appJs),
    'web/index.html': stripHtmlComments(html),
    'web/i18n.js': stripJsComments(i18n),
    'web/style.css': css.replace(/\/\*[\s\S]*?\*\//g, ''),
  };
  for (const [file, src] of Object.entries(stripped)) {
    for (const w of OLD_WORDS) assert.ok(!src.includes(w), `${file} 剔除注释后不应出现「${w}」`);
  }
});

t('W3 i18n 中英成对更新：19 个新键存在且值非空；中英两侧均无旧词', () => {
  // i18n.js 注释不含旧词，直接整文件检查两侧
  for (const w of OLD_WORDS) assert.ok(!i18n.includes(w), `i18n.js 不应残留旧键（中文侧）：${w}`);
  for (const en of ['Batch refine', 'Batch develop', 'Start refining', 'Start developing', 'batch refine', 'batch develop', 'batch development']) {
    assert.ok(!i18n.includes(en), `i18n.js 不应残留旧英文：${en}`);
  }
  const pairs = [
    "'▶ AI 分析': '▶ AI analysis'",
    "'▶ AI 开发': '▶ AI development'",
    "'AI 分析': 'AI analysis'",
    "'AI 开发': 'AI development'",
    "'终止 AI 分析任务？': 'Abort AI analysis task?'",
    "'终止 AI 开发任务？': 'Abort AI development task?'",
    "'子代理正在完善本文档；点击查看 AI 分析面板'",
    "'已接受未完善：可由 AI 分析任务补全文档；点击查看 AI 分析面板'",
    "'进入任务模块 AI 分析面板：对已接受未完善条目批量补全文档（与勾选无关）'",
    "'进入任务模块 AI 开发面板：以已计划队列（最旧优先）为范围，由面板内「启动」创建任务'",
    "'驳回待接受（退回待接受）：勾选的已接受条目逐条退回待接受；完善中的单待本轮 AI 分析结束后再驳回'",
    "'完善中，待本轮 AI 分析结束后再驳回'",
    "'文档已由 AI 分析补全；点击查看 AI 分析面板'",
    "'决策已齐备：条目回已计划队列，可被 AI 开发重新取单'",
    "'已复工 ◇：回到已计划队列，可被 AI 开发重新取单'",
    "'到各项目的任务模块（「任务」页签）可启动新的 AI 开发 / AI 分析任务；新任务登记运行后会自动出现在这里。'",
    "'AI 分析：对已接受条目批量补全文档",
  ];
  for (const p of pairs) assert.ok(i18n.includes(p), `i18n.js 应含新键：${p}`);
});

// ---------- C1 / C2 CLI 与服务端 ----------

t('C1 CLI/服务端输出：帮助/日志/报错/生成文案/提示词首句/summary/守卫/TASK_KIND_LABEL 全部新词', () => {
  const checks = [
    [atb, '创建批量开发批次', '创建 AI 开发批次'],
    [atb, '进入批量完善候选，无需再人工接受', '进入 AI 分析候选，无需再人工接受'],
    [atb, '进入批量开发候选）', '进入 AI 开发候选）'],
    [atb, '被批量开发重新取单', '被 AI 开发重新取单'],
    [atb, '可被批量开发重新取单；决策记录见条目目录', '可被 AI 开发重新取单；决策记录见条目目录'],
    [core, '「批量开发」核对遗留改动', '「AI 开发」核对遗留改动'],
    [core, '「批量开发」核对执行状态', '「AI 开发」核对执行状态'],
    [core, '待本轮批量完善结束后再驳回回待接受', '待本轮 AI 分析结束后再驳回回待接受'],
    [libBatch, '# 批量开发执行规范', '# AI 开发执行规范'],
    [libBatch, '你是当前项目的批量开发调度员，只负责派发与接收短回执。', '你是当前项目的 AI 开发调度员，只负责派发与接收短回执。'],
    [refineStore, '你是当前项目的批量完善调度员，只负责派发与接收短回执。', '你是当前项目的 AI 分析调度员，只负责派发与接收短回执。'],
    [gitFlow, '到待测试自动提交（批量开发回执核验通过）', '到待测试自动提交（AI 开发回执核验通过）'],
    [stateGuard, '批量开发到待测试由系统自动提交', 'AI 开发到待测试由系统自动提交'],
    [read('lib', 'task-settings.mjs'), "TASK_KIND_LABEL = { refine: '批量完善', develop: '批量开发' }", "TASK_KIND_LABEL = { refine: 'AI 分析', develop: 'AI 开发' }"],
  ];
  for (const [src, oldS, newS] of checks) {
    assert.ok(!src.includes(oldS), `旧文案应删除：${oldS}`);
    assert.ok(src.includes(newS), `新文案应存在：${newS}`);
  }
  // 剔除注释后零命中（注释按规范不作验收项）。例外：task-settings.mjs 展示层归一链中的
  // `.split('批量开发调度员' / '批量完善调度员')` 是匹配存量冻结提示词的**输入模式**（同既有
  // 「批次调度员」模式），不是对外输出文案，先剥离后再检查。
  const tsSrc = read('lib', 'task-settings.mjs')
    .split(".split('批量开发调度员')").join('')
    .split(".split('批量完善调度员')").join('');
  for (const [file, src] of Object.entries({
    'atb.mjs': atb, 'lib/core.mjs': core, 'lib/batch.mjs': libBatch, 'lib/refine-store.mjs': refineStore,
    'lib/git-flow.mjs': gitFlow, 'state-guard.mjs': stateGuard, 'lib/task-settings.mjs': tsSrc,
  })) {
    for (const w of OLD_WORDS) assert.ok(!stripJsComments(src).includes(w), `${file} 剔除注释后不应出现「${w}」`);
  }
});

t('C2a 数据层：TASK_KIND_LABEL 新值；两类提示词首句新词且全文无旧词', () => {
  assert.deepEqual(taskSettings.TASK_KIND_LABEL, { refine: 'AI 分析', develop: 'AI 开发' });
  const rp = refine.buildRefinePrompt({ projectRoot: '/tmp/p', batchId: 'RFB-20990101-001' });
  assert.ok(rp.includes('你是当前项目的 AI 分析调度员，只负责派发与接收短回执。'), '完善提示词首句应为 AI 分析调度员');
  assert.ok(!rp.includes('批量完善'), '完善提示词不应再含旧词');
  const dp = batch.generatePrompt({ projectRoot: '/tmp/p', batchId: 'batch-20990101-001', workerSpecPath: '/tmp/w.md' });
  assert.ok(dp.includes('你是当前项目的 AI 开发调度员，只负责派发与接收短回执。'), '开发提示词首句应为 AI 开发调度员');
  assert.ok(!dp.includes('批量开发'), '开发提示词不应再含旧词');
});

t('C2b 展示层归一：存量冻结「批量完善/批量开发/批次调度员」归一为新词；现行输出幂等', () => {
  const norm = taskSettings.normalizePromptForDisplay;
  const mk = (who) => `你是当前项目的${who}，只负责派发与接收短回执。\n项目：/tmp/p\n每轮新启动一个子代理，按执行规范领取当前队列中最早的一个可实施条目，认领、实施、测试并上报。`;
  assert.ok(norm(mk('批量完善调度员')).includes('AI 分析调度员'), '冻结「批量完善调度员」应归一为「AI 分析调度员」');
  assert.ok(norm(mk('批量开发调度员')).includes('AI 开发调度员'), '冻结「批量开发调度员」应归一为「AI 开发调度员」');
  assert.ok(norm(mk('批次调度员')).includes('AI 开发调度员'), '冻结「批次调度员」应归一为「AI 开发调度员」');
  const rp = refine.buildRefinePrompt({ projectRoot: '/tmp/p', batchId: 'RFB-20990101-001' });
  assert.equal(norm(rp), rp, '现行完善提示词归一幂等');
  const dp = batch.generatePrompt({ projectRoot: '/tmp/p', batchId: 'batch-20990101-001', workerSpecPath: '/tmp/w.md' });
  assert.equal(norm(dp), dp, '现行开发提示词归一幂等');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
