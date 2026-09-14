#!/usr/bin/env node
// REQ-20260907-003 需求完善 —— 数据层测试（R1~R9）
// 覆盖：完整性分析、候选、批次冻结与幂等、领取互斥与出局、完成/失败回执校验、check 协议、暂停
// 用法：node scripts/tests/refine-store.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as refine from '../lib/refine-store.mjs';
import * as refineStates from '../lib/refine-states.mjs';
import * as taskSettings from '../lib/task-settings.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function mkProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-refine-store-')));
  core.initData(root);
  const dataDir = core.dataDirFrom(root);
  return { root, dataDir };
}

// REQ-20260908-020：完善候选口径 = 已接受（accepted）未完善；测试用「人工接受」造候选
function accept(dataDir, id) {
  core.setStatus(dataDir, id, 'accepted', { by: 'human' });
}

// 补全一个需求条目文档（使其完整，不进候选）
// REQ-20260908-015：描述含 UI 关键词（界面布局）→ README 须带「界面展示」节
// REQ-20260908-021：界面展示升级为可交互 html 演示——README 节链接 ./ui-demo.html + 条目目录 ui-demo.html
function fillReqDocs(dir) {
  fs.writeFileSync(path.join(dir, 'README.md'), `# x

## 描述
这是一段足够长的真实描述，讲清楚界面布局、交互行为与状态反馈，超过三十个字符。

## 验收标准

- [x] 能筛选候选

## 界面展示

- [交互演示（ui-demo.html）](./ui-demo.html)
- 布局：顶栏筛选 + 候选清单；点击筛选按钮切换列表状态（正常/空/加载/失败）。
`);
  fs.writeFileSync(path.join(dir, 'design.md'), `# 设计

## 背景
有背景说明。

## 方案
采用独立账本方案，具体选型与影响面说明如下。

## 风险与边界
指纹只证明变更。
`);
  fs.writeFileSync(path.join(dir, 'test-cases.md'), `# 用例

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| 1 | 筛选候选 | P0 | ✅ |
`);
  fs.writeFileSync(path.join(dir, 'ui-demo.html'), `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>演示</title></head>
<body><main id="app"><button type="button">筛选</button><ul id="list"></ul></main></body></html>
`);
}

function fillBugDocs(dir) {
  // BUG-20260908-017：夹具保持非 UI 缺陷（现象不含 UI 关键词），UI Bug 的界面展示/演示口径由 S13 覆盖
  fs.writeFileSync(path.join(dir, 'README.md'), `# b

## 现象
导出的账本文件内容为空，日志无报错。

## 复现步骤

1. 打开账本
2. 触发导出

## 期望行为
导出文件包含完整账本数据。

## 验收说明

- 修复后可按步骤复现验证。
`);
}

t('R1 完整性分析：需求模板各缺失维度 / Bug 缺关键节逐项给原因；完整条目不报缺失', () => {
  const { dataDir } = mkProject();
  const req = core.createItem(dataDir, { type: 'requirement', title: '新需求' }); // 全模板
  const dir = core.resolveItemDir(dataDir, req.id).dir;
  let a = refine.analyzeItemDocs(dir, 'requirement');
  assert.equal(a.complete, false, '全模板需求应判不完整');
  // REQ-20260908-015：判定收敛到 README——design/test-cases 原因不再出现
  for (const want of ['README 描述待补充', '验收标准待补充', 'README 说明过简']) {
    assert.ok(a.reasons.includes(want), `应含「${want}」（得到 ${a.reasons}）`);
  }
  for (const gone of ['design 缺失', 'design 仅模板', 'test-cases 缺失', 'test-cases 无用例']) {
    assert.ok(!a.reasons.includes(gone), `不应再报「${gone}」（得到 ${a.reasons}）`);
  }
  fs.rmSync(path.join(dir, 'README.md'));
  a = refine.analyzeItemDocs(dir, 'requirement');
  assert.ok(a.reasons.includes('README 缺失'), 'README 缺失应给原因');

  const ok = core.createItem(dataDir, { type: 'requirement', title: '完整需求' });
  fillReqDocs(core.resolveItemDir(dataDir, ok.id).dir);
  a = refine.analyzeItemDocs(core.resolveItemDir(dataDir, ok.id).dir, 'requirement');
  assert.equal(a.complete, true, `补全后应完整（原因：${a.reasons}）`);

  const bug = core.createItem(dataDir, { type: 'bug', title: '新 Bug' });
  const bdir = core.resolveItemDir(dataDir, bug.id).dir;
  let b = refine.analyzeItemDocs(bdir, 'bug');
  for (const want of ['缺现象说明', '缺复现步骤', '缺期望结果', '缺验收说明']) {
    assert.ok(b.reasons.includes(want), `Bug 应含「${want}」（得到 ${b.reasons}）`);
  }
  fillBugDocs(bdir);
  b = refine.analyzeItemDocs(bdir, 'bug');
  assert.equal(b.complete, true, `Bug 补全后应完整（原因：${b.reasons}）`);
});

t('R2 候选清单（REQ-20260908-020）：仅已接受且未完善；文档完整不再排除；待接受/已计划不进；req 优先 → 创建早 → 编号', () => {
  const { dataDir } = mkProject();
  const bug1 = core.createItem(dataDir, { type: 'bug', title: 'b1' });
  const req1 = core.createItem(dataDir, { type: 'requirement', title: 'r1' });
  const req2 = core.createItem(dataDir, { type: 'requirement', title: 'r2' });
  const reqDone = core.createItem(dataDir, { type: 'requirement', title: '完整' });
  fillReqDocs(core.resolveItemDir(dataDir, reqDone.id).dir); // 文档完整的已接受单：仍是候选（完整性只影响展示原因）
  for (const x of [bug1, req1, req2, reqDone]) accept(dataDir, x.id);
  const plan = core.createItem(dataDir, { type: 'requirement', title: '已计划不进' });
  accept(dataDir, plan.id);
  core.setStatus(dataDir, plan.id, 'planned', { by: 'human' });
  let cands = refine.refineCandidates(dataDir);
  assert.deepEqual(cands.map((x) => x.id), [req1.id, req2.id, reqDone.id, bug1.id],
    `req 优先创建早优先，待接受/已计划不进（得到 ${cands.map((x) => x.id)}）`);
  assert.ok(Array.isArray(cands[0].reasons) && cands[0].reasons.length, '候选应携带缺失原因（展示用）');
  // 已完善（refined）不进候选
  refineStates.setRefineItemState(dataDir, reqDone.id, 'refined');
  cands = refine.refineCandidates(dataDir);
  assert.deepEqual(cands.map((x) => x.id), [req1.id, req2.id, bug1.id], '已完善单不进候选');
  // 待接受（submitted）单不进候选
  core.createItem(dataDir, { type: 'requirement', title: '待接受不进' });
  cands = refine.refineCandidates(dataDir);
  assert.equal(cands.length, 3, '待接受单不进候选');
});

t('R3 创建：ids 种子+原因+基线；未结束轮重复启动拒绝；无候选报错；zcode 提示词含流程与约束（REQ-20260913-003 不冻结）', () => {
  const { root, dataDir } = mkProject();
  const req1 = core.createItem(dataDir, { type: 'requirement', title: 'r1' });
  const bug1 = core.createItem(dataDir, { type: 'bug', title: 'b1' });
  for (const x of [req1, bug1]) accept(dataDir, x.id);
  // 勾选集合全部不可完善（不存在/已完善/不在已接受）→ 报错不建轮
  //（须在建轮前验证：未结束轮内重复启动拒绝会先于范围校验短路，REQ-20260913-003）
  assert.throws(() => refine.createRefineBatch(dataDir, { ids: ['REQ-19990101-999'], mode: 'zcode', projectRoot: root }), /不可完善/, '空过滤集应整体报错');
  // ids 过滤：只作队首种子
  const only = refine.createRefineBatch(dataDir, { ids: [req1.id], mode: 'zcode', projectRoot: root });
  assert.equal(only.created, true);
  assert.deepEqual(only.batch.candidates.map((c) => c.id), [req1.id], '勾选集合作队首种子');
  assert.equal(only.batch.candidates[0].baseline, refine.docsFingerprint(core.resolveItemDir(dataDir, req1.id).dir), '基线=当前指纹');

  // REQ-20260913-003：未结束轮内重复启动被拒（不幂等返回、不建第二线）；剩余候选 bug1 归本轮实时队列
  assert.throws(
    () => refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root, developer: '张三' }),
    /已有进行中的完善任务/,
    '未结束轮内重复启动应被拒（developer 遗留入参同时被忽略）',
  );
  assert.equal(refine.unfinishedRefineBatches(dataDir).length, 1, '始终只有一个未结束轮');
  assert.ok(refine.effectiveRefineCandidates(dataDir, only.batch).some((c) => c.id === bug1.id), '剩余候选实时并入本轮生效候选');

  // 全新项目：整批建轮不冻结候选 + 落提示词（REQ-20260910-027：developer 不再落账）
  const fresh = mkProject();
  const fr1 = core.createItem(fresh.dataDir, { type: 'requirement', title: 'r1' });
  const fb1 = core.createItem(fresh.dataDir, { type: 'bug', title: 'b1' });
  for (const x of [fr1, fb1]) accept(fresh.dataDir, x.id);
  const full2 = refine.createRefineBatch(fresh.dataDir, { mode: 'zcode', projectRoot: fresh.root, developer: '张三' });
  assert.equal(full2.created, true);
  assert.match(full2.batch.batchId, /^RFB-\d{8}-\d{3}$/, '独立 RFB 序列');
  assert.deepEqual(full2.batch.candidates, [], '整批建轮不再冻结候选快照');
  assert.equal('developer' in full2.batch, false, 'REQ-20260910-027：账本不再写 developer');
  assert.ok(!full2.batch.prompt.includes('会话名'), '提示词无会话命名指令');
  assert.ok(full2.batch.prompt.includes('atb refine next'), 'zcode 提示词含领取命令');
  assert.ok(full2.batch.prompt.includes('atb refine check'), 'zcode 提示词含核对命令');
  assert.ok(full2.batch.prompt.includes('不要修改业务源码'), '提示词约束不改业务源码');
  assert.ok(full2.batch.prompt.includes('保持 accepted'), '提示词约束保持已接受状态');
  assert.ok(full2.batch.prompt.includes('待确认'), '提示词要求未知事实标待确认');
  assert.ok(full2.batch.prompt.includes('atb refine next'), 'zcode 提示词含领取命令');
  assert.ok(full2.batch.prompt.includes('atb refine check'), 'zcode 提示词含核对命令');
  assert.ok(full2.batch.prompt.includes('不要修改业务源码'), '提示词约束不改业务源码');
  assert.ok(full2.batch.prompt.includes('保持 accepted'), '提示词约束保持已接受状态');
  assert.ok(full2.batch.prompt.includes('待确认'), '提示词要求未知事实标待确认');

  const empty = mkProject();
  assert.throws(() => refine.createRefineBatch(empty.dataDir, { mode: 'zcode', projectRoot: empty.root }), /没有可完善候选/, '无候选应报错');
  // 显式 codex 模式（REQ-20260909-011：mode 直连兼容仍按传入值落账；提示词单一通用版）
  core.createItem(empty.dataDir, { type: 'bug', title: 'b' });
  accept(empty.dataDir, core.listItems(empty.dataDir)[0].id);
  const cx = refine.createRefineBatch(empty.dataDir, { mode: 'codex', projectRoot: empty.root });
  assert.equal(cx.batch.mode, 'codex');
  assert.equal(cx.batch.agent, 'codex', '显式旧 mode 直连落账兼容');
  assert.ok(cx.batch.prompt && !/zcode|Zcode|codex|Codex|general-purpose/.test(cx.batch.prompt), 'REQ-20260909-011：提示词单一通用版（无执行端字样）');
});

t('R4 重复启动拒绝 + 实时队列（REQ-20260913-003）：候选一致与候选新增均拒绝新建；新候选由本轮吸收；条目保持 accepted', () => {
  const { root, dataDir } = mkProject();
  const items = ['r1', 'r2'].map((title) => {
    const x = core.createItem(dataDir, { type: 'requirement', title });
    accept(dataDir, x.id);
    return x;
  });
  const [req1, req2] = items;
  const first = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  assert.throws(
    () => refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root }),
    /已有进行中的完善任务/,
    '重复启动被拒（不幂等返回、不排队）',
  );
  // 创建任务后新接受单 → 重复创建同样被拒，不产生第二个未结束轮
  const r3item = core.createItem(dataDir, { type: 'requirement', title: 'r3' });
  accept(dataDir, r3item.id);
  assert.throws(() => refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root }), /已有进行中的完善任务/, '候选新增后重复创建同样被拒');
  const unfinished = refine.unfinishedRefineBatches(dataDir);
  assert.equal(unfinished.length, 1, '始终只有一个未结束完善轮');
  assert.equal(unfinished[0].batchId, first.batch.batchId);

  // 新候选由本轮后续领取轮实时吸收（每轮实时读取口径）
  const got1 = refine.nextRefineItem(dataDir, first.batch.batchId, { owner: 'w1' });
  assert.equal(got1.itemId, req1.id, '按冻结序领取第一项');
  fs.writeFileSync(path.join(got1.itemDir, 'README.md'), '# r1\n\n## 描述\n补全后的说明，超过三十个字符以保证判定完整。\n\n## 验收标准\n\n- [x] 可筛选\n');
  refine.finishRefineRun(dataDir, got1.runId, { result: 'done', summary: '补全 r1' });
  const got2 = refine.nextRefineItem(dataDir, first.batch.batchId, { owner: 'w1' });
  assert.equal(got2.itemId, req2.id);
  fs.writeFileSync(path.join(got2.itemDir, 'README.md'), '# r2\n\n## 描述\n补全后的说明，超过三十个字符以保证判定完整。\n\n## 验收标准\n\n- [x] 可筛选\n');
  refine.finishRefineRun(dataDir, got2.runId, { result: 'done', summary: '补全 r2' });
  const got3 = refine.nextRefineItem(dataDir, first.batch.batchId, { owner: 'w1' });
  assert.equal(got3.itemId, r3item.id, '创建后新接受的 r3 在后续领取轮被吸收处理');
  fs.writeFileSync(path.join(got3.itemDir, 'README.md'), '# r3\n\n## 描述\n补全后的说明，超过三十个字符以保证判定完整。\n\n## 验收标准\n\n- [x] 可筛选\n');
  refine.finishRefineRun(dataDir, got3.runId, { result: 'done', summary: '补全 r3' });
  const end = refine.nextRefineItem(dataDir, first.batch.batchId, { owner: 'w1' });
  assert.equal(end.stop, 'finished', '吸收项处理完后批次收尾');
  for (const x of [req1, req2, r3item]) {
    assert.equal(core.readStatus(core.resolveItemDir(dataDir, x.id).dir).status, 'accepted', `${x.id} 全程保持 accepted`);
  }
});

t('R4b 重复派发保护（REQ-20260913-003 口径）：未结束轮内一律拒绝新建（含显式旧 mode / 显式 ids）；存量排队账本不得抢先领取', () => {
  const { root, dataDir } = mkProject();
  const r1 = core.createItem(dataDir, { type: 'requirement', title: 'r1' });
  accept(dataDir, r1.id);
  const b1 = refine.createRefineBatch(dataDir, { projectRoot: root }); // 通用子代理模式
  // 显式旧 mode 入参（存量语义兼容）：不按 mode 分叉——一律按重复启动拒绝，不建第二条线
  assert.throws(
    () => refine.createRefineBatch(dataDir, { mode: 'codex', projectRoot: root }),
    /已有进行中的完善任务/,
    '显式 codex 重复创建被拒，不并行新建',
  );
  // 新接受候选：全量与勾选范围（ids）重复创建均被拒（新候选由本轮实时队列吸收）
  const r2 = core.createItem(dataDir, { type: 'requirement', title: 'r2' });
  accept(dataDir, r2.id);
  assert.throws(() => refine.createRefineBatch(dataDir, { projectRoot: root }), /已有进行中的完善任务/, '全量重复创建被拒（新候选由本轮吸收）');
  assert.throws(() => refine.createRefineBatch(dataDir, { ids: [r2.id], projectRoot: root }), /已有进行中的完善任务/, '勾选范围重复创建同样被拒');
  assert.equal(refine.unfinishedRefineBatches(dataDir).length, 1, '不产生第二个未结束轮');
  // 存量排队数据防抢（升级前账本形态）：后位账本不得越过队首领取
  const b2Id = 'RFB-20990101-099';
  const raw = refine.getRefineBatch(dataDir, b1.batch.batchId);
  const dirB = path.join(dataDir, 'refine', 'batches', b2Id);
  fs.mkdirSync(dirB, { recursive: true });
  fs.writeFileSync(path.join(dirB, 'batch.json'), JSON.stringify({
    ...raw, batchId: b2Id, createdAt: '2099-01-02T00:00:00.000Z', status: 'prepared', currentRunId: null, candidates: [],
  }));
  assert.throws(() => refine.nextRefineItem(dataDir, b2Id, { owner: 'w2' }), /排队中/, '不得越过队首领取');
  assert.doesNotThrow(() => refine.nextRefineItem(dataDir, b1.batch.batchId, { owner: 'w1' }), '队首账本可领取');
});

t('R5 领取：预留+互斥；未收尾重复领取被拒；状态变化出局记 skipped；人工编辑不跳过（BUG-20260908-011）', () => {
  const { root, dataDir } = mkProject();
  const items = ['r1', 'r2', 'r3'].map((title) => {
    const x = core.createItem(dataDir, { type: 'requirement', title });
    accept(dataDir, x.id);
    return x;
  });
  const [req1, req2, req3] = items;
  const { batch } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  const got = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  assert.equal(got.itemId, req1.id, '按冻结序领取第一项');
  assert.match(got.runId, /^run-/);
  assert.ok(got.reasons.length, '领取结果带缺失原因');
  assert.ok(got.itemDir.endsWith(req1.id), '领取结果带条目目录');
  assert.ok(fs.existsSync(path.join(dataDir, '.locks', 'refine.lock')), '领取应持有 refine 互斥锁');
  assert.throws(() => refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1b' }), /未收尾/, '在途执行不得二次领取');

  // 完成第一项（先改文档再 done；条目保持 accepted）
  fs.writeFileSync(path.join(got.itemDir, 'README.md'), '# r1\n\n## 描述\n补全后的说明，超过三十个字符以保证判定完整。\n\n## 验收标准\n\n- [x] 可筛选\n');
  refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '补全 r1' });

  // req2 冻结后置为已计划（离开已接受）→ 领取时出局记 skipped；
  // req3 冻结后被人工编辑 → BUG-20260908-011：领取时重冻结基线，正常领取不再出局
  core.setStatus(dataDir, req2.id, 'planned', { by: 'human' });
  const req3dir = core.resolveItemDir(dataDir, req3.id).dir;
  fs.writeFileSync(path.join(req3dir, 'README.md'), '# r3\n人工已自行补全一版说明，内容足够长。\n');
  const got3 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w2' });
  assert.equal(got3.itemId, req3.id, '被人工编辑的条目按领取时基线正常领取');
  fs.appendFileSync(path.join(got3.itemDir, 'README.md'), '\n子代理补全说明\n');
  refine.finishRefineRun(dataDir, got3.runId, { result: 'done', summary: '补全 r3' });
  const end = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w3' });
  assert.equal(end.stop, 'finished', '最后一项状态变化出局 → 收尾');
  const runs = refine.listRefineRuns(dataDir, batch.batchId, { offset: 0, limit: 20 });
  const skipped = runs.records.filter((x) => x.result === 'skipped');
  assert.equal(skipped.length, 1, '仅状态变化一条 skipped（人工编辑不再出局）');
  assert.match(skipped.find((x) => x.itemId === req2.id).reason, /状态已变化/);
  const ck = refine.checkRefineBatch(dataDir, batch.batchId);
  assert.equal(ck.counts.done, 2);
  assert.equal(ck.counts.skipped, 1);
  assert.equal(ck.counts.remaining, 0);
});

t('R6/R7 回执校验：done 缺 summary / 无变更拒绝；人工提前移入计划后 done 成功不流转（REQ-20260909-010）；fail 缺 reason、超长拒绝；不重复回执', () => {
  const { root, dataDir } = mkProject();
  const req = core.createItem(dataDir, { type: 'requirement', title: 'r1' });
  accept(dataDir, req.id);
  const { batch } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  const got = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  assert.throws(() => refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '  ' }), /summary/, 'done 需摘要');
  assert.throws(() => refine.finishRefineRun(dataDir, got.runId, { result: 'failed', reason: '' }), /reason/, 'fail 需原因');
  assert.throws(() => refine.finishRefineRun(dataDir, got.runId, { result: 'failed', reason: '长'.repeat(201) }), /200/, 'reason ≤200 字');
  assert.throws(() => refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: 's' }), /未检测到补全变更/, '无变更不能记完成');
  // REQ-20260909-010：人工已提前移入计划（planned）→ done 成功记账不流转，回执带原因说明
  taskSettings.saveTaskSettings(dataDir, { refine: { autoPlanAfterDone: true } }); // 开启后 planned 场景仍不重复流转
  core.setStatus(dataDir, req.id, 'planned', { by: 'human' });
  fs.writeFileSync(path.join(got.itemDir, 'README.md'), '# r\n补全后的说明，内容足够长超过阈值。');
  const fin = refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: 's' });
  assert.equal(fin.receipt.result, 'done', 'planned 场景 done 成功（完善结果有效，无需流转）');
  assert.equal(fin.receipt.autoPlan.transitioned, false, '不重复流转');
  assert.equal(fin.receipt.autoPlan.reason, 'not-accepted:planned', '回执说明未流转原因');
  assert.equal(core.readStatus(core.resolveItemDir(dataDir, req.id).dir).status, 'planned', '条目保持人工置的计划态');
  assert.throws(() => refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: 's' }), /已收尾/, '同一运行不得重复回执');
});

t('R8 check 协议：counts/nextAction/≤2KiB；全部处理完 stop+finished；记录带摘要', () => {
  const { root, dataDir } = mkProject();
  const req = core.createItem(dataDir, { type: 'requirement', title: 'r1' });
  accept(dataDir, req.id);
  const { batch } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  let ck = refine.checkRefineBatch(dataDir, batch.batchId);
  assert.equal(ck.counts.total, 1);
  assert.equal(ck.counts.remaining, 1);
  assert.equal(ck.nextAction, 'continue');
  const got = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  ck = refine.checkRefineBatch(dataDir, batch.batchId);
  assert.equal(ck.nextAction, 'needs_attention', '在途执行待回执核对');
  assert.ok(ck.current && ck.current.runId === got.runId);
  fs.writeFileSync(path.join(got.itemDir, 'README.md'), '# r1\n\n## 描述\n补全后的完整说明，足够长且超过阈值三十个字符以上。\n');
  refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '补全了描述与验收' });
  ck = refine.checkRefineBatch(dataDir, batch.batchId);
  assert.equal(ck.counts.done, 1);
  assert.equal(ck.counts.remaining, 0);
  assert.equal(ck.nextAction, 'stop');
  assert.equal(refine.getRefineBatch(dataDir, batch.batchId).status, 'finished');
  assert.ok(Buffer.byteLength(JSON.stringify(ck)) <= 2048, 'check ≤2KiB');
  const runs = refine.listRefineRuns(dataDir, batch.batchId, { offset: 0, limit: 20 });
  assert.equal(runs.total, 1);
  assert.equal(runs.records[0].result, 'done');
  assert.equal(runs.records[0].summary, '补全了描述与验收');
  const s = refine.refineSummary(dataDir, batch.batchId);
  assert.equal('batchId' in s.batch, false, 'REQ-20260913-003：公开视图不再透出批次号');
  assert.equal(refine.getRefineBatch(dataDir, batch.batchId).batchId, batch.batchId);
  assert.equal(s.counts.done, 1);
});

t('R9 暂停/恢复与 release：pause 后 next 返回 stop=paused；release 释放互斥可续', () => {
  const { root, dataDir } = mkProject();
  for (const title of ['r1', 'r2']) {
    const x = core.createItem(dataDir, { type: 'requirement', title });
    accept(dataDir, x.id);
  }
  const { batch } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  const got = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  refine.releaseRefineRun(dataDir, got.runId, { reason: '认领冲突换单' });
  assert.equal(refine.getRefineRun(dataDir, got.runId).phase, 'interrupted');
  refine.pauseRefineBatch(dataDir, batch.batchId, true);
  const paused = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w2' });
  assert.equal(paused.stop, 'paused', '暂停后不再领取');
  refine.pauseRefineBatch(dataDir, batch.batchId, false);
  const got2 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w2' });
  assert.equal(got2.itemId, core.listItems(dataDir).find((x) => x.title === 'r2').id, '恢复后继续领取下一项');
  // 摘要缺省批次解析：队首未结束账本（公开视图不再透出批次号）
  const s = refine.refineSummary(dataDir);
  assert.equal('batchId' in s.batch, false, 'REQ-20260913-003：公开视图不再透出批次号');
  assert.equal(refine.queueHeadRefineBatch(dataDir).batchId, batch.batchId);
});

t('R11 上报显示单号和标题（REQ-20260908-014）：done/failed 回执、check.current、records 均含 title；快照缺失回退实时读；条目已删且无快照为 null', () => {
  const { root, dataDir } = mkProject();
  const req1 = core.createItem(dataDir, { type: 'requirement', title: '完善登录描述' });
  const req2 = core.createItem(dataDir, { type: 'requirement', title: '完善导出描述' });
  for (const x of [req1, req2]) accept(dataDir, x.id);
  const { batch } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  const got = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });

  // check.current 在途显示单号+标题
  const ck = refine.checkRefineBatch(dataDir, batch.batchId);
  assert.equal(ck.current.itemId, req1.id);
  assert.equal(ck.current.title, '完善登录描述', 'check.current 应带条目标题');

  // done 回执带单号与标题
  fs.writeFileSync(path.join(got.itemDir, 'README.md'), '# r\n\n## 描述\n补全后的说明文字长度超过阈值三十个字符以上，可判定为真实变更。\n');
  const fin = refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '补全描述' });
  assert.equal(fin.receipt.itemId, req1.id);
  assert.equal(fin.receipt.title, '完善登录描述', 'done 回执应带条目标题');
  assert.ok(Buffer.byteLength(JSON.stringify(fin.receipt)) <= 2048, '回执 ≤2KiB');

  // failed 回执带标题
  const got2 = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w2' });
  const fail = refine.finishRefineRun(dataDir, got2.runId, { result: 'failed', reason: '信息不足：无法确认复现环境' });
  assert.equal(fail.receipt.itemId, req2.id);
  assert.equal(fail.receipt.title, '完善导出描述', 'failed 回执应带条目标题');

  // records 记录带标题；历史 run 无快照时回退实时读条目标题
  let runs = refine.listRefineRuns(dataDir, batch.batchId, { offset: 0, limit: 20 });
  assert.equal(runs.records.find((x) => x.itemId === req1.id).title, '完善登录描述');
  const runFile1 = path.join(refine.refineRunDir(dataDir, got.runId), 'run.json');
  const raw1 = JSON.parse(fs.readFileSync(runFile1, 'utf8'));
  delete raw1.itemTitle; // 模拟 REQ-20260908-014 之前创建的历史运行
  fs.writeFileSync(runFile1, JSON.stringify(raw1));
  runs = refine.listRefineRuns(dataDir, batch.batchId, { offset: 0, limit: 20 });
  assert.equal(runs.records.find((x) => x.itemId === req1.id).title, '完善登录描述', '无快照应回退实时读条目标题');

  // 条目已删除且无快照 → title 为 null 不报错（run2 有快照仍展示领取时标题）
  fs.rmSync(core.resolveItemDir(dataDir, req2.id).dir, { recursive: true, force: true });
  runs = refine.listRefineRuns(dataDir, batch.batchId, { offset: 0, limit: 20 });
  assert.equal(runs.records.find((x) => x.itemId === req2.id).title, '完善导出描述', '有快照时不依赖条目存在');
  const runFile2 = path.join(refine.refineRunDir(dataDir, got2.runId), 'run.json');
  const raw2 = JSON.parse(fs.readFileSync(runFile2, 'utf8'));
  delete raw2.itemTitle;
  fs.writeFileSync(runFile2, JSON.stringify(raw2));
  runs = refine.listRefineRuns(dataDir, batch.batchId, { offset: 0, limit: 20 });
  assert.equal(runs.records.find((x) => x.itemId === req2.id).title, null, '条目已删且无快照 → null');
});

// ---------- REQ-20260908-015：完善判定收敛到 README + UI「界面展示」门槛 ----------

// 无 UI 关键词、内容达标的 README（描述 + 验收合计 ≥30 字）
function plainReqReadme() {
  return `# x

## 描述
调整账本冻结口径与出局落账顺序，全部改动位于数据层完成，说明长度超过三十个字符。

## 验收标准

- [x] 判定只看 README
`;
}

t('S1/S2 判定收敛：README 完整即 complete，design 仅模板/缺失、test-cases 无用例/缺失不再报原因', () => {
  const { dataDir } = mkProject();
  const req = core.createItem(dataDir, { type: 'requirement', title: '流程需求' });
  const dir = core.resolveItemDir(dataDir, req.id).dir;
  // createItem 生成的 design.md 即模板、test-cases.md 空表（旧口径会报「design 仅模板」「test-cases 无用例」）
  fs.writeFileSync(path.join(dir, 'README.md'), plainReqReadme());
  let a = refine.analyzeItemDocs(dir, 'requirement');
  assert.equal(a.complete, true, `design 模板态不应影响判定（得到 ${a.reasons}）`);
  for (const gone of ['design 缺失', 'design 仅模板', 'test-cases 缺失', 'test-cases 无用例']) {
    assert.ok(!a.reasons.includes(gone), `不应再报「${gone}」（得到 ${a.reasons}）`);
  }
  // 删除 design.md / test-cases.md 文件同样不影响
  fs.rmSync(path.join(dir, 'design.md'));
  fs.rmSync(path.join(dir, 'test-cases.md'));
  a = refine.analyzeItemDocs(dir, 'requirement');
  assert.equal(a.complete, true, `design/test-cases 文件缺失不应影响判定（得到 ${a.reasons}）`);
});

t('S3（回归）README 三项判定不变：描述占位 / 验收占位 / 说明过简', () => {
  const { dataDir } = mkProject();
  const req = core.createItem(dataDir, { type: 'requirement', title: 'r' });
  const dir = core.resolveItemDir(dataDir, req.id).dir;
  let a = refine.analyzeItemDocs(dir, 'requirement');
  for (const want of ['README 描述待补充', '验收标准待补充', 'README 说明过简']) {
    assert.ok(a.reasons.includes(want), `模板 README 应报「${want}」（得到 ${a.reasons}）`);
  }
  // 描述有实质但描述+验收合计 <30 字 → 仍报说明过简，不报描述待补充
  fs.writeFileSync(path.join(dir, 'README.md'), '# x\n\n## 描述\n数据流转口径说明。\n\n## 验收标准\n\n- [x] 可跑\n');
  a = refine.analyzeItemDocs(dir, 'requirement');
  assert.ok(a.reasons.includes('README 说明过简'), '合计 <30 字仍报说明过简');
  assert.ok(!a.reasons.includes('README 描述待补充'), '描述有实质内容不报待补充');
});

// BUG-20260908-017：涉及 UI 的 Bug 与需求同等对待（界面展示 + ui-demo.html 演示）；
// 不涉及 UI 的 Bug 保持四节判定、无界面展示原因
t('S4（回归）Bug 四项判定不变；不涉及 UI 的 Bug 无界面展示原因', () => {
  const { dataDir } = mkProject();
  const bug = core.createItem(dataDir, { type: 'bug', title: 'b' });
  const dir = core.resolveItemDir(dataDir, bug.id).dir;
  fs.writeFileSync(path.join(dir, 'README.md'), `# b

## 现象
导出账本时偶发文件内容为空，日志无报错信息，纯数据层缺陷。

## 复现步骤

1. 连续快速触发两次导出
2. 查看导出的文件内容

## 期望行为
导出文件始终包含完整账本数据，并发触发不会互相覆盖。

## 验收说明

- 修复后可按上述步骤复现验证。
`);
  let b = refine.analyzeItemDocs(dir, 'bug');
  assert.equal(b.complete, true, `Bug 四项齐备应完整（得到 ${b.reasons}）`);
  assert.ok(!b.reasons.some((x) => x.includes('界面展示')), '不涉及 UI 的 Bug 无界面展示原因');
  // 缺节仍逐项报；现象命中「按钮/页面」关键词时按 BUG-20260908-017 同步触发界面展示启发式
  fs.writeFileSync(path.join(dir, 'README.md'), '# b\n\n## 现象\n点击保存按钮后页面没有反应。\n');
  b = refine.analyzeItemDocs(dir, 'bug');
  for (const want of ['缺复现步骤', '缺期望结果', '缺验收说明', '涉及 UI 需界面展示']) {
    assert.ok(b.reasons.includes(want), `缺节应报「${want}」（得到 ${b.reasons}）`);
  }
});

t('S5 UI 启发式：描述命中 UI 关键词且 README 无「界面展示」节 → 涉及 UI 需界面展示（词表逐词）', () => {
  const { dataDir } = mkProject();
  const req = core.createItem(dataDir, { type: 'requirement', title: 'UI 需求' });
  const dir = core.resolveItemDir(dataDir, req.id).dir;
  // 词表定案（与 refine-store.mjs UI_KEYWORDS 一致，固化为断言）
  // BUG-20260910-011：增补「边框」（BUG-20260910-010 实测漏报词）
  const words = ['界面', 'UI', '页面', '弹窗', '面板', '按钮', '输入框', '布局', '拖拽', '抽屉', '顶栏', '边框'];
  for (const w of words) {
    fs.writeFileSync(path.join(dir, 'README.md'), `# x

## 描述
支持「${w}」相关交互的说明文字，长度超过三十个字符以保证说明不过简。

## 验收标准

- [x] 支持${w}
`);
    const a = refine.analyzeItemDocs(dir, 'requirement');
    assert.ok(a.reasons.includes('涉及 UI 需界面展示'), `词表「${w}」应触发（得到 ${a.reasons}）`);
    assert.ok(!a.reasons.includes('界面展示待补充'), `无节时不报占位原因（得到 ${a.reasons}）`);
    assert.ok(!a.reasons.some((x) => x.includes('ui-demo.html')), `无节时不叠加演示三查原因（得到 ${a.reasons}）`);
  }
});

t('S6 UI 界面展示门槛（REQ-20260908-021）：节占位仍报待补充；节有内容后 html 三查（缺文件/占位/未链接）；齐备判完整；误判兜底保留', () => {
  const uiDesc = '新增一个筛选面板，顶部放刷新按钮，点击按钮后列表刷新并显示加载状态，底部保留分页控件。';
  const { dataDir } = mkProject();
  const req = core.createItem(dataDir, { type: 'requirement', title: 'UI 需求' });
  const dir = core.resolveItemDir(dataDir, req.id).dir;
  const demoPath = path.join(dir, 'ui-demo.html');
  const readmeWithDemo = (demoBody) => `# x

## 描述
${uiDesc}

## 验收标准

- [x] 可筛选

## 界面展示

${demoBody}
`;
  // 1) 节存在但仅「（待补充）」占位 → 界面展示待补充（不叠加演示三查原因）
  fs.writeFileSync(path.join(dir, 'README.md'), readmeWithDemo('（待补充）'));
  let a = refine.analyzeItemDocs(dir, 'requirement');
  assert.ok(a.reasons.includes('界面展示待补充'), `占位节应报「界面展示待补充」（得到 ${a.reasons}）`);
  assert.ok(!a.reasons.includes('涉及 UI 需界面展示'), '已有节不再报缺失节原因');
  assert.ok(!a.reasons.some((x) => x.includes('ui-demo.html')), '占位节不叠加演示三查原因');
  // 2) 节有实质内容（ASCII 线框）但条目目录缺 ui-demo.html → 缺演示文件
  fs.writeFileSync(path.join(dir, 'README.md'), readmeWithDemo(`+--------------------------+
| 顶栏：标题 · 刷新按钮    |
+--------------------------+
| 候选清单（可滚动）       |
+--------------------------+`));
  a = refine.analyzeItemDocs(dir, 'requirement');
  assert.ok(a.reasons.includes('涉及 UI 缺 ui-demo.html 演示'), `缺演示文件应报（得到 ${a.reasons}）`);
  // 3) ui-demo.html 存在但为空 / 仅 HTML 注释占位 → 演示待补充
  for (const placeholder of ['', '\n<!-- 待补充 -->\n']) {
    fs.writeFileSync(demoPath, placeholder);
    a = refine.analyzeItemDocs(dir, 'requirement');
    assert.ok(a.reasons.includes('ui-demo.html 演示待补充'), `占位演示文件应报（得到 ${a.reasons}）`);
  }
  // 4) 演示文件有效但 README 界面展示节未链接 → 节须链接
  fs.writeFileSync(demoPath, '<!doctype html>\n<html><body>筛选面板演示</body></html>\n');
  a = refine.analyzeItemDocs(dir, 'requirement');
  assert.ok(a.reasons.includes('界面展示节未链接 ./ui-demo.html'), `节未链接演示应报（得到 ${a.reasons}）`);
  // 5) 节链接 + 演示文件齐备（ASCII 线框降为可选补充）→ complete
  fs.writeFileSync(path.join(dir, 'README.md'), readmeWithDemo(`- [交互演示（ui-demo.html）](./ui-demo.html)
- 布局：顶栏刷新按钮 + 列表；点击按钮切换列表状态（正常/空/加载/失败）。`));
  a = refine.analyzeItemDocs(dir, 'requirement');
  assert.equal(a.complete, true, `链接与演示齐备应判完整（得到 ${a.reasons}）`);
  // 6) 启发式误判兜底：描述误命中关键词，但节内写明不涉及界面改动即视为有效内容，不做 html 三查
  fs.rmSync(demoPath);
  fs.writeFileSync(path.join(dir, 'README.md'), `# x

## 描述
描述提到面板一词但实为纯流程需求，改动都在数据层完成，说明长度超过三十个字符。

## 验收标准

- [x] 可跑

## 界面展示

本需求不涉及界面改动，无需界面示意。
`);
  a = refine.analyzeItemDocs(dir, 'requirement');
  assert.equal(a.complete, true, `误判兜底说明应视为有效内容（得到 ${a.reasons}）`);
});

t('S7 非 UI 纯流程需求：README 完整且无界面展示相关原因', () => {
  const { dataDir } = mkProject();
  const req = core.createItem(dataDir, { type: 'requirement', title: '流程需求' });
  const dir = core.resolveItemDir(dataDir, req.id).dir;
  fs.writeFileSync(path.join(dir, 'README.md'), plainReqReadme());
  const a = refine.analyzeItemDocs(dir, 'requirement');
  assert.equal(a.complete, true, `非 UI 需求 README 完整即完整（得到 ${a.reasons}）`);
  assert.ok(!a.reasons.some((x) => x.includes('界面展示')), '非 UI 需求无界面展示相关原因');
});

t('S8 候选（REQ-20260908-020 口径）：已接受未完善均入候选（README 完整同样入，等待记「已完善」）；已完善不入；排序口径不变', () => {
  const { dataDir } = mkProject();
  const bug1 = core.createItem(dataDir, { type: 'bug', title: 'b1' });
  const reqOk = core.createItem(dataDir, { type: 'requirement', title: 'README 已完整' });
  const dir = core.resolveItemDir(dataDir, reqOk.id).dir;
  fs.writeFileSync(path.join(dir, 'README.md'), plainReqReadme()); // design.md 仍为模板
  const req2 = core.createItem(dataDir, { type: 'requirement', title: 'r2' });
  for (const x of [bug1, reqOk, req2]) accept(dataDir, x.id);
  let cands = refine.refineCandidates(dataDir);
  assert.deepEqual(cands.map((x) => x.id), [reqOk.id, req2.id, bug1.id],
    `已接受未完善均入候选；req 优先创建早优先（得到 ${cands.map((x) => x.id)}）`);
  assert.equal(cands.find((x) => x.id === reqOk.id).reasons.length, 0, 'README 完整的候选缺失原因为空（展示用）');
  refineStates.setRefineItemState(dataDir, reqOk.id, 'refined'); // 已完善不再入候选
  cands = refine.refineCandidates(dataDir);
  assert.deepEqual(cands.map((x) => x.id), [req2.id, bug1.id], '已完善单不入候选');
});

t('S9（回归+REQ-20260908-021）docsFingerprint 覆盖三文档与 ui-demo.html；只改演示文件的 done 回执可记账', () => {
  const { root, dataDir } = mkProject();
  const req = core.createItem(dataDir, { type: 'requirement', title: 'r1' });
  accept(dataDir, req.id);
  const dir = core.resolveItemDir(dataDir, req.id).dir;
  const fp0 = refine.docsFingerprint(dir);
  for (const name of ['README.md', 'design.md', 'test-cases.md']) {
    fs.appendFileSync(path.join(dir, name), '\n<!-- 指纹回归 -->\n');
    assert.notEqual(refine.docsFingerprint(dir), fp0, `${name} 变更应改变指纹`);
  }
  // REQ-20260908-021：演示文件纳入指纹——markdown 不动，只写 ui-demo.html 指纹即变化（含 缺失→存在→改内容）
  const fp1 = refine.docsFingerprint(dir);
  fs.writeFileSync(path.join(dir, 'ui-demo.html'), '<!doctype html><html><body>a</body></html>');
  assert.notEqual(refine.docsFingerprint(dir), fp1, 'ui-demo.html 新增应改变指纹');
  const fp2 = refine.docsFingerprint(dir);
  fs.writeFileSync(path.join(dir, 'ui-demo.html'), '<!doctype html><html><body>b</body></html>');
  assert.notEqual(refine.docsFingerprint(dir), fp2, 'ui-demo.html 内容变更应改变指纹');
  const { batch } = refine.createRefineBatch(dataDir, { ids: [req.id], mode: 'zcode', projectRoot: root });
  const got = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  fs.writeFileSync(path.join(got.itemDir, 'README.md'), '# r1\n\n## 描述\n补全后的说明文字长度超过阈值三十个字符以上，符合完整判定。\n\n## 验收标准\n\n- [x] 可记账\n');
  const fin = refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '仅补 README 也可记完成' });
  assert.equal(fin.receipt.result, 'done', '仅改 README → 指纹变化 → done 通过核验');
});

t('S12（REQ-20260908-021）只新增/修改 ui-demo.html（三份 markdown 不动）的 done 回执通过「真实变更」核验', () => {
  const { root, dataDir } = mkProject();
  const req = core.createItem(dataDir, { type: 'requirement', title: 'r1' });
  accept(dataDir, req.id);
  const { batch } = refine.createRefineBatch(dataDir, { ids: [req.id], mode: 'zcode', projectRoot: root });
  const got = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  // worker 只创建约定的 ui-demo.html，markdown 一字未动（演示文件已在指纹覆盖内）
  fs.writeFileSync(path.join(got.itemDir, 'ui-demo.html'), '<!doctype html>\n<html><body><button>筛选</button></body></html>\n');
  const fin = refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '仅新增 ui-demo.html 演示' });
  assert.equal(fin.receipt.result, 'done', '只改演示文件 → 指纹变化 → done 通过核验');
});

// BUG-20260908-017：涉及 UI 的 Bug 与需求同等对待——界面展示节 + ui-demo.html 演示三查同需求侧口径
t('S13（BUG-20260908-017）涉及 UI 的 Bug：界面展示启发式 / 占位节 / 演示三查 / 齐备完整 / 误判兜底', () => {
  const phen = '点击保存按钮后弹窗布局错乱，错误提示遮挡输入框，页面其余部分不可交互。';
  const { dataDir } = mkProject();
  const bug = core.createItem(dataDir, { type: 'bug', title: 'b' });
  const dir = core.resolveItemDir(dataDir, bug.id).dir;
  const demoPath = path.join(dir, 'ui-demo.html');
  const bugReadme = (demoBody) => `# b

## 现象
${phen}

## 复现步骤

1. 打开详情页
2. 点击保存按钮

## 期望行为
弹窗布局正常，错误提示不再遮挡输入框。

## 验收说明

- 修复后可按上述步骤复现验证。

## 界面展示

${demoBody}
`;
  // 1) 现象命中 UI 关键词且无「界面展示」节 → 涉及 UI 需界面展示
  fs.writeFileSync(path.join(dir, 'README.md'), bugReadme('').replace(/\n## 界面展示\n\n[\s\S]*$/, '\n'));
  let b = refine.analyzeItemDocs(dir, 'bug');
  assert.ok(b.reasons.includes('涉及 UI 需界面展示'), `Bug 现象命中关键词应触发（得到 ${b.reasons}）`);
  assert.ok(!b.reasons.includes('界面展示待补充'), `无节时不报占位原因（得到 ${b.reasons}）`);
  assert.ok(!b.reasons.some((x) => x.includes('ui-demo.html')), `无节时不叠加演示三查原因（得到 ${b.reasons}）`);
  // 2) 节存在但仅「（待补充）」占位 → 界面展示待补充（不叠加演示三查原因）
  fs.writeFileSync(path.join(dir, 'README.md'), bugReadme('（待补充）'));
  b = refine.analyzeItemDocs(dir, 'bug');
  assert.ok(b.reasons.includes('界面展示待补充'), `占位节应报「界面展示待补充」（得到 ${b.reasons}）`);
  assert.ok(!b.reasons.includes('涉及 UI 需界面展示'), '已有节不再报缺失节原因');
  assert.ok(!b.reasons.some((x) => x.includes('ui-demo.html')), '占位节不叠加演示三查原因');
  // 3) 节有实质内容但条目目录缺 ui-demo.html → 缺演示文件
  fs.writeFileSync(path.join(dir, 'README.md'), bugReadme(`+--------------------------+
| 保存弹窗：标题 · 错误提示 |
+--------------------------+
| 表单（输入框可聚焦）     |
+--------------------------+`));
  b = refine.analyzeItemDocs(dir, 'bug');
  assert.ok(b.reasons.includes('涉及 UI 缺 ui-demo.html 演示'), `缺演示文件应报（得到 ${b.reasons}）`);
  // 4) ui-demo.html 存在但为空 / 仅 HTML 注释占位 → 演示待补充
  for (const placeholder of ['', '\n<!-- 待补充 -->\n']) {
    fs.writeFileSync(demoPath, placeholder);
    b = refine.analyzeItemDocs(dir, 'bug');
    assert.ok(b.reasons.includes('ui-demo.html 演示待补充'), `占位演示文件应报（得到 ${b.reasons}）`);
  }
  // 5) 演示文件有效但界面展示节未链接 → 节须链接
  fs.writeFileSync(demoPath, '<!doctype html>\n<html><body>缺陷/修复对照演示</body></html>\n');
  b = refine.analyzeItemDocs(dir, 'bug');
  assert.ok(b.reasons.includes('界面展示节未链接 ./ui-demo.html'), `节未链接演示应报（得到 ${b.reasons}）`);
  // 6) 节链接 + 演示文件齐备（含缺陷现象与期望修复后状态对照说明）→ complete
  fs.writeFileSync(path.join(dir, 'README.md'), bugReadme(`- [交互演示（ui-demo.html）](./ui-demo.html)
- 对照：开关切换「缺陷现象 / 期望修复后状态」——缺陷态弹窗布局错乱、提示遮挡输入框；修复态布局正常、提示不遮挡。`));
  b = refine.analyzeItemDocs(dir, 'bug');
  assert.equal(b.complete, true, `链接与演示齐备应判完整（得到 ${b.reasons}）`);
  // 7) 现象不含关键词但期望行为节描述了界面期望 → 同样触发启发式
  fs.writeFileSync(path.join(dir, 'README.md'), `# b

## 现象
保存成功后未给出任何反馈，无法判断结果。

## 复现步骤

1. 触发保存

## 期望行为
保存成功后页面顶部出现成功提示条。

## 验收说明

- 修复后可按上述步骤复现验证。
`);
  b = refine.analyzeItemDocs(dir, 'bug');
  assert.ok(b.reasons.includes('涉及 UI 需界面展示'), `期望行为节命中「页面」应触发（得到 ${b.reasons}）`);
  // 8) 启发式误判兜底：现象提到按钮但缺陷实为数据层，节内写明不涉及界面改动即有效，不做演示三查
  fs.rmSync(demoPath);
  fs.writeFileSync(path.join(dir, 'README.md'), `# b

## 现象
点击导出按钮后导出的文件内容为空，其余表现均正常。

## 复现步骤

1. 点击导出按钮

## 期望行为
导出文件包含完整数据。

## 验收说明

- 修复后可按上述步骤复现验证。

## 界面展示

本缺陷不涉及界面改动，无需界面示意。
`);
  b = refine.analyzeItemDocs(dir, 'bug');
  assert.equal(b.complete, true, `误判兜底说明应视为有效内容（得到 ${b.reasons}）`);
});

t('P1 提示词口径（REQ-20260908-021）：ui-demo.html 交互演示 + 质量门槛 + 约束允许另建演示文件；旧 ASCII 必需口径不再出现', () => {
  const head = refine.buildRefinePrompt({ projectRoot: '/tmp/proj', batchId: 'RFB-20260908-001' });
  const worker = refine.buildRefineWorkerPrompt({
    item: { id: 'REQ-20260908-001', title: '示例', itemDir: '/tmp/proj/docs/agent-team-board/requirements/REQ-20260908-001', reasons: [] },
    projectRoot: '/tmp/proj',
    runId: 'run-20260908-000000-0000',
  });
  for (const [name, p] of [['主调度', head], ['worker', worker]]) {
    assert.ok(p.includes('只补 README'), `${name}提示词应说明需求只补 README`);
    assert.ok(p.includes('界面展示'), `${name}提示词应含界面展示要求`);
    assert.ok(p.includes('ui-demo.html'), `${name}提示词应含 ui-demo.html 演示口径`);
    // 演示文件质量门槛：单文件 / 内联 / 无外网依赖 / 无构建步骤 / 浏览器直接打开可交互
    assert.ok(p.includes('单文件'), `${name}提示词应含「单文件」门槛`);
    assert.ok(p.includes('内联'), `${name}提示词应含「内联」门槛`);
    assert.ok(p.includes('无外网依赖'), `${name}提示词应含「无外网依赖」门槛`);
    assert.ok(p.includes('无构建步骤'), `${name}提示词应含「无构建步骤」门槛`);
    assert.ok(p.includes('浏览器直接打开可交互'), `${name}提示词应含浏览器直接打开可交互门槛`);
    assert.ok(p.includes('状态反馈'), `${name}提示词应覆盖布局/交互/状态反馈三要素`);
    assert.ok(p.includes('可选补充'), `${name}提示词应说明 ASCII 线框降为可选补充`);
    assert.ok(!p.includes('README（描述+验收标准）/design/test-cases'), `${name}提示词旧三件套口径不得再出现`);
    assert.ok(!p.includes('ASCII 线框 / 结构示意，缺节或占位会被判待完善'), `${name}提示词旧 ASCII 必需口径不得再出现`);
    assert.ok(p.includes('design/test-cases 留待开发'), `${name}提示词应说明 design/test-cases 留待开发阶段`);
    assert.ok(p.includes('现象/复现步骤/期望行为/验收说明'), `${name}提示词 Bug 半句保留`);
    // BUG-20260908-017：涉及 UI 的 Bug 同样须提供 UI 演示，并建议对照缺陷现象与期望修复后状态
    assert.ok(p.includes('涉及 UI 的 Bug'), `${name}提示词应说明涉及 UI 的 Bug 同样须 UI 演示`);
    assert.ok(p.includes('缺陷现象与期望修复后状态'), `${name}提示词应建议 Bug 演示对照缺陷与修复后状态`);
    // 约束：允许另建约定的 ui-demo.html（需求与 Bug 同口径），其余禁令保留
    assert.ok(p.includes('可另建约定的 ui-demo.html'), `${name}提示词约束应允许另建约定的 ui-demo.html`);
    assert.ok(p.includes('需求或 Bug'), `${name}提示词约束的演示文件许可应覆盖需求与 Bug`);
    assert.ok(p.includes('不要修改业务源码'), `${name}提示词禁令：业务源码`);
    assert.ok(p.includes('不要 git commit'), `${name}提示词禁令：git commit`);
    assert.ok(p.includes('test-report.md'), `${name}提示词禁令：test-report.md`);
  }
  assert.ok(head.includes('保持 accepted'), '主调度提示词约束保持已接受状态');
});

t('S10（回归）存量冻结批次原因快照不重算：旧口径原因原样透出，收尾与核对行为不变', () => {
  const { root, dataDir } = mkProject();
  const req = core.createItem(dataDir, { type: 'requirement', title: 'r1' });
  accept(dataDir, req.id);
  const { batch } = refine.createRefineBatch(dataDir, { ids: [req.id], mode: 'zcode', projectRoot: root });
  // 模拟创建于旧口径（REQ-20260908-015 之前）的已冻结批次：直接改账本里的原因快照
  //（ids 显式种子落账，保证 candidates[0] 存在——REQ-20260913-003 起缺省建轮不冻结候选）
  const bfile = path.join(dataDir, 'refine', 'batches', batch.batchId, 'batch.json');
  const raw = JSON.parse(fs.readFileSync(bfile, 'utf8'));
  raw.candidates[0].reasons = ['README 描述待补充', 'design 仅模板', 'test-cases 无用例'];
  fs.writeFileSync(bfile, JSON.stringify(raw));
  const got = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
  assert.equal(got.itemId, req.id);
  assert.deepEqual(got.reasons, ['README 描述待补充', 'design 仅模板', 'test-cases 无用例'], '领取透出冻结快照，不按新口径重算');
  fs.writeFileSync(path.join(got.itemDir, 'README.md'), '# r1\n\n## 描述\n补全后的说明文字长度超过阈值三十个字符以上，符合完整判定。\n\n## 验收标准\n\n- [x] 可记账\n');
  const fin = refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '快照口径不受影响' });
  assert.equal(fin.receipt.result, 'done');
  const ck = refine.checkRefineBatch(dataDir, batch.batchId);
  assert.equal(ck.counts.done, 1);
  assert.equal(ck.counts.remaining, 0);
});

t('R13（BUG-20260908-015）终态批次暂停幂等拒绝：abort 后 pause(true)/(false) 字段全不变；正常 finished 批次同样不复活', () => {
  const { root, dataDir } = mkProject();
  const x = core.createItem(dataDir, { type: 'requirement', title: '终止后暂停' });
  accept(dataDir, x.id);
  const { batch } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  refine.abortRefineBatch(dataDir, batch.batchId);
  const before = refine.getRefineBatch(dataDir, batch.batchId);
  assert.equal(before.status, 'finished');
  assert.equal(before.abortRequested, true);
  assert.equal(before.aborted, true);

  // abort 后 pause(true)：幂等拒绝——status/abortRequested/aborted/pauseRequested 与调用前一致
  const r1 = refine.pauseRefineBatch(dataDir, batch.batchId, true);
  const a1 = refine.getRefineBatch(dataDir, batch.batchId);
  assert.equal(a1.status, 'finished', 'abort 后 pause(true) 不得复活为 paused');
  for (const k of ['status', 'abortRequested', 'aborted', 'pauseRequested']) {
    assert.equal(a1[k], before[k], `${k} 应保持调用前的值`);
  }
  assert.ok(r1.status === 'finished', '返回值亦保持终态');

  // abort 后 pause(false)（恢复方向）：同样不得把 finished 翻回 running/prepared
  refine.pauseRefineBatch(dataDir, batch.batchId, false);
  const a2 = refine.getRefineBatch(dataDir, batch.batchId);
  for (const k of ['status', 'abortRequested', 'aborted', 'pauseRequested']) {
    assert.equal(a2[k], before[k], `恢复方向 ${k} 应保持调用前的值`);
  }

  // 终态批次不得因暂停请求重新进入未结束队列/队首
  assert.deepEqual(refine.unfinishedRefineBatches(dataDir).map((b) => b.batchId), [], '终态批次不入未结束队列');
  assert.equal(refine.queueHeadRefineBatch(dataDir).batchId === batch.batchId
    && refine.unfinishedRefineBatches(dataDir).length > 0, false, '队首不得是复活的终态批次');

  // 非终止的正常 finished 批次（全部回执收尾）同样拒绝暂停复活
  const y = core.createItem(dataDir, { type: 'requirement', title: '正常结束' });
  accept(dataDir, y.id);
  const { batch: b2 } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  // 被终止批次回置未完善的 x 也重新入了 b2 候选：逐项补全直至批次自然收尾
  let got = refine.nextRefineItem(dataDir, b2.batchId, { owner: 'w1' });
  while (got && got.itemId) {
    fs.writeFileSync(path.join(got.itemDir, 'README.md'), '# r\n\n## 描述\n补全后的说明文字长度超过阈值三十个字符以上，可判定为真实变更。\n');
    refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: '补全' });
    const nx = refine.nextRefineItem(dataDir, b2.batchId, { owner: 'w1' });
    if (!nx || nx.stop) break;
    got = nx;
  }
  assert.equal(refine.getRefineBatch(dataDir, b2.batchId).status, 'finished', '全部回执后批次应自然收尾');
  refine.pauseRefineBatch(dataDir, b2.batchId, true);
  const a3 = refine.getRefineBatch(dataDir, b2.batchId);
  assert.equal(a3.status, 'finished', '正常 finished 批次 pause(true) 同样不得复活为 paused');
  assert.equal(a3.pauseRequested, false, '不得写入 pauseRequested');

  // 正常批次的暂停/恢复回归：不受终态守卫影响（R9 已覆盖，此处快速复核）
  const z = core.createItem(dataDir, { type: 'requirement', title: '暂停回归' });
  accept(dataDir, z.id);
  const { batch: b3 } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  refine.pauseRefineBatch(dataDir, b3.batchId, true);
  assert.equal(refine.getRefineBatch(dataDir, b3.batchId).status, 'paused', '运行前暂停正常生效');
  assert.equal(refine.nextRefineItem(dataDir, b3.batchId, { owner: 'w9' }).stop, 'paused');
  refine.pauseRefineBatch(dataDir, b3.batchId, false);
  assert.ok(refine.nextRefineItem(dataDir, b3.batchId, { owner: 'w9' }).itemId, '恢复后可继续领取');
});

// BUG-20260908-018：refineSummary 首屏 5 条的性能口径保留，但必须带 recordsTotal（总数），
// 不得让面板出现「计数 18、列表只有 5 且无任何入口」的静默截断
t('R18（BUG-20260908-018）refineSummary 返回 recordsTotal：records 首屏 5 条、总数不截断；分页接口可取余下', () => {
  const { root, dataDir } = mkProject();
  for (let i = 1; i <= 6; i++) {
    const x = core.createItem(dataDir, { type: 'requirement', title: `r${i}` });
    accept(dataDir, x.id);
  }
  const { batch } = refine.createRefineBatch(dataDir, { mode: 'zcode', projectRoot: root });
  for (let i = 1; i <= 6; i++) {
    const got = refine.nextRefineItem(dataDir, batch.batchId, { owner: 'w1' });
    fs.writeFileSync(path.join(got.itemDir, 'README.md'), `# r${i}\n\n## 描述\n补全后的完整说明，足够长且超过阈值三十个字符以上。\n`);
    refine.finishRefineRun(dataDir, got.runId, { result: 'done', summary: `第 ${i} 项补全` });
  }
  const s = refine.refineSummary(dataDir, batch.batchId);
  assert.equal(s.records.length, 5, '首屏记录保持 5 条（性能口径不回归）');
  assert.equal(s.recordsTotal, 6, '摘要须返回批次 run 总数 recordsTotal（不得静默截断）');
  const rest = refine.listRefineRuns(dataDir, batch.batchId, { offset: 5, limit: 10 });
  assert.equal(rest.total, 6, '分页接口 total 与批次 run 数一致');
  assert.equal(rest.records.length, 1, '分页接口 offset=5 可取余下 1 条');
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
