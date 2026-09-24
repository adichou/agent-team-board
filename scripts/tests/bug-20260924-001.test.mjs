#!/usr/bin/env node
// BUG-20260924-001 一键迁移失败（目标目录已存在即报错）测试
// 用法：node scripts/tests/bug-20260924-001.test.mjs
// 覆盖（见条目 README.md 复现步骤 / 期望行为 / 验收说明）：
//   · B1  报告场景：预存在空 runtime/.locks（源含锁文件）迁移成功，不再「迁移目标已存在」；
//   · B1b 源、目标 .locks 均为空目录也能完成迁移；
//   · B2  源目标目录不重名文件完整合并保留；
//   · B3  同名同内容：判为已迁移/重复，不产生第二份副本；
//   · B3b 已跟踪源 + 未跟踪目标同名同内容：内容保留、旧前缀退出索引；
//   · B4  同名异内容：报「迁移冲突」定位具体路径，双方数据原样保留，人工解决后续迁成功；
//   · B5  目录-文件类型冲突：报「迁移冲突」定位路径，双方保留；
//   · B6  CLI atb migrate 与服务 /api/migrate 等价（空目标目录场景成功、冲突场景如实报错）；
//   · B7  UI 文案：冲突失败不再附带「可重试」提示，i18n 中英文同步。

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as migrate from '../lib/migrate-layout.mjs';
import '../web/i18n.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ATB = path.join(pluginRoot, 'scripts', 'atb.mjs');
const SERVER = path.join(pluginRoot, 'scripts', 'server.mjs');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r;
}

function atb(args, cwd) {
  const r = spawnSync(process.execPath, [ATB, ...args, '--dir', cwd], { encoding: 'utf8', timeout: 90_000 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

// 旧布局项目（含条目 / 应用数据 / .locks），全部测试数据
function mkLegacyProj() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-bug24-001-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 't@example.com']);
  git(root, ['config', 'user.name', 't']);
  fs.writeFileSync(path.join(root, 'app.txt'), 'hello\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);

  const L = path.join(root, 'docs', 'agent-team-board');
  const reqDir = path.join(L, 'requirements', 'REQ-20990101-001');
  fs.mkdirSync(reqDir, { recursive: true });
  fs.writeFileSync(path.join(reqDir, 'README.md'), '# REQ-20990101-001 旧需求\n');
  fs.writeFileSync(path.join(reqDir, 'status.json'), JSON.stringify({
    id: 'REQ-20990101-001', type: 'requirement', title: '旧需求', status: 'done',
    parent: null, owner: null, createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z', agentCompletedAt: null, lastReport: null, history: [],
  }, null, 2));
  fs.writeFileSync(path.join(L, 'config.json'), JSON.stringify({ version: 1, date: '20990101', counters: { requirement: 1, bug: 0 } }, null, 2));
  fs.mkdirSync(path.join(L, 'dispatch'), { recursive: true });
  fs.writeFileSync(path.join(L, 'dispatch', 'settings.json'), '{}\n');
  fs.mkdirSync(path.join(L, '.locks'), { recursive: true });
  fs.writeFileSync(path.join(L, '.locks', 'x.lock'), '{"n":1}');
  fs.writeFileSync(path.join(L, 'README.md'), '# 数据目录\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'legacy board']);
  return root;
}

// 预创建新布局 runtime 下的既有内容（模拟首次迁移中断 / 运行时自建目录）
const rt = (root, ...segs) => path.join(root, 'agent-team-board', 'runtime', ...segs);

t('B1 报告场景：预存在空 runtime/.locks（源含锁文件）迁移成功，不再「迁移目标已存在」', () => {
  const root = mkLegacyProj();
  fs.mkdirSync(rt(root, '.locks'), { recursive: true }); // 目标空目录（不删也能迁）
  const r = migrate.migrateLayout(root);
  assert.ok(r.changed, '应报告发生迁移');
  assert.ok(fs.existsSync(rt(root, '.locks', 'x.lock')), '源锁文件应迁入目标 .locks');
  assert.ok(!fs.existsSync(path.join(root, 'docs', 'agent-team-board')), '旧目录应移除');
  assert.ok(fs.existsSync(path.join(root, 'agent-team-board', 'runtime', 'status', 'REQ-20990101-001.json')), '状态应落位');
  assert.ok(fs.existsSync(path.join(root, 'agent-team-board', 'data', 'requirements', 'REQ-20990101-001', 'README.md')), '文档应落位');
});

t('B1b 源、目标 .locks 均为空目录：迁移完成不报错', () => {
  const root = mkLegacyProj();
  fs.rmSync(path.join(root, 'docs', 'agent-team-board', '.locks', 'x.lock'));
  fs.mkdirSync(rt(root, '.locks'), { recursive: true });
  const r = migrate.migrateLayout(root);
  assert.ok(r.changed, '空目录对空目录应完成迁移');
  assert.ok(!fs.existsSync(path.join(root, 'docs')), '旧 docs/ 应移除');
});

t('B2 源目标目录不重名文件完整合并保留', () => {
  const root = mkLegacyProj();
  fs.mkdirSync(rt(root, '.locks'), { recursive: true });
  fs.writeFileSync(rt(root, '.locks', 'y.lock'), '{"n":2}'); // 目标侧已有不同名文件
  const r = migrate.migrateLayout(root);
  assert.ok(r.changed);
  assert.equal(fs.readFileSync(rt(root, '.locks', 'x.lock'), 'utf8'), '{"n":1}', '源文件内容应原样迁入');
  assert.equal(fs.readFileSync(rt(root, '.locks', 'y.lock'), 'utf8'), '{"n":2}', '目标既有文件应保留');
});

t('B3 同名同内容：判为已迁移/重复，不产生第二份副本', () => {
  const root = mkLegacyProj();
  fs.mkdirSync(rt(root, '.locks'), { recursive: true });
  fs.writeFileSync(rt(root, '.locks', 'x.lock'), '{"n":1}'); // 与源同名同内容
  const r = migrate.migrateLayout(root);
  assert.ok(r.changed, '同名同内容不应阻塞迁移');
  const locksDir = rt(root, '.locks');
  assert.deepEqual(fs.readdirSync(locksDir).sort(), ['x.lock'], '目标应只有一份副本');
  assert.equal(fs.readFileSync(path.join(locksDir, 'x.lock'), 'utf8'), '{"n":1}', '内容应与源一致');
  assert.ok(!fs.existsSync(path.join(root, 'docs')), '旧目录应移除');
});

t('B3b 已跟踪源 + 未跟踪目标同名同内容：内容保留、旧前缀退出索引', () => {
  const root = mkLegacyProj();
  fs.mkdirSync(rt(root, 'dispatch'), { recursive: true });
  fs.writeFileSync(rt(root, 'dispatch', 'settings.json'), '{}\n'); // 与源同名同内容
  const r = migrate.migrateLayout(root);
  assert.ok(r.changed);
  assert.equal(fs.readFileSync(rt(root, 'dispatch', 'settings.json'), 'utf8'), '{}\n', '内容应保留');
  const tracked = new Set(String(git(root, ['ls-files']).stdout).trim().split('\n').filter(Boolean));
  assert.ok(!tracked.has('docs/agent-team-board/dispatch/settings.json'), '旧前缀应退出索引');
  assert.ok(!tracked.has('agent-team-board/runtime/dispatch/settings.json'), 'runtime 文件不应被跟踪');
});

t('B4 同名异内容：报「迁移冲突」定位具体路径，双方保留，人工解决后续迁成功', () => {
  const root = mkLegacyProj();
  fs.mkdirSync(rt(root, '.locks'), { recursive: true });
  fs.writeFileSync(rt(root, '.locks', 'x.lock'), '{"n":999}'); // 同名异内容
  let err = null;
  try { migrate.migrateLayout(root); } catch (e) { err = e; }
  assert.ok(err, '同名异内容应报错');
  assert.match(err.message, /迁移冲突/, '错误应标识为迁移冲突');
  assert.ok(err.message.includes(path.join('runtime', '.locks', 'x.lock')), `错误应定位到具体冲突路径（实际：${err.message}）`);
  assert.equal(fs.readFileSync(path.join(root, 'docs', 'agent-team-board', '.locks', 'x.lock'), 'utf8'), '{"n":1}', '源副本应原样保留');
  assert.equal(fs.readFileSync(rt(root, '.locks', 'x.lock'), 'utf8'), '{"n":999}', '目标副本应原样保留（不静默覆盖）');
  // 人工解决（保留目标版本，移除源副本）后重试：续迁成功
  fs.rmSync(path.join(root, 'docs', 'agent-team-board', '.locks', 'x.lock'));
  const r2 = migrate.migrateLayout(root);
  assert.ok(r2.changed, '解决冲突后重试应续迁成功');
  assert.equal(fs.readFileSync(rt(root, '.locks', 'x.lock'), 'utf8'), '{"n":999}', '人工保留的版本不被改写');
  assert.ok(!fs.existsSync(path.join(root, 'docs')), '旧目录应移除');
});

t('B5 目录-文件类型冲突：报「迁移冲突」定位路径，双方保留', () => {
  const root = mkLegacyProj();
  fs.mkdirSync(rt(root, '.locks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'agent-team-board', '.locks', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'agent-team-board', '.locks', 'sub', 'a.lock'), '{}');
  fs.writeFileSync(rt(root, '.locks', 'sub'), '文件占位'); // 目标同名但为文件
  let err = null;
  try { migrate.migrateLayout(root); } catch (e) { err = e; }
  assert.ok(err, '类型冲突应报错');
  assert.match(err.message, /迁移冲突/, '错误应标识为迁移冲突');
  assert.ok(err.message.includes(path.join('runtime', '.locks', 'sub')), `错误应定位到冲突路径（实际：${err.message}）`);
  assert.ok(fs.statSync(rt(root, '.locks', 'sub')).isFile(), '目标文件应保留');
  assert.ok(fs.statSync(path.join(root, 'docs', 'agent-team-board', '.locks', 'sub')).isDirectory(), '源目录应保留');
  assert.ok(fs.existsSync(path.join(root, 'docs', 'agent-team-board', '.locks', 'sub', 'a.lock')), '源目录内容应保留');
});

t('B6 CLI atb migrate 与服务 /api/migrate 等价（空目标目录成功 / 冲突如实报错）', async () => {
  // CLI：空目标目录场景
  const root = mkLegacyProj();
  fs.mkdirSync(rt(root, '.locks'), { recursive: true });
  const cli = atb(['migrate', '--dir', root], root);
  assert.equal(cli.code, 0, `atb migrate 应成功：${cli.err}`);
  assert.ok(fs.existsSync(rt(root, '.locks', 'x.lock')), 'CLI 迁移应落位');
  assert.ok(!cli.out.includes('迁移目标已存在'), '不应再报目标已存在');

  // API：空目标目录场景成功；冲突场景如实报错（400 + error 信息）
  const root2 = mkLegacyProj();
  fs.mkdirSync(rt(root2, '.locks'), { recursive: true });
  const port = 19390 + Math.floor(Math.random() * 100);
  const env = { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(root2, 'reg.json') };
  const proc = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await sleep(1500);
    const ok1 = await reqJson(port, 'POST', '/api/migrate', { path: root2 });
    assert.ok(ok1.changed !== false, `api/migrate 应完成迁移：${JSON.stringify(ok1).slice(0, 200)}`);
    assert.ok(fs.existsSync(rt(root2, '.locks', 'x.lock')), '服务迁移应落位');

    const root3 = mkLegacyProj();
    fs.mkdirSync(rt(root3, '.locks'), { recursive: true });
    fs.writeFileSync(rt(root3, '.locks', 'x.lock'), '{"n":999}');
    const bad = await reqJson(port, 'POST', '/api/migrate', { path: root3 });
    assert.ok(bad.error, '冲突场景应返回错误信息');
    assert.match(bad.error, /迁移冲突/, `API 错误应标识迁移冲突（实际：${bad.error}）`);
  } finally {
    proc.kill('SIGKILL');
  }
});

t('B7 UI 文案：冲突失败不附带「可重试」提示，i18n 中英文同步', () => {
  const appJs = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  // 冲突分支：真实冲突提示需人工核对，不再渲染「可重试；迁移幂等」
  const conflictBranch = /迁移冲突/.test(appJs);
  assert.ok(conflictBranch, 'app.js 迁移失败分支应区分冲突错误');
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN_DYNAMIC } = I._dict;
  const conflictKey = '失败：◇（真实冲突：需人工核对处理，直接重试不会自动解决）';
  assert.ok(conflictKey in EN_DYNAMIC, `EN_DYNAMIC 应含冲突失败词条：${conflictKey}`);
  assert.ok(appJs.includes('（真实冲突：需人工核对处理，直接重试不会自动解决）'), 'app.js 冲突分支应使用该文案');
  // 既有「可重试」词条保留给非冲突失败（临时故障等）
  assert.ok('失败：◇（可重试；迁移幂等，已完成部分不会重复执行）' in EN_DYNAMIC, '非冲突失败的既有词条应保留');
  // 英文翻译可用（动态模板命中；插值 e.message 为后端产出内容，沿用既有「用户数据不误翻」口径不译）
  I.setLang('en');
  const sample = '失败：迁移冲突：/a/runtime/.locks/x.lock（源 /a/docs/agent-team-board/.locks/x.lock）同名文件内容不同；双方数据均已保留，请人工核对处理后再重试（真实冲突：需人工核对处理，直接重试不会自动解决）';
  const en = I.t(sample);
  assert.match(en, /^Failed: /, `英文界面应翻译冲突失败前缀（实际：${en.slice(0, 80)}）`);
  assert.match(en, /\(real conflict: manual review required — retrying without resolving it will fail again\)$/, `英文界面应翻译冲突失败后缀（实际：${en.slice(-100)}）`);
  I.setLang('zh');
});

function reqJson(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 15000,
    }, (rs) => {
      let data = '';
      rs.on('data', (c) => { data += c; });
      rs.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(`${pathname} 响应非 JSON：${data.slice(0, 200)}`)); }
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    r.write(payload);
    r.end();
  });
}

// ---------- 执行 ----------
let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e && e.stack ? e.stack.split('\n').slice(0, 8).join('\n  ') : e}`);
  }
}
console.log(failed ? `\n${failed} 个用例失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
