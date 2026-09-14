#!/usr/bin/env node
// REQ-20260906-003 执行账本（RunStore）—— 设置/策略/运行记录/项目锁/增量日志 功能测试
// 用法：node scripts/tests/dispatch-store.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as core from '../lib/core.mjs';
import * as store from '../lib/dispatch-store.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function tempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-store-'));
  core.initData(root);
  return root;
}
const dataDirOf = (root) => core.requireDataDir(root);

t('S1 设置默认值：自动派发关闭、时限 60、重试 2、重启续跑关闭', () => {
  const root = tempProject();
  const s = store.loadSettings(dataDirOf(root));
  assert.equal(s.codex.enabled, false);
  assert.equal(s.codex.timeoutMin, 60);
  assert.equal(s.codex.retries, 2);
  assert.equal(s.codex.resumeAfterRestart, false);
  assert.equal(s.codex.cliPathExplicit, false);
});

t('S2 设置保存与校验：合法值落盘可读回，越界值拒绝', () => {
  const root = tempProject();
  const d = dataDirOf(root);
  store.saveSettings(d, { codex: { timeoutMin: 30, retries: 0, resumeAfterRestart: true, cliPath: '/bin/echo' } });
  const s = store.loadSettings(d);
  assert.equal(s.codex.timeoutMin, 30);
  assert.equal(s.codex.retries, 0);
  assert.equal(s.codex.resumeAfterRestart, true);
  assert.equal(s.codex.cliPath, '/bin/echo');
  assert.equal(s.codex.cliPathExplicit, true);
  assert.throws(() => store.saveSettings(d, { codex: { timeoutMin: 4 } }), /5.*240|timeoutMin/);
  assert.throws(() => store.saveSettings(d, { codex: { timeoutMin: 241 } }));
  assert.throws(() => store.saveSettings(d, { codex: { retries: 4 } }), /retries/);
  assert.throws(() => store.saveSettings(d, { codex: { retries: -1 } }));
  // 非法类型
  assert.throws(() => store.saveSettings(d, { codex: { timeoutMin: 'x' } }));
});

t('S3 设置不含密钥字段：保存含敏感键时拒绝（协议：不收集/展示密钥）', () => {
  const root = tempProject();
  assert.throws(() => store.saveSettings(dataDirOf(root), { codex: { apiKey: 'sk-1' } }), /敏感|密钥|apiKey/i);
});

t('P1 依赖策略：保存 dependsOn、自依赖与环被拒、未知编号被拒（C03）', () => {
  const root = tempProject();
  const d = dataDirOf(root);
  core.createItem(d, { type: 'requirement', title: '甲', by: 't' });
  core.createItem(d, { type: 'requirement', title: '乙', by: 't' });
  const items = core.listItems(d);
  const [a, b] = items.map((x) => x.id);

  store.saveItemPolicy(d, b, [a], { existsIds: new Set(items.map((x) => x.id)) });
  assert.deepEqual(store.loadItemPolicy(d, b), { dependsOn: [a] });

  assert.throws(() => store.saveItemPolicy(d, b, [b], { existsIds: new Set([a, b]) }), /自依赖/);
  assert.throws(() => store.saveItemPolicy(d, b, ['REQ-19990101-001'], { existsIds: new Set([a, b]) }), /不存在/);
  // 环：a 依赖 b，b 已依赖 a
  assert.throws(() => store.saveItemPolicy(d, a, [b], { existsIds: new Set([a, b]) }), /环/);
  // 清空依赖合法
  store.saveItemPolicy(d, b, [], { existsIds: new Set([a, b]) });
  assert.deepEqual(store.loadItemPolicy(d, b).dependsOn, []);
});

t('P2 依赖满足判断：前置条目 done 才可实施（默认人工验收完成后才可实施）', () => {
  const root = tempProject();
  const d = dataDirOf(root);
  core.createItem(d, { type: 'requirement', title: '前置', by: 't' });
  core.createItem(d, { type: 'requirement', title: '后置', by: 't' });
  const items = core.listItems(d);
  const [pre, post] = items.map((x) => x.id);
  store.saveItemPolicy(d, post, [pre], { existsIds: new Set([pre, post]) });

  const statusOf = (id) => ({ [pre]: 'accepted', [post]: 'accepted' })[id] || 'accepted';
  let r = store.depsSatisfied(d, post, (id) => statusOf(id));
  assert.equal(r.ok, false);
  assert.deepEqual(r.unsatisfied, [pre]);

  const statusOf2 = (id) => (id === pre ? 'done' : 'accepted');
  r = store.depsSatisfied(d, post, statusOf2);
  assert.equal(r.ok, true);
});

t('R1 运行记录生命周期：reserved → starting → running → reported，原子更新可读回', () => {
  const root = tempProject();
  const d = dataDirOf(root);
  const run = store.newRun(d, { itemId: 'REQ-20260906-003', projectRoot: root, prompt: '做点事' });
  assert.match(run.runId, /^run-\d{8}-\d{6}-[0-9a-f]{4}$/);
  assert.equal(run.phase, 'reserved');
  assert.equal(run.itemId, 'REQ-20260906-003');
  assert.equal(run.threadId, null);
  assert.equal(run.cancelRequested, false);

  store.updateRun(d, run.runId, { phase: 'starting', attempts: [{ attemptNo: 1, kind: 'new' }] });
  const r2 = store.getRun(d, run.runId);
  assert.equal(r2.phase, 'starting');
  assert.equal(r2.attempts.length, 1);
  assert.equal(r2.prompt, '做点事');
  // 幂等字段合并而非整替
  store.updateRun(d, run.runId, { phase: 'running', threadId: 'th-1' });
  const r3 = store.getRun(d, run.runId);
  assert.equal(r3.threadId, 'th-1');
  assert.equal(r3.attempts.length, 1);
});

t('R2 运行历史分页：按创建时间倒序、limit/offset 生效', () => {
  const root = tempProject();
  const d = dataDirOf(root);
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push(store.newRun(d, { itemId: 'REQ-20260906-003', projectRoot: root, prompt: `p${i}` }).runId);
  const page1 = store.listRuns(d, { limit: 2, offset: 0 });
  assert.equal(page1.total, 5);
  assert.deepEqual(page1.items.map((x) => x.runId), [ids[4], ids[3]]);
  const page3 = store.listRuns(d, { limit: 2, offset: 4 });
  assert.deepEqual(page3.items.map((x) => x.runId), [ids[0]]);
});

t('L1 增量日志：事件追加与字节偏移续读、小 limit 分页读完（C19 局部）', () => {
  const root = tempProject();
  const d = dataDirOf(root);
  const run = store.newRun(d, { itemId: 'REQ-20260906-003', projectRoot: root, prompt: '' });
  store.appendEvent(d, run.runId, { type: 'thread.started', threadId: 't1' });
  store.appendEvent(d, run.runId, { type: 'turn.completed' });
  const first = store.readLog(d, run.runId, 'events', { offset: 0, limit: 10 });
  assert.equal(first.offset, 0);
  assert.equal(first.data.length, 10);
  assert.equal(first.eof, false); // limit 小于全量，明确未读完
  // 用 nextOffset 循环增量读完
  let off = first.nextOffset;
  let all = first.data;
  for (;;) {
    const piece = store.readLog(d, run.runId, 'events', { offset: off, limit: 64 });
    all += piece.data;
    off = piece.nextOffset;
    if (piece.eof) break;
  }
  assert.ok(all.includes('thread.started'));
  assert.ok(all.includes('turn.completed'));
  // 末尾再读：空数据 + eof
  const tail = store.readLog(d, run.runId, 'events', { offset: off, limit: 64 });
  assert.equal(tail.data, '');
  assert.equal(tail.eof, true);
  // 越界 offset 拒绝
  assert.throws(() => store.readLog(d, run.runId, 'events', { offset: 99999, limit: 10 }), /offset/);
});

t('L2 stderr 与最终回复分开保存（C：事件/错误/最终回复各自落盘）', () => {
  const root = tempProject();
  const d = dataDirOf(root);
  const run = store.newRun(d, { itemId: 'REQ-20260906-003', projectRoot: root, prompt: '' });
  store.appendStderr(d, run.runId, 'some warning\n');
  store.writeFinalMessage(d, run.runId, '最终回复正文');
  const se = store.readLog(d, run.runId, 'stderr', { offset: 0, limit: 4096 });
  assert.ok(se.data.includes('some warning'));
  const fm = store.readLog(d, run.runId, 'final', { offset: 0, limit: 4096 });
  assert.equal(fm.data, '最终回复正文');
});

t('K1 项目实施互斥（共用 impl.lock）：互斥获取、持有者可见、显式释放、不自动接管', () => {
  const root = tempProject();
  const d = dataDirOf(root);
  const a = store.acquireProjectLock(d, 'REQ-20260906-001', { pid: 100, itemId: 'REQ-20260906-001' });
  assert.equal(a.ok, true);
  assert.equal(a.holder.kind, 'codex');
  const b = store.acquireProjectLock(d, 'REQ-20260906-002', { pid: 200 });
  assert.equal(b.ok, false);
  assert.equal(b.holder.owner, 'REQ-20260906-001');
  assert.equal(b.holder.pid, 100);
  // 补记 runId 归属（预留成功后回填）
  assert.equal(store.stampProjectLock(d, { runId: 'run-20260906-010101-abcd' }), true);
  assert.equal(store.readProjectLock(d).runId, 'run-20260906-010101-abcd');
  // 持有者匹配（owner 或 runId）才可释放
  assert.equal(store.releaseProjectLock(d, 'REQ-20260906-002'), false, '非持有者不得释放');
  assert.equal(store.releaseProjectLock(d, 'REQ-20260906-001'), true);
  const c = store.acquireProjectLock(d, 'REQ-20260906-002', { pid: 200 });
  assert.equal(c.ok, true);
});

t('V1 终态判定辅助：reported/blocked/failed/interrupted 为终态，其余不是', () => {
  assert.equal(store.isTerminalPhase('reported'), true);
  assert.equal(store.isTerminalPhase('running'), false);
  assert.equal(store.isTerminalPhase('cleanup_pending'), false);
});

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
