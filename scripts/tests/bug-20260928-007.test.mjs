#!/usr/bin/env node
// BUG-20260928-007 发布文档 AI 总结 / 翻译 / 校对提示词版本号未取计划 x.y.z —— TDD 分层测试。
// 引入来源：REQ-20260922-006（总结 / 翻译提示词部分，验收口径「发布文档 AI 总结 / 翻译 /
// 官网提示词中的版本号同源」，实现只改展示层未改提示词调用点）+ REQ-20260924-001
//（校对提示词后引入，沿用旧的派生口径）。与 BUG-20260928-006（官网提示词）同构。
// 覆盖：
//   L1 纯逻辑（publish-flow 三个提示词函数）：
//      传入 version（x.y.z）→ 提示词内版本号（首行 +「发布计划号」行）取 x.y.z，
//      不再出现派生 YYYYMMDD-NNN；完整计划号 BLD-… 保留；
//      未传 version（存量计划口径）→ 回退计划编号派生（YYYYMMDD-NNN，不迁移数据）。
//   L2 CLI 端到端（真实 atb 子进程）：summary / translate / docscheck start 的提示词
//      新计划取 x.y.z；存量计划（version.json 删除 version 字段）回退派生口径。
//   L3 源码契约：server.mjs 三处与 atb.mjs 三处调用点均传入 version: v.version。
// 用法：node scripts/tests/bug-20260928-007.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as buildStore from '../lib/build-store.mjs';
import * as flow from '../lib/publish-flow.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const atb = path.join(pluginRoot, 'scripts', 'atb.mjs');
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const PLAN = 'BLD-20260927-001';
const DERIVED = '20260927-001';
const VER = '1.0.0';

/* ---------- L1 纯逻辑 ---------- */

t('L1-1 总结提示词：传入 version（x.y.z）时「发布计划号」行版本号取 x.y.z，不再派生，完整计划号保留', () => {
  const p = flow.buildDocSummaryPrompt({ projectRoot: '/tmp/projX', planId: PLAN, items: [], runId: 'run-x', version: VER });
  assert.ok(p.includes(`发布计划号：${PLAN}（版本号 ${VER}）`), `「发布计划号」行应为 x.y.z：\n${p}`);
  assert.ok(!p.includes(`版本号 ${DERIVED}`), '不应再出现派生口径「版本号 20260927-001」');
  assert.ok(p.includes(PLAN), '完整计划号仍保留（进度回执与提交消息匹配依据）');
});

t('L1-2 翻译提示词：传入 version 时首行派发句与「发布计划号」行版本号均取 x.y.z，不再派生，完整计划号保留', () => {
  const p = flow.buildDocTranslatePrompt({ projectRoot: '/tmp/projX', planId: PLAN, runId: 'run-x', version: VER });
  assert.ok(p.includes(`负责「${PLAN}」（版本号 ${VER}）的翻译派发`), `首行派发句应为 x.y.z：\n${p}`);
  assert.ok(p.includes(`发布计划号：${PLAN}（版本号 ${VER}）`), `「发布计划号」行应为 x.y.z：\n${p}`);
  assert.ok(!p.includes(`版本号 ${DERIVED}`), '不应再出现派生口径「版本号 20260927-001」');
  assert.ok(p.includes(PLAN), '完整计划号仍保留');
});

t('L1-3 校对提示词：传入 version 时「发布计划号」行版本号取 x.y.z，不再派生，完整计划号保留', () => {
  const p = flow.buildDocProofreadPrompt({ projectRoot: '/tmp/projX', planId: PLAN, runId: 'run-x', version: VER });
  assert.ok(p.includes(`发布计划号：${PLAN}（版本号 ${VER}）`), `「发布计划号」行应为 x.y.z：\n${p}`);
  assert.ok(!p.includes(`版本号 ${DERIVED}`), '不应再出现派生口径「版本号 20260927-001」');
  assert.ok(p.includes(PLAN), '完整计划号仍保留');
});

t('L1-4 存量回退：三个提示词函数未传 version 时沿用计划编号派生口径（YYYYMMDD-NNN，旧数据不迁移）', () => {
  const s = flow.buildDocSummaryPrompt({ projectRoot: '/tmp/projX', planId: PLAN, items: [], runId: 'run-x' });
  const tr = flow.buildDocTranslatePrompt({ projectRoot: '/tmp/projX', planId: PLAN, runId: 'run-x' });
  const pr = flow.buildDocProofreadPrompt({ projectRoot: '/tmp/projX', planId: PLAN, runId: 'run-x' });
  for (const [name, p] of [['总结', s], ['翻译', tr], ['校对', pr]]) {
    assert.ok(p.includes(`版本号 ${DERIVED}`), `${name}提示词未传 version 应回退派生口径`);
    assert.ok(!p.includes(VER), `${name}提示词未传 version 不应出现 x.y.z 猜测值`);
    assert.ok(p.includes(PLAN), `${name}提示词完整计划号保留`);
  }
});

/* ---------- L2 CLI 端到端（真实 atb 子进程） ---------- */

function git(cwd, args) {
  return String(execFileSync('git', ['-c', 'user.email=t@e.co', '-c', 'user.name=T', ...args], {
    cwd, encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: cwd },
  })).trim();
}

const runAtb = (args, cwd, timeoutMs = 30000) => new Promise((resolve) => {
  const p = spawn(process.execPath, [atb, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  p.stdout.on('data', (c) => { out += c; });
  p.stderr.on('data', (c) => { err += c; });
  const timer = setTimeout(() => { p.kill(); resolve({ code: 124, out, err }); }, timeoutMs);
  p.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
});

async function runAtbJson(args, cwd) {
  const r = await runAtb([...args, '--json'], cwd);
  if (r.code !== 0) throw new Error(`atb ${args.join(' ')} 失败：${r.err || r.out}`);
  try {
    return JSON.parse(r.out);
  } catch {
    throw new Error(`--json 输出应只有纯 JSON（atb ${args.join(' ')}）：\n${r.out.slice(0, 300)}`);
  }
}

t('L2 CLI：summary / translate / docscheck start 新计划提示词取 x.y.z，存量计划回退派生', async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-bug-060028007-')));
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(proj);
  git(proj, ['init', '-b', 'main']);
  fs.writeFileSync(path.join(proj, 'a.txt'), 'a\n');
  git(proj, ['add', '-A']);
  git(proj, ['commit', '-m', 'init']);
  git(proj, ['switch', '-c', 'dev']);
  core.initData(proj);
  const dataDir = core.dataDirFrom(proj);
  const it = core.createItem(dataDir, { type: 'requirement', title: '演示一', by: 'test' });
  for (const s of ['accepted', 'in-progress']) core.setStatus(dataDir, it.id, s, { by: 'test' });
  fs.writeFileSync(path.join(proj, 'f1.txt'), `feat ${it.id}\n`);
  git(proj, ['add', '-A']);
  git(proj, ['commit', '-m', `feat: 演示 ${it.id}`]);
  const c1 = git(proj, ['rev-parse', 'HEAD']);
  const v = buildStore.createVersion(dataDir, { items: [{ itemId: it.id, commit: c1 }], version: '1.2.3' });
  const derived = v.id.replace(/^BLD-/, '');

  // ① AI 总结（无门禁）：新计划提示词版本号取 x.y.z
  const s1 = await runAtbJson(['summary', 'start', '--id', v.id], proj);
  assert.ok(s1.prompt.includes('版本号 1.2.3'), `summary 提示词应含「版本号 1.2.3」：\n${s1.prompt}`);
  assert.ok(!s1.prompt.includes(`版本号 ${derived}`), 'summary 提示词不应再含计划编号派生版本号');

  // 解锁翻译 / 校对门禁：默认语言 4 文档落盘并逐文件通过审核（hash 按磁盘内容现算）
  for (const f of flow.PUBLISH_DOC_KEYS) fs.writeFileSync(path.join(proj, `${f}.md`), `# ${f}\n`);
  for (const f of flow.PUBLISH_DOC_KEYS) buildStore.recordDocsReview(dataDir, v.id, { file: `${f}.md` });

  // ② AI 翻译 / ③ AI 校对：新计划提示词版本号取 x.y.z
  const t1 = await runAtbJson(['translate', 'start', '--id', v.id], proj);
  assert.ok(t1.prompt.includes('版本号 1.2.3'), `translate 提示词应含「版本号 1.2.3」：\n${t1.prompt}`);
  assert.ok(!t1.prompt.includes(`版本号 ${derived}`), 'translate 提示词不应再含计划编号派生版本号');
  const p1 = await runAtbJson(['docscheck', 'start', '--id', v.id], proj);
  assert.ok(p1.prompt.includes('版本号 1.2.3'), `docscheck 提示词应含「版本号 1.2.3」：\n${p1.prompt}`);
  assert.ok(!p1.prompt.includes(`版本号 ${derived}`), 'docscheck 提示词不应再含计划编号派生版本号');

  // ④ 存量计划：删除 version 字段模拟旧数据 → summary 提示词回退派生口径
  //（先收尾上一轮 summary——同一时间只允许一轮 AI 总结执行）
  assert.equal((await runAtb(['summary', 'done', s1.runId, '--summary', '测试收尾'], proj)).code, 0, '收尾第一轮 AI 总结');
  const vf = path.join(dataDir, 'runtime', 'builds', 'versions', v.id, 'version.json');
  const raw = JSON.parse(fs.readFileSync(vf, 'utf8'));
  delete raw.version;
  fs.writeFileSync(vf, JSON.stringify(raw, null, 2));
  const s2 = await runAtbJson(['summary', 'start', '--id', v.id], proj);
  assert.ok(s2.prompt.includes(`版本号 ${derived}`), `存量计划 summary 提示词应回退派生口径：\n${s2.prompt}`);
  assert.ok(!s2.prompt.includes('版本号 1.2.3'), '存量计划提示词不应出现 x.y.z');
});

/* ---------- L3 源码契约 ---------- */

t('L3 源码契约：server.mjs 与 atb.mjs 各三处提示词调用点均传入 version: v.version', () => {
  const names = ['buildDocSummaryPrompt', 'buildDocTranslatePrompt', 'buildDocProofreadPrompt'];
  for (const [file, expectCount] of [
    [path.join(pluginRoot, 'scripts', 'server.mjs'), 3],
    [path.join(pluginRoot, 'scripts', 'atb.mjs'), 3],
  ]) {
    const src = fs.readFileSync(file, 'utf8');
    const base = path.basename(file);
    let total = 0;
    for (const name of names) {
      const re = new RegExp(`${name}\\(\\{[\\s\\S]*?\\}\\)`, 'g');
      const calls = src.match(re) || [];
      total += calls.length;
      assert.equal(calls.length, 1, `${base} 应恰有 1 处 ${name} 调用（实际 ${calls.length}）`);
      assert.match(calls[0], /version:\s*v\.version/, `${base} 的 ${name} 调用应传入 version: v.version`);
    }
    assert.equal(total, expectCount, `${base} 三个提示词调用点合计应为 ${expectCount}`);
  }
});

/* ---------- 执行 ---------- */

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e && e.message ? e.message : e).split('\n')[0]}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
