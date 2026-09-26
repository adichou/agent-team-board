#!/usr/bin/env node
// BUG-20260926-002 文档编写去除「整体审查」阶段 —— 分层测试。
// 缺陷：REQ-20260921-012 三阶段模型在「全部已审核」之上叠加「整体审查完结」人工确认与
// 提交门禁（canCommit = canFinalize && 完结有效），完结不修改内容、自动检查只读不设门禁，
// 属流程冗余（REQ-20260924-001 自动检查宿主完结对核对话框）。
// 修复（design.md 定稿）：
//   1) 门禁回归 REQ-20260921-008 原「全部已审核」口径：canCommit = allReviewed，求值输出
//      不再有 canFinalize / finalized；历史 v.review.finalized 快照忽略（打开 / 提交不报错）。
//   2) 完结设施整体移除：/api/build/docs/finalize 与 /api/build/docs/review-checks 端点、
//      recordDocsFinalize、docs-review-checks.mjs 库、完结对核对话框、阶段条 ③ 入口、
//      .bld-stage-fin / .bld-finalize-* 样式与相关 i18n 词条（不残留死接口 / 无入口能力）。
//   3) 阶段条回归两段纯展示（① 默认语言先行 ── ② AI 翻译与审查）；门禁条 / 提交 title /
//      toast / 翻译跳过提示 / 任务面板下一步句 / CLI 帮助去「整体审查」提法；既有能力
//      （逐文件审查、五步、③ AI 校对建议栏、基准变更 / 范围变化审核失效回退）不回退。
// L1 求值（publish-flow.evaluateDocsFlow）；L2 数据层（build-store 导出面）；
// L3 服务端静态契约（路由 / 库文件 / 提交错误文案）；L4 前端渲染与行为（vm 提取）；
// L5 CSS 契约；L6 i18n 词条清理与同步；L7 CLI 帮助文本。
// 用法：node scripts/tests/bug-20260926-002.test.mjs

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as flow from '../lib/publish-flow.mjs';
import * as buildStore from '../lib/build-store.mjs';
import '../web/i18n.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const sha256 = (s) => crypto.createHash('sha256').update(String(s ?? '')).digest('hex');

/* ---------- L1 求值：canCommit 回归「全部已审核」，完结字段移除 ---------- */

const readsOf = (contents) => (f) => (f in contents ? contents[f] : null);

function versionOf(rec, finalized, extra = {}) {
  return {
    langs: ['cn', 'en'],
    review: { files: rec || {}, ...(finalized ? { finalized } : {}) },
    ...extra,
  };
}

function allReviewedRec(contents) {
  const rec = {};
  for (const f of flow.publishDocFiles(['cn', 'en'], [])) {
    rec[f.file] = { hash: sha256(contents[f.file]), at: '2026-09-26T00:00:00Z' };
  }
  return rec;
}

t('L1-1 全部已审核即 canCommit=true（无需完结记录）；求值输出无 canFinalize / finalized 字段', () => {
  const contents = {};
  for (const f of flow.publishDocFiles(['cn', 'en'], [])) contents[f.file] = `# ${f.key}\n`;
  const r = flow.evaluateDocsFlow(versionOf(allReviewedRec(contents)), readsOf(contents), {});
  assert.equal(r.canCommit, true, '语言集内全部文件已审核即可提交（不叠加完结条件）');
  assert.ok(!('canFinalize' in r), 'canFinalize 字段随完结阶段移除');
  assert.ok(!('finalized' in r), 'finalized 字段随完结阶段移除');
  assert.ok(!('recordDocsFinalize' in buildStore), 'build-store 不再导出 recordDocsFinalize');
});

t('L1-2 历史完结快照忽略：含旧 v.review.finalized 的版本全审可提交、未审不可提交，均不报错', () => {
  const contents = {};
  for (const f of flow.publishDocFiles(['cn', 'en'], [])) contents[f.file] = `# ${f.key}\n`;
  const legacyFinalized = { at: '2026-09-22T01:00:00Z', langsKey: 'cn,en', customDocsKey: '', files: {} };
  // 全审 + 旧完结快照 → 可提交（快照被忽略，不做 langsKey / 指纹比对）
  let r = flow.evaluateDocsFlow(versionOf(allReviewedRec(contents), legacyFinalized), readsOf(contents), {});
  assert.equal(r.canCommit, true, '全审 + 旧完结快照可提交（忽略口径）');
  // 只审默认语言 + 旧完结快照 → 不可提交（门禁只看全审，缺口明细不变）
  const half = {};
  for (const f of flow.publishDocFiles(['cn', 'en'], [])) {
    if (f.isDefault || f.lang === 'cn') half[f.file] = { hash: sha256(contents[f.file]), at: 't' };
  }
  r = flow.evaluateDocsFlow(versionOf(half, legacyFinalized), readsOf(contents), {});
  assert.equal(r.canCommit, false, '未全审 + 旧完结快照不可提交（门禁不放宽）');
  assert.ok(r.missing.length > 0, '缺口明细保留');
});

t('L1-3 门禁不放宽：scopeStale / 基准变更使文件回退非已审核态 → canCommit=false；missing / baselineShift 口径不变', () => {
  const contents = {};
  for (const f of flow.publishDocFiles(['cn', 'en'], [])) contents[f.file] = `# ${f.key}\n`;
  const rec = allReviewedRec(contents);
  // scopeStale：审核整体失效
  let r = flow.evaluateDocsFlow(versionOf(rec, null, { docs: { scopeStale: true } }), readsOf(contents), {});
  assert.equal(r.canCommit, false, 'scopeStale 不可提交');
  assert.equal(r.scopeStale, true, 'scopeStale 标识保留');
  // 基准变更：默认语言 mtime 更新 → 剩余语言回退未翻译
  const stats = { 'README.md': 999, 'README_en.md': 50 };
  r = flow.evaluateDocsFlow(versionOf(rec), readsOf(contents), {}, {
    statFile: (f) => (f in stats ? stats[f] : null),
  });
  assert.equal(r.canCommit, false, '基准变更未重新翻译审核前不可提交');
  assert.deepEqual(r.baselineShift, ['README_en.md'], 'baselineShift 明细保留');
});

/* ---------- L2/L3 数据层与服务端静态契约 ---------- */

t('L3-1 完结设施整体移除：finalize / review-checks 路由与前端 fetch 不存在；docs-review-checks.mjs 库文件删除', () => {
  const serverSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'server.mjs'), 'utf8');
  assert.ok(!serverSrc.includes('/api/build/docs/finalize'), 'server 无 finalize 路由');
  assert.ok(!serverSrc.includes('/api/build/docs/review-checks'), 'server 无 review-checks 路由');
  assert.ok(!serverSrc.includes('recordDocsFinalize'), 'server 不再调用 recordDocsFinalize');
  assert.ok(!serverSrc.includes('docs-review-checks'), 'server 不再引用 docs-review-checks 库');
  const buildSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'build.js'), 'utf8');
  assert.ok(!buildSrc.includes('api/build/docs/finalize'), '前端不再请求 finalize');
  assert.ok(!buildSrc.includes('api/build/docs/review-checks'), '前端不再请求 review-checks');
  assert.ok(
    !fs.existsSync(path.join(pluginRoot, 'scripts', 'lib', 'docs-review-checks.mjs')),
    'docs-review-checks.mjs 随唯一入口移除（不留死库）',
  );
});

t('L3-2 提交端点门禁回归：错误分支只看审核缺口与基准变更，无「整体审查未完结」完结前置句', () => {
  const serverSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'server.mjs'), 'utf8');
  assert.ok(!serverSrc.includes('整体审查未完结'), '提交门禁无完结前置错误文案');
  assert.match(serverSrc, /文档未全部通过审查/, '审核缺口错误保留');
});

/* ---------- L4 前端渲染与行为（vm 提取，同 bug-20260926-001 口径） ---------- */

function extractFn(source, name) {
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

function panePlan({ files = null, canCommit = false } = {}) {
  const list = files || flow.publishDocFiles(['cn', 'en'], []).map((f) => ({ ...f, state: 'reviewed' }));
  const missing = list.filter((f) => f.state !== 'reviewed').map((f) => ({ file: f.file, state: f.state }));
  return {
    langs: ['cn', 'en'], customDocs: [],
    docsFlow: {
      files: list,
      defaultReviewedCount: list.filter((f) => f.lang === 'cn' && f.state === 'reviewed').length,
      restReviewedCount: list.filter((f) => f.lang !== 'cn' && f.state === 'reviewed').length,
      missing, translateMissing: [],
      canCommit,
      canTranslate: true,
    },
    summary: null, translate: null, docsCheck: null,
    docs: { overall: 'none', reasons: [] },
  };
}

function paneHtml(plan, pfExtra = {}) {
  return vmRun(paneFns(SOURCE()), L4_CTX, `renderDocsPane({ id: 'V', pf: ${JSON.stringify({ phase: 'ready', plan, ...pfExtra })} })`);
}

t('L4-1 完结对核对话框与阶段条 ③ 入口整体移除：无渲染路径、无钩子、无守卫函数', () => {
  const source = SOURCE();
  for (const fn of ['openFinalize', 'closeFinalize', 'confirmFinalize', 'runReviewChecks', 'renderFinalizeModal', 'editFromProofread']) {
    assert.ok(!new RegExp(`function ${fn}\\(`).test(source), `${fn} 函数应删除`);
  }
  for (const hook of ['data-pf-finalize', 'data-pf-finalize-close', 'data-pf-finalize-cancel', 'data-pf-finalize-confirm', 'data-pf-checks', 'data-proof-edit', 'bldFinalizeWrap']) {
    assert.ok(!source.includes(hook), `钩子应删除：${hook}`);
  }
  const html = paneHtml(panePlan({ canCommit: true }));
  assert.ok(!html.includes('data-pf-finalize'), '渲染产物无完结入口');
  assert.ok(!html.includes('整体审查'), '渲染产物无「整体审查」字样');
});

t('L4-2 阶段条回归两段纯展示：① ② 为 span 纯展示，无第三段、无可点击按钮', () => {
  const html = paneHtml(panePlan({ canCommit: true }));
  assert.match(html, /<span class="bld-stage">① 默认语言先行/, '阶段 ① 纯展示保留');
  assert.match(html, /<span class="bld-stage">② AI 翻译与审查/, '阶段 ② 纯展示保留');
  assert.ok(!/bld-stage-fin/.test(html), '无 ③ 完结按钮');
  assert.ok(!html.includes('③ 整体审查完结'), '无「③ 整体审查完结」文案');
  const stages = html.match(/<div class="bld-docs-stages"[^>]*>[\s\S]*?<\/div>/) || [''];
  assert.equal((stages[0].match(/bld-stage(?![\w-])/g) || []).length, 2, '阶段条仅两段');
});

t('L4-3 全部已审核即可提交：⑤ 无 aria-disabled、title 无完结口径；门禁条「x/x 已审核——可提交」；无完结终态标识', () => {
  const html = paneHtml(panePlan({ canCommit: true }));
  assert.doesNotMatch(html, /data-pf-commit[^>]*aria-disabled/, '全审后提交直接解锁');
  assert.match(html, /data-pf-commit[^>]*title="把语言集内文档与 LICENSE\.md 提交到本地 dev 分支（pathspec 限定，不夹带业务源码）"/, '提交 title 为原口径');
  assert.match(html, /提交门禁：9\/9 已审核 —— 可提交到本地 dev 分支。/, '门禁条可提交文案（无完结字样）');
  assert.ok(!html.includes('整体审查已完结 ✓'), '完结终态标识移除');
  assert.ok(!html.includes('确认完结'), '无完结确认字样');
});

t('L4-4 未全审：提交禁用 + title 只列审核缺口（不指向完结）；commitDocs 缺口 toast 无完结兜底句', async () => {
  const files = flow.publishDocFiles(['cn', 'en'], []).map((f, i) => ({ ...f, state: i === 0 ? 'summarized' : 'reviewed' }));
  const html = paneHtml(panePlan({ files, canCommit: false }));
  assert.match(html, /data-pf-commit[^>]*aria-disabled="true"/, '未全审提交禁用');
  assert.match(html, /data-pf-commit[^>]*title="还需 1 个文件通过审查：README\.md（已总结待审核）"/, 'title 列缺口明细');
  assert.ok(!html.includes('整体审查未完结'), '缺口口径不再出现完结句');
  // 行为：commitDocs 缺口 toast 只列文件明细，不发请求
  const source = SOURCE();
  const fns = [extractFn(source, 'commitDocs'), extractFn(source, 'normalizeFlowEval')].join('\n');
  const calls = { toast: [], posts: [] };
  const v = { id: 'V' };
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
  const hit = calls.toast.find(([m]) => m.includes('尚不可提交'));
  assert.ok(hit, '缺口 toast 保留');
  assert.match(hit[0], /还需 1 个文件通过审查（README\.md（已总结待审核））/);
  assert.ok(!hit[0].includes('整体审查'), 'toast 无完结提法');
  assert.equal(calls.posts.length, 0, '未发提交请求');
});

t('L4-5 加载 / 失败态与既有能力不回退：单行操作条恒渲染；审查 / 刷新 / 五步钩子齐备；校对建议栏与语言页签保留', () => {
  const loading = vmRun(paneFns(SOURCE()), L4_CTX, `renderDocsPane({ id: 'V', pf: ${JSON.stringify({ phase: 'loading', plan: null })} })`);
  for (const k of ['bld-docs-sub', 'data-pf-refresh', 'data-pf-review', 'data-pf-summary', 'data-pf-edit', 'data-pf-proofstep', 'data-pf-translate', 'data-pf-commit']) {
    assert.ok(loading.includes(k), `加载态渲染 ${k}`);
  }
  const html = paneHtml(panePlan({ canCommit: true }));
  for (const k of ['data-pf-review', 'data-pf-proofstep', 'bld-docs-chk', 'data-doc-lang', 'bld-doc-lang-tabs']) {
    assert.ok(html.includes(k), `既有能力保留：${k}`);
  }
  assert.ok(!html.includes('运行自动检查'), '「运行自动检查」不残留');
});

t('L4-6 翻译跳过提示去「整体审查」：单语言版本 title / toast 改「直接进行提交」', () => {
  const source = SOURCE();
  assert.ok(!source.includes('直接进行整体审查与提交'), '旧提法清理');
  assert.ok(source.includes('语言集只有一个语言：无翻译目标，可跳过翻译（直接进行提交）'), '新口径落位（title 与 toast 两处）');
  const single = flow.publishDocFiles(['cn'], []).map((f) => ({ ...f, state: 'reviewed' }));
  const plan = panePlan({ files: single, canCommit: true });
  plan.langs = ['cn'];
  plan.docsFlow.canTranslate = false; // 单语言版本无翻译目标（走跳过说明分支）
  plan.docsFlow.restFiles = [];
  const html = vmRun(paneFns(SOURCE()), L4_CTX, `renderDocsPane({ id: 'V', pf: ${JSON.stringify({ phase: 'ready', plan })} })`);
  assert.match(html, /title="语言集只有一个语言：无翻译目标，可跳过翻译（直接进行提交）"/, '④ title 新口径');
});

/* ---------- L5 CSS 契约 ---------- */

t('L5-1 完结样式清理：.bld-stage-fin 与 .bld-finalize-* 规则删除；.bld-docs-stages 基础规则保留', () => {
  const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');
  assert.ok(!css.includes('bld-stage-fin'), '.bld-stage-fin 规则应删除');
  assert.ok(!css.includes('bld-finalize'), '.bld-finalize-* 规则应删除');
  assert.match(css, /\.bld-docs-stages \{/, '阶段条容器规则保留（两阶段仍用）');
  assert.match(css, /\.bld-docs-stages \.bld-stage \{/, '阶段段内规则保留');
});

/* ---------- L6 i18n ---------- */

t('L6-1 i18n：完结对核对话框与自动检查词条清理；门禁条 / 提交 / 跳过翻译新口径词条中英齐备', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN, EN_DYNAMIC } = I._dict;
  for (const k of [
    '整体审查完结', '③ 整体审查完结', '确认完结', '完结中…', '运行自动检查', '检查中…',
    '打开整体审查完结核对：各语言语义一致、README 按语言互链、内容与本版发布范围一致；确认完结后「提交」解锁',
    '整体审查已完结；点击可重新核对新再次确认（更新完结时间）',
    '整体审查未完结：全部文件已审核后，请先在阶段条「③ 整体审查完结」确认完结再提交',
    '尚不可提交：整体审查未完结（全部文件已审核后，请先在阶段条「③ 整体审查完结」确认完结）',
    '整体审查未完结：全部文件已审核后，请先「整体审查」确认完结再提交',
    '尚不可提交：整体审查未完结（全部文件已审核后，请先「整体审查」确认完结）',
    '✓ 整体审查已完结：文档编写三阶段完成，「提交」已解锁',
    '自动检查发现问题：详见整体审查对话框逐项红叉与明细',
    '✓ 自动检查通过：语言一致与链接可达均无问题',
    '语言一致自动检查未运行：点击「运行自动检查」',
    '链接可达性自动检查未运行：点击「运行自动检查」',
    'AI 校对未运行：点击「AI 校对」派发 Agent 核查，结果自动回执',
    '各语言内容语义一致（以已审核默认语言为基准）',
    'README 按语言互链真实可达（同语言 CHANGELOG 与 FEATURES，链接必须真实可达）',
    '所有文档内链接真实可达（README 按语言互链：同语言 CHANGELOG 与 FEATURES，链接必须真实可达）',
    '默认语言错别字与行文规范（AI 校对自动上报）',
    '自动检查各语言内容语言一致性与全部文档内链接可达性（只读，不设门禁，结果即时呈现）',
    '提示：完结前请逐项核对；完结后范围变化会使完结失效回退。',
    '完结是人工确认动作：请逐项核对后再确认。',
    '下一步：发布模块「文档编写」页「审查」→「整体审查」→「提交」。',
    '语言集只有一个语言：无翻译目标，可跳过翻译（直接进行整体审查与提交）',
  ]) {
    assert.ok(!(k in EN), `静态词条应清理：${k.slice(0, 16)}…`);
  }
  for (const k of [
    '提交门禁：◇/◇ 已审核 · 整体审查已完结 —— 可提交到本地 dev 分支。',
    '提交门禁：默认语言 ◇/◇ · 剩余语言 ◇/◇ 已审核 —— 整体审查未完结（确认完结后可提交）。',
    '整体审查完结（◇）',
    '整体审查已完结 ✓（时间 ◇；提交已解锁）',
    '整体审查未解锁：尚缺 ◇ 个文件审核（◇）',
    '完成时间 ◇ · 下一步：发布模块「文档编写」页「审查」→「整体审查」→「提交」。',
  ]) {
    assert.ok(!(k in EN_DYNAMIC), `动态词条应清理：${k.slice(0, 16)}…`);
  }
  // 新口径在用词条中英齐备
  for (const k of ['语言集只有一个语言：无翻译目标，可跳过翻译（直接进行提交）', '提交门禁：◇/◇ 已审核 —— 可提交到本地 dev 分支。']) {
    const dict = k.includes('◇') ? EN_DYNAMIC : EN;
    assert.ok(k in dict, `新口径词条缺失：${k}`);
  }
  // 英文值不重复（清理与新替不引入冲突）
  const seen = new Map();
  const dup = [];
  for (const [k, v] of Object.entries(EN)) {
    if (seen.has(v)) dup.push(`${v} ← ${seen.get(v)} | ${k}`);
    else seen.set(v, k);
  }
  assert.deepEqual(dup, [], `EN 值重复：\n${dup.join('\n')}`);
});

t('L6-2 词典与界面同源：build.js 渲染面不再产生含「整体审查 / 完结 / 运行自动检查」的待译中文', () => {
  const source = SOURCE();
  const cleaned = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  for (const w of ['整体审查', '确认完结', '运行自动检查', '完结对核']) {
    assert.ok(!cleaned.includes(w), `build.js 代码面应清理「${w}」提法（注释可留痕）`);
  }
});

/* ---------- L7 CLI 帮助文本 ---------- */

t('L7-1 atb CLI 帮助与口径句去「整体审查完结」提法；docscheck 结果指向校对建议栏', () => {
  const src = fs.readFileSync(path.join(pluginRoot, 'scripts', 'atb.mjs'), 'utf8');
  assert.ok(!src.includes('整体审查'), 'atb.mjs 帮助与注释不再出现「整体审查」');
  assert.ok(src.includes('校对建议栏'), 'docscheck 展示口径指向右侧校对建议栏');
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
