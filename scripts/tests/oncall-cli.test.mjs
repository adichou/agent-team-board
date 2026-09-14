#!/usr/bin/env node
// REQ-20260907-001 Oncall 咨询看板 —— CLI 测试（C1/C2）
// 覆盖：atb oncall new/list/show/ask/answer/dispatch 全链路与提示词契约
// 用法：node scripts/tests/oncall-cli.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const atb = path.join(pluginRoot, 'scripts', 'atb.mjs');

const run = (args, cwd, opts = {}) => new Promise((resolve) => {
  const p = spawn(process.execPath, [atb, ...args, '--dir', cwd], {
    cwd, stdio: ['ignore', 'pipe', 'pipe'], ...opts,
  });
  let out = '';
  let err = '';
  p.stdout.on('data', (c) => { out += c; });
  p.stderr.on('data', (c) => { err += c; });
  p.on('close', (code) => resolve({ code, out, err }));
});

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

async function mkProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-oncall-cli-')));
  await run(['init'], root);
  return root;
}

t('C1 new/list/show/ask/answer 全链路', async () => {
  const root = await mkProject();
  const qFile = path.join(root, 'q.md');
  const aFile = path.join(root, 'a.md');
  fs.writeFileSync(qFile, '## 问题\n请问 server 如何路由');
  fs.writeFileSync(aFile, '## 回答\n经 handleApi 路由');

  let r = await run(['oncall', 'new', '--title', '咨询路由', '--question-file', qFile], root);
  assert.equal(r.code, 0, `new 应成功（stderr：${r.err}）`);
  assert.match(r.out, /ASK-\d{8}-001/, '应输出单号');

  r = await run(['oncall', 'list', '--json'], root);
  assert.equal(r.code, 0);
  const list = JSON.parse(r.out.slice(r.out.indexOf('{')));
  assert.equal(list.count, 1);
  assert.equal(list.tickets[0].status, 'pending');
  assert.equal(list.tickets[0].roundCount, 1);

  const id = list.tickets[0].id;
  r = await run(['oncall', 'show', id, '--json'], root);
  const show = JSON.parse(r.out.slice(r.out.indexOf('{')));
  assert.equal(show.rounds[0].question, '## 问题\n请问 server 如何路由', 'show 应含问题全文');

  fs.writeFileSync(qFile, '追问： middleware 顺序');
  r = await run(['oncall', 'ask', id, '--question-file', qFile], root);
  assert.equal(r.code, 0, 'ask 应成功');

  r = await run(['oncall', 'answer', id, '--by', 'oncall-test-张三', '--mode', 'zcode', '--file', aFile], root);
  assert.equal(r.code, 0, `answer 应成功（stderr：${r.err}）`);
  assert.match(r.out, /已回传/, 'answer 应有回传反馈');

  r = await run(['oncall', 'show', id, '--json'], root);
  const after = JSON.parse(r.out.slice(r.out.indexOf('{')));
  assert.equal(after.status, 'answered', '回传后已回复');
  assert.equal(after.rounds.length, 2, '追问后应有两轮');
  assert.match(after.rounds[1].answer, /handleApi/, '最新轮（第 2 轮）应含回答内容');

  // 隔离：atb list 不含 ASK
  r = await run(['list', '--json'], root);
  assert.ok(!r.out.includes('ASK-'), 'REQ/BUG 列表不得混入咨询单');
});

t('C2 dispatch（zcode）：提示词含会话命名指令与回传命令；未填客服不阻塞', async () => {
  const root = await mkProject();
  const qFile = path.join(root, 'q.md');
  fs.writeFileSync(qFile, '问题正文');
  await run(['oncall', 'new', '--title', 't1', '--question-file', qFile], root);
  const listRes = await run(['oncall', 'list', '--json'], root);
  const id = JSON.parse(listRes.out.slice(listRes.out.indexOf('{'))).tickets[0].id;

  let r = await run(['oncall', 'dispatch', id, '--mode', 'zcode', '--staff', '张三'], root);
  assert.equal(r.code, 0, `dispatch 应成功（stderr：${r.err}）`);
  assert.match(r.out, /请将当前会话名改为：oncall-\d{8}-张三/, '命名指令（会话名含客服人员）');
  assert.match(r.out, /oncall answer/, '应含受控回传命令');
  assert.match(r.out, /oncall show/, '应含读单命令');
  assert.match(r.out, new RegExp(id), '应含咨询单号');

  // 派单后单据转回复中
  const mid = await run(['oncall', 'list', '--json'], root);
  assert.equal(JSON.parse(mid.out.slice(mid.out.indexOf('{'))).tickets[0].status, 'answering', '派单后回复中');

  // 未填客服人员：提示词显示未指定且派单流程正常
  await run(['oncall', 'new', '--title', 't2', '--question-file', qFile], root);
  const list2 = await run(['oncall', 'list', '--json'], root);
  const id2 = JSON.parse(list2.out.slice(list2.out.indexOf('{'))).tickets.find((x) => x.status === 'pending').id;
  r = await run(['oncall', 'dispatch', id2, '--mode', 'zcode'], root);
  assert.equal(r.code, 0, '未填客服人员不得阻塞派单');
  assert.match(r.out, /oncall-\d{8}-未指定/, '未填时命名显示未指定');

  // 非法参数
  r = await run(['oncall', 'answer', 'ASK-20990101-999', '--by', 'x', '--mode', 'zcode', '--file', qFile], root);
  assert.notEqual(r.code, 0, '不存在的单号应失败');
});

t('C3 REQ-20260908-013 正文可空：--title 单独可创建且第 1 轮问题为标题；带 --question 行为不变', async () => {
  const root = await mkProject();
  let r = await run(['oncall', 'new', '--title', '部署后看板为空怎么排查'], root);
  assert.equal(r.code, 0, `不带 --question/--question-file 应创建成功（stderr：${r.err}）`);
  assert.match(r.out, /ASK-\d{8}-001/, '应输出单号');
  r = await run(['oncall', 'list', '--json'], root);
  const id = JSON.parse(r.out.slice(r.out.indexOf('{'))).tickets[0].id;
  r = await run(['oncall', 'show', id, '--json'], root);
  assert.equal(JSON.parse(r.out.slice(r.out.indexOf('{'))).rounds[0].question, '部署后看板为空怎么排查', 'show 第 1 轮问题应为标题');

  r = await run(['oncall', 'new', '--title', '带正文的单', '--question', '## 问题\n正文内容'], root);
  assert.equal(r.code, 0, '带 --question 应照常成功');
  r = await run(['oncall', 'list', '--json'], root);
  const id2 = JSON.parse(r.out.slice(r.out.indexOf('{'))).tickets.find((x) => x.title === '带正文的单').id;
  r = await run(['oncall', 'show', id2, '--json'], root);
  assert.equal(JSON.parse(r.out.slice(r.out.indexOf('{'))).rounds[0].question, '## 问题\n正文内容', '带正文时行为不变');
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
