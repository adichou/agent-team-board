#!/usr/bin/env node
// REQ-20260914-003 优化讨论生成的提示词 —— 启动/继续提示词追加「按需更新与自动提交」约定测试
// 覆盖 test-cases.md 的 P1~P7（既有章节保留为快照式断言；宽窄屏与深浅色为人工浏览器实测，不在本文件）。
// 用法：node scripts/tests/discussion-prompt-commit-20260914-003.test.mjs

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
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-disc-prompt-commit-')));
  core.initData(root);
  const dataDir = core.dataDirFrom(root);
  return { root, dataDir };
}

/* ================= 新约定内容（P1~P3） ================= */

t('P1 启动/继续提示词均追加「按需更新与自动提交」段：按需更新文件 + 自动 git 提交（只 commit 不 push）', () => {
  const { dataDir } = mkProject();
  const d = oncall.createDiscussion(dataDir, { title: '提交约定', background: '背景', by: 'board' });
  const sp = oncall.buildStartPrompt(dataDir, d.id);
  const cp = oncall.buildContinuePrompt(dataDir, d.id);
  for (const [name, p] of [['启动', sp], ['继续', cp]]) {
    assert.ok(p.includes('按需更新与自动提交'), `${name}提示词应含新段落标题`);
    assert.ok(p.includes('每轮回答后检查'), `${name}提示词应说明每轮回答后检查`);
    assert.match(p, /按需更新文件，更新完成后自动执行 git 提交/, `${name}提示词应要求更新后自动提交`);
    assert.ok(p.includes('只 commit，不 push'), `${name}提示词应限定只 commit 不 push`);
  }
});

t('P2 commit 消息硬性要求：体现讨论单号 + 修改摘要，格式沿用「类型: 摘要 单号」', () => {
  const { dataDir } = mkProject();
  const d = oncall.createDiscussion(dataDir, { title: '提交约定', by: 'board' });
  for (const [name, p] of [
    ['启动', oncall.buildStartPrompt(dataDir, d.id)],
    ['继续', oncall.buildContinuePrompt(dataDir, d.id)],
  ]) {
    assert.ok(p.includes('commit 消息必须体现讨论单号'), `${name}提示词应硬性要求单号`);
    assert.ok(p.includes(d.id), `${name}提示词段落应带实际讨论单号 ${d.id}`);
    assert.match(p, /简单摘要|简要摘要/, `${name}提示词应要求修改摘要`);
    assert.ok(p.includes('类型: 摘要 单号'), `${name}提示词应沿用项目自动提交口径`);
  }
});

t('P3 回答内容展示 commit 消息（建议含提交号）；无文件更新明示无修改、不产生空提交', () => {
  const { dataDir } = mkProject();
  const d = oncall.createDiscussion(dataDir, { title: '提交约定', by: 'board' });
  for (const [name, p] of [
    ['启动', oncall.buildStartPrompt(dataDir, d.id)],
    ['继续', oncall.buildContinuePrompt(dataDir, d.id)],
  ]) {
    assert.ok(p.includes('回答内容中要显示本次 commit 消息'), `${name}提示词应要求回答展示 commit 消息`);
    assert.ok(p.includes('提交号'), `${name}提示词应建议含提交号`);
    assert.match(p, /本轮无文件更新时[^\n]*明示无修改/, `${name}提示词应要求明示无修改`);
    assert.ok(p.includes('不产生空提交'), `${name}提示词应禁止空提交`);
  }
});

/* ================= 既有章节保留（P4） ================= */

t('P4 启动提示词既有章节逐条保留无删改（上下文读取/讨论约定/逐轮保存/纪要维护）', () => {
  const { dataDir } = mkProject();
  const d = oncall.createDiscussion(dataDir, { title: '提交约定', background: '背景Y', by: 'board' });
  const sp = oncall.buildStartPrompt(dataDir, d.id);
  for (const line of [
    '开始前（上下文读取）：',
    '- 已有纪要或轮次时先读纪要与近期轮次，按需再追溯更早原文；新会话不要仅凭聊天记忆接续。',
    '讨论约定：',
    '- 讨论不强制绑定需求或说明文档，可读项目代码与文档辅助判断；',
    '- 讨论期间不修改代码、不创建或修改需求/Bug 条目、不改变看板状态；',
    '- 区分「已确认共识」「模型建议与取舍」「未决问题」，不要把未确认的建议写成共识。',
    '逐轮保存约定（每轮必须执行，无需等待任何收尾指令）：',
    '- 一轮 = 一次用户输入（问题/补充/纠正/确认均算一轮）+ 你的完整回复；工具调用与进度播报不单独计轮；',
    '纪要维护（每轮检查，按需更新）：',
    '- 分节：讨论背景 / 已确认共识 / 建议与取舍 / 未决问题 / 后续行动，逐条注明支撑轮次（如 R0003）；',
  ]) {
    assert.ok(sp.includes(line), `启动提示词既有行被删改：${line}`);
  }
  assert.ok(sp.includes(`disc round ${d.id}`) && sp.includes(`disc minutes ${d.id}`), '逐轮保存与纪要统一入口命令保留');
});

t('P4 继续提示词既有章节逐条保留无删改（接续步骤/文档位置/约束）', () => {
  const { dataDir } = mkProject();
  const d = oncall.createDiscussion(dataDir, { title: '提交约定', by: 'board' });
  const cp = oncall.buildContinuePrompt(dataDir, d.id);
  for (const line of [
    '接续步骤：',
    '   讨论过长时先读纪要与近期轮次，按需再追溯更早原文；不要仅凭聊天记忆接续。',
    '   保存成功（命令输出已保存第 N 轮）才向用户确认；失败明确说明未保存及原因，同 key 重试不产生重复轮次。',
    '文档位置：',
    '约束：只写入本讨论目录，不串其他项目或讨论；不修改代码、不创建或修改需求/Bug 条目、不改变看板状态。',
  ]) {
    assert.ok(cp.includes(line), `继续提示词既有行被删改：${line}`);
  }
});

/* ================= 边界与兼容（P5~P7） ================= */

t('P5 边界保护保留：仅放开文档/配置类文件、业务代码不改；看板状态/条目/atb disc 入口不动', () => {
  const { dataDir } = mkProject();
  const d = oncall.createDiscussion(dataDir, { title: '提交约定', by: 'board' });
  for (const [name, p] of [
    ['启动', oncall.buildStartPrompt(dataDir, d.id)],
    ['继续', oncall.buildContinuePrompt(dataDir, d.id)],
  ]) {
    assert.match(p, /文档、配置类文件/, `${name}提示词应限定放开的文件范围`);
    assert.ok(p.includes('业务代码'), `${name}提示词应仍禁改业务代码`);
    assert.match(p, /不改变看板状态|不改看板状态/, `${name}提示词应保留看板状态保护`);
    assert.match(p, /不创建或修改需求\/Bug 条目/, `${name}提示词应保留条目保护`);
    assert.ok(p.includes('atb disc round') && p.includes('atb disc minutes'), `${name}提示词应保留统一入口`);
  }
});

t('P6 整理结论与收尾提示词不追加该约定，既有内容保持不变', () => {
  const { dataDir } = mkProject();
  const d = oncall.createDiscussion(dataDir, { title: '提交约定', by: 'board' });
  const op = oncall.buildOrganizePrompt(dataDir, d.id);
  const fp = oncall.buildFinishPrompt(dataDir, d.id);
  for (const [name, p] of [['整理结论', op], ['收尾', fp]]) {
    assert.ok(!p.includes('按需更新与自动提交'), `${name}提示词不追加新约定（待确认项默认不纳入）`);
    assert.ok(!p.includes('commit 消息必须体现讨论单号'), `${name}提示词不含单号提交要求`);
    assert.ok(!p.includes('只 commit，不 push'), `${name}提示词不含自动提交口径`);
  }
  assert.ok(op.includes('不终止讨论') && op.includes('不自动创建或接受条目'), '整理结论既有内容保持');
  assert.ok(fp.includes('发布标记') && fp.includes('不要直接修改需求/Bug 条目'), '收尾既有内容保持');
});

t('P7 看板侧生成不受影响：full 视图提示词即带新约定；无截图讨论不带 attachments 字样', () => {
  const { dataDir } = mkProject();
  const d = oncall.createDiscussion(dataDir, { title: '提交约定', background: '背景', by: 'board' });
  const full = oncall.discussionFull(dataDir, d.id);
  assert.ok(full.startPrompt.includes('按需更新与自动提交'), '创建即带新约定的启动提示词');
  assert.ok(full.continuePrompt.includes('按需更新与自动提交'), '继续讨论提示词带新约定（复制入口即得）');
  assert.ok(!full.startPrompt.includes('attachments'), '无截图讨论的启动提示词不带截图位置行');
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
