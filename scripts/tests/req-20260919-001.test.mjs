#!/usr/bin/env node
// REQ-20260919-001 插件改动建议以 PR 回流源仓库 —— SKILL.md 静态契约测试
// 用法：node scripts/tests/req-20260919-001.test.mjs
// 覆盖 test-cases.md R1–R8。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const skill = fs.readFileSync(path.join(pluginRoot, 'skills', 'agent-team-board', 'SKILL.md'), 'utf8');

// 提取「状态机与铁律」节
const sec = skill.match(/^## 状态机与铁律\n([\s\S]*?)\n^## /m);
assert.ok(sec, 'SKILL.md 应有「状态机与铁律」节');
const section = sec[1];

// 提取编号铁律条目（行首 `N. 正文`，整行留档）
const rules = new Map();
for (const m of section.matchAll(/^(\d+)\. (.+)$/gm)) {
  rules.set(Number(m[1]), `${m[1]}. ${m[2]}`);
}
assert.ok(rules.size >= 7, `铁律编号条目应不少于 7 条（实际 ${rules.size}）`);

const rule7 = rules.get(7) || '';

let failed = 0;
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// ---------- R1 落点与编号 ----------

t('R1 新规则为第 7 条、紧随第 6 条认领锁；原 git 提交通道顺延为第 8 条', () => {
  assert.ok(rule7.includes('REQ-20260919-001'), '第 7 条应标注本单编号');
  assert.ok(rule7.includes('回流源仓库'), '第 7 条应为「插件改动建议回流源仓库」规则');
  assert.ok(rules.get(6).includes('插件源码受认领锁保护'), '第 6 条仍为认领锁保护');
  assert.ok(rules.get(6).includes('REQ-20260901-003'), '第 6 条保留源单编号');
  assert.ok(rules.get(8).includes('git 提交通道'), '原第 7 条 git 提交通道顺延为第 8 条');
  assert.ok(rules.get(8).includes('REQ-20260911-009'), 'git 提交通道源单编号保留');
  assert.equal(rules.size, 8, `铁律共 8 条（实际 ${rules.size}）`);
});

// ---------- R2 适用范围 ----------

t('R2 适用范围限定插件缓存场景，对象为插件功能源码', () => {
  assert.ok(rule7.includes('以插件形式'), '应写明「以插件形式」场景限定');
  assert.ok(rule7.includes('为其他项目服务'), '应写明「为其他项目服务」场景限定');
  assert.ok(rule7.includes('插件缓存 git 克隆'), '应写明插件缓存 git 克隆形态');
  assert.ok(rule7.includes('scripts/commands/skills/hooks/manifest'), '对象应涵盖插件功能源码目录');
});

// ---------- R3 PR 回流路径与动机 ----------

t('R3 含 PR 路径、remote 口径与动机（不回流不进上游 / 可能丢失 / 单一事实源）', () => {
  assert.ok(rule7.includes('PR'), '应写明 PR 形式');
  assert.ok(rule7.includes('fork 或特性分支'), '应写明 fork 或特性分支路径');
  assert.ok(rule7.includes('remote'), '地址应以插件缓存克隆 remote 为准');
  assert.ok(rule7.includes('github.com/adichou/agent-team-board'), '应写明当前源仓库地址');
  assert.ok(rule7.includes('上游'), '动机应含不回流无法进入上游');
  assert.ok(rule7.includes('丢失'), '动机应含可能随更新或重装丢失');
  assert.ok(rule7.includes('单一事实源'), '动机应含源仓库保持单一事实源');
});

// ---------- R4 排除源仓库自身开发 ----------

t('R4 显式排除源仓库自身开发：走根 AGENTS.md 看板流程，不经 PR', () => {
  assert.ok(rule7.includes('不适用'), '应显式写明不适用情形');
  assert.ok(rule7.includes('源仓库项目自身') || rule7.includes('源仓库内开发本产品'), '排除对象应为源仓库自身开发');
  assert.ok(rule7.includes('根 AGENTS.md'), '应指向根 AGENTS.md 看板流程');
  for (const step of ['登记', '人工接受', '移入计划', 'claim', 'report']) {
    assert.ok(rule7.includes(step), `看板流程步骤缺失：${step}`);
  }
  assert.ok(/不经\s*\*?\*?PR/.test(rule7), '应写明不经 PR');
});

// ---------- R5 建议口径、无强制手段 ----------

t('R5 建议口径：文本用「建议」，不新增钩子/命令/状态', () => {
  assert.ok(rule7.includes('建议'), '规则应为建议性表述');
  assert.ok(!/必须以 PR|必须经 PR|必须走 PR/.test(rule7), '不得出现强制 PR 表述');
  const hooks = fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8');
  assert.ok(!hooks.includes('PR'), 'hooks.json 不应新增 PR 相关钩子');
  const guard = fs.readFileSync(path.join(pluginRoot, 'scripts', 'state-guard.mjs'), 'utf8');
  assert.ok(!guard.includes('源仓库') && !guard.includes('发起 PR'), 'state-guard 不应新增 PR 强制拦截');
  assert.ok(skill.includes('submitted ──人工──▶ accepted ──人工──▶ planned ──Agent claim──▶ in-progress ──人工──▶ done'),
    '状态机图不变');
  assert.ok(skill.includes('## CLI 速查') && skill.includes('$ATB claim') && skill.includes('$ATB report'),
    'CLI 速查既有命令入口不变');
});

// ---------- R6 未定事实标注待确认 ----------

t('R6 未定事实标注「待确认」：PR 目标分支与插件缓存更新机制', () => {
  assert.ok(/目标分支[^。\n]*待确认/.test(rule7), 'PR 目标分支应标注待确认');
  assert.ok(/更新机制[^。\n]*待确认|待确认[^。\n]*更新机制/.test(rule7), '插件缓存更新机制应标注待确认');
});

// ---------- R7 双入口边界 ----------

t('R7 根 AGENTS.md 不复制规则正文', () => {
  const agents = fs.readFileSync(path.join(pluginRoot, 'AGENTS.md'), 'utf8');
  for (const frag of ['源仓库', '发起 PR', 'PR 形式', 'fork 或特性分支']) {
    assert.ok(!agents.includes(frag), `根 AGENTS.md 不应包含规则正文片段：${frag}`);
  }
});

// ---------- R8 既有铁律 1–6 与常见错误引用回归 ----------

t('R8 铁律 1–6 文案不变；「常见错误」铁律 1/2 引用仍成立', () => {
  const expected = {
    1: '1. **绝不**用 Write/Edit 直接写任何 `agent-team-board/runtime/status/**.json`（条目实时状态）——会被拦截。状态只能通过 `$ATB` 子命令变更。',
    2: '2. **绝不**把条目置为 `accepted`、`planned` 或 `done`（包括 `$ATB status <ID> …`、curl 调 Status Board 的 `/api/item/*/status`）。这三个状态**仅限人工**（planned = 已计划排期，REQ-20260908-010）。',
  };
  for (const [n, text] of Object.entries(expected)) {
    assert.equal(rules.get(Number(n)), text, `铁律 ${n} 文案不变`);
  }
  assert.ok(rules.get(6).startsWith('6. **插件源码受认领锁保护（REQ-20260901-003）**：'), '铁律 6 落点文案不变');
  assert.ok(rules.get(6).includes('markdown 不受限。'), '铁律 6 结尾文案不变');
  assert.ok(skill.includes('你触碰了铁律 1/2'), '常见错误表「铁律 1/2」引用仍成立');
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
