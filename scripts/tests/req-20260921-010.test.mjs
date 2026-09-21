#!/usr/bin/env node
// REQ-20260921-010 文档编写界面提供一个输入框，允许输入国际化语言集 —— 分层测试。
// L1 纯逻辑（publish-flow：normalizeDocLangs / docLangsOf / publishDocFiles / docFileOf /
//    isPublishDocFile / readmeDocLinks / buildDocSummaryPrompt / evaluateDocsState /
//    evaluateDocsFlow / publishScopeFingerprint 均按语言集动态）；
// L2 数据层（build-store.saveDocLangs 持久化与锁定、审核 / 提交记录白名单按语言集、
//    docs-summary-store 账本按语言集展开）；
// L3 服务接口（POST docs/langs、publish-plan 回显、save / review / commit 按语言集、
//    pathspec 不夹带、无变化 noop）；
// L4 前端静态契约（renderDocsPane 语言集输入框 + 文件列表动态、renderReviewModal 全语言列、
//    validateLangSetInput 客户端校验镜像）；
// L6 i18n（新增文案中英同步；固定「八个 / 8」旧词条随界面更新清理）。
// 用法：node scripts/tests/req-20260921-010.test.mjs

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

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- L1 纯逻辑（publish-flow.mjs） ---------- */

t('L1-1 normalizeDocLangs：默认 cn,en；空白容错与大小写归一；空值 / 空项 / 非法缩写 / 重复报错', () => {
  assert.deepEqual(flow.DEFAULT_DOC_LANGS, ['cn', 'en'], '默认语言集按需求原文 cn,en');
  assert.deepEqual(flow.normalizeDocLangs('cn,en').langs, ['cn', 'en']);
  assert.deepEqual(flow.normalizeDocLangs(' CN, en ').langs, ['cn', 'en'], '空白容错 + 小写归一');
  assert.deepEqual(flow.normalizeDocLangs('cn,en,fr,jp').langs, ['cn', 'en', 'fr', 'jp'], '需求原文示例集合');
  assert.deepEqual(flow.normalizeLangsList(['CN', 'EN']).langs, ['cn', 'en'], '数组入参同口径');
  assert.ok(!flow.normalizeDocLangs('cn,en').error);

  assert.match(flow.normalizeDocLangs('').error, /不能为空/);
  assert.match(flow.normalizeDocLangs('   ').error, /不能为空/);
  assert.match(flow.normalizeDocLangs('cn,,en').error, /空/);
  assert.match(flow.normalizeDocLangs('cn,中,en').error, /非法/);
  assert.match(flow.normalizeDocLangs('cn,en,cn').error, /重复/);
  assert.match(flow.normalizeDocLangs('cn,en,toolong').error, /非法/);
  assert.ok(!flow.normalizeDocLangs('cn,en').langs.includes(''));
});

t('L1-2 文件清单：首语言无后缀、其余下划线后缀；cn,en,fr,jp 共 16 文件；白名单按语言集', () => {
  const files = flow.publishDocFiles(['cn', 'en', 'fr', 'jp']);
  assert.equal(files.length, 16, '4 类 × 4 语言');
  assert.deepEqual(
    files.filter((f) => f.key === 'README').map((f) => f.file),
    ['README.md', 'README_en.md', 'README_fr.md', 'README_jp.md'],
    '需求原文命名：第一个语言无后缀，其余 <KEY>_<lang>.md',
  );
  assert.deepEqual(
    flow.publishDocFiles().map((f) => f.file).slice(0, 2),
    ['README.md', 'README_en.md'],
    '缺省语言集 = DEFAULT_DOC_LANGS',
  );
  assert.equal(flow.docFileOf('README', 'fr', ['cn', 'fr']), 'README_fr.md');
  assert.equal(flow.docFileOf('README', 'cn', ['cn', 'fr']), 'README.md', '首语言无后缀');
  assert.equal(flow.docFileOf('README', 'de', ['cn', 'fr']), null, '不在语言集内返回 null');

  assert.equal(flow.isPublishDocFile('README_fr.md', ['cn', 'fr']), true);
  assert.equal(flow.isPublishDocFile('README_fr.md', ['cn', 'en']), false, '默认语言集不含 fr');
  assert.equal(flow.isPublishDocFile('README.en.md', ['cn', 'en']), false, '存量点号命名不再进白名单（语言集为唯一事实源）');
  assert.equal(flow.isPublishDocFile('evil.txt', ['cn', 'en']), false);
});

t('L1-3 docLangsOf：v.langs 合法则用之；缺失 / 非法回退默认', () => {
  assert.deepEqual(flow.docLangsOf({ langs: ['ja', 'en'] }), ['ja', 'en'], '首语言可换（默认语言随之改变）');
  assert.deepEqual(flow.docLangsOf({}), ['cn', 'en']);
  assert.deepEqual(flow.docLangsOf(null), ['cn', 'en']);
  assert.deepEqual(flow.docLangsOf({ langs: [] }), ['cn', 'en'], '空数组回退默认');
  assert.deepEqual(flow.docLangsOf({ langs: 'cn,en' }), ['cn', 'en'], '字符串形态（健壮容错）');
  assert.deepEqual(flow.docLangsOf({ langs: ['中', 'en'] }), ['cn', 'en'], '非法项整体回退默认');
});

t('L1-4 readmeDocLinks：README 按语言链接同语言 CHANGELOG / FEATURES', () => {
  assert.deepEqual(flow.readmeDocLinks('README.md', ['cn', 'fr']), ['CHANGELOG.md', 'FEATURES.md']);
  assert.deepEqual(flow.readmeDocLinks('README_fr.md', ['cn', 'fr']), ['CHANGELOG_fr.md', 'FEATURES_fr.md']);
  assert.deepEqual(flow.readmeDocLinks('CHANGELOG.md', ['cn', 'fr']), [], '非 README 无链接要求');
});

t('L1-5 buildDocSummaryPrompt：清单按语言集的默认语言（首语言）展开（REQ-20260921-012 阶段一收窄）', () => {
  const p = flow.buildDocSummaryPrompt({
    projectRoot: '/tmp/proj-x', planId: 'BLD-20260921-010',
    items: [{ itemId: 'REQ-20260921-010', commit: 'a'.repeat(40), title: '语言集' }],
    langs: ['cn', 'en', 'fr', 'jp'],
  });
  for (const f of ['README.md', 'CHANGELOG.md', 'FEATURES.md', 'AGENTS.md']) {
    assert.ok(p.includes(`${f}（`), `提示词应含默认语言 ${f}`);
  }
  assert.ok(!p.includes('README_en.md') && !p.includes('_fr.md') && !p.includes('_jp.md'), '总结清单不含剩余语言文件');
  assert.ok(p.includes('4 个文档') && p.includes('4 类 × 1'), '文件数与阶段说明与实际一致');
  assert.ok(p.includes('README.md → CHANGELOG.md / FEATURES.md'), 'README 链接提示按默认语言命名');
  assert.ok(!p.includes('八个'), '不再硬编码「八个」');

  const p2 = flow.buildDocSummaryPrompt({ projectRoot: '/p', planId: 'BLD-20260921-010', items: [], langs: ['en', 'cn'] });
  assert.ok(p2.includes('默认语言（语言集首语言 en）') || p2.includes('首语言 en'), '默认语言随语言集首语言（可为英文）');
  assert.ok(!p2.includes('README_cn.md') && !p2.includes('README.md → CHANGELOG.md') === false, '英文默认语言时 README.md 即英文基准');
});

t('L1-6 evaluateDocsState / evaluateDocsFlow：行数 = 4×N，计数与文案不硬编码 8', () => {
  const langs = ['cn', 'en', 'fr'];
  const files = flow.publishDocFiles(langs);
  const contents = {};
  for (const f of files) contents[f.file] = `# ${f.file}\n`;
  const reviewFiles = {};
  for (const f of files) reviewFiles[f.file] = { hash: sha256(contents[f.file]), at: '2026-09-21T00:00:00Z' };

  const fv = flow.evaluateDocsFlow({ langs, review: { files: reviewFiles } }, readsOf(contents), {});
  assert.equal(fv.files.length, 12, '4 × 3 语言');
  assert.equal(fv.reviewedCount, 12);
  assert.equal(fv.canFinalize, true, '12/12 已审核可整体审查完结');
  assert.equal(fv.canCommit, false, 'REQ-20260921-012：整体审查未完结前不可提交');
  const fv0 = flow.evaluateDocsFlow({ langs, review: { files: reviewFiles, finalized: { at: '2026-09-21T02:00:00Z', langsKey: 'cn,en,fr', files: {} } } }, readsOf(contents), {});
  assert.equal(fv0.canCommit, true, '12/12 已审核 + 整体完结可提交');

  // 求值从 v.langs 取语言集：新增语言文件缺失 → 缺口
  const fv2 = flow.evaluateDocsFlow({ langs: ['cn', 'en', 'fr', 'jp'], review: { files: reviewFiles } }, readsOf(contents), {});
  assert.equal(fv2.files.length, 16, '语言集变化后行数联动');
  assert.equal(fv2.reviewedCount, 12);
  assert.equal(fv2.missing.filter((m) => m.file.endsWith('_jp.md')).length, 4, '新语言从缺口起步');

  const st = flow.evaluateDocsState({ langs }, readsOf(contents));
  assert.equal(st.files.length, 12);
  assert.ok(st.reasons.every((x) => !/八个/.test(x)), 'reasons 不再硬编码「八个」');
  const stNone = flow.evaluateDocsState({ langs }, readsOf({}));
  assert.match(stNone.reasons[0], /共 12 个文件/, '未编写文案按语言集展开文件数');
});

t('L1-7 publishScopeFingerprint：语言集不同（文件清单不同）指纹不同', () => {
  const read = (f) => `# ${f}`;
  const a = flow.publishScopeFingerprint([], read, ['cn', 'en']);
  const b = flow.publishScopeFingerprint([], read, ['cn', 'en', 'fr']);
  const c = flow.publishScopeFingerprint([], read, ['en', 'cn']);
  assert.notEqual(a, b, '语言集扩容后指纹变化');
  assert.notEqual(a, c, '首语言（默认语言）不同指纹不同');
  assert.equal(a, flow.publishScopeFingerprint([], read, ['cn', 'en']), '同语言集稳定');
});

/* ---------- L2 数据层（build-store / docs-summary-store） ---------- */

function mkData(tmp) {
  const proj = mkRepo(path.join(tmp, 'proj'));
  fs.writeFileSync(path.join(proj, 'base.txt'), 'base');
  git(proj, ['add', '-A']); git(proj, ['commit', '-m', 'init']);
  git(proj, ['switch', '-c', 'dev']);
  core.initData(proj);
  return { proj, dataDir: core.dataDirFrom(proj) };
}

function mkVersion(dataDir, proj) {
  const commitA = git(proj, ['rev-parse', 'HEAD']);
  const item = core.createItem(dataDir, { type: 'requirement', title: 'A', by: 'test' });
  for (const s of ['accepted', 'in-progress', 'done']) core.setStatus(dataDir, item.id, s, { by: 'test' });
  return buildStore.createVersion(dataDir, { items: [{ itemId: item.id, commit: commitA }] });
}

t('L2-1 saveDocLangs：保存 / 回显；merging 与已推送锁定；非法语言集不改盘', () => {
  const { proj, dataDir } = mkData(tmpdir('atb-010-l21-'));
  const v = mkVersion(dataDir, proj);
  assert.deepEqual(flow.docLangsOf(buildStore.readVersion(dataDir, v.id)), ['cn', 'en'], '未设置时回退默认');

  const out = buildStore.saveDocLangs(dataDir, v.id, { langs: ' cn, en, fr ' });
  assert.deepEqual(out.langs, ['cn', 'en', 'fr'], '归一化保存');
  assert.deepEqual(buildStore.readVersion(dataDir, v.id).langs, ['cn', 'en', 'fr'], '落盘可回显');

  assert.throws(() => buildStore.saveDocLangs(dataDir, v.id, { langs: 'cn,,en' }), /空/);
  assert.deepEqual(buildStore.readVersion(dataDir, v.id).langs, ['cn', 'en', 'fr'], '非法值不改盘');

  const v2 = mkVersion(dataDir, proj);
  const raw2 = JSON.parse(fs.readFileSync(path.join(dataDir, 'runtime', 'builds', 'versions', v2.id, 'version.json'), 'utf8'));
  raw2.status = 'merging';
  fs.writeFileSync(path.join(dataDir, 'runtime', 'builds', 'versions', v2.id, 'version.json'), JSON.stringify(raw2));
  assert.throws(() => buildStore.saveDocLangs(dataDir, v2.id, { langs: 'cn,en' }), /合并中/);

  const raw3 = JSON.parse(fs.readFileSync(path.join(dataDir, 'runtime', 'builds', 'versions', v2.id, 'version.json'), 'utf8'));
  raw3.status = 'merged';
  raw3.release = { pushedAt: '2026-09-21T00:00:00Z', pushedSha: 'a'.repeat(40), pushRemote: 'origin' };
  fs.writeFileSync(path.join(dataDir, 'runtime', 'builds', 'versions', v2.id, 'version.json'), JSON.stringify(raw3));
  assert.throws(() => buildStore.saveDocLangs(dataDir, v2.id, { langs: 'cn,en' }), /正式发布/);
});

t('L2-2 审核与提交记录白名单按语言集：README_fr.md 可审核；集合外 / 点号存量拒绝', () => {
  const { proj, dataDir } = mkData(tmpdir('atb-010-l22-'));
  const v = mkVersion(dataDir, proj);
  buildStore.saveDocLangs(dataDir, v.id, { langs: 'cn,en,fr' });

  fs.writeFileSync(path.join(proj, 'README_fr.md'), '# fr');
  const out = buildStore.recordDocsReview(dataDir, v.id, { file: 'README_fr.md' });
  assert.equal(out.review.files['README_fr.md'].hash, sha256('# fr'), 'fr 文件可审核');

  assert.throws(() => buildStore.recordDocsReview(dataDir, v.id, { file: 'README_jp.md' }), /非发布文档/);
  assert.throws(() => buildStore.recordDocsReview(dataDir, v.id, { file: 'README.en.md' }), /非发布文档/);
  assert.throws(() => buildStore.recordDocsCommit(dataDir, v.id, { commitHash: 'a'.repeat(40), files: { 'README.en.md': 'x'.repeat(64) }, scopeFp: 'f' }), /非发布文档/);
  assert.doesNotThrow(() => buildStore.recordDocsCommit(dataDir, v.id, { commitHash: 'a'.repeat(40), files: { 'README_fr.md': 'x'.repeat(64) }, scopeFp: 'f' }));
});

t('L2-3 docs-summary 账本按语言集默认语言展开（REQ-20260921-012 收窄 4 文件）；集合外回执拒绝', () => {
  const { dataDir } = mkData(tmpdir('atb-010-l23-'));
  const run = summaryStore.createSummaryRun(dataDir, { verId: 'BLD-20260921-001', owner: 's', langs: ['cn', 'en', 'fr'] });
  assert.equal(Object.keys(run.files).length, 4, '默认语言（首语言 cn）4 文件全 pending');
  assert.throws(() => summaryStore.markSummaryFile(dataDir, run.runId, 'README_fr.md', 'summarizing'), /非发布文档文件/, '剩余语言文件不在总结账本');
  assert.throws(() => summaryStore.markSummaryFile(dataDir, run.runId, 'README_jp.md', 'summarizing'), /非发布文档/);
  assert.throws(() => summaryStore.markSummaryFile(dataDir, run.runId, 'README.en.md', 'summarizing'), /非发布文档/);
  const view = summaryStore.summaryRunView(run);
  assert.equal(view.counts.total, 4, 'total = 默认语言文件数');
  summaryStore.finishSummaryRun(dataDir, run.runId, { result: 'done', summary: '完成' });

  const run2 = summaryStore.createSummaryRun(dataDir, { verId: 'BLD-20260921-002', owner: 's', langs: ['en', 'cn', 'fr'] });
  assert.equal(Object.keys(run2.files).length, 4, '默认语言 en（首语言）4 文件（不带后缀）');
  assert.deepEqual(Object.keys(run2.files).sort(), ['AGENTS.md', 'CHANGELOG.md', 'FEATURES.md', 'README.md']);
  summaryStore.finishSummaryRun(dataDir, run2.runId, { result: 'done', summary: '完成' });
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

t('L3 服务接口：langs 保存 / publish-plan 回显 / save / review / commit 按语言集 / pathspec 不夹带', async () => {
  const tmp = tmpdir('atb-010-serve-');
  const proj = mkRepo(path.join(tmp, 'proj'));
  fs.writeFileSync(path.join(proj, 'base.txt'), 'base');
  git(proj, ['add', '-A']); git(proj, ['commit', '-m', 'init']);
  git(proj, ['switch', '-c', 'dev']);
  fs.writeFileSync(path.join(proj, 'a.txt'), 'A');
  git(proj, ['add', '-A']); git(proj, ['commit', '-m', 'feat: A REQ-20260921-010']);
  const commitA = git(proj, ['rev-parse', 'HEAD']);
  core.initData(proj);
  const dataDir = core.dataDirFrom(proj);
  const item = core.createItem(dataDir, { type: 'requirement', title: '条目 A', by: 'test' });
  for (const s of ['accepted', 'in-progress', 'done']) core.setStatus(dataDir, item.id, s, { by: 'test' });

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
    let r = await req(port, 'POST', `/api/build/version${P}`, { items: [{ itemId: item.id, commit: commitA }] });
    assert.equal(r.status, 201, `创建版本：${r.text}`);
    const vid = r.json.version.id;

    // publish-plan：默认语言集回显 cn,en；docsFlow 8 行
    r = await req(port, 'GET', `/api/build/publish-plan${P}&id=${vid}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.langs, ['cn', 'en'], '缺省语言集 cn,en');
    assert.equal(r.json.docsFlow.files.length, 8);

    // 保存语言集 → 回显联动
    r = await req(port, 'POST', `/api/build/docs/langs${P}`, { id: vid, langs: 'cn,en,fr' });
    assert.equal(r.status, 200, `langs 保存：${r.text}`);
    assert.deepEqual(r.json.langs, ['cn', 'en', 'fr']);
    r = await req(port, 'GET', `/api/build/publish-plan${P}&id=${vid}`);
    assert.deepEqual(r.json.langs, ['cn', 'en', 'fr'], '重新进入界面正确回显');
    assert.equal(r.json.docsFlow.files.length, 12, '文件清单 4 × 3 联动');
    assert.ok(r.json.docsFlow.files.some((f) => f.file === 'README_fr.md'));

    // 非法语言集 400
    r = await req(port, 'POST', `/api/build/docs/langs${P}`, { id: vid, langs: 'cn,,fr' });
    assert.equal(r.status, 400);
    assert.match(r.json.error || '', /空/);
    r = await req(port, 'POST', `/api/build/docs/langs${P}`, { id: vid, langs: 'cn,fr,cn' });
    assert.equal(r.status, 400);
    assert.match(r.json.error || '', /重复/);

    // GET docs / save / review：fr 文件在语言集内可用；jp / 存量点号拒绝
    r = await req(port, 'GET', `/api/build/docs${P}&id=${vid}&file=${encodeURIComponent('README_fr.md')}`);
    assert.equal(r.status, 200, `GET docs fr：${r.text}`);
    assert.deepEqual(r.json.links, ['CHANGELOG_fr.md', 'FEATURES_fr.md'], 'README 同语言链接提示按新文件名展开');
    r = await req(port, 'GET', `/api/build/docs${P}&id=${vid}&file=${encodeURIComponent('README_jp.md')}`);
    assert.equal(r.status, 400);
    r = await req(port, 'GET', `/api/build/docs${P}&id=${vid}&file=${encodeURIComponent('README.en.md')}`);
    assert.equal(r.status, 400, '存量点号命名不在语言集白名单');

    r = await req(port, 'POST', `/api/build/docs/save${P}`, { id: vid, file: 'README_fr.md', content: '# FR\n[fr](README_fr.md)\n' });
    assert.equal(r.status, 200, `save fr：${r.text}`);
    r = await req(port, 'POST', `/api/build/docs/save${P}`, { id: vid, file: 'README_jp.md', content: 'x' });
    assert.equal(r.status, 400);
    r = await req(port, 'POST', `/api/build/docs/review${P}`, { id: vid, file: 'README_fr.md' });
    assert.equal(r.status, 200, `review fr：${r.text}`);

    // 提交门禁：12 文件未全审核 → 400 带动态计数
    r = await req(port, 'POST', `/api/build/docs/commit${P}`, { id: vid });
    assert.equal(r.status, 400);
    assert.match(r.json.error || '', /1\/12/, '缺口计数按语言集（X/N）');

    // 全部审核 → 提交成功；pathspec 只含语言集内 12 文件，不夹带业务源码
    for (const f of flow.publishDocFiles(['cn', 'en', 'fr'])) {
      const sr = await req(port, 'POST', `/api/build/docs/save${P}`, { id: vid, file: f.file, content: `# ${f.file}\n` });
      assert.equal(sr.status, 200, `save ${f.file}：${sr.text}`);
      const rr = await req(port, 'POST', `/api/build/docs/review${P}`, { id: vid, file: f.file });
      assert.equal(rr.status, 200, `review ${f.file}：${rr.text}`);
    }
    // REQ-20260921-012：全部已审核后先「整体审查完结」，提交才解锁
    r = await req(port, 'POST', `/api/build/docs/commit${P}`, { id: vid });
    assert.equal(r.status, 400, '整体审查未完结提交被阻止');
    r = await req(port, 'POST', `/api/build/docs/finalize${P}`, { id: vid });
    assert.equal(r.status, 200, `finalize：${r.text}`);
    fs.writeFileSync(path.join(proj, 'evil.txt'), '不应被夹带');
    r = await req(port, 'POST', `/api/build/docs/commit${P}`, { id: vid });
    assert.equal(r.status, 200, `commit：${r.text}`);
    assert.ok(r.json.commitHash);
    assert.equal(r.json.files.length, 12, '提交范围 = 语言集内 12 文件');
    assert.ok(r.json.files.every((f) => /^(README|CHANGELOG|FEATURES|AGENTS)(\.md|_(en|fr)\.md)$/.test(f)), '仅语言集内命名');
    const show = git(proj, ['show', '--name-only', '--pretty=format:', r.json.commitHash]).split('\n').filter(Boolean);
    assert.ok(!show.includes('evil.txt'), '不夹带业务源码');
    assert.ok(!show.includes('a.txt') && !show.includes('base.txt'));
    assert.equal(new Set(show).size, 12);

    // 无变化不空提交（noop）
    r = await req(port, 'POST', `/api/build/docs/commit${P}`, { id: vid });
    assert.equal(r.status, 200);
    assert.equal(r.json.noop, true, '无变化 noop');
  } finally {
    server.kill('SIGTERM');
  }
});

/* ---------- L4 前端静态契约（build.js vm 提取） ---------- */

t('L4-1/L4-2/L4-3 renderDocsPane / renderReviewModal / validateLangSetInput：语言集输入框 + 动态列表 + 全语言列 + 客户端校验', () => {
  const source = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'build.js'), 'utf8');
  const pick = (name) => {
    const m = source.match(new RegExp(`  function ${name}\\(([a-zA-Z]*)\\) \\{[\\s\\S]*?\\n  \\}`));
    assert.ok(m, `build.js 中应存在 ${name} 函数`);
    return m[0];
  };
  // REQ-20260921-012：renderDocsPane 新增依赖（阶段条 / AI 翻译 / 整体审查 / 分组求值兜底）
  const ctx = {
    pfOf: (v) => v.pf,
    esc: (s) => String(s),
    short: (h) => String(h || '').slice(0, 8),
    fmtTime: () => 't',
    DOCS_FLOW_LABEL: { unsummarized: '未总结', summarizing: '正在总结', summarized: '已总结待审核', reviewed: '已审核' },
    DOCS_FLOW_CLS: { unsummarized: 'st-mute', summarizing: 'st-run', summarized: 'st-wait', reviewed: 'st-ok' },
    DOCS_FLOW_ICON: { unsummarized: '○', summarizing: '◐', summarized: '●', reviewed: '✔' },
    DOC_KEYS: ['README', 'CHANGELOG', 'FEATURES', 'AGENTS'],
    DEFAULT_DOC_LANGS: ['cn', 'en'],
    langNameOf: flow.langNameOf,
    docFilesOf: (langs) => flow.publishDocFiles(Array.isArray(langs) && langs.length ? langs : ['cn', 'en']),
  };
  const context = vm.createContext(ctx);
  vm.runInContext([
    pick('summaryBtnText'), pick('translateBtnText'), pick('normalizeFlowEval'), pick('translateBtnHtml'),
    pick('finalizeBtnHtml'), pick('commitBtnHtml'), pick('docsStageBar'), pick('renderDocsPane'),
    pick('renderReviewModal'), pick('validateLangSetInput'),
  ].join('\n'), context);

  const frFiles = flow.publishDocFiles(['cn', 'en', 'fr']);
  const plan = {
    langs: ['cn', 'en', 'fr'],
    docsFlow: { files: frFiles.map((f) => ({ ...f, state: 'unsummarized' })), reviewedCount: 0, canCommit: false, missing: [{ file: 'README.md', state: 'unsummarized' }] },
    docs: { overall: 'none', reasons: [] },
  };
  const html = vm.runInContext(`renderDocsPane({ id: 'V', pf: { phase: 'ready', plan: ${JSON.stringify(plan)} } })`, context)
    + vm.runInContext(`renderReviewModal({ id: 'V', pf: { review: { open: true, key: 'README', modes: {}, contents: {} }, plan: ${JSON.stringify(plan)} } })`, context);

  // 语言集输入框：默认值 / 回显 / 行内错误占位
  assert.match(html, /data-pf-langs/, '语言集输入框存在');
  assert.match(html, /value="cn,en,fr"/, '回显当前语言集');
  assert.match(html, /语言集/, '标签存在');
  // 文件列表动态：12 行 fr 文件出现；门禁分组计数按语言集（默认 0/4 · 剩余 0/8）
  assert.match(html, /README_fr\.md/, 'fr 文件在列表 / 审查对话框');
  assert.match(html, /默认语言 0\/4/, '门禁默认语言计数（首语言 cn 四文件）');
  assert.match(html, /剩余语言 0\/8/, '门禁剩余语言计数（en+fr 八文件，不再固定 /8）');
  assert.match(html, /① 默认语言先行/, '阶段条（REQ-20260921-012）');
  // 审查对话框：页签计数 n/3；README 页签出现 fr 列
  assert.match(html, /README（0\/3）/, '页签计数按语言数');
  assert.ok((html.match(/bld-review-col/g) || []).length >= 3, 'README 页签按语言集展开全语言列');
  // 文件名标识豁免（BUG-20260921-004 口径）
  assert.ok([...html.matchAll(/<span class="bld-doc-fname" data-i18n-skip>([^<]+)</g)].some((m) => m[1].startsWith('README_fr.md')), 'fr 文件名带豁免');

  // 客户端校验镜像（返回值生于 vm realm：展开到本 realm 再比对原型）
  const v = (raw) => vm.runInContext(`validateLangSetInput(${JSON.stringify(raw)})`, context);
  assert.deepEqual([...v('cn,en,fr').langs], ['cn', 'en', 'fr']);
  assert.match(v('').error, /不能为空/);
  assert.match(v('cn,,en').error, /空/);
  assert.match(v('cn,en,cn').error, /重复/);
  assert.match(v('中,en').error, /非法/);
});

/* ---------- L6 i18n（中英同步） ---------- */

t('L6-1 i18n：语言集新词条中英同步；固定「8」旧词条随界面更新清理', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN, EN_DYNAMIC } = I._dict;
  const mustHave = [
    '语言集',
    '语言集不能为空（至少一个语言缩写，如 cn,en）',
    '存在空的语言项（连续逗号）：第 ◇ 项为空',
    '存在非法缩写「◇」：语言缩写以国际规范为准（2–3 个字母，如 cn / zh / en / fr / ja）',
    '语言重复：「◇」出现多次',
  ];
  for (const k of mustHave) {
    assert.ok(k in EN || k in EN_DYNAMIC, `缺少词条：${k}`);
  }
  // REQ-20260921-012：门禁词条随三阶段口径迁移（旧「全部文件已通过审查」两条键清理）
  for (const k of ['提交门禁：◇/◇ 已审核 · 整体审查已完结 —— 可提交到本地 dev 分支。', '提交门禁：默认语言 ◇/◇ · 剩余语言 ◇/◇ 已审核 —— 提交禁用，尚缺：◇。']) {
    assert.ok(k in EN_DYNAMIC, `动态门禁新口径词条：${k}`);
  }
  for (const k of ['提交门禁：◇/◇ 已审核 —— 全部文件已通过审查，可提交到本地 dev 分支。', '提交门禁：◇/◇ 已审核 —— 提交按钮禁用，尚缺：◇']) {
    assert.ok(!(k in EN_DYNAMIC), `旧门禁键应清理：${k.slice(0, 18)}…`);
  }
  // 旧固定「八个」词条随界面更新清理（不再被 build.js 引用）
  for (const k of [
    '围绕本版本八个发布文档（README / CHANGELOG / FEATURES / AGENTS 中英）完成 AI 总结、人工审查与提交到本地 dev 分支；可不经 AI 总结直接审查修改。',
    '把八个文档提交到本地 dev 分支（pathspec 限定，不夹带业务源码）',
    '已刷新：八个文件已同步为磁盘最新内容',
  ]) {
    assert.ok(!(k in EN), `旧词条应清理：${k.slice(0, 24)}…`);
  }
});

for (const [name, fn] of cases) {
  await fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
