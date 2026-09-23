#!/usr/bin/env node
// REQ-20260924-002 AI 总结与 AI 翻译任务面板增加终止任务功能 —— 分层测试。
// L1 数据层回归：finishSummaryRun / finishTranslateRun failed 收尾口径（残留回退、
//    已完成保留、独立锁释放、可立即重启）；
// L3 服务接口：/api/build/docs-summary/abort 与 /api/build/docs-translate/abort
//    （走既有 fail 收尾、锁释放、可立即重启、全局任务面板移出、无进行中 run 400）；
// L4 前端渲染：running 态出现红色危险「终止任务」按钮（failed / done / 空态不出现）；
// L5 前端静态契约：二次确认交互与按钮绑定；
// L6 i18n：新增文案中英词条齐备（静态精确 + 动态插值）。
// 用法：node scripts/tests/req-20260924-002.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as summaryStore from '../lib/docs-summary-store.mjs';
import * as translateStore from '../lib/docs-translate-store.mjs';
import '../web/i18n.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tmpdir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

const ABORT_REASON = '人工终止任务：看板「终止任务」收尾（在途执行子代理需在对应 Agent 会话人工停止）';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- L1 数据层回归（既有 fail 收尾口径，终止功能的事实源） ---------- */

t('L1-1 summary failed 收尾：残留回退、已完成保留、锁释放、可立即重启', () => {
  const dataDir = core.initData(tmpdir('atb-002-l1a-'));
  const s1 = summaryStore.createSummaryRun(dataDir, { verId: 'BLD-20260924-002', owner: 't', langs: ['cn', 'en'] });
  summaryStore.markSummaryFile(dataDir, s1.runId, 'README.md', 'summarized');
  summaryStore.markSummaryFile(dataDir, s1.runId, 'CHANGELOG.md', 'summarizing');
  summaryStore.finishSummaryRun(dataDir, s1.runId, { result: 'failed', reason: ABORT_REASON });
  const v = summaryStore.summaryRunView(summaryStore.getSummaryRun(dataDir, s1.runId));
  assert.equal(v.phase, 'failed');
  assert.match(v.reason, /人工终止/);
  assert.equal(v.files['README.md'], 'summarized', '已总结文件保留（跨 run 可续跑）');
  assert.equal(v.files['CHANGELOG.md'], 'pending', '残留「正在总结」回退不悬挂');
  assert.equal(fs.existsSync(path.join(dataDir, 'runtime', '.locks', 'summary.lock')), false, 'summary 锁已释放');
  const s2 = summaryStore.createSummaryRun(dataDir, { verId: 'BLD-20260924-002', owner: 't', langs: ['cn', 'en'] });
  assert.ok(s2.runId.startsWith('sum-'), '终止后可立即重启（不提示锁占用）');
});

t('L1-2 translate failed 收尾：残留回退、已完成保留、锁释放、可立即重启', () => {
  const dataDir = core.initData(tmpdir('atb-002-l1b-'));
  const r1 = translateStore.createTranslateRun(dataDir, { verId: 'BLD-20260924-002', owner: 't', langs: ['cn', 'en'] });
  translateStore.markTranslateFile(dataDir, r1.runId, 'README_en.md', 'translated');
  translateStore.markTranslateFile(dataDir, r1.runId, 'CHANGELOG_en.md', 'translating');
  translateStore.finishTranslateRun(dataDir, r1.runId, { result: 'failed', reason: ABORT_REASON });
  const v = translateStore.translateRunView(translateStore.getTranslateRun(dataDir, r1.runId));
  assert.equal(v.phase, 'failed');
  assert.match(v.reason, /人工终止/);
  assert.equal(v.files['README_en.md'], 'translated', '已翻译文件保留（跨 run 可续跑）');
  assert.equal(v.files['CHANGELOG_en.md'], 'pending', '残留「正在翻译」回退不悬挂');
  assert.equal(fs.existsSync(path.join(dataDir, 'runtime', '.locks', 'translate.lock')), false, 'translate 锁已释放');
  const r2 = translateStore.createTranslateRun(dataDir, { verId: 'BLD-20260924-002', owner: 't', langs: ['cn', 'en'] });
  assert.ok(r2.runId.startsWith('tr-'), '终止后可立即重启（不提示锁占用）');
});

/* ---------- L3 服务接口 ---------- */

function req(port, method, pathname, payload = null) {
  return new Promise((resolve, reject) => {
    const data = payload ? JSON.stringify(payload) : null;
    const r = http.request({ host: '127.0.0.1', port, method, path: pathname, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch {}
        resolve({ status: res.statusCode, json, text: body });
      });
    });
    r.setTimeout(15000, () => { r.destroy(); reject(new Error('timeout')); });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function startServer(proj, reg) {
  for (let i = 0; i < 6; i++) {
    const p = 33500 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
      cwd: proj,
      env: { ...process.env, ATB_PORT: String(p), ATB_REGISTRY: reg },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    for (let k = 0; k < 40; k++) {
      await sleep(150);
      try { const h = await req(p, 'GET', '/api/health'); if (h.json && h.json.port === p) return { child, port: p }; } catch {}
      if (child.exitCode !== null) break;
    }
    child.kill('SIGTERM');
  }
  throw new Error('服务应启动');
}

t('L3 终止接口：summary / translate abort 走 fail 收尾、锁释放、可立即重启、全局面板移出', async () => {
  const tmp = tmpdir('atb-002-serve-');
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(proj, { recursive: true });
  core.initData(proj);
  const dataDir = core.dataDirFrom(proj);
  const reg = path.join(tmp, 'reg.json');
  const { child: server, port } = await startServer(proj, reg);
  const P = `?project=${encodeURIComponent(proj)}`;
  try {
    // 无进行中 run：缺省解析如实 400
    let r = await req(port, 'POST', `/api/build/docs-summary/abort${P}`, {});
    assert.equal(r.status, 400, '无进行中总结任务 400');
    assert.match(r.json.error || '', /尚无进行中的 AI 总结任务/);
    r = await req(port, 'POST', `/api/build/docs-translate/abort${P}`, {});
    assert.equal(r.status, 400, '无进行中翻译任务 400');
    assert.match(r.json.error || '', /尚无进行中的 AI 翻译任务/);

    // ---- AI 总结：store 建 run（start 同源账本与锁）→ 标记进度 → abort ----
    const s1 = summaryStore.createSummaryRun(dataDir, { verId: 'BLD-20260924-002', owner: 'summary', langs: ['cn', 'en'] });
    summaryStore.markSummaryFile(dataDir, s1.runId, 'README.md', 'summarized');
    summaryStore.markSummaryFile(dataDir, s1.runId, 'CHANGELOG.md', 'summarizing');
    r = await req(port, 'POST', `/api/build/docs-summary/abort${P}`, {});
    assert.equal(r.status, 200, `summary abort：${r.text}`);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.runId, s1.runId, '缺省解析唯一进行中 run');
    assert.equal(r.json.run.phase, 'failed', 'run 置 failed');
    assert.match(r.json.run.reason, /人工终止/, '携带人工终止类原因');
    assert.equal(r.json.run.files['README.md'], 'summarized', '已总结文件保留');
    assert.equal(r.json.run.files['CHANGELOG.md'], 'pending', '残留回退不悬挂');
    assert.equal(fs.existsSync(path.join(dataDir, 'runtime', '.locks', 'summary.lock')), false, 'summary 锁释放');
    // 全局面板移出该 run
    r = await req(port, 'GET', '/api/batch/global');
    const row = (r.json.projects || []).find((p) => p.root === proj);
    assert.ok(!((row?.tasks || []).some((x) => x.kind === 'summary')), '收尾后全局面板移出 summary run');
    // 可立即重启（不提示锁占用）；body.runId 指向已收尾 run 报错
    const s2 = summaryStore.createSummaryRun(dataDir, { verId: 'BLD-20260924-002', owner: 'summary', langs: ['cn', 'en'] });
    assert.ok(s2.runId.startsWith('sum-'), '终止后可立即重新启动 AI 总结');
    r = await req(port, 'POST', `/api/build/docs-summary/abort${P}`, { runId: s1.runId });
    assert.equal(r.status, 400, 'runId 指向已收尾 run 报错');
    assert.match(r.json.error || '', /不在进行中|已收尾/);
    r = await req(port, 'POST', `/api/build/docs-summary/abort${P}`, {});
    assert.equal(r.status, 200, '缺省解析唯一进行中 run 可终止');
    assert.equal(r.json.run.runId, s2.runId);

    // ---- AI 翻译：store 建 run（start 同源账本与锁）→ abort ----
    const tr = translateStore.createTranslateRun(dataDir, { verId: 'BLD-20260924-002', owner: 'translate', langs: ['cn', 'en'] });
    translateStore.markTranslateFile(dataDir, tr.runId, 'README_en.md', 'translated');
    translateStore.markTranslateFile(dataDir, tr.runId, 'CHANGELOG_en.md', 'translating');
    r = await req(port, 'POST', `/api/build/docs-translate/abort${P}`, {});
    assert.equal(r.status, 200, `translate abort：${r.text}`);
    assert.equal(r.json.runId, tr.runId);
    assert.equal(r.json.run.phase, 'failed');
    assert.match(r.json.run.reason, /人工终止/);
    assert.equal(r.json.run.files['README_en.md'], 'translated', '已翻译文件保留');
    assert.equal(r.json.run.files['CHANGELOG_en.md'], 'pending', '残留回退不悬挂');
    assert.equal(fs.existsSync(path.join(dataDir, 'runtime', '.locks', 'translate.lock')), false, 'translate 锁释放');
    r = await req(port, 'GET', '/api/batch/global');
    const row2 = (r.json.projects || []).find((p) => p.root === proj);
    assert.ok(!((row2?.tasks || []).some((x) => x.kind === 'translate')), '收尾后全局面板移出 translate run');
    // 可立即重启（不提示锁占用）
    const tr2 = translateStore.createTranslateRun(dataDir, { verId: 'BLD-20260924-002', owner: 'translate', langs: ['cn', 'en'] });
    assert.ok(tr2.runId.startsWith('tr-'), '终止后可立即重新启动 AI 翻译');
    r = await req(port, 'POST', `/api/build/docs-translate/abort${P}`, {});
    assert.equal(r.status, 200);
  } finally {
    server.kill('SIGTERM');
  }
});

/* ---------- L4 前端渲染（app.js 面板函数按 running / failed / done / 空态分支） ---------- */

function extractFn(source, name) {
  const m = source.match(new RegExp(`function ${name}\\(\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(m, `app.js 中应存在 ${name} 函数`);
  return m[0];
}

function vmRun(fns, context, expr) {
  const ctx = vm.createContext(context);
  vm.runInContext(fns, ctx);
  return vm.runInContext(expr, ctx);
}

function panelCtx(kind, run) {
  return {
    state: kind === 'summary' ? { summary: { data: { run } } } : { translate: { data: { run } } },
    esc: (s) => String(s ?? ''),
    fmtTime: () => 'T',
    SUMMARY_PHASE_LABEL: { running: '进行中', done: '已完成', failed: '失败' },
    TRANSLATE_PHASE_LABEL: { running: '进行中', done: '已完成', failed: '失败' },
  };
}

const RUN_BASE = { runId: 'sum-x', verId: 'BLD-20260924-002', owner: 't', files: {}, counts: { summarized: 1, total: 4 }, createdAt: '', updatedAt: '', finishedAt: null };

t('L4 AI 总结面板：仅 running 态出现红色危险「终止任务」按钮（failed / done / 空态不出现）', () => {
  const source = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const fn = extractFn(source, 'renderSummaryPanel');
  const running = vmRun(fn, panelCtx('summary', { ...RUN_BASE, phase: 'running', currentFile: 'README.md' }), 'renderSummaryPanel()');
  assert.match(running, /id="summaryAbort"/, 'running 出现终止按钮');
  assert.match(running, /class="btn danger"[^>]*id="summaryAbort"|id="summaryAbort"[^>]*class="btn danger"/, '红色危险样式');
  assert.match(running, />终止任务</, '按钮文案');
  for (const phase of ['failed', 'done']) {
    const html = vmRun(fn, panelCtx('summary', { ...RUN_BASE, phase, reason: '人工终止', finishedAt: '' }), 'renderSummaryPanel()');
    assert.ok(!html.includes('summaryAbort'), `${phase} 态不出现终止按钮`);
  }
  const empty = vmRun(fn, panelCtx('summary', null), 'renderSummaryPanel()');
  assert.ok(!empty.includes('summaryAbort'), '空态不出现终止按钮');
});

t('L4 AI 翻译面板：仅 running 态出现红色危险「终止任务」按钮（failed / done / 空态不出现）', () => {
  const source = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const fn = extractFn(source, 'renderTranslatePanel');
  const running = vmRun(fn, panelCtx('translate', { ...RUN_BASE, runId: 'tr-x', phase: 'running', currentFile: 'README_en.md' }), 'renderTranslatePanel()');
  assert.match(running, /id="translateAbort"/, 'running 出现终止按钮');
  assert.match(running, /class="btn danger"[^>]*id="translateAbort"|id="translateAbort"[^>]*class="btn danger"/, '红色危险样式');
  assert.match(running, />终止任务</, '按钮文案');
  for (const phase of ['failed', 'done']) {
    const html = vmRun(fn, panelCtx('translate', { ...RUN_BASE, runId: 'tr-x', phase, reason: '人工终止', finishedAt: '' }), 'renderTranslatePanel()');
    assert.ok(!html.includes('translateAbort'), `${phase} 态不出现终止按钮`);
  }
  const empty = vmRun(fn, panelCtx('translate', null), 'renderTranslatePanel()');
  assert.ok(!empty.includes('translateAbort'), '空态不出现终止按钮');
});

/* ---------- L5 前端静态契约（确认交互与绑定） ---------- */

t('L5 终止交互与绑定：uiConfirm 危险二次确认 + abort 接口 + 面板刷新 + bindBatchDrawer 绑定', () => {
  const source = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  for (const [fn, apiPath, btnId, title, kind] of [
    ['abortSummaryTask', '/api/build/docs-summary/abort', 'summaryAbort', '终止 AI 总结任务？', '总结'],
    ['abortTranslateTask', '/api/build/docs-translate/abort', 'translateAbort', '终止 AI 翻译任务？', '翻译'],
  ]) {
    const m = source.match(new RegExp(`async function ${fn}\\(\\) \\{[\\s\\S]*?\\n\\}`));
    assert.ok(m, `应有 ${fn} 函数`);
    const body = m[0];
    assert.ok(body.includes('uiConfirm'), '二次确认交互（与 AI 开发 / AI 分析终止同形态）');
    assert.ok(body.includes('danger: true'), '危险确认样式');
    assert.ok(body.includes(`title: '${title}'`), '确认弹层标题按总结 / 翻译适配');
    assert.ok(body.includes('confirmText: \'终止任务\''), '确认文案');
    assert.ok(body.includes('在途'), '确认文案提示在途子代理需人工停止');
    assert.ok(body.includes(apiPath), `确认后调用 ${apiPath}`);
    assert.ok(body.includes('refresh'), '终止后刷新面板视图');
  }
  // 按钮绑定进 bindBatchDrawer
  const bind = source.match(/const sumAbort = drawer\.querySelector\('#summaryAbort'\);[\s\S]{0,300}/);
  assert.ok(bind, '应绑定 #summaryAbort');
  assert.ok(bind[0].includes('abortSummaryTask'), 'summaryAbort → abortSummaryTask');
  const bind2 = source.match(/const trAbort = drawer\.querySelector\('#translateAbort'\);[\s\S]{0,300}/);
  assert.ok(bind2, '应绑定 #translateAbort');
  assert.ok(bind2[0].includes('abortTranslateTask'), 'translateAbort → abortTranslateTask');
  assert.ok(source.includes("'终止 AI 总结任务？'") && source.includes("'终止 AI 翻译任务？'"), '确认标题文案');
});

/* ---------- L6 i18n ---------- */

t('L6 i18n：新增终止文案中英词条齐备（静态 + 动态插值）', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN, EN_DYNAMIC } = I._dict;
  const statics = [
    '终止 AI 总结任务？',
    '终止 AI 翻译任务？',
    '确认后本轮任务中断收尾：残留「正在总结」回退待处理、已总结文件保留，独立锁释放，可立即重新启动续跑。在途执行子代理需在对应 Agent 会话人工停止。',
    '确认后本轮任务中断收尾：残留「正在翻译」回退待处理、已翻译文件保留，独立锁释放，可立即重新启动续跑。在途执行子代理需在对应 Agent 会话人工停止。',
    '中断收尾：残留「正在总结」回退、已完成文件保留、释放独立锁 summary；在途子代理需在对应会话人工停止',
    '中断收尾：残留「正在翻译」回退、已完成文件保留、释放独立锁 translate；在途子代理需在对应会话人工停止',
    '终止任务',
  ];
  for (const k of statics) assert.ok(typeof EN[k] === 'string' && EN[k], `静态词条缺失：${k.slice(0, 16)}…`);
  const dynamics = ['✓ 已终止 AI 总结任务：◇', '✓ 已终止 AI 翻译任务：◇'];
  for (const k of dynamics) assert.ok(k in EN_DYNAMIC, `动态词条缺失：${k}`);
  I.setLang('en');
  assert.equal(I.t('终止 AI 总结任务？'), 'Abort AI summary task?');
  assert.equal(I.t('终止 AI 翻译任务？'), 'Abort AI translation task?');
  assert.equal(I.t('✓ 已终止 AI 总结任务：done'), '✓ AI summary task aborted: done');
  assert.equal(I.t('✓ 已终止 AI 翻译任务：done'), '✓ AI translation task aborted: done');
  I.setLang('zh');
  assert.equal(I.t('终止 AI 总结任务？'), '终止 AI 总结任务？');
});

/* ---------- 执行 ---------- */

for (const [name, fn] of cases) {
  await fn();
  console.log(`✓ ${name}`);
}
console.log(`\n共 ${cases.length} 例，全部通过`);
