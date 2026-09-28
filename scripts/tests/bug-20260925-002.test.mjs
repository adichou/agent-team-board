#!/usr/bin/env node
// BUG-20260925-002 文档编写 AI 校对建议决断刷新即丢 + 已应用建议再接受误报过期 —— 分层测试。
// L2 数据层（docs-check-store：决断落库 recordCheckDecision / 视图 decisions /
//    上一轮决断数 supersededCheckDecisionCount）；
// L3 服务接口（POST /api/build/docs-check/decision 落库；publish-plan docsCheck 带 decisions
//    与 supersededDecided；非法决断 400）；
// L4 前端纯函数与行为（seedChkDecisions 播种 / alreadyAppliedChk 已应用识别 /
//    acceptChkSuggestion 三分支 / rejectChkSuggestion 落库 / renderDocsPane 决断渲染与新
//    run 旧决断失效提示）；
// L6 i18n（新增文案中英同步）。
// 用法：node scripts/tests/bug-20260925-002.test.mjs

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
import * as checkStore from '../lib/docs-check-store.mjs';
import '../web/i18n.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const atb = path.join(pluginRoot, 'scripts', 'atb.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV, timeout: 20000 });
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

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- L2 数据层：docs-check-store 决断落库 ---------- */

const ISSUES_R = '第 1 行：错别字「测式」→ 建议「测试」\n第 2 行：语法「他门的」→ 建议「他们的」';

// 建一个已收尾（done）的校对 run，README.md 带 2 条建议
function mkDoneRun(dataDir, verId, { issues = ISSUES_R } = {}) {
  const run = checkStore.createCheckRun(dataDir, { verId, owner: 't', langs: ['cn', 'en'] });
  checkStore.markCheckFile(dataDir, run.runId, 'README.md', 'fail', issues);
  checkStore.markCheckFile(dataDir, run.runId, 'CHANGELOG.md', 'pass');
  checkStore.finishCheckRun(dataDir, run.runId, { result: 'done', summary: '校对完成' });
  return checkStore.getCheckRun(dataDir, run.runId);
}

t('L2-1 createCheckRun 初始化 decisions；checkRunView 透出 decisions 副本', () => {
  const proj = mkRepo(tmpdir('atb-b2502-l21-'));
  fs.writeFileSync(path.join(proj, 'base.txt'), 'base');
  git(proj, ['add', '-A']); git(proj, ['commit', '-m', 'init']);
  core.initData(proj);
  const dataDir = core.dataDirFrom(proj);
  const run = checkStore.createCheckRun(dataDir, { verId: 'BLD-20260925-101', owner: 't', langs: ['cn', 'en'] });
  assert.deepEqual(run.decisions, {}, '新 run 初始化空决断表');
  const view = checkStore.checkRunView(run);
  assert.deepEqual(view.decisions, {}, '视图带 decisions 字段');
});

t('L2-2 recordCheckDecision：合法决断落 run.json（后写覆盖）；view 随带', () => {
  const proj = mkRepo(tmpdir('atb-b2502-l22-'));
  fs.writeFileSync(path.join(proj, 'base.txt'), 'base');
  git(proj, ['add', '-A']); git(proj, ['commit', '-m', 'init']);
  core.initData(proj);
  const dataDir = core.dataDirFrom(proj);
  const run = mkDoneRun(dataDir, 'BLD-20260925-102');
  let cur = checkStore.recordCheckDecision(dataDir, { verId: 'BLD-20260925-102', runId: run.runId, file: 'README.md', idx: 0, decision: 'accepted' });
  assert.equal(cur.decisions['README.md|0'], 'accepted', '接受决断落库');
  cur = checkStore.recordCheckDecision(dataDir, { verId: 'BLD-20260925-102', runId: run.runId, file: 'README.md', idx: 1, decision: 'rejected' });
  assert.equal(cur.decisions['README.md|1'], 'rejected', '拒绝决断落库');
  // 后写覆盖：同一建议最后一次决断为准
  cur = checkStore.recordCheckDecision(dataDir, { verId: 'BLD-20260925-102', runId: run.runId, file: 'README.md', idx: 0, decision: 'stale' });
  assert.equal(cur.decisions['README.md|0'], 'stale', '后写覆盖');
  const reread = checkStore.getCheckRun(dataDir, run.runId);
  assert.equal(reread.decisions['README.md|0'], 'stale', '落盘可重读（run.json）');
  const view = checkStore.checkRunView(checkStore.latestCheckRun(dataDir, 'BLD-20260925-102'));
  assert.equal(view.decisions['README.md|1'], 'rejected', '视图随带 decisions');
});

t('L2-3 recordCheckDecision 校验：decision 三值 / run 属本版本 / 目标文件 / idx 行内 / 仅 done 可记', () => {
  const proj = mkRepo(tmpdir('atb-b2502-l23-'));
  fs.writeFileSync(path.join(proj, 'base.txt'), 'base');
  git(proj, ['add', '-A']); git(proj, ['commit', '-m', 'init']);
  core.initData(proj);
  const dataDir = core.dataDirFrom(proj);
  const run = mkDoneRun(dataDir, 'BLD-20260925-103');
  const R = { verId: 'BLD-20260925-103', runId: run.runId };
  assert.throws(() => checkStore.recordCheckDecision(dataDir, { ...R, file: 'README.md', idx: 0, decision: 'pending' }), /decision/, '非法 decision 拒绝');
  assert.throws(() => checkStore.recordCheckDecision(dataDir, { ...R, verId: 'BLD-20260925-999', file: 'README.md', idx: 0, decision: 'accepted' }), /不属于/, '跨版本 run 拒绝');
  assert.throws(() => checkStore.recordCheckDecision(dataDir, { ...R, file: 'evil.txt', idx: 0, decision: 'accepted' }), /校对目标文件/, '账本外文件拒绝');
  assert.throws(() => checkStore.recordCheckDecision(dataDir, { ...R, file: 'README.md', idx: 2, decision: 'accepted' }), /建议序号/, 'idx 越界拒绝（该文件 2 条）');
  assert.throws(() => checkStore.recordCheckDecision(dataDir, { ...R, file: 'README.md', idx: -1, decision: 'accepted' }), /建议序号/, '负 idx 拒绝');
  assert.throws(() => checkStore.recordCheckDecision(dataDir, { ...R, file: 'README.md', idx: 'x', decision: 'accepted' }), /建议序号/, '非整数 idx 拒绝');
  assert.throws(() => checkStore.recordCheckDecision(dataDir, { ...R, file: 'CHANGELOG.md', idx: 0, decision: 'accepted' }), /建议序号/, 'pass 文件无建议行拒绝');
  // running run 不可记
  const running = checkStore.createCheckRun(dataDir, { verId: 'BLD-20260925-104', owner: 't', langs: ['cn', 'en'] });
  assert.throws(
    () => checkStore.recordCheckDecision(dataDir, { verId: 'BLD-20260925-104', runId: running.runId, file: 'README.md', idx: 0, decision: 'accepted' }),
    /未收尾/,
    'running run 拒绝记录',
  );
  checkStore.finishCheckRun(dataDir, running.runId, { result: 'failed', reason: '中断' });
});

t('L2-4 supersededCheckDecisionCount：同版本上一轮有决断 run 的条数；无则 0', () => {
  const proj = mkRepo(tmpdir('atb-b2502-l24-'));
  fs.writeFileSync(path.join(proj, 'base.txt'), 'base');
  git(proj, ['add', '-A']); git(proj, ['commit', '-m', 'init']);
  core.initData(proj);
  const dataDir = core.dataDirFrom(proj);
  const VER = 'BLD-20260925-105';
  // 第一轮：无决断 → 第二轮 superseded = 0
  const r1 = mkDoneRun(dataDir, VER);
  assert.equal(checkStore.supersededCheckDecisionCount(dataDir, VER, r1.runId), 0, '上一轮无决断 → 0');
  // 第二轮：记 2 条决断 → 第三轮 superseded = 2
  const r2 = mkDoneRun(dataDir, VER);
  checkStore.recordCheckDecision(dataDir, { verId: VER, runId: r2.runId, file: 'README.md', idx: 0, decision: 'accepted' });
  checkStore.recordCheckDecision(dataDir, { verId: VER, runId: r2.runId, file: 'README.md', idx: 1, decision: 'rejected' });
  const r3 = mkDoneRun(dataDir, VER);
  assert.equal(checkStore.supersededCheckDecisionCount(dataDir, VER, r3.runId), 2, '上一轮已决断 2 条 → 2');
  // 其他版本不串
  const other = mkDoneRun(dataDir, 'BLD-20260925-106');
  assert.equal(checkStore.supersededCheckDecisionCount(dataDir, 'BLD-20260925-106', other.runId), 0, '跨版本不串');
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

t('L3 服务接口：decision 落库 + publish-plan docsCheck 带 decisions / supersededDecided + 非法 400', async () => {
  const tmp = tmpdir('atb-b2502-serve-');
  const proj = mkRepo(path.join(tmp, 'proj'));
  fs.writeFileSync(path.join(proj, 'base.txt'), 'base');
  git(proj, ['add', '-A']); git(proj, ['commit', '-m', 'init']);
  git(proj, ['switch', '-c', 'dev']);
  fs.writeFileSync(path.join(proj, 'a.txt'), 'A');
  git(proj, ['add', '-A']); git(proj, ['commit', '-m', 'feat: A REQ-20260925-001']);
  const commitA = git(proj, ['rev-parse', 'HEAD']);
  core.initData(proj);
  const dataDir = core.dataDirFrom(proj);
  const item = core.createItem(dataDir, { type: 'requirement', title: '条目 A', by: 'test' });
  for (const s of ['accepted', 'in-progress', 'done']) core.setStatus(dataDir, item.id, s, { by: 'test' });
  const ver = buildStore.createVersion(dataDir, { items: [{ itemId: item.id, commit: commitA }] });

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
    // 第一轮 run：落 2 条决断
    const r1 = mkDoneRun(dataDir, ver.id);
    let r = await req(port, 'POST', `/api/build/docs-check/decision${P}`, { id: ver.id, runId: r1.runId, file: 'README.md', idx: 0, decision: 'accepted' });
    assert.equal(r.status, 200, `decision 200：${r.text}`);
    assert.equal(r.json.run.decisions['README.md|0'], 'accepted', '回执带 decisions');
    r = await req(port, 'POST', `/api/build/docs-check/decision${P}`, { id: ver.id, runId: r1.runId, file: 'README.md', idx: 1, decision: 'rejected' });
    assert.equal(r.status, 200);

    // publish-plan：docsCheck 随带 decisions（刷新重进的播种事实源）
    r = await req(port, 'GET', `/api/build/publish-plan${P}&id=${ver.id}`);
    assert.equal(r.status, 200, `publish-plan：${r.text}`);
    assert.equal(r.json.docsCheck.runId, r1.runId);
    assert.equal(r.json.docsCheck.decisions['README.md|0'], 'accepted', 'publish-plan 带 decisions');
    assert.equal(r.json.docsCheck.supersededDecided || 0, 0, '首轮无上一轮决断');

    // 非法决断：decision 值 / idx 越界 / 账本外文件 → 400
    r = await req(port, 'POST', `/api/build/docs-check/decision${P}`, { id: ver.id, runId: r1.runId, file: 'README.md', idx: 0, decision: 'bogus' });
    assert.equal(r.status, 400, '非法 decision 400');
    r = await req(port, 'POST', `/api/build/docs-check/decision${P}`, { id: ver.id, runId: r1.runId, file: 'README.md', idx: 9, decision: 'stale' });
    assert.equal(r.status, 400, 'idx 越界 400');
    r = await req(port, 'POST', `/api/build/docs-check/decision${P}`, { id: ver.id, runId: r1.runId, file: 'evil.txt', idx: 0, decision: 'stale' });
    assert.equal(r.status, 400, '账本外文件 400');

    // 第二轮 run：publish-plan 切到新 run，decisions 清零 + supersededDecided = 2（新 run 旧决断失效提示依据）
    const r2 = mkDoneRun(dataDir, ver.id);
    r = await req(port, 'GET', `/api/build/publish-plan${P}&id=${ver.id}`);
    assert.equal(r.json.docsCheck.runId, r2.runId, 'publish-plan 取最新 run');
    assert.deepEqual(r.json.docsCheck.decisions, {}, '新 run 决断不带入');
    assert.equal(r.json.docsCheck.supersededDecided, 2, '上一轮已决断 2 条透出');
  } finally {
    server.kill('SIGTERM');
  }
});

/* ---------- L4 前端：vm 提取 build.js ---------- */

function extractFn(source, name) {
  const m = source.match(new RegExp(`  (?:async )?function ${name}\\(([^)]*)\\) \\{[\\s\\S]*?\\n  \\}`));
  assert.ok(m, `build.js 中应存在 ${name} 函数`);
  return m[0];
}

const SOURCE = () => fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'build.js'), 'utf8');

const FLOW_STUB = {
  DOCS_FLOW_LABEL: {
    unsummarized: '未总结', summarizing: '正在总结', summarized: '已总结待审核',
    untranslated: '未翻译', translating: '正在翻译', translated: '已翻译待审核', reviewed: '已审核',
    unwritten: '未编写', pending: '审核',
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

t('L4-1 seedChkDecisions：服务端决断播种 → runId 键；本会话同 run 覆盖；换 run 旧键丢弃；无 run 清空', () => {
  const fns = extractFn(SOURCE(), 'seedChkDecisions');
  const run = (ctx, pf, plan) => {
    pf.plan = plan;
    vm.runInContext(fns, ctx);
    return vm.runInContext('seedChkDecisions(pf)', ctx);
  };
  // ① 服务端决断播种（plan.docsCheck.decisions → runId|file|idx）
  const ctx1 = vm.createContext({ pf: { chkDecisions: null } });
  const out1 = run(ctx1, vm.runInContext('pf', ctx1), {
    docsCheck: { runId: 'chk-a', decisions: { 'README.md|0': 'accepted', 'CHANGELOG.md|1': 'rejected' } },
  });
  assert.deepEqual(
    Object.keys(out1).sort(),
    ['chk-a|CHANGELOG.md|1', 'chk-a|README.md|0'].sort(),
    '服务端键补 runId 前缀',
  );
  // ② 本会话同 run 决断覆盖服务端（并发未落库不丢）
  const pf2 = { chkDecisions: { 'chk-a|README.md|0': 'stale', 'chk-z|README.md|0': 'accepted' } };
  const ctx2 = vm.createContext({ pf: pf2 });
  const out2 = run(ctx2, pf2, { docsCheck: { runId: 'chk-a', decisions: { 'README.md|0': 'accepted' } } });
  assert.equal(out2['chk-a|README.md|0'], 'stale', '本会话同 run 覆盖');
  assert.ok(!('chk-z|README.md|0' in out2), '换 run 旧 runId 键丢弃（旧决断不带入新 run）');
  // ③ 无 run（未校对）→ 空表
  const pf3 = { chkDecisions: { 'chk-a|README.md|0': 'accepted' } };
  const ctx3 = vm.createContext({ pf: pf3 });
  const out3 = run(ctx3, pf3, { docsCheck: null });
  assert.deepEqual(Object.keys(out3), [], '无 run 清空');
});

t('L4-2 alreadyAppliedChk：行内含 after → 已应用；行号超界收敛末行；无行号查全文；after 为空保守 false', () => {
  const fns = extractFn(SOURCE(), 'alreadyAppliedChk');
  const ctx = vm.createContext({});
  vm.runInContext(fns, ctx);
  const call = (content, s) => vm.runInContext(`alreadyAppliedChk(${JSON.stringify(content)}, ${JSON.stringify(s)})`, ctx);
  const doc = '第一行原文\n这是测试文本\n第三行';
  assert.equal(call(doc, { line: 2, before: '测式', after: '测试' }), true, '该行已是 after → 已应用');
  assert.equal(call(doc, { line: 2, before: '测式', after: '别的' }), false, '该行无 after → 非已应用');
  assert.equal(call(doc, { line: 99, before: 'x', after: '第三行' }), true, '行号超界收敛末行（与 applyChkSuggestion 同口径）');
  assert.equal(call('开头有测试', { line: null, before: '测式', after: '测试' }), true, '无行号全文含 after → 已应用');
  assert.equal(call('毫无关联', { line: null, before: '测式', after: '测试' }), false, '全文无 after → 非已应用');
  assert.equal(call('删掉短语后的文本', { line: 1, before: '多余短语，', after: '' }), false, '删除型（after 空）保守 false 走过期口径');
});

/* ---------- L4 行为：acceptChkSuggestion / rejectChkSuggestion（vm + fetch 桩） ---------- */

const CHK_FNS = (source) => [
  extractFn(source, 'parseIssueLineNo'),
  extractFn(source, 'splitProofreadIssues'),
  extractFn(source, 'parseChkSuggestion'),
  extractFn(source, 'applyChkSuggestion'),
  extractFn(source, 'alreadyAppliedChk'),
  extractFn(source, 'persistChkDecision'),
  extractFn(source, 'acceptChkSuggestion'),
].join('\n');

const ISSUES_1 = '第 1 行：错别字「测式」→ 建议「测试」';

async function runAccept({ disk, issues = ISSUES_1, decisionOk = true, saveOk = true }) {
  const toasts = [];
  const calls = [];
  const pf = {
    verId: 'BLD-20260925-109', phase: 'ready', plan: {
      docsCheck: { runId: 'chk-20260925-000000-abcd', phase: 'done', issues: { 'README.md': issues } },
    },
    chkDecisions: null, chkBusy: null, chkAnchor: null,
  };
  const ctx = vm.createContext({
    blockPublished: v => !!v?.release?.published, selVersion: () => null,
    selVersion: () => ({ id: pf.verId }),
    pfOf: () => pf,
    state: { project: 'proj-x', pf },
    render: () => {},
    toast: (m, isErr) => toasts.push({ m, isErr }),
    encodeURIComponent,
    fetch: async (url, opts = {}) => {
      calls.push({ url, method: opts.method || 'GET', body: opts.body || null });
      if (url.includes('/api/build/docs-check/decision')) return { ok: decisionOk, json: async () => ({}) };
      if (url.includes('/api/build/docs/save')) return { ok: saveOk, json: async () => ({}) };
      if (url.includes('/api/build/docs?')) return { ok: true, json: async () => ({ content: disk }) };
      throw new Error(`未预期的请求：${url}`);
    },
  });
  vm.runInContext(CHK_FNS(SOURCE()), ctx);
  await vm.runInContext('acceptChkSuggestion("README.md", 0)', ctx);
  return { toasts, calls, decisions: pf.chkDecisions };
}

t('L4-3 acceptChkSuggestion：建议此前已应用（before 不在、after 已在）→ 标 accepted + 非失败反馈，不误报过期、不覆盖', async () => {
  const { toasts, calls, decisions } = await runAccept({ disk: '这是测试文档\n第二行' });
  assert.equal(decisions['chk-20260925-000000-abcd|README.md|0'], 'accepted', '已应用识别 → 记 accepted（计已处理）');
  assert.equal(toasts.length, 1);
  assert.ok(toasts[0].m.startsWith('✓'), '非失败口径（✓ 开头）');
  assert.ok(toasts[0].m.includes('已应用'), '明确提示此前已应用');
  assert.ok(!toasts[0].isErr, '不是错误 toast');
  assert.ok(!calls.some((c) => c.url.includes('/api/build/docs/save')), '已应用不重复保存（不覆盖）');
  const dec = calls.find((c) => c.url.includes('/api/build/docs-check/decision'));
  assert.ok(dec, '决断落库请求发出');
  assert.ok(dec.body.includes('"decision":"accepted"'), '落库决断为 accepted');
});

t('L4-3b acceptChkSuggestion：原文确被人工改过（before / after 均不在）→ 仍标过期 + 失败口径不覆盖（既有保护不回退）', async () => {
  const { toasts, calls, decisions } = await runAccept({ disk: '整段被人工重写\n第二行' });
  assert.equal(decisions['chk-20260925-000000-abcd|README.md|0'], 'stale', '人工修改 → 过期');
  assert.equal(toasts.length, 1);
  assert.ok(toasts[0].m.includes('建议已过期'), '过期失败口径保留');
  assert.ok(toasts[0].isErr, '失败 toast');
  assert.ok(!calls.some((c) => c.url.includes('/api/build/docs/save')), '不覆盖人工内容');
  const dec = calls.find((c) => c.url.includes('/api/build/docs-check/decision'));
  assert.ok(dec && dec.body.includes('"decision":"stale"'), '过期决断落库');
});

t('L4-3c acceptChkSuggestion：正常路径 → 保存替换内容 + 决断 accepted 落库；落库失败降级不阻塞', async () => {
  const { toasts, calls, decisions } = await runAccept({ disk: '这是测式文档\n第二行' });
  assert.equal(decisions['chk-20260925-000000-abcd|README.md|0'], 'accepted');
  const save = calls.find((c) => c.url.includes('/api/build/docs/save'));
  assert.ok(save, '保存请求发出');
  assert.ok(save.body.includes('这是测试文档'), '保存内容为替换后文本');
  assert.ok(toasts[0].m.startsWith('✓') && toasts[0].m.includes('已接受并保存'), '成功 toast 保留');
  // 落库失败（decisionOk=false）→ 会话内决断保留、成功反馈不回退
  const degraded = await runAccept({ disk: '这是测式文档\n第二行', decisionOk: false });
  assert.equal(degraded.decisions['chk-20260925-000000-abcd|README.md|0'], 'accepted', '落库失败仍会话内 accepted');
  assert.ok(degraded.toasts[0].m.startsWith('✓'), '降级不阻塞成功反馈');
});

t('L4-4 rejectChkSuggestion：本地记 rejected + 落库；已决断幂等不重复落库', async () => {
  const calls = [];
  const pf = {
    verId: 'BLD-20260925-110', phase: 'ready', plan: {
      docsCheck: { runId: 'chk-20260925-000000-eeee', phase: 'done', issues: { 'README.md': ISSUES_1 } },
    },
    chkDecisions: null, chkBusy: null, chkAnchor: null,
  };
  const ctx = vm.createContext({
    blockPublished: v => !!v?.release?.published, selVersion: () => null,
    state: { project: 'proj-x', pf },
    render: () => {},
    toast: () => {},
    encodeURIComponent,
    fetch: async (url, opts = {}) => {
      calls.push({ url, method: opts.method || 'GET', body: opts.body || null });
      return { ok: true, json: async () => ({}) };
    },
  });
  vm.runInContext([
    extractFn(SOURCE(), 'persistChkDecision'),
    extractFn(SOURCE(), 'rejectChkSuggestion'),
  ].join('\n'), ctx);
  await vm.runInContext('rejectChkSuggestion("README.md", 0)', ctx);
  assert.equal(pf.chkDecisions['chk-20260925-000000-eeee|README.md|0'], 'rejected', '拒绝本地记决断');
  const dec = calls.filter((c) => c.url.includes('/api/build/docs-check/decision'));
  assert.equal(dec.length, 1, '拒绝落库一次');
  assert.ok(dec[0].body.includes('"decision":"rejected"'));
  await vm.runInContext('rejectChkSuggestion("README.md", 0)', ctx);
  assert.equal(calls.filter((c) => c.url.includes('/api/build/docs-check/decision')).length, 1, '已决断幂等不重复落库');
});

/* ---------- L4 渲染：决断保持与新 run 失效提示 ---------- */

function renderPaneWith(pfOverrides) {
  const source = SOURCE();
  const pick = (name) => {
    const m = source.match(new RegExp(`  function ${name}\\(([a-zA-Z0-9_, ]*)\\) \\{[\\s\\S]*?\\n  \\}`));
    assert.ok(m, `build.js 中应存在 ${name} 函数`);
    return m[0];
  };
  const ctx = {
    pfOf: (v) => v.pf,
    esc: ESC,
    short: (h) => String(h || '').slice(0, 8),
    fmtTime: () => 't',
    ...FLOW_STUB,
  };
  const context = vm.createContext({ blockPublished: v => !!v?.release?.published, selVersion: () => null, ...ctx });
  vm.runInContext([
    pick('summaryBtnText'), pick('translateBtnText'), pick('normalizeFlowEval'), pick('translateBtnHtml'),
    pick('commitBtnHtml'), pick('docsStageBar'), pick('renderDocsPane'),
    pick('parseIssueLineNo'), pick('splitProofreadIssues'), pick('parseChkSuggestion'),
    pick('classifyChkIssue'), pick('chkPendingCount'),
  ].join('\n'), context);
  const pf = {
    phase: 'ready',
    plan: {
      langs: ['cn', 'en'],
      docs: { overall: 'none', reasons: [] },
      docsCheck: {
        runId: 'chk-20260925-000000-rrrr', phase: 'done',
        files: { 'README.md': 'fail' },
        issues: { 'README.md': ISSUES_R },
        decisions: { 'README.md|0': 'accepted', 'README.md|1': 'rejected' },
        supersededDecided: 2,
      },
    },
    chkDecisions: {
      'chk-20260925-000000-rrrr|README.md|0': 'accepted',
      'chk-20260925-000000-rrrr|README.md|1': 'rejected',
    },
    ...pfOverrides,
  };
  const html = vm.runInContext(`renderDocsPane({ id: 'V', pf: ${JSON.stringify(pf)} })`, context);
  const gateTitle = vm.runInContext(`translateBtnHtml(${JSON.stringify(pf)})`, context);
  return { html, gateTitle };
}

t('L4-5 renderDocsPane：决断渲染保持（已接受 / 已拒绝 chip、待处理 0、无接受按钮）；④ 门禁不回退；新 run 旧决断失效提示', () => {
  const { html, gateTitle } = renderPaneWith({});
  assert.ok(html.includes('待处理 0 项'), '全部已决断 → 待处理 0 项（计数不回涨）');
  assert.ok(html.includes('已接受'), '已接受 chip');
  assert.ok(html.includes('已拒绝'), '已拒绝 chip');
  assert.ok(!html.includes('data-chk-accept'), '已决断条目无接受按钮（幂等）');
  assert.ok(!gateTitle.includes('校对建议未处理'), '④ AI 翻译门禁不因刷新回退（已决断不计入）');
  assert.ok(html.includes('上一轮校对已处理 2 条'), '新 run 旧决断失效有可感知说明');
  // 未决断对照：决断丢失（旧缺陷形态）→ 待处理回涨、门禁拦截
  const lost = renderPaneWith({ chkDecisions: null });
  assert.ok(lost.html.includes('待处理 2 项'), '决断丢失时按待处理计（对照）');
  assert.ok(lost.gateTitle.includes('尚有 2 条校对建议未处理'), '未决断时门禁拦截（对照）');
});

/* ---------- L6 i18n ---------- */

t('L6-1 i18n：新增文案中英词条齐备；动态键编译与往返不变形', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN, EN_DYNAMIC } = I._dict;
  const statics = [
    '✓ 该建议此前已应用：当前内容已是建议后的文本，无需重复操作',
  ];
  for (const k of statics) assert.ok(typeof EN[k] === 'string' && EN[k], `静态词条缺失：${k}`);
  const dynamics = [
    '上一轮校对已处理 ◇ 条：决断随新一轮校对失效，本轮结论需逐条重新接受或拒绝。',
  ];
  for (const k of dynamics) assert.ok(k in EN_DYNAMIC, `动态词条缺失：${k}`);
  I.setLang('en');
  assert.equal(I.t('✓ 该建议此前已应用：当前内容已是建议后的文本，无需重复操作'), EN['✓ 该建议此前已应用：当前内容已是建议后的文本，无需重复操作']);
  const dyn = I.t('上一轮校对已处理 2 条：决断随新一轮校对失效，本轮结论需逐条重新接受或拒绝。');
  assert.ok(/2/.test(dyn) && !dyn.includes('◇'), '动态键插值生效');
  I.setLang('zh');
  assert.equal(I.t('✓ 该建议此前已应用：当前内容已是建议后的文本，无需重复操作'), '✓ 该建议此前已应用：当前内容已是建议后的文本，无需重复操作');
});

/* ---------- 执行 ---------- */

for (const [name, fn] of cases) {
  await fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
