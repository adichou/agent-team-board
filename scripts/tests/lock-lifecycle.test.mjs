#!/usr/bin/env node
// BUG-20260903-002 —— 认领锁生命周期：report / 确认完成即释放；残留锁可 prune-locks 清理。
// 根因：锁只在人工驳回时释放（core.mjs），guard 放行条件「存在未过期锁」被恒真残留锁架空。
// 用法：node scripts/tests/lock-lifecycle.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const guard = path.join(pluginRoot, 'scripts', 'state-guard.mjs');
const atbCli = path.join(pluginRoot, 'scripts', 'atb.mjs');
const SRC = path.join(pluginRoot, 'scripts', 'web', 'app.js'); // 受保护源码样本（与 code-guard 一致）

// ---------- 环境 ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-locklife-'));
fs.mkdirSync(path.join(tmp, 'proj'), { recursive: true });
const project = fs.realpathSync(path.join(tmp, 'proj'));
core.initData(project);
const dataDir = core.dataDirFrom(project);
const lockFile = (id) => path.join(dataDir, '.locks', `${id}.lock`);

const mkAccepted = (title) => {
  const it = core.createItem(dataDir, { type: 'requirement', title, by: 'test' });
  core.setStatus(dataDir, it.id, 'accepted', { by: 'human' });
  return it.id;
};

const ageFile = (file, msAgo) => {
  const past = new Date(Date.now() - msAgo);
  fs.utimesSync(file, past, past);
};

function runGuard(toolInput, cwd) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [guard, 'file'], {
      cwd: cwd || project,
      env: { ...process.env },
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let err = '';
    p.stderr.on('data', (c) => { err += c; });
    p.on('close', (code) => resolve({ code, err }));
    p.stdin.write(JSON.stringify({ tool_name: 'Write', cwd: cwd || project, tool_input: toolInput }));
    p.stdin.end();
  });
}

function runCli(args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [atbCli, ...args, '--dir', project], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    p.stdout.on('data', (c) => { out += c; });
    p.stderr.on('data', (c) => { err += c; });
    p.on('close', (code) => resolve({ code, out, err }));
  });
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// BUG-20260906-002：claim 即占用项目实施互斥（impl.lock）；本文件关注条目认领锁生命周期，
// 造数/用例收尾时直接释放实施占用，避免跨用例残留拦截后续 claim（真实收尾走 report/确认完成）
const dropImpl = () => { try { fs.rmSync(path.join(dataDir, '.locks', 'impl.lock')); } catch {} };

// L1 claim 产生锁；report 上报（进入待人工确认）即释放
t('L1 claim 有锁，report 后无锁', () => {
  const id = mkAccepted('上报释放');
  core.claim(dataDir, id, 's1');
  assert.ok(fs.existsSync(lockFile(id)), 'claim 后应存在认领锁');
  core.report(dataDir, id, { summary: '完成', by: 's1' });
  assert.ok(!fs.existsSync(lockFile(id)), 'report 上报后认领锁应被释放');
});

// L2 人工确认完成（in-progress → done）释放锁
t('L2 确认完成（in-progress→done）后无锁', () => {
  const id = mkAccepted('完成释放');
  core.claim(dataDir, id, 's1');
  core.setStatus(dataDir, id, 'done', { by: 'human' });
  assert.ok(!fs.existsSync(lockFile(id)), '确认完成后认领锁应被释放');
});

// L3 人工驳回（done → in-progress）清理残留锁（既有行为回归）
t('L3 驳回（done→in-progress）清理残留锁', () => {
  const id = mkAccepted('驳回释放');
  core.claim(dataDir, id, 's1');
  core.setStatus(dataDir, id, 'done', { by: 'human' });
  fs.writeFileSync(lockFile(id), JSON.stringify({ owner: 's1', at: new Date().toISOString() }));
  core.setStatus(dataDir, id, 'in-progress', { by: 'human' });
  assert.ok(!fs.existsSync(lockFile(id)), '驳回后残留锁应被清理');
});

// L4 report 释放锁后，guard 对无锁会话重新收紧：锁在放行（对照），锁失被拦
t('L4 report 后无锁：未认领写入插件源码被 guard 拦截', async () => {
  const id = mkAccepted('守卫收紧');
  core.claim(dataDir, id, 's1');
  const allow = await runGuard({ file_path: SRC }, project);
  assert.equal(allow.code, 0, `锁存在时应放行：${allow.err}`);
  core.report(dataDir, id, { summary: '完成', by: 's1' });
  const deny = await runGuard({ file_path: SRC }, project);
  assert.equal(deny.code, 2, `report 释放锁后应拦截（exit 2）：${deny.err}`);
  assert.match(deny.err, /认领|claim|看板/, '提示应含流程指引');
});

// L5 report 后原认领者 claim 续认补锁，guard 重新放行
t('L5 report 后续认补锁：guard 重新放行', async () => {
  const id = mkAccepted('续认补锁');
  core.claim(dataDir, id, 's1');
  core.report(dataDir, id, { summary: '完成', by: 's1' });
  core.claim(dataDir, id, 's1'); // in-progress 同 owner 续认，补锁
  assert.ok(fs.existsSync(lockFile(id)), '续认应补回认领锁');
  const r = await runGuard({ file_path: SRC }, project);
  assert.equal(r.code, 0, `补锁后应放行：${r.err}`);
  dropImpl(); // 续认重新占用的实施互斥：用例结束释放
});

// L6 prune-locks：只保留「in-progress 且未过期」的锁
t('L6 prune-locks：在办新鲜锁保留，其余清理', () => {
  const mkItem = (title, status) => {
    const it = core.createItem(dataDir, { type: 'bug', title, by: 'test' });
    if (status !== 'submitted') {
      core.setStatus(dataDir, it.id, 'accepted', { by: 'human' });
      if (status === 'in-progress' || status === 'done') {
        core.claim(dataDir, it.id, 's-keep');
        dropImpl(); // 本用例只验证条目锁清理：claim 顺带占用的实施互斥立即释放，避免拦后续造数
      }
      if (status === 'done') core.setStatus(dataDir, it.id, 'done', { by: 'human' });
    }
    return it.id;
  };
  const keepId = mkItem('在办保留', 'in-progress');
  const doneId = mkItem('已完成', 'done');
  // 新实现下确认完成已自动释放锁；这里手工补一把锁模拟旧版本残留
  fs.writeFileSync(lockFile(doneId), JSON.stringify({ owner: 's-keep', at: new Date().toISOString() }));
  const submittedId = mkItem('未接受', 'submitted');
  fs.writeFileSync(lockFile(submittedId), JSON.stringify({ owner: 's-keep', at: new Date().toISOString() }));
  // in-progress 但锁已过期（>24h）：guard 已视其为无效，一并清理
  const acceptedId = mkItem('已接受未认领', 'accepted');
  fs.writeFileSync(lockFile(acceptedId), JSON.stringify({ owner: 'x', at: new Date().toISOString() }));
  const staleId = mkItem('在办但锁过期', 'in-progress');
  ageFile(lockFile(staleId), 25 * 60 * 60 * 1000);
  const orphan = 'REQ-19990101-999';
  fs.writeFileSync(path.join(dataDir, '.locks', `${orphan}.lock`), '{}');

  const res = core.pruneLocks(dataDir, { apply: true });
  const kept = res.kept.map((k) => k.name || k);
  const removed = res.removed.map((r) => r.name || r);
  assert.ok(kept.includes(`${keepId}.lock`), `在办新鲜锁应保留：${kept.join(',')}`);
  for (const [label, id] of [['done 条目', doneId], ['submitted 条目', submittedId], ['过期锁', staleId], ['孤儿锁', orphan]]) {
    assert.ok(removed.includes(`${id}.lock`), `${label}的锁应被清理（removed=${removed.join(',')}）`);
    assert.ok(!fs.existsSync(lockFile(id)), `${label}的锁文件应已删除`);
  }
  assert.ok(fs.existsSync(lockFile(keepId)), '在办锁文件应仍在');
  assert.ok(!removed.includes(`${keepId}.lock`), '在办锁不应出现在清理列表');
});

// L7 config.lock 与非认领锁文件的边界
t('L7 prune-locks：config.lock 按新鲜度处理，陌生 .lock 跳过', () => {
  const cfg = path.join(dataDir, '.locks', 'config.lock');
  const stranger = path.join(dataDir, '.locks', 'someone.lock');
  fs.writeFileSync(cfg, '{}');
  fs.writeFileSync(stranger, '{}');
  core.pruneLocks(dataDir, { apply: true });
  assert.ok(fs.existsSync(cfg), '新鲜的 config.lock 应保留');
  assert.ok(fs.existsSync(stranger), '非认领 ID 形态的 .lock 应跳过不动');
  ageFile(cfg, 60 * 1000); // 超过 CONFIG_LOCK_STALE_MS(30s)
  core.pruneLocks(dataDir, { apply: true });
  assert.ok(!fs.existsSync(cfg), '过期的 config.lock 应被清理');
  assert.ok(fs.existsSync(stranger), '陌生 .lock 仍应保留');
});

// L8 CLI：--dry-run 只预览不删除；默认实际删除
t('L8 CLI prune-locks：--dry-run 预览，实际执行删除', async () => {
  // 前序用例可能残留边界文件（实现未跑绿时），避免干扰 nextId 的 config.lock
  for (const stray of ['config.lock', 'someone.lock']) {
    try { fs.rmSync(path.join(dataDir, '.locks', stray)); } catch {}
  }
  const id = mkAccepted('CLI 清理');
  core.claim(dataDir, id, 's1');
  core.setStatus(dataDir, id, 'done', { by: 'human' });
  fs.writeFileSync(lockFile(id), JSON.stringify({ owner: 's1', at: new Date().toISOString() }));
  const dry = await runCli(['prune-locks', '--dry-run']);
  assert.equal(dry.code, 0, `dry-run 应成功：${dry.err}`);
  assert.match(dry.out, /prune-locks|dry-run|预览/, '应表明处于预览模式');
  assert.ok(fs.existsSync(lockFile(id)), 'dry-run 不应实际删除');
  const real = await runCli(['prune-locks']);
  assert.equal(real.code, 0, `prune-locks 应成功：${real.err}`);
  assert.ok(!fs.existsSync(lockFile(id)), '实际执行应删除残留锁');
  assert.match(real.out, new RegExp(id), '输出应提及被清理的条目锁');
  const again = await runCli(['prune-locks']);
  assert.equal(again.code, 0, '重复执行应幂等成功');
  assert.match(again.out, /无需清理|保留/, '无残留时应提示无需清理');
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
