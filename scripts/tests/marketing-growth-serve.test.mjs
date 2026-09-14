#!/usr/bin/env node
// REQ-20260910-022 project-growth 工作流 —— 服务接口 + CLI 回执测试（S1~S5）
// 覆盖：growth 读态（技能缺口）、任务创建（提示词带 CLI 命令与项目根；非法入参 400）、
// 运行详情（404）、候选采纳 / 保留（幂等 / 400 fields）、CLI 回执（成功 / 幂等 / 跨项目拒绝 / show 跨会话读取）。
// 用法：node scripts/tests/marketing-growth-serve.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as mkt from '../lib/marketing-store.mjs';
import * as growth from '../lib/growth-store.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ATB = path.join(pluginRoot, 'scripts', 'atb.mjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function req(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 6000,
    }, (rs) => {
      const chunks = [];
      rs.on('data', (c) => chunks.push(c));
      rs.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString() || '{}'); } catch {}
        resolve({ status: rs.statusCode, json, text: buf.toString() });
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (payload) r.write(payload);
    r.end();
  });
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const draftOf = (candidates = []) => ({
  facts: ['激活 12 人'], assumptions: ['首屏是瓶颈'], toConfirm: ['价位'],
  evidence: ['profile.json'], missing: ['访客分母'], advice: [], insufficient: false, candidates,
});

t('S1~S5 /api/marketing/growth 接口与 CLI 回执', async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-growth-serve-')));
  const root = path.join(tmp, 'proj');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'README.md'), '# Demo\n\n增长服务测试项目。\n');
  const dataDir = core.initData(root);
  mkt.initProfile(dataDir, { projectRoot: root, by: 'board' });
  // 预置一个渠道（供采纳候选引用）
  const ch = mkt.createChannel(dataDir, {
    data: { platform: 'X', priority: 'medium' }, by: 'board',
  }).channel;

  const port = 31000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(tmp, 'reg.json') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const P = `?project=${encodeURIComponent(root)}`;
  const cli = (args, opts = {}) => spawnSync(process.execPath, [ATB, ...args], {
    encoding: 'utf8', timeout: 30000, ...opts,
  });
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try { await req(port, 'GET', '/api/health'); up = true; break; } catch {}
    }
    assert.ok(up, '服务应启动');

    // S1：growth 读态——初始化后 skills.installed=false（列能力缺口，不假称已运行）
    let r = await req(port, 'GET', `/api/marketing/growth${P}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.initialized, true);
    assert.equal(r.json.skills.installed, false);
    assert.ok(Array.isArray(r.json.skills.byType.pricing) && r.json.skills.byType.pricing.length, '按入口列能力缺口');
    assert.deepEqual(r.json.runs, [], '暂无运行记录');

    // S2：任务创建——合法 201（提示词含统一 CLI 回执命令与项目根）；非法 type / 缺观察期 400
    r = await req(port, 'POST', `/api/marketing/growth/run${P}`, { type: 'pricing' });
    assert.equal(r.status, 201);
    const run1 = r.json.run;
    assert.equal(run1.status, 'waiting');
    assert.ok(r.json.prompt.includes(`growth receipt ${run1.id}`), '提示词含 CLI 回执命令');
    assert.ok(r.json.prompt.includes(root), '提示词含项目根（--dir）');
    assert.ok(r.json.prompt.includes(ATB), '提示词含 atb CLI 绝对路径');
    r = await req(port, 'POST', `/api/marketing/growth/run${P}`, { type: 'hot' });
    assert.equal(r.status, 400);
    assert.ok(r.json.fields && r.json.fields.type, '非法类型定位字段');
    r = await req(port, 'POST', `/api/marketing/growth/run${P}`, { type: 'review' });
    assert.equal(r.status, 400);
    assert.ok(r.json.fields && r.json.fields.observation, '复盘缺观察期定位字段');
    r = await req(port, 'POST', `/api/marketing/growth/run${P}`, { type: 'review', from: '2026-09-01', to: '2026-09-07' });
    assert.equal(r.status, 201);
    assert.deepEqual(r.json.run.observation, { from: '2026-09-01', to: '2026-09-07' });
    // 面板资料预览：按入口类型采集输入引用及版本
    r = await req(port, 'GET', `/api/marketing/growth/inputs${P}&type=pricing`);
    assert.equal(r.status, 200);
    assert.ok(r.json.inputs.some((i) => i.ref === 'profile.json' && i.revision === 1), '预览含档案及版本');

    // S3：详情 200 / 未知 404
    r = await req(port, 'GET', `/api/marketing/growth/run/${run1.id}${P}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.id, run1.id);
    assert.ok(r.json.prompt, '详情含提示词留档');
    r = await req(port, 'GET', `/api/marketing/growth/run/ar-nope${P}`);
    assert.equal(r.status, 404);

    // S5a：CLI 回执——合法草稿写入成功，输出一行 JSON 回执
    const draftFile = path.join(tmp, 'draft.json');
    fs.writeFileSync(draftFile, JSON.stringify({
      ...draftOf([{
        id: 'c1', kind: 'channel', title: '新渠道：V2EX',
        reason: '受众聚集', verify: '两周三帖观察订阅',
        data: { platform: 'V2EX', priority: 'medium' },
      }]),
      runId: run1.id,
    }));
    let c = cli(['growth', 'receipt', run1.id, '--file', draftFile, '--dir', root, '--session', 'ext-cli-1']);
    assert.equal(c.status, 0, `CLI 回执应成功：${c.stderr}`);
    const receipt = JSON.parse(c.stdout.trim().split('\n').at(-1));
    assert.equal(receipt.ok, true);
    assert.equal(receipt.runId, run1.id);
    assert.equal(receipt.result, 'success');
    assert.equal(receipt.status, 'received');
    assert.equal(receipt.draftRef, `agent-runs/${run1.id}/draft.md`);

    // S5b：重复提交幂等
    c = cli(['growth', 'receipt', run1.id, '--file', draftFile, '--dir', root]);
    assert.equal(c.status, 0);
    const dup = JSON.parse(c.stdout.trim().split('\n').at(-1));
    assert.equal(dup.duplicate, true, '幂等跳过');

    // S5c：跨项目（错误 --dir）拒绝
    const other = path.join(tmp, 'other');
    fs.mkdirSync(other);
    core.initData(other);
    fs.writeFileSync(path.join(other, 'README.md'), '# Other\n');
    c = cli(['growth', 'receipt', run1.id, '--file', draftFile, '--dir', other]);
    assert.notEqual(c.status, 0, '跨项目写入应失败');
    assert.match(c.stderr, /不存在|项目/, '跨项目错误说明');
    assert.ok(!fs.existsSync(path.join(other, 'docs', 'agent-team-board', 'marketing', 'agent-runs', run1.id)), '未写入另一项目');

    // S5d：show 跨会话读取（接续上下文）
    c = cli(['growth', 'show', run1.id, '--dir', root]);
    assert.equal(c.status, 0);
    assert.match(c.stdout, /received|ext-cli-1/, 'show 输出任务状态与会话');

    // S4：候选采纳 / 保留——合法 200；非法数据 400 fields；重复采纳幂等
    r = await req(port, 'POST', `/api/marketing/growth/run/adopt${P}`, { id: run1.id, candidateId: 'c1' });
    assert.equal(r.status, 200);
    assert.match(r.json.result.ref, /^channels\//, '渠道候选落地');
    assert.equal(r.json.run.draft.candidates.find((x) => x.id === 'c1').state, 'adopted');
    r = await req(port, 'POST', `/api/marketing/growth/run/adopt${P}`, { id: run1.id, candidateId: 'c1' });
    assert.equal(r.status, 200);
    assert.equal(r.json.already, true, '重复采纳幂等');
    assert.equal(mkt.readBoard(dataDir).channels.filter((x) => x.platform === 'V2EX').length, 1, '不重复创建');

    // 非法候选数据 → 400 fields（候选保持 pending）
    const run2 = growth.createAgentRun(dataDir, { projectRoot: root, atbPath: ATB, type: 'channels', by: 'board' }).run;
    growth.saveAgentRunReceipt(dataDir, {
      id: run2.id,
      draft: draftOf([
        { id: 'bad', kind: 'activity', title: '缺渠道', data: { title: '无渠道' } },
        { id: 'keep', kind: 'channel', title: '暂不做', data: { platform: 'Test' } },
      ]),
      session: 's', by: 'board',
    });
    r = await req(port, 'POST', `/api/marketing/growth/run/adopt${P}`, { id: run2.id, candidateId: 'bad' });
    assert.equal(r.status, 400);
    assert.ok(r.json.fields && r.json.fields.channelId, '底层校验定位字段');
    r = await req(port, 'POST', `/api/marketing/growth/run/keep${P}`, { id: run2.id, candidateId: 'keep' });
    assert.equal(r.status, 200);
    r = await req(port, 'POST', `/api/marketing/growth/run/keep${P}`, { id: run2.id, candidateId: 'bad' });
    assert.equal(r.status, 200);
    assert.equal(r.json.run.status, 'done', '候选全部处理完 → done');
    r = await req(port, 'GET', `/api/marketing/growth${P}`);
    assert.equal(r.json.runs.find((x) => x.id === run1.id).result, 'success', '运行记录含执行结果');
    assert.equal(r.json.runs.find((x) => x.id === run2.id).candidateCounts.kept, 2, '保留计数');
  } finally {
    server.kill('SIGKILL');
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
