#!/usr/bin/env node
// REQ-20260909-003 需求文档引用讨论、纪要归档与说明同步 —— store 层测试（D1~D7）
// 覆盖：DISC 创建与绑定、启动/收尾提示词、readOutcome 四态、引用快照、
// 独立归档、applyDraft 写入保护（基线/唯一匹配/幂等/无部分成功）、继续讨论新轮
// 用法：node scripts/tests/req-disc-store.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import * as core from '../lib/core.mjs';
import * as disc from '../lib/req-disc-store.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function mkProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-req-disc-')));
  core.initData(root);
  const dataDir = core.dataDirFrom(root);
  return { root, dataDir };
}

function mkReq(dataDir, title = '文档讨论需求', desc = null) {
  return core.createItem(dataDir, {
    type: 'requirement', title,
    description: desc ?? '# 背景\n\n从需求详情发起讨论，讨论线程自动归属当前需求。\n\n## 目标\n\n讨论结束后生成纪要。\n由用户确认归档。\n',
    by: 'board',
  });
}

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const readmeFile = (dataDir, reqId) => path.join(core.resolveItemDir(dataDir, reqId).dir, 'README.md');
const readMe = (dataDir, reqId) => fs.readFileSync(readmeFile(dataDir, reqId), 'utf8');
const roundDir = (dataDir, id, no) => path.join(disc.discussionDir(dataDir, id), 'rounds', String(no));

// Agent 侧成套落盘（最后写发布标记）
function publishOutcome(dataDir, d, no, { minutes = '# 纪要\n\n## 明确共识\n\n1. 共识甲。\n', changes = null, baseline = null, binding = {} } = {}) {
  const dir = roundDir(dataDir, d.id, no);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'minutes.md'), minutes);
  const reqContent = readMe(dataDir, d.reqId);
  const draft = {
    version: 1,
    discussionId: binding.discussionId ?? d.id,
    reqId: binding.reqId ?? d.reqId,
    round: binding.round ?? no,
    baseline: baseline ?? sha(reqContent),
    changes: changes ?? [
      { id: 'c1', title: '调整讨论入口', before: '从需求详情发起讨论，讨论线程自动归属当前需求。', after: '从需求详情生成启动提示词，在 Agent 新会话中讨论。', basis: '明确共识第 1 项' },
    ],
  };
  fs.writeFileSync(path.join(dir, 'readme-draft.json'), JSON.stringify(draft, null, 2));
  fs.writeFileSync(path.join(dir, 'PUBLISH.json'), JSON.stringify({
    discussionId: binding.discussionId ?? d.id,
    reqId: binding.reqId ?? d.reqId,
    round: binding.round ?? no,
    publishedAt: new Date().toISOString(),
  }));
  return draft;
}

/* ---------- D1：创建与绑定 ---------- */

t('D1 创建：DISC 编号序列、绑定需求校验、round 1 元数据落盘', () => {
  const { root, dataDir } = mkProject();
  const req = mkReq(dataDir);
  const bug = core.createItem(dataDir, { type: 'bug', title: '顺带 Bug', description: 'b', by: 'board' });

  assert.throws(() => disc.createDiscussion(dataDir, { reqId: 'REQ-XX', by: 'board' }), /非法|REQ/, '非法格式应拒绝');
  assert.throws(() => disc.createDiscussion(dataDir, { reqId: 'REQ-20990101-999', by: 'board' }), /找不到/, '不存在需求应拒绝');
  assert.throws(() => disc.createDiscussion(dataDir, { reqId: bug.id, by: 'board' }), /需求/, 'Bug 编号应拒绝');

  const d1 = disc.createDiscussion(dataDir, { reqId: req.id, by: 'board' });
  const d2 = disc.createDiscussion(dataDir, { reqId: req.id, by: 'board' });
  assert.match(d1.id, /^DISC-\d{8}-001$/, '首个编号 DISC-…-001');
  assert.match(d2.id, /^DISC-\d{8}-002$/, '编号递增');
  assert.equal(d1.reqId, req.id, '应落 reqId');
  assert.equal(d1.readmeVersion, 1, 'README 版本从 1 起');
  assert.equal(d1.rounds.length, 1, '创建即开第 1 轮');
  assert.ok(d1.rounds[0].startedAt, 'round 1 应有 startedAt');

  const saved = disc.getDiscussion(dataDir, d1.id);
  assert.equal(saved.reqId, req.id, 'discussion.json 持久化');
  assert.ok(fs.existsSync(path.join(disc.discussionDir(dataDir, d1.id), 'discussion.json')), '元数据文件应存在');

  // 按需求列出（最新在后）
  const list = disc.listDiscussions(dataDir, { reqId: req.id });
  assert.deepEqual(list.map((x) => x.id), [d1.id, d2.id]);
  assert.deepEqual(disc.listDiscussions(dataDir, { reqId: 'REQ-20990101-999' }), [], '无匹配返回空不抛错');
});

/* ---------- D2：提示词 ---------- */

t('D2 提示词：启动/收尾含同一标识、文档入口与落盘三件套；继续讨论带第 2 轮', () => {
  const { root, dataDir } = mkProject();
  const req = mkReq(dataDir);
  const d = disc.createDiscussion(dataDir, { reqId: req.id, by: 'board' });
  const reqDir = core.resolveItemDir(dataDir, req.id).dir;
  const r1 = roundDir(dataDir, d.id, 1);

  const start = disc.buildStartPrompt(dataDir, d.id);
  for (const part of [root, req.id, d.id, 'README.md', 'design.md', 'test-cases.md', reqDir]) {
    assert.ok(start.includes(part), `启动提示词应含 ${part}`);
  }
  for (const f of ['minutes.md', 'readme-draft.json', 'PUBLISH.json']) {
    assert.ok(start.includes(path.join(r1, f)), `启动提示词落盘约定应含 ${f} 绝对路径`);
  }
  assert.match(start, /只读|不要修改/, '应有只读边界');

  const finish = disc.buildFinishPrompt(dataDir, d.id);
  for (const part of [req.id, d.id, path.join(r1, 'minutes.md'), path.join(r1, 'readme-draft.json'), path.join(r1, 'PUBLISH.json')]) {
    assert.ok(finish.includes(part), `收尾提示词应含 ${part}`);
  }
  assert.match(finish, /SHA-256|shasum/, '收尾提示词应说明基线计算方式');
  assert.match(finish, /明确共识/, '应要求区分共识/建议/未决');
  assert.match(finish, /最后|PUBLISH/, '应要求最后写发布标记');
  assert.match(finish, /不要.*README|不直接修改/, '应禁止直接改 README');

  // 继续讨论：第 2 轮，标识沿用同一讨论
  disc.requestFinish(dataDir, d.id, { by: 'board' });
  const d2 = disc.continueDiscussion(dataDir, d.id, { by: 'board' });
  assert.equal(d2.rounds.length, 2, '开新轮');
  const start2 = disc.buildStartPrompt(dataDir, d.id);
  assert.ok(start2.includes(path.join(roundDir(dataDir, d.id, 2), 'minutes.md')), '第 2 轮提示词指向 rounds/2');
  assert.ok(!start2.includes(path.join(roundDir(dataDir, d.id, 1), 'minutes.md')), '不再指向第 1 轮目录');
  assert.match(start2, /2\s*轮|第 2 轮|第 2 轮/, '提示词应带本轮标识');
});

/* ---------- D2b：BUG-20260915-010 提示词末尾恰一个换行 ---------- */

t('D2b BUG-20260915-010 启动/收尾提示词末尾恰一个换行：endsWith("\\n") 且不以 "\\n\\n" 结尾，其余内容不变', () => {
  const { dataDir } = mkProject();
  const req = mkReq(dataDir);
  const d = disc.createDiscussion(dataDir, { reqId: req.id, by: 'board' });
  const start = disc.buildStartPrompt(dataDir, d.id);
  const finish = disc.buildFinishPrompt(dataDir, d.id);
  for (const [name, p] of [['启动', start], ['收尾', finish]]) {
    assert.ok(p.endsWith('\n'), `${name}提示词应以换行符结尾，粘贴后光标落在新行`);
    assert.ok(!p.endsWith('\n\n'), `${name}提示词末尾只追加一个换行，不得产生多余空行`);
    assert.ok(!p.startsWith('\n'), `${name}提示词开头不得追加换行`);
  }
  assert.ok(start.endsWith('半成品不会被读取。\n'), '启动提示词末行内容应保持不变，换行紧随其后');
  assert.ok(finish.endsWith('不要改变需求状态。\n'), '收尾提示词末行内容应保持不变，换行紧随其后');
});

/* ---------- D3：readOutcome 四态 ---------- */

t('D3 读取：waiting / error（缺文件、非法 JSON、绑定不符）/ published', () => {
  const { dataDir } = mkProject();
  const req = mkReq(dataDir);
  const d = disc.createDiscussion(dataDir, { reqId: req.id, by: 'board' });

  // 未发布 → waiting
  let out = disc.readOutcome(dataDir, d.id);
  assert.equal(out.state, 'waiting');
  assert.equal(out.minutes, null, 'waiting 不带内容');

  // 只有发布标记、缺纪要 → error
  const dir = roundDir(dataDir, d.id, 1);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'PUBLISH.json'), JSON.stringify({ discussionId: d.id, reqId: req.id, round: 1 }));
  out = disc.readOutcome(dataDir, d.id);
  assert.equal(out.state, 'error');
  assert.match(out.reason, /纪要|minutes/);

  // 草稿 JSON 非法 → error
  fs.writeFileSync(path.join(dir, 'minutes.md'), '# 纪要\n');
  fs.writeFileSync(path.join(dir, 'readme-draft.json'), '{oops');
  out = disc.readOutcome(dataDir, d.id);
  assert.equal(out.state, 'error');
  assert.match(out.reason, /草稿|JSON/);

  // 绑定不符（串单）→ error
  const draft = publishOutcome(dataDir, d, 1, { binding: { discussionId: 'DISC-20990101-999' } });
  out = disc.readOutcome(dataDir, d.id);
  assert.equal(out.state, 'error');
  assert.match(out.reason, /不匹配|绑定/, '绑定不符应拒绝读取为当前成果');

  // 草稿字段不完整 → error
  publishOutcome(dataDir, d, 1, { changes: [{ id: 'c1', title: 'x' }] });
  out = disc.readOutcome(dataDir, d.id);
  assert.equal(out.state, 'error');
  assert.match(out.reason, /changes|before|字段/);

  // 成套 → published
  publishOutcome(dataDir, d, 1);
  out = disc.readOutcome(dataDir, d.id);
  assert.equal(out.state, 'published');
  assert.match(out.minutes, /纪要/);
  assert.equal(out.draft.discussionId, d.id);
  assert.equal(out.draft.round, 1);
  assert.equal(disc.getDiscussion(dataDir, d.id).rounds[0].publishedAt, out.publishedAt, '首次读到应回写 publishedAt');
  // 再读仍 published（幂等）
  assert.equal(disc.readOutcome(dataDir, d.id).state, 'published');
});

/* ---------- D4：引用快照 ---------- */

t('D4 引用：saveQuote 落快照（行/版本/原文），不改 README', () => {
  const { dataDir } = mkProject();
  const req = mkReq(dataDir);
  const before = readMe(dataDir, req.id);
  const d = disc.createDiscussion(dataDir, { reqId: req.id, by: 'board' });

  const saved = disc.saveQuote(dataDir, d.id, { doc: 'README.md', startLine: 3, endLine: 3, version: 1, text: '从需求详情发起讨论，讨论线程自动归属当前需求。', by: 'board' });
  assert.equal(saved.quotes.length, 1);
  assert.equal(saved.quotes[0].startLine, 3);
  assert.equal(saved.quotes[0].version, 1);
  assert.equal(readMe(dataDir, req.id), before, '引用不写 README');
  assert.throws(() => disc.saveQuote(dataDir, d.id, { doc: 'evil.md', startLine: 1, endLine: 1, version: 1, text: 'x', by: 'board' }), /文档/, '仅白名单文档可存引用');
});

/* ---------- D5：归档 ---------- */

t('D5 归档：置 archivedAt 幂等，不写 README', () => {
  const { dataDir } = mkProject();
  const req = mkReq(dataDir);
  const d = disc.createDiscussion(dataDir, { reqId: req.id, by: 'board' });
  publishOutcome(dataDir, d, 1);
  disc.readOutcome(dataDir, d.id);

  const before = readMe(dataDir, req.id);
  const a1 = disc.archiveRound(dataDir, d.id, { by: 'board' });
  assert.ok(a1.rounds[0].archivedAt, '应置 archivedAt');
  const a2 = disc.archiveRound(dataDir, d.id, { by: 'board' });
  assert.equal(a2.rounds[0].archivedAt, a1.rounds[0].archivedAt, '重复归档幂等');
  assert.equal(readMe(dataDir, req.id), before, '归档不改说明');
});

/* ---------- D6：应用草稿（写入保护核心） ---------- */

t('D6 应用：成功/未选项不动/旧版保留/幂等；空选择、原文缺失或多义、基线不符整体失败', () => {
  const { dataDir } = mkProject();
  const req = mkReq(dataDir);
  const d = disc.createDiscussion(dataDir, { reqId: req.id, by: 'board' });
  const before = readMe(dataDir, req.id);

  // 未发布不可应用
  assert.throws(() => disc.applyDraft(dataDir, d.id, { selected: ['c1'], by: 'board' }), /发布|等待/);

  publishOutcome(dataDir, d, 1, {
    changes: [
      { id: 'c1', title: '调整讨论入口', before: '从需求详情发起讨论，讨论线程自动归属当前需求。', after: '从需求详情生成启动提示词，在 Agent 新会话中讨论。', basis: '明确共识第 1 项' },
      { id: 'c2', title: '补充收尾', before: '讨论结束后生成纪要。', after: '讨论结束后同时生成纪要与说明修改草稿。', basis: '明确共识第 2 项' },
      { id: 'c3', title: '不勾选项', before: '由用户确认归档。', after: '用户独立确认归档并逐项应用。', basis: '明确共识第 3 项' },
    ],
  });
  const out = disc.readOutcome(dataDir, d.id);
  assert.equal(out.state, 'published');

  // 空选择
  assert.throws(() => disc.applyDraft(dataDir, d.id, { selected: [], by: 'board' }), /未选择/);

  // 只勾 c1、c2
  const applied = disc.applyDraft(dataDir, d.id, { selected: ['c1', 'c2'], by: 'board' });
  const after = readMe(dataDir, req.id);
  assert.ok(after.includes('在 Agent 新会话中讨论'), 'c1 已写入');
  assert.ok(after.includes('同时生成纪要与说明修改草稿'), 'c2 已写入');
  assert.ok(after.includes('由用户确认归档。'), '未勾选 c3 不写入');
  assert.equal(applied.afterVersion, 2, '版本 +1');
  assert.deepEqual(applied.items.map((x) => x.id), ['c1', 'c2'], 'applied 记录选中项');
  // 旧版保留
  const v1 = fs.readFileSync(path.join(disc.discussionDir(dataDir, d.id), 'readme-versions', 'v1.md'), 'utf8');
  assert.equal(v1, before, '应保留应用前完整旧版');

  // 重复应用幂等：README 不再变化
  const again = disc.applyDraft(dataDir, d.id, { selected: ['c1', 'c2'], by: 'board' });
  assert.equal(again.alreadyApplied, true, '重复应用应返回已应用');
  assert.equal(readMe(dataDir, req.id), after, '不应二次写入');

  // 基线不符：新讨论 + 手改 README 后应用 → 拒绝
  const d2 = disc.createDiscussion(dataDir, { reqId: req.id, by: 'board' });
  publishOutcome(dataDir, d2, 1);
  fs.appendFileSync(readmeFile(dataDir, req.id), '\n用户手改了一行。\n');
  assert.throws(() => disc.applyDraft(dataDir, d2.id, { selected: ['c1'], by: 'board' }), /说明已变化|基线/, '基线不符应阻止覆盖');
  // 引用快照仍在（不因失败清理）
  assert.ok(disc.getDiscussion(dataDir, d2.id).quotes !== undefined);

  // 原文缺失 / 多义 → 整体失败，README 不变
  const { dataDir: dd2 } = mkProject();
  const req2 = mkReq(dd2);
  const d3 = disc.createDiscussion(dd2, { reqId: req2.id, by: 'board' });
  publishOutcome(dd2, d3, 1, { changes: [
    { id: 'c1', title: '缺失', before: '根本不存在的原文段落。', after: '新文本。', basis: '明确共识第 1 项' },
    { id: 'c2', title: '正常', before: '从需求详情发起讨论，讨论线程自动归属当前需求。', after: '替换后。', basis: '明确共识第 2 项' },
  ] });
  disc.readOutcome(dd2, d3.id);
  const before3 = readMe(dd2, req2.id);
  assert.throws(() => disc.applyDraft(dd2, d3.id, { selected: ['c1', 'c2'], by: 'board' }), /未在|找不到/);
  assert.equal(readMe(dd2, req2.id), before3, '整体失败不得部分写入');

  const d4 = disc.createDiscussion(dd2, { reqId: req2.id, by: 'board' });
  publishOutcome(dd2, d4, 1, { changes: [
    { id: 'c1', title: '多义', before: '讨论', after: '研讨', basis: '明确共识第 1 项' },
  ] });
  disc.readOutcome(dd2, d4.id);
  assert.throws(() => disc.applyDraft(dd2, d4.id, { selected: ['c1'], by: 'board' }), /多次|多处|唯一/);
});

/* ---------- D7：继续讨论 ---------- */

t('D7 继续讨论：旧轮归档/应用记录保留，新轮 outcome 独立', () => {
  const { dataDir } = mkProject();
  const req = mkReq(dataDir);
  const d = disc.createDiscussion(dataDir, { reqId: req.id, by: 'board' });
  publishOutcome(dataDir, d, 1);
  disc.readOutcome(dataDir, d.id);
  disc.archiveRound(dataDir, d.id, { by: 'board' });

  const d2 = disc.continueDiscussion(dataDir, d.id, { by: 'board' });
  assert.equal(d2.rounds.length, 2);
  assert.ok(d2.rounds[0].archivedAt, '旧轮归档记录保留');
  assert.equal(d2.rounds[1].archivedAt, null, '新轮未归档');

  // 第 2 轮未落盘 → waiting；第 1 轮仍可读已发布内容
  assert.equal(disc.readOutcome(dataDir, d.id).state, 'waiting', '新轮未发布应等待');
  const out1 = disc.readOutcome(dataDir, d.id, 1);
  assert.equal(out1.state, 'published', '指定轮次可读旧成果');

  // 第 2 轮落盘后发布
  publishOutcome(dataDir, d, 2, { changes: [
    { id: 'n1', title: '第二轮修改', before: '讨论结束后生成纪要。', after: '第二轮修改后的文本。', basis: '明确共识第 1 项' },
  ] });
  const out2 = disc.readOutcome(dataDir, d.id);
  assert.equal(out2.state, 'published');
  assert.equal(out2.draft.round, 2);
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
