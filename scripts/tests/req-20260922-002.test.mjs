#!/usr/bin/env node
// REQ-20260922-002 发布看板「文档编写」页支持 LICENSE.md —— 分层测试。
// 口径（design.md 定稿）：A1 单文件 LICENSE.md（不随语言集展开）；B 不进 AI 总结 / AI 翻译
//（提示词与账本不含 LICENSE，仅人工在审查对话框编写）；C 必选（进 canFinalize / canCommit
// 门禁与提交 pathspec）；D 完结核对新增人工项；E 仅识别 LICENSE.md（无扩展名 / .txt /
// _<lang>.md 均清单外）。
// L1 纯逻辑（publish-flow：清单 / 白名单 / AI 范围排除 / LICENSE 三态 / 分组与门禁 / 提交口径 /
//    指纹 / 基准检测不涉及）；
// L2 数据层（build-store 白名单与完结快照；summary / translate 账本不含 LICENSE）；
// L3 服务接口（publish-plan 计数、save / review 白名单、finalize / commit 门禁与 pathspec、
//    AI 翻译解锁不受 LICENSE 锁）；
// L4 前端静态契约（renderDocsPane LICENSE 行 + 不分语言标签 + 缺口；审查对话框 LICENSE 页签
//    单栏；完结核对新核对项）；
// L6 i18n（新增文案中英同步；往返不变形）。
// 用法：node scripts/tests/req-20260922-002.test.mjs

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

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- L1 纯逻辑（publish-flow.mjs） ---------- */

t('L1-1 清单：4 类 × N + LICENSE.md 单文件（single、lang=null）；语言集变化不影响 LICENSE；docFileOf', () => {
  const files = flow.publishDocFiles(['cn', 'en']);
  assert.equal(files.length, 9, '4 × 2 + LICENSE.md');
  const lic = files.find((f) => f.key === 'LICENSE');
  assert.ok(lic, '清单含 LICENSE 条目');
  assert.deepEqual(
    { key: lic.key, lang: lic.lang, file: lic.file, single: lic.single },
    { key: 'LICENSE', lang: null, file: 'LICENSE.md', single: true },
    'LICENSE 恒单文件、不随语言集（A1）',
  );
  assert.equal(files[files.length - 1].file, 'LICENSE.md', '追加在清单末尾');

  // 语言集变化（含单语言集 / 扩语言）：LICENSE 清单恒 1 个 LICENSE.md
  for (const langs of [['cn'], ['cn', 'en', 'fr'], ['en', 'cn']]) {
    const list = flow.publishDocFiles(langs).filter((f) => f.key === 'LICENSE');
    assert.deepEqual(list.map((x) => x.file), ['LICENSE.md'], `语言集 ${langs.join(',')} 下 LICENSE 恒单文件`);
  }

  assert.equal(flow.docFileOf('LICENSE', null), 'LICENSE.md');
  assert.equal(flow.docFileOf('LICENSE', 'en'), 'LICENSE.md', 'LICENSE 不带语言后缀');
  assert.equal(flow.docFileOf('license', null), 'LICENSE.md', 'key 大小写归一');
  assert.equal(flow.docFileOf('README', 'en'), 'README_en.md', '四类命名不受影响');
});

t('L1-2 白名单（口径 E）：LICENSE.md 放行；LICENSE / LICENSE.txt / LICENSE_<lang>.md 拒绝', () => {
  assert.equal(flow.isPublishDocFile('LICENSE.md', ['cn', 'en']), true);
  assert.equal(flow.isPublishDocFile('LICENSE.md', ['cn']), true, '单语言集同样放行');
  assert.equal(flow.isPublishDocFile('LICENSE', ['cn', 'en']), false, '无扩展名不识别（按需求原文 LICENSE.md）');
  assert.equal(flow.isPublishDocFile('LICENSE.txt', ['cn', 'en']), false);
  assert.equal(flow.isPublishDocFile('LICENSE_en.md', ['cn', 'en']), false, 'A1 不随语言集展开');
  assert.equal(flow.isPublishDocFile('LICENSE_cn.md', ['cn', 'en']), false);
  assert.equal(flow.isPublishDocFile('license.md', ['cn', 'en']), false, '文件名大小写敏感');
});

t('L1-3 AI 范围排除（口径 B）：总结 / 翻译提示词与 defaultDocFiles / restDocFiles 均不含 LICENSE', () => {
  const def = flow.defaultDocFiles(['cn', 'en']);
  const rest = flow.restDocFiles(['cn', 'en']);
  assert.equal(def.length, 4, '默认语言 4 类文件');
  assert.equal(rest.length, 4, '剩余语言 4 类文件');
  assert.ok(!def.concat(rest).some((f) => f.key === 'LICENSE'), 'AI 阶段范围不含 LICENSE');

  const contents = { 'README.md': '# R\n', 'CHANGELOG.md': '# C\n', 'FEATURES.md': '# F\n', 'AGENTS.md': '# A\n' };
  const sp = flow.buildDocSummaryPrompt({ projectRoot: '/tmp/p', planId: 'BLD-20260922-002', runId: 'sum-20260922-000101-ab01', langs: ['cn', 'en'] });
  assert.ok(!sp.includes('LICENSE'), '总结提示词不含 LICENSE');
  assert.ok(sp.includes('4 个文档'), '总结提示词文件数仍为 4 类口径');

  const tp = flow.buildDocTranslatePrompt({ projectRoot: '/tmp/p', planId: 'BLD-20260922-002', runId: 'tr-20260922-000101-cd01', langs: ['cn', 'en'], readFile: readsOf(contents) });
  assert.ok(!tp.includes('LICENSE'), '翻译提示词目标与基准均不含 LICENSE');
});

t('L1-4 LICENSE 三态：unwritten → pending → reviewed；编辑回退 pending；scopeStale 失效；删盘回退 pending', () => {
  const vOf = (files) => ({ review: { files: files || {} } });
  // 无盘无记录 → 未编写
  let r = flow.evaluateDocsFlow(vOf(), readsOf({}), {});
  let lic = r.files.find((f) => f.file === 'LICENSE.md');
  assert.equal(lic.state, 'unwritten', '初始未编写');
  assert.equal(flow.DOCS_FLOW_LABEL.unwritten, '未编写');
  assert.equal(flow.DOCS_FLOW_LABEL.pending, '待审核');

  // 人工编写落盘（不经 AI）→ 待审核
  r = flow.evaluateDocsFlow(vOf(), readsOf({ 'LICENSE.md': '# MIT\n' }), {});
  assert.equal(r.files.find((f) => f.file === 'LICENSE.md').state, 'pending', '在盘未审为待审核');

  // 通过审核（hash 一致）→ 已审核
  const rec = { 'LICENSE.md': { hash: sha256('# MIT\n'), at: '2026-09-22T00:00:00Z' } };
  r = flow.evaluateDocsFlow(vOf(rec), readsOf({ 'LICENSE.md': '# MIT\n' }), {});
  assert.equal(r.files.find((f) => f.file === 'LICENSE.md').state, 'reviewed');

  // 已审核后编辑保存（内容与基准不一致）→ 回退待审核（与四类回退口径一致）
  r = flow.evaluateDocsFlow(vOf(rec), readsOf({ 'LICENSE.md': '# Apache-2.0\n' }), {});
  assert.equal(r.files.find((f) => f.file === 'LICENSE.md').state, 'pending', '编辑后回退待审核');

  // 审核后文件被删除 → 回退待审核（缺口）
  r = flow.evaluateDocsFlow(vOf(rec), readsOf({}), {});
  assert.equal(r.files.find((f) => f.file === 'LICENSE.md').state, 'pending', '删盘回退待审核');

  // scopeStale：审核整体失效
  r = flow.evaluateDocsFlow({ review: { files: rec }, docs: { scopeStale: true } }, readsOf({ 'LICENSE.md': '# MIT\n' }), {});
  assert.equal(r.files.find((f) => f.file === 'LICENSE.md').state, 'pending', '范围过期审核失效');
});

t('L1-5 分组与门禁：LICENSE 归默认语言组计数；canTranslate 不被 LICENSE 锁；canFinalize / canCommit 含 LICENSE 缺口（C 必选）', () => {
  const contents = {};
  for (const f of flow.publishDocFiles(['cn', 'en'])) contents[f.file] = `# ${f.key}\n`;
  const files = {};
  for (const f of flow.publishDocFiles(['cn', 'en'])) files[f.file] = { hash: sha256(contents[f.file]), at: '2026-09-22T00:00:00Z' };

  // 只审 4 类默认语言（LICENSE 未审）：分组计数 5 文件 4 审
  const fourDefault = {};
  for (const f of flow.defaultDocFiles(['cn', 'en'])) fourDefault[f.file] = files[f.file];
  let r = flow.evaluateDocsFlow({ review: { files: fourDefault } }, readsOf(contents), {});
  assert.equal(r.defaultFiles.filter((f) => f.file === 'LICENSE.md').length, 1, 'LICENSE 归默认语言组');
  assert.ok(!r.restFiles.some((f) => f.file === 'LICENSE.md'), 'LICENSE 不在剩余语言组');
  assert.equal(r.defaultReviewedCount, 4, '默认语言计数 = 4/5（分母含 LICENSE）');
  assert.equal(r.canTranslate, true, 'A1 口径：默认 4 类全审即解锁 AI 翻译，LICENSE 不锁（README 验收「若 A2」）');
  assert.deepEqual(r.translateMissing, [], 'translateMissing 不含 LICENSE');
  assert.equal(r.canFinalize, false, 'LICENSE 未审不可整体完结（必选口径）');
  assert.ok(r.missing.some((m) => m.file === 'LICENSE.md' && m.state === 'pending'), 'missing 含 LICENSE 缺口');

  // 全审（含 LICENSE）+ 完结 → canCommit
  const finalized = { at: '2026-09-22T01:00:00Z', langsKey: 'cn,en', files: {} };
  r = flow.evaluateDocsFlow({ review: { files, finalized } }, readsOf(contents), {});
  assert.equal(r.canFinalize, true, '4×N + LICENSE 全审可完结');
  assert.equal(r.canCommit, true, '全审 + 已完结可提交');
});

t('L1-6 提交口径与指纹：evaluateDocsState 含 LICENSE；publishScopeFingerprint 含 LICENSE 内容', () => {
  const contents = {};
  for (const f of flow.publishDocFiles(['cn', 'en'])) contents[f.file] = `# ${f.key}\n`;
  const stNone = flow.evaluateDocsState({}, readsOf({}));
  assert.match(stNone.reasons[0], /LICENSE/, '未编写提示含 LICENSE');
  assert.match(stNone.reasons[0], /共 9 个文件/, '文件数 = 4 × 2 + 1');

  const rec = { commitHash: 'x', files: {} };
  for (const f of flow.publishDocFiles(['cn', 'en'])) rec.files[f.file] = sha256(contents[f.file]);
  assert.equal(flow.evaluateDocsState({ docs: rec }, readsOf(contents)).overall, 'committed', '含 LICENSE 全一致为已提交');
  const changed = { ...contents, 'LICENSE.md': '# 换许可证\n' };
  assert.equal(flow.evaluateDocsState({ docs: rec }, readsOf(changed)).overall, 'uncommitted', 'LICENSE 内容变化为未提交');

  const items = [{ itemId: 'REQ-20260922-002', commit: 'a'.repeat(40) }];
  const fp1 = flow.publishScopeFingerprint(items, readsOf(contents), ['cn', 'en']);
  const fp2 = flow.publishScopeFingerprint(items, readsOf(changed), ['cn', 'en']);
  assert.notEqual(fp1, fp2, 'LICENSE 内容参与范围指纹');
});

t('L1-7 基准变更检测与互链不涉及 LICENSE（A1 无对应行为）', () => {
  const stats = { 'LICENSE.md': 300, 'README.md': 100, 'README_en.md': 50 };
  assert.deepEqual(flow.detectBaselineShift(['cn', 'en'], readsOf(stats) /* stat 注入 */ && ((f) => (Object.prototype.hasOwnProperty.call(stats, f) ? stats[f] : null))), ['README_en.md'], 'LICENSE mtime 不参与基准检测');
  assert.deepEqual(flow.readmeDocLinks('LICENSE.md'), [], 'LICENSE 无互链要求');
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
  const reqA = core.createItem(dataDir, { type: 'requirement', title: 'LIC', by: 'test' });
  for (const s of ['accepted', 'in-progress', 'done']) core.setStatus(dataDir, reqA.id, s, { by: 'test' });
  return buildStore.createVersion(dataDir, { items: [{ itemId: reqA.id, commit: commitA }] });
}

t('L2-1 build-store 白名单：recordDocsReview / recordDocsCommit 放行 LICENSE.md、拒绝清单外 LICENSE 形态', () => {
  const { proj, dataDir } = mkData(tmpdir('atb-002-l21-'));
  const v = mkVersion(dataDir, proj);
  fs.writeFileSync(path.join(proj, 'LICENSE.md'), '# MIT\n');
  assert.doesNotThrow(() => buildStore.recordDocsReview(dataDir, v.id, { file: 'LICENSE.md', hash: sha256('# MIT\n') }), 'LICENSE.md 可审核');
  assert.throws(() => buildStore.recordDocsReview(dataDir, v.id, { file: 'LICENSE', hash: sha256('x') }), /非发布文档文件/);
  assert.throws(() => buildStore.recordDocsReview(dataDir, v.id, { file: 'LICENSE.txt', hash: sha256('x') }), /非发布文档文件/);
  assert.throws(() => buildStore.recordDocsReview(dataDir, v.id, { file: 'LICENSE_en.md', hash: sha256('x') }), /非发布文档文件/);

  assert.doesNotThrow(() => buildStore.recordDocsCommit(dataDir, v.id, { commitHash: 'a'.repeat(40), files: { 'LICENSE.md': 'b'.repeat(64) }, scopeFp: 'f' }), '提交记录白名单含 LICENSE.md');
});

t('L2-2 AI 账本（口径 B）：summary / translate 账本均不含 LICENSE.md；LICENSE 回执一律拒绝', () => {
  const { dataDir } = mkData(tmpdir('atb-002-l22-'));
  const sum = summaryStore.createSummaryRun(dataDir, { verId: 'BLD-20260922-001', owner: 's', langs: ['cn', 'en'] });
  assert.ok(!('LICENSE.md' in sum.files), '总结账本不含 LICENSE');
  assert.throws(() => summaryStore.markSummaryFile(dataDir, sum.runId, 'LICENSE.md', 'summarizing'), /非发布文档文件/);
  summaryStore.finishSummaryRun(dataDir, sum.runId, { result: 'done', summary: '完成' });

  const tr = translateStore.createTranslateRun(dataDir, { verId: 'BLD-20260922-001', owner: 't', langs: ['cn', 'en'] });
  assert.ok(!('LICENSE.md' in tr.files), '翻译账本不含 LICENSE');
  assert.throws(() => translateStore.markTranslateFile(dataDir, tr.runId, 'LICENSE.md', 'translating'), /非 AI 翻译目标文件/);
  translateStore.finishTranslateRun(dataDir, tr.runId, { result: 'done', summary: '完成' });
});

t('L2-3 recordDocsFinalize 快照覆盖 4×N+1 文件；LICENSE 不在盘时完结报错', () => {
  const { proj, dataDir } = mkData(tmpdir('atb-002-l23-'));
  const v = mkVersion(dataDir, proj);
  const contents = {};
  for (const f of flow.publishDocFiles(['cn', 'en'])) contents[f.file] = `# ${f.key}\n`;
  const out = buildStore.recordDocsFinalize(dataDir, v.id, { langs: ['cn', 'en'], readFile: readsOf(contents) });
  assert.equal(Object.keys(out.review.finalized.files).length, 9, '完结快照含 LICENSE');
  assert.equal(out.review.finalized.files['LICENSE.md'], sha256(contents['LICENSE.md']));

  const noLic = { ...contents };
  delete noLic['LICENSE.md'];
  assert.throws(
    () => buildStore.recordDocsFinalize(dataDir, v.id, { langs: ['cn', 'en'], readFile: readsOf(noLic) }),
    /LICENSE\.md 不存在或不可读/,
    'LICENSE 缺盘不可完结（必选口径）',
  );
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

t('L3 服务接口：清单 / 白名单 / 门禁 / pathspec / AI 翻译解锁', async () => {
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

    // publish-plan：9 行；LICENSE unwritten 且归默认语言组
    r = await req(port, 'GET', `/api/build/publish-plan${P}&id=${vid}`);
    assert.equal(r.status, 200);
    const fe = r.json.docsFlow;
    assert.equal(fe.files.length, 9, '4 × 2 + LICENSE.md');
    const lic = fe.files.find((f) => f.file === 'LICENSE.md');
    assert.equal(lic.state, 'unwritten', 'LICENSE 初始未编写');
    assert.equal(lic.isDefault, true, 'LICENSE 归默认语言组');
    assert.equal(fe.defaultFiles.length, 5, '默认语言组 5 文件（4 类 + LICENSE）');

    // 白名单：save / review / GET docs
    r = await req(port, 'POST', `/api/build/docs/save${P}`, { id: vid, file: 'LICENSE.txt', content: 'x' });
    assert.equal(r.status, 400, 'LICENSE.txt 拒绝');
    assert.match(r.json.error || '', /非发布文档文件/);
    r = await req(port, 'GET', `/api/build/docs${P}&id=${vid}&file=${encodeURIComponent('LICENSE')}`);
    assert.equal(r.status, 400, '无扩展名 LICENSE 拒绝');
    r = await req(port, 'POST', `/api/build/docs/review${P}`, { id: vid, file: 'LICENSE.md' });
    assert.equal(r.status, 400, '未编写不可审核');
    assert.match(r.json.error || '', /先编写并保存再通过审核/);

    // LICENSE 人工编写 + 审核（不经 AI 路径）
    r = await req(port, 'POST', `/api/build/docs/save${P}`, { id: vid, file: 'LICENSE.md', content: '# MIT License\n' });
    assert.equal(r.status, 200, `save LICENSE.md：${r.text}`);
    r = await req(port, 'GET', `/api/build/docs${P}&id=${vid}&file=${encodeURIComponent('LICENSE.md')}`);
    assert.equal(r.status, 200, `GET LICENSE.md：${r.text}`);
    assert.equal(r.json.content, '# MIT License\n');
    r = await req(port, 'POST', `/api/build/docs/review${P}`, { id: vid, file: 'LICENSE.md' });
    assert.equal(r.status, 200, `review LICENSE.md：${r.text}`);
    assert.equal(r.json.docsFlow.files.find((f) => f.file === 'LICENSE.md').state, 'reviewed');

    // 已审核编辑保存 → 回退待审核（pending）
    r = await req(port, 'POST', `/api/build/docs/save${P}`, { id: vid, file: 'LICENSE.md', content: '# Apache-2.0\n' });
    assert.equal(r.status, 200);
    r = await req(port, 'GET', `/api/build/publish-plan${P}&id=${vid}`);
    assert.equal(r.json.docsFlow.files.find((f) => f.file === 'LICENSE.md').state, 'pending', '编辑后回退待审核');
    r = await req(port, 'POST', `/api/build/docs/review${P}`, { id: vid, file: 'LICENSE.md' });
    assert.equal(r.status, 200, '重新审核');
    fs.writeFileSync(path.join(proj, 'LICENSE.md'), '# MIT License\n'); // 回到已审内容

    // AI 翻译解锁（A1）：默认 4 类全审 + LICENSE 已审状态下先验证 translate 提示词不含 LICENSE
    const defFiles = flow.publishDocFiles(['cn', 'en']).filter((f) => f.lang === 'cn');
    for (const f of defFiles) {
      fs.writeFileSync(path.join(proj, f.file), `# ${f.key}\n`);
      const rr = await req(port, 'POST', `/api/build/docs/review${P}`, { id: vid, file: f.file });
      assert.equal(rr.status, 200, `review ${f.file}：${rr.text}`);
    }
    r = await req(port, 'POST', `/api/build/docs-translate/start${P}`, { id: vid });
    assert.equal(r.status, 200, `translate start：${r.text}`);
    assert.ok(!r.json.prompt.includes('LICENSE'), '翻译提示词不含 LICENSE');
    translateStore.finishTranslateRun(dataDir, r.json.runId, { result: 'done', summary: '翻译完成' });

    // 剩余语言落盘审核；LICENSE 回退为未审验证门禁缺口
    fs.writeFileSync(path.join(proj, 'LICENSE.md'), '# 改动未重审\n');
    const restFiles = flow.publishDocFiles(['cn', 'en']).filter((f) => f.lang === 'en');
    for (const f of restFiles) {
      fs.writeFileSync(path.join(proj, f.file), `# ${f.key} en\n`);
      const rr = await req(port, 'POST', `/api/build/docs/review${P}`, { id: vid, file: f.file });
      assert.equal(rr.status, 200, `review ${f.file}：${rr.text}`);
    }
    r = await req(port, 'POST', `/api/build/docs/finalize${P}`, { id: vid });
    assert.equal(r.status, 400, 'LICENSE 未审不可完结');
    assert.match(r.json.error || '', /LICENSE\.md（待审核）/, '缺口明细含 LICENSE 与状态');
    r = await req(port, 'POST', `/api/build/docs/commit${P}`, { id: vid });
    assert.equal(r.status, 400, 'LICENSE 未审不可提交');
    assert.match(r.json.error || '', /LICENSE\.md/);

    // 补审 LICENSE → 完结 → 提交；pathspec 含 LICENSE.md 且不夹带手工 LICENSE（无扩展名）/ evil.txt
    r = await req(port, 'POST', `/api/build/docs/review${P}`, { id: vid, file: 'LICENSE.md' });
    assert.equal(r.status, 200, '补审 LICENSE');
    r = await req(port, 'POST', `/api/build/docs/finalize${P}`, { id: vid });
    assert.equal(r.status, 200, `finalize：${r.text}`);
    fs.writeFileSync(path.join(proj, 'LICENSE'), '无扩展名 LICENSE 不应被夹带');
    fs.writeFileSync(path.join(proj, 'evil.txt'), '不应被夹带');
    r = await req(port, 'POST', `/api/build/docs/commit${P}`, { id: vid });
    assert.equal(r.status, 200, `commit：${r.text}`);
    assert.equal(r.json.files.length, 9, 'pathspec = 4 × 2 + LICENSE.md');
    assert.ok(r.json.files.includes('LICENSE.md'), 'LICENSE.md 进入提交');
    const show = git(proj, ['show', '--name-only', '--pretty=format:', r.json.commitHash]).split('\n').filter(Boolean);
    assert.ok(!show.includes('LICENSE'), '无扩展名 LICENSE 不夹带');
    assert.ok(!show.includes('evil.txt'), '业务源码不夹带');
  } finally {
    server.kill('SIGTERM');
  }
});

/* ---------- L4 前端静态契约（build.js） ---------- */

function extractFn(source, name) {
  const m = source.match(new RegExp(`  function ${name}\\(([a-zA-Z]*)\\) \\{[\\s\\S]*?\\n  \\}`));
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
  docFilesOf: (langs) => flow.publishDocFiles(Array.isArray(langs) && langs.length ? langs : flow.DEFAULT_DOC_LANGS),
};

const L4_CTX = {
  pfOf: (v) => v.pf,
  esc: (s) => String(s),
  short: (h) => String(h || '').slice(0, 8),
  fmtTime: () => 't',
  ...FLOW_STUB,
};

const filesStub = (states) => flow.publishDocFiles(['cn', 'en']).map((f) => ({
  ...f,
  isDefault: f.single || f.lang === 'cn',
  state: states[f.file] || (f.single ? 'unwritten' : f.lang === 'cn' ? 'unsummarized' : 'untranslated'),
}));

t('L4-1 renderDocsPane：LICENSE.md 行在默认语言页签面板并标「不分语言」；页签计数含 LICENSE；缺口 title 含 LICENSE', () => {
  const source = fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');
  const html = vmRun([
    extractFn(source, 'summaryBtnText'), extractFn(source, 'translateBtnText'),
    extractFn(source, 'normalizeFlowEval'), extractFn(source, 'translateBtnHtml'),
    extractFn(source, 'finalizeBtnHtml'), extractFn(source, 'commitBtnHtml'),
    extractFn(source, 'docsStageBar'), extractFn(source, 'renderDocsPane'),
  ].join('\n'), L4_CTX, `renderDocsPane({ id: 'BLD-20260922-002', pf: { phase: 'ready', plan: {
    langs: ['cn', 'en'],
    docsFlow: { files: ${JSON.stringify(filesStub({ 'README.md': 'reviewed', 'CHANGELOG.md': 'reviewed', 'FEATURES.md': 'reviewed', 'AGENTS.md': 'reviewed' }))},
      reviewedCount: 4, defaultReviewedCount: 4, restReviewedCount: 0,
      canTranslate: true, translateMissing: [], canFinalize: false, finalized: null, canCommit: false,
      baselineShift: [], missing: [{ file: 'README_en.md', state: 'untranslated' }, { file: 'CHANGELOG_en.md', state: 'untranslated' }, { file: 'FEATURES_en.md', state: 'untranslated' }, { file: 'AGENTS_en.md', state: 'untranslated' }, { file: 'LICENSE.md', state: 'unwritten' }] },
    summary: null, translate: null, docs: { overall: 'none' } } } })`);
  // LICENSE 行：默认语言面板内 + 不分语言标签 + 未编写 chip
  assert.match(html, /id="bldDocPanel_cn"[^>]*>[\s\S]*LICENSE\.md/, 'LICENSE.md 在默认语言面板');
  assert.ok(html.includes('不分语言'), '不分语言标签');
  assert.ok(html.includes('未编写'), '未编写状态 chip');
  // 默认语言页签计数 4/5（分母含 LICENSE）
  assert.match(html, /data-doc-lang="cn"[\s\S]*?4\/5/, '默认语言页签计数含 LICENSE');
  // 门禁条：默认语言 4/5
  assert.match(html, /默认语言 4\/5/, '门禁默认语言计数');
  // 提交按钮 title 缺口含 LICENSE.md
  assert.match(html, /data-pf-commit[^>]*title="[^"]*LICENSE\.md（未编写）/, '提交缺口 title 含 LICENSE');
});

t('L4-2 renderReviewModal：LICENSE 页签（x/1）单栏；栏头标注不分语言；操作按钮齐全', () => {
  const source = fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');
  const html = vmRun([
    extractFn(source, 'sanitizeHtml'), extractFn(source, 'renderMd'), extractFn(source, 'renderReviewModal'),
  ].join('\n'), {
    pfOf: (v) => v.pf, esc: (s) => String(s), ...FLOW_STUB,
  }, `renderReviewModal({ id: 'V', pf: {
    review: { open: true, key: 'LICENSE', modes: { 'LICENSE.md': 'preview' }, contents: { 'LICENSE.md': '# MIT\\n' } },
    plan: { docsFlow: { files: ${JSON.stringify(filesStub({ 'LICENSE.md': 'pending' }))}, reviewedCount: 0 } } } })`);
  assert.match(html, /data-review-tab="LICENSE"[^>]*>LICENSE（0\/1）/, 'LICENSE 类型页签 x/1');
  const cols = (html.match(/bld-review-col"/g) || []).length;
  assert.equal(cols, 1, 'A1 单栏');
  assert.match(html, /LICENSE\.md[\s\S]{0,120}不分语言/, '栏头标注不分语言');
  assert.ok(html.includes('data-review-save="LICENSE.md"') && html.includes('data-review-approve="LICENSE.md"'), '保存 / 通过审核按钮');
  assert.ok(html.includes('data-review-mode="LICENSE.md"'), '编辑 / 预览切换');
  assert.ok(html.includes('待审核'), 'pending 状态文案');
});

t('L4-3 renderFinalizeModal：新增 LICENSE 开源口径人工核对项；默认语言计数含 LICENSE', () => {
  const source = fs.readFileSync(new URL('../web/build.js', import.meta.url), 'utf8');
  const html = vmRun([extractFn(source, 'renderFinalizeModal'), extractFn(source, 'renderDocsPane')].join('\n'), L4_CTX, `renderFinalizeModal({ id: 'V', pf: {
    finalize: { open: true, busy: false },
    plan: { langs: ['cn', 'en'], docsFlow: { files: ${JSON.stringify(filesStub({}))}, defaultReviewedCount: 5, restReviewedCount: 4, missing: [] } } } })`);
  assert.ok(html.includes('LICENSE 文件与项目实际开源口径一致'), 'D 口径人工核对项');
  assert.match(html, /默认语言文件已全部审核（5\/5）/, '默认语言计数分母含 LICENSE');
});

/* ---------- L6 i18n ---------- */

t('L6-1 i18n：新增文案中英同步；往返不变形', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN, EN_DYNAMIC } = I._dict;
  const statics = ['未编写', '待审核', '（未编写）', '（待审核）', '不分语言'];
  for (const k of statics) assert.ok(typeof EN[k] === 'string' && EN[k], `静态词条缺失：${k}`);
  assert.ok(typeof EN['LICENSE 文件与项目实际开源口径一致（许可证类型由人工确认，本单不做自动校验）'] === 'string', '完核新核对项词条');
  const dynamics = [
    '✓ 语言集已应用：◇（文档清单 4 类 × ◇ 语言 + LICENSE 单文件）',
    '◇ 内容已修改：回到「待审核」，需重新审查',
  ];
  for (const k of dynamics) assert.ok(k in EN_DYNAMIC, `动态词条缺失：${k}`);
  assert.ok(!('✓ 语言集已应用：◇（文档清单 4 类 × ◇ 语言）' in EN_DYNAMIC), '旧语言集应用动态键随口径更新清理');
  I.setLang('en');
  assert.equal(I.t('未编写'), 'Not written');
  assert.equal(I.t('待审核'), 'Awaiting review');
  assert.equal(I.t('不分语言'), 'Not language-specific');
  assert.equal(I.t('✓ 语言集已应用：cn,en（文档清单 4 类 × 2 语言 + LICENSE 单文件）'), '✓ Language set applied: cn,en (doc list: 4 types × 2 languages + single LICENSE.md)');
  I.setLang('zh');
  assert.equal(I.t('未编写'), '未编写');
});

/* ---------- 执行 ---------- */

for (const [name, fn] of cases) {
  await fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
