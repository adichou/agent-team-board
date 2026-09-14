#!/usr/bin/env node
// REQ-20260910-019 营销档案 / 定位与定价版本管理 —— 服务接口测试（H1~H7）
// 覆盖：state 两态（未初始化营销 / 未初始化看板）、init、profile 保存、409 冲突、
// 400 字段校验、定价版本链与显式设当前、同名不同路径项目隔离、静态资源
// 用法：node scripts/tests/marketing-serve.test.mjs

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

const positioning = (over = {}) => ({
  intro: '简介', stage: 'validating', markets: '中文', audience: '开发者', scenarios: '跟踪',
  painPoints: '割裂', alternatives: 'Trello', differentiators: '本地优先', links: 'https://e.com',
  stageGoal: '验证首次使用价值', primaryMetric: '激活人数', budget: 100, weeklyHours: 6, ...over,
});
const pricing = (over = {}) => ({
  model: 'subscription', currency: 'CNY', cycle: 'monthly',
  packages: [{ name: '专业版', benefits: '全部功能', price: 29 }],
  costBasis: '成本', competitorBasis: '竞品', validationMethod: '落地页测试', ...over,
});

t('H1~H7 /api/marketing* 接口全链路', async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-marketing-serve-')));
  const root = path.join(tmp, 'proj');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'README.md'), '# Demo\n\n服务端测试项目简介。\n');
  const initRes = await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'atb.mjs'), 'init', '--dir', root], { stdio: 'ignore' });
    p.on('close', resolve);
  });
  assert.equal(initRes, 0, 'atb init 应成功');

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

    // H1：未初始化营销 → initialized:false（项目可正常打开）
    let r = await req(port, 'GET', `/api/marketing/state${P}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.initialized, false);

    // H1：未初始化看板的项目同样空态
    const root2 = path.join(tmp, 'bare');
    fs.mkdirSync(root2);
    r = await req(port, 'GET', `/api/marketing/state?project=${encodeURIComponent(root2)}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.initialized, false, '未初始化看板也返回空态');

    // H2：init（未初始化看板 400 → 已初始化看板 201 带 README 草稿）
    r = await req(port, 'POST', `/api/marketing/init?project=${encodeURIComponent(root2)}`, {});
    assert.equal(r.status, 400, '未初始化看板应 400');
    r = await req(port, 'POST', `/api/marketing/init${P}`, {});
    assert.equal(r.status, 201);
    assert.equal(r.json.profile.positioning.intro, '服务端测试项目简介。', 'README 草稿');
    assert.equal(r.json.initialized, true);
    r = await req(port, 'POST', `/api/marketing/init${P}`, {});
    assert.equal(r.status, 400, '重复初始化应 400');

    // H2：profile 保存并回读
    r = await req(port, 'POST', `/api/marketing/profile${P}`, {
      revision: 1,
      positioning: positioning(),
      evidence: [{ type: 'fact', content: '4/5 愿付费', source: '访谈', collectedAt: '2026-09-10' }],
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.profile.revision, 2);
    r = await req(port, 'GET', `/api/marketing/state${P}`);
    assert.equal(r.json.profile.positioning.audience, '开发者');
    assert.equal(r.json.profile.evidence[0].type, 'fact');

    // H3：过期 revision → 409 + conflict:true；最新 revision 可保存
    const before = fs.readFileSync(path.join(root, 'docs', 'agent-team-board', 'marketing', 'profile.json'), 'utf8');
    r = await req(port, 'POST', `/api/marketing/profile${P}`, { revision: 1, positioning: positioning({ intro: '陈旧' }), evidence: [] });
    assert.equal(r.status, 409);
    assert.equal(r.json.conflict, true);
    assert.equal(r.json.currentRevision, 2, '响应携带服务端最新 revision');
    assert.equal(fs.readFileSync(path.join(root, 'docs', 'agent-team-board', 'marketing', 'profile.json'), 'utf8'), before, '冲突不改旧文件');
    r = await req(port, 'POST', `/api/marketing/profile${P}`, { revision: 2, positioning: positioning({ intro: '第三版' }), evidence: [] });
    assert.equal(r.status, 200);
    assert.equal(r.json.profile.revision, 3);

    // H4：字段校验 400 + fields
    r = await req(port, 'POST', `/api/marketing/profile${P}`, { revision: 3, positioning: positioning({ budget: -1 }), evidence: [] });
    assert.equal(r.status, 400);
    assert.ok(r.json.fields && r.json.fields['positioning.budget'], '预算错误定位字段');
    r = await req(port, 'POST', `/api/marketing/pricing${P}`, { ...pricing(), currency: '' });
    assert.equal(r.status, 400);
    assert.ok(r.json.fields && r.json.fields.currency, '缺币种定位字段');
    r = await req(port, 'POST', `/api/marketing/pricing${P}`, { ...pricing(), cycle: '' });
    assert.equal(r.status, 400);
    assert.ok(r.json.fields && r.json.fields.cycle, '缺订阅周期定位字段');
    r = await req(port, 'POST', `/api/marketing/pricing${P}`, { ...pricing(), packages: [{ name: 'X', benefits: 'b', price: '贵' }] });
    assert.equal(r.status, 400);
    assert.ok(r.json.fields && r.json.fields['packages.0.price'], '非法金额定位字段');

    // H5：定价版本链 + 显式设当前
    r = await req(port, 'POST', `/api/marketing/pricing${P}`, pricing());
    assert.equal(r.status, 201);
    assert.equal(r.json.version.version, 'v1');
    assert.equal(r.json.state.profile.currentPricing, null, '候选不会自动成为当前');
    r = await req(port, 'POST', `/api/marketing/pricing${P}`, pricing({ packages: [{ name: '专业版', benefits: '全部功能', price: 39 }] }));
    assert.equal(r.json.version.version, 'v2');
    const v1Raw = fs.readFileSync(path.join(root, 'docs', 'agent-team-board', 'marketing', 'pricing', 'v1.json'), 'utf8');

    r = await req(port, 'POST', `/api/marketing/pricing/current${P}`, { version: 'v1' });
    assert.equal(r.status, 200);
    assert.equal(r.json.profile.currentPricing, 'v1');
    r = await req(port, 'POST', `/api/marketing/pricing/current${P}`, { version: 'v2' });
    assert.equal(r.json.profile.currentPricing, 'v2', '显式切换到 v2');
    assert.equal(fs.readFileSync(path.join(root, 'docs', 'agent-team-board', 'marketing', 'pricing', 'v1.json'), 'utf8'), v1Raw, 'v1 内容不变');
    r = await req(port, 'POST', `/api/marketing/pricing/current${P}`, { version: 'v9' });
    assert.equal(r.status, 400, '未知版本拒绝');

    // H6：同名不同路径项目隔离
    const twinA = path.join(tmp, 'twin', 'proj');
    const twinB = path.join(tmp, 'twin', 'sub', 'proj');
    fs.mkdirSync(twinA, { recursive: true });
    fs.mkdirSync(twinB, { recursive: true });
    fs.writeFileSync(path.join(twinA, 'README.md'), '# A\n\n甲简介。\n');
    fs.writeFileSync(path.join(twinB, 'README.md'), '# B\n\n乙简介。\n');
    await Promise.all([twinA, twinB].map((p) => new Promise((resolve) => {
      const c = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'atb.mjs'), 'init', '--dir', p], { stdio: 'ignore' });
      c.on('close', resolve);
    })));
    const PA = `?project=${encodeURIComponent(twinA)}`;
    const PB = `?project=${encodeURIComponent(twinB)}`;
    await req(port, 'POST', `/api/marketing/init${PA}`, {});
    await req(port, 'POST', `/api/marketing/init${PB}`, {});
    await req(port, 'POST', `/api/marketing/profile${PA}`, { revision: 1, positioning: positioning({ intro: '甲的定位' }), evidence: [] });
    r = await req(port, 'GET', `/api/marketing/state${PB}`);
    assert.equal(r.json.profile.positioning.intro, '乙简介。', '乙不受甲影响');
    assert.equal(r.json.profile.revision, 1);

    // H7：静态资源与页面骨架
    r = await new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port, path: '/marketing.js' }, (rs) => {
        const chunks = [];
        rs.on('data', (c) => chunks.push(c));
        rs.on('end', () => resolve({ status: rs.statusCode, body: Buffer.concat(chunks).toString() }));
      }).on('error', reject);
    });
    assert.equal(r.status, 200);
    assert.ok(r.body.includes('ATBMarketing'), 'marketing.js 应挂载全局对象');
    r = await new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port, path: '/' }, (rs) => {
        const chunks = [];
        rs.on('data', (c) => chunks.push(c));
        rs.on('end', () => resolve({ status: rs.statusCode, body: Buffer.concat(chunks).toString() }));
      }).on('error', reject);
    });
    assert.equal(r.status, 200);
    // REQ-20260911-002：营销入口暂态隐藏——页签按钮收敛，但容器与脚本引用保留（模块代码零改动）
    assert.ok(r.body.includes('id="marketingView"'), 'index.html 含营销视图容器');
    assert.ok(r.body.includes('/marketing.js'), 'index.html 引入 marketing.js（模块代码保留）');
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
