#!/usr/bin/env node
// BUG-20260926-004 发布范围变化（scopeStale）后逐文件通过审核永不生效，审查与提交门禁互相死锁。
// 缺陷：REQ-20260921-008 的求值判定 approved = !scopeStale && hash 一致，把「范围变化后需重新
// 核对」这一过程性要求实现成「重新核对动作本身无效」——scopeStale 期间逐文件「通过审核」永远
// 无法生效，而 scopeStale 唯一解除途径是重新提交文档，提交又被「全部已审核」门禁拦住，三步
// 互咬成死锁闭环。
// 修复（design.md 方案 1）：
//   1) 求值侧：approved 去掉 !scopeStale 必要条件，恢复「hash 一致」判定；范围变化后的审核
//      新鲜度改为时点校验——审核记录时点（review.files[file].at）晚于最近一次范围变化时点
//      （docs.scopeChangedAt，markDocsScopeStale 落盘）即视为基于当前范围的重新核对；存量
//      数据无 scopeChangedAt 时以最近一次文档提交时点（docs.committedAt）兜底（范围变化必然
//      发生在文档提交之后）；两皆缺失时安全侧倾斜：审核一律视为旧范围。审核过程中范围再变
//      → 重新通过的审核再次失效，canCommit 回落 false。
//   2) 提交侧：noop 恢复路径——文档内容与最近一次文档提交一致（无新 git 提交可造）但范围已
//      变化时，「重新提交」语义为重确认：复用既有 commitHash 重固化文档记录（刷新 scopeFp /
//      committedAt，清除 scopeStale），不制造空提交；拦截文案如实附范围变化上下文。
//   3) 展示侧：审查对话框 scopeStale 期间保留失效提示横幅；toast 计数随求值结果一致前进。
//   4) 不改：scopeStale 标记与 staleReason 溯源、merge 步 needs-rewrite 门禁、基准变更回退、
//      BUG-20260926-002 的「全部已审核即放行」门禁口径。
// L1 求值（publish-flow.evaluateDocsFlow）；L2 数据层（build-store 落盘口径）；
// L3 服务端静态契约（提交端点 noop 恢复 + 拦截文案）；L4 前端渲染（审查对话框横幅）；
// L5 i18n 词条。
// 用法：node scripts/tests/bug-20260926-004.test.mjs

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
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
const tmpdir = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

/* ---------- 公共夹具 ---------- */

const LANGS = ['cn', 'en'];
const DOCS = flow.publishDocFiles(LANGS, []);
const readsOf = (contents) => (f) => (Object.prototype.hasOwnProperty.call(contents, f) ? contents[f] : null);
const contentsOf = () => {
  const c = {};
  for (const f of DOCS) c[f.file] = `# ${f.file}\n`;
  return c;
};
// 全文件审核记录（同一时点）
const recAll = (contents, at) => {
  const rec = {};
  for (const f of DOCS) rec[f.file] = { hash: sha256(contents[f.file]), at };
  return rec;
};
const SCOPE_CHANGED_AT = '2026-09-26T10:00:00.000Z';
const REVIEWED_AT = '2026-09-26T11:00:00.000Z'; // 晚于范围变化：重新核对后的审核
const OLD_REVIEW_AT = '2026-09-25T00:00:00.000Z'; // 早于范围变化：旧范围审核
const verOf = (review, docsExtra = {}) => ({
  langs: LANGS,
  docs: { commitHash: 'a'.repeat(40), committedAt: '2026-09-20T00:00:00.000Z', scopeStale: true, staleReason: '补入依赖提交', ...docsExtra },
  review,
});

/* ---------- L1 求值：scopeStale 后审核可恢复，新鲜度收敛到时点校验 ---------- */

t('L1-1 scopeStale 期间旧范围审核失效回退：门禁不放宽（回归守护）', () => {
  const c = contentsOf();
  const v = verOf({ files: recAll(c, OLD_REVIEW_AT) }, { scopeChangedAt: SCOPE_CHANGED_AT });
  const r = flow.evaluateDocsFlow(v, readsOf(c), {});
  assert.equal(r.files.find((f) => f.file === 'README.md').state, 'summarized', '默认语言旧审核回退已总结待审核');
  assert.equal(r.files.find((f) => f.file === 'README_en.md').state, 'translated', '剩余语言旧审核回退已翻译待审核');
  assert.equal(r.files.find((f) => f.file === 'LICENSE.md').state, 'pending', '单文件类旧审核回退待审核');
  assert.equal(r.reviewedCount, 0, '旧范围审核不计入已审核');
  assert.equal(r.canCommit, false, '旧范围审核未重新核对前不可提交');
  assert.equal(r.scopeStale, true, 'scopeStale 标识保留');
  assert.ok(r.missing.length === DOCS.length, '缺口明细如实');
});

t('L1-2 scopeStale 后重新逐文件审核可恢复：hash 一致且时点晚于范围变化即已审核，全审后 canCommit=true', () => {
  const c = contentsOf();
  const v = verOf({ files: recAll(c, REVIEWED_AT) }, { scopeChangedAt: SCOPE_CHANGED_AT });
  const r = flow.evaluateDocsFlow(v, readsOf(c), {});
  assert.equal(r.files.find((f) => f.file === 'README.md').state, 'reviewed', '重新审核生效（不再被 !scopeStale 压死）');
  assert.equal(r.reviewedCount, DOCS.length, '审核计数实时前进');
  assert.deepEqual(r.missing, [], '全审后无缺口');
  assert.equal(r.canCommit, true, '全审（基于当前范围）后提交解锁');
  assert.equal(r.scopeStale, true, 'scopeStale 标识保留到提交清除');
});

t('L1-3 存量数据回退（无 scopeChangedAt）：以 docs.committedAt 兜底——早于提交时点的审核视为旧范围，重新审核可恢复', () => {
  const c = contentsOf();
  // 存量形态：docs 无 scopeChangedAt；审核记录早于文档提交时点（审核在提交前完成，随后范围变化）
  const vOld = verOf({ files: recAll(c, OLD_REVIEW_AT) }, { committedAt: '2026-09-25T12:00:00.000Z' });
  delete vOld.docs.scopeChangedAt;
  let r = flow.evaluateDocsFlow(vOld, readsOf(c), {});
  assert.equal(r.files.find((f) => f.file === 'README.md').state, 'summarized', '提交时点前的审核视为基于旧范围');
  assert.equal(r.canCommit, false, '存量 scopeStale 版本需重新逐文件审核');
  // 重新逐文件审核（时点晚于文档提交时点）→ 恢复并可提交（BLD-20260923-001 真实场景验收路径）
  const vRe = verOf({ files: recAll(c, REVIEWED_AT) }, { committedAt: '2026-09-25T12:00:00.000Z' });
  delete vRe.docs.scopeChangedAt;
  r = flow.evaluateDocsFlow(vRe, readsOf(c), {});
  assert.equal(r.files.find((f) => f.file === 'README.md').state, 'reviewed', '存量数据重新审核可恢复');
  assert.equal(r.canCommit, true, '存量数据重审全过后提交解锁');
});

t('L1-4 时点无法定位（scopeChangedAt / committedAt 均缺失）：安全侧倾斜，审核一律视为旧范围', () => {
  const c = contentsOf();
  const v = verOf({ files: recAll(c, REVIEWED_AT) }, { committedAt: undefined });
  delete v.docs.committedAt;
  const r = flow.evaluateDocsFlow(v, readsOf(c), {});
  assert.equal(r.files.find((f) => f.file === 'README.md').state, 'summarized', '无法定位时点时不放行');
  assert.equal(r.canCommit, false, '安全侧倾斜：需重新逐文件审核');
});

t('L1-5 审核后范围再变：重新通过的审核再次失效，canCommit 回落 false（以落盘时点为准）', () => {
  const c = contentsOf();
  const mk = (scopeChangedAt) => verOf({ files: recAll(c, REVIEWED_AT) }, { scopeChangedAt });
  let r = flow.evaluateDocsFlow(mk(SCOPE_CHANGED_AT), readsOf(c), {});
  assert.equal(r.canCommit, true, '审核基于当前范围（时点晚于第一次范围变化）');
  // 审核过程中范围又变（scopeChangedAt 刷新到审核时点之后）→ 旧审核再次失效
  r = flow.evaluateDocsFlow(mk('2026-09-26T12:00:00.000Z'), readsOf(c), {});
  assert.equal(r.files.find((f) => f.file === 'README.md').state, 'summarized', '重新通过的审核再次失效');
  assert.equal(r.canCommit, false, '提交拦截，不放行旧审核');
  assert.ok(r.missing.length === DOCS.length, '缺口如实');
});

t('L1-6 范围未变化的既有流程回归：hash 一致即已审核、内容再变回退、基准变更回退口径不变', () => {
  const c = contentsOf();
  const rec = { files: recAll(c, OLD_REVIEW_AT) };
  // 无 docs.scopeStale：既有口径完全不变
  let r = flow.evaluateDocsFlow({ review: rec }, readsOf(c), {});
  assert.equal(r.canCommit, true, '范围未变化：hash 一致全审即放行');
  assert.equal(r.scopeStale, false);
  // 内容再变 → 回退（既有口径）
  r = flow.evaluateDocsFlow({ review: rec }, readsOf({ ...c, 'README.md': 'changed' }), {});
  assert.equal(r.files.find((f) => f.file === 'README.md').state, 'summarized', '内容变化回退待审核');
  // 基准变更（mtime）回退口径不变
  const stats = { 'README.md': 999, 'README_en.md': 50 };
  r = flow.evaluateDocsFlow({ review: rec }, readsOf(c), {}, { statFile: (f) => (f in stats ? stats[f] : null) });
  assert.equal(r.canCommit, false, '基准变更未重新翻译审核前不可提交');
  assert.deepEqual(r.baselineShift, ['README_en.md'], 'baselineShift 明细不变');
});

t('L1-7 单文件类与剩余语言在 scopeStale 下同样可恢复（LICENSE / README_en）', () => {
  const c = contentsOf();
  const v = verOf({ files: recAll(c, REVIEWED_AT) }, { scopeChangedAt: SCOPE_CHANGED_AT });
  const r = flow.evaluateDocsFlow(v, readsOf(c), {});
  assert.equal(r.files.find((f) => f.file === 'LICENSE.md').state, 'reviewed', '单文件类重新审核可恢复');
  assert.equal(r.files.find((f) => f.file === 'README_en.md').state, 'reviewed', '剩余语言重新审核可恢复');
});

/* ---------- L2 数据层：范围变化时点落盘 / 重置 ---------- */

t('L2-1 范围变化落盘 docs.scopeChangedAt（markDocsScopeStale 联动；重复触发刷新为最近一次）', () => {
  const dir = tmpdir('atb-bug20260926-004-l2a-');
  const v = buildStore.createVersion(dir, { items: [{ itemId: 'REQ-20260926-004', commits: ['a'.repeat(40)] }] });
  buildStore.recordDocsCommit(dir, v.id, { commitHash: 'b'.repeat(40), files: { 'README.md': sha256('# x\n') }, scopeFp: 'fp-1' });
  let cur = buildStore.readVersion(dir, v.id);
  assert.equal(cur.docs.scopeStale, false, '提交后范围未过期');
  assert.equal(cur.docs.scopeChangedAt, null, '文档提交重置范围变化时点');
  // 范围变化（新增关联条目）→ scopeStale 联动 + 时点落盘
  buildStore.addItems(dir, v.id, [{ itemId: 'BUG-20260926-004', commits: ['c'.repeat(40)] }]);
  cur = buildStore.readVersion(dir, v.id);
  assert.equal(cur.docs.scopeStale, true, 'scopeStale 联动保留');
  assert.match(cur.docs.staleReason || '', /新增关联条目/, 'staleReason 溯源保留');
  const first = cur.docs.scopeChangedAt;
  assert.ok(first, '范围变化落盘 scopeChangedAt');
  assert.ok(Number.isFinite(Date.parse(first)), 'scopeChangedAt 为可解析时点');
  assert.ok(Date.parse(first) >= Date.parse(cur.docs.committedAt), '范围变化时点不早于文档提交时点');
  // 再次范围变化（补入提交）→ 时点刷新（nowIso 毫秒粒度：同毫秒内连触两次时相等，故取 >=）
  buildStore.appendItemCommits(dir, v.id, [{ itemId: 'BUG-20260926-004', commits: ['d'.repeat(40)] }]);
  cur = buildStore.readVersion(dir, v.id);
  assert.ok(Date.parse(cur.docs.scopeChangedAt) >= Date.parse(first), '再次范围变化刷新 scopeChangedAt（以落盘时点为准）');
  assert.ok(Number.isFinite(Date.parse(cur.docs.scopeChangedAt)), '刷新后仍为可解析时点');
});

t('L2-2 重新提交文档清除 scopeStale / staleReason 并重置 scopeChangedAt', () => {
  const dir = tmpdir('atb-bug20260926-004-l2b-');
  const v = buildStore.createVersion(dir, { items: [{ itemId: 'REQ-20260926-004', commits: ['a'.repeat(40)] }] });
  buildStore.recordDocsCommit(dir, v.id, { commitHash: 'b'.repeat(40), files: { 'README.md': sha256('# x\n') }, scopeFp: 'fp-1' });
  buildStore.addItems(dir, v.id, [{ itemId: 'BUG-20260926-004', commits: ['c'.repeat(40)] }]);
  let cur = buildStore.readVersion(dir, v.id);
  assert.equal(cur.docs.scopeStale, true);
  buildStore.recordDocsCommit(dir, v.id, { commitHash: 'b'.repeat(40), files: { 'README.md': sha256('# x\n') }, scopeFp: 'fp-2' });
  cur = buildStore.readVersion(dir, v.id);
  assert.equal(cur.docs.scopeStale, false, '重新提交清除范围过期');
  assert.equal(cur.docs.staleReason, null, 'staleReason 清空');
  assert.equal(cur.docs.scopeChangedAt, null, 'scopeChangedAt 重置');
});

t('L2-3 审核留痕带可解析时点（recordDocsReview 固化 hash + at，求值新鲜度依据）', () => {
  const dir = tmpdir('atb-bug20260926-004-l2c-');
  const v = buildStore.createVersion(dir, { items: [{ itemId: 'REQ-20260926-004', commits: ['a'.repeat(40)] }] });
  const out = buildStore.recordDocsReview(dir, v.id, { file: 'README.md', hash: sha256('# x\n') });
  assert.equal(out.review.files['README.md'].hash, sha256('# x\n'), '审核 hash 固化');
  assert.ok(Number.isFinite(Date.parse(out.review.files['README.md'].at)), '审核记录带可解析时点');
});

/* ---------- L3 服务端静态契约：提交端点 noop 恢复路径与拦截文案 ---------- */

function serverSegment(startMarker, endMarker) {
  const src = fs.readFileSync(path.join(pluginRoot, 'scripts', 'server.mjs'), 'utf8');
  const i = src.indexOf(startMarker);
  assert.ok(i >= 0, `server.mjs 应含 ${startMarker}`);
  const j = src.indexOf(endMarker, i);
  return j < 0 ? src.slice(i) : src.slice(i, j);
}
const commitSegment = () => serverSegment("pathname === '/api/build/docs/commit'", 'docs-proofread/start');

t('L3-1 提交端点 noop 恢复路径：内容与既有文档提交一致（无新提交可造）时重固化文档记录、清除 scopeStale', () => {
  const seg = commitSegment();
  const i = seg.indexOf('if (r.noop)');
  assert.ok(i >= 0, '提交端点存在 noop 分支');
  // noop 分支后首个非 noop 路径 scopeFp 计算（noop 分支内的同名计算在其之前）
  const j = seg.lastIndexOf('const scopeFp');
  const noopSeg = seg.slice(i, j > i ? j : undefined);
  assert.ok(noopSeg.includes('recordDocsCommit'), 'noop 分支在既有文档提交记录上重固化（重新提交语义 = 重确认）');
  assert.ok(noopSeg.includes('docs?.commitHash'), 'noop 恢复复用既有文档提交 hash，不制造空提交');
});

t('L3-2 提交拦截文案如实：scopeStale 时附范围变化上下文并指向重新审查（不再死循环提示）', () => {
  const seg = commitSegment();
  assert.match(seg, /文档未全部通过审查/, '既有审核缺口文案保留');
  assert.match(seg, /flowEval\.scopeStale/, '拦截文案按 scopeStale 分叉');
  assert.match(seg, /发布范围已变化/, '附范围变化上下文');
  assert.match(seg, /重新逐文件核对/, '指向重新审查路径');
});

/* ---------- L4 前端渲染：审查对话框 scopeStale 失效横幅 ---------- */

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
const ESC = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
  DEFAULT_DOC_LANGS: LANGS,
  langNameOf: (l) => String(l),
  docFilesOf: (langs, customDocs) => flow.publishDocFiles(
    Array.isArray(langs) && langs.length ? langs : LANGS, customDocs,
  ),
};
const SOURCE = () => fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'build.js'), 'utf8');
const reviewModalFns = () => ['sanitizeHtml', 'renderMd', 'renderReviewModal'].map((n) => extractFn(SOURCE(), n)).join('\n');
function reviewModalHtml(scopeStale) {
  const c = contentsOf();
  const files = DOCS.map((f) => ({ ...f, state: scopeStale ? (f.file === 'README_en.md' ? 'translated' : f.single ? 'pending' : 'summarized') : 'reviewed' }));
  const ctx = {
    ...FLOW_STUB,
    esc: ESC,
    pfOf: (x) => x.pf,
    v: {
      id: 'BLD-20260923-001',
      pf: {
        phase: 'ready',
        review: { open: true, key: 'README', contents: {}, busy: false },
        plan: {
          langs: LANGS, customDocs: [],
          docsFlow: { files, reviewedCount: scopeStale ? 0 : files.length, scopeStale, canCommit: !scopeStale, missing: [], translateMissing: [], baselineShift: [] },
          docs: { overall: 'uncommitted', reasons: [] },
        },
      },
    },
  };
  return vmRun(reviewModalFns(), ctx, 'renderReviewModal(v)');
}

t('L4-1 审查对话框 scopeStale 失效横幅：范围变化期间提示重新逐文件核对后提交', () => {
  const html = reviewModalHtml(true);
  assert.match(html, /data-review-stale-note/, '横幅钩子落位');
  assert.match(html, /发布范围已变化/, '失效提示文案');
  assert.match(html, /重新逐文件核对/, '指向重新逐文件核对路径');
});

t('L4-2 范围未变化时审查对话框不渲染失效横幅（无冗余提示）', () => {
  const html = reviewModalHtml(false);
  assert.ok(!html.includes('data-review-stale-note'), '非 scopeStale 无横幅');
});

/* ---------- L5 i18n：横幅词条中英齐备 ---------- */

t('L5-1 审查对话框范围变化横幅词条入静态 EN 且值不重复', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN } = I._dict;
  const key = '发布范围已变化：请重新逐文件核对并「通过审核」后再提交';
  assert.ok(key in EN, `EN 缺词条：${key}`);
  assert.ok(!/[\u4e00-\u9fff]/.test(EN[key]), 'EN 值不含中文');
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
