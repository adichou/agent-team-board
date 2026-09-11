#!/usr/bin/env node
// REQ-20260907-001 Oncall 咨询看板 —— 隔离性测试（I1）
// 覆盖：REQ/BUG 列表与选单不含 ASK、oncall 派单不占用 impl.lock、条目状态机不受影响
// 用法：node scripts/tests/oncall-isolation.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as oncall from '../lib/oncall-store.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function mkProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-oncall-iso-')));
  core.initData(root);
  const dataDir = core.dataDirFrom(root);
  return { root, dataDir };
}

t('I1 隔离：咨询单不进 REQ/BUG 列表与 /dev 选单；不占用实施互斥；状态机不受影响', () => {
  const { root, dataDir } = mkProject();
  // REQ/BUG 各建一条 + 咨询单两条
  const req = core.createItem(dataDir, { type: 'requirement', title: '普通需求', by: 'test' });
  oncall.createTicket(dataDir, { title: '问一', question: 'q1', by: 'board' });
  oncall.createTicket(dataDir, { title: '问二', question: 'q2', by: 'board' });

  const items = core.listItems(dataDir);
  assert.equal(items.length, 1, `REQ/BUG 列表应只有 1 条（得到 ${items.length}）`);
  assert.equal(items[0].id, req.id);
  assert.ok(!items.some((x) => String(x.id).startsWith('ASK-')), '列表不得混入 ASK');

  // /dev next 等价口径：accepted 第一条（requirement 优先）不含 ASK
  core.setStatus(dataDir, req.id, 'accepted', { by: 'human' });
  const accepted = core.listItems(dataDir).filter((x) => x.status === 'accepted');
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].id, req.id, '/dev next 选单不选咨询单');

  // oncall 派单/回传全流程不产生 impl.lock
  const a = oncall.listTickets(dataDir)[0];
  oncall.dispatchTickets(dataDir, { ids: [a.id], mode: 'zcode', staff: '张三', by: 'board', kind: 'batch' });
  oncall.answerTicket(dataDir, a.id, { answer: '答', by: 'x', mode: 'zcode' });
  const implLock = path.join(dataDir, '.locks', 'impl.lock');
  assert.ok(!fs.existsSync(implLock), 'oncall 流程不得占用 impl.lock');

  // REQ/BUG claim/report 状态机照常（oncall 不干扰）
  const st = core.claim(dataDir, req.id, 'dev-session');
  assert.equal(st.status, 'in-progress', '普通条目认领不受影响');
  core.report(dataDir, req.id, { coverage: 80, framework: 'node:test', summary: 'ok', by: 'dev-session' });
  assert.equal(core.getItemDetail(dataDir, req.id).status, 'in-progress');

  // oncall 数据目录独立：不落在 requirements/bugs 下
  const oncallTickets = path.join(dataDir, 'oncall', 'tickets');
  assert.ok(fs.existsSync(oncallTickets), '咨询单应在 oncall/tickets/ 下');
  assert.equal(fs.readdirSync(oncallTickets).length, 2);
  assert.ok(!fs.existsSync(path.join(dataDir, 'requirements', a.id)), '不得混入 requirements/');
  assert.ok(!fs.existsSync(path.join(dataDir, 'bugs', a.id)), '不得混入 bugs/');
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
