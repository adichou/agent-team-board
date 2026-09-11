#!/usr/bin/env node
// REQ-20260907-001 Oncall 咨询看板 —— 数据层测试（S1~S5）
// 覆盖：ASK 独立编号、创建/派单/回传/追问/失败/重派状态流转、附件白名单、列表过滤、客服人员校验
// 用法：node scripts/tests/oncall-store.test.mjs

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
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-oncall-store-')));
  core.initData(root);
  const dataDir = core.dataDirFrom(root);
  return { root, dataDir };
}

t('S1 创建：ASK-YYYYMMDD-NNN 独立序列，状态 pending，question.md 落盘', () => {
  const { dataDir } = mkProject();
  const a = oncall.createTicket(dataDir, { title: '这个模块怎么工作', question: '## 问题\n请讲讲 core', by: 'board' });
  const b = oncall.createTicket(dataDir, { title: '第二个', question: 'q2', by: 'board' });
  assert.match(a.id, /^ASK-\d{8}-001$/, `首单应为 …-001（得到 ${a.id}）`);
  assert.match(b.id, /^ASK-\d{8}-002$/, '第二单应为 …-002（独立序列）');
  assert.equal(a.status, 'pending', '新建即待回复，无需人工接受');
  const dir = oncall.ticketDir(dataDir, a.id);
  assert.equal(fs.readFileSync(path.join(dir, 'question.md'), 'utf8'), '## 问题\n请讲讲 core', '问题正文应落盘');
  const meta = oncall.getTicket(dataDir, a.id);
  assert.equal(meta.rounds.length, 1, '首轮轮次');
  assert.equal(meta.rounds[0].no, 1);
  assert.equal(meta.rounds[0].mode, null, '首轮未派单');
});

t('S2 派单与回传：dispatch 标记轮次转 answering；answer 落 rounds/N/answer.md 转 answered', () => {
  const { dataDir } = mkProject();
  const a = oncall.createTicket(dataDir, { title: 't', question: 'q', by: 'board' });
  const r = oncall.dispatchTickets(dataDir, { ids: [a.id], mode: 'zcode', staff: '张三', by: 'board', kind: 'batch' });
  assert.ok(r.prompt && r.prompt.includes(a.id), 'zcode 派单应返回主调度提示词');
  let meta = oncall.getTicket(dataDir, a.id);
  assert.equal(meta.status, 'answering', '派单后回复中');
  assert.equal(meta.rounds[0].mode, 'zcode');
  assert.equal(meta.rounds[0].staff, '张三');
  assert.ok(meta.rounds[0].dispatchedAt, '应记录派单时间');

  oncall.answerTicket(dataDir, a.id, { answer: '## 回答\n是这样工作的', by: 'oncall-20260907-张三', mode: 'zcode' });
  meta = oncall.getTicket(dataDir, a.id);
  assert.equal(meta.status, 'answered');
  assert.ok(meta.rounds[0].answeredAt, '应记录回答时间');
  assert.equal(meta.rounds[0].by, 'oncall-20260907-张三', '应记录来源会话');
  const file = path.join(oncall.ticketDir(dataDir, a.id), 'rounds', '1', 'answer.md');
  assert.equal(fs.readFileSync(file, 'utf8'), '## 回答\n是这样工作的', '回答应落盘到 rounds/1/answer.md');

  const full = oncall.readTicketFull(dataDir, a.id);
  assert.equal(full.rounds[0].answer, '## 回答\n是这样工作的', '全文读取应含回答');
  assert.equal(full.rounds[0].question, 'q', '全文读取应含问题');
});

t('S3 追问/失败/重派：answered→pending 追加轮次；answering→failed 记原因；failed 重派回 answering', () => {
  const { dataDir } = mkProject();
  const a = oncall.createTicket(dataDir, { title: 't', question: 'q1', by: 'board' });
  oncall.dispatchTickets(dataDir, { ids: [a.id], mode: 'zcode', staff: null, by: 'board', kind: 'batch' });
  oncall.answerTicket(dataDir, a.id, { answer: 'a1', by: 'x', mode: 'zcode' });
  assert.equal(oncall.getTicket(dataDir, a.id).status, 'answered');

  oncall.askTicket(dataDir, a.id, { question: '追问：为什么', by: 'board' });
  let meta = oncall.getTicket(dataDir, a.id);
  assert.equal(meta.status, 'pending', '追问应把已回复单拉回待回复');
  assert.equal(meta.rounds.length, 2, '追问追加轮次');
  const q2 = path.join(oncall.ticketDir(dataDir, a.id), 'rounds', '2', 'question.md');
  assert.equal(fs.readFileSync(q2, 'utf8'), '追问：为什么', '追问正文落 rounds/2/question.md');

  oncall.dispatchTickets(dataDir, { ids: [a.id], mode: 'codex', staff: '李四', by: 'board', kind: 'single' });
  oncall.failRound(dataDir, a.id, { error: 'auth：认证失败（401/未登录）', by: 'server' });
  meta = oncall.getTicket(dataDir, a.id);
  assert.equal(meta.status, 'failed', '失败单状态');
  assert.match(meta.rounds[1].error, /auth/, '轮次应记录失败原因');

  oncall.redispatchTicket(dataDir, a.id, { mode: 'zcode', staff: '李四', by: 'board' });
  meta = oncall.getTicket(dataDir, a.id);
  assert.equal(meta.status, 'answering', '重派后回复中');
  oncall.answerTicket(dataDir, a.id, { answer: 'a2', by: 'y', mode: 'zcode' });
  assert.equal(oncall.getTicket(dataDir, a.id).status, 'answered');
});

t('S4 附件：图片白名单放行、非图片/超大/穿越名拒绝', () => {
  const { dataDir } = mkProject();
  const a = oncall.createTicket(dataDir, {
    title: 't', question: '看截图',
    attachments: [{ name: 'shot.png', dataBase64: Buffer.from('pngbytes').toString('base64') }],
    by: 'board',
  });
  const file = path.join(oncall.ticketDir(dataDir, a.id), 'attachments', 'shot.png');
  assert.equal(fs.readFileSync(file, 'utf8'), 'pngbytes', '附件应按原名落盘');
  assert.deepEqual(oncall.getTicket(dataDir, a.id).rounds[0].attachments, ['shot.png'], '轮次应登记附件');

  assert.throws(() => oncall.saveAttachment(dataDir, a.id, 'evil.sh', Buffer.from('x')), /图片/, '非图片后缀应拒绝');
  assert.throws(() => oncall.saveAttachment(dataDir, a.id, 'big.png', Buffer.alloc(8 * 1024 * 1024 + 1)), /8MB/, '超 8MB 应拒绝');
  assert.throws(() => oncall.saveAttachment(dataDir, a.id, '../escape.png', Buffer.from('x')), /文件名/, '穿越文件名应拒绝');

  const buf = oncall.readAttachment(dataDir, a.id, 'shot.png');
  assert.equal(buf.toString(), 'pngbytes', '读取附件');
  assert.throws(() => oncall.readAttachment(dataDir, a.id, '../ticket.json'), /文件名|非法/, '读取也应防穿越');
});

t('S5 列表过滤、客服人员长度、派单账本', () => {
  const { dataDir } = mkProject();
  const a = oncall.createTicket(dataDir, { title: 'A', question: 'q', by: 'board' });
  oncall.createTicket(dataDir, { title: 'B', question: 'q', by: 'board' });
  oncall.dispatchTickets(dataDir, { ids: [a.id], mode: 'zcode', staff: '张三', by: 'board', kind: 'batch' });

  const all = oncall.listTickets(dataDir);
  assert.equal(all.length, 2, '列表应含全部咨询单');
  const pendingOnly = oncall.listTickets(dataDir, { status: 'pending' });
  assert.equal(pendingOnly.length, 1, '按状态过滤');
  assert.equal(pendingOnly[0].id !== a.id, true, '已派单不在 pending');
  const card = all.find((x) => x.id === a.id);
  assert.equal(card.status, 'answering');
  assert.equal(card.roundCount, 1, '卡片应带回复轮数');
  assert.equal(card.lastMode, 'zcode', '卡片应带派单模式徽标');

  assert.throws(
    () => oncall.dispatchTickets(dataDir, { ids: [pendingOnly[0].id], mode: 'zcode', staff: '三'.repeat(31), by: 'board', kind: 'batch' }),
    /30/, '客服人员超 30 字符应拒绝（与 REQ-20260907-002 对齐）'
  );

  const dispatches = oncall.listDispatches(dataDir);
  assert.equal(dispatches.length, 1, '派单账本应有记录');
  assert.equal(dispatches[0].mode, 'zcode');
  assert.equal(dispatches[0].staff, '张三');
  assert.deepEqual(dispatches[0].ids, [a.id]);

  // 未填客服人员：账本记录 null，不阻塞派单
  oncall.dispatchTickets(dataDir, { ids: [pendingOnly[0].id], mode: 'zcode', staff: '', by: 'board', kind: 'batch' });
  const d2 = oncall.listDispatches(dataDir); // 按时间倒序：最新在前
  assert.equal(d2[0].staff, null, '未填客服人员记 null');
  assert.equal(oncall.getTicket(dataDir, pendingOnly[0].id).rounds[0].staff, null);
});

t('S5b zcode 提示词：含会话命名指令与受控回传命令；未填客服显示未指定', () => {
  const { dataDir } = mkProject();
  const a = oncall.createTicket(dataDir, { title: 'A', question: 'q', by: 'board' });
  const withStaff = oncall.buildOncallPrompt({ projectRoot: '/tmp/proj', ids: [a.id], staff: '张三', atbPath: '/x/atb.mjs' });
  assert.match(withStaff, /请将当前会话名改为：oncall-\d{8}-张三/, '命名指令应含客服人员');
  assert.match(withStaff, /oncall answer/, '应含受控回传命令');
  assert.match(withStaff, /oncall show/, '应含读单命令');
  assert.match(withStaff, /ASK-\d{8}-001/, '应列出咨询单号');
  assert.match(withStaff, /只读|不要修改代码/, '应约束只读回答');

  const noStaff = oncall.buildOncallPrompt({ projectRoot: '/tmp/proj', ids: [a.id], staff: '', atbPath: '/x/atb.mjs' });
  assert.match(noStaff, /oncall-\d{8}-未指定/, '未填客服人员显示未指定');
});

t('S6 REQ-20260908-013 正文可空：question 缺省 / 空串 / 纯空白——question.md 回退已 trim 的标题，meta 正常', () => {
  const { dataDir } = mkProject();
  const a = oncall.createTicket(dataDir, { title: '部署后看板列表为空，如何排查？', by: 'board' }); // question 缺省
  const b = oncall.createTicket(dataDir, { title: '第二个问题', question: '', by: 'board' }); // 空串
  const c = oncall.createTicket(dataDir, { title: '  空白正文单  ', question: ' \n\t ', by: 'board' }); // 纯空白 + 标题带空白
  assert.equal(fs.readFileSync(path.join(oncall.ticketDir(dataDir, a.id), 'question.md'), 'utf8'), '部署后看板列表为空，如何排查？', '缺省 question 应回退标题');
  assert.equal(fs.readFileSync(path.join(oncall.ticketDir(dataDir, b.id), 'question.md'), 'utf8'), '第二个问题', '空串 question 应回退标题');
  assert.equal(fs.readFileSync(path.join(oncall.ticketDir(dataDir, c.id), 'question.md'), 'utf8'), '空白正文单', '纯空白按留空处理，回退已 trim 的标题');
  assert.equal(a.status, 'pending', '留空创建同样 pending');
  assert.equal(a.rounds.length, 1, '轮次结构正常');
  assert.equal(a.rounds[0].no, 1);
  assert.equal(a.rounds[0].mode, null, '首轮未派单');
  assert.equal(oncall.readTicketFull(dataDir, a.id).rounds[0].question, '部署后看板列表为空，如何排查？', '全文读取第 1 轮问题为标题');
});

t('S6b 回归：正文非空原样落盘不被标题覆盖；标题校验与追问必填口径不放松', () => {
  const { dataDir } = mkProject();
  const a = oncall.createTicket(dataDir, { title: '带正文的单', question: '## 问题\n请看截图', by: 'board' });
  assert.equal(fs.readFileSync(path.join(oncall.ticketDir(dataDir, a.id), 'question.md'), 'utf8'), '## 问题\n请看截图', '非空正文不得被标题覆盖');
  assert.throws(() => oncall.createTicket(dataDir, { title: '', question: 'q', by: 'board' }), /标题不能为空/, '空标题仍应拒绝');
  assert.throws(() => oncall.createTicket(dataDir, { title: '长'.repeat(121), question: 'q', by: 'board' }), /标题过长/, '超 120 字标题仍应拒绝');
  assert.throws(() => oncall.askTicket(dataDir, a.id, { question: '  ', by: 'board' }), /追问正文不能为空/, '追问正文必填口径不受影响');
});

t('S6c 留空正文 + 附件：question.md 为标题，附件照常落盘并进 rounds[0].attachments；派单提示词含标题', () => {
  const { dataDir } = mkProject();
  const a = oncall.createTicket(dataDir, {
    title: '看截图排查', by: 'board',
    attachments: [{ name: 'shot.png', dataBase64: Buffer.from('pngbytes').toString('base64') }],
  });
  assert.equal(fs.readFileSync(path.join(oncall.ticketDir(dataDir, a.id), 'question.md'), 'utf8'), '看截图排查', '留空正文回退标题');
  assert.deepEqual(oncall.getTicket(dataDir, a.id).rounds[0].attachments, ['shot.png'], '附件照常进第 1 轮');
  const prompt = oncall.buildOncallWorkerPrompt(dataDir, a.id);
  const m = prompt.match(/当前待答问题（第 1 轮）：\n(.*)/);
  assert.equal(m && m[1], '看截图排查', '派单提示词当前待答问题应为标题文本（非空行）');
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
