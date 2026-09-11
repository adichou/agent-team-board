#!/usr/bin/env node
// REQ-20260910-020 渠道 / 实验 / 内容行动看板 —— 服务接口测试（V1~V7）
// 覆盖：board 读取、渠道→实验→多条行动链路与刷新保持、状态推进 400/200、
// 409 冲突、复制实验、行动创建开发需求（submitted / 幂等 / 隔离）、前端骨架契约
// 用法：node scripts/tests/marketing-board-serve.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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
      timeout: 6000,
    }, (rs) => {
      const chunks = [];
      rs.on('data', (c) => chunks.push(c));
      rs.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString() || '{}'); } catch {}
        resolve({ status: rs.statusCode, json });
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

const channelBody = { platform: 'Reddit', link: 'https://reddit.com/r/dev', audience: '开发者', languages: '英文', formats: '帖子', priority: 'high', reason: '人群集中', weeklyEffort: 3, dataAccess: '后台数据', capabilities: '可发帖' };
const experimentBody = (channelId, over = {}) => ({
  channelId, hypothesis: '两周 8 帖带来 100 次访问', primaryMetric: '访问数',
  observationStart: '2026-09-01', observationEnd: '2026-09-14', successCriteria: '≥100 次',
  currency: 'CNY', budgetPlanned: 0, budgetActual: null, hoursPlanned: 6, hoursActual: null,
  pricingVersion: null, decision: null, decisionBasis: '', ...over,
});
const activityBody = (channelId, experimentId, over = {}) => ({
  channelId, experimentId, title: '演示视频', contentDraft: '一分钟演示视频文案草稿',
  materialRefs: 'demo.mp4', plannedAt: '2026-09-10T10:00', timezone: 'Asia/Shanghai',
  owner: '李四', nextStep: '', publishUrl: '', publishedAt: '', publishCredential: '', ...over,
});

t('V1~V7 /api/marketing 渠道与行动接口全链路', async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-mkt-board-serve-')));
  const root = path.join(tmp, 'proj');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'README.md'), '# Demo\n\n看板服务测试项目。\n');
  await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'atb.mjs'), 'init', '--dir', root], { stdio: 'ignore' });
    p.on('close', resolve);
  });

  const port = 31000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: path.join(tmp, 'reg.json') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const P = `?project=${encodeURIComponent(root)}`;
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try { await req(port, 'GET', '/api/health'); up = true; break; } catch {}
    }
    assert.ok(up, '服务应启动');

    // V1：未初始化营销 → board 空态；初始化后空集合
    let r = await req(port, 'GET', `/api/marketing/board${P}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.initialized, false);
    await req(port, 'POST', `/api/marketing/init${P}`, {});
    r = await req(port, 'GET', `/api/marketing/board${P}`);
    assert.equal(r.json.initialized, true);
    assert.deepEqual(r.json.channels, []);
    assert.deepEqual(r.json.experiments, []);
    assert.deepEqual(r.json.activities, []);

    // V2：渠道 → 实验 → 两条行动；刷新关联保持
    r = await req(port, 'POST', `/api/marketing/channel${P}`, { data: channelBody });
    assert.equal(r.status, 201);
    const ch = r.json.channel;
    assert.equal(ch.platform, 'Reddit');
    assert.equal(ch.revision, 1);

    // 渠道校验 400
    r = await req(port, 'POST', `/api/marketing/channel${P}`, { data: { ...channelBody, platform: '' } });
    assert.equal(r.status, 400);
    assert.ok(r.json.fields && r.json.fields.platform, '平台缺失定位字段');

    r = await req(port, 'POST', `/api/marketing/experiment${P}`, { data: experimentBody(ch.id) });
    assert.equal(r.status, 201);
    const exp = r.json.experiment;

    r = await req(port, 'POST', `/api/marketing/activity${P}`, { data: activityBody(ch.id, exp.id, { contentDraft: '' }) });
    assert.equal(r.status, 201);
    const a1 = r.json.activity;
    assert.equal(a1.status, 'draft');
    r = await req(port, 'POST', `/api/marketing/activity${P}`, { data: activityBody(ch.id, exp.id, { title: '第二条' }) });
    const a2 = r.json.activity;

    // 刷新（重新 GET）关联保持
    r = await req(port, 'GET', `/api/marketing/board${P}`);
    assert.equal(r.json.channels.length, 1);
    assert.equal(r.json.experiments.length, 1);
    assert.equal(r.json.activities.length, 2);
    assert.equal(r.json.activities.every((a) => a.channelId === ch.id && a.experimentId === exp.id), true, '关联保持');

    // V3：状态推进校验——缺内容草稿 400 状态不变
    r = await req(port, 'POST', `/api/marketing/activity/status${P}`, { id: a1.id, revision: 1, to: 'pending' });
    assert.equal(r.status, 400);
    assert.ok(r.json.fields && r.json.fields.contentDraft, '缺草稿定位字段');
    r = await req(port, 'GET', `/api/marketing/board${P}`);
    assert.equal(r.json.activities.find((a) => a.id === a1.id).status, 'draft', '状态不变');

    // 保存内容 → 待发布（不带正文字段的推进请求）
    r = await req(port, 'POST', `/api/marketing/activity/save${P}`, { id: a1.id, revision: 1, data: activityBody(ch.id, exp.id, { contentDraft: '正式文案' }) });
    assert.equal(r.status, 200);
    r = await req(port, 'POST', `/api/marketing/activity/status${P}`, { id: a1.id, revision: 2, to: 'pending' });
    assert.equal(r.status, 200);
    const advanceCall = r.json.activity;
    assert.equal(advanceCall.status, 'pending');

    // 已发布缺凭据 400
    r = await req(port, 'POST', `/api/marketing/activity/status${P}`, { id: a1.id, revision: 3, to: 'published' });
    assert.equal(r.status, 400);
    assert.ok(r.json.fields && (r.json.fields.publishedAt || r.json.fields.publishUrl), '缺发布信息定位字段');
    r = await req(port, 'POST', `/api/marketing/activity/status${P}`, {
      id: a1.id, revision: 3, to: 'published', payload: { publishedAt: '2026-09-10T09:30', publishUrl: 'https://e/p1' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.activity.status, 'published');

    // 复盘缺依据 400 → 补齐 200
    await req(port, 'POST', `/api/marketing/activity/status${P}`, { id: a1.id, revision: 4, to: 'observing' });
    r = await req(port, 'POST', `/api/marketing/activity/status${P}`, { id: a1.id, revision: 5, to: 'reviewed', payload: { decision: 'continue' } });
    assert.equal(r.status, 400);
    assert.ok(r.json.fields && r.json.fields.reviewBasis, '缺复盘依据定位字段');
    r = await req(port, 'POST', `/api/marketing/activity/status${P}`, {
      id: a1.id, revision: 5, to: 'reviewed', payload: { reviewBasis: '112 次访问', decision: 'continue' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.activity.decision, 'continue');

    // 停止需原因
    r = await req(port, 'POST', `/api/marketing/activity/status${P}`, { id: a2.id, revision: 1, to: 'stopped' });
    assert.equal(r.status, 400);
    assert.ok(r.json.fields && r.json.fields.stopReason, '缺停止原因定位字段');
    r = await req(port, 'POST', `/api/marketing/activity/status${P}`, { id: a2.id, revision: 1, to: 'stopped', payload: { stopReason: '优先级下调' } });
    assert.equal(r.status, 200);

    // 更正：缺原因 400 → 带原因 200
    r = await req(port, 'POST', `/api/marketing/activity/correct${P}`, { id: a2.id, revision: 2, to: 'draft', reason: '' });
    assert.equal(r.status, 400);
    r = await req(port, 'POST', `/api/marketing/activity/correct${P}`, { id: a2.id, revision: 2, to: 'draft', reason: '误停止' });
    assert.equal(r.status, 200);
    assert.equal(r.json.activity.status, 'draft');

    // V4：409 冲突
    r = await req(port, 'POST', `/api/marketing/channel/save${P}`, { id: ch.id, revision: 99, data: channelBody });
    assert.equal(r.status, 409);
    assert.equal(r.json.conflict, true);
    assert.equal(r.json.currentRevision, 1, '携带服务端 revision');

    // V4：实验绑定版本不随当前指针变化
    await req(port, 'POST', `/api/marketing/pricing${P}`, { model: 'subscription', currency: 'CNY', cycle: 'monthly', packages: [] });
    r = await req(port, 'POST', `/api/marketing/experiment/save${P}`, {
      id: exp.id, revision: 1, data: experimentBody(ch.id, { pricingVersion: 'v1' }),
    });
    assert.equal(r.status, 200);
    await req(port, 'POST', `/api/marketing/pricing${P}`, { model: 'onetime', currency: 'USD', cycle: '', packages: [] });
    await req(port, 'POST', `/api/marketing/pricing/current${P}`, { version: 'v2' });
    r = await req(port, 'GET', `/api/marketing/board${P}`);
    assert.equal(r.json.experiments.find((x) => x.id === exp.id).pricingVersion, 'v1', '历史实验绑定版本不变');

    // V5：复制实验——新 ID、保留来源、行动置草稿
    r = await req(port, 'POST', `/api/marketing/experiment/copy${P}`, { id: exp.id });
    assert.equal(r.status, 201);
    const neo = r.json.experiment;
    assert.notEqual(neo.id, exp.id);
    assert.equal(neo.copiedFrom, exp.id);
    const copied = r.json.board.activities.filter((a) => a.experimentId === neo.id);
    assert.equal(copied.length, 2, '两条行动都复制');
    assert.ok(copied.every((a) => a.status === 'draft'), '行动置为草稿');

    // V6：行动创建开发需求
    r = await req(port, 'POST', `/api/marketing/activity/req${P}`, { id: a1.id, key: 'landing', title: '落地页埋点', description: '补充转化埋点' });
    assert.equal(r.status, 201);
    assert.equal(r.json.created, true);
    const reqId = r.json.link.id;
    assert.match(reqId, /^REQ-/);
    const st = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'agent-team-board', 'requirements', reqId, 'status.json'), 'utf8'));
    assert.equal(st.status, 'submitted', 'REQ 进入 submitted');
    const reqReadme = fs.readFileSync(path.join(root, 'docs', 'agent-team-board', 'requirements', reqId, 'README.md'), 'utf8');
    assert.ok(reqReadme.includes(a1.id), '双向关联：README 含行动编号');
    // 同 key 重试幂等
    r = await req(port, 'POST', `/api/marketing/activity/req${P}`, { id: a1.id, key: 'landing', title: '落地页埋点', description: '补充转化埋点' });
    assert.equal(r.status, 200);
    assert.equal(r.json.created, false);
    assert.equal(r.json.link.id, reqId);
    const reqDirs = fs.readdirSync(path.join(root, 'docs', 'agent-team-board', 'requirements')).filter((x) => x.startsWith('REQ-'));
    assert.equal(reqDirs.length, 1, '不重复创建');

    // V6：同名不同路径项目隔离
    const twinA = path.join(tmp, 'twin', 'proj');
    const twinB = path.join(tmp, 'twin', 'sub', 'proj');
    fs.mkdirSync(twinA, { recursive: true });
    fs.mkdirSync(twinB, { recursive: true });
    await Promise.all([twinA, twinB].map((p) => new Promise((resolve) => {
      const c = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'atb.mjs'), 'init', '--dir', p], { stdio: 'ignore' });
      c.on('close', resolve);
    })));
    const PA = `?project=${encodeURIComponent(twinA)}`;
    const PB = `?project=${encodeURIComponent(twinB)}`;
    await req(port, 'POST', `/api/marketing/init${PA}`, {});
    await req(port, 'POST', `/api/marketing/init${PB}`, {});
    await req(port, 'POST', `/api/marketing/channel${PA}`, { data: channelBody });
    r = await req(port, 'GET', `/api/marketing/board${PB}`);
    assert.equal(r.json.channels.length, 0, '乙不受甲影响');
    r = await req(port, 'GET', `/api/marketing/board${PA}`);
    assert.equal(r.json.channels.length, 1);

    // V7：前端骨架——渠道与行动页签启用；效果与复盘已由 REQ-20260910-021 交付启用
    const mktJs = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'marketing.js'), 'utf8');
    const chanTab = mktJs.match(/\{ key: 'channels', label: '渠道与行动'[^}]*\}/);
    assert.ok(chanTab, '存在渠道与行动页签定义');
    assert.ok(!/disabled: true/.test(chanTab[0]), '渠道与行动页签不再禁用');
    const revTab = mktJs.match(/\{ key: 'review', label: '效果与复盘'[^}]*\}/);
    assert.ok(revTab, '存在效果与复盘页签定义');
    assert.ok(!/disabled: true/.test(revTab[0]), '效果与复盘页签已启用（REQ-20260910-021 交付）');
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
