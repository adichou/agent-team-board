// BUG-20260915-002：在临时 Git 仓库验证收尾命令产生真实提交与待测试状态，保留他人修改。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as core from '../lib/core.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-closeout-'));
const atb = new URL('../atb.mjs', import.meta.url).pathname;
function exec(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0, `${cmd} ${args.join(' ')}\n${r.stderr}\n${r.stdout}`);
  return r.stdout.trim();
}
const git = (...args) => exec('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', ...args]);
try {
  core.initData(root);
  const data = core.dataDirFrom(root);
  const item = core.createItem(data, { type: 'bug', title: '收尾测试' });
  core.setStatus(data, item.id, 'accepted', { by: 'fixture-human' });
  core.setStatus(data, item.id, 'planned', { by: 'fixture-human' });
  git('init', '-q');
  fs.writeFileSync(path.join(root, 'other.txt'), '别的任务原文');
  git('add', '.');
  git('commit', '-qm', 'fixture');
  fs.writeFileSync(path.join(root, 'other.txt'), '别的任务修改');
  fs.writeFileSync(path.join(root, 'fix.txt'), '本单修复');
  // 验证文档中的例外状态收尾，不改真实项目，不绕过认领保护。
  exec(process.execPath, [atb, 'status', item.id, 'in-progress', '--dir', root]);
  const started = Date.now();
  exec(process.execPath, [atb, 'report', item.id, '--summary', '例外授权收尾验证', '--by', 'fixture-dev', '--dir', root]);
  const dir = core.resolveItemDir(data, item.id).dir;
  const state = core.readStatus(dir);
  assert.equal(state.status, 'in-progress');
  assert.ok(Date.parse(state.agentCompletedAt) >= started, '必须为本轮上报');
  assert.equal(state.lastReport.at, state.agentCompletedAt);
  assert.equal(state.lastReport.coverage, null, '没有测量时不伪造覆盖率');
  const ownDir = path.relative(root, dir);
  git('add', '--', 'fix.txt', ownDir);
  git('commit', '-qm', `fix: ${item.id}`);
  const hash = git('rev-parse', 'HEAD');
  assert.match(hash, /^[0-9a-f]{40}$/);
  assert.equal(git('status', '--porcelain', '--', 'fix.txt', ownDir), '', '本单源码、状态、报告全部入库');
  assert.match(git('status', '--porcelain', '--', 'other.txt'), /other.txt/, '其他任务修改保留');
  assert.equal(git('show', 'HEAD:other.txt'), '别的任务原文');
  assert.equal(JSON.parse(git('show', `HEAD:${ownDir}/status.json`)).agentCompletedAt, state.agentCompletedAt);
  assert.match(git('show', `HEAD:${ownDir}/test-report.md`), /例外授权收尾验证/);
  console.log('✓ 例外状态收尾、真实 report、本单 Git 提交、待测试核验及其他修改隔离');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
