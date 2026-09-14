#!/usr/bin/env node
// REQ-20260906-002 Zcode 批量实施 —— CLI 端到端测试（假 worker）
// 覆盖：Z04 并发互斥与别名路径 / Z06 创建幂等与待启动语义（接口层）/
//       Z07 假 worker 连续 10 项每项新实例 / Z08 主会话载荷 ≤2 KiB /
//       Z13 失败后停止批次 / Z23 单项规范不泄漏队列
// 用法：node scripts/tests/batch-cli.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const atb = path.join(pluginRoot, 'scripts', 'atb.mjs');

const runAtb = (args, cwd, timeoutMs = 20000) => new Promise((resolve) => {
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
  } catch (e) {
    throw new Error(`--json 输出应只有纯 JSON（atb ${args.join(' ')}）：\n${r.out.slice(0, 300)}`);
  }
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

async function mkProject(nItems) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-batchcli-')));
  assert.equal((await runAtb(['init'], root)).code, 0);
  const ids = [];
  for (let i = 1; i <= nItems; i++) {
    const r = await runAtb(['new', 'req', `批量条目-${i}`], root);
    assert.equal(r.code, 0);
    const m = r.out.match(/(REQ-\d{8}-\d{3})/);
    assert.ok(m, `应输出单号：${r.out}`);
    ids.push(m[1]);
  }
  for (const id of ids) {
    assert.equal((await runAtb(['status', id, 'accepted'], root)).code, 0, `接受 ${id}`);
    // REQ-20260908-010：选单口径 planned（已计划）
    assert.equal((await runAtb(['status', id, 'planned'], root)).code, 0, `置计划 ${id}`);
  }
  return { root, ids };
}

// ---------- Z07/Z08/Z23 假 worker 连续批次 ----------

t('Z07 假 worker 连续处理 10 项：每项新 owner 只认领一单，check 每次输出 ≤2KiB', async () => {
  const p = await mkProject(10);
  try {
    const created = await runAtbJson(['batch', 'create'], p.root);
    assert.ok(created.batchId, 'create 应返回批次标识');
    assert.ok(created.prompt.includes(p.root), '提示词应含项目真实路径');
    assert.ok(created.prompt.includes(created.batchId), '提示词应含批次标识');
    assert.ok(created.prompt.includes('batch check'), '提示词应含最小核对入口');
    assert.ok(!created.prompt.includes(p.ids[5]), '提示词不得内嵌全部候选');

    const mainBytes = []; // 主会话可观测载荷：每轮 check 输出
    let reported = 0;
    for (let i = 0; ; i++) {
      const chk = await runAtbJson(['batch', 'check'], p.root);
      mainBytes.push(JSON.stringify(chk));
      if (chk.nextAction === 'stop') break;
      assert.equal(chk.nextAction, 'continue', `中途应 continue：${JSON.stringify(chk)}`);

      const owner = `fake-w${i}`;
      const next = await runAtbJson(['batch', 'next', '--by', owner], p.root);
      assert.ok(next.runId && next.itemId && next.itemDir && next.workerSpec, 'next 应返回单项规范');
      const nextText = JSON.stringify(next);
      const others = p.ids.filter((x) => x !== next.itemId);
      for (const o of others) assert.ok(!nextText.includes(o), `单项规范不得泄漏队列（含 ${o}）`);

      assert.equal((await runAtb(['claim', next.itemId, '--by', owner], p.root)).code, 0, 'worker 认领');
      const rep = await runAtb([
        'report', next.itemId, '--coverage', '88', '--framework', 'node:test',
        '--summary', '假实施完成', '--by', owner, '--run', next.runId,
      ], p.root);
      assert.equal(rep.code, 0, `report 应成功：${rep.err}`);

      const receipt = await runAtbJson(['run', 'receipt', next.runId, '--result', 'reported', '--report-ref', 'test-report.md'], p.root);
      assert.equal(receipt.result, 'reported');
      assert.ok(receipt.runId === next.runId && receipt.itemId === next.itemId, '回执应关联本次运行');
      assert.ok(Buffer.byteLength(JSON.stringify(receipt), 'utf8') <= 2048, '回执 ≤2 KiB');
      reported++;
      assert.ok(reported <= 10, '不得超额领取');
    }
    assert.equal(reported, 10, `应连续完成 10 项（实际 ${reported}）`);
    assert.equal((await runAtbJson(['batch', 'check'], p.root)).counts.reported, 10);
    // Z08：主会话每轮核对输出均 ≤2 KiB，且不含其他条目标题
    for (const s of mainBytes) {
      assert.ok(Buffer.byteLength(s, 'utf8') <= 2048, `核对输出超限：${s.slice(0, 80)}…`);
      assert.ok(!s.includes('批量条目-'), '核对摘要不得携带条目标题列表');
    }
  } finally {
    try { fs.rmSync(p.root, { recursive: true, force: true }); } catch {}
  }
});

// ---------- Z04 并发互斥 ----------

t('Z04a 并发 next：两进程同时领取，最多一个成功', async () => {
  const p = await mkProject(3);
  try {
    assert.equal((await runAtb(['batch', 'create'], p.root)).code, 0);
    const [a, b] = await Promise.all([
      runAtb(['batch', 'next', '--by', 'race-a', '--json'], p.root),
      runAtb(['batch', 'next', '--by', 'race-b', '--json'], p.root),
    ]);
    const ok = [a, b].filter((r) => r.code === 0);
    assert.equal(ok.length, 1, `应恰好一个成功（a=${a.code} b=${b.code}：${a.err}${b.err}）`);
    const fail = [a, b].find((r) => r.code !== 0);
    assert.match(fail.err, /互斥|占用/, '失败方应说明互斥占用');
  } finally {
    try { fs.rmSync(p.root, { recursive: true, force: true }); } catch {}
  }
});

t('Z04b 实施互斥期间手工 claim 被拒；别名路径不能绕过', async () => {
  const p = await mkProject(3);
  try {
    assert.equal((await runAtb(['batch', 'create'], p.root)).code, 0);
    const next = await runAtbJson(['batch', 'next', '--by', 'holder'], p.root);

    // 手工 claim 其余条目：被实施互斥拒绝
    const other = p.ids.find((x) => x !== next.itemId);
    const mc = await runAtb(['claim', other, '--by', 'manual-1'], p.root);
    assert.notEqual(mc.code, 0, '持锁期间手工 claim 应被拒');
    assert.match(mc.err, /互斥|核对/, '应提示核对');

    // 别名路径（符号链接）绕道领取：同样命中同一把锁
    const alias = path.join(path.dirname(p.root), `alias-${path.basename(p.root)}`);
    fs.symlinkSync(p.root, alias);
    try {
      const an = await runAtb(['batch', 'next', '--by', 'alias-runner', '--json'], alias);
      assert.notEqual(an.code, 0, '别名路径不得绕过互斥');
      assert.match(an.err, /互斥|占用|未收尾|核对/, '别名路径应命中同一批次执行状态');
    } finally {
      fs.unlinkSync(alias);
    }
  } finally {
    try { fs.rmSync(p.root, { recursive: true, force: true }); } catch {}
  }
});

// ---------- Z06 创建幂等与状态语义 ----------

t('Z06 创建幂等：重复 create 返回同批次不建新；prepared→running 区分待启动/执行中', async () => {
  const p = await mkProject(2);
  try {
    // REQ-20260908-019：--limit 随上限设置移除，传入应明确报错而非静默忽略
    const lim = await runAtb(['batch', 'create', '--limit', '10'], p.root);
    assert.notEqual(lim.code, 0, '--limit 应非零退出');
    assert.match(`${lim.err}${lim.out}`, /已移除/, '应提示上限设置已移除');

    const c1 = await runAtbJson(['batch', 'create'], p.root);
    const c2 = await runAtbJson(['batch', 'create'], p.root);
    assert.equal(c1.batchId, c2.batchId, '重复创建应返回同一批次');
    assert.equal(c2.created, false);

    let sum = await runAtbJson(['batch', 'summary'], p.root);
    assert.equal(sum.batch.status, 'prepared', '无运行登记时为待启动（prepared）');
    assert.ok(sum.batch.prompt === c1.prompt, '摘要应能取回同一提示词（重复制不建新批次）');

    const next = await runAtbJson(['batch', 'next', '--by', 'w1'], p.root);
    sum = await runAtbJson(['batch', 'summary'], p.root);
    assert.equal(sum.batch.status, 'running', '有效运行登记后才为执行中（running）');
    assert.equal(sum.current.itemId, next.itemId);

    // 正常收尾在途项（claim → report --run → receipt）
    assert.equal((await runAtb(['claim', next.itemId, '--by', 'w1'], p.root)).code, 0);
    assert.equal((await runAtb(['report', next.itemId, '--summary', 'ok', '--by', 'w1', '--run', next.runId], p.root)).code, 0);
    assert.equal((await runAtb(['run', 'receipt', next.runId, '--result', 'reported', '--report-ref', 'test-report.md'], p.root)).code, 0);

    // 暂停后续：在途已收尾，next 返回暂停说明
    assert.equal((await runAtb(['batch', 'pause'], p.root)).code, 0);
    const paused = await runAtb(['batch', 'next', '--by', 'w1', '--json'], p.root);
    assert.notEqual(paused.code, 0);
    assert.match(paused.out + paused.err, /暂停/, '应说明暂停');
    assert.equal((await runAtb(['batch', 'pause', '--off'], p.root)).code, 0, '应支持解除暂停');
  } finally {
    try { fs.rmSync(p.root, { recursive: true, force: true }); } catch {}
  }
});

// ---------- Z13 失败停止批次 ----------

t('Z13 failed 收尾：批次转 needs_attention，不再领取，条目不被逐一标失败', async () => {
  const p = await mkProject(3);
  try {
    await runAtbJson(['batch', 'create'], p.root);
    const next = await runAtbJson(['batch', 'next', '--by', 'w1'], p.root);
    assert.equal((await runAtb(['claim', next.itemId, '--by', 'w1'], p.root)).code, 0);

    // 超长 reason 拒绝：错误正文须落盘，不得塞进回执
    const long = await runAtb(['run', 'receipt', next.runId, '--result', 'failed', '--reason', 'x'.repeat(300)], p.root);
    assert.notEqual(long.code, 0, '超长 reason 应被拒');
    assert.match(long.out + long.err, /长度|reason|落盘/, '应提示长度限制');

    const fin = await runAtbJson(['run', 'receipt', next.runId, '--result', 'failed', '--reason', '测试失败', '--no-safe-to-continue'], p.root);
    assert.equal(fin.result, 'failed');

    const chk = await runAtbJson(['batch', 'check'], p.root);
    assert.equal(chk.nextAction, 'needs_attention', '失败应转人工核对');
    const nxt = await runAtb(['batch', 'next', '--by', 'w1', '--json'], p.root);
    assert.notEqual(nxt.code, 0, 'needs_attention 期间不得再领取');

    // 未领条目保持 planned，没有被批量标失败
    const list = await runAtbJson(['list', '--status', 'planned'], p.root);
    assert.equal(list.count, 2, '其余 2 项应仍为 planned');
  } finally {
    try { fs.rmSync(p.root, { recursive: true, force: true }); } catch {}
  }
});

// ---------- 冲突换单（CLI 路径） ----------

t('Z24 CLI 认领冲突：run release 后换单继续', async () => {
  const p = await mkProject(2);
  try {
    await runAtbJson(['batch', 'create'], p.root);
    const next = await runAtbJson(['batch', 'next', '--by', 'w1'], p.root);
    // 模拟他人认领（测试进程直接改状态，绕过互斥注入竞态）
    const stFile = path.join(p.root, 'docs', 'agent-team-board');
    const reqDir = fs.readdirSync(path.join(stFile, 'requirements')).find((d) => d === next.itemId);
    assert.ok(reqDir, '条目目录应存在');
    const statusFile = path.join(stFile, 'requirements', reqDir, 'status.json');
    const st = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    st.status = 'in-progress';
    st.owner = 'someone-else';
    fs.writeFileSync(statusFile, JSON.stringify(st, null, 2) + '\n');

    const rel = await runAtb(['run', 'release', next.runId, '--reason', '认领冲突'], p.root);
    assert.equal(rel.code, 0, `释放预留应成功：${rel.err}`);

    const next2 = await runAtbJson(['batch', 'next', '--by', 'w1'], p.root);
    assert.notEqual(next2.itemId, next.itemId, '应换单到下一个可实施项');
  } finally {
    try { fs.rmSync(p.root, { recursive: true, force: true }); } catch {}
  }
});

// ---------- REQ-20260910-027 开发人员设置移除（原 REQ-20260907-002 CLI --dev 下线） ----------

t('REQ-20260910-027 --dev 张三：CLI 明确 die 提示已移除，不产生批次', async () => {
  const p = await mkProject(1);
  try {
    const r = await runAtb(['batch', 'create', '--dev', '张三'], p.root);
    assert.notEqual(r.code, 0, '--dev 应被拒绝');
    assert.ok(r.err.includes('开发人员设置已移除'), 'die 信息（stderr）应说明开发人员设置已移除');
    const sum = await runAtbJson(['batch', 'summary'], p.root).catch(() => null);
    assert.equal(sum, null, '拒绝后不应产生批次');
  } finally {
    try { fs.rmSync(p.root, { recursive: true, force: true }); } catch {}
  }
});

t('REQ-20260910-027 不带 --dev：create/summary/check/next 正常，响应与文本均无 developer/开发人员', async () => {
  const p = await mkProject(1);
  try {
    const created = await runAtbJson(['batch', 'create'], p.root);
    assert.equal('developer' in created, false, 'create 响应不应再带 developer');
    assert.ok(!created.prompt.includes('会话名'), '不得加会话命名指令');
    const sum = await runAtbJson(['batch', 'summary'], p.root);
    assert.equal('developer' in sum.batch, false, 'summary 不应带 developer');
    const txt = await runAtb(['batch', 'summary'], p.root);
    assert.ok(!txt.out.includes('开发人员'), 'summary 文本不显示开发人员');
    const next = await runAtbJson(['batch', 'next', '--by', 'w1'], p.root);
    assert.ok(next.runId, 'next 应正常领取');
    const chk = await runAtbJson(['batch', 'check'], p.root);
    assert.equal(chk.nextAction, 'needs_attention', '在途未收尾：check 正常返回');
  } finally {
    try { fs.rmSync(p.root, { recursive: true, force: true }); } catch {}
  }
});

// ---------- BUG-20260908-023 终态批次暂停拒绝（CLI） ----------

t('Z14b（BUG-20260908-023）CLI：已终止批次 batch pause 报错且批次状态不变；正常批次暂停/恢复不回归', async () => {
  const p = await mkProject(1);
  try {
    const created = await runAtbJson(['batch', 'create'], p.root);
    const batchId = created.batchId;
    assert.equal((await runAtb(['batch', 'abort', '--batch', batchId], p.root)).code, 0, 'abort 应成功');

    // 已终止批次暂停：非零退出 + 明确错误，不静默成功
    let r = await runAtb(['batch', 'pause', '--batch', batchId], p.root);
    assert.notEqual(r.code, 0, '对已终止批次 pause 应失败');
    assert.match(r.err, /不能暂停\/恢复/, `错误信息应说明终态不可暂停（得到：${r.err}）`);
    // 恢复方向同样拒绝
    r = await runAtb(['batch', 'pause', '--batch', batchId, '--off'], p.root);
    assert.notEqual(r.code, 0, '对已终止批次恢复 pause 应失败');
    // 批次状态不被改动（summary --json 读取仍是终止终态；BUG-20260909-001 起公共视图透出 aborted）
    const sum = await runAtbJson(['batch', 'summary', '--batch', batchId], p.root);
    assert.equal(sum.batch.status, 'finished', 'CLI pause 报错后批次保持 finished');
    assert.match(String(sum.notice || ''), /人工终止/, '摘要应仍按人工终止口径提示');
    assert.equal(sum.batch.pauseRequested, false, '不得写入 pauseRequested');
    assert.equal(sum.batch.abortRequested, true, '公共视图应透出 abortRequested=true（BUG-20260909-001）');
    assert.equal(sum.batch.aborted, true, '公共视图应透出 aborted=true（BUG-20260909-001）');

    // 正常批次暂停/恢复回归：新增候选 → 新批次，暂停/恢复照常
    const nr = await runAtb(['new', 'req', '正常CLI暂停'], p.root);
    const m = nr.out.match(/(REQ-\d{8}-\d{3})/);
    assert.ok(m, `应输出单号：${nr.out}`);
    assert.equal((await runAtb(['status', m[1], 'accepted'], p.root)).code, 0);
    assert.equal((await runAtb(['status', m[1], 'planned'], p.root)).code, 0);
    const created2 = await runAtbJson(['batch', 'create'], p.root);
    assert.notEqual(created2.batchId, batchId, '终态批次不再占队列，应创建新批次');
    assert.equal((await runAtb(['batch', 'pause', '--batch', created2.batchId], p.root)).code, 0, `正常批次 pause 应成功（${r.err}）`);
    const paused = await runAtb(['batch', 'next', '--by', 'w1', '--json'], p.root);
    assert.notEqual(paused.code, 0);
    assert.match(paused.out + paused.err, /暂停/, '应说明暂停');
    assert.equal((await runAtb(['batch', 'pause', '--batch', created2.batchId, '--off'], p.root)).code, 0, '正常批次恢复应成功');
  } finally {
    try { fs.rmSync(p.root, { recursive: true, force: true }); } catch {}
  }
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
