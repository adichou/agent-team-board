#!/usr/bin/env node
// REQ-20260911-007 —— 受阻待人工决策条目的承接机制：声明 → 持久呈现 → 人工决策 → 复工 → 防呆。
// 覆盖：hold 账本（holds/holds.json + 条目 decisions.md）、CLI（atb hold declare/list/show/answer/resume/cancel）、
// core 集成（claim 拦截 / 确认完成防呆 / 复工专用通路）、state-guard 拦截面、Status Board API 与前端静态契约。
// 用法：node scripts/tests/hold-20260911-007.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as batch from '../lib/batch.mjs';
import * as holdStates from '../lib/hold-states.mjs';
import * as holdStore from '../lib/hold-store.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ATB = path.join(pluginRoot, 'scripts', 'atb.mjs');
const GUARD = path.join(pluginRoot, 'scripts', 'state-guard.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function mkProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-hold-007-')));
  core.initData(root);
  const dataDir = core.dataDirFrom(root);
  return { root, dataDir };
}

// 造一个 in-progress 条目（submit → accept → plan → claim 全链路）
function mkInProgress(dataDir, title = '待决策条目', owner = 'worker-1') {
  const it = core.createItem(dataDir, { type: 'requirement', title });
  core.setStatus(dataDir, it.id, 'accepted', { by: 'human' });
  core.setStatus(dataDir, it.id, 'planned', { by: 'human' });
  core.claim(dataDir, it.id, owner);
  return it;
}

function atb(root, args, { json = false } = {}) {
  const full = [...args, '--dir', root];
  if (json) full.push('--json');
  const r = spawnSync(process.execPath, [ATB, ...full], { encoding: 'utf8', timeout: 60_000 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function runGuard(mode, toolInput, cwd) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [GUARD, mode], {
      cwd: cwd || pluginRoot,
      env: process.env,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let err = '';
    p.stderr.on('data', (c) => { err += c; });
    p.on('close', (code) => resolve({ code, err }));
    p.stdin.write(JSON.stringify({ tool_name: mode === 'file' ? 'Write' : 'Bash', cwd: cwd || pluginRoot, tool_input: toolInput }));
    p.stdin.end();
  });
}

function req(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 8000,
    }, (rs) => {
      let out = '';
      rs.on('data', (c) => { out += c; });
      rs.on('end', () => { try { resolve({ status: rs.statusCode, json: JSON.parse(out || '{}') }); } catch { resolve({ status: rs.statusCode, json: null, raw: out }); } });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (payload) r.write(payload);
    r.end();
  });
}

// ---------- D 组：声明 / 清单 / 作答 / 复工 / 作废 / 多轮 / 存量 ----------

t('D1 worker 声明：两个问题落账、条目 decisions.md 生成、事件留痕', () => {
  const { root, dataDir } = mkProject();
  const it = mkInProgress(dataDir);
  const r = atb(root, ['hold', 'declare', it.id, '--question', '首批平台范围是 iOS 还是双端？', '--question', '覆盖率口径按文件还是行？', '--reason', '缺人工确认首批平台与覆盖率口径', '--by', 'worker-1']);
  assert.equal(r.code, 0, `declare 应成功：${r.err}`);
  assert.ok(r.out.includes('待人工确认'), 'declare 输出应指向待人工确认视图');

  const rec = holdStates.holdOf(dataDir, it.id);
  assert.ok(rec, 'holds.json 应有该条目记录');
  assert.equal(rec.state, 'holding');
  assert.equal(rec.declaredBy, 'worker-1');
  assert.equal(rec.questions.length, 2);
  assert.equal(rec.questions[0].id, 'q1');
  assert.equal(holdStates.unansweredCount(rec), 2);
  assert.ok(rec.events.some((e) => e.kind === 'declared'), '事件应留痕 declared');

  const { dir } = core.resolveItemDir(dataDir, it.id);
  const md = fs.readFileSync(path.join(dir, 'decisions.md'), 'utf8');
  assert.ok(md.includes(it.id), 'decisions.md 应含条目编号');
  assert.ok(md.includes('首批平台范围是 iOS 还是双端？'), 'decisions.md 应含问题清单');
  assert.ok(md.includes('未答'), 'decisions.md 应展示未答状态');
});

t('D2 声明校验：非 in-progress / 重复声明 / 无问题 / 超限拒绝', () => {
  const { root, dataDir } = mkProject();
  const planned = core.createItem(dataDir, { type: 'requirement', title: '还没开发' });
  core.setStatus(dataDir, planned.id, 'accepted', { by: 'human' });
  core.setStatus(dataDir, planned.id, 'planned', { by: 'human' });
  let r = atb(root, ['hold', 'declare', planned.id, '--question', '问题']);
  assert.notEqual(r.code, 0);
  assert.ok(r.err.includes('in-progress'), `planned 条目声明应被拒：${r.err}`);

  const it = mkInProgress(dataDir);
  r = atb(root, ['hold', 'declare', it.id, '--question', '问题一']);
  assert.equal(r.code, 0, r.err);
  r = atb(root, ['hold', 'declare', it.id, '--question', '问题二']);
  assert.notEqual(r.code, 0);
  assert.ok(r.err.includes('待人工决策'), `holding 中重复声明应被拒：${r.err}`);

  r = atb(root, ['hold', 'declare', it.id, '--question', '']);
  assert.notEqual(r.code, 0);

  // 超限：手工实施互斥下另一条目用独立项目验证（同一项目同时只能有一个手工认领）
  const p2 = mkProject();
  const other = mkInProgress(p2.dataDir, '超限', 'worker-1');
  r = atb(p2.root, ['hold', 'declare', other.id, ...Array.from({ length: 21 }, (_, i) => ['--question', `问题${i}`]).flat()]);
  assert.notEqual(r.code, 0, '问题数超过上限应拒绝');
});

t('D3 CLI 清单与详情：list --json 计数正确、空态退出 0、show 含问题明细', () => {
  const { root, dataDir } = mkProject();
  let r = atb(root, ['hold', 'list'], { json: true });
  assert.equal(r.code, 0);
  let payload = JSON.parse(r.out);
  assert.equal(payload.items.length, 0, '初始应无活动 hold');

  const it = mkInProgress(dataDir, '清单条目', 'worker-1');
  atb(root, ['hold', 'declare', it.id, '--question', '范围口径？', '--reason', '范围待确认']);
  r = atb(root, ['hold', 'list'], { json: true });
  payload = JSON.parse(r.out);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].itemId, it.id);
  assert.equal(payload.items[0].unanswered, 1);
  assert.equal(payload.items[0].total, 1);
  assert.ok(payload.items[0].declaredAt, '清单应含声明时间');
  assert.equal(payload.items[0].reason, '范围待确认');

  r = atb(root, ['hold', 'list']);
  assert.equal(r.code, 0);
  assert.ok(r.out.includes(it.id), '文本清单应含条目编号');

  r = atb(root, ['hold', 'show', it.id]);
  assert.equal(r.code, 0);
  assert.ok(r.out.includes('范围口径？'), 'show 应含问题明细');
});

t('D4 人工作答：草稿可存、decisions.md 更新、覆盖重答、未知问题拒绝', () => {
  const { root, dataDir } = mkProject();
  const it = mkInProgress(dataDir);
  atb(root, ['hold', 'declare', it.id, '--question', 'Q1', '--question', 'Q2', '--by', 'worker-1']);
  let r = atb(root, ['hold', 'answer', it.id, '--q', 'q1', '--text', '先做 iOS 单端', '--by', 'human-a']);
  assert.equal(r.code, 0, r.err);
  let rec = holdStates.holdOf(dataDir, it.id);
  assert.equal(holdStates.unansweredCount(rec), 1, '部分作答后未答应为 1');
  assert.equal(rec.questions[0].answer, '先做 iOS 单端');
  assert.equal(rec.questions[0].answeredBy, 'human-a');

  const { dir } = core.resolveItemDir(dataDir, it.id);
  const md = fs.readFileSync(path.join(dir, 'decisions.md'), 'utf8');
  assert.ok(md.includes('先做 iOS 单端'), 'decisions.md 应含人工答复');
  assert.ok(md.includes('human-a'), 'decisions.md 应含作答人');

  r = atb(root, ['hold', 'answer', it.id, '--q', 'q1', '--text', '改为双端', '--by', 'human-b']);
  assert.equal(r.code, 0, '覆盖重答应成功');
  rec = holdStates.holdOf(dataDir, it.id);
  assert.equal(rec.questions[0].answer, '改为双端');

  r = atb(root, ['hold', 'answer', it.id, '--q', 'q9', '--text', 'x']);
  assert.notEqual(r.code, 0, '未知问题应拒绝');
});

t('D5 复工闭环：缺项拒绝并列缺项；齐备后回 planned、owner 清空、锁清理、重新可入批', () => {
  const { root, dataDir } = mkProject();
  const it = mkInProgress(dataDir, '复工闭环', 'worker-1');
  atb(root, ['hold', 'declare', it.id, '--question', 'Q1', '--question', 'Q2']);
  atb(root, ['hold', 'answer', it.id, '--q', 'q1', '--text', '答一']);

  let r = atb(root, ['hold', 'resume', it.id]);
  assert.notEqual(r.code, 0, '缺项 resume 应被拒');
  assert.ok(r.err.includes('q2'), `缺项提示应列出未答问题：${r.err}`);

  r = atb(root, ['hold', 'resume', it.id, '--by', 'human']);
  assert.notEqual(r.code, 0, 'by 也无法绕过缺项');

  atb(root, ['hold', 'answer', it.id, '--q', 'q2', '--text', '答二']);
  r = atb(root, ['hold', 'resume', it.id, '--by', 'human']);
  assert.equal(r.code, 0, `齐备 resume 应成功：${r.err}`);

  const st = core.readStatus(core.resolveItemDir(dataDir, it.id).dir);
  assert.equal(st.status, 'planned', '复工后条目应回到已计划');
  assert.equal(st.owner, null, '复工应清空 owner');
  assert.ok(st.history.some((h) => h.to === 'planned' && String(h.note || '').includes('复工')), 'history 应留痕复工');
  assert.ok(!fs.existsSync(path.join(dataDir, '.locks', `${it.id}.lock`)), '复工应清理认领锁');
  assert.equal(holdStates.holdOf(dataDir, it.id).state, 'resumed');

  const cand = batch.candidateItems(dataDir).map((x) => x.id);
  assert.ok(cand.includes(it.id), '复工后条目应重新进入批量开发候选');
});

t('D6 复工状态校验：条目已 done → 拒绝且不静默变更', () => {
  const { root, dataDir } = mkProject();
  const it = mkInProgress(dataDir, '已确认', 'worker-1');
  atb(root, ['hold', 'declare', it.id, '--question', 'Q1']);
  // 未答项存在时人工显式 force 确认完成 → hold 随确认闭环；此后复工被拒（无活动声明 / 状态已变化）
  core.setStatus(dataDir, it.id, 'done', { by: 'human', force: true });
  const r = atb(root, ['hold', 'resume', it.id]);
  assert.notEqual(r.code, 0, 'done 条目 resume 应被拒');
  assert.ok(/没有活动中|状态已变化|done/.test(r.err), `应给出明确拒绝原因：${r.err}`);
  assert.equal(core.readStatus(core.resolveItemDir(dataDir, it.id).dir).status, 'done');
});

t('D7 作废：holding→cancelled、条目状态不变、确认完成不再拦截', () => {
  const { root, dataDir } = mkProject();
  const it = mkInProgress(dataDir, '作废', 'worker-1');
  atb(root, ['hold', 'declare', it.id, '--question', 'Q1']);
  const r = atb(root, ['hold', 'cancel', it.id, '--note', '口头确认过', '--by', 'human']);
  assert.equal(r.code, 0, r.err);
  assert.equal(holdStates.holdOf(dataDir, it.id).state, 'cancelled');
  assert.equal(core.readStatus(core.resolveItemDir(dataDir, it.id).dir).status, 'in-progress', '作废不改条目状态');
  // 无活动 hold：确认完成不再被拦截（无需 force）
  const { status: st } = core.setStatus(dataDir, it.id, 'done', { by: 'human' });
  assert.equal(st.status, 'done');
});

t('D8 多轮承接：resumed 后再声明开新一轮，旧轮归档并保留历史', () => {
  const { root, dataDir } = mkProject();
  const it = mkInProgress(dataDir, '多轮', 'worker-1');
  atb(root, ['hold', 'declare', it.id, '--question', 'Q1', '--by', 'worker-1']);
  atb(root, ['hold', 'answer', it.id, '--q', 'q1', '--text', 'A']);
  atb(root, ['hold', 'resume', it.id, '--by', 'human']);
  // 重新认领后再受阻：新一轮声明
  core.claim(dataDir, it.id, 'worker-2');
  const r = atb(root, ['hold', 'declare', it.id, '--question', '新问题', '--by', 'worker-2']);
  assert.equal(r.code, 0, r.err);
  const rec = holdStates.holdOf(dataDir, it.id);
  assert.equal(rec.round, 2, '第二轮 round 应为 2');
  assert.equal(rec.questions[0].text, '新问题');
  const archived = holdStates.readHolds(dataDir).archived[it.id] || [];
  assert.equal(archived.length, 1, '旧轮应进 archived');
  assert.equal(archived[0].round, 1);

  const { dir } = core.resolveItemDir(dataDir, it.id);
  const md = fs.readFileSync(path.join(dir, 'decisions.md'), 'utf8');
  assert.ok(md.includes('第 2 轮') || md.includes('2'), 'decisions.md 应体现轮次');
});

t('D9 存量滞留单：已有 owner 的旧 in-progress 条目可无 run 声明承接', () => {
  const { root, dataDir } = mkProject();
  const it = core.createItem(dataDir, { type: 'requirement', title: '滞留三天的老单' });
  core.setStatus(dataDir, it.id, 'accepted', { by: 'human' });
  core.setStatus(dataDir, it.id, 'planned', { by: 'human' });
  core.claim(dataDir, it.id, 'zcode-batch-001-1');
  // 不带 --run 声明（存量单没有可关联的运行）
  const r = atb(root, ['hold', 'declare', it.id, '--question', '首批平台与覆盖率口径？', '--reason', 'blocked 回执滞留', '--by', 'zcode-batch-001-1']);
  assert.equal(r.code, 0, `存量单声明应成功：${r.err}`);
  const rec = holdStates.holdOf(dataDir, it.id);
  assert.equal(rec.runId, null, '无运行关联时 runId 为 null');
  assert.equal(holdStates.unansweredCount(rec), 1);
});

// ---------- P 组：core 集成（认领防呆 / 确认完成防呆 / 回执兼容） ----------

t('P1 认领防呆：holding 条目任何 owner 认领均被拒并指向待确认原因；resume 后恢复', () => {
  const { root, dataDir } = mkProject();
  const it = mkInProgress(dataDir, '认领防呆', 'worker-1');
  atb(root, ['hold', 'declare', it.id, '--question', 'Q1', '--question', 'Q2', '--by', 'worker-1']);

  assert.throws(() => core.claim(dataDir, it.id, 'worker-2'), (e) => {
    assert.ok(e.message.includes('待人工决策') && e.message.includes('2 项'), `提示应含待人工决策与缺项数：${e.message}`);
    return true;
  }, '异 owner 认领应被拒');
  assert.throws(() => core.claim(dataDir, it.id, 'worker-1'), (e) => {
    assert.ok(e.message.includes('待人工决策'), `原 owner 续认同样应被拒：${e.message}`);
    return true;
  }, '原 owner 续认应被拒');

  atb(root, ['hold', 'answer', it.id, '--q', 'q1', '--text', 'A']);
  atb(root, ['hold', 'answer', it.id, '--q', 'q2', '--text', 'B']);
  atb(root, ['hold', 'resume', it.id, '--by', 'human']);
  const st = core.claim(dataDir, it.id, 'worker-3');
  assert.equal(st.status, 'in-progress', 'resume 后认领恢复可用');
  assert.equal(st.owner, 'worker-3');
});

t('P2 确认完成防呆：未答完拦截；force 越过并闭环；答完放行并闭环', () => {
  const { root, dataDir } = mkProject();
  const it = mkInProgress(dataDir, '确认完成防呆', 'worker-1');
  atb(root, ['hold', 'declare', it.id, '--question', 'Q1', '--question', 'Q2']);
  atb(root, ['hold', 'answer', it.id, '--q', 'q1', '--text', 'A']);

  assert.throws(() => core.setStatus(dataDir, it.id, 'done', { by: 'human' }), (e) => {
    assert.ok(e.message.includes('1 项') && e.message.includes('待人工决策'), `拦截信息应含缺项数与指引：${e.message}`);
    return true;
  }, '未答完确认完成应被拒');

  const { status: forced } = core.setStatus(dataDir, it.id, 'done', { by: 'human', force: true, note: '人工显式越过未答决策' });
  assert.equal(forced.status, 'done', 'force 应放行');
  assert.equal(holdStates.holdOf(dataDir, it.id).state, 'closed-done', 'force 确认后 hold 应闭环');

  const it2 = mkInProgress(dataDir, '答完闭环', 'worker-2');
  atb(root, ['hold', 'declare', it2.id, '--question', 'Q1']);
  atb(root, ['hold', 'answer', it2.id, '--q', 'q1', '--text', 'A']);
  const { status: st2 } = core.setStatus(dataDir, it2.id, 'done', { by: 'human' });
  assert.equal(st2.status, 'done', '答完后确认完成应直接放行');
  assert.equal(holdStates.holdOf(dataDir, it2.id).state, 'closed-done');
});

t('P3 回执兼容：声明 hold 后该条目的运行仍可交 blocked 回执', () => {
  const { root, dataDir } = mkProject();
  const it = core.createItem(dataDir, { type: 'requirement', title: '回执兼容' });
  core.setStatus(dataDir, it.id, 'accepted', { by: 'human' });
  core.setStatus(dataDir, it.id, 'planned', { by: 'human' });
  const { batch: b } = batch.createBatch(dataDir, { projectRoot: root });
  const got = batch.nextItem(dataDir, b.batchId, { owner: 'w1' });
  assert.equal(got.itemId, it.id);
  core.claim(dataDir, it.id, 'w1');
  // 声明 hold（关联运行）后交 blocked 回执——与既有协议完全一致
  atb(root, ['hold', 'declare', it.id, '--question', 'Q1', '--run', got.runId, '--by', 'w1']);
  const r = batch.finishRun(dataDir, got.runId, { result: 'blocked', reason: '待人工决策（已声明）' });
  assert.equal(r.ok, true, 'blocked 回执语义不变');
  const rec = holdStates.holdOf(dataDir, it.id);
  assert.equal(rec.runId, got.runId, '声明应关联 runId');
});

// ---------- G 组：state-guard 拦截面 ----------

t('G1 钩子拦截：Agent 执行 hold answer/resume/cancel 与 curl 决策 API → exit 2', async () => {
  const { root, dataDir } = mkProject();
  const it = mkInProgress(dataDir, '钩子拦截', 'worker-1');
  atb(root, ['hold', 'declare', it.id, '--question', 'Q1', '--by', 'worker-1']);
  const node = process.execPath;
  for (const args of [
    ['hold', 'answer', it.id, '--q', 'q1', '--text', '代答'],
    ['hold', 'resume', it.id],
    ['hold', 'cancel', it.id],
  ]) {
    const r = await runGuard('bash', { command: `${node} ${ATB} ${args.join(' ')} --dir ${root}` }, root);
    assert.equal(r.code, 2, `Agent 执行 atb ${args[1]} 应被拦截：${args.join(' ')}\n${r.err}`);
    assert.ok(r.err.includes('人工'), '拦截原因应说明人工专属');
  }
  const curl = await runGuard('bash', { command: `curl -s -X POST http://127.0.0.1:8888/api/hold/${it.id}/resume?project=${encodeURIComponent(root)}` }, root);
  assert.equal(curl.code, 2, `Agent curl 复工 API 应被拦截\n${curl.err}`);
  const curl2 = await runGuard('bash', { command: `curl -s -X POST -H 'Content-Type: application/json' -d '{"answers":[{"q":"q1","text":"x"}]}' http://127.0.0.1:8888/api/hold/${it.id}/answer?project=${encodeURIComponent(root)}` }, root);
  assert.equal(curl2.code, 2, `Agent curl 作答 API 应被拦截\n${curl2.err}`);
});

t('G2 钩子放行：hold list / declare / show 不被拦（worker 声明与查询可用）', async () => {
  const { root, dataDir } = mkProject();
  const it = mkInProgress(dataDir, '钩子放行', 'worker-1');
  const node = process.execPath;
  for (const args of [
    ['hold', 'list'],
    ['hold', 'list', '--json'],
    ['hold', 'declare', it.id, '--question', 'Q1', '--by', 'worker-1'],
    ['hold', 'show', it.id],
  ]) {
    const r = await runGuard('bash', { command: `${node} ${ATB} ${args.join(' ')} --dir ${root}` }, root);
    assert.equal(r.code, 0, `atb ${args[1]} 不应被拦：${r.err}`);
  }
});

// ---------- S 组：Status Board API ----------

// 批流夹具：create → accept → plan → batch create → next → claim →（调用方 declare）→ blocked 回执收尾，
// 与真实 worker 路径一致（手工 claim 的实施互斥一次只允许一条在办，批流靠回执释放可串行造多条）
function mkHoldViaBatch(root, dataDir, title, owner, question, reason) {
  const it = core.createItem(dataDir, { type: 'requirement', title });
  core.setStatus(dataDir, it.id, 'accepted', { by: 'human' });
  core.setStatus(dataDir, it.id, 'planned', { by: 'human' });
  const created = batch.createBatch(dataDir, { projectRoot: root });
  const got = batch.nextItem(dataDir, created.batch.batchId, { owner });
  if (got.itemId !== it.id) throw new Error(`批流领取错位：期望 ${it.id} 得到 ${got.itemId}`);
  core.claim(dataDir, it.id, owner);
  const r = atb(root, ['hold', 'declare', it.id, '--question', question, '--reason', reason, '--run', got.runId, '--by', owner]);
  if (r.code !== 0) throw new Error(`批流声明失败：${r.err}`);
  const fin = batch.finishRun(dataDir, got.runId, { result: 'blocked', reason: '待人工决策（已声明）' });
  if (!fin.ok) throw new Error('blocked 回执应成功');
  return it;
}

t('S1-S4 服务端：/api/holds 聚合、answer/resume、徽标数据、确认完成 force', async () => {
  const { root, dataDir } = mkProject();
  const it = mkHoldViaBatch(root, dataDir, 'API 条目', 'w1', 'Q1::Q2 占位', '范围确认');
  // 第一条造完（blocked 回执已释放互斥）再造第二条
  const it2 = mkHoldViaBatch(root, dataDir, 'API 条目2', 'w2', 'Q3', '');
  // Q1::Q2 占位改为两个真实问题：直接重建 holds 记录（测试夹具：用 store 层重新声明）
  holdStates.archiveHoldRecord(dataDir, it.id);
  holdStore.declareHold(dataDir, it.id, { questions: ['Q1', 'Q2'], reason: '范围确认', by: 'w1' });

  const port = 31000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(os.tmpdir(), `atb-hold-reg-${Date.now()}.json`) },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const P = `?project=${encodeURIComponent(root)}`;
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try { await req(port, 'GET', '/api/health'); up = true; break; } catch {}
    }
    assert.ok(up, '服务应启动');

    // S1 聚合清单
    let r = await req(port, 'GET', `/api/holds${P}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.items.length, 2, '应有两条活动 hold');
    const one = r.json.items.find((x) => x.itemId === it.id);
    assert.equal(one.unanswered, 2);
    assert.equal(one.total, 2);
    assert.equal(one.reason, '范围确认');
    assert.ok(one.questions[0].text === 'Q1');

    // S2 作答草稿 + 未齐备 resume 400
    r = await req(port, 'POST', `/api/hold/${it.id}/answer${P}`, { answers: [{ q: 'q1', text: 'iOS 单端' }] });
    assert.equal(r.status, 200, `作答应成功：${JSON.stringify(r.json)}`);
    r = await req(port, 'POST', `/api/hold/${it.id}/resume${P}`, {});
    assert.equal(r.status, 400, '缺项 resume 应 400');
    r = await req(port, 'GET', `/api/item/${it.id}${P}`);
    assert.equal(r.json.status, 'in-progress', '被拒 resume 不得变更状态');
    // 齐备 resume → planned
    r = await req(port, 'POST', `/api/hold/${it.id}/answer${P}`, { answers: [{ q: 'q2', text: '按行覆盖' }] });
    assert.equal(r.status, 200);
    r = await req(port, 'POST', `/api/hold/${it.id}/resume${P}`, {});
    assert.equal(r.status, 200, `齐备 resume 应成功：${JSON.stringify(r.json)}`);
    r = await req(port, 'GET', `/api/item/${it.id}${P}`);
    assert.equal(r.json.status, 'planned');
    r = await req(port, 'GET', `/api/holds${P}`);
    assert.equal(r.json.items.length, 1, '复工后应移出活动清单');

    // S3 徽标数据：/api/board 与条目详情
    r = await req(port, 'GET', `/api/board${P}`);
    const bd = (r.json.items || []).find((x) => x.id === it2.id);
    assert.ok(bd.hold, 'holding 条目应附 hold 徽标数据');
    assert.equal(bd.hold.unanswered, 1);
    r = await req(port, 'GET', `/api/item/${it2.id}${P}`);
    assert.ok(r.json.hold, '条目详情应含 hold 概要');

    // S4 确认完成防呆 + force
    r = await req(port, 'POST', `/api/item/${it2.id}/status${P}`, { to: 'done' });
    assert.equal(r.status, 400, '未答完确认完成应 400');
    assert.ok(String(r.json.error || '').includes('待人工决策'), `错误应指向待人工决策：${JSON.stringify(r.json)}`);
    r = await req(port, 'POST', `/api/item/${it2.id}/status${P}`, { to: 'done', force: true });
    assert.equal(r.status, 200, `force 确认完成应成功：${JSON.stringify(r.json)}`);
    assert.equal(r.json.status, 'done');
    r = await req(port, 'GET', `/api/holds${P}`);
    assert.equal(r.json.items.length, 0, 'force 闭环后活动清单应为空');
  } finally {
    server.kill();
  }
});

// ---------- U 组：前端静态契约 ----------

t('U1 UI 静态契约：聚合区 / 侧拉决策面板 / 复工禁用 / 确认完成二次确认', () => {
  const html = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'index.html'), 'utf8');
  assert.ok(/id="holdArea"/.test(html), 'index.html 应有待人工确认聚合区容器');
  assert.ok(/id="holdPanel"/.test(html), 'index.html 应有侧拉决策面板容器');
  assert.ok(/aria-label="待人工确认/.test(html) || /待人工确认/.test(html), '聚合区应有可访问名称');

  const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  assert.ok(/renderHolds/.test(js), 'app.js 应有 renderHolds 渲染函数');
  assert.ok(/\/api\/holds/.test(js), 'app.js 应拉取 /api/holds');
  assert.ok(/\/api\/hold\//.test(js), 'app.js 应调用 hold 作答/复工接口');
  assert.ok(/等人工决策/.test(js), '开发中条目应有等人工决策角标');
  // 复工按钮缺项禁用：渲染处依据 unanswered 禁用并给出缺项提示
  assert.ok(/data-hold-resume/.test(js), '复工按钮应有 data-hold-resume 绑定');
  assert.ok(/unanswered > 0 \? ' disabled'/.test(js), '复工按钮应按未答数禁用');
  assert.ok(/尚缺 .* 项决策，补齐后可复工/.test(js), '禁用态应有缺项提示');
  // 确认完成防呆：未答项时二次确认并 force 提交
  assert.ok(/仍要确认完成/.test(js), '确认完成二次确认文案应存在');
  assert.ok(/force:\s*true/.test(js), '二次确认后应带 force 提交');

  const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');
  assert.ok(/hold-area|hold-card|hold-panel/.test(css), 'style.css 应含待确认区样式');
});

t('U2 i18n：核心新增文案有 EN 词条', () => {
  const src = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'i18n.js'), 'utf8');
  assert.ok(/待人工确认/.test(src), 'i18n 词典应含「待人工确认」');
  assert.ok(/等人工决策/.test(src), 'i18n 词典应含「等人工决策」');
  assert.ok(/补决策/.test(src), 'i18n 词典应含「补决策」');
  assert.ok(/复工/.test(src), 'i18n 词典应含「复工」');
});

// ---------- 执行 ----------

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
