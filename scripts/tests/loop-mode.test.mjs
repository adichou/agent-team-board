#!/usr/bin/env node
// REQ-20260830-003 文档契约测试 —— /dev loop 语义必须完整存在于命令与 skill 文档中。
// 用法：node scripts/tests/loop-mode.test.mjs
// 对应 test-cases.md 的 #1–#7。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const devPath = path.join(root, 'commands', 'dev.md');
const dev = fs.readFileSync(path.join(root, 'commands', 'dev.md'), 'utf8');
const skill = fs.readFileSync(path.join(root, 'skills', 'agent-team-board', 'SKILL.md'), 'utf8');

let failed = 0;
function t(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${e.message}`);
  }
}

t('#1 argument-hint 含 loop', () => assert.match(dev, /argument-hint:.*loop/));
t('#2 循环模式：loop 反复取 planned 直到没有（REQ-20260908-010；dev.md 骨架 + SKILL 细则兜底）', () => {
  assert.match(dev, /循环模式/);
  assert.match(dev, /\/dev loop|参数为 `loop`/);
  assert.match(dev, /直到没有已计划|直到没有 accepted|全部出完/, 'dev.md 或 SKILL 须含终止条件');
  // BUG-20260902-001：dev.md 正文超 token 上限会被 Codex 迁移跳过，硬上限防回归
  const size = fs.statSync(devPath).size;
  assert.ok(size <= 3600, `dev.md 应 ≤3600 字节（Codex 迁移上限），当前 ${size}`);
});
t('#3 跳过规则：认领冲突跳过、单条目失败不中断（dev.md 或 SKILL 兜底）', () => {
  const both = dev + skill;
  assert.match(both, /失败[\s\S]{0,80}(跳过|不中断)/, '失败跳过条款应在 dev.md 或 SKILL');
  assert.match(both, /认领冲突/, '认领冲突处理应被提及');
});
t('#4 循环结束输出总结', () => assert.match(dev, /总结[\s\S]{0,120}(完成|跳过|状态)/));
t('#5 保留 <ID> 与 next 单条目语义', () => {
  assert.match(dev, /argument-hint.*<ID \| next/);
  assert.match(dev, /`next`/);
});
t('#6 铁律不变：不置 accepted/done，submitted 不入选', () => {
  assert.match(dev, /loop[\s\S]{0,200}(accepted|done)[\s\S]{0,120}(不|禁止)/);
  assert.match(dev, /submitted/);
});
t('#7 SKILL.md 调度规则含 loop 且串行认领不变', () => {
  assert.match(skill, /loop/);
  assert.match(skill, /一次会话同一时刻只认领一个条目/);
});

if (failed) {
  console.error(`\n${failed} 个用例失败`);
  process.exit(1);
}
console.log('\n全部通过');
