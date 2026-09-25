#!/usr/bin/env node
// REQ-20260922-003 文档编写页支持添加多份自定义文档（并入 AI 总结提示词）—— 分层测试。
// 口径（design.md 定稿；BUG-20260922-002 起多语言口径升级——本文件断言已随落定更新）：
//   命名：字母开头 + 字母/数字/连字符/下划线，≤40 字符，.md 可省略自动补全，大写归一，
//        保留名 = 标准 4 类 / LICENSE 及其 _lang(2-3字母) 后缀形态，上限 20 份，不支持子目录；
//   展开：BUG-20260922-002 起随语言集自动展开（默认语言 KEY.md + 其余 KEY_<lang>.md，
//        其余语言进 AI 翻译；展开重名 MIGRATION_EN ↔ MIGRATION 拦截）；
//   参与：进 AI 总结（提示词清单 + 账本）、七态状态机与审核 hash、canFinalize / canCommit /
//        提交 pathspec / 合并门禁 / 范围指纹（全参与，只增不减）；canTranslate 含自定义默认
//        语言份（BUG-20260922-002 起与标准 4 类同口径）；
//   持久化：版本记录 v.customDocs（发布计划级），merging / pushed 锁定，总结运行中禁移除。
// L1 纯逻辑（publish-flow）；L2 数据层（build-store + summary 账本）；L3 服务接口；
// L4 前端静态契约（build.js）；L6 i18n（中英同步）。
// 用法：node scripts/tests/req-20260922-003.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as flow from '../lib/publish-flow.mjs';
import * as buildStore from '../lib/build-store.mjs';
import * as summaryStore from '../lib/docs-summary-store.mjs';
import * as nodeCrypto from 'node:crypto';
import '../web/i18n.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

function git(cwd, args, env = GIT_ENV) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env, timeout: 20000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r.stdout.trim();
}
function tmpdir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}
function mkRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@e.co']);
  git(dir, ['config', 'user.name', 'T']);
  return dir;
}
const sha256 = (s) => nodeCrypto.createHash('sha256').update(String(s)).digest('hex');
const readsOf = (contents) => (f) => (Object.prototype.hasOwnProperty.call(contents, f) ? contents[f] : null);
const statsOf = (stats) => (f) => (Object.prototype.hasOwnProperty.call(stats, f) ? stats[f] : null);

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const CUSTOM = ['MIGRATION', 'SECURITY'];

/* ---------- L1 纯逻辑（publish-flow.mjs） ---------- */

t('L1-1 清单展开：publishDocFiles(langs, customs) = 4×N + LICENSE + 自定义×N（末尾追加）；无自定义与现状一致', () => {
  const base = flow.publishDocFiles(['cn', 'en']);
  assert.equal(base.length, 9, '现状 4 × 2 + LICENSE.md');
  const withCustom = flow.publishDocFiles(['cn', 'en'], CUSTOM);
  assert.equal(withCustom.length, 13, '4 × 2 + LICENSE.md + 2 自定义 × 2 语言');
  const mig = withCustom.find((f) => f.file === 'MIGRATION.md');
  assert.ok(mig, '清单含 MIGRATION.md');
  assert.deepEqual(
    { key: mig.key, lang: mig.lang, file: mig.file, single: mig.single, custom: mig.custom },
    { key: 'MIGRATION', lang: 'cn', file: 'MIGRATION.md', single: undefined, custom: true },
    '自定义随语言集展开（BUG-20260922-002：默认语言份 lang=首语言，非 single）',
  );
  assert.equal(withCustom[withCustom.length - 3].file, 'MIGRATION_en.md', '逐 KEY 展开其余语言 KEY_<lang>.md');
  assert.equal(withCustom[withCustom.length - 1].file, 'SECURITY_en.md', '逐 KEY 追加在清单末尾');
  assert.deepEqual(flow.publishDocFiles(['cn', 'en'], []), base, '空自定义与现状逐字节一致');
  assert.deepEqual(flow.publishDocFiles(['cn'], ['MIGRATION']).map((f) => f.file), ['README.md', 'CHANGELOG.md', 'FEATURES.md', 'AGENTS.md', 'LICENSE.md', 'MIGRATION.md'], '单语言集同样追加');

  // customDocsOf：版本记录容错读取 + 归一（大写 / 去重保序 / 过滤非法）
  assert.deepEqual(flow.customDocsOf({}), [], '缺失 → []');
  assert.deepEqual(flow.customDocsOf({ customDocs: ['migration', 'SECURITY', 'MIGRATION', 'BAD KEY!', ''] }), ['MIGRATION', 'SECURITY'], '大写归一去重、非法项剔除');
});

t('L1-2 命名校验 normalizeCustomDocName：合法 / .md 省略 / 大写归一；空名 / 超长 / 非法字符 / 保留名 / 重复 / 上限', () => {
  const ok = (raw) => flow.normalizeCustomDocName(raw, { existing: [], langs: ['cn', 'en'] });
  assert.equal(ok('MIGRATION').key, 'MIGRATION');
  assert.equal(ok('migration.md').key, 'MIGRATION', '.md 后缀省略自动补全');
  assert.equal(ok('My-Doc_2').key, 'MY-DOC_2', '大小写归一 + 连字符 / 下划线');
  assert.equal(ok(' MIGRATION.md ').key, 'MIGRATION', '首尾空白容错');

  const errs = [
    ['', /不能为空/],
    ['   ', /不能为空/],
    ['A'.repeat(41), /过长/],
    ['1ABC', /非法字符/],
    ['AB CD', /非法字符/],
    ['A/B.md', /非法字符/, '子目录不支持'],
    ['FOO.txt', /非法字符/, '非 .md 后缀按非法字符'],
    ['README', /保留名/],
    ['readme.md', /保留名/, '大小写归一后命中保留名'],
    ['LICENSE', /保留名/],
    ['README_EN', /保留名|语言集/, '_lang 展开命名空间保留'],
    ['CHANGELOG_cn', /保留名|语言集/],
  ];
  for (const [raw, re, why] of errs) {
    const r = ok(raw);
    assert.equal(r.key, null, `${raw} 应报错`);
    assert.match(r.error, re, why || raw);
  }
  const dup = flow.normalizeCustomDocName('Migration', { existing: ['MIGRATION'], langs: ['cn', 'en'] });
  assert.match(dup.error, /重复/, '与已有自定义文档重复（大写比较）');
  const many = Array.from({ length: 20 }, (_, i) => `DOC${i}`);
  const cap = flow.normalizeCustomDocName('ONEMORE', { existing: many, langs: ['cn', 'en'] });
  assert.match(cap.error, /上限/, '数量上限 20 份');
  // 标准类 KEY 带非语言后缀不属保留名（如 MIGRATION_EN 不展开、不冲突）
  assert.equal(ok('MIGRATION_EN').key, 'MIGRATION_EN');
});

t('L1-3 白名单与派生清单：isPublishDocFile 含自定义及其 _lang 展开；defaultDocFiles 含默认语言份 / restDocFiles 含其余语言份；docFileOf', () => {
  assert.equal(flow.isPublishDocFile('MIGRATION.md', ['cn', 'en'], ['MIGRATION']), true);
  assert.equal(flow.isPublishDocFile('MIGRATION.md', ['cn', 'en'], []), false, '未登记不自证白名单');
  assert.equal(flow.isPublishDocFile('MIGRATION_en.md', ['cn', 'en'], ['MIGRATION']), true, 'BUG-20260922-002：随语言集展开进入白名单');
  assert.equal(flow.isPublishDocFile('MIGRATION_fr.md', ['cn', 'en'], ['MIGRATION']), false, '语言集外不展开');
  assert.equal(flow.isPublishDocFile('migration.md', ['cn', 'en'], ['MIGRATION']), false, '文件名大小写敏感');

  const def = flow.defaultDocFiles(['cn', 'en'], ['MIGRATION']);
  const rest = flow.restDocFiles(['cn', 'en'], ['MIGRATION']);
  assert.equal(def.length, 5, '默认语言 4 类 + 1 自定义默认语言份');
  assert.ok(def.some((f) => f.file === 'MIGRATION.md' && f.custom), 'AI 总结范围含自定义');
  assert.equal(rest.length, 5, 'AI 翻译范围含自定义其余语言份（BUG-20260922-002）');
  assert.ok(rest.some((f) => f.file === 'MIGRATION_en.md' && f.custom));

  assert.equal(flow.docFileOf('MIGRATION', 'cn', ['cn', 'en'], ['MIGRATION']), 'MIGRATION.md');
  assert.equal(flow.docFileOf('README', 'en', ['cn', 'en'], ['MIGRATION']), 'README_en.md', '标准类不受影响');
});

t('L1-4 AI 总结提示词（核心）：自定义并入默认语言文档清单；总数与阶段说明随清单联动；无自定义保持原文', () => {
  const opt = { projectRoot: '/tmp/p', planId: 'BLD-20260922-003', runId: 'sum-20260922-000101-ab01', langs: ['cn', 'en'] };
  const p = flow.buildDocSummaryPrompt({ ...opt, customDocs: CUSTOM });
  assert.ok(p.includes('的 6 个文档（4 类 + 2 自定义 × 1）'), '静态段阶段说明含总数与构成');
  assert.ok(p.includes('不修改本阶段 6 个文档以外的任何文件'), '文件范围约束计数联动');
  assert.ok(p.includes('默认语言文档清单（语言集首语言 cn，共 6 个文档，4 类 + 2 自定义 × 1）：'), '参数区清单计数联动');
  assert.ok(p.includes('- MIGRATION.md（中文 / 自定义）'), '清单逐行列出 MIGRATION');
  assert.ok(p.includes('- SECURITY.md（中文 / 自定义）'), '清单逐行列出 SECURITY');
  assert.ok(p.indexOf('- README.md（中文 / README）') < p.indexOf('- MIGRATION.md（中文 / 自定义）'), '与标准 4 类并列（其后追加）');

  const p0 = flow.buildDocSummaryPrompt(opt);
  assert.ok(p0.includes('的 4 个文档（4 类 × 1）'), '无自定义保持原文口径');
  assert.ok(p0.includes('共 4 个文档，4 类 × 1'), '参数区计数原文');
  assert.ok(!p0.includes('自定义'), '无自定义不出现自定义字样');
});

t('L1-5 AI 翻译提示词：BUG-20260922-002 起自定义进入翻译（基准与目标对应清单均含其余语言份；路径化口径随 BUG-20260923-003）', () => {
  const contents = {};
  for (const f of flow.publishDocFiles(['cn', 'en'])) contents[f.file] = `# ${f.key}\n`;
  contents['MIGRATION.md'] = '# 迁移说明\n';
  const tp = flow.buildDocTranslatePrompt({ projectRoot: '/tmp/p', planId: 'BLD-20260922-003', runId: 'tr-20260922-000101-cd01', langs: ['cn', 'en'], readFile: readsOf(contents), customDocs: ['MIGRATION'] });
  assert.ok(tp.includes('- MIGRATION.md → MIGRATION_en.md（English / MIGRATION / 自定义）'), '翻译目标含自定义其余语言份（基准 = 默认语言 KEY.md）');
  assert.ok(!tp.includes('=====') && !tp.includes('# 迁移说明'), '翻译基准不内嵌全文（BUG-20260923-003 路径化）');
  assert.ok(tp.includes('共 5 个目标文件，4 类 + 1 自定义 × 1 语言，剩余语言 en'), '目标计数随清单联动');
  const tp0 = flow.buildDocTranslatePrompt({ projectRoot: '/tmp/p', planId: 'BLD-20260922-003', langs: ['cn', 'en'], readFile: readsOf(contents) });
  assert.ok(tp0.includes('共 4 个目标文件'), '无自定义翻译目标数不变（4 × (N−1)）');
});

t('L1-6 自定义文档七态：未总结 → 正在总结 → 已总结待审核 → 已审核（hash）；编辑回退；scopeStale 失效', () => {
  const vOf = (files) => ({ review: { files: files || {} }, customDocs: ['MIGRATION'] });
  const find = (r) => r.files.find((f) => f.file === 'MIGRATION.md');
  assert.equal(find(flow.evaluateDocsFlow(vOf(), readsOf({}), {})).state, 'unsummarized', '初始未总结');
  assert.equal(find(flow.evaluateDocsFlow(vOf(), readsOf({}), { summarizing: ['MIGRATION.md'] })).state, 'summarizing', '账本正在总结');
  assert.equal(find(flow.evaluateDocsFlow(vOf(), readsOf({}), { summarized: ['MIGRATION.md'] })).state, 'summarized', '账本已总结待审核');
  const rec = { 'MIGRATION.md': { hash: sha256('# M\n'), at: '2026-09-22T00:00:00Z' } };
  assert.equal(find(flow.evaluateDocsFlow(vOf(rec), readsOf({ 'MIGRATION.md': '# M\n' }), {})).state, 'reviewed', '通过审核（hash 一致）');
  assert.equal(find(flow.evaluateDocsFlow(vOf(rec), readsOf({ 'MIGRATION.md': '# 改\n' }), {})).state, 'summarized', '编辑保存后回退已总结待审核');
  assert.equal(find(flow.evaluateDocsFlow({ review: { files: rec }, customDocs: ['MIGRATION'], docs: { scopeStale: true } }, readsOf({ 'MIGRATION.md': '# M\n' }), {})).state, 'summarized', 'scopeStale 审核失效');
  assert.equal(find(flow.evaluateDocsFlow(vOf(), readsOf({ 'MIGRATION.md': '# 在盘\n' }), {})).state, 'unsummarized', '在盘未总结未审 = 未总结（与四类同口径：人工在盘内容不经 AI 仍显示未总结）');
});

t('L1-7 门禁参与：分组计数 / canFinalize / canCommit / missing 含自定义；canTranslate 与 translateMissing 含自定义默认语言份（BUG-20260922-002 同口径）', () => {
  const contents = {};
  for (const f of flow.publishDocFiles(['cn', 'en'], ['MIGRATION'])) contents[f.file] = `# ${f.key}\n`;
  const files = {};
  for (const f of flow.publishDocFiles(['cn', 'en'], ['MIGRATION'])) files[f.file] = { hash: sha256(contents[f.file]), at: '2026-09-22T00:00:00Z' };
  const v = (rec) => ({ review: { files: rec }, customDocs: ['MIGRATION'] });

  // 只审标准 4 类默认语言（LICENSE / MIGRATION.md 未审）
  const fourDefault = {};
  for (const f of flow.defaultDocFiles(['cn', 'en'])) fourDefault[f.file] = files[f.file];
  let r = flow.evaluateDocsFlow(v(fourDefault), readsOf(contents), {});
  assert.equal(r.defaultFiles.filter((f) => f.custom).length, 1, '自定义默认语言份归默认语言组');
  assert.equal(r.defaultReviewedCount, 4, '默认语言计数分母含自定义（4/6）');
  assert.equal(r.defaultFiles.length, 6, '默认语言组分母 = 4 类 + LICENSE + 自定义默认语言份');
  assert.equal(r.canTranslate, false, 'BUG-20260922-002：自定义默认语言未审锁 AI 翻译（与标准 4 类同口径）');
  assert.ok(r.translateMissing.some((m) => m.file === 'MIGRATION.md'), 'translateMissing 含自定义默认语言份');
  assert.equal(r.canFinalize, false, '自定义未审不可整体完结（全参与）');
  assert.ok(r.missing.some((m) => m.file === 'MIGRATION.md' && m.state === 'unsummarized'), '缺口明细含自定义与状态');

  // 全审（含自定义全部语种）+ 完结（customDocsKey 匹配）→ canCommit
  const finalized = { at: '2026-09-22T01:00:00Z', langsKey: 'cn,en', customDocsKey: 'MIGRATION', files: {} };
  r = flow.evaluateDocsFlow({ review: { files, finalized }, customDocs: ['MIGRATION'] }, readsOf(contents), {});
  assert.equal(r.canFinalize, true, '全审（含自定义）可完结');
  assert.equal(r.canCommit, true, '全审 + 已完结可提交');

  // 自定义文件未在盘：缺口（缺盘不可完结）
  const noMig = { ...contents };
  delete noMig['MIGRATION.md'];
  r = flow.evaluateDocsFlow({ review: { files, finalized }, customDocs: ['MIGRATION'] }, readsOf(noMig), {});
  assert.equal(r.canFinalize, false, '自定义缺盘不可完结');
});

t('L1-8 提交口径与指纹：evaluateDocsState 含自定义（合并门禁联动）；指纹随自定义内容变化；基准检测含自定义', () => {
  const contents = {};
  for (const f of flow.publishDocFiles(['cn', 'en'], ['MIGRATION'])) contents[f.file] = `# ${f.key}\n`;
  const v = { customDocs: ['MIGRATION'] };
  const stNone = flow.evaluateDocsState(v, readsOf({}));
  assert.match(stNone.reasons[0], /共 11 个文件/, '未编写提示文件数 = 4 × 2 + 1 + 自定义 × 2');
  assert.match(stNone.reasons[0], /自定义/, '提示提及自定义文档');

  const rec = { commitHash: 'x', files: {} };
  for (const f of flow.publishDocFiles(['cn', 'en'], ['MIGRATION'])) rec.files[f.file] = sha256(contents[f.file]);
  assert.equal(flow.evaluateDocsState({ ...v, docs: rec }, readsOf(contents)).overall, 'committed', '含自定义全一致为已提交');
  const changed = { ...contents, 'MIGRATION.md': '# 迁移说明（改）\n' };
  assert.equal(flow.evaluateDocsState({ ...v, docs: rec }, readsOf(changed)).overall, 'uncommitted', '自定义内容变化为未提交');

  const items = [{ itemId: 'REQ-20260922-003', commit: 'a'.repeat(40) }];
  const fp1 = flow.publishScopeFingerprint(items, readsOf(contents), ['cn', 'en'], ['MIGRATION']);
  const fp2 = flow.publishScopeFingerprint(items, readsOf(changed), ['cn', 'en'], ['MIGRATION']);
  assert.notEqual(fp1, fp2, '自定义内容参与范围指纹');
  assert.equal(flow.publishScopeFingerprint(items, readsOf(contents), ['cn', 'en']), flow.publishScopeFingerprint(items, readsOf(contents), ['cn', 'en'], []), '无自定义指纹口径兼容');

  const stats = { 'MIGRATION.md': 999, 'MIGRATION_en.md': 50, 'README.md': 100, 'README_en.md': 50 };
  assert.deepEqual(flow.detectBaselineShift(['cn', 'en'], statsOf(stats), ['MIGRATION']).sort(), ['MIGRATION_en.md', 'README_en.md'], 'BUG-20260922-002：自定义 mtime 参与基准检测');
});

/* ---------- L2 数据层 ---------- */

function mkData(tmp) {
  const proj = mkRepo(path.join(tmp, 'proj'));
  fs.writeFileSync(path.join(proj, 'base.txt'), 'base');
  git(proj, ['add', '-A']); git(proj, ['commit', '-m', 'init']);
  core.initData(proj);
  return { proj, dataDir: core.dataDirFrom(proj) };
}

function mkVersion(dataDir, proj) {
  const commitA = git(proj, ['rev-parse', 'HEAD']);
  const reqA = core.createItem(dataDir, { type: 'requirement', title: 'CUS', by: 'test' });
  for (const s of ['accepted', 'in-progress', 'done']) core.setStatus(dataDir, reqA.id, s, { by: 'test' });
  return buildStore.createVersion(dataDir, { items: [{ itemId: reqA.id, commit: commitA }] });
}

t('L2-1 build-store：addCustomDoc / removeCustomDoc 持久化、校验、上限与锁定', () => {
  const { proj, dataDir } = mkData(tmpdir('atb-003-l21-'));
  const v = mkVersion(dataDir, proj);
  let cur = buildStore.addCustomDoc(dataDir, v.id, { name: 'migration.md' });
  assert.deepEqual(cur.customDocs, ['MIGRATION'], '大写归一持久化到 v.customDocs');
  cur = buildStore.addCustomDoc(dataDir, v.id, { name: 'SECURITY' });
  assert.deepEqual(cur.customDocs, ['MIGRATION', 'SECURITY'], '多份追加、顺序保留');
  assert.equal(buildStore.readVersion(dataDir, v.id).customDocs.length, 2, '重新读取回显');

  assert.throws(() => buildStore.addCustomDoc(dataDir, v.id, { name: 'Migration' }), /重复/);
  assert.throws(() => buildStore.addCustomDoc(dataDir, v.id, { name: 'README' }), /保留名/);
  assert.throws(() => buildStore.addCustomDoc(dataDir, v.id, { name: '' }), /不能为空/);
  for (let i = cur.customDocs.length; i < 20; i++) buildStore.addCustomDoc(dataDir, v.id, { name: `DOC${i}` });
  assert.throws(() => buildStore.addCustomDoc(dataDir, v.id, { name: 'ONEMORE' }), /上限/, '上限 20 份');

  cur = buildStore.removeCustomDoc(dataDir, v.id, { key: 'MIGRATION' });
  assert.ok(!cur.customDocs.includes('MIGRATION'), '移除');
  assert.throws(() => buildStore.removeCustomDoc(dataDir, v.id, { key: 'NOPE' }), /不在/);

  // 锁定：merging / 已正式发布（pushed）
  buildStore.beginMerge(dataDir, v.id);
  assert.throws(() => buildStore.removeCustomDoc(dataDir, v.id, { key: 'SECURITY' }), buildStore.BuildConflictError, 'merging 锁定');
  buildStore.finishMerge(dataDir, v.id, { results: [{ itemId: v.items[0].itemId, ok: true }] });
  buildStore.recordPushSuccess(dataDir, v.id, { remote: 'origin', sha: 'b'.repeat(40) });
  assert.throws(() => buildStore.addCustomDoc(dataDir, v.id, { name: 'AFTERPUSH' }), buildStore.BuildConflictError, 'pushed 锁定');
});

t('L2-2 白名单与完结快照：recordDocsReview / recordDocsCommit 放行清单内自定义（含展开文件）；recordDocsFinalize 快照含自定义', () => {
  const { proj, dataDir } = mkData(tmpdir('atb-003-l22-'));
  const v = mkVersion(dataDir, proj);
  const withCus = buildStore.addCustomDoc(dataDir, v.id, { name: 'MIGRATION.md' });
  assert.doesNotThrow(() => buildStore.recordDocsReview(dataDir, withCus.id, { file: 'MIGRATION.md', hash: sha256('# M\n') }), '清单内自定义可审核');
  assert.doesNotThrow(() => buildStore.recordDocsReview(dataDir, withCus.id, { file: 'MIGRATION_en.md', hash: sha256('x') }), 'BUG-20260922-002：展开文件进入审核白名单');
  assert.doesNotThrow(() => buildStore.recordDocsCommit(dataDir, withCus.id, { commitHash: 'a'.repeat(40), files: { 'MIGRATION.md': 'b'.repeat(64) }, scopeFp: 'f' }), '提交记录白名单含自定义');

  const contents = {};
  for (const f of flow.publishDocFiles(['cn', 'en'], ['MIGRATION'])) contents[f.file] = `# ${f.key}\n`;
  const out = buildStore.recordDocsFinalize(dataDir, withCus.id, { langs: ['cn', 'en'], customDocs: ['MIGRATION'], readFile: readsOf(contents) });
  assert.equal(Object.keys(out.review.finalized.files).length, 11, '完结快照 = 4 × 2 + LICENSE + 自定义 × 2');
  assert.equal(out.review.finalized.files['MIGRATION.md'], sha256(contents['MIGRATION.md']));
  assert.equal(out.review.finalized.customDocsKey, 'MIGRATION', 'BUG-20260922-002：完结快照记 customDocsKey');
  const noMig = { ...contents };
  delete noMig['MIGRATION.md'];
  assert.throws(() => buildStore.recordDocsFinalize(dataDir, withCus.id, { langs: ['cn', 'en'], customDocs: ['MIGRATION'], readFile: readsOf(noMig) }), /MIGRATION\.md 不存在或不可读/, '自定义缺盘不可完结');
});

t('L2-3 AI 总结账本：createSummaryRun 含自定义（pending 起步）；markSummaryFile 自定义回执被接受；聚合标记', () => {
  const { dataDir } = mkData(tmpdir('atb-003-l23-'));
  const run = summaryStore.createSummaryRun(dataDir, { verId: 'BLD-20260922-003', owner: 's', langs: ['cn', 'en'], customDocs: CUSTOM });
  assert.equal(Object.keys(run.files).length, 6, '默认语言 4 类 + 2 自定义');
  assert.equal(run.files['MIGRATION.md'], 'pending', '自定义 pending 起步');
  assert.equal(run.files['SECURITY.md'], 'pending');
  assert.doesNotThrow(() => summaryStore.markSummaryFile(dataDir, run.runId, 'MIGRATION.md', 'summarizing'), '自定义回执 summarizing');
  assert.doesNotThrow(() => summaryStore.markSummaryFile(dataDir, run.runId, 'MIGRATION.md', 'summarized'), '自定义回执 summarized');
  assert.equal(summaryStore.summaryRunView(run).counts.total, 6, '进度分母 total 联动');
  summaryStore.finishSummaryRun(dataDir, run.runId, { result: 'done', summary: '完成' });
  const marks = summaryStore.summaryMarksForVer(dataDir, 'BLD-20260922-003');
  assert.ok(marks.summarized.includes('MIGRATION.md'), '聚合标记含自定义');
  // 不传 customDocs：账本不含自定义（现状兼容）
  const plain = summaryStore.createSummaryRun(dataDir, { verId: 'BLD-20260922-003', owner: 's', langs: ['cn', 'en'] });
  assert.equal(Object.keys(plain.files).length, 4, '无自定义账本与现状一致');
  assert.throws(() => summaryStore.markSummaryFile(dataDir, plain.runId, 'MIGRATION.md', 'summarizing'), /非发布文档文件/, '清单外回执拒绝');
  summaryStore.finishSummaryRun(dataDir, plain.runId, { result: 'done', summary: '完成' });
});

/* ---------- L3 服务接口 ---------- */

function req(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 10000,
    }, (rs) => {
      const chunks = [];
      rs.on('data', (c) => chunks.push(c));
      rs.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString() || '{}'); } catch {}
        resolve({ status: rs.statusCode, json, text: buf.toString() });
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (payload) r.write(payload);
    r.end();
  });
}

t('L3 服务接口：添加 / 移除 / 回显 / AI 总结提示词与账本 / 白名单 / 运行中移除拦截 / 提交 pathspec', async () => {
  const tmp = tmpdir('atb-003-serve-');
  const proj = mkRepo(path.join(tmp, 'proj'));
  fs.writeFileSync(path.join(proj, 'base.txt'), 'base');
  git(proj, ['add', '-A']); git(proj, ['commit', '-m', 'init']);
  git(proj, ['switch', '-c', 'dev']);
  fs.writeFileSync(path.join(proj, 'a.txt'), 'A');
  git(proj, ['add', '-A']); git(proj, ['commit', '-m', 'feat: A REQ-20260922-001']);
  const commitA = git(proj, ['rev-parse', 'HEAD']);
  core.initData(proj);
  const dataDir = core.dataDirFrom(proj);
  const reqA = core.createItem(dataDir, { type: 'requirement', title: '条目 A', by: 'test' });
  for (const s of ['accepted', 'in-progress', 'done']) core.setStatus(dataDir, reqA.id, s, { by: 'test' });

  const reg = path.join(tmp, 'reg.json');
  let server = null;
  let port = 0;
  for (let i = 0; i < 6 && !server; i++) {
    const p = 33500 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
      cwd: proj,
      env: { ...process.env, ATB_PORT: String(p), ATB_REGISTRY: reg },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    for (let k = 0; k < 40; k++) {
      await sleep(150);
      try { const h = await req(p, 'GET', '/api/health'); if (h.json && h.json.port === p) { server = child; port = p; break; } } catch {}
      if (child.exitCode !== null) break;
    }
    if (!server) child.kill('SIGTERM');
  }
  assert.ok(server, '服务应启动');
  const P = `?project=${encodeURIComponent(proj)}`;
  try {
    let r = await req(port, 'POST', `/api/build/version${P}`, { items: [{ itemId: reqA.id, commit: commitA }] });
    assert.equal(r.status, 201, `创建版本：${r.text}`);
    const vid = r.json.version.id;

    // 添加自定义文档：合法 / 非法 / 重复
    r = await req(port, 'POST', `/api/build/docs/custom${P}`, { id: vid, op: 'add', name: 'MIGRATION.md' });
    assert.equal(r.status, 200, `添加：${r.text}`);
    assert.deepEqual(r.json.customDocs, ['MIGRATION']);
    r = await req(port, 'POST', `/api/build/docs/custom${P}`, { id: vid, op: 'add', name: 'README' });
    assert.equal(r.status, 400, '保留名 400');
    assert.match(r.json.error || '', /保留名/);
    r = await req(port, 'POST', `/api/build/docs/custom${P}`, { id: vid, op: 'add', name: 'A/B.md' });
    assert.equal(r.status, 400, '子目录 400');
    r = await req(port, 'POST', `/api/build/docs/custom${P}`, { id: vid, op: 'add', name: 'migration' });
    assert.equal(r.status, 400, '重复（大写比较）400');
    assert.match(r.json.error || '', /重复/);

    // publish-plan 回显：customDocs + docsFlow 文件清单（默认语言组、未总结；BUG-20260922-002
    // 起随语言集展开，其余语言份归剩余组、未翻译）
    r = await req(port, 'GET', `/api/build/publish-plan${P}&id=${vid}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.customDocs, ['MIGRATION'], '回显自定义清单');
    const fe = r.json.docsFlow;
    assert.equal(fe.files.length, 11, '4 × 2 + LICENSE + MIGRATION × 2');
    const mig = fe.files.find((f) => f.file === 'MIGRATION.md');
    assert.equal(mig.state, 'unsummarized', '初始未总结');
    assert.equal(mig.isDefault, true, '归默认语言组');
    assert.equal(mig.custom, true, 'custom 标识');
    const migEn = fe.files.find((f) => f.file === 'MIGRATION_en.md');
    assert.equal(migEn.state, 'untranslated', '其余语言份初始未翻译');
    assert.equal(migEn.isDefault, false, '归剩余语言组');

    // AI 总结：提示词并入自定义 + 账本 total 联动
    r = await req(port, 'POST', `/api/build/docs-summary/start${P}`, { id: vid });
    assert.equal(r.status, 200, `AI 总结启动：${r.text}`);
    assert.ok(r.json.prompt.includes('的 5 个文档（4 类 + 1 自定义 × 1）'), '提示词阶段说明含自定义');
    assert.ok(r.json.prompt.includes('- MIGRATION.md（中文 / 自定义）'), '提示词清单含 MIGRATION.md');
    assert.equal(r.json.run.counts.total, 5, 'run 分母 total = 4 + 1');
    const sumRunId = r.json.runId;
    // 运行中禁止移除
    r = await req(port, 'POST', `/api/build/docs/custom${P}`, { id: vid, op: 'remove', key: 'MIGRATION' });
    assert.equal(r.status, 400, '总结运行中移除 400');
    assert.match(r.json.error || '', /运行中/);
    await summaryStore.finishSummaryRun(dataDir, sumRunId, { result: 'done', summary: '完成' });

    // 移除 → 回显 → 再添加（下一轮 AI 总结生效口径）
    r = await req(port, 'POST', `/api/build/docs/custom${P}`, { id: vid, op: 'remove', key: 'MIGRATION' });
    assert.equal(r.status, 200, `移除：${r.text}`);
    assert.deepEqual(r.json.customDocs, []);
    r = await req(port, 'POST', `/api/build/docs/custom${P}`, { id: vid, op: 'add', name: 'MIGRATION' });
    assert.equal(r.status, 200, '再添加');

    // save / GET docs 白名单
    r = await req(port, 'POST', `/api/build/docs/save${P}`, { id: vid, file: 'MIGRATION.md', content: '# 迁移说明\n' });
    assert.equal(r.status, 200, `save MIGRATION.md：${r.text}`);
    assert.equal(r.json.docsFlow.files.find((f) => f.file === 'MIGRATION.md').state, 'unsummarized', '人工在盘未总结未审 = 未总结（与四类同口径）');
    r = await req(port, 'GET', `/api/build/docs${P}&id=${vid}&file=${encodeURIComponent('MIGRATION.md')}`);
    assert.equal(r.status, 200, 'GET docs 白名单含自定义');
    assert.equal(r.json.content, '# 迁移说明\n');
    r = await req(port, 'POST', `/api/build/docs/save${P}`, { id: vid, file: 'NOTIN.md', content: 'x' });
    assert.equal(r.status, 400, '清单外保存拒绝');

    // 全审（标准 4×2 + LICENSE + 自定义全部语种）→ 完结 → 提交（pathspec 含自定义、不夹带业务文件）
    // 顺序：先默认语言组（含 MIGRATION.md / LICENSE.md）后剩余语言（含 MIGRATION_en.md），
    // 保证 mtime 不触发基准回退。BUG-20260922-002：移除→再添加会删除磁盘文件，全部文件统一写盘。
    const all = flow.publishDocFiles(['cn', 'en'], ['MIGRATION']);
    for (const f of [...all.filter((x) => x.lang === 'cn' || x.single), ...all.filter((x) => x.lang === 'en')]) {
      fs.writeFileSync(path.join(proj, f.file), `# ${f.key}${f.lang ? ` ${f.lang}` : ''}\n`);
    }
    for (const f of all) {
      const rr = await req(port, 'POST', `/api/build/docs/review${P}`, { id: vid, file: f.file });
      assert.equal(rr.status, 200, `review ${f.file}：${rr.text}`);
    }
    r = await req(port, 'POST', `/api/build/docs/finalize${P}`, { id: vid });
    assert.equal(r.status, 200, `finalize：${r.text}`);
    fs.writeFileSync(path.join(proj, 'evil.txt'), '不应被夹带');
    r = await req(port, 'POST', `/api/build/docs/commit${P}`, { id: vid });
    assert.equal(r.status, 200, `commit：${r.text}`);
    assert.equal(r.json.files.length, 11, 'pathspec = 4 × 2 + LICENSE + MIGRATION × 2');
    assert.ok(r.json.files.includes('MIGRATION.md'), '自定义进入提交');
    const show = git(proj, ['show', '--name-only', '--pretty=format:', r.json.commitHash]).split('\n').filter(Boolean);
    assert.ok(show.includes('MIGRATION.md') && show.includes('MIGRATION_en.md'), 'git 提交含自定义全部语种');
    assert.ok(!show.includes('evil.txt'), '业务源码不夹带');
  } finally {
    server.kill('SIGTERM');
  }
});

/* ---------- L4 前端静态契约（build.js） ---------- */

function extractFn(source, name) {
  const m = source.match(new RegExp(`  function ${name}\\([a-zA-Z, ]*\\) \\{[\\s\\S]*?\\n  \\}`));
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
    Array.isArray(langs) && langs.length ? langs : flow.DEFAULT_DOC_LANGS,
    Array.isArray(customDocs) ? customDocs : [],
  ),
};

const L4_CTX = {
  pfOf: (v) => v.pf,
  esc: (s) => String(s),
  short: (h) => String(h || '').slice(0, 8),
  fmtTime: () => 't',
  ...FLOW_STUB,
};

const filesStub = (states, customs = ['MIGRATION']) => flow.publishDocFiles(['cn', 'en'], customs).map((f) => ({
  ...f,
  isDefault: f.single || f.lang === 'cn',
  state: states[f.file] || (f.custom ? 'unsummarized' : f.single ? 'unwritten' : f.lang === 'cn' ? 'unsummarized' : 'untranslated'),
}));

t('L4-1 renderDocsPane：＋添加文档按钮 + 内联添加行；自定义行（自定义标识 + 移除入口，每个语言页签一行）；页签计数分母联动', () => {
  const source = fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');
  const html = vmRun([
    extractFn(source, 'summaryBtnText'), extractFn(source, 'translateBtnText'),
    extractFn(source, 'normalizeFlowEval'), extractFn(source, 'translateBtnHtml'),
    extractFn(source, 'finalizeBtnHtml'), extractFn(source, 'commitBtnHtml'),
    extractFn(source, 'docsStageBar'), extractFn(source, 'renderDocsPane'),
  ].join('\n'), L4_CTX, `renderDocsPane({ id: 'BLD-20260922-003', pf: { phase: 'ready',
    addDoc: { open: true, input: 'MIG', err: '文件名不能为空（如 MIGRATION.md）', busy: false },
    plan: { langs: ['cn', 'en'], customDocs: ['MIGRATION'],
      docsFlow: { files: ${JSON.stringify(filesStub({ 'README.md': 'reviewed', 'CHANGELOG.md': 'reviewed', 'FEATURES.md': 'reviewed', 'AGENTS.md': 'reviewed' }))},
        reviewedCount: 4, defaultReviewedCount: 4, restReviewedCount: 0,
        canTranslate: false, translateMissing: [{ file: 'MIGRATION.md', state: 'unsummarized' }], canFinalize: false, finalized: null, canCommit: false,
        baselineShift: [], missing: [{ file: 'README_en.md', state: 'untranslated' }, { file: 'CHANGELOG_en.md', state: 'untranslated' }, { file: 'FEATURES_en.md', state: 'untranslated' }, { file: 'AGENTS_en.md', state: 'untranslated' }, { file: 'LICENSE.md', state: 'unwritten' }, { file: 'MIGRATION.md', state: 'unsummarized' }, { file: 'MIGRATION_en.md', state: 'untranslated' }] },
      summary: null, translate: null, docs: { overall: 'none' } } } })`);
  // 添加入口与内联添加行
  assert.ok(html.includes('＋ 添加文档'), '＋ 添加文档按钮');
  assert.ok(html.includes('data-doc-add-open'), '添加按钮挂点');
  assert.ok(html.includes('data-doc-add-input'), '文件名输入框');
  assert.ok(html.includes('data-doc-add-confirm') && html.includes('data-doc-add-cancel'), '添加 / 取消按钮');
  assert.ok(html.includes('文件名不能为空（如 MIGRATION.md）'), '行内错误提示');
  // 自定义行：默认语言面板内 + 自定义标识 + 移除入口 + 未总结 chip；BUG-20260922-002 起其余
  // 语言面板同样一行（自动展开）
  assert.match(html, /id="bldDocPanel_cn"[^>]*>[\s\S]*?MIGRATION\.md/, 'MIGRATION.md 在默认语言面板');
  assert.match(html, /id="bldDocPanel_en"[^>]*>[\s\S]*?MIGRATION_en\.md/, 'MIGRATION_en.md 在 en 语言面板（自动展开）');
  assert.ok(html.includes('自定义'), '自定义标识');
  assert.ok(html.includes('data-doc-rm="MIGRATION.md"') && html.includes('data-doc-rm="MIGRATION_en.md"'), '两行均有移除入口（整份移除）');
  assert.ok(html.includes('未总结'), '未总结状态 chip');
  // 默认语言页签计数 4/6（分母含 LICENSE + 自定义默认语言份）；en 页签 0/5
  assert.match(html, /data-doc-lang="cn"[\s\S]*?4\/6/, '页签计数分母联动');
  assert.match(html, /data-doc-lang="en"[\s\S]*?0\/5/, 'en 页签分母含自定义展开文件');
  assert.match(html, /文件（11 · 默认语言 4\/6 已审核 · 剩余语言 0\/5 已审核）/, '表头计数联动');
});

t('L4-2 renderDocsPane：AI 总结运行中移除禁用（title 提示）；总结按钮 x/N 分母联动', () => {
  const source = fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');
  const html = vmRun([
    extractFn(source, 'summaryBtnText'), extractFn(source, 'translateBtnText'),
    extractFn(source, 'normalizeFlowEval'), extractFn(source, 'translateBtnHtml'),
    extractFn(source, 'finalizeBtnHtml'), extractFn(source, 'commitBtnHtml'),
    extractFn(source, 'docsStageBar'), extractFn(source, 'renderDocsPane'),
  ].join('\n'), L4_CTX, `renderDocsPane({ id: 'V', pf: { phase: 'ready', addDoc: null,
    plan: { langs: ['cn', 'en'], customDocs: ['MIGRATION'],
      docsFlow: { files: ${JSON.stringify(filesStub({ 'MIGRATION.md': 'summarizing' }))},
        reviewedCount: 0, defaultReviewedCount: 0, restReviewedCount: 0,
        canTranslate: false, translateMissing: [], canFinalize: false, finalized: null, canCommit: false,
        baselineShift: [], missing: [{ file: 'MIGRATION.md', state: 'summarizing' }] },
      summary: { phase: 'running', counts: { summarized: 0, total: 5 }, currentFile: 'MIGRATION.md' },
      translate: null, docs: { overall: 'none' } } } })`);
  assert.match(html, /data-doc-rm="MIGRATION\.md"[^>]*disabled/, '运行中移除按钮禁用');
  assert.match(html, /data-doc-rm="MIGRATION\.md"[^>]*title="AI 总结运行中，暂不可移除"/, '禁用原因 title');
  assert.match(html, /总结中 0\/5/, '总结按钮分母含自定义');
});

t('L4-3 renderReviewModal：自定义文档追加类型页签（BUG-20260922-002 起多语言多栏 x/2），仅通过审核（BUG-20260925-006 移除编辑/保存）', () => {
  const source = fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');
  const html = vmRun([
    extractFn(source, 'sanitizeHtml'), extractFn(source, 'renderMd'), extractFn(source, 'renderReviewModal'),
  ].join('\n'), {
    pfOf: (v) => v.pf, esc: (s) => String(s), ...FLOW_STUB,
  }, `renderReviewModal({ id: 'V', pf: {
    review: { open: true, key: 'MIGRATION', contents: { 'MIGRATION.md': '# 迁移\\n' } },
    plan: { langs: ['cn', 'en'], customDocs: ['MIGRATION'],
      docsFlow: { files: ${JSON.stringify(filesStub({ 'MIGRATION.md': 'summarized' }))}, reviewedCount: 0 } } } })`);
  assert.match(html, /data-review-tab="MIGRATION"[^>]*>MIGRATION（0\/2）/, '自定义类型页签 x/2（按语言计数）');
  const cols = (html.match(/bld-review-col"/g) || []).length;
  assert.equal(cols, 2, '多语言两栏（MIGRATION.md + MIGRATION_en.md）');
  assert.match(html, /MIGRATION\.md[\s\S]{0,160}自定义/, '栏头标注自定义');
  assert.ok(html.includes('data-review-approve="MIGRATION.md"'), '通过审核按钮');
  assert.ok(!html.includes('data-review-save="MIGRATION.md"') && !html.includes('data-review-mode="MIGRATION.md"'), 'BUG-20260925-006：无保存 / 编辑切换');
  assert.ok(html.includes('已总结待审核'), '七态状态文案');
});

t('L4-4 validateCustomDocName 客户端镜像：与服务端同口径', () => {
  const source = fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');
  const vm2 = vm.createContext({
    DOC_KEYS: FLOW_STUB.DOC_KEYS, DOC_SINGLE_KEYS: FLOW_STUB.DOC_SINGLE_KEYS,
    CUSTOM_DOC_KEY_MAX: 40, CUSTOM_DOC_MAX: 20, DEFAULT_DOC_LANGS: ['cn', 'en'],
  });
  vm.runInContext(extractFn(source, 'validateCustomDocName'), vm2);
  const call = (raw, existing) => vm.runInContext(`validateCustomDocName(${JSON.stringify(raw)}, ${JSON.stringify(existing || [])})`, vm2);
  assert.equal(call('migration.md').key, 'MIGRATION');
  assert.equal(call('My-Doc_2').key, 'MY-DOC_2');
  assert.match(call('').error, /不能为空/);
  assert.match(call('A'.repeat(41)).error, /过长/);
  assert.match(call('1ABC').error, /非法字符/);
  assert.match(call('A/B.md').error, /非法字符/);
  assert.match(call('README').error, /保留名/);
  assert.match(call('LICENSE').error, /保留名/);
  assert.match(call('README_EN').error, /保留名|语言集/);
  assert.match(call('Migration', ['MIGRATION']).error, /重复/);
  assert.match(call('X', Array.from({ length: 20 }, (_, i) => `D${i}`)).error, /上限/);
});

/* ---------- L6 i18n ---------- */

t('L6-1 i18n：新增文案中英同步；动态词条 ◇ 占位；往返不变形', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN, EN_DYNAMIC } = I._dict;
  const statics = [
    '＋ 添加文档', '添加', '添加中…', '移除', '移除整份自定义文档（全部语言文件行与磁盘文件一并删除）',
    'AI 总结运行中，暂不可移除', '文件名不能为空（如 MIGRATION.md）', '文件名过长（上限 40 字符）',
    '存在非法字符：仅允许字母开头，字母 / 数字 / 连字符 / 下划线（.md 后缀可省略，自动补全；不支持子目录）',
    '超出自定义文档数量上限（20 份）', '✕ AI 总结运行中，暂不可移除自定义文档',
    '复制 AI 总结提示词到剪贴板，交给 AI Agent 逐文件总结默认语言文档（标准 4 类 + 自定义文档；已审核文件跳过；也可不经 AI 总结直接审查）',
    '把语言集内文档、LICENSE.md 与自定义文档提交到本地 dev 分支（pathspec 限定，不夹带业务源码）',
  ];
  for (const k of statics) assert.ok(typeof EN[k] === 'string' && EN[k], `静态词条缺失：${k}`);
  const dynamics = [
    '与标准发布文档重名：◇（README / CHANGELOG / FEATURES / AGENTS / LICENSE 及 _语言 后缀为保留名）',
    '自定义文档重复：◇ 已在清单中',
    '✕ 添加失败：◇', '已移除自定义文档 ◇（已删除 ◇ 个磁盘文件）', '✕ 移除失败：◇',
  ];
  for (const k of dynamics) assert.ok(k in EN_DYNAMIC, `动态词条缺失：${k}`);
  I.setLang('en');
  assert.equal(I.t('自定义'), 'Custom');
  assert.equal(I.t('＋ 添加文档'), '+ Add document');
  assert.equal(I.t('自定义文档重复：MIGRATION.md 已在清单中'), 'Duplicate custom document: MIGRATION.md is already in the list');
  I.setLang('zh');
  assert.equal(I.t('＋ 添加文档'), '＋ 添加文档');
});

/* ---------- 执行 ---------- */

for (const [name, fn] of cases) {
  await fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
