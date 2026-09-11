#!/usr/bin/env node
// REQ-20260909-004 开放式讨论模块重构 —— 数据层测试（S1~S8）
// 覆盖：两态状态与旧数据映射、启动/收尾提示词、发布协议读取（waiting/error/published）、
// 草稿批量创建（幂等/部分失败/零候选）、归档与继续讨论兼容旧单
// 用法：node scripts/tests/discussion-store.test.mjs

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
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-discussion-store-')));
  core.initData(root);
  const dataDir = core.dataDirFrom(root);
  return { root, dataDir };
}

// 成套落盘（发布协议三件套）
function publish(dataDir, id, { minutes = '# 纪要\n\n- 共识：A', items = null, markerId = id } = {}) {
  const dir = oncall.ticketDir(dataDir, id);
  fs.writeFileSync(path.join(dir, 'minutes.md'), minutes);
  fs.writeFileSync(path.join(dir, 'candidates.json'), JSON.stringify({
    discussionId: id,
    items: items ?? [
      { id: 'c1', type: 'requirement', title: '候选需求一', description: '描述一', acceptance: '- [ ] 可用' },
      { id: 'c2', type: 'bug', title: '候选 Bug 二', description: '现象二', repro: '步骤二', actual: '实际二', expected: '预期二', acceptance: '修好' },
    ],
  }));
  fs.writeFileSync(path.join(dir, 'PUBLISH.json'), JSON.stringify({ discussionId: markerId, publishedAt: '2026-09-09T00:00:00.000Z' }));
}

t('S1 创建：标题必填 ≤120、背景可选、状态讨论中、无 reqId、ASK 独立序列', () => {
  const { dataDir } = mkProject();
  assert.throws(() => oncall.createDiscussion(dataDir, { title: '  ', background: 'b', by: 'board' }), /标题不能为空/, '空标题应拒绝');
  assert.throws(() => oncall.createDiscussion(dataDir, { title: 'x'.repeat(121), by: 'board' }), /标题过长/, '超长标题应拒绝');
  const a = oncall.createDiscussion(dataDir, { title: '怎样提升使用效率', background: '背景说明', by: 'board' });
  const b = oncall.createDiscussion(dataDir, { title: '无背景讨论', by: 'board' });
  assert.match(a.id, /^ASK-\d{8}-001$/);
  assert.match(b.id, /^ASK-\d{8}-002$/);
  assert.equal(a.status, 'discussing', '新建即讨论中');
  assert.equal(a.reqId, null, '开放式讨论不绑定需求');
  assert.equal(fs.readFileSync(path.join(oncall.ticketDir(dataDir, a.id), 'question.md'), 'utf8'), '背景说明', '背景存 question.md');
  assert.equal(fs.readFileSync(path.join(oncall.ticketDir(dataDir, b.id), 'question.md'), 'utf8'), '', '背景可空');
});

t('S2 两态映射：旧执行状态读时归一为讨论中且不改写原记录；archived 为已归档', () => {
  const { dataDir } = mkProject();
  // 旧单：走旧创建 + 派单回传，状态 answered
  const old = oncall.createTicket(dataDir, { title: '旧单', question: 'q', by: 'board' });
  oncall.dispatchTickets(dataDir, { ids: [old.id], mode: 'zcode', staff: '', by: 'board', kind: 'batch' });
  oncall.answerTicket(dataDir, old.id, { answer: '旧回答', by: 's', mode: 'zcode' });
  const d = oncall.createDiscussion(dataDir, { title: '新单', by: 'board' });

  let cards = oncall.listDiscussions(dataDir);
  assert.equal(cards.length, 2, '新旧单都在讨论列表');
  const oldCard = cards.find((c) => c.id === old.id);
  const newCard = cards.find((c) => c.id === d.id);
  assert.equal(oldCard.status, 'discussing', '旧 answered 状态读时归一为讨论中');
  assert.equal(newCard.status, 'discussing');
  assert.equal(oncall.getTicket(dataDir, old.id).status, 'answered', '旧记录原状态不被改写');

  oncall.archiveDiscussion(dataDir, old.id, { by: 'board' });
  cards = oncall.listDiscussions(dataDir, { status: 'archived' });
  assert.deepEqual(cards.map((c) => c.id), [old.id], '归档后进入已归档档');
  assert.equal(oncall.listDiscussions(dataDir, { status: 'discussing' }).map((c) => c.id).join(), d.id, '讨论中档过滤');
  assert.throws(() => oncall.listDiscussions(dataDir, { status: 'pending' }), /非法状态/, '仅两态合法');
});

t('S3 归档/继续讨论：无须成果可归档；往返不清空纪要与已创建条目', () => {
  const { dataDir } = mkProject();
  const d = oncall.createDiscussion(dataDir, { title: 't', by: 'board' });
  oncall.archiveDiscussion(dataDir, d.id, { by: 'board' });
  publish(dataDir, d.id);
  const r = oncall.createItems(dataDir, d.id, { items: [{ id: 'c1', type: 'requirement', title: 'A', description: 'd' }], by: 'board' });
  assert.ok(r.results[0].ok, '归档态允许补创建（随时可归档，不锁成果操作）');
  oncall.resumeDiscussion(dataDir, d.id, { by: 'board' });
  const full = oncall.discussionFull(dataDir, d.id);
  assert.equal(full.status, 'discussing', '继续讨论恢复讨论中');
  assert.equal(full.outcome.state, 'published', '纪要保留');
  assert.equal(full.created.length, 1, '已创建条目记录保留');
  oncall.archiveDiscussion(dataDir, d.id, { by: 'board' });
  assert.equal(oncall.discussionFull(dataDir, d.id).status, 'archived');
});

t('S4 提示词：启动含编号/项目根/逐轮保存与纪要入口（REQ-20260910-018）；收尾幂等且状态保持讨论中（兼容保留）', () => {
  const { root, dataDir } = mkProject();
  const d = oncall.createDiscussion(dataDir, { title: '提示词主题', background: '背景X', by: 'board' });
  const dir = oncall.ticketDir(dataDir, d.id);
  const sp = oncall.buildStartPrompt(dataDir, d.id);
  // REQ-20260910-018：启动提示词改为逐轮保存口径（轮次目录 + 纪要 + 统一入口命令），不再以收尾落盘为前提
  for (const want of [d.id, root, '提示词主题', '背景X', path.join(dir, 'rounds'), path.join(dir, 'minutes.md'), 'disc round', 'disc minutes']) {
    assert.ok(sp.includes(want), `启动提示词应包含 ${want}`);
  }
  assert.ok(!sp.includes('只在收到收尾提示词'), '不再要求收尾提示词才落盘');
  // 整理结论提示词承接原收尾三件套口径（minutes.md / candidates.json / PUBLISH.json）
  const op = oncall.buildOrganizePrompt(dataDir, d.id);
  for (const want of [d.id, path.join(dir, 'minutes.md'), path.join(dir, 'candidates.json'), path.join(dir, 'PUBLISH.json'), '共识', '未决问题', '不终止讨论']) {
    assert.ok(op.includes(want), `整理结论提示词应包含 ${want}`);
  }
  const fp = oncall.buildFinishPrompt(dataDir, d.id);
  for (const want of [d.id, path.join(dir, 'minutes.md'), path.join(dir, 'candidates.json'), path.join(dir, 'PUBLISH.json'), '共识', '未决问题', '验收标准']) {
    assert.ok(fp.includes(want), `收尾提示词应包含 ${want}（兼容保留）`);
  }
  oncall.requestFinish(dataDir, d.id, { by: 'board' });
  const at1 = oncall.getTicket(dataDir, d.id).finishPromptAt;
  assert.ok(at1, '收尾应记录 finishPromptAt');
  oncall.requestFinish(dataDir, d.id, { by: 'board' });
  assert.equal(oncall.getTicket(dataDir, d.id).finishPromptAt, at1, '重复点击不另记（幂等）');
  assert.equal(oncall.getTicket(dataDir, d.id).status, 'discussing', '等待纪要不是状态，仍为讨论中');
});

t('S5 成果读取：waiting / error（编号不符、缺纪要、缺草稿、结构非法）/ published 幂等盖章', () => {
  const { dataDir } = mkProject();
  const d = oncall.createDiscussion(dataDir, { title: 't', by: 'board' });
  const dir = oncall.ticketDir(dataDir, d.id);

  let out = oncall.readOutcome(dataDir, d.id);
  assert.equal(out.state, 'waiting', '无发布标记一律等待（含半成品）');
  fs.writeFileSync(path.join(dir, 'minutes.md'), '半成品');
  assert.equal(oncall.readOutcome(dataDir, d.id).state, 'waiting', '缺 PUBLISH.json 仍等待');

  fs.writeFileSync(path.join(dir, 'PUBLISH.json'), JSON.stringify({ discussionId: 'ASK-20990101-999', publishedAt: 'x' }));
  out = oncall.readOutcome(dataDir, d.id);
  assert.equal(out.state, 'error');
  assert.match(out.reason, /不匹配/, '编号不符应说明');

  fs.writeFileSync(path.join(dir, 'PUBLISH.json'), JSON.stringify({ discussionId: d.id, publishedAt: 'x' }));
  fs.rmSync(path.join(dir, 'minutes.md'), { force: true }); // 先清掉半成品纪要，构造「缺纪要」路径
  out = oncall.readOutcome(dataDir, d.id);
  assert.equal(out.state, 'error');
  assert.match(out.reason, /纪要/, '已发布缺纪要应报错');

  fs.writeFileSync(path.join(dir, 'minutes.md'), '# 纪要ok');  out = oncall.readOutcome(dataDir, d.id);
  assert.equal(out.state, 'error');
  assert.match(out.reason, /candidates|草稿/, '缺 candidates.json 应报错');

  fs.writeFileSync(path.join(dir, 'candidates.json'), 'not-json');
  out = oncall.readOutcome(dataDir, d.id);
  assert.equal(out.state, 'error');
  assert.match(out.reason, /非法|JSON/, '草稿 JSON 非法应报错');

  fs.writeFileSync(path.join(dir, 'candidates.json'), JSON.stringify({ discussionId: 'other', items: [] }));
  out = oncall.readOutcome(dataDir, d.id);
  assert.equal(out.state, 'error');
  assert.match(out.reason, /绑定|不匹配/, '草稿绑定不符应报错');

  fs.writeFileSync(path.join(dir, 'candidates.json'), JSON.stringify({ discussionId: d.id, items: 'x' }));
  assert.match(oncall.readOutcome(dataDir, d.id).reason, /items/, 'items 非数组应报错');

  const badSets = [
    [{ id: '', type: 'requirement', title: 't' }],
    [{ id: 'c1', type: 'task', title: 't' }],
    [{ id: 'c1', type: 'requirement', title: '' }],
    [{ id: 'c1', type: 'requirement', title: 'x'.repeat(121) }],
    [{ id: 'c1', type: 'bug', title: 'a' }, { id: 'c1', type: 'bug', title: 'b' }],
  ];
  for (const items of badSets) {
    fs.writeFileSync(path.join(dir, 'candidates.json'), JSON.stringify({ discussionId: d.id, items }));
    const o = oncall.readOutcome(dataDir, d.id);
    assert.equal(o.state, 'error', `非法条目应 error：${JSON.stringify(items[0]).slice(0, 60)}`);
    assert.ok(o.reason, '应有可读原因');
  }

  publish(dataDir, d.id);
  out = oncall.readOutcome(dataDir, d.id);
  assert.equal(out.state, 'published');
  assert.equal(out.minutes, '# 纪要\n\n- 共识：A');
  assert.equal(out.candidates.items.length, 2);
  assert.equal(out.candidates.items[0].type, 'requirement');
  const stamp = oncall.getTicket(dataDir, d.id).publishedAt;
  assert.ok(stamp, '首次读到应回写 publishedAt');
  assert.equal(oncall.readOutcome(dataDir, d.id).publishedAt, stamp, '后续沿用首见时间（幂等）');
});

t('S6 草稿创建：走 createItem 初始 submitted；文档含来源行与验收/复现；status 带 sourceDiscussion；ticket.created 记录', () => {
  const { dataDir } = mkProject();
  const d = oncall.createDiscussion(dataDir, { title: '源讨论标题', by: 'board' });
  publish(dataDir, d.id);
  const r = oncall.createItems(dataDir, d.id, {
    items: [
      { id: 'c1', type: 'requirement', title: '新需求A', description: '描述A', acceptance: '- [ ] 一\n- [ ] 二' },
      { id: 'c2', type: 'bug', title: '新BugB', description: '现象B', repro: '复现步骤B', actual: '实际B', expected: '预期B', acceptance: '不再复现' },
    ],
    by: 'board',
  });
  assert.deepEqual(r.results.map((x) => x.ok), [true, true]);
  const reqId = r.results[0].itemId;
  const bugId = r.results[1].itemId;
  assert.match(reqId, /^REQ-/);
  assert.match(bugId, /^BUG-/);
  const reqSt = core.getItemDetail(dataDir, reqId);
  assert.equal(reqSt.status, 'submitted', '初始待接受');
  assert.deepEqual(reqSt.sourceDiscussion, { id: d.id, title: '源讨论标题' }, '条目侧来源讨论关联');
  const reqReadme = fs.readFileSync(path.join(core.resolveItemDir(dataDir, reqId).dir, 'README.md'), 'utf8');
  assert.match(reqReadme, /- 来源讨论：/, 'README 应含来源讨论元信息行');
  assert.match(reqReadme, /- \[ \] 一/, '验收标准应写入需求 README');
  const bugReadme = fs.readFileSync(path.join(core.resolveItemDir(dataDir, bugId).dir, 'README.md'), 'utf8');
  assert.match(bugReadme, /复现步骤B/, 'Bug 复现步骤应写入');
  assert.match(bugReadme, /预期B/, 'Bug 期望行为应写入');
  assert.match(bugReadme, /实际B/, 'Bug 实际结果应写入');
  const meta = oncall.getTicket(dataDir, d.id);
  assert.equal(meta.created.c1.itemId, reqId);
  assert.equal(meta.created.c2.itemId, bugId);
  const full = oncall.discussionFull(dataDir, d.id);
  assert.equal(full.created.length, 2);
  assert.equal(full.created[0].itemStatus, 'submitted', '已创建成果带实时条目状态');
  assert.equal(full.draftCount, 2);
});

t('S7 创建幂等与部分失败：已建草稿跳过不重复；空标题逐项失败不影响其他条目', () => {
  const { dataDir } = mkProject();
  const d = oncall.createDiscussion(dataDir, { title: 't', by: 'board' });
  publish(dataDir, d.id, { items: [{ id: 'c1', type: 'requirement', title: 'A', description: 'd' }] });
  const r1 = oncall.createItems(dataDir, d.id, { items: [{ id: 'c1', type: 'requirement', title: 'A', description: 'd' }], by: 'board' });
  assert.ok(r1.results[0].ok && r1.results[0].itemId);
  const countAfter1 = fs.readdirSync(path.join(dataDir, 'requirements')).length;
  const r2 = oncall.createItems(dataDir, d.id, { items: [{ id: 'c1', type: 'requirement', title: 'A', description: 'd' }], by: 'board' });
  assert.equal(r2.results[0].skipped, true, '已创建草稿再次提交应跳过');
  assert.equal(r2.results[0].itemId, r1.results[0].itemId);
  assert.equal(fs.readdirSync(path.join(dataDir, 'requirements')).length, countAfter1, '不重复创建条目');

  const r3 = oncall.createItems(dataDir, d.id, {
    items: [
      { id: 'bad', type: 'requirement', title: '  ', description: 'x' },
      { id: 'c1', type: 'requirement', title: 'A', description: 'd' },
    ],
    by: 'board',
  });
  assert.equal(r3.results[0].ok, false, '空标题草稿应失败');
  assert.match(r3.results[0].error, /标题/);
  assert.equal(r3.results[1].skipped, true, '合法项不受失败项影响');
  assert.equal(fs.readdirSync(path.join(dataDir, 'requirements')).length, countAfter1, '失败项不建条目');
});

t('S8 零候选与阶段提示：items 空数组合法；卡片阶段等待纪要/纪要已生成/有待创建草稿', () => {
  const { dataDir } = mkProject();
  const a = oncall.createDiscussion(dataDir, { title: 'A', by: 'board' });
  const b = oncall.createDiscussion(dataDir, { title: 'B', by: 'board' });
  const c = oncall.createDiscussion(dataDir, { title: 'C', by: 'board' });
  oncall.requestFinish(dataDir, a.id, { by: 'board' }); // a：等待纪要
  publish(dataDir, b.id, { items: [] });               // b：纪要已生成（零候选）
  publish(dataDir, c.id);                               // c：有待创建草稿
  const phase = (id) => oncall.listDiscussions(dataDir).find((x) => x.id === id).phase;
  assert.equal(phase(a.id), 'waiting', '收尾后未发布 → 等待纪要');
  assert.equal(phase(b.id), 'ready', '零候选发布 → 纪要已生成');
  assert.equal(phase(c.id), 'drafts', '有未创建草稿 → 有待创建草稿');
  const full = oncall.discussionFull(dataDir, b.id);
  assert.equal(full.outcome.state, 'published');
  assert.equal(full.draftCount, 0, '零候选 draftCount 为 0');
  assert.equal(full.created.length, 0);
  // 零候选也可归档（无须成果）
  oncall.archiveDiscussion(dataDir, b.id, { by: 'board' });
  assert.equal(oncall.listDiscussions(dataDir, { status: 'archived' })[0].id, b.id);
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
