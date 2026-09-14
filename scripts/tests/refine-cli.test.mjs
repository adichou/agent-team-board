#!/usr/bin/env node
// REQ-20260907-003 需求完善 —— CLI 端到端测试（R10）
// 覆盖：refine create → next →（补文档）→ done → check 全链路；--json 机器可读；fail/release 分支
// 用法：node scripts/tests/refine-cli.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ATB = path.join(pluginRoot, 'scripts', 'atb.mjs');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function atb(args, cwd) {
  const r = spawnSync(process.execPath, [ATB, ...args, '--dir', cwd], { encoding: 'utf8', timeout: 30_000 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function mkProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-refine-cli-')));
  core.initData(root);
  return root;
}

t('R10 CLI 全链路：create（含提示词）→ next → 补文档 → done → check；--json 可解析', () => {
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  const req = core.createItem(dataDir, { type: 'requirement', title: '补全我' });
  const bug = core.createItem(dataDir, { type: 'bug', title: 'bug 也补' });
  // REQ-20260908-020：候选 = 已接受未完善；创建前人工接受
  for (const x of [req, bug]) core.setStatus(dataDir, x.id, 'accepted', { by: 'human' });

  // create：文本输出含提示词与批次号（REQ-20260910-027：无 --dev；遗留传参 die 明确提示）
  let r = atb(['refine', 'create'], root);
  assert.equal(r.code, 0, `create 应成功（${r.err}）`);
  assert.match(r.out, /RFB-\d{8}-001/);
  assert.match(r.out, /atb refine next/);
  const bad = atb(['refine', 'create', '--dev', '李四'], root);
  assert.notEqual(bad.code, 0, '--dev 应被拒绝');
  assert.ok(bad.err.includes('开发人员设置已移除'), 'die 信息（stderr）应说明开发人员设置已移除');
  // REQ-20260913-003：未结束轮内重复创建被拒（不幂等返回、不排队）
  r = atb(['refine', 'create'], root);
  assert.notEqual(r.code, 0, '重复创建应被拒');
  assert.ok((r.err + r.out).includes('已有进行中的完善任务'), '应说明重复启动被拒');

  // next --json：领取第一项
  const nx = JSON.parse(atb(['refine', 'next', '--by', 'zcode-refine-001-1', '--json'], root).out.split('\n').filter(Boolean).pop());
  assert.equal(nx.itemId, req.id);
  assert.match(nx.runId, /^run-/);
  assert.ok(nx.itemDir.endsWith(req.id));

  // 未收尾再领 → 非零退出带原因
  r = atb(['refine', 'next', '--by', 'zcode-refine-001-2'], root);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /未收尾/);

  // 不改文档直接 done → 拒绝
  r = atb(['refine', 'done', nx.runId, '--summary', '没改文档'], root);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /未检测到补全变更/);

  // 补全文档后 done 成功
  fs.writeFileSync(path.join(nx.itemDir, 'README.md'), '# x\n\n## 描述\nCLI 链路补全的说明文字，长度超过三十个字符的阈值要求。\n\n## 验收标准\n\n- [x] 可跑通\n');
  r = atb(['refine', 'done', nx.runId, '--summary', '补全了描述与验收标准', '--by', 'zcode-refine-001-1'], root);
  assert.equal(r.code, 0, `done 应成功（${r.err}）`);
  assert.match(r.out, /"result":"done"/);
  // REQ-20260908-014：回执在主调度会话可见单号+标题
  assert.match(r.out, /"itemId":"REQ-\d{8}-\d{3}"/);
  assert.match(r.out, /"title":"补全我"/);

  // check：还有一项待处理 → continue；领第二项用 fail 收尾
  let ck = JSON.parse(atb(['refine', 'check', '--json'], root).out.split('\n').filter(Boolean).pop());
  assert.equal(ck.nextAction, 'continue');
  assert.equal(ck.counts.remaining, 1);
  const nx2 = JSON.parse(atb(['refine', 'next', '--by', 'zcode-refine-001-2', '--json'], root).out.split('\n').filter(Boolean).pop());
  r = atb(['refine', 'fail', nx2.runId, '--reason', '信息不足：复现环境无法确认'], root);
  assert.equal(r.code, 0, `fail 应成功（${r.err}）`);
  assert.match(r.out, /"title":"bug 也补"/, 'fail 回执也应带条目标题');
  ck = JSON.parse(atb(['refine', 'check', '--json'], root).out.split('\n').filter(Boolean).pop());
  assert.equal(ck.nextAction, 'stop');
  assert.equal(ck.counts.done, 1);
  assert.equal(ck.counts.failed, 1);

  // records / summary 文本输出
  r = atb(['refine', 'records'], root);
  assert.equal(r.code, 0);
  assert.match(r.out, /done/);
  assert.match(r.out, /failed/);
  r = atb(['refine', 'summary'], root);
  assert.equal(r.code, 0);
  // REQ-20260913-003：摘要不再透出批次号，按本轮执行状态输出
  assert.match(r.out, /完善任务 \[/);
  assert.ok(!r.out.includes('undefined'), '不得出现 undefined 批次号');
});

t('R10b CLI release 与 pause：认领冲突换单释放互斥；暂停后 next 提示 stop', () => {
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  for (const title of ['r1', 'r2']) {
    const x = core.createItem(dataDir, { type: 'requirement', title });
    core.setStatus(dataDir, x.id, 'accepted', { by: 'human' });
  }
  atb(['refine', 'create'], root);
  const nx = JSON.parse(atb(['refine', 'next', '--by', 'w1', '--json'], root).out.split('\n').filter(Boolean).pop());
  let r = atb(['refine', 'release', nx.runId, '--reason', '认领冲突'], root);
  assert.equal(r.code, 0, `release 应成功（${r.err}）`);
  r = atb(['refine', 'pause'], root);
  assert.equal(r.code, 0);
  r = atb(['refine', 'next', '--by', 'w2'], root);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /暂停/);
  atb(['refine', 'pause', '--off'], root);
  const nx2 = JSON.parse(atb(['refine', 'next', '--by', 'w2', '--json'], root).out.split('\n').filter(Boolean).pop());
  assert.ok(nx2.itemId);
  // 无此 runId 的 done → 报错
  r = atb(['refine', 'done', 'run-00000000-000000-0000', '--summary', 'x'], root);
  assert.notEqual(r.code, 0);
});

t('R10c（REQ-20260908-020）待接受单不入完善候选；已接受未完善可领取，next 下一步行口径不变', () => {
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  // 待接受单（README 无论完整与否）不是候选：create 无候选报错
  const ok = core.createItem(dataDir, { type: 'requirement', title: '只补 README' });
  fs.writeFileSync(path.join(core.resolveItemDir(dataDir, ok.id).dir, 'README.md'),
    '# x\n\n## 描述\n调整账本冻结口径与出局落账顺序，全部改动位于数据层完成，说明长度超过三十个字符。\n\n## 验收标准\n\n- [x] 判定只看 README\n');
  let r = atb(['refine', 'create'], root);
  assert.notEqual(r.code, 0, '无已接受单应无可完善候选');
  assert.match(r.err, /没有可完善候选/);
  // 领取一个已接受未完善需求：下一步指引行与新口径一致
  const req2 = core.createItem(dataDir, { type: 'requirement', title: '还要补' });
  core.setStatus(dataDir, req2.id, 'accepted', { by: 'human' });
  r = atb(['refine', 'create'], root);
  assert.equal(r.code, 0, `create 应成功（${r.err}）`);
  r = atb(['refine', 'next', '--by', 'w1'], root);
  assert.equal(r.code, 0, `next 应成功（${r.err}）`);
  assert.match(r.out, new RegExp(req2.id), '应发放剩余不完整条目');
  assert.match(r.out, /只补 README/, '下一步行应说明需求只补 README');
  assert.match(r.out, /界面展示/, '下一步行应含界面展示口径');
  assert.ok(!/\/design\/test-cases/.test(r.out), '下一步行不再出现补 design/test-cases 的要求');
});

t('R10d（BUG-20260908-015）CLI：已终止/已结束批次 refine pause 报错且批次状态不变；正常批次暂停/恢复不受影响', () => {
  const root = mkProject();
  const dataDir = core.dataDirFrom(root);
  const x = core.createItem(dataDir, { type: 'requirement', title: '终止后CLI暂停' });
  core.setStatus(dataDir, x.id, 'accepted', { by: 'human' });
  const created = JSON.parse(atb(['refine', 'create', '--json'], root).out.split('\n').filter(Boolean).pop());
  const batchId = created.batchId;
  atb(['refine', 'abort', '--batch', batchId], root);

  // 已终止批次暂停：非零退出 + 明确错误，不静默成功
  let r = atb(['refine', 'pause', '--batch', batchId], root);
  assert.notEqual(r.code, 0, '对已终止批次 pause 应失败');
  assert.match(r.err, /不能暂停\/恢复/, `错误信息应说明终态不可暂停（得到：${r.err}）`);
  // 恢复方向同样拒绝
  r = atb(['refine', 'pause', '--batch', batchId, '--off'], root);
  assert.notEqual(r.code, 0, '对已终止批次恢复 pause 应失败');
  // 批次状态不被改动（--json 读取仍是终止终态）
  const sum = JSON.parse(atb(['refine', 'summary', '--batch', batchId, '--json'], root).out.split('\n').filter(Boolean).pop());
  assert.equal(sum.batch.status, 'finished', 'CLI pause 报错后批次保持 finished');
  assert.equal(sum.batch.aborted, true);

  // 正常批次暂停/恢复回归：不受影响
  const y = core.createItem(dataDir, { type: 'requirement', title: '正常CLI暂停' });
  core.setStatus(dataDir, y.id, 'accepted', { by: 'human' });
  const created2 = JSON.parse(atb(['refine', 'create', '--json'], root).out.split('\n').filter(Boolean).pop());
  assert.equal(created2.created, true, '终止后可再启动新一轮');
  r = atb(['refine', 'pause', '--batch', created2.batchId], root);
  assert.equal(r.code, 0, `正常批次 pause 应成功（${r.err}）`);
  r = atb(['refine', 'next', '--by', 'w1'], root);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /暂停/);
  r = atb(['refine', 'pause', '--batch', created2.batchId, '--off'], root);
  assert.equal(r.code, 0, `正常批次恢复应成功（${r.err}）`);
  // 被终止批次回置未完善的 x 也重新入了候选：恢复后能领取到任一待完善项即可
  r = atb(['refine', 'next', '--by', 'w1', '--json'], root);
  assert.equal(r.code, 0, `恢复后 next 应成功（${r.err}）`);
  assert.ok(JSON.parse(r.out.split('\n').filter(Boolean).pop()).itemId, '恢复后应可领取待完善项');
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
