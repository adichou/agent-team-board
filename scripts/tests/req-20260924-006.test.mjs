#!/usr/bin/env node
// REQ-20260924-006 文档编写流程优化（五步：AI 总结 → 二次编辑 → AI 校对 → AI 翻译 → 提交）
// —— 分层测试。
// L1 纯逻辑（publish-flow：AI 校对提示词补链接核查 + 待确认口径；总结提示词契约回归）；
// L4 纯函数（build.js：parseChkSuggestion / classifyChkIssue / applyChkSuggestion / chkPendingCount）；
// L4 渲染（renderDocsPane 五步条 + 校对建议侧栏；renderSecondaryEditModal 默认语言单语言弹窗）；
// L4 行为（二次编辑未保存保护 / 建议接受拒绝与过期 / 翻译建议门禁与单语言空态）；
// L6 i18n（新增文案中英齐备、动态键往返还原）。
// 用法：node scripts/tests/req-20260924-006.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as flow from '../lib/publish-flow.mjs';
import '../web/i18n.js';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function extractFn(source, name) {
  // async 函数允许 async 前缀（本单行为接缝含 async：loadEditFile / saveEditFile /
  // acceptChkSuggestion / startTranslation / resolveEditPending）
  const m = source.match(new RegExp(`  (?:async )?function ${name}\\(([^)]*)\\) \\{[\\s\\S]*?\\n  \\}`));
  assert.ok(m, `build.js 中应存在 ${name} 函数`);
  return m[0];
}

function vmRun(fns, context, expr) {
  const ctx = vm.createContext(context);
  vm.runInContext(fns, ctx);
  return vm.runInContext(expr, ctx);
}

const FLOW_STUB = {
  DOCS_FLOW_LABEL: {
    unsummarized: '未总结', summarizing: '正在总结', summarized: '已总结待审核',
    untranslated: '未翻译', translating: '正在翻译', translated: '已翻译待审核', reviewed: '已审核',
    unwritten: '未编写', pending: '待审核',
  },
  DOCS_FLOW_CLS: {
    unsummarized: 'st-mute', summarizing: 'st-run', summarized: 'st-wait',
    untranslated: 'st-mute', translating: 'st-run', translated: 'st-wait', reviewed: 'st-ok',
    unwritten: 'st-mute', pending: 'st-wait',
  },
  DOCS_FLOW_ICON: {
    unsummarized: '○', summarizing: '◐', summarized: '●',
    untranslated: '○', translating: '◐', translated: '●', reviewed: '✔',
    unwritten: '○', pending: '●',
  },
  DOC_KEYS: ['README', 'CHANGELOG', 'FEATURES', 'AGENTS'],
  DOC_SINGLE_KEYS: ['LICENSE'],
  DEFAULT_DOC_LANGS: ['cn', 'en'],
  langNameOf: (l) => String(l),
  docFilesOf: (langs, customDocs) => flow.publishDocFiles(
    Array.isArray(langs) && langs.length ? langs : flow.DEFAULT_DOC_LANGS, customDocs,
  ),
};

const ESC = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const L4_CTX = {
  pfOf: (v) => v.pf,
  esc: ESC,
  short: (h) => String(h || '').slice(0, 8),
  fmtTime: () => 't',
  ...FLOW_STUB,
};

const SOURCE = () => fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');

function paneFns(source) {
  return [
    extractFn(source, 'summaryBtnText'),
    extractFn(source, 'translateBtnText'),
    extractFn(source, 'normalizeFlowEval'),
    extractFn(source, 'translateBtnHtml'),
    extractFn(source, 'finalizeBtnHtml'),
    extractFn(source, 'commitBtnHtml'),
    extractFn(source, 'docsStageBar'),
    extractFn(source, 'splitProofreadIssues'),
    extractFn(source, 'parseIssueLineNo'),
    extractFn(source, 'parseChkSuggestion'),
    extractFn(source, 'classifyChkIssue'),
    extractFn(source, 'chkPendingCount'),
    extractFn(source, 'renderDocsPane'),
  ].join('\n');
}

function editModalFns(source) {
  return [
    extractFn(source, 'sanitizeHtml'),
    extractFn(source, 'renderMd'),
    extractFn(source, 'normalizeFlowEval'),
    extractFn(source, 'renderSecondaryEditModal'),
  ].join('\n');
}

function pureFns(source, name) {
  return [extractFn(source, 'splitProofreadIssues'), extractFn(source, 'parseIssueLineNo'), extractFn(source, name)].join('\n');
}

/* ---------- L1 提示词（publish-flow） ---------- */

t('L1-1 AI 校对提示词：补「超链接有效性」检查项；无法验证（网络不可达 / 需登录）的链接标「待确认」，不得判为有效或确定失效；既有只读 / 不编造 / 行号回执约束不回退', () => {
  const p = flow.buildDocProofreadPrompt({
    projectRoot: '/tmp/proj-x', planId: 'BLD-20260924-006', runId: 'chk-20260924-120000-ab01',
    langs: ['cn', 'en'], customDocs: ['MIGRATION'], atbPath: '/tmp/atb.mjs',
  });
  // 链接核查进入检查项
  assert.ok(p.includes('超链接') || p.includes('链接有效性'), '检查项应覆盖链接有效性');
  // 待确认口径：区分确定失效与无法验证
  assert.ok(p.includes('待确认'), '应约束无法验证的链接标注「待确认」');
  assert.ok(/不得判为有效或确定失效|不能判成有效或确定失效/.test(p), '不得把无法验证判成有效或确定失效');
  assert.ok(p.includes('需要登录') || p.includes('登录'), '需登录场景纳入待确认口径');
  // 既有约束不回退（REQ-20260924-001 / 004 契约）
  assert.ok(p.includes('错别字') && p.includes('行文规范'), '错别字与行文规范检查项保持');
  assert.ok(p.includes('独立一行') && p.includes('行号开头'), '回执格式约束保持');
  assert.ok(p.includes('不修改') || p.includes('只读'), '只读不改约束保持');
  assert.ok(p.includes('不编造'), '不编造约束保持');
  assert.ok(p.includes('chk-20260924-120000-ab01'), '运行参数区保持');
});

t('L1-2 AI 总结提示词契约回归：关联需求清单 + 按实际代码与提交核实 + 只总结默认语言（验收第 2 条既有能力不回退）', () => {
  const p = flow.buildDocSummaryPrompt({
    projectRoot: '/tmp/proj-x', planId: 'BLD-20260924-006', runId: 'sum-20260924-120000-ab01',
    langs: ['cn', 'en'], customDocs: [],
    items: [{ itemId: 'REQ-20260924-006', commits: ['a'.repeat(40)] }],
  });
  assert.ok(p.includes('按实际代码与提交核实变化'), '实际变更核验要求保持');
  assert.ok(p.includes('REQ-20260924-006'), '本版关联需求清单进入提示词');
  assert.ok(p.includes('只总结默认语言'), '只编写默认语言初稿约束保持');
  assert.ok(p.includes('atb summary'), '回执命令保持（复制提示词交 Agent 执行）');
});

/* ---------- L4 纯函数 ---------- */

t('L4-1 parseChkSuggestion：解析「第 N 行：原文「A」→ 建议「B」」出 line/before/after 且可应用；无前后对 / 空 before / 前后相同不可应用；无行号 line=null', () => {
  const fns = pureFns(SOURCE(), 'parseChkSuggestion');
  const ctx = vm.createContext({});
  vm.runInContext(fns, ctx);
  const j = (s) => JSON.stringify(vm.runInContext(`parseChkSuggestion(${JSON.stringify(s)})`, ctx));
  // 标准格式（REQ-20260924-004 回执口径）
  let r = JSON.parse(j('第 12 行：原文「坏境」→ 建议「环境」'));
  assert.equal(r.line, 12); assert.equal(r.before, '坏境'); assert.equal(r.after, '环境');
  assert.equal(r.applicable, true);
  // 无「原文」前缀变体
  r = JSON.parse(j('第 37 行：「的的生成」→ 建议「的生成」'));
  assert.equal(r.before, '的的生成'); assert.equal(r.after, '的生成'); assert.equal(r.applicable, true);
  // 无行号：全文定位
  r = JSON.parse(j('（无行号）：「登陆」→ 建议「登录」'));
  assert.equal(r.line, null); assert.equal(r.applicable, true);
  // 删除型建议（after 为空）仍可应用
  r = JSON.parse(j('第 3 行：原文「了了」→ 建议「」'));
  assert.equal(r.applicable, true); assert.equal(r.after, '');
  // 无「→ 建议」形态：不可应用（只展示，走「✎ 修改」）
  r = JSON.parse(j('第 5 行：长句建议拆分为两句，便于阅读'));
  assert.equal(r.applicable, false); assert.equal(r.before, null);
  // 前后相同：不可应用（无意义替换）
  r = JSON.parse(j('第 7 行：原文「相同」→ 建议「相同」'));
  assert.equal(r.applicable, false);
  // 空文本安全
  r = JSON.parse(j(''));
  assert.equal(r.applicable, false); assert.equal(r.line, null);
});

t('L4-2 classifyChkIssue：待确认优先；链接 / 错别字 / 语法标点 / 默认行文规范分类', () => {
  const fns = pureFns(SOURCE(), 'classifyChkIssue');
  const ctx = vm.createContext({});
  vm.runInContext(fns, ctx);
  const c = (s) => vm.runInContext(`classifyChkIssue(${JSON.stringify(s)})`, ctx);
  assert.equal(c('第 8 行：链接 https://x.y/z 网络不可达，标为「待确认」'), '待确认');
  assert.equal(c('第 8 行：外链需要登录才能验证，无法确认'), '待确认');
  assert.equal(c('第 2 行：链接 https://example.com/a 404 确定失效'), '链接');
  assert.equal(c('第 2 行：文档内死链：./CHANGELOG_en.md 不存在'), '链接');
  assert.equal(c('第 9 行：错别字「测式」应为「测试」（形近）'), '错别字');
  assert.equal(c('第 10 行：「登陆」→ 建议「登录」（同音错别字）'), '错别字');
  assert.equal(c('第 11 行：句尾缺标点，长句语法主语残缺'), '语法');
  assert.equal(c('第 15 行：长句建议拆分，行文更紧凑'), '行文规范');
  assert.equal(c('第 1 行：标题层级建议统一'), '行文规范');
});

t('L4-3 applyChkSuggestion：行号命中行内包含 before 才单处替换；行内不含 / 全文找不到判 stale；无行号全文定位；不修改入参字符串', () => {
  const fns = pureFns(SOURCE(), 'applyChkSuggestion');
  const ctx = vm.createContext({});
  vm.runInContext(fns, ctx);
  const run = (content, s) => vm.runInContext(`applyChkSuggestion(${JSON.stringify(content)}, ${JSON.stringify(s)})`, ctx);
  const doc = '标题\n部署到生产坏境\n服务可用\n';
  // 行号命中：该行包含 before → 单处替换（其余行同词不受影响）
  const ok = run(doc, { line: 2, before: '坏境', after: '环境' });
  assert.equal(ok.stale, undefined);
  assert.equal(ok.content, '标题\n部署到生产环境\n服务可用\n');
  // 该行不含 before（文本被人工改动）→ stale，不覆盖
  const stale = run(doc, { line: 3, before: '坏境', after: '环境' });
  assert.equal(stale.stale, true);
  // 行号超界回落：末行不含 → stale
  const over = run(doc, { line: 999, before: '坏境', after: '环境' });
  assert.equal(over.stale, true);
  // 无行号：全文首处定位替换
  const noLine = run(doc, { before: '服务', after: '服务（新）' });
  assert.equal(noLine.content, '标题\n部署到生产坏境\n服务（新）可用\n');
  // 无行号找不到 → stale
  assert.equal(run(doc, { before: '不存在', after: 'x' }).stale, true);
  // 不可应用输入 → error（调用方先行拦截，防御双保险）
  assert.equal(run(doc, { line: 1, before: '', after: 'x' }).error, '无可应用文本');
  // 入参不可变（纯函数）
  assert.equal(doc, '标题\n部署到生产坏境\n服务可用\n');
});

t('L4-4 chkPendingCount：done run 按行计待处理；accepted / rejected / stale 决断不计；非 done 或无 run 计 0；无决断对象安全', () => {
  const fns = pureFns(SOURCE(), 'chkPendingCount');
  const ctx = vm.createContext({});
  vm.runInContext(fns, ctx);
  const run = (plan, dec) => vm.runInContext(`chkPendingCount(${JSON.stringify(plan)}, ${JSON.stringify(dec)})`, ctx);
  const doneRun = {
    runId: 'chk-1', phase: 'done',
    files: { 'README.md': 'pass', 'CHANGELOG.md': 'fail' },
    issues: { 'CHANGELOG.md': '第 12 行：原文「坏境」→ 建议「环境」\n第 37 行：长句建议拆分' },
  };
  assert.equal(run({ docsCheck: doneRun }, null), 2, '两条建议均待处理');
  assert.equal(run({ docsCheck: doneRun }, { 'chk-1|CHANGELOG.md|0': 'accepted' }), 1, '接受一条后剩一条');
  assert.equal(run({ docsCheck: doneRun }, { 'chk-1|CHANGELOG.md|0': 'accepted', 'chk-1|CHANGELOG.md|1': 'rejected' }), 0, '全部决断后 0');
  assert.equal(run({ docsCheck: doneRun }, { 'chk-1|CHANGELOG.md|0': 'stale' }), 1, '过期视为已处理（不阻塞）');
  assert.equal(run({ docsCheck: { ...doneRun, phase: 'running' } }, {}), 0, '进行中不计');
  assert.equal(run({ docsCheck: { ...doneRun, phase: 'failed' } }, {}), 0, '中断不计');
  assert.equal(run({}, {}), 0, '无 run 计 0');
  assert.equal(run(null, null), 0, 'null 安全');
  // 其他 runId 的决断不影响本轮计数
  assert.equal(run({ docsCheck: doneRun }, { 'chk-other|CHANGELOG.md|0': 'accepted' }), 2);
});

/* ---------- L4 渲染：renderDocsPane 五步条 + 校对建议侧栏 ---------- */

function panePlan({ docsCheck = null, langs = ['cn', 'en'], customDocs = ['MIGRATION'], files = null } = {}) {
  const ls = langs;
  const list = (files || flow.publishDocFiles(ls, customDocs).map((f, i) => ({ ...f, state: i < 6 ? 'reviewed' : (f.lang === ls[0] ? 'summarized' : 'untranslated') })));
  return {
    langs, customDocs,
    docsFlow: {
      files: list,
      defaultReviewedCount: list.filter((f) => f.isDefault !== false && f.lang !== ls.slice(1).find((x) => x === f.lang) && f.state === 'reviewed').length,
      restReviewedCount: list.filter((f) => f.lang !== ls[0] && f.state === 'reviewed').length,
      canFinalize: true, finalized: null, canCommit: false, missing: [], translateMissing: [],
    },
    summary: null, translate: null, docsCheck,
    docs: { overall: 'none', reasons: [] },
  };
}

function paneHtml(plan, pfExtra = {}) {
  return vmRun(paneFns(SOURCE()), L4_CTX, `renderDocsPane({ id: 'V', pf: ${JSON.stringify({ phase: 'ready', plan, ...pfExtra })} })`);
}

t('L4-5 renderDocsPane 五步操作条：①–⑤ 顺序入口（data-pf-summary / data-pf-edit / data-pf-proofstep / data-pf-translate / data-pf-commit）；辅助刷新 / 审查 / 整体审查与三阶段条保留；加载 / 失败态恒渲染', () => {
  const html = paneHtml(panePlan());
  // 五步顺序入口（按文档顺序）
  const order = ['data-pf-summary', 'data-pf-edit', 'data-pf-proofstep', 'data-pf-translate', 'data-pf-commit']
    .map((k) => html.indexOf(k));
  assert.ok(order.every((i) => i >= 0), `五步钩子齐备：${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, '五步按 ①→⑤ 顺序渲染');
  for (const s of ['① AI 总结', '② 二次编辑', '③ AI 校对', '④ AI 翻译', '⑤ 提交']) {
    assert.ok(html.includes(s), `步骤文案：${s}`);
  }
  // 辅助动作与既有结构保留（边界第 1 条：不删既有入口 / 门禁）
  for (const k of ['data-pf-refresh', 'data-pf-review', 'data-pf-finalize']) {
    assert.ok(html.includes(k), `辅助动作保留：${k}`);
  }
  assert.ok(html.includes('① 默认语言先行'), '三阶段条保留');
  assert.ok(html.includes('bld-docs-stages'), '阶段条容器保留');
  // 校对建议侧栏容器（空态：尚未校对）
  assert.ok(html.includes('bld-docs-chk'), '校对建议侧栏渲染');
  assert.ok(html.includes('尚未校对'), '无 run 空态提示');
  // 加载 / 失败态五步条恒渲染
  const loading = vmRun(paneFns(SOURCE()), L4_CTX, `renderDocsPane({ id: 'V', pf: ${JSON.stringify({ phase: 'loading', plan: null })} })`);
  for (const k of ['data-pf-summary', 'data-pf-edit', 'data-pf-proofstep', 'data-pf-translate', 'data-pf-commit', 'data-pf-refresh']) {
    assert.ok(loading.includes(k), `加载态渲染 ${k}`);
  }
  const failed = vmRun(paneFns(SOURCE()), L4_CTX, `renderDocsPane({ id: 'V', pf: ${JSON.stringify({ phase: 'error', error: 'boom', plan: null })} })`);
  assert.ok(failed.includes('data-pf-proofstep') && failed.includes('data-pf-edit'), '失败态五步条恒渲染');
});

t('L4-6 renderDocsPane 校对侧栏：done 有问题文件逐条卡片（类型 / 位置 / 原文 / 前后差异 del-ins 与文字标签 / 接受拒绝钩子）；pass 文件未发现问题空态；待确认接受禁用；running / failed 状态', () => {
  const source = SOURCE();
  const fns = paneFns(source);
  const issues = '第 12 行：错别字——原文「坏境」→ 建议「环境」（形近）\n第 40 行：链接 https://x.y/z 需要登录才能验证，标为「待确认」\n第 8 行：链接 ./CHANGELOG_en.md 确定失效（死链）\n（无行号）：长句建议拆分为两句';
  const doneRun = {
    runId: 'chk-9', phase: 'done',
    files: { 'README.md': 'pass', 'CHANGELOG.md': 'fail', 'FEATURES.md': 'pass', 'AGENTS.md': 'pass', 'MIGRATION.md': 'pass' },
    issues: { 'CHANGELOG.md': issues },
    counts: { pass: 4, fail: 1, pending: 0, total: 5 },
  };
  const html = vmRun(fns, L4_CTX, `renderDocsPane({ id: 'V', pf: ${JSON.stringify({ phase: 'ready', plan: panePlan({ docsCheck: doneRun }), chkFile: 'CHANGELOG.md' })} })`);
  // 逐条卡片：4 条
  assert.equal((html.match(/<li class="bld-chk-issue"/g) || []).length, 4, '4 条建议卡片');
  // 类型 / 位置
  assert.ok(html.includes('>错别字<'), '错别字类型标签');
  assert.ok(html.includes('>链接<'), '链接类型标签');
  assert.ok(html.includes('>行文规范<'), '默认行文规范类型');
  assert.ok(html.includes('第 12 行'), '行号位置');
  assert.ok(html.includes('无行号'), '无行号位置标签');
  // 前后差异：del / ins 高亮 + 文字标签（不只靠颜色）
  assert.ok(html.includes('查看修改前后差异'), '差异展开入口');
  assert.ok(html.includes('<del>坏境</del>'), '删除高亮（修改前）');
  assert.ok(html.includes('<ins>环境</ins>'), '新增高亮（修改后）');
  assert.ok(html.includes('修改前（删除）') && html.includes('修改后（新增）'), '前后文字标签');
  // 接受 / 拒绝钩子（可应用条目）；待确认 / 无前后对条目不渲染可点接受
  assert.ok(html.includes('data-chk-accept="CHANGELOG.md|0"'), '可应用建议接受钩子');
  assert.ok(!html.includes('data-chk-accept="CHANGELOG.md|1"'), '待确认条目无接受按钮');
  assert.ok(!html.includes('data-chk-accept="CHANGELOG.md|3"'), '无前后对条目无接受按钮');
  assert.equal((html.match(/data-chk-reject=/g) || []).length, 4, '四条均可拒绝');
  assert.ok(html.includes('data-chk-edit="CHANGELOG.md"'), '✎ 修改跳转保留');
  assert.ok(html.includes('>待确认<'), '待确认状态标签');
  // 待处理计数
  assert.ok(html.includes('待处理 4 项') || html.includes('待处理'), '待处理计数展示');
  // pass 文件选中：未发现问题空态（不显示空白侧栏）
  const passHtml = vmRun(fns, L4_CTX, `renderDocsPane({ id: 'V', pf: ${JSON.stringify({ phase: 'ready', plan: panePlan({ docsCheck: doneRun }), chkFile: 'README.md' })} })`);
  assert.ok(passHtml.includes('未发现问题'), 'pass 文件未发现问题空态');
  // running：进行中进度
  const running = vmRun(fns, L4_CTX, `renderDocsPane({ id: 'V', pf: ${JSON.stringify({ phase: 'ready', plan: panePlan({ docsCheck: { runId: 'chk-9', phase: 'running', files: { 'README.md': 'checking' }, issues: {}, counts: { pass: 0, fail: 0, pending: 5, total: 5 }, currentFile: 'README.md' } }) })} })`);
  assert.ok(running.includes('校对进行中'), '进行中状态');
  // failed：原因 + 重试
  const failedRun = vmRun(fns, L4_CTX, `renderDocsPane({ id: 'V', pf: ${JSON.stringify({ phase: 'ready', plan: panePlan({ docsCheck: { runId: 'chk-9', phase: 'failed', files: {}, issues: {}, counts: { pass: 0, fail: 0, pending: 0, total: 5 }, reason: '网络中断' } }) })} })`);
  assert.ok(failedRun.includes('AI 校对中断：网络中断'), '中断原因展示');
  assert.ok(failedRun.includes('data-chk-retry'), '重试 AI 校对入口');
});

t('L4-6b renderDocsPane 决断态：已接受 / 已拒绝 / 过期卡片按钮收敛与过期说明；文件下拉选中记忆', () => {
  const source = SOURCE();
  const fns = paneFns(source);
  const doneRun = {
    runId: 'chk-9', phase: 'done',
    files: { 'README.md': 'pass', 'CHANGELOG.md': 'fail' },
    issues: { 'CHANGELOG.md': '第 12 行：原文「坏境」→ 建议「环境」\n第 37 行：「的的生成」→ 建议「的生成」\n第 40 行：「登陆」→ 建议「登录」' },
    counts: { pass: 1, fail: 1, pending: 0, total: 2 },
  };
  const dec = { 'chk-9|CHANGELOG.md|0': 'accepted', 'chk-9|CHANGELOG.md|1': 'rejected', 'chk-9|CHANGELOG.md|2': 'stale' };
  const html = vmRun(fns, L4_CTX, `renderDocsPane({ id: 'V', pf: ${JSON.stringify({ phase: 'ready', plan: panePlan({ docsCheck: doneRun }), chkFile: 'CHANGELOG.md', chkDecisions: dec })} })`);
  assert.ok(html.includes('>已接受<'), '已接受状态');
  assert.ok(html.includes('>已拒绝<'), '已拒绝状态');
  assert.ok(html.includes('>过期<'), '过期状态');
  assert.ok(html.includes('建议基于的文本已变化'), '过期说明（未覆盖当前内容）');
  assert.ok(!html.includes('data-chk-accept='), '已决断条目不再渲染接受按钮');
  assert.ok(!html.includes('data-chk-reject='), '已决断条目不再渲染拒绝按钮');
  // 待处理计数归零
  assert.ok(html.includes('待处理 0 项'), '全部决断后计数为 0');
  // 下拉选中记忆
  assert.match(html, /<option value="CHANGELOG\.md" selected/, '文件下拉选中记忆');
});

/* ---------- L4 渲染：二次编辑弹窗 ---------- */

t('L4-7 renderSecondaryEditModal：只列默认语言文件（无其他语种对照列）；编辑 / 预览 / 保存 / 关闭；未保存提示与挂起三动作；读取中 / 读取失败态；默认语言非中文与自定义文档生效', () => {
  const source = SOURCE();
  const fns = editModalFns(source);
  const ctx = { ...L4_CTX, window: { marked: null } };
  // 默认语言非中文（en,fr）+ 自定义文档：下拉只列默认语言文件
  const pfEn = {
    phase: 'ready',
    plan: {
      langs: ['en', 'fr'], customDocs: ['MIGRATION'],
      docsFlow: { files: flow.publishDocFiles(['en', 'fr'], ['MIGRATION']).map((f) => ({ ...f, state: 'summarized' })) },
    },
    edit: { open: true, file: 'README.md', mode: 'edit', content: '# Hi', disk: '# Hi', busy: false, loadErr: null, pending: null, savedNote: null },
  };
  const htmlEn = vmRun(fns, ctx, `renderSecondaryEditModal({ id: 'V', pf: ${JSON.stringify(pfEn)} })`);
  for (const f of ['README.md', 'CHANGELOG.md', 'FEATURES.md', 'AGENTS.md', 'LICENSE.md', 'MIGRATION.md']) {
    assert.ok(htmlEn.includes(`value="${f}"`), `默认语言文件在下拉：${f}`);
  }
  assert.ok(!htmlEn.includes('value="README_fr.md"') && !htmlEn.includes('value="CHANGELOG_fr.md"'), '不含其他语种对照列');
  for (const k of ['data-edit-file', 'data-edit-refresh', 'data-edit-mode', 'data-edit-save', 'data-edit-close']) {
    assert.ok(htmlEn.includes(k), `弹窗钩子：${k}`);
  }
  assert.ok(htmlEn.includes('二次编辑 · 默认语言'), '弹窗标题（默认语言标注）');
  // 未保存提示
  const dirty = { ...pfEn, edit: { ...pfEn.edit, content: '# Hi edited' } };
  const htmlDirty = vmRun(fns, ctx, `renderSecondaryEditModal({ id: 'V', pf: ${JSON.stringify(dirty)} })`);
  assert.ok(htmlDirty.includes('有未保存的修改'), '未保存提示');
  // 挂起态三动作
  const pend = { ...pfEn, edit: { ...pfEn.edit, content: '# changed', pending: { kind: 'switch', file: 'CHANGELOG.md' } } };
  const htmlPend = vmRun(fns, ctx, `renderSecondaryEditModal({ id: 'V', pf: ${JSON.stringify(pend)} })`);
  for (const k of ['data-edit-keep', 'data-edit-discard', 'data-edit-stay']) {
    assert.ok(htmlPend.includes(k), `挂起动作：${k}`);
  }
  assert.ok(htmlPend.includes('保存并继续') && htmlPend.includes('放弃修改并继续') && htmlPend.includes('留在本文件'), '挂起三动作文案');
  // 读取中 / 读取失败态
  const loading = { ...pfEn, edit: { ...pfEn.edit, content: null, disk: null } };
  assert.ok(vmRun(fns, ctx, `renderSecondaryEditModal({ id: 'V', pf: ${JSON.stringify(loading)} })`).includes('正在读取文档内容…'), '读取中态');
  const err = { ...pfEn, edit: { ...pfEn.edit, content: null, disk: null, loadErr: '磁盘占用' } };
  const htmlErr = vmRun(fns, ctx, `renderSecondaryEditModal({ id: 'V', pf: ${JSON.stringify(err)} })`);
  assert.ok(htmlErr.includes('读取失败：磁盘占用') && htmlErr.includes('data-edit-retry'), '读取失败态与重试');
  // 预览态
  const prev = { ...pfEn, edit: { ...pfEn.edit, mode: 'preview' } };
  const htmlPrev = vmRun(fns, ctx, `renderSecondaryEditModal({ id: 'V', pf: ${JSON.stringify(prev)} })`);
  assert.ok(!htmlPrev.includes('bld-edit-editor'), '预览态无编辑框');
  assert.ok(htmlPrev.includes('bld-review-preview'), '预览态渲染预览容器');
});

/* ---------- L4 行为 ---------- */

// 微任务冲刷：openSecondaryEdit 内部 loadEditFile 为 fire-and-forget 异步链（fetch + json
// 各占一拍），足量 tick 后断言读盘结果。
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function behaviorCtx({ plan, fetchImpl } = {}) {
  const calls = { toast: [], renders: 0, saves: [], gets: [] };
  const v = { id: 'BLD-20260924-006' };
  const pf = {
    verId: v.id, phase: 'ready', busy: false, proofBusy: false, seq: 0,
    plan, edit: null, chkFile: null, chkDecisions: null, chkBusy: null,
  };
  const ctx = {
    state: { pf, project: 'proj-x', step: 'docs' },
    selVersion: () => v,
    pfOf: (x) => (x === v ? pf : null),
    toast: (m, e) => calls.toast.push([m, e]),
    render: () => { calls.renders += 1; },
    ensurePublishPlan: async () => {},
    fetch: async (url, opts) => fetchImpl(url, opts, calls),
    copyText: async () => true,
    esc: ESC,
    ...FLOW_STUB,
  };
  return { ctx, calls, pf };
}

function editFns(source) {
  return [
    extractFn(source, 'openSecondaryEdit'),
    extractFn(source, 'loadEditFile'),
    extractFn(source, 'saveEditFile'),
    extractFn(source, 'requestEditSwitch'),
    extractFn(source, 'requestEditRefresh'),
    extractFn(source, 'requestEditClose'),
    extractFn(source, 'resolveEditPending'),
    extractFn(source, 'doEditSwitch'),
    extractFn(source, 'doEditRefresh'),
    extractFn(source, 'closeEditDialog'),
    extractFn(source, 'editUnsaved'),
    extractFn(source, 'focusEditIssue'),
    extractFn(source, 'normalizeFlowEval'),
  ].join('\n');
}

function chkFns(source) {
  return [
    extractFn(source, 'splitProofreadIssues'),
    extractFn(source, 'parseIssueLineNo'),
    extractFn(source, 'parseChkSuggestion'),
    extractFn(source, 'applyChkSuggestion'),
    extractFn(source, 'alreadyAppliedChk'),
    extractFn(source, 'persistChkDecision'),
    extractFn(source, 'chkPendingCount'),
    extractFn(source, 'acceptChkSuggestion'),
    extractFn(source, 'rejectChkSuggestion'),
    extractFn(source, 'normalizeFlowEval'),
  ].join('\n');
}

const DISK_DOC = '# 说明\n部署到生产坏境\n服务可用\n';

function okJson(data) {
  return { ok: true, status: 200, json: async () => data };
}

function errJson(status, error) {
  return { ok: false, status, json: async () => ({ error }) };
}

t('L4-8 二次编辑行为：openSecondaryEdit 读盘；未保存切换 / 刷新 / 关闭先进挂起态不丢字；「保存并继续」成功后执行挂起动作；保存失败不切换不误标', async () => {
  const source = SOURCE();
  const fns = editFns(source);
  const plan = panePlan();
  const { ctx, calls, pf } = behaviorCtx({
    plan,
    fetchImpl: (url, opts, c) => {
      if (url.includes('/api/build/docs/save')) { c.saves.push(JSON.parse(opts.body)); return okJson({ docsFlow: plan.docsFlow }); }
      c.gets.push(url);
      return okJson({ content: DISK_DOC });
    },
  });
  ctx.state.pf = pf; ctx.pfRef = pf;
  // 打开：读盘成功
  await vmRun(fns, ctx, 'openSecondaryEdit()');
  await flush();
  assert.equal(pf.edit.file, 'README.md', '默认打开首个默认语言文件');
  assert.equal(pf.edit.disk, DISK_DOC, '磁盘内容就位');
  // 改草稿 → 未保存
  pf.edit.content = '# 说明\n部署到生产环境（编辑中）\n服务可用\n';
  // 切换文件：挂起保护（不直接切换、内容不丢）
  vmRun(fns, ctx, 'requestEditSwitch("CHANGELOG.md")');

  assert.equal(pf.edit.pending?.kind, 'switch', '切换进挂起态（kind）');
  assert.equal(pf.edit.pending?.file, 'CHANGELOG.md', '切换进挂起态（目标文件）');
  assert.equal(pf.edit.content, '# 说明\n部署到生产环境（编辑中）\n服务可用\n', '草稿未丢');
  // 取消：留在本文件
  vmRun(fns, ctx, 'resolveEditPending("cancel")');
  assert.equal(pf.edit.pending, null, '挂起取消');
  assert.equal(pf.edit.file, 'README.md', '留在本文件');
  // 刷新：挂起保护
  vmRun(fns, ctx, 'requestEditRefresh()');
  assert.equal(pf.edit.pending?.kind, 'refresh', '刷新进挂起态');
  vmRun(fns, ctx, 'resolveEditPending("cancel")');
  // 关闭：挂起保护
  vmRun(fns, ctx, 'requestEditClose()');
  assert.equal(pf.edit.pending?.kind, 'close', '关闭进挂起态');
  vmRun(fns, ctx, 'resolveEditPending("cancel")');
  assert.ok(pf.edit, '取消后弹窗保留');
  // 「保存并继续」切换：保存成功 → disk 回写 → 执行切换
  calls.saves.length = 0;
  vmRun(fns, ctx, 'requestEditSwitch("CHANGELOG.md")');
  await vmRun(fns, ctx, 'resolveEditPending("save")');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(calls.saves.length, 1, '保存请求发出一次');
  assert.equal(calls.saves[0].file, 'README.md', '保存的是原文件');
  assert.equal(pf.edit.file, 'CHANGELOG.md', '保存成功后执行切换');
  assert.equal(pf.edit.pending, null, '挂起清空');
  // 「放弃修改并继续」关闭：不保存直接关
  await vmRun(fns, ctx, 'loadEditFile("CHANGELOG.md")');
  pf.edit.content = '草稿';
  vmRun(fns, ctx, 'requestEditClose()');
  const savesBefore = calls.saves.length;
  vmRun(fns, ctx, 'resolveEditPending("discard")');
  assert.equal(pf.edit, null, '放弃后关闭弹窗');
  assert.equal(calls.saves.length, savesBefore, '放弃不保存');
  // 保存失败：保留输入、不显示已保存、挂起动作不执行
  const bad = behaviorCtx({
    plan: panePlan(),
    fetchImpl: (url, opts, c) => {
      if (url.includes('/api/build/docs/save')) { c.saves.push(JSON.parse(opts.body)); return errJson(500, '磁盘只读'); }
      return okJson({ content: DISK_DOC });
    },
  });
  await vmRun(fns, bad.ctx, 'openSecondaryEdit()');
  await flush();
  bad.pf.edit.content = '新草稿';
  vmRun(fns, bad.ctx, 'requestEditClose()');
  const okClose = await vmRun(fns, bad.ctx, 'resolveEditPending("save")');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(okClose, false, '保存失败返回 false');
  assert.ok(bad.pf.edit, '保存失败弹窗保留');
  assert.equal(bad.pf.edit.content, '新草稿', '保存失败输入保留');
  assert.ok(bad.calls.toast.some(([m, e]) => e && m.includes('保存失败')), '保存失败 toast');
  // 保存成功反馈（savedNote）
  const good = behaviorCtx({
    plan: panePlan(),
    fetchImpl: (url, opts, c) => (url.includes('/api/build/docs/save')
      ? okJson({ docsFlow: panePlan().docsFlow })
      : okJson({ content: DISK_DOC })),
  });
  await vmRun(fns, good.ctx, 'openSecondaryEdit()');
  await flush();
  good.pf.edit.content = '改后';
  const okSave = await vmRun(fns, good.ctx, 'saveEditFile()');
  assert.equal(okSave, true, '保存成功返回 true');
  assert.equal(good.pf.edit.disk, '改后', 'disk 回写为已保存内容');
  assert.ok(good.pf.edit.savedNote && good.pf.edit.savedNote.includes('已保存'), '已保存反馈');
});

t('L4-9 建议接受 / 拒绝行为：未变化 → 定位替换保存成功记已接受（幂等）；磁盘已变化 → 记过期不覆盖；保存失败 → 不误标；拒绝原文不动', async () => {
  const source = SOURCE();
  const fns = chkFns(source);
  const doneRun = {
    runId: 'chk-9', phase: 'done',
    files: { 'README.md': 'pass', 'CHANGELOG.md': 'fail' },
    issues: { 'CHANGELOG.md': '第 2 行：原文「坏境」→ 建议「环境」' },
    counts: { pass: 1, fail: 1, pending: 0, total: 2 },
  };
  // ① 文本未变化：单处替换 + 保存成功 → accepted
  {
    const { ctx, calls, pf } = behaviorCtx({
      plan: panePlan({ docsCheck: doneRun }),
      fetchImpl: (url, opts, c) => {
        if (url.includes('/api/build/docs/save')) { c.saves.push(JSON.parse(opts.body)); return okJson({ docsFlow: panePlan().docsFlow }); }
        return okJson({ content: DISK_DOC });
      },
    });
    await vmRun(fns, ctx, 'acceptChkSuggestion("CHANGELOG.md", 0)');
    await Promise.resolve(); await Promise.resolve();
    assert.equal(calls.saves.length, 1, '保存一次');
    assert.equal(calls.saves[0].file, 'CHANGELOG.md', '保存目标文件');
    assert.equal(calls.saves[0].content, '# 说明\n部署到生产环境\n服务可用\n', '单处替换（第 2 行坏境→环境）');
    assert.equal(pf.chkDecisions['chk-9|CHANGELOG.md|0'], 'accepted', '记已接受');
    // 幂等：重复点击不再发请求
    await vmRun(fns, ctx, 'acceptChkSuggestion("CHANGELOG.md", 0)');
    await Promise.resolve(); await Promise.resolve();
    assert.equal(calls.saves.length, 1, '重复点击不重复应用');
  }
  // ② 磁盘文本已变化：记过期、不保存、不覆盖
  {
    const { ctx, calls, pf } = behaviorCtx({
      plan: panePlan({ docsCheck: doneRun }),
      fetchImpl: (url, opts, c) => {
        if (url.includes('/api/build/docs/save')) { c.saves.push(JSON.parse(opts.body)); return okJson({}); }
        return okJson({ content: '# 说明\n人工已改\n服务可用\n' });
      },
    });
    await vmRun(fns, ctx, 'acceptChkSuggestion("CHANGELOG.md", 0)');
    await Promise.resolve(); await Promise.resolve();
    assert.equal(calls.saves.length, 0, '过期不保存');
    assert.equal(pf.chkDecisions['chk-9|CHANGELOG.md|0'], 'stale', '记过期');
    assert.ok(calls.toast.some(([m, e]) => e && m.includes('建议已过期')), '过期 toast（未覆盖当前内容）');
  }
  // ③ 保存失败：保持待处理、不误标已接受
  {
    const { ctx, calls, pf } = behaviorCtx({
      plan: panePlan({ docsCheck: doneRun }),
      fetchImpl: (url) => (url.includes('/api/build/docs/save') ? errJson(500, '磁盘只读') : okJson({ content: DISK_DOC })),
    });
    await vmRun(fns, ctx, 'acceptChkSuggestion("CHANGELOG.md", 0)');
    await Promise.resolve(); await Promise.resolve();
    assert.equal(pf.chkDecisions['chk-9|CHANGELOG.md|0'], undefined, '保存失败不记已接受');
    assert.ok(calls.toast.some(([m, e]) => e && m.includes('接受失败')), '接受失败 toast（可重试）');
  }
  // ④ 拒绝：原文不动、记已拒绝
  {
    const { ctx, calls, pf } = behaviorCtx({
      plan: panePlan({ docsCheck: doneRun }),
      fetchImpl: () => { throw new Error('不应发请求'); },
    });
    vmRun(fns, ctx, 'rejectChkSuggestion("CHANGELOG.md", 0)');
    assert.equal(pf.chkDecisions['chk-9|CHANGELOG.md|0'], 'rejected', '记已拒绝');
    assert.ok(calls.toast.some(([m]) => m.includes('原文保持不变')), '拒绝反馈');
  }
});

t('L4-10 startTranslation：未处理建议 > 0 阻止（不发翻译请求）并提示数量；全部决断后放行口径不回归；单语言集提示无翻译目标可跳过（不报「尚缺 0 个」）', async () => {
  const source = SOURCE();
  const fns = [
    extractFn(source, 'startTranslation'),
    extractFn(source, 'translateBtnHtml'),
    extractFn(source, 'translateBtnText'),
    extractFn(source, 'normalizeFlowEval'),
    extractFn(source, 'splitProofreadIssues'),
    extractFn(source, 'parseIssueLineNo'),
    extractFn(source, 'parseChkSuggestion'),
    extractFn(source, 'classifyChkIssue'),
    extractFn(source, 'chkPendingCount'),
  ].join('\n');
  const doneRun = {
    runId: 'chk-9', phase: 'done',
    files: { 'README.md': 'pass', 'CHANGELOG.md': 'fail' },
    issues: { 'CHANGELOG.md': '第 12 行：原文「坏境」→ 建议「环境」\n第 37 行：长句建议拆分' },
    counts: { pass: 1, fail: 1, pending: 0, total: 2 },
  };
  // ① 未处理建议 2 条：阻止
  {
    const { ctx, calls } = behaviorCtx({
      plan: panePlan({ docsCheck: doneRun }),
      fetchImpl: () => { throw new Error('不应发翻译请求'); },
    });
    await vmRun(fns, ctx, 'startTranslation()');
    assert.ok(calls.toast.some(([m, e]) => e && m.includes('2 条校对建议未处理')), '提示待处理数量');
    assert.equal(calls.toast.filter(([m]) => m.includes('翻译提示词已复制')).length, 0, '未发翻译请求');
  }
  // ② 全部决断：不因建议门禁阻止（走后续门禁 / 正常路径）
  {
    const { ctx, calls } = behaviorCtx({
      plan: panePlan({ docsCheck: doneRun }),
      fetchImpl: (url, opts, c) => {
        c.gets.push(url);
        return okJson({ prompt: 'P', run: null });
      },
    });
    ctx.state.pf.chkDecisions = { 'chk-9|CHANGELOG.md|0': 'accepted', 'chk-9|CHANGELOG.md|1': 'rejected' };
    await vmRun(fns, ctx, 'startTranslation()');
    assert.ok(!calls.toast.some(([m, e]) => e && m.includes('校对建议未处理')), '决断后不被建议门禁阻止');
  }
  // ③ 单语言集：默认语言全审 + 无剩余语言 → 无翻译目标可跳过（非错误口径）
  {
    const single = panePlan({ langs: ['cn'], customDocs: [] });
    single.docsFlow.restReviewedCount = 0;
    const files = flow.publishDocFiles(['cn'], []).map((f) => ({ ...f, state: 'reviewed' }));
    single.docsFlow = { files, defaultReviewedCount: files.length, restReviewedCount: 0, canFinalize: true, finalized: null, canCommit: false, missing: [], translateMissing: [], canTranslate: false };
    const { ctx, calls } = behaviorCtx({
      plan: single,
      fetchImpl: () => { throw new Error('不应发翻译请求'); },
    });
    await vmRun(fns, ctx, 'startTranslation()');
    const hit = calls.toast.find(([m]) => m.includes('无翻译目标'));
    assert.ok(hit, '单语言提示无翻译目标');
    assert.equal(hit[1], undefined, '非错误口径（可跳过）');
    assert.ok(!calls.toast.some(([m]) => m.includes('尚缺 0 个')), '不再报「尚缺 0 个」');
    // 按钮态：aria-disabled + 无翻译目标 title（无缺口文件清单）
    const btn = vmRun(fns, ctx, 'translateBtnHtml(state.pf)');
    assert.match(btn, /aria-disabled="true"/, '单语言按钮禁用态');
    assert.ok(btn.includes('无翻译目标'), 'title 说明无翻译目标');
  }
  // ④ 多语言默认未审：既有缺口口径不回归
  {
    const plan = panePlan();
    const gapFiles = flow.publishDocFiles(['cn', 'en'], ['MIGRATION']).map((f) => ({ ...f, state: f.lang === 'cn' ? 'summarized' : 'untranslated' }));
    plan.docsFlow = { files: gapFiles, defaultReviewedCount: 0, restReviewedCount: 0, canFinalize: false, canCommit: false, translateMissing: [{ file: 'README.md', state: 'summarized' }] };
    const { ctx } = behaviorCtx({ plan, fetchImpl: () => { throw new Error('不应发翻译请求'); } });
    await vmRun(fns, ctx, 'startTranslation()');
    const btn = vmRun(fns, ctx, 'translateBtnHtml(state.pf)');
    assert.match(btn, /title="[^"]*README\.md/, '缺口 title 保持（默认语言文件清单）');
  }
});

/* ---------- L6 i18n ---------- */

t('L6-1 i18n：五步条 / 二次编辑弹窗 / 校对建议卡片与状态 / 门禁提示 新增文案中英齐备，动态键往返还原，EN 值不与既有词条冲突', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN, EN_DYNAMIC } = I._dict;
  const staticKeys = [
    '五步：', '① AI 总结', '② 二次编辑', '③ AI 校对', '④ AI 翻译', '⑤ 提交', '⑤ 提交中…', '⑤ 已提交 ✓',
    '校对建议', '重试 AI 校对', '过期', '待确认', '已拒绝', '无行号',
    '查看修改前后差异', '修改前（删除）', '修改后（新增）',
    '该文件未发现问题 ✓（校对基准为回执时点磁盘内容）',
    '尚未校对：点击「③ AI 校对」复制提示词并交给 AI Agent 核查，结果自动回显到本栏（链接 / 错别字 / 语法 / 行文规范）。',
    '建议基于的文本已变化：未覆盖当前内容，请重新校对或点「✎ 修改」手动处理。',
    '有未保存的修改：切换文件 / 刷新 / 关闭前会先询问保存或放弃。',
    '保存并继续', '放弃修改并继续', '留在本文件', '保存中…', '重试读取',
    '已保存 ✓（未提交：需审核通过并「提交」后进入本地 dev；默认语言变化会使翻译基准失效）',
    '默认语言初稿编辑（其余语言由「④ AI 翻译」产出）',
    '语言集只有一个语言：无翻译目标，可跳过翻译（直接进行整体审查与提交）',
    '发布流程数据未就绪：请先刷新或重试后再编辑',
    '当前版本没有默认语言文档可编辑',
    '已拒绝该条建议：原文保持不变',
    '✕ 建议已过期：建议基于的文本已变化，未覆盖当前内容（请重新校对或点「✎ 修改」手动处理）',
    '错别字', '链接', '语法', '行文规范',
  ];
  const dynamicKeys = [
    '① 总结中 ◇/◇', '③ 校对中 ◇/◇', '④ 翻译中 ◇/◇', '待处理 ◇ 项', '第 ◇ 行',
    'AI 校对中断：◇', '二次编辑 · 默认语言（◇）', '读取失败：◇',
    'AI 翻译未解锁：尚有 ◇ 条校对建议未处理（逐条接受或拒绝后解锁，见右侧校对建议栏）',
    '✓ 已接受并保存 ◇ 的建议：文件回到待审核，翻译基准已更新',
    '✕ 接受失败：◇（文档未修改，可重试）',
    '✓ 已保存 ◇（未提交：需审核通过并「提交」后进入本地 dev）',
    '✕ 保存失败：◇（内容已保留在编辑框中，可重试）',
  ];
  const missingS = staticKeys.filter((k) => !(k in EN));
  assert.deepEqual(missingS, [], `静态词条缺失：\n${missingS.join('\n')}`);
  const missingD = dynamicKeys.filter((k) => !(k in EN_DYNAMIC));
  assert.deepEqual(missingD, [], `动态词条缺失：\n${missingD.join('\n')}`);
  // 动态键往返还原（插值 → 英文 → 中文）
  I.setLang('en');
  assert.equal(I.t('待处理 3 项'), '3 pending', '待处理计数英文');
  assert.equal(I.t('第 12 行'), 'Line 12', '行号英文');
  assert.equal(I.t('二次编辑 · 默认语言（BLD-1）'), 'Second edit · default language (BLD-1)', '弹窗标题英文');
  I.setLang('zh');
  assert.equal(I.t('待处理 3 项'), '待处理 3 项', '中文还原');
  assert.equal(I.t('第 12 行'), '第 12 行');
  // EN 值唯一（D1e 口径下新增词条不与既有冲突）
  const seen = new Map();
  const dup = [];
  for (const [k, v] of Object.entries(EN)) {
    if (seen.has(v)) dup.push(`${v} ← ${seen.get(v)} | ${k}`);
    else seen.set(v, k);
  }
  assert.deepEqual(dup, [], `EN 值重复：\n${dup.join('\n')}`);
});

/* ---------- 执行 ---------- */

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`✕ ${name}\n${e && e.stack ? e.stack : e}`);
  }
}
if (failed) {
  console.error(`\n${failed} 例失败`);
  process.exit(1);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
