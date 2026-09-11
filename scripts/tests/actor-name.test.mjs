#!/usr/bin/env node
// REQ-20260901-005 认领者统一显示会话名 —— 集成测试（core 直调 + 临时项目）
// 用法：node scripts/tests/actor-name.test.mjs
// 覆盖 test-cases.md 的 N1–N5；N6 为文档静态契约。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-actor-'));
fs.mkdirSync(path.join(tmp, 'proj'), { recursive: true });
const project = fs.realpathSync(path.join(tmp, 'proj'));
core.initData(project);
const dataDir = core.dataDirFrom(project);

const mk = (title) => {
  const it = core.createItem(dataDir, { type: 'requirement', title, by: 'test' });
  core.setStatus(dataDir, it.id, 'accepted', { by: 'human' });
  return it.id;
};

// BUG-20260906-002：claim 即占用项目实施互斥；本文件只测认领者命名，用例间 report 收尾释放占用
const finish = (id, by) => core.report(dataDir, id, { summary: '完成', by });

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('N1 显式命名优先：claim --by 语义名后 owner 即该名', () => {
  const id = mk('n1');
  const st = core.claim(dataDir, id, 'zcode-login-view');
  assert.equal(st.owner, 'zcode-login-view');
  finish(id, 'zcode-login-view');
});

t('N2 缺省名可读且不再是裸 terminal：格式 前缀-MMDD-4位随机', () => {
  const id = mk('n2');
  const st = core.claim(dataDir, id); // 不传 owner
  assert.notEqual(st.owner, 'terminal', '不得再缺省为 terminal');
  assert.match(st.owner, /^[a-z][a-z0-9-]*-\d{4}-[a-z0-9]{4}$/, `缺省名格式不符：${st.owner}`);
  finish(id, st.owner);
});

t('N3 同进程缺省名稳定（缓存复用）', () => {
  const ida = mk('n3a');
  const a = core.claim(dataDir, ida).owner;
  finish(ida, a); // 先收尾释放实施占用，再认领第二项（单实施任务约束）
  const idb = mk('n3b');
  const b = core.claim(dataDir, idb).owner;
  assert.equal(a, b, '同一进程两次缺省认领应同名');
  finish(idb, b);
});

t('N4 ATB_AGENT_NAME 作为缺省名前缀生效', () => {
  process.env.ATB_AGENT_NAME = 'zcode';
  // 清缓存后重新生成
  core.__resetActorCacheForTest?.();
  const id = mk('n4');
  const owner = core.claim(dataDir, id).owner;
  assert.match(owner, /^zcode-\d{4}-[a-z0-9]{4}$/, `前缀应为 zcode：${owner}`);
  finish(id, owner);
  delete process.env.ATB_AGENT_NAME;
});

t('N5 锁文件 owner 与 status.owner 同源一致', () => {
  const id = mk('n5');
  core.claim(dataDir, id, 'codex-dev-loop');
  const lock = JSON.parse(fs.readFileSync(path.join(dataDir, '.locks', `${id}.lock`), 'utf8'));
  const st = core.readStatus(core.resolveItemDir(dataDir, id).dir);
  assert.equal(lock.owner, st.owner);
  finish(id, 'codex-dev-loop');
});

t('N6 SKILL.md 与 dev.md 写明会话名约定（静态契约）', () => {
  const skill = fs.readFileSync(path.join(pluginRoot, 'skills', 'agent-team-board', 'SKILL.md'), 'utf8');
  const dev = fs.readFileSync(path.join(pluginRoot, 'commands', 'dev.md'), 'utf8');
  const pat = /会话名/;
  assert.match(dev, pat, 'dev.md 应含会话名约定');
  assert.match(skill, pat, 'SKILL.md 应含会话名约定');
  assert.match(dev, /ATB_AGENT_NAME|--by/, '应提到显式命名途径');
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
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
