#!/usr/bin/env node
// BUG-20260922-002 自定义文档支持删除、添加一次随语言集自动展开 —— 分层测试。
// 引入来源：REQ-20260922-003（自定义文档能力的「默认语言单份、不随语言集展开、
// 不进 AI 翻译」实现口径即本单缺陷；该需求 README「待确认 2/3」由本单落定为
// 「随语言集展开 + 全参与（含 AI 翻译）」）。
// 口径（本单落定，与标准 4 类同构）：
//   展开：添加一次 KEY → 默认语言 KEY.md + 其余语言 KEY_<lang>.md，各语言页签自动出现；
//   翻译：其余语言文件进入 AI 翻译（基准 = 对应默认语言 KEY.md），参与 canTranslate 解锁；
//   门禁：三阶段计数 / pathspec / 指纹全参与（与标准 4 类同口径）；完结快照记 customDocsKey；
//   重名：新 KEY 按语言集展开的文件与既有 KEY 展开文件大小写不敏感重名即拦截
//        （MIGRATION_EN ↔ MIGRATION 的 MIGRATION_en.md）；
//   删除：整份移除全部语种——清单退出 + 审核留痕清理 + 磁盘文件删除（不残留孤儿文件）。
// L1 纯逻辑（publish-flow）；L2 数据层（build-store + 账本）；L3 服务接口；L4 前端契约；L6 i18n。
// 用法：node scripts/tests/bug-20260922-002.test.mjs

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
import * as translateStore from '../lib/docs-translate-store.mjs';
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

/* ---------- L1 纯逻辑（publish-flow.mjs） ---------- */

t('L1-1 清单随语言集展开：KEY × N 追加在末尾；空自定义与现状逐字节一致', () => {
  const base = flow.publishDocFiles(['cn', 'en']);
  assert.equal(base.length, 9, '现状 4 × 2 + LICENSE.md');
  const withCustom = flow.publishDocFiles(['cn', 'en'], ['MIGRATION']);
  assert.equal(withCustom.length, 11, '4 × 2 + LICENSE + MIGRATION × 2');
  const migCn = withCustom.find((f) => f.file === 'MIGRATION.md');
  const migEn = withCustom.find((f) => f.file === 'MIGRATION_en.md');
  assert.ok(migCn && migEn, '默认语言与剩余语言文件均在清单');
  assert.deepEqual(
    { key: migCn.key, lang: migCn.lang, file: migCn.file, single: migCn.single, custom: migCn.custom },
    { key: 'MIGRATION', lang: 'cn', file: 'MIGRATION.md', single: undefined, custom: true },
    '默认语言份 = 普通多语言条目形态（lang=首语言，非 single）',
  );
  assert.deepEqual(
    { key: migEn.key, lang: migEn.lang, file: migEn.file, single: migEn.single, custom: migEn.custom },
    { key: 'MIGRATION', lang: 'en', file: 'MIGRATION_en.md', single: undefined, custom: true },
    '其余语言份 = KEY_<lang>.md（与标准 4 类展开同构）',
  );
  assert.deepEqual(flow.publishDocFiles(['cn', 'en'], []), base, '空自定义与现状逐字节一致');
  assert.deepEqual(
    flow.publishDocFiles(['cn'], ['MIGRATION']).map((f) => f.file),
    ['README.md', 'CHANGELOG.md', 'FEATURES.md', 'AGENTS.md', 'LICENSE.md', 'MIGRATION.md'],
    '单语言集只有默认语言一份',
  );
});

t('L1-2 白名单 / 派生清单 / docFileOf：展开文件全参与；默认语言进总结、其余语言进翻译', () => {
  assert.equal(flow.isPublishDocFile('MIGRATION.md', ['cn', 'en'], ['MIGRATION']), true);
  assert.equal(flow.isPublishDocFile('MIGRATION_en.md', ['cn', 'en'], ['MIGRATION']), true, '其余语言文件进入白名单');
  assert.equal(flow.isPublishDocFile('MIGRATION_fr.md', ['cn', 'en'], ['MIGRATION']), false, '语言集外不展开');
  assert.equal(flow.isPublishDocFile('MIGRATION_en.md', ['cn', 'en'], []), false, '未登记不自证白名单');

  const def = flow.defaultDocFiles(['cn', 'en'], ['MIGRATION']);
  const rest = flow.restDocFiles(['cn', 'en'], ['MIGRATION']);
  assert.equal(def.length, 5, 'AI 总结范围 = 默认语言 4 类 + 自定义默认语言份');
  assert.ok(def.some((f) => f.file === 'MIGRATION.md' && f.custom));
  assert.equal(rest.length, 5, 'AI 翻译范围 = 其余语言 4 类 + 自定义其余语言份');
  assert.ok(rest.some((f) => f.file === 'MIGRATION_en.md' && f.custom), '自定义其余语言进入翻译范围');

  assert.equal(flow.docFileOf('MIGRATION', 'cn', ['cn', 'en'], ['MIGRATION']), 'MIGRATION.md', 'docFileOf 默认语言份');
  assert.equal(flow.docFileOf('MIGRATION', 'en', ['cn', 'en'], ['MIGRATION']), 'MIGRATION_en.md', 'docFileOf 按语言展开');
  assert.equal(flow.docFileOf('MIGRATION', 'fr', ['cn', 'en'], ['MIGRATION']), null, '语言集外无文件');
  assert.equal(flow.docFileOf('README', 'en', ['cn', 'en'], ['MIGRATION']), 'README_en.md', '标准类不受影响');
});

t('L1-3 展开重名拦截：MIGRATION_EN 之类的手工逐语种 workaround 不再可行；单语言集不冲突；常规互不冲突', () => {
  const hit = flow.normalizeCustomDocName('MIGRATION_EN', { existing: ['MIGRATION'], langs: ['cn', 'en'] });
  assert.equal(hit.key, null, '与 MIGRATION 展开文件重名应拦截');
  assert.match(hit.error, /重复/, '报错口径沿用重名句式');
  assert.match(hit.error, /MIGRATION/, '报错指明冲突来源');

  const reverse = flow.normalizeCustomDocName('MIGRATION', { existing: ['MIGRATION_EN'], langs: ['cn', 'en'] });
  assert.equal(reverse.key, null, '反向同理：已有 _LANG 形态 KEY 时新增基础 KEY 也冲突');

  const single = flow.normalizeCustomDocName('MIGRATION_EN', { existing: ['MIGRATION'], langs: ['cn'] });
  assert.equal(single.key, 'MIGRATION_EN', '单语言集无展开后缀，不冲突');

  assert.equal(flow.normalizeCustomDocName('SECURITY', { existing: ['MIGRATION'], langs: ['cn', 'en'] }).key, 'SECURITY', '常规命名互不冲突');
  assert.match(flow.normalizeCustomDocName('Migration', { existing: ['MIGRATION'], langs: ['cn', 'en'] }).error, /重复/, '直接重复保持既有拦截');

  // 辅助：清单级冲突检测（saveDocLangs 校验用）
  assert.ok(flow.customDocsExpandConflict(['MIGRATION', 'MIGRATION_EN'], ['cn', 'en']), '语言集扩展后冲突可检出');
  assert.equal(flow.customDocsExpandConflict(['MIGRATION', 'SECURITY'], ['cn', 'en']), null, '无冲突返回 null');
});

t('L1-4 AI 翻译提示词：目标与基准对应清单含自定义；计数随清单联动；无自定义保持原文（基准路径化口径随 BUG-20260923-003）', () => {
  const contents = {};
  for (const f of flow.publishDocFiles(['cn', 'en'], ['MIGRATION'])) contents[f.file] = `# ${f.key} ${f.lang || ''}\n`;
  contents['MIGRATION.md'] = '# 迁移说明\n';
  const tp = flow.buildDocTranslatePrompt({
    projectRoot: '/tmp/p', planId: 'BLD-20260922-001', runId: 'tr-20260922-000101-ab01',
    langs: ['cn', 'en'], readFile: readsOf(contents), customDocs: ['MIGRATION'],
  });
  assert.ok(tp.includes('- MIGRATION.md → MIGRATION_en.md（English / MIGRATION / 自定义）'), '对应清单含自定义其余语言文件（基准 = 默认语言 KEY.md）');
  assert.ok(!tp.includes('=====') && !tp.includes('# 迁移说明'), '基准全文不内嵌（BUG-20260923-003 路径化口径）');
  assert.ok(tp.includes('共 5 个目标文件，4 类 + 1 自定义 × 1 语言，剩余语言 en'), '目标计数与构成随清单联动');

  const tp0 = flow.buildDocTranslatePrompt({
    projectRoot: '/tmp/p', planId: 'BLD-20260922-001', runId: 'tr-20260922-000101-ab01',
    langs: ['cn', 'en'], readFile: readsOf(contents),
  });
  assert.ok(tp0.includes('共 4 个目标文件，4 类 × 1 语言，剩余语言 en'), '无自定义保持原文口径');
  assert.ok(!tp0.includes('MIGRATION'), '无自定义不出现自定义字样');
});

t('L1-5 基准变更检测含自定义：默认语言 KEY.md 更新 → KEY_<lang>.md 回退未翻译', () => {
  const stats = { 'MIGRATION.md': 999, 'MIGRATION_en.md': 50 };
  assert.deepEqual(flow.detectBaselineShift(['cn', 'en'], statsOf(stats), ['MIGRATION']), ['MIGRATION_en.md'], '自定义基准变更检出');
  const mixed = { 'MIGRATION.md': 999, 'MIGRATION_en.md': 50, 'README.md': 100, 'README_en.md': 50 };
  assert.deepEqual(
    flow.detectBaselineShift(['cn', 'en'], statsOf(mixed), ['MIGRATION']).sort(),
    ['MIGRATION_en.md', 'README_en.md'],
    '与标准 4 类同屏检出',
  );
  assert.deepEqual(flow.detectBaselineShift(['cn', 'en'], statsOf({ 'README.md': 100, 'README_en.md': 50 })), ['README_en.md'], '两参调用（无自定义）不回归');
});

t('L1-6 七态状态机：自定义其余语言文件走翻译分支（未翻译 → 正在翻译 → 已翻译待审核 → 已审核；基准变更回退）', () => {
  const vOf = (files, stat) => ({ review: { files: files || {} }, customDocs: ['MIGRATION'], ...(stat ? { __stat: stat } : {}) });
  const find = (r) => r.files.find((f) => f.file === 'MIGRATION_en.md');
  const opts = (stats) => ({ statFile: statsOf(stats || {}) });
  assert.equal(find(flow.evaluateDocsFlow(vOf(), readsOf({}), {}, opts())).state, 'untranslated', '初始未翻译');
  assert.equal(find(flow.evaluateDocsFlow(vOf(), readsOf({}), { translating: ['MIGRATION_en.md'] }, opts())).state, 'translating', '账本正在翻译');
  assert.equal(find(flow.evaluateDocsFlow(vOf(), readsOf({}), { translated: ['MIGRATION_en.md'] }, opts())).state, 'translated', '账本已翻译待审核');
  const rec = { 'MIGRATION_en.md': { hash: sha256('# M\n'), at: '2026-09-22T00:00:00Z' } };
  assert.equal(find(flow.evaluateDocsFlow(vOf(rec), readsOf({ 'MIGRATION_en.md': '# M\n' }), {}, opts())).state, 'reviewed', '通过审核（hash 一致）');
  assert.equal(
    find(flow.evaluateDocsFlow(vOf(rec), readsOf({ 'MIGRATION_en.md': '# M\n' }), {}, opts({ 'MIGRATION.md': 999, 'MIGRATION_en.md': 50 }))).state,
    'untranslated',
    '基准（MIGRATION.md）更新 → 回退未翻译',
  );
  // 分组：自定义默认语言归默认组、其余语言归剩余组
  const r = flow.evaluateDocsFlow(vOf(), readsOf({}), {}, opts());
  assert.ok(r.defaultFiles.some((f) => f.file === 'MIGRATION.md'), '默认语言份归默认组');
  assert.ok(r.restFiles.some((f) => f.file === 'MIGRATION_en.md'), '其余语言份归剩余组');
});

t('L1-7 门禁参与：自定义默认语言未审锁 AI 翻译（translateMissing 含它）；全参与完结 / 提交；完结快照 customDocsKey 失效', () => {
  const contents = {};
  for (const f of flow.publishDocFiles(['cn', 'en'], ['MIGRATION'])) contents[f.file] = `# ${f.key}\n`;
  const hashOf = {};
  for (const f of flow.publishDocFiles(['cn', 'en'], ['MIGRATION'])) hashOf[f.file] = { hash: sha256(contents[f.file]), at: '2026-09-22T00:00:00Z' };
  const v = (rec, finalized) => ({ review: { files: rec, ...(finalized ? { finalized } : {}) }, customDocs: ['MIGRATION'] });

  // 只审标准 4 类默认语言（LICENSE / MIGRATION.md 未审）
  const fourDefault = {};
  for (const f of flow.defaultDocFiles(['cn', 'en'])) fourDefault[f.file] = hashOf[f.file];
  let r = flow.evaluateDocsFlow(v(fourDefault), readsOf(contents), {});
  assert.equal(r.canTranslate, false, '自定义默认语言未审锁 AI 翻译（与标准 4 类同口径）');
  assert.ok(r.translateMissing.some((m) => m.file === 'MIGRATION.md'), 'translateMissing 含自定义默认语言文件');

  // 默认语言全审（4 类 + MIGRATION.md）→ 可翻译
  const defAll = { ...fourDefault, 'MIGRATION.md': hashOf['MIGRATION.md'] };
  r = flow.evaluateDocsFlow(v(defAll), readsOf(contents), {});
  assert.equal(r.canTranslate, true, '默认语言全审（含自定义）解锁翻译');

  // 全审（含 MIGRATION_en.md）即 canCommit（BUG-20260926-002：完结门禁移除，快照仅作历史字段被忽略）
  const finalizedOkRec = { at: '2026-09-22T01:00:00Z', langsKey: 'cn,en', customDocsKey: 'MIGRATION', files: {} };
  r = flow.evaluateDocsFlow(v(hashOf, finalizedOkRec), readsOf(contents), {});
  assert.ok(!('canFinalize' in r), 'BUG-20260926-002：canFinalize 字段随完结阶段移除');
  assert.equal(r.canCommit, true, '全审即可提交（完结快照被忽略）');

  // customDocsKey 不匹配的历史完结记录同样被忽略：门禁只看全审
  const finalizedOld = { at: '2026-09-22T01:00:00Z', langsKey: 'cn,en', customDocsKey: 'MIGRATION,OTHER', files: {} };
  r = flow.evaluateDocsFlow(v(hashOf, finalizedOld), readsOf(contents), {});
  assert.equal(r.canCommit, true, '旧完结记录不影响新门禁（全审即放行）');

  // 存量兼容：无 customDocsKey 字段的旧完结记录被忽略，全审即放行
  const finalizedLegacy = { at: '2026-09-22T01:00:00Z', langsKey: 'cn,en', files: {} };
  const plainHash = {};
  for (const f of flow.publishDocFiles(['cn', 'en'])) plainHash[f.file] = { hash: sha256(`# ${f.key}\n`), at: 't' };
  const plainContents = {};
  for (const f of flow.publishDocFiles(['cn', 'en'])) plainContents[f.file] = `# ${f.key}\n`;
  r = flow.evaluateDocsFlow({ review: { files: plainHash, finalized: finalizedLegacy } }, readsOf(plainContents), {});
  assert.equal(r.canCommit, true, '存量完结记录（无 customDocsKey、无自定义）不影响提交');
});

t('L1-8 提交口径 / 指纹：evaluateDocsState 计数含展开文件；指纹随其余语言内容变化', () => {
  const contents = {};
  for (const f of flow.publishDocFiles(['cn', 'en'], ['MIGRATION'])) contents[f.file] = `# ${f.key}\n`;
  const stNone = flow.evaluateDocsState({ customDocs: ['MIGRATION'] }, readsOf({}));
  assert.match(stNone.reasons[0], /共 11 个文件/, '文件数 = 4 × 2 + LICENSE + 自定义 × 2');
  assert.match(stNone.reasons[0], /自定义/, '提示提及自定义文档');

  const items = [{ itemId: 'REQ-20260922-003', commit: 'a'.repeat(40) }];
  const fp1 = flow.publishScopeFingerprint(items, readsOf(contents), ['cn', 'en'], ['MIGRATION']);
  const changed = { ...contents, 'MIGRATION_en.md': '# Migration (changed)\n' };
  const fp2 = flow.publishScopeFingerprint(items, readsOf(changed), ['cn', 'en'], ['MIGRATION']);
  assert.notEqual(fp1, fp2, '自定义其余语言内容参与范围指纹');
});

/* ---------- L2 数据层（build-store + 账本） ---------- */

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

t('L2-1 addCustomDoc：展开重名拦截；saveDocLangs 语言集扩展冲突拦截', () => {
  const { proj, dataDir } = mkData(tmpdir('atb-002-l21-'));
  const v = mkVersion(dataDir, proj);
  buildStore.addCustomDoc(dataDir, v.id, { name: 'MIGRATION' });
  assert.throws(() => buildStore.addCustomDoc(dataDir, v.id, { name: 'MIGRATION_EN' }), /重复/, '展开重名拦截（手工逐语种 workaround）');
  assert.doesNotThrow(() => buildStore.addCustomDoc(dataDir, v.id, { name: 'SECURITY' }), '常规命名不受影响');

  // 语言集扩展冲突：单语言集下 MIGRATION 与 MIGRATION_FR 合法共存，扩展语言集后撞名 → 拒绝
  const tmp2 = tmpdir('atb-002-l21b-');
  const d2 = mkData(tmp2);
  const v2 = mkVersion(d2.dataDir, d2.proj);
  buildStore.saveDocLangs(d2.dataDir, v2.id, { langs: ['cn'] });
  buildStore.addCustomDoc(d2.dataDir, v2.id, { name: 'MIGRATION' });
  buildStore.addCustomDoc(d2.dataDir, v2.id, { name: 'MIGRATION_FR' });
  assert.throws(() => buildStore.saveDocLangs(d2.dataDir, v2.id, { langs: ['cn', 'fr'] }), /重名|重复/, '语言集扩展导致展开撞名被拒绝');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d2.dataDir, 'runtime', 'builds', 'versions', v2.id, 'version.json'), 'utf8')).langs, ['cn'], '拒绝后语言集不变');
});

t('L2-2 removeCustomDoc：整份移除全部语种（清单退出 + 审核留痕清理 + 磁盘文件删除）；再添加不复活已审核', () => {
  const { proj, dataDir } = mkData(tmpdir('atb-002-l22-'));
  const v = mkVersion(dataDir, proj);
  buildStore.addCustomDoc(dataDir, v.id, { name: 'MIGRATION' });
  fs.writeFileSync(path.join(proj, 'MIGRATION.md'), '# 迁移\n');
  fs.writeFileSync(path.join(proj, 'MIGRATION_en.md'), '# Migration\n');
  buildStore.recordDocsReview(dataDir, v.id, { file: 'MIGRATION.md', hash: sha256('# 迁移\n') });
  buildStore.recordDocsReview(dataDir, v.id, { file: 'MIGRATION_en.md', hash: sha256('# Migration\n') });

  const cur = buildStore.removeCustomDoc(dataDir, v.id, { key: 'MIGRATION', projectRoot: proj });
  assert.ok(!cur.customDocs.includes('MIGRATION'), '清单移除');
  assert.ok(!fs.existsSync(path.join(proj, 'MIGRATION.md')), '默认语言磁盘文件已删除');
  assert.ok(!fs.existsSync(path.join(proj, 'MIGRATION_en.md')), '其余语言磁盘文件一并删除（不残留孤儿文件）');
  assert.ok(!cur.review?.files?.['MIGRATION.md'] && !cur.review?.files?.['MIGRATION_en.md'], '审核留痕清理');

  // 再添加同 KEY：不因旧审核记录复活「已审核」
  buildStore.addCustomDoc(dataDir, v.id, { name: 'MIGRATION' });
  const r = flow.evaluateDocsFlow(buildStore.readVersion(dataDir, v.id), readsOf({}), {});
  assert.equal(r.files.find((f) => f.file === 'MIGRATION.md').state, 'unsummarized', '再添加从未总结起步');

  assert.throws(() => buildStore.removeCustomDoc(dataDir, v.id, { key: 'NOPE' }), /不在/);
  // merging / 发布确认（正式发布）锁定保持（BUG-20260928-005 起推送不锁定）
  buildStore.beginMerge(dataDir, v.id);
  assert.throws(() => buildStore.removeCustomDoc(dataDir, v.id, { key: 'MIGRATION' }), buildStore.BuildConflictError, 'merging 锁定');
  buildStore.finishMerge(dataDir, v.id, { results: [{ itemId: v.items[0].itemId, ok: true }] });
  buildStore.recordPushSuccess(dataDir, v.id, { remote: 'origin', sha: 'b'.repeat(40) });
  buildStore.recordReleaseConfirm(dataDir, v.id, { runId: 'BPUB-test' });
  assert.throws(() => buildStore.removeCustomDoc(dataDir, v.id, { key: 'MIGRATION' }), buildStore.BuildConflictError, '发布确认后锁定');
});

t('L2-3 recordDocsFinalize 随完结阶段移除；审核白名单仍放行展开文件', () => {
  const { proj, dataDir } = mkData(tmpdir('atb-002-l23-'));
  const v = mkVersion(dataDir, proj);
  buildStore.addCustomDoc(dataDir, v.id, { name: 'MIGRATION' });
  assert.doesNotThrow(() => buildStore.recordDocsReview(dataDir, v.id, { file: 'MIGRATION_en.md', hash: sha256('x') }), '展开文件进入审核白名单');

  assert.ok(!('recordDocsFinalize' in buildStore), 'BUG-20260926-002：完结固化接口随完结阶段移除');
});

t('L2-4 账本：总结账本只装默认语言份；翻译账本装其余语言份且可回执', () => {
  const { dataDir } = mkData(tmpdir('atb-002-l24-'));
  const sum = summaryStore.createSummaryRun(dataDir, { verId: 'BLD-20260922-001', owner: 's', langs: ['cn', 'en'], customDocs: ['MIGRATION'] });
  assert.equal(Object.keys(sum.files).length, 5, '总结账本 = 4 类默认语言 + MIGRATION.md');
  assert.ok(!('MIGRATION_en.md' in sum.files), '总结账本不含其余语言份');
  summaryStore.finishSummaryRun(dataDir, sum.runId, { result: 'done', summary: '完成' });

  const tr = translateStore.createTranslateRun(dataDir, { verId: 'BLD-20260922-001', owner: 't', langs: ['cn', 'en'], customDocs: ['MIGRATION'] });
  assert.equal(Object.keys(tr.files).length, 5, '翻译账本 = 4 类其余语言 + MIGRATION_en.md');
  assert.equal(tr.files['MIGRATION_en.md'], 'pending', '自定义其余语言 pending 起步');
  assert.doesNotThrow(() => translateStore.markTranslateFile(dataDir, tr.runId, 'MIGRATION_en.md', 'translating'), '自定义翻译回执被接受');
  assert.doesNotThrow(() => translateStore.markTranslateFile(dataDir, tr.runId, 'MIGRATION_en.md', 'translated'), '自定义翻译完成回执被接受');
  translateStore.finishTranslateRun(dataDir, tr.runId, { result: 'done', summary: '完成' });
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

t('L3 服务接口：添加一次全语种展开 → 全审 → AI 翻译含自定义 → 整份移除（磁盘 + removedFiles）', async () => {
  const tmp = tmpdir('atb-002-serve-');
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

    // 添加一次：全语种展开（docsFlow 文件清单）
    r = await req(port, 'POST', `/api/build/docs/custom${P}`, { id: vid, op: 'add', name: 'MIGRATION' });
    assert.equal(r.status, 200, `添加：${r.text}`);
    r = await req(port, 'GET', `/api/build/publish-plan${P}&id=${vid}`);
    const fe = r.json.docsFlow;
    assert.equal(fe.files.length, 11, '清单 = 4 × 2 + LICENSE + MIGRATION × 2');
    assert.ok(fe.files.some((f) => f.file === 'MIGRATION.md' && f.isDefault), '默认语言份归默认组');
    assert.ok(fe.files.some((f) => f.file === 'MIGRATION_en.md' && !f.isDefault), '其余语言份归剩余组');

    // 手工逐语种 workaround：展开重名 400
    r = await req(port, 'POST', `/api/build/docs/custom${P}`, { id: vid, op: 'add', name: 'MIGRATION_EN' });
    assert.equal(r.status, 400, '展开重名 400');
    assert.match(r.json.error || '', /重复/);

    // 逐文件写盘 + 审核（先默认语言组后剩余语言，避免 mtime 基准回退）
    const all = flow.publishDocFiles(['cn', 'en'], ['MIGRATION']);
    for (const f of [...all.filter((x) => x.lang === 'cn' || x.single), ...all.filter((x) => x.lang === 'en')]) {
      fs.writeFileSync(path.join(proj, f.file), `# ${f.key}${f.lang ? ` ${f.lang}` : ''}\n`);
    }
    for (const f of all) {
      const rr = await req(port, 'POST', `/api/build/docs/review${P}`, { id: vid, file: f.file });
      assert.equal(rr.status, 200, `review ${f.file}：${rr.text}`);
    }

    // AI 翻译启动（canTranslate 含自定义默认语言全审）：提示词与账本含自定义
    r = await req(port, 'POST', `/api/build/docs-translate/start${P}`, { id: vid });
    assert.equal(r.status, 200, `AI 翻译启动：${r.text}`);
    assert.ok(r.json.prompt.includes('- MIGRATION.md → MIGRATION_en.md（English / MIGRATION / 自定义）'), '翻译目标含自定义');
    assert.ok(!r.json.prompt.includes('====='), '翻译基准不内嵌全文（BUG-20260923-003 路径化）');
    assert.equal(r.json.run.counts.total, 5, '翻译账本 total = 4 + 1 自定义');
    translateStore.finishTranslateRun(dataDir, r.json.runId, { result: 'done', summary: '完成' });

    // 提交 pathspec 含自定义全部语种（BUG-20260926-002：全审即放行，无完结步）
    r = await req(port, 'POST', `/api/build/docs/commit${P}`, { id: vid });
    assert.equal(r.status, 200, `commit：${r.text}`);
    assert.ok(r.json.files.includes('MIGRATION.md') && r.json.files.includes('MIGRATION_en.md'), 'pathspec 含自定义全部语种');
    const show = git(proj, ['show', '--name-only', '--pretty=format:', r.json.commitHash]).split('\n').filter(Boolean);
    assert.ok(show.includes('MIGRATION.md') && show.includes('MIGRATION_en.md'), 'git 提交含自定义全部语种文件');

    // 整份移除：磁盘文件删除 + removedFiles 响应 + 清单联动
    r = await req(port, 'POST', `/api/build/docs/custom${P}`, { id: vid, op: 'remove', key: 'MIGRATION' });
    assert.equal(r.status, 200, `移除：${r.text}`);
    assert.ok(r.json.removedFiles.includes('MIGRATION.md') && r.json.removedFiles.includes('MIGRATION_en.md'), '响应报告已删除文件');
    assert.ok(!fs.existsSync(path.join(proj, 'MIGRATION.md')), '磁盘 MIGRATION.md 已删除');
    assert.ok(!fs.existsSync(path.join(proj, 'MIGRATION_en.md')), '磁盘 MIGRATION_en.md 已删除');
    r = await req(port, 'GET', `/api/build/publish-plan${P}&id=${vid}`);
    assert.equal(r.json.docsFlow.files.length, 9, '移除后清单回到 4 × 2 + LICENSE');
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
};

const filesStub = (states, customs = ['MIGRATION']) => flow.publishDocFiles(['cn', 'en'], customs).map((f) => ({
  ...f,
  isDefault: f.single || f.lang === 'cn',
  state: states[f.file] || (f.custom ? (f.lang === 'cn' ? 'unsummarized' : 'untranslated') : f.single ? 'unwritten' : f.lang === 'cn' ? 'unsummarized' : 'untranslated'),
}));

t('L4-1 docFilesOf 镜像展开 + customDocKeyOfFile 反推 + validateCustomDocName 冲突镜像', () => {
  const source = fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');
  const ctx = vm.createContext({ ...FLOW_STUB, CUSTOM_DOC_KEY_MAX: 40, CUSTOM_DOC_MAX: 20 });
  vm.runInContext([
    extractFn(source, 'docFilesOf'), extractFn(source, 'customDocKeyOfFile'), extractFn(source, 'validateCustomDocName'),
  ].join('\n'), ctx);
  const files = vmRun('', ctx, `docFilesOf(['cn','en'], ['MIGRATION'])`);
  assert.ok(files.some((f) => f.file === 'MIGRATION.md' && f.lang === 'cn' && f.custom), '镜像：默认语言份');
  assert.ok(files.some((f) => f.file === 'MIGRATION_en.md' && f.lang === 'en' && f.custom), '镜像：其余语言份');
  assert.equal(vmRun('', ctx, `customDocKeyOfFile({ langs: ['cn','en'], customDocs: ['MIGRATION'] }, 'MIGRATION_en.md')`), 'MIGRATION', '从展开文件名反推整份 KEY');
  assert.equal(vmRun('', ctx, `customDocKeyOfFile({ langs: ['cn','en'], customDocs: ['MIGRATION'] }, 'README_en.md')`), null, '非自定义文件返回 null');
  assert.match(vmRun('', ctx, `validateCustomDocName('MIGRATION_EN', ['MIGRATION'], ['cn','en']).error`), /重复/, '客户端镜像：展开重名拦截');
  assert.equal(vmRun('', ctx, `validateCustomDocName('SECURITY', ['MIGRATION'], ['cn','en']).key`), 'SECURITY', '常规命名放行');
});

t('L4-2 renderDocsPane：自定义行出现在每个语言页签；en 行走翻译态 chip；移除按钮挂 KEY 反推', () => {
  const source = fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');
  const L4_CTX = {
    pfOf: (v) => v.pf, esc: (s) => String(s), short: (h) => String(h || '').slice(0, 8), fmtTime: () => 't',
    ...FLOW_STUB,
    docFilesOf: (langs, customDocs) => flow.publishDocFiles(
      Array.isArray(langs) && langs.length ? langs : flow.DEFAULT_DOC_LANGS,
      Array.isArray(customDocs) ? customDocs : [],
    ),
  };
  const html = vmRun([
    extractFn(source, 'summaryBtnText'), extractFn(source, 'translateBtnText'),
    extractFn(source, 'normalizeFlowEval'), extractFn(source, 'translateBtnHtml'),
    extractFn(source, 'commitBtnHtml'),
    extractFn(source, 'docsStageBar'), extractFn(source, 'renderDocsPane'),
  ].join('\n'), L4_CTX, `renderDocsPane({ id: 'V', pf: { phase: 'ready', addDoc: null,
    plan: { langs: ['cn', 'en'], customDocs: ['MIGRATION'],
      docsFlow: { files: ${JSON.stringify(filesStub({ 'MIGRATION.md': 'summarized', 'MIGRATION_en.md': 'translated' }))},
        reviewedCount: 0, defaultReviewedCount: 0, restReviewedCount: 0,
        canTranslate: false, translateMissing: [], canCommit: false,
        baselineShift: [], missing: [] },
      summary: null, translate: null, docs: { overall: 'none' } } } })`);
  assert.match(html, /id="bldDocPanel_cn"[^>]*>[\s\S]*?MIGRATION\.md/, '默认语言面板含 MIGRATION.md');
  assert.match(html, /id="bldDocPanel_en"[^>]*>[\s\S]*?MIGRATION_en\.md/, 'en 面板含 MIGRATION_en.md（自动展开，无需二次添加）');
  assert.match(html, /data-doc-rm="MIGRATION_en\.md"/, 'en 行同样有移除入口（整份移除）');
  assert.match(html, /文件（11 · 默认语言 0\/6 已审核 · 剩余语言 0\/5 已审核）/, '表头计数按新清单联动');
});

t('L4-3 renderReviewModal：自定义页签多语言多栏（x/2），每栏可通过审核（BUG-20260925-006 起只读核对，无编辑 / 保存）', () => {
  const source = fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');
  const html = vmRun([
    extractFn(source, 'sanitizeHtml'), extractFn(source, 'renderMd'), extractFn(source, 'renderReviewModal'),
  ].join('\n'), {
    pfOf: (v) => v.pf, esc: (s) => String(s), ...FLOW_STUB,
    docFilesOf: (langs, customDocs) => flow.publishDocFiles(
      Array.isArray(langs) && langs.length ? langs : flow.DEFAULT_DOC_LANGS,
      Array.isArray(customDocs) ? customDocs : [],
    ),
  }, `renderReviewModal({ id: 'V', pf: {
    review: { open: true, key: 'MIGRATION', contents: { 'MIGRATION.md': '# 迁移\\n', 'MIGRATION_en.md': '# Migration\\n' } },
    plan: { langs: ['cn', 'en'], customDocs: ['MIGRATION'],
      docsFlow: { files: ${JSON.stringify(filesStub({}))}, reviewedCount: 0 } } } })`);
  assert.match(html, /data-review-tab="MIGRATION"[^>]*>MIGRATION（0\/2）/, '自定义类型页签 x/2（按语言计数）');
  assert.ok(html.includes('data-review-approve="MIGRATION_en.md"'), '其余语言栏可通过审核');
  assert.ok(!html.includes('data-review-save="MIGRATION_en.md"') && !html.includes('data-review-mode="MIGRATION_en.md"'), 'BUG-20260925-006：其余语言栏无编辑 / 保存（修正走重新④AI翻译）');
  assert.match(html, /MIGRATION_en\.md[\s\S]{0,200}自定义/, '栏头标注自定义');
});

/* ---------- L6 i18n ---------- */

t('L6-1 i18n：新增 / 变更文案中英同步（◇ 占位动态词条）', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN, EN_DYNAMIC } = I._dict;
  const statics = [
    '移除整份自定义文档（全部语言文件行与磁盘文件一并删除）',
  ];
  for (const k of statics) assert.ok(typeof EN[k] === 'string' && EN[k], `静态词条缺失：${k}`);
  const dynamics = [
    '自定义文档重复：◇.md 展开后与自定义文档 ◇ 的 ◇ 重名（自定义文档添加一次即随语言集自动展开）',
    '✓ 已添加 ◇（随语言集自动展开 ◇ 个语言文件，其余语言由「AI 翻译」产出）',
    '已移除自定义文档 ◇（已删除 ◇ 个磁盘文件）',
  ];
  for (const k of dynamics) assert.ok(k in EN_DYNAMIC, `动态词条缺失：${k}`);
  I.setLang('en');
  assert.equal(I.t('已移除自定义文档 MIGRATION（已删除 2 个磁盘文件）'), 'Removed custom document MIGRATION (2 disk files deleted)');
  I.setLang('zh');
});

/* ---------- 执行 ---------- */

for (const [name, fn] of cases) {
  await fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
