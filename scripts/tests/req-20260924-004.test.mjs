#!/usr/bin/env node
// REQ-20260924-004 整体审核界面的 AI 校对逐项增加修改按钮 —— 分层测试。
// L1 纯逻辑（publish-flow：AI 校对提示词回执格式约束——口径 a 每条一行、行号开头）；
// L4 前端静态契约（build.js：splitProofreadIssues / parseIssueLineNo 纯函数；
//    renderFinalizeModal ③ 项逐条渲染 + 「✎ 修改」按钮；openReview 参数化；
//    editFromProofread 弹层让位；focusReviewIssue 行定位突出）；
// L6 i18n（新增动态键 ◇ · 第 ◇ 行；✎ 修改 词条复用；往返不变形）。
// 用法：node scripts/tests/req-20260924-004.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as flow from '../lib/publish-flow.mjs';
import '../web/i18n.js';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function extractFn(source, name) {
  // 参数列表放宽至 [^)]*（本单 editFromProofread(file, line) 双参；其余既有单测为单参口径）
  const m = source.match(new RegExp(`  function ${name}\\(([^)]*)\\) \\{[\\s\\S]*?\\n  \\}`));
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

const L4_CTX = {
  pfOf: (v) => v.pf,
  esc: (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  short: (h) => String(h || '').slice(0, 8),
  fmtTime: () => 't',
  ...FLOW_STUB,
};

const SOURCE = () => fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');

function finalizeModalFns(source) {
  return [
    extractFn(source, 'normalizeFlowEval'),
    extractFn(source, 'splitProofreadIssues'),
    extractFn(source, 'parseIssueLineNo'),
    extractFn(source, 'renderFinalizeModal'),
  ].join('\n');
}

/* ---------- L1 纯逻辑（publish-flow 提示词） ---------- */

t('L1-1 AI 校对提示词回执格式约束：--issues 每条独立一行、行号开头（口径 a）；清单 / 只读 / 不编造约束保持', () => {
  const p = flow.buildDocProofreadPrompt({
    projectRoot: '/tmp/proj-x', planId: 'BLD-20260924-004', runId: 'chk-20260924-120000-ab01',
    langs: ['cn', 'en'], customDocs: ['MIGRATION'], atbPath: '/tmp/atb.mjs',
  });
  // 口径 a：格式约束进提示词（每条一行 + 行号开头；无行号条目也独立成行）
  assert.ok(p.includes('独立一行') || p.includes('独立成行'), '提示词应约束每条问题独立成行');
  assert.ok(p.includes('行号开头'), '提示词应约束行号开头');
  assert.ok(/第\s*\d+\s*行/.test(p) || p.includes('第 N 行'), '提示词给出回执行号开头示例');
  // 既有约束不回退
  assert.ok(p.includes('chk-20260924-120000-ab01'), '运行参数区保持');
  for (const f of ['README.md', 'MIGRATION.md']) assert.ok(p.includes(f), `校对清单含 ${f}`);
  assert.ok(p.includes('--issues') && p.includes('docscheck file'), '回执命令保持');
  assert.ok(p.includes('不修改') || p.includes('只读'), '只读不改约束保持');
  assert.ok(p.includes('不编造'), '不编造约束保持');
});

/* ---------- L4 纯函数：拆分与行号解析 ---------- */

t('L4-1 splitProofreadIssues：多行拆逐条（trim + 去空行、保序）；无换行整段作单条不丢内容；空文本空数组', () => {
  const fns = [extractFn(SOURCE(), 'splitProofreadIssues')].join('\n');
  const ctx = vm.createContext({});
  vm.runInContext(fns, ctx);
  const run = (expr) => vm.runInContext(expr, ctx);
  const j = (expr) => JSON.stringify(run(expr)); // vm 跨 realm 数组：序列化比对
  // 多行：逐条 + 去空行 + trim + 保序，内容逐字保留
  const multi = '第 12 行：「部署到生产坏境」→ 建议「部署到生产环境」\n\n  第 37 行：「的的生成」→ 建议「的生成」  \r\n第 40 行：长句建议拆分';
  assert.equal(j(`splitProofreadIssues(${JSON.stringify(multi)})`), JSON.stringify([
    '第 12 行：「部署到生产坏境」→ 建议「部署到生产环境」',
    '第 37 行：「的的生成」→ 建议「的生成」',
    '第 40 行：长句建议拆分',
  ]), '多行按行拆分、去空行、trim、保序');
  // 无换行整段：单条整段（不丢内容）
  const single = '第 3 行：错别字「测式」应为「测试」；第 7 行：长句建议拆分';
  assert.equal(j(`splitProofreadIssues(${JSON.stringify(single)})`), JSON.stringify([single]), '整段无换行作单条');
  // 空文本：空数组
  assert.equal(j('splitProofreadIssues("")'), '[]', '空文本空数组');
  assert.equal(j('splitProofreadIssues(null)'), '[]', 'null 安全');
});

t('L4-2 parseIssueLineNo：第 N 行优先；行首 N. / N、 / N: / L N: 次之；无行号返回 null', () => {
  const fns = [extractFn(SOURCE(), 'parseIssueLineNo')].join('\n');
  const ctx = vm.createContext({});
  vm.runInContext(fns, ctx);
  const p = (s) => vm.runInContext(`parseIssueLineNo(${JSON.stringify(s)})`, ctx);
  assert.equal(p('第 12 行：「坏境」→ 建议「环境」'), 12, '第 N 行');
  assert.equal(p('第3行：测式'), 3, '第 N 行无空格');
  assert.equal(p('第 105 行 标点残缺'), 105, '第 N 行（无冒号）');
  assert.equal(p('1. 第 3 行：序号行内也带第 N 行——以第 N 行为准'), 3, '第 N 行优先于行首序号');
  assert.equal(p('7、句尾缺标点'), 7, '行首 N、');
  assert.equal(p('12: colon 开头'), 12, '行首 N:');
  assert.equal(p('L9: L 前缀'), 9, '行首 L N:');
  assert.equal(p('（无行号）：全文语感建议'), null, '无行号条目 null');
  assert.equal(p('长句建议拆分'), null, '无任何数字 null');
  assert.equal(p(''), null, '空串 null');
});

/* ---------- L4 renderFinalizeModal ③ 项逐条渲染 + 修改按钮 ---------- */

function docsCheckRun(issues, files) {
  return {
    runId: 'chk-20260924-120000-ab01', phase: 'done',
    files: files || { 'README.md': 'pass', 'CHANGELOG.md': 'fail', 'FEATURES.md': 'pass', 'AGENTS.md': 'pass', 'MIGRATION.md': 'fail' },
    issues,
    counts: { pass: 3, fail: 2, pending: 0, total: 5 },
  };
}

function finalizePf(docsCheck, extraChecks = null) {
  return {
    finalize: { open: true, busy: false },
    plan: {
      langs: ['cn', 'en'], customDocs: ['MIGRATION'],
      docsFlow: { files: [], defaultReviewedCount: 5, restReviewedCount: 4, canFinalize: true, finalized: null },
      docsCheck,
    },
    ...(extraChecks ? { checks: extraChecks } : {}),
  };
}

t('L4-3 renderFinalizeModal ③ 项：done + fail 按文件分组逐条渲染，每条一行带「✎ 修改」按钮，原文不丢不截断', () => {
  const issues = {
    'CHANGELOG.md': '第 12 行：「部署到生产坏境」→ 建议「部署到生产环境」\n第 37 行：「的的生成」→ 建议「的生成」',
    'MIGRATION.md': '第 8 行：「登陆」→ 建议「登录」',
  };
  const html = vmRun(finalizeModalFns(SOURCE()), L4_CTX, `renderFinalizeModal({ id: 'V', pf: ${JSON.stringify(finalizePf(docsCheckRun(issues)))} })`);
  // 文件分组：fail 文件各一组，pass 文件（README.md）不出问题组
  assert.ok(html.includes('data-proof-edit="README.md"') === false, 'README.md 是 pass：不出现修改按钮');
  const groups = html.match(/<li class="bld-finalize-file">/g) || [];
  assert.equal(groups.length, 2, '两个 fail 文件各一组（CHANGELOG.md 与 MIGRATION.md）');
  assert.ok(html.includes('<code data-i18n-skip>CHANGELOG.md</code>'), '组头文件名 CHANGELOG.md');
  assert.ok(html.includes('<code data-i18n-skip>MIGRATION.md</code>'), '组头文件名 MIGRATION.md（自定义文档）');
  // 每条独立一行：3 条问题行，各带修改按钮（data-proof-edit + data-proof-line + title 摘要）
  const rows = html.match(/<li class="bld-finalize-issue">/g) || [];
  assert.equal(rows.length, 3, '3 条问题各占一行');
  assert.ok(html.includes('data-proof-edit="CHANGELOG.md" data-proof-line="12"'), 'CHANGELOG.md 第 12 行按钮带行号');
  assert.ok(html.includes('data-proof-edit="CHANGELOG.md" data-proof-line="37"'), 'CHANGELOG.md 第 37 行按钮带行号');
  assert.ok(html.includes('data-proof-edit="MIGRATION.md" data-proof-line="8"'), 'MIGRATION.md 第 8 行按钮带行号');
  assert.match(html, /title="CHANGELOG\.md · 第 12 行"/, '按钮 title 摘要（文件 + 行号）');
  assert.equal((html.match(/data-proof-edit=/g) || []).length, 3, '修改按钮恰好 3 个');
  // 回执原文逐字保留（不丢、不截断）
  for (const frag of ['「部署到生产坏境」→ 建议「部署到生产环境」', '「的的生成」→ 建议「的生成」', '「登陆」→ 建议「登录」']) {
    assert.ok(html.includes(frag), `问题原文保留：${frag.slice(0, 10)}…`);
  }
  // 同文件多条按回执顺序排列（12 在 37 前）
  assert.ok(html.indexOf('data-proof-line="12"') < html.indexOf('data-proof-line="37"'), '同文件多条保序');
  // 按钮文案（复用既有词条 ✎ 修改 → ✎ Edit）
  assert.ok((html.match(/>✎ 修改</g) || []).length === 3, '3 个按钮文案「✎ 修改」');
});

t('L4-4 renderFinalizeModal ③ 项：整段 issues 作一条；无行号条目按钮文件级跳转；未运行 / 进行中 / 中断 / 全 pass 无修改按钮', () => {
  const source = SOURCE();
  const fns = finalizeModalFns(source);
  // 整段（无换行、分号连排）：作一条展示不丢内容；含可解析行号仍带行号跳转
  const single = '第 3 行：错别字「测式」应为「测试」；第 7 行：长句建议拆分';
  const html1 = vmRun(fns, L4_CTX, `renderFinalizeModal({ id: 'V', pf: ${JSON.stringify(finalizePf(docsCheckRun({ 'CHANGELOG.md': single }, { 'README.md': 'pass', 'CHANGELOG.md': 'fail', 'FEATURES.md': 'pass', 'AGENTS.md': 'pass' })))} })`);
  assert.equal((html1.match(/<li class="bld-finalize-issue">/g) || []).length, 1, '整段作一条');
  assert.ok(html1.includes(single), '整段内容逐字保留');
  assert.ok(html1.includes('data-proof-edit="CHANGELOG.md" data-proof-line="3"'), '整段含行号仍定位（取首个可解析行号）');
  // 无行号条目（行首「（无行号）：」）：按钮无 data-proof-line（文件级跳转），title 仅文件名
  const noLine = '（无行号）：全文「的的」堆叠语感建议通读修正';
  const html1b = vmRun(fns, L4_CTX, `renderFinalizeModal({ id: 'V', pf: ${JSON.stringify(finalizePf(docsCheckRun({ 'CHANGELOG.md': noLine }, { 'README.md': 'pass', 'CHANGELOG.md': 'fail', 'FEATURES.md': 'pass', 'AGENTS.md': 'pass' })))} })`);
  assert.equal((html1b.match(/<li class="bld-finalize-issue">/g) || []).length, 1, '无行号条目作一条');
  assert.ok(html1b.includes(noLine), '无行号条目内容保留');
  assert.match(html1b, /data-proof-edit="CHANGELOG\.md"(?![^>]*data-proof-line)/, '按钮无行号（文件级跳转）');
  assert.match(html1b, /title="CHANGELOG\.md"/, '无行号 title 仅文件名');
  // 未运行 / 进行中 / 中断 / 全 pass：均无修改按钮
  const base = { finalize: { open: true, busy: false }, plan: { langs: ['cn', 'en'], docsFlow: { files: [], defaultReviewedCount: 4, restReviewedCount: 4 } } };
  const notRun = vmRun(fns, L4_CTX, `renderFinalizeModal({ id: 'V', pf: ${JSON.stringify(base)} })`);
  assert.ok(!notRun.includes('data-proof-edit'), '未运行无修改按钮');
  const running = vmRun(fns, L4_CTX, `renderFinalizeModal({ id: 'V', pf: ${JSON.stringify({ ...base, plan: { ...base.plan, docsCheck: { runId: 'chk-1', phase: 'running', files: { 'README.md': 'pass', 'CHANGELOG.md': 'fail' }, issues: { 'CHANGELOG.md': '第 2 行：xx' }, counts: { pass: 1, fail: 1, pending: 2, total: 4 }, currentFile: 'FEATURES.md' } } })} })`);
  assert.ok(running.includes('校对进行中'), '进行中提示保持');
  assert.ok(!running.includes('data-proof-edit'), '进行中无修改按钮（即使已有 fail 回执）');
  const interrupted = vmRun(fns, L4_CTX, `renderFinalizeModal({ id: 'V', pf: ${JSON.stringify({ ...base, plan: { ...base.plan, docsCheck: { runId: 'chk-1', phase: 'failed', files: { 'README.md': 'pass' }, issues: {}, counts: { pass: 1, fail: 0, pending: 3, total: 4 }, reason: '网络中断' } } })} })`);
  assert.ok(interrupted.includes('AI 校对中断'), '中断原因态保持');
  assert.ok(!interrupted.includes('data-proof-edit'), '中断无修改按钮');
  const allPass = vmRun(fns, L4_CTX, `renderFinalizeModal({ id: 'V', pf: ${JSON.stringify({ ...base, plan: { ...base.plan, docsCheck: { runId: 'chk-1', phase: 'done', files: { 'README.md': 'pass', 'CHANGELOG.md': 'pass', 'FEATURES.md': 'pass', 'AGENTS.md': 'pass' }, issues: {}, counts: { pass: 4, fail: 0, pending: 0, total: 4 } } } })} })`);
  assert.ok(allPass.includes('通过 4/4'), '全 pass 通过计数');
  assert.ok(!allPass.includes('data-proof-edit'), '全 pass 无修改按钮');
});

t('L4-8 修改不改门禁：①② 检查区、顶层 3 条检查项、取消 / 确认完结按钮在逐条渲染下保持（003 契约回归）', () => {
  const issues = { 'CHANGELOG.md': '第 3 行：「测式」→ 建议「测试」' };
  const html = vmRun(finalizeModalFns(SOURCE()), L4_CTX, `renderFinalizeModal({ id: 'V', pf: ${JSON.stringify(finalizePf(docsCheckRun(issues, { 'README.md': 'pass', 'CHANGELOG.md': 'fail', 'FEATURES.md': 'pass', 'AGENTS.md': 'pass' }), { busy: false, error: null, lang: { ok: true, files: [{ file: 'README.md', ok: true, detail: '' }] }, links: { ok: true, deadTotal: 0, files: [{ file: 'README.md', total: 2, dead: [] }] } }))} })`);
  const rows = (html.match(/<li><span class="st /g) || []).length;
  assert.equal(rows, 3, '顶层检查行仍 3 条');
  for (const item of ['各语言内容语义一致（以已审核默认语言为基准）', '所有文档内链接真实可达', '默认语言错别字与行文规范（AI 校对自动上报）']) {
    assert.ok(html.includes(item), `检查项保持：${item.slice(0, 10)}…`);
  }
  assert.ok(html.includes('data-pf-checks') && html.includes('data-pf-proofread'), '两动作按钮保持');
  assert.ok(html.includes('data-pf-finalize-cancel') && html.includes('data-pf-finalize-confirm'), '取消 / 确认完结保持');
});

/* ---------- L4 行为：openReview 参数化 / editFromProofread / focusReviewIssue ---------- */

function behaviorCtx() {
  const calls = { toast: [], render: 0, load: [], focus: 0, gates: [] };
  const v = { id: 'BLD-20260924-004', pf: null };
  const ctx = {
    state: { pf: null },
    selVersion: () => v,
    pfOf: (x) => (x === v ? v.pf : null),
    docFilesOf: FLOW_STUB.docFilesOf,
    DEFAULT_DOC_LANGS: FLOW_STUB.DEFAULT_DOC_LANGS,
    esc: L4_CTX.esc,
    toast: (m, e) => calls.toast.push([m, e]),
    render: () => { calls.render += 1; },
    // 加载门：openReview 内部 loadReviewPair(key).then(focusReviewIssue) 链在门放行前
    // 不消费 pendingFocus——断言跳转状态后放行验证链路（浏览器中即内容加载完成后定位）。
    loadReviewPair: (key) => {
      calls.load.push(key);
      return new Promise((resolve) => calls.gates.push(resolve));
    },
    focusReviewIssue: () => { calls.focus += 1; },
    $: () => null,
    getComputedStyle: () => ({ lineHeight: '20px' }),
    setTimeout: (fn) => { fn(); },
    ...FLOW_STUB,
  };
  v.pf = {
    verId: v.id, phase: 'ready', plan: { langs: ['cn', 'en'], customDocs: ['MIGRATION'] },
    review: null, finalize: null,
  };
  ctx.state.pf = v.pf;
  return { ctx, calls, v };
}

function behaviorFns(source) {
  return [
    extractFn(source, 'openReview'),
    extractFn(source, 'editFromProofread'),
    extractFn(source, 'focusReviewIssue'),
  ].join('\n');
}

t('L4-5 openReview 参数化：无参 = README 页签全栏预览（现状不变）；带 file/line = 切对应页签、目标栏编辑态、pendingFocus；非法行号归 null', async () => {
  const { ctx, calls, v } = behaviorCtx();
  // 无参：现状不变
  await vmRun(behaviorFns(SOURCE()), ctx, 'openReview()');
  assert.equal(v.pf.review.key, 'README', '无参默认 README 页签');
  assert.ok(Object.values(v.pf.review.modes).every((m) => m === 'preview'), '全栏预览态');
  assert.ok(!v.pf.review.pendingFocus, '无 pendingFocus');
  assert.deepEqual(calls.load, ['README'], '加载 README 页签');
  // 带 file + line：切页签 + 目标栏编辑态 + 其余预览 + pendingFocus（vm 跨 realm 对象按字段断言）
  await vmRun(behaviorFns(SOURCE()), ctx, 'openReview({ file: "CHANGELOG.md", line: 12 })');
  assert.equal(v.pf.review.key, 'CHANGELOG', '切到 CHANGELOG 页签');
  assert.equal(v.pf.review.modes['CHANGELOG.md'], 'edit', '目标默认语言栏编辑态');
  assert.equal(v.pf.review.modes['CHANGELOG_en.md'], 'preview', '其余栏预览不受影响');
  assert.equal(v.pf.review.pendingFocus?.file, 'CHANGELOG.md', 'pendingFocus 文件');
  assert.equal(v.pf.review.pendingFocus?.line, 12, 'pendingFocus 行号');
  assert.deepEqual(calls.load[calls.load.length - 1], 'CHANGELOG', '加载目标页签');
  // 自定义文档：切到 KEY 页签
  await vmRun(behaviorFns(SOURCE()), ctx, 'openReview({ file: "MIGRATION.md", line: 3 })');
  assert.equal(v.pf.review.key, 'MIGRATION', '自定义文档切到 KEY 页签');
  assert.equal(v.pf.review.modes['MIGRATION.md'], 'edit');
  assert.equal(v.pf.review.pendingFocus?.file, 'MIGRATION.md');
  assert.equal(v.pf.review.pendingFocus?.line, 3);
  // 非法 / 缺省行号归 null；不存在的文件回落 README
  await vmRun(behaviorFns(SOURCE()), ctx, 'openReview({ file: "FEATURES.md", line: "abc" })');
  assert.equal(v.pf.review.pendingFocus?.file, 'FEATURES.md');
  assert.equal(v.pf.review.pendingFocus?.line, null, '非法行号归 null');
  await vmRun(behaviorFns(SOURCE()), ctx, 'openReview({ file: "NOPE.md" })');
  assert.equal(v.pf.review.key, 'README', '未知文件回落默认页签');
  assert.ok(!v.pf.review.pendingFocus, '未知文件不定位');
  // 门放行：内容加载完成链路触发 focusReviewIssue（消费 pendingFocus，不悬挂不报错）
  for (const g of calls.gates) g();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(v.pf.review.pendingFocus, undefined, '加载完成后 pendingFocus 消费不悬挂');
});

t('L4-6 editFromProofread：先关闭整体审查对话框再打开审查对话框；finalize.busy 不放行；未就绪不动作', async () => {
  const source = SOURCE();
  // 正常态：finalize open → 关闭 + 打开 review 定位目标
  {
    const { ctx, v } = behaviorCtx();
    v.pf.finalize = { open: true, busy: false };
    await vmRun(behaviorFns(source), ctx, 'editFromProofread("CHANGELOG.md", "12")');
    assert.equal(v.pf.finalize, null, '整体审查对话框已关闭');
    assert.equal(v.pf.review.key, 'CHANGELOG', '审查对话框切到目标页签');
    assert.equal(v.pf.review.modes['CHANGELOG.md'], 'edit', '目标栏编辑态');
    assert.equal(v.pf.review.pendingFocus?.file, 'CHANGELOG.md');
    assert.equal(v.pf.review.pendingFocus?.line, 12);
  }
  // busy：确认完结请求进行中不让位
  {
    const { ctx, v } = behaviorCtx();
    v.pf.finalize = { open: true, busy: true };
    await vmRun(behaviorFns(source), ctx, 'editFromProofread("CHANGELOG.md", "12")');
    assert.deepEqual(v.pf.finalize, { open: true, busy: true }, 'busy 不关闭');
    assert.equal(v.pf.review, null, 'busy 不打开审查对话框');
  }
  // finalize 未开（直调）：也可打开（幂等）
  {
    const { ctx, v } = behaviorCtx();
    await vmRun(behaviorFns(source), ctx, 'editFromProofread("MIGRATION.md", "8")');
    assert.equal(v.pf.review.key, 'MIGRATION', '无 finalize 时直接打开');
  }
  // 数据未就绪：不动作
  {
    const { ctx, v } = behaviorCtx();
    v.pf.phase = 'loading';
    v.pf.finalize = { open: true, busy: false };
    await vmRun(behaviorFns(source), ctx, 'editFromProofread("CHANGELOG.md", "12")');
    assert.deepEqual(v.pf.finalize, { open: true, busy: false }, '未就绪不动 finalize');
    assert.equal(v.pf.review, null, '未就绪不打开 review');
  }
});

t('L4-7 focusReviewIssue：行号选区该行首尾 + 滚动居中 + 短暂描边；超界收敛末行；无行号 / 空内容只聚焦；一次性消费', async () => {
  const source = SOURCE();
  const mkBox = (value, clientHeight = 400) => {
    const calls = { sel: [], focus: 0, cls: [] };
    return {
      value, clientHeight, scrollTop: 0,
      focus: () => { calls.focus += 1; },
      setSelectionRange: (a, b) => { calls.sel.push([a, b]); },
      classList: { add: (c) => calls.cls.push(['add', c]), remove: (c) => calls.cls.push(['remove', c]) },
      __calls: calls,
    };
  };
  const lines = Array.from({ length: 20 }, (_, i) => `line-${i + 1}`);
  const value = lines.join('\n');
  // 行号 12：选区 = 第 12 行首尾（偏移累计），滚动居中，描边类先加后移
  {
    const box = mkBox(value);
    const { ctx, v } = behaviorCtx();
    ctx.$ = () => box;
    v.pf.review = { open: true, key: 'CHANGELOG', pendingFocus: { file: 'CHANGELOG.md', line: 12 } };
    vmRun(behaviorFns(source), ctx, 'focusReviewIssue()');
    let start = 0;
    for (let i = 0; i < 11; i++) start += lines[i].length + 1;
    assert.deepEqual(box.__calls.sel, [[start, start + lines[11].length]], '选区第 12 行首尾');
    assert.equal(box.__calls.focus, 1, '聚焦');
    assert.ok(box.scrollTop > 0, '滚动定位');
    assert.ok(box.__calls.cls.some(([, c]) => c === 'bld-review-focus-flash' && true), '加描边类');
    assert.ok(v.pf.review.pendingFocus == null, '一次性消费');
  }
  // 行号超界（999）：收敛末行（第 20 行）
  {
    const box = mkBox(value);
    const { ctx, v } = behaviorCtx();
    ctx.$ = () => box;
    v.pf.review = { open: true, key: 'CHANGELOG', pendingFocus: { file: 'CHANGELOG.md', line: 999 } };
    vmRun(behaviorFns(source), ctx, 'focusReviewIssue()');
    let start = 0;
    for (let i = 0; i < 19; i++) start += lines[i].length + 1;
    assert.deepEqual(box.__calls.sel, [[start, start + lines[19].length]], '收敛末行');
  }
  // 无行号：只聚焦不选区
  {
    const box = mkBox(value);
    const { ctx, v } = behaviorCtx();
    ctx.$ = () => box;
    v.pf.review = { open: true, key: 'CHANGELOG', pendingFocus: { file: 'CHANGELOG.md', line: null } };
    vmRun(behaviorFns(source), ctx, 'focusReviewIssue()');
    assert.deepEqual(box.__calls.sel, [], '无行号不选区');
    assert.equal(box.__calls.focus, 1, '仍聚焦（打开编辑态）');
  }
  // 空内容（读取失败兜底）：只聚焦
  {
    const box = mkBox('');
    const { ctx, v } = behaviorCtx();
    ctx.$ = () => box;
    v.pf.review = { open: true, key: 'CHANGELOG', pendingFocus: { file: 'CHANGELOG.md', line: 5 } };
    vmRun(behaviorFns(source), ctx, 'focusReviewIssue()');
    assert.deepEqual(box.__calls.sel, [], '空内容不选区');
  }
  // 目标不在 DOM：安全返回仍消费
  {
    const { ctx, v } = behaviorCtx();
    ctx.$ = () => null;
    v.pf.review = { open: true, key: 'CHANGELOG', pendingFocus: { file: 'CHANGELOG.md', line: 5 } };
    vmRun(behaviorFns(source), ctx, 'focusReviewIssue()');
    assert.ok(v.pf.review.pendingFocus == null, '不在 DOM 也一次性消费不悬挂');
  }
});

/* ---------- L6 i18n ---------- */

t('L6-1 i18n：新增动态键「◇ · 第 ◇ 行」齐备；「✎ 修改」词条复用；title 摘要英文翻译往返还原', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN, EN_DYNAMIC } = I._dict;
  assert.ok('◇ · 第 ◇ 行' in EN_DYNAMIC, '动态键 ◇ · 第 ◇ 行 缺失');
  assert.equal(EN_DYNAMIC['◇ · 第 ◇ 行'], '$1 · line $2');
  assert.equal(EN['✎ 修改'], '✎ Edit', '按钮文案复用既有词条');
  I.setLang('en');
  assert.equal(I.t('CHANGELOG.md · 第 12 行'), 'CHANGELOG.md · line 12', 'title 摘要英文翻译');
  assert.equal(I.t('✎ 修改'), '✎ Edit', '按钮文案英文');
  I.setLang('zh');
  assert.equal(I.t('CHANGELOG.md · 第 12 行'), 'CHANGELOG.md · 第 12 行', '中文还原');
  assert.equal(I.t('✎ 修改'), '✎ 修改');
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
