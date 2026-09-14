#!/usr/bin/env node
// REQ-20260902-001 SKILL 触发描述收窄 —— 静态契约测试
// 用法：node scripts/tests/skill-desc.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const skill = fs.readFileSync(path.join(pluginRoot, 'skills', 'agent-team-board', 'SKILL.md'), 'utf8');

// 提取 frontmatter description
const m = skill.match(/^---\n([\s\S]*?)\n---/);
assert.ok(m, 'SKILL.md 应有 frontmatter');
const dm = m[1].match(/^description:\s*(.+)$/m);
assert.ok(dm, 'frontmatter 应有 description');
const desc = dm[1];

let failed = 0;
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('S1 强信号完整保留', () => {
  for (const sig of ['/req', '/bug', '/dev', '/board', 'atb', 'agent-team-board', 'Status Board', 'REQ-', 'BUG-']) {
    assert.ok(desc.includes(sig), `强信号缺失：${sig}`);
  }
});

t('S2 泛化触发词已移除', () => {
  // 独立泛化词（含「提需求」「开发某个需求」等组合；REQ-/BUG- 编号格式中的 BUG- 不算泛化词）
  const banned = [/提需求/, /缺陷/, /认领/, /状态流转/, /submitted/, /accepted/, /in-progress/, /done/, /开发某个需求/, /待对齐/];
  for (const re of banned) {
    assert.ok(!re.test(desc), `泛化词残留：${re}`);
  }
  // 「需求」不得单独出现（编号格式 REQ- 除外）
  assert.ok(!/需求/.test(desc), '泛化词残留：需求');
});

t('S3 仍说明用途（一句话定位 + 长度合理）', () => {
  assert.ok(desc.length >= 30, '描述过短，不足以说明用途');
  assert.ok(desc.length <= 300, `描述过长（${desc.length} 字符）`);
});

t('S4 正文与命令入口未受影响', () => {
  assert.ok(skill.includes('## 状态机与铁律'), '正文结构保留');
  assert.ok(skill.includes('## CLI 速查'), 'CLI 章节保留');
  assert.ok(skill.includes('## TDD 开发流程'), 'TDD 流程保留');
  const devCmd = fs.readFileSync(path.join(pluginRoot, 'commands', 'dev.md'), 'utf8');
  assert.ok(devCmd.includes('skills: agent-team-board'), '命令入口引用保留');
});

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
