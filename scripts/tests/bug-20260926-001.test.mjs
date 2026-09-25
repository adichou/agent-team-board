#!/usr/bin/env node
// BUG-20260926-001 文档编写界面去掉整体审查按钮，五步按钮上移到审查那一行 —— 分层测试。
// 缺陷：REQ-20260924-006 起顶部操作区两行堆叠（第一行辅助动作含「整体审查」独立按钮 +
// 第二行五步操作条），主流程按钮低于辅助按钮一行，纵向占用高、主次颠倒。
// 修复（design.md 定稿）：
//   1) 顶部收敛一行操作条：.bld-docs-sub 内 语言集 → 刷新 / 审查 → 五步（「五步：」+ ①–⑤）；
//   2) 「整体审查」独立按钮移除，完结核对对话框入口落到阶段条「③ 整体审查完结」（可点击，
//      data-pf-finalize 钩子与 openFinalize 守卫不变；未解锁 aria-disabled + title 缺口，
//      完结后可重新核对再确认）；⑤ 提交门禁不弱化，缺口文案指向新入口（中英 i18n 同步）。
// L1 渲染结构（vm 提取 renderDocsPane：单行操作条 + 加载 / 失败态恒渲染）；
// L2 完结入口（阶段条 ③ 按钮三态：未解锁 / 解锁未完结 / 已完结）；
// L3 行为（commitDocs 全部已审核未完结 toast 新文案且不发请求）；
// L4 CSS 契约（style.css：单行三簇 + .bld-stage-fin）；
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
  // 完结入口唯一落点：data-pf-finalize 全页仅阶段条一处
  assert.equal((html.match(/data-pf-finalize(?![\w-])/g) || []).length, 1, 'data-pf-finalize 仅阶段条一处');
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

/* ---------- L2 完结入口：阶段条 ③ 整体审查完结 可点击 ---------- */

t('L2-1 未解锁：阶段条 ③ 为 data-pf-finalize 按钮，aria-disabled + title 列缺口明细；① ② 阶段保持纯展示', () => {
  const files = flow.publishDocFiles(['cn', 'en'], []).map((f, i) => ({ ...f, state: i === 0 ? 'summarized' : (i < 5 ? 'reviewed' : 'untranslated') }));
  const html = paneHtml(panePlan({ files }));
  assert.match(html, /<button type="button" class="bld-stage bld-stage-fin" data-pf-finalize aria-disabled="true" title="整体审查未解锁：尚缺 5 个文件审核（README\.md（已总结待审核）/, '阶段条 ③ 按钮未解锁禁用 + title 缺口');
  assert.ok(html.includes('>③ 整体审查完结'), '阶段条 ③ 文案保留');
  assert.ok(html.includes('<span class="bld-stage">① 默认语言先行'), '阶段 ① 仍为纯展示');
  assert.ok(html.includes('<span class="bld-stage">② AI 翻译与审查'), '阶段 ② 仍为纯展示');
  assert.ok(html.includes('○</i>未解锁'), '未解锁 chip 保留');
});

t('L2-2 全部已审核未完结：阶段条 ③ 可点（无 aria-disabled）+ title 完结对核说明；「⑤ 提交」仍禁用且 title 指向阶段条新入口；门禁条口径不变', () => {
  const html = paneHtml(panePlan({ canCommit: false }));
  const fin = html.match(/<button type="button" class="bld-stage bld-stage-fin"[^>]*>/);
  assert.ok(fin, '阶段条 ③ 按钮渲染');
  assert.ok(!fin[0].includes('aria-disabled'), '解锁后可点击（无 aria-disabled）');
  assert.match(fin[0], /title="打开整体审查完结核对：[^"]*确认完结后「提交」解锁"/, 'title 完结对核说明');
  assert.match(html, /data-pf-commit[^>]*aria-disabled="true"/, '完结前提交禁用');
  assert.match(html, /data-pf-commit[^>]*title="[^"]*请先在阶段条「③ 整体审查完结」确认完结再提交"/, '提交 title 指向阶段条新入口');
  assert.match(html, /整体审查未完结（确认完结后可提交）/, '门禁条完结缺口口径不变');
});

t('L2-3 已完结：title 重新核对再确认说明（能力不回退）；完结终态标识保留；「⑤ 提交」解锁', () => {
  const html = paneHtml(panePlan({ finalized: { at: '2026-09-26T02:00:00.000Z' }, canCommit: true }));
  const fin = html.match(/<button type="button" class="bld-stage bld-stage-fin"[^>]*>/);
  assert.ok(fin, '阶段条 ③ 按钮渲染');
  assert.match(fin[0], /title="整体审查已完结；点击可重新核对新再次确认（更新完结时间）"/, 'title 重新核对说明');
  assert.match(html, /整体审查已完结 ✓（时间 t；提交已解锁）/, '完结终态标识');
  assert.ok(!/data-pf-commit[^>]*aria-disabled/.test(html), '完结后提交可用');
  assert.ok(html.includes('✔</i>已完成'), '阶段完成 chip');
});

/* ---------- L3 行为：提交缺口反馈指向新入口 ---------- */

t('L3-1 commitDocs：全部已审核但整体审查未完结时点击提交，toast 缺口反馈指向阶段条「③ 整体审查完结」且不发提交请求', async () => {
  const source = SOURCE();
  const fns = [extractFn(source, 'commitDocs'), extractFn(source, 'normalizeFlowEval')].join('\n');
  const calls = { toast: [], posts: [] };
  const v = { id: 'V' };
  const pf = { verId: v.id, phase: 'ready', busy: false, plan: panePlan({ canCommit: false }) };
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
  const hit = calls.toast.find(([m, e]) => e && m.includes('尚不可提交：整体审查未完结'));
  assert.ok(hit, '缺口 toast 保留');
  assert.match(hit[0], /请先在阶段条「③ 整体审查完结」确认完结/, '文案指向阶段条新入口');
  assert.equal(calls.posts.length, 0, '未发提交请求（门禁不弱化）');
});

/* ---------- L4 CSS 契约 ---------- */

t('L4-1 CSS：.bld-docs-sub 单行 flex 保持，.bld-docs-steps 规则保留，新增 .bld-stage-fin 按钮重置与可点反馈', () => {
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
  const fin = rule('.bld-docs-stages .bld-stage-fin');
  assert.match(fin, /cursor:\s*pointer/, '完结入口可点手型');
  const finIdx = css.indexOf(fin);
  assert.ok(/aria-disabled/.test(css.slice(finIdx, finIdx + 400)), 'aria-disabled 态不显手型（缺省 cursor）');
});

/* ---------- L5 i18n ---------- */

t('L5-1 i18n：提交缺口新文案中英齐备；旧「请先「整体审查」」两条与「整体审查」独立词条清理；「五步：」保留', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN } = I._dict;
  for (const k of [
    '整体审查未完结：全部文件已审核后，请先在阶段条「③ 整体审查完结」确认完结再提交',
    '尚不可提交：整体审查未完结（全部文件已审核后，请先在阶段条「③ 整体审查完结」确认完结）',
    '五步：', '① AI 总结', '② 二次编辑', '③ AI 校对', '④ AI 翻译', '⑤ 提交',
    '③ 整体审查完结',
    '整体审查已完结；点击可重新核对新再次确认（更新完结时间）',
    '打开整体审查完结核对：各语言语义一致、README 按语言互链、内容与本版发布范围一致；确认完结后「提交」解锁',
  ]) {
    assert.ok(k in EN, `词条缺失：${k.slice(0, 16)}…`);
  }
  for (const k of [
    '整体审查未完结：全部文件已审核后，请先「整体审查」确认完结再提交',
    '尚不可提交：整体审查未完结（全部文件已审核后，请先「整体审查」确认完结）',
    '整体审查',
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
