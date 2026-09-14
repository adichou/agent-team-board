#!/usr/bin/env node
// REQ-20260910-004 /board 提示词项目优先解析 —— 静态契约测试
// 用法：node scripts/tests/board-project-hint-20260910-004.test.mjs
// 覆盖 test-cases.md 的 B1–B9（B10 多项目无回归由既有测试集守护：
// multi-project / default-port / traceability）。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const boardCmd = fs.readFileSync(path.join(pluginRoot, 'commands', 'board.md'), 'utf8');
const skill = fs.readFileSync(path.join(pluginRoot, 'skills', 'agent-team-board', 'SKILL.md'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('B1 board.md 接受可选项目参数，不再「无需参数」', () => {
  const hint = /^argument-hint:(.*)$/m.exec(boardCmd);
  assert.ok(hint, 'frontmatter 应有 argument-hint');
  assert.match(hint[1], /项目/, 'argument-hint 应提示可选的项目参数');
  assert.doesNotMatch(boardCmd, /无需参数/, '不得再出现「无需参数」表述');
});

t('B2 两级解析优先级：提示词提及项目优先 > 会话项目兜底', () => {
  assert.match(boardCmd, /优先/, '应写明优先级');
  assert.match(boardCmd, /兜底/, '应写明兜底口径');
  const prioIdx = boardCmd.search(/提示词[^。\n]*项目|项目[^。\n]*提示词/);
  assert.ok(prioIdx >= 0, '应描述「提示词中提及的项目」');
  assert.match(boardCmd, /未提及|没有提及/, '应描述未提及时的兜底行为');
});

t('B3 绝对路径规则：~ 展开、目录存在即用、沿用服务端校验与首访登记', () => {
  assert.match(boardCmd, /~/, '应支持 ~ 展开的绝对路径');
  assert.match(boardCmd, /绝对路径/, '应明确绝对路径规则');
  assert.match(boardCmd, /存在/, '应要求目录存在');
  assert.match(boardCmd, /登记|注册/, '应写明沿用服务端首访登记');
});

t('B4 项目名规则：/api/health 注册表末段匹配、忽略大小写、唯一命中', () => {
  assert.match(boardCmd, /api\/health/, '项目名解析应基于 /api/health 返回的已知项目');
  assert.match(boardCmd, /末段|basename|最后一级/, '应写明按路径末段匹配项目名');
  assert.match(boardCmd, /忽略大小写|大小写不敏感/, '应写明大小写不敏感匹配');
  assert.match(boardCmd, /唯一/, '应写明唯一命中才用');
});

t('B5 解析失败不猜：路径不存在 / 无命中 / 同名歧义 / 多项目提及 → 列候选请确认', () => {
  assert.match(boardCmd, /不存在/, '应覆盖路径不存在分支');
  assert.match(boardCmd, /歧义|多个同名|重名/, '应覆盖同名歧义分支');
  assert.match(boardCmd, /多个项目|都提及|多个提及/, '应覆盖提及多个项目分支');
  assert.match(boardCmd, /不打开|不要打开|不猜测/, '解析失败时不得打开猜测项目');
  assert.match(boardCmd, /完整路径/, '应列出已知项目含完整路径供确认');
});

t('B6 未提及项目走现状：git root / docs/agent-team-board/ / cwd 兜底', () => {
  assert.match(boardCmd, /git root/, '应保留 git root 探测');
  assert.match(boardCmd, /docs\/agent-team-board\//, '应保留数据目录探测');
  assert.match(boardCmd, /cwd|工作目录/, '应保留 cwd 兜底');
});

t('B7 既有步骤不回归：探测 / 后台拉起 / ?project= 打开 / 人工操作提示', () => {
  assert.match(boardCmd, /api\/health|8888/, '应保留服务探测步骤');
  assert.match(boardCmd, /后台/, '应保留后台拉起方式');
  assert.match(boardCmd, /agent-team-board\.log/, '应保留日志重定向路径');
  assert.match(boardCmd, /encodeURIComponent/, '应保留 URL 编码打开形态');
  assert.match(boardCmd, /\?project=/, '应打开带 ?project= 的 URL');
  assert.match(boardCmd, /接受|确认完成|驳回/, '应保留人工操作告知');
  assert.match(boardCmd, /不要.*替|不得.*替/, '应保留不代替人工操作的约束');
});

t('B8 SKILL.md Status Board 节同步两级优先级与解析规则', () => {
  const idx = skill.indexOf('Status Board');
  assert.ok(idx >= 0, 'SKILL.md 应有 Status Board 节');
  const section = skill.slice(idx);
  assert.match(section, /优先/, 'Status Board 节应写明提示词项目优先');
  assert.match(section, /兜底/, 'Status Board 节应写明会话项目兜底');
  assert.match(section, /末段|basename|最后一级/, '应写明项目名末段匹配');
  assert.match(section, /歧义|同名/, '应写明歧义处理');
  assert.match(section, /8888/, '应保留端口 8888');
  assert.match(section, /\?project=/, '应保留 ?project= 深链');
  assert.doesNotMatch(section, /无需参数/, '不得再出现「无需参数」表述');
});

t('B9 未初始化项目：打开不报错、展示既有空态与初始化引导', () => {
  assert.match(boardCmd, /初始化/, '应写明未初始化项目打开不报错、展示初始化空态');
  assert.match(boardCmd, /空态|引导/, '应提及空态引导');
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
