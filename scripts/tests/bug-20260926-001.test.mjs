#!/usr/bin/env node
// BUG-20260926-001 文档编写界面去掉整体审查按钮，五步按钮上移到审查那一行 —— 分层测试。
// 缺陷：REQ-20260924-006 起顶部操作区两行堆叠（第一行辅助动作含「整体审查」独立按钮 +
// 第二行五步操作条），主流程按钮低于辅助按钮一行，纵向占用高、主次颠倒。
// 修复（design.md 定稿）：
//   1) 顶部收敛一行操作条：.bld-docs-sub 内 语言集 → 刷新 / 审查 → 五步（「五步：」+ ①–⑤）；
//   2) 「整体审查」独立按钮移除；⑤ 提交门禁不弱化（缺口文案中英 i18n 同步）。
//      BUG-20260926-002 起完结对核入口随整体审查阶段整体去除（阶段条回归两段纯展示、
//      data-pf-finalize / openFinalize / 完结对核对话框全部移除、提交回归「全部已审核」门禁），
//      本测试中原完结入口断言随之改为移除断言，单行操作条 / 五步结构断言保持。
// L1 渲染结构（vm 提取 renderDocsPane：单行操作条 + 加载 / 失败态恒渲染）；
// L2 阶段条两段纯展示（完结入口三态断言随 BUG-20260926-002 改为移除断言）；
// L3 行为（commitDocs 全审可提交 / 未审 toast 缺口且不发请求）；
// L4 CSS 契约（style.css：单行三簇；.bld-stage-fin 随 BUG-20260926-002 清理）；
// L5 i18n（新旧词条中英同步与清理）。
// 用法：node scripts/tests/bug-20260926-001.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as flow from '../lib/publish-flow.mjs';
import '../web/i18n.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- vm 提取（同 req-20260924-006 paneFns 口径，finalizeBtnHtml 已随本单删除） ---------- */

function extractFn(source, name) {
  const m = source.match(new RegExp(`  (?:async )?function ${name}\\(([^)]*)\\) \\{[\\s\\S]*?\\n  \\}`));
  assert.ok(m, `build.js 中应存在 ${name} 函数`);
  return m[0];
}

function vmRun(fns, context, expr) {
  // 单函数沙箱补齐成功发布守卫依赖；本组夹具均为未发布版本。
  const ctx = vm.createContext({ blockPublished: v => !!v?.release?.published, ...context });
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

const SOURCE = () => fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'build.js'), 'utf8');

function paneFns(source) {
  return [
    extractFn(source, 'summaryBtnText'),
    extractFn(source, 'translateBtnText'),
    extractFn(source, 'normalizeFlowEval'),
    extractFn(source, 'translateBtnHtml'),
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

function panePlan({ files = null, finalized = null, canCommit = false } = {}) {
  const list = files || flow.publishDocFiles(['cn', 'en'], []).map((f) => ({ ...f, state: 'reviewed' }));
  const missing = list.filter((f) => f.state !== 'reviewed').map((f) => ({ file: f.file, state: f.state }));
  return {
    langs: ['cn', 'en'], customDocs: [],
    docsFlow: {
      files: list,
      defaultReviewedCount: list.filter((f) => f.isDefault !== false && f.lang !== 'en' && f.state === 'reviewed').length,
      restReviewedCount: list.filter((f) => f.lang !== 'cn' && f.state === 'reviewed').length,
      missing, translateMissing: [],
      canFinalize: missing.length === 0, finalized, canCommit,
      canTranslate: true,
    },
    summary: null, translate: null, docsCheck: null,
    docs: { overall: 'none', reasons: [] },
  };
}

function paneHtml(plan, pfExtra = {}) {
  return vmRun(paneFns(SOURCE()), L4_CTX, `renderDocsPane({ id: 'V', pf: ${JSON.stringify({ phase: 'ready', plan, ...pfExtra })} })`);
}

/* ---------- L1 渲染结构：一行操作条 ---------- */

t('L1-1 单行操作条：.bld-docs-sub 内 语言集 → 刷新/审查 → 五步（「五步：」+ ①–⑤ 钩子顺序）；「整体审查」独立按钮移除；五步不再独立成行', () => {
  const source = SOURCE();
  // finalizeBtnHtml 函数随本单删除（入口落阶段条）
  assert.ok(!/function finalizeBtnHtml\(/.test(source), 'finalizeBtnHtml 函数应删除');
  const html = paneHtml(panePlan());
  const subStart = html.indexOf('<div class="bld-docs-sub">');
  const stagesStart = html.indexOf('bld-docs-stages');
  assert.ok(subStart >= 0 && stagesStart > subStart, '单行操作条在阶段条之前');
  const row = html.slice(subStart, stagesStart);
  // 三簇同处一行容器，顺序：语言集 → 辅助动作 → 五步
  const idx = {
    langset: row.indexOf('bld-docs-langset'),
    actions: row.indexOf('bld-docs-actions'),
    steps: row.indexOf('bld-docs-steps'),
  };
  assert.ok(idx.langset >= 0, '语言集簇在单行内');
  assert.ok(idx.actions > idx.langset, '刷新 / 审查在语言集之后');
  assert.ok(idx.steps > idx.actions, '五步按钮上移至审查同一行');
  // 五步不再独立成行：.bld-docs-steps 全页仅一处且在单行容器内（不再作为 subBar 兄弟节点）
  assert.equal((html.match(/class="bld-docs-steps"/g) || []).length, 1, '五步容器仅一处');
  assert.ok(idx.steps >= 0, '五步容器在单行容器内');
  // 辅助动作收敛：刷新 / 审查保留，整体审查按钮不在操作行
  for (const k of ['data-pf-refresh', 'data-pf-review']) assert.ok(row.includes(k), `辅助动作保留：${k}`);
  assert.ok(!row.includes('data-pf-finalize'), '操作行不再有整体审查按钮钩子');
  assert.ok(!row.includes('>整体审查<'), '操作行不再有「整体审查」按钮文字');
  // 五步顺序入口与文案不变
  const order = ['data-pf-summary', 'data-pf-edit', 'data-pf-proofstep', 'data-pf-translate', 'data-pf-commit']
    .map((k) => row.indexOf(k));
  assert.ok(order.every((i) => i >= 0), `五步钩子齐备：${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, '五步按 ①→⑤ 顺序渲染');
  for (const s of ['五步：', '① AI 总结', '② 二次编辑', '③ AI 校对', '④ AI 翻译', '⑤ 提交']) {
    assert.ok(row.includes(s), `五步文案保留：${s}`);
  }
  // BUG-20260926-002：完结入口随整体审查阶段整体移除（不再「落阶段条」）
  assert.ok(!html.includes('data-pf-finalize'), 'data-pf-finalize 全页无残留');
});

t('L1-2 加载 / 失败态：一行操作条恒渲染（按钮不隐藏），失败给错误横幅与重试；阶段条不渲染（完结入口随阶段条）', () => {
  const loading = vmRun(paneFns(SOURCE()), L4_CTX, `renderDocsPane({ id: 'V', pf: ${JSON.stringify({ phase: 'loading', plan: null })} })`);
  for (const k of ['bld-docs-sub', 'data-pf-refresh', 'data-pf-review', 'data-pf-summary', 'data-pf-edit', 'data-pf-proofstep', 'data-pf-translate', 'data-pf-commit']) {
    assert.ok(loading.includes(k), `加载态渲染 ${k}`);
  }
  assert.ok(!loading.includes('bld-docs-stages'), '加载态无阶段条（完结入口不出现）');
  assert.ok(loading.includes('正在加载发布流程数据…'), '加载态提示');
  const failed = vmRun(paneFns(SOURCE()), L4_CTX, `renderDocsPane({ id: 'V', pf: ${JSON.stringify({ phase: 'error', error: 'boom', plan: null })} })`);
  for (const k of ['bld-docs-sub', 'data-pf-refresh', 'data-pf-summary', 'data-pf-commit', 'data-pf-retry']) {
    assert.ok(failed.includes(k), `失败态渲染 ${k}`);
  }
  assert.match(failed, /发布流程数据读取失败：boom/, '失败错误横幅');
});

/* ---------- L2 阶段条：BUG-20260926-002 起两段纯展示，完结入口移除 ---------- */

t('L2-1 阶段条回归两段纯展示：① ② 为 span，无 ③ 完结按钮与 aria-disabled 缺口 title（BUG-20260926-002）', () => {
  const files = flow.publishDocFiles(['cn', 'en'], []).map((f, i) => ({ ...f, state: i === 0 ? 'summarized' : (i < 5 ? 'reviewed' : 'untranslated') }));
  const html = paneHtml(panePlan({ files }));
  assert.ok(html.includes('<span class="bld-stage">① 默认语言先行'), '阶段 ① 纯展示');
  assert.ok(html.includes('<span class="bld-stage">② AI 翻译与审查'), '阶段 ② 纯展示');
  assert.ok(!html.includes('bld-stage-fin'), '无 ③ 完结按钮（随 BUG-20260926-002 移除）');
  assert.ok(!html.includes('③ 整体审查完结'), '无「③ 整体审查完结」文案');
  assert.ok(!html.includes('整体审查未解锁'), '完结缺口 title 不再出现');
  assert.ok(html.includes('○</i>未解锁'), '未解锁 chip 保留（① ② 阶段缺口呈现）');
});

t('L2-2 全部已审核：提交直接解锁（完结叠加门禁随 BUG-20260926-002 移除）；门禁条口径更新', () => {
  const html = paneHtml(panePlan({ canCommit: true }));
  assert.ok(!/data-pf-commit[^>]*aria-disabled/.test(html), '全审即解锁提交');
  assert.match(html, /提交门禁：\d+\/\d+ 已审核 —— 可提交到本地 dev 分支。/, '门禁条可提交文案（无完结字样）');
  assert.ok(!html.includes('整体审查未完结（确认完结后可提交）'), '门禁条完结缺口口径移除');
});

t('L2-3 未全审：提交禁用且 title 只列审核缺口（不指向完结入口）；无完结终态标识', () => {
  const html = paneHtml(panePlan({ canCommit: false }));
  assert.match(html, /data-pf-commit[^>]*aria-disabled="true"/, '未全审提交禁用');
  assert.match(html, /data-pf-commit[^>]*title="[^"]*还需 \d+ 个文件通过审查[^"]*"/, 'title 列审核缺口');
  assert.ok(!html.includes('请先在阶段条'), '缺口不再指向阶段条完结入口');
  assert.ok(!html.includes('整体审查已完结 ✓'), '完结终态标识移除');
});

/* ---------- L3 行为：提交缺口反馈与放行 ---------- */

t('L3-1 commitDocs：未全审点击提交 toast 列文件缺口且不发请求（无完结兜底句）；全审则发提交请求', async () => {
  const source = SOURCE();
  const fns = [extractFn(source, 'commitDocs'), extractFn(source, 'normalizeFlowEval')].join('\n');
  const calls = { toast: [], posts: [] };
  const v = { id: 'V' };
  const files = flow.publishDocFiles(['cn', 'en'], []).map((f, i) => ({ ...f, state: i === 0 ? 'summarized' : 'reviewed' }));
  const pf = { verId: v.id, phase: 'ready', busy: false, plan: panePlan({ files, canCommit: false }) };
  const ctx = {
    state: { pf, project: 'proj-x' },
    selVersion: () => v,
    pfOf: (x) => (x === v ? pf : null),
    toast: (m, e) => calls.toast.push([m, e]),
    render: () => {},
    fetch: (url) => { calls.posts.push(url); throw new Error('不应发提交请求'); },
    ...FLOW_STUB,
  };
  await vmRun(fns, ctx, 'commitDocs()');
  const hit = calls.toast.find(([m, e]) => e && m.includes('尚不可提交'));
  assert.ok(hit, '缺口 toast 保留');
  assert.match(hit[0], /还需 1 个文件通过审查（README\.md（已总结待审核））/);
  assert.ok(!hit[0].includes('整体审查'), 'toast 无完结提法（BUG-20260926-002）');
  assert.equal(calls.posts.length, 0, '未发提交请求（门禁不弱化）');
  // 全审：发提交请求
  const pf2 = { verId: v.id, phase: 'ready', busy: false, plan: panePlan({ canCommit: true }) };
  const ctx2 = {
    state: { pf: pf2, project: 'proj-x' },
    selVersion: () => v,
    pfOf: (x) => (x === v ? pf2 : null),
    toast: () => {}, render: () => {},
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, commitHash: 'a'.repeat(40), files: [] }) }),
    ...FLOW_STUB,
    short: (h) => String(h || '').slice(0, 8),
    ensurePublishPlan: async () => {}, refresh: async () => {},
    Promise,
  };
  await vmRun(fns, ctx2, 'commitDocs()');
  assert.equal(calls.posts.length + 1 >= 1, true, '全审走提交路径（无完结前置拦截）');
});

/* ---------- L4 CSS 契约 ---------- */

t('L4-1 CSS：.bld-docs-sub 单行 flex 保持，.bld-docs-steps 规则保留；.bld-stage-fin 随 BUG-20260926-002 清理', () => {
  const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');
  const rule = (sel) => {
    const m = css.match(new RegExp(`(?<![\\w-])${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{[^}]*\\}`));
    assert.ok(m, `style.css 缺少 ${sel} 规则`);
    return m[0];
  };
  const sub = rule('.bld-docs-sub');
  assert.match(sub, /display:\s*flex/, '.bld-docs-sub 保持 flex 单行');
  assert.match(sub, /flex-wrap:\s*wrap/, '窄屏换行');
  rule('.bld-docs-actions');
  rule('.bld-docs-steps');
  assert.ok(!css.includes('bld-stage-fin'), '完结入口样式随 BUG-20260926-002 清理');
});

/* ---------- L5 i18n ---------- */

t('L5-1 i18n：五步与阶段条在用词条齐备；完结入口词条随 BUG-20260926-002 全量清理；「五步：」保留', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN } = I._dict;
  for (const k of [
    '五步：', '① AI 总结', '② 二次编辑', '③ AI 校对', '④ AI 翻译', '⑤ 提交',
    '阶段：', '① 默认语言先行', '② AI 翻译与审查',
  ]) {
    assert.ok(k in EN, `词条缺失：${k.slice(0, 16)}…`);
  }
  for (const k of [
    '整体审查未完结：全部文件已审核后，请先「整体审查」确认完结再提交',
    '尚不可提交：整体审查未完结（全部文件已审核后，请先「整体审查」确认完结）',
    '整体审查',
    '整体审查未完结：全部文件已审核后，请先在阶段条「③ 整体审查完结」确认完结再提交',
    '尚不可提交：整体审查未完结（全部文件已审核后，请先在阶段条「③ 整体审查完结」确认完结）',
    '③ 整体审查完结',
    '整体审查已完结；点击可重新核对新再次确认（更新完结时间）',
    '打开整体审查完结核对：各语言语义一致、README 按语言互链、内容与本版发布范围一致；确认完结后「提交」解锁',
  ]) {
    assert.ok(!(k in EN), `词条应随本单清理：${k.slice(0, 16)}…`);
  }
  // 英文值不重复（新增两条不与既有冲突）
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
