#!/usr/bin/env node
// REQ-20260907-003 需求完善 —— Status Board 服务接口测试（R11）
// REQ-20260908-020 起改造：候选=已接受未完善；仅子代理模式（codex 亦返回主调度提示词，不再后台逐项 exec）；
// 新增 /api/refine/abort 终止、/api/tasks/settings 批量任务设置、/api/board 已接受单 refineState 徽标数据。
// 用法：node scripts/tests/refine-serve.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function req(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 8000,
    }, (rs) => {
      let out = '';
      rs.on('data', (c) => { out += c; });
      rs.on('end', () => { try { resolve({ status: rs.statusCode, json: JSON.parse(out || '{}') }); } catch { resolve({ status: rs.statusCode, json: null, raw: out }); } });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (payload) r.write(payload);
    r.end();
  });
}

function atbRun(root, args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'atb.mjs'), ...args, '--dir', root], { stdio: 'ignore' });
    p.on('close', resolve);
  });
}

// BUG-20260908-015：需要读取 stdout（--json）的 CLI 辅助
function atbOut(root, args) {
  const r = spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', 'atb.mjs'), ...args, '--dir', root], { encoding: 'utf8', timeout: 30_000 });
  if (r.status !== 0) throw new Error(`atb ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r.stdout || '';
}

function atbInit(root) {
  return atbRun(root, ['init']);
}

async function atbNewAccepted(root, type, title, desc) {
  const args = ['new', type, title];
  if (desc) args.push('--desc', desc);
  await atbRun(root, args);
  // REQ-20260908-020：完善候选 = 已接受未完善；新建后人工接受
  const dataDir = path.join(root, 'docs', 'agent-team-board');
  const ids = fs.readdirSync(path.join(dataDir, type === 'req' ? 'requirements' : 'bugs')).sort();
  const id = ids[ids.length - 1];
  await atbRun(root, ['status', id, 'accepted']);
  return id;
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('R11 服务接口：候选（已接受未完善）/ 子代理模式创建 / 终止 / 批量任务设置 / 徽标数据', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-refine-serve-'));
  const root = path.join(tmp, 'proj');
  fs.mkdirSync(root);
  await atbInit(root);
  // 已接受未完善单 ×3（其中一个描述含 UI 关键词）
  await atbNewAccepted(root, 'req', '待完善需求');
  await atbNewAccepted(root, 'bug', '待完善 Bug');
  await atbNewAccepted(root, 'req', 'UI 待完善', '新增一个筛选面板，顶部放刷新按钮，点击按钮后列表刷新并显示加载状态，底部保留分页控件。');
  // 待接受单不进候选
  await atbRun(root, ['new', 'req', '待接受不进']);

  const port = 33000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(tmp, 'reg.json') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const P = `&project=${encodeURIComponent(root)}`;
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try { await req(port, 'GET', '/api/health'); up = true; break; } catch {}
    }
    assert.ok(up, '服务应启动');

    // candidates：已接受未完善单，带缺失原因（待接受单不进）
    let r = await req(port, 'GET', `/api/refine/candidates?${P}`);
    assert.equal(r.status, 200, `candidates 应 200（${JSON.stringify(r.json)}）`);
    assert.equal(r.json.candidates.length, 3, '三个已接受未完善条目');
    assert.ok(r.json.candidates.every((c) => /^((REQ|BUG)-)/.test(c.id)));
    const uiCand = r.json.candidates.find((x) => x.title === 'UI 待完善');
    assert.ok(uiCand, 'UI 待完善应入候选（验收标准仍为占位）');
    assert.ok(uiCand.reasons.includes('涉及 UI 需界面展示'), `UI 描述缺界面展示应报原因（得到 ${uiCand.reasons}）`);

    // /api/board：已接受单带 refineState 徽标数据（默认未完善）；待接受单不带
    r = await req(port, 'GET', `/api/board?${P}`);
    assert.equal(r.status, 200);
    const acceptedItems = r.json.items.filter((x) => x.status === 'accepted');
    assert.equal(acceptedItems.length, 3);
    for (const it of acceptedItems) assert.equal(it.refineState, 'unrefined', '已接受单默认未完善');
    const subItem = r.json.items.find((x) => x.title === '待接受不进');
    assert.ok(subItem && subItem.refineState === undefined, '待接受单不带完善状态字段');

    // 子代理模式创建（zcode）：返回主调度提示词；重复创建被拒（REQ-20260913-003）
    r = await req(port, 'POST', `/api/refine/create?${P}`, { mode: 'zcode', developer: '张三' });
    assert.equal(r.status, 200, `zcode create 应成功（${JSON.stringify(r.json)}）`);
    assert.equal('batchId' in r.json, false, '创建响应不再透出批次号（REQ-20260913-003）');
    assert.ok(r.json.prompt.includes('atb refine next'), 'zcode create 返回主调度提示词');
    assert.equal(r.json.counts.candidates, 3);
    r = await req(port, 'POST', `/api/refine/create?${P}`, { mode: 'zcode', developer: '张三' });
    assert.equal(r.status, 400, '重复创建应被拒（不幂等返回）');
    assert.match(String(r.json && r.json.error || ''), /已有进行中的完善任务/);

    // current：缺省队首批次 + 计数 + 记录（公开视图不再透出批次号）
    r = await req(port, 'GET', `/api/refine/current?${P}`);
    assert.equal(r.status, 200);
    assert.equal('batchId' in r.json.batch, false, '公开视图不再透出批次号（REQ-20260913-003）');
    assert.equal(r.json.counts.remaining, 3);

    // pause / 恢复（缺省解析队首，不再传批次号——REQ-20260913-003 前端口径）
    r = await req(port, 'POST', `/api/refine/pause?${P}`, { paused: true });
    assert.equal(r.status, 200);
    assert.equal(r.json.pauseRequested, true);
    r = await req(port, 'POST', `/api/refine/pause?${P}`, { paused: false });
    assert.equal(r.json.pauseRequested, false);

    // codex 子代理模式：无需本机 codex CLI，返回差异化的主调度提示词，不再逐项入队后台执行
    const freshRoot2 = await atbNewAccepted(root, 'req', 'codex 子代理待完善');
    assert.ok(freshRoot2);
    await req(port, 'POST', `/api/refine/pause?${P}`, { paused: false });
    // 先终止当前未开始的完善任务（REQ-20260908-020 终止链路）
    r = await req(port, 'POST', `/api/refine/abort?${P}`, {});
    assert.equal(r.status, 200, `abort 应成功（${JSON.stringify(r.json)}）`);
    assert.equal(r.json.aborted, true);
    assert.match(r.json.notice, /人工停止/, '终止提示含在途子代理人工停止指引');
    r = await req(port, 'GET', `/api/refine/current?${P}`);
    assert.equal(r.json.batch.aborted, true, '任务转终止态');
    assert.equal(r.json.counts.remaining, 0, '剩余项全部出局');

    // 通用子代理模式创建（REQ-20260909-011：mode 入参忽略，提示词单一通用版）：返回 prompt，无 runs
    r = await req(port, 'POST', `/api/refine/create?${P}`, { mode: 'codex' });
    assert.equal(r.status, 200, `通用子代理 create 应成功（${JSON.stringify(r.json)}）`);
    assert.equal('batchId' in r.json, false, '创建响应不再透出批次号（REQ-20260913-003）');
    assert.equal(r.json.agent, 'subagent', '返回通用子代理模式标识（mode 入参被忽略）');
    assert.ok(r.json.prompt && !/zcode|Zcode|codex|Codex|general-purpose/.test(r.json.prompt), '返回单一通用主调度提示词（无执行端字样）');
    assert.equal(r.json.runs, undefined, '不再入队后台执行');

    // 批量任务设置：默认值 + 保存校验 + 持久化（REQ-20260909-011：agents/models 提交被忽略，仅流转开关生效）
    r = await req(port, 'GET', `/api/tasks/settings?${P}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.settings.agents.refine, ['zcode', 'codex']);
    assert.equal(r.json.settings.models.refine.zcode.level, 'high', '完善默认高智能');
    assert.equal(r.json.settings.models.develop.zcode.level, 'medium', '开发默认一般智能');
    r = await req(port, 'POST', `/api/tasks/settings?${P}`, { agents: { refine: ['zcode'] }, models: { refine: { zcode: { model: 'glm-5.3', level: 'medium' } } } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.settings.agents.refine, ['zcode', 'codex'], 'agents 提交被忽略（保持缺省）');
    assert.equal(r.json.settings.models.refine.zcode.model, '');
    r = await req(port, 'GET', `/api/tasks/settings?${P}`);
    assert.deepEqual(r.json.settings.agents.develop, ['zcode', 'codex'], '两类任务 Agent 展示互不影响');
    // REQ-20260909-011：agents 提交一律忽略——全部隐藏入参同样不落（200 兼容旧客户端）
    r = await req(port, 'POST', `/api/tasks/settings?${P}`, { agents: { refine: [] } });
    assert.equal(r.status, 200, 'agents 入参不再被持久化但请求兼容（不报错）');
    assert.deepEqual(r.json.settings.agents.refine, ['zcode', 'codex'], '全部隐藏入参被忽略（不再持久化）');
  } finally {
    server.kill();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});

t('R11b（BUG-20260908-015）已终止批次 /api/refine/pause 返回错误而非静默成功；批次终态与队首口径不被污染', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-refine-pause-'));
  const root = path.join(tmp, 'proj');
  fs.mkdirSync(root);
  await atbInit(root);
  await atbNewAccepted(root, 'req', '终止后暂停');
  const created = JSON.parse((await atbOut(root, ['refine', 'create', '--json'])).split('\n').filter(Boolean).pop());
  const batchId = created.batchId;

  const port = 33000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(tmp, 'reg.json') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const P = `&project=${encodeURIComponent(root)}`;
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try { await req(port, 'GET', '/api/health'); up = true; break; } catch {}
    }
    assert.ok(up, '服务应启动');

    await req(port, 'POST', `/api/refine/abort?${P}`, { batchId });
    // 已终止批次暂停：400 错误 + 明确原因，不返回 ok: true
    let r = await req(port, 'POST', `/api/refine/pause?${P}`, { batchId, paused: true });
    assert.equal(r.status, 400, '已终止批次 pause 应返回错误状态码');
    assert.ok(r.json && r.json.error, '错误响应应带 error 信息');
    assert.match(r.json.error, /不能暂停\/恢复/, `错误信息应说明终态不可暂停（得到 ${r.json && r.json.error}）`);
    assert.notEqual(r.json.ok, true, '不得返回 ok: true');
    // 恢复方向同样拒绝
    r = await req(port, 'POST', `/api/refine/pause?${P}`, { batchId, paused: false });
    assert.equal(r.status, 400, '已终止批次恢复 pause 同样返回错误');
    // 批次终态未被改动；current 的队首口径不再把它当未结束任务（回退最新仅供面板收尾展示）
    r = await req(port, 'GET', `/api/refine/current?${P}`);
    assert.equal(r.json.batch.aborted, true);
    assert.equal(r.json.batch.status, 'finished', '批次保持终止终态 finished');
    assert.equal(r.json.batch.pauseRequested, false, '不得写入 pauseRequested');
    assert.equal(r.json.nextAction, 'stop', '终止批次核对口径保持 stop');
  } finally {
    server.kill();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});

// BUG-20260908-018：/api/refine/current 须带 recordsTotal（首屏 5 条 + 总数），
// 余下记录经既有 /api/refine/records 分页补齐，接口层不得静默截断
t('R11c（BUG-20260908-018）current 带 recordsTotal；records 分页可取全部（>5 不静默截断）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-refine-records-'));
  const root = path.join(tmp, 'proj');
  fs.mkdirSync(root);
  await atbInit(root);
  const ids = [];
  for (let i = 1; i <= 6; i++) ids.push(await atbNewAccepted(root, 'req', `分页批次第${i}项`));
  const created = JSON.parse((await atbOut(root, ['refine', 'create', '--json'])).split('\n').filter(Boolean).pop());
  const batchId = created.batchId;
  for (const id of ids) {
    const got = JSON.parse((await atbOut(root, ['refine', 'next', '--by', 'w1', '--json'])).split('\n').filter(Boolean).pop());
    fs.writeFileSync(path.join(got.itemDir, 'README.md'), `# ${id}\n\n## 描述\n补全后的完整说明，足够长且超过阈值三十个字符以上。\n`);
    await atbRun(root, ['refine', 'done', got.runId, '--summary', '补全文档']);
  }

  const port = 33000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(tmp, 'reg.json') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const P = `&project=${encodeURIComponent(root)}`;
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try { await req(port, 'GET', '/api/health'); up = true; break; } catch {}
    }
    assert.ok(up, '服务应启动');
    // current：首屏 5 条 + recordsTotal=6（不再只有 5 条而无总数）
    let r = await req(port, 'GET', `/api/refine/current?${P}&batchId=${encodeURIComponent(batchId)}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.records.length, 5, 'current 首屏记录保持 5 条');
    assert.equal(r.json.recordsTotal, 6, 'current 必须返回 recordsTotal（批次 run 总数）');
    assert.equal(r.json.counts.done, 6, '计数与记录总数自洽（完成 6）');
    // records 分页：offset=5 取余下 1 条，total=6
    r = await req(port, 'GET', `/api/refine/records?${P}&batchId=${encodeURIComponent(batchId)}&offset=5&limit=10`);
    assert.equal(r.status, 200);
    assert.equal(r.json.total, 6);
    assert.equal(r.json.records.length, 1, '分页接口可取第 6 条（修复前被截断的记录）');
  } finally {
    server.kill();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
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
