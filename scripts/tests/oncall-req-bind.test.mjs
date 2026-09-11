#!/usr/bin/env node
// REQ-20260908-022 需求绑定讨论 —— 测试（R1~R7）
// 覆盖：createTicket reqId 关联与校验、listTickets 按需求过滤、需求文档上下文注入（readTicketFull /
// codex worker 提示词 / oncall show）、CLI --req 参数、serve API、前端静态契约（双向可见）
// 用法：node scripts/tests/oncall-req-bind.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as oncall from '../lib/oncall-store.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function mkProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-oncall-req-')));
  core.initData(root);
  const dataDir = core.dataDirFrom(root);
  return { root, dataDir };
}

function mkReq(dataDir, title = '示例需求') {
  return core.createItem(dataDir, { type: 'requirement', title, description: `# ${title} 的描述正文`, by: 'board' });
}

/* ---------- R1/R2/R3/R4：数据层 ---------- */

t('R1 store：reqId 关联落盘与校验（缺省 null / 非法格式 / 不存在 / Bug 编号拒绝）', () => {
  const { dataDir } = mkProject();
  const req = mkReq(dataDir);
  const bug = core.createItem(dataDir, { type: 'bug', title: '顺带的 Bug', description: 'b', by: 'board' });

  const a = oncall.createTicket(dataDir, { title: '澄清验收口径', question: 'q', by: 'board', req: req.id });
  assert.equal(a.reqId, req.id, '创建应落 reqId');
  assert.equal(a.status, 'pending', '绑定讨论同样待回复，无需人工接受');
  assert.equal(oncall.getTicket(dataDir, a.id).reqId, req.id, 'ticket.json 应持久化 reqId');

  const b = oncall.createTicket(dataDir, { title: '普通讨论', question: 'q', by: 'board' });
  assert.equal(b.reqId, null, '缺省 req → reqId=null（老单语义不变）');
  const c = oncall.createTicket(dataDir, { title: '空串等价缺省', question: 'q', by: 'board', req: '' });
  assert.equal(c.reqId, null, '空串 req 等价缺省');

  assert.throws(() => oncall.createTicket(dataDir, { title: 't', question: 'q', by: 'board', req: 'REQ-XX' }), /非法|REQ/, '非法格式应拒绝');
  assert.throws(() => oncall.createTicket(dataDir, { title: 't', question: 'q', by: 'board', req: 'REQ-20990101-999' }), /找不到/, '不存在的需求应拒绝');
  assert.throws(() => oncall.createTicket(dataDir, { title: 't', question: 'q', by: 'board', req: bug.id }), /需求/, 'Bug 编号不支持绑定（仅需求）');
});

t('R2 store：卡片带 reqId；listTickets 按需求过滤（可与状态过滤组合）', () => {
  const { dataDir } = mkProject();
  const req1 = mkReq(dataDir, '需求一');
  const req2 = mkReq(dataDir, '需求二');

  const a1 = oncall.createTicket(dataDir, { title: 'A1', question: 'q', by: 'board', req: req1.id });
  const a2 = oncall.createTicket(dataDir, { title: 'A2', question: 'q', by: 'board', req: req1.id });
  const b1 = oncall.createTicket(dataDir, { title: 'B1', question: 'q', by: 'board', req: req2.id });
  oncall.createTicket(dataDir, { title: 'U', question: 'q', by: 'board' });

  const all = oncall.listTickets(dataDir);
  assert.equal(all.length, 4);
  assert.equal(all.find((x) => x.id === a1.id).reqId, req1.id, '卡片应带 reqId');
  assert.equal(all.find((x) => x.id === b1.id).reqId, req2.id);
  assert.equal(all.find((x) => x.title === 'U').reqId, null, '未绑定卡片 reqId=null');

  const ofReq1 = oncall.listTickets(dataDir, { reqId: req1.id });
  assert.deepEqual(ofReq1.map((x) => x.title), ['A1', 'A2'], '按需求过滤');

  oncall.dispatchTickets(dataDir, { ids: [a1.id], mode: 'zcode', staff: '', by: 'board', kind: 'single' });
  const pendingOfReq1 = oncall.listTickets(dataDir, { reqId: req1.id, status: 'pending' });
  assert.deepEqual(pendingOfReq1.map((x) => x.title), ['A2'], '需求过滤与状态过滤可组合');

  assert.deepEqual(oncall.listTickets(dataDir, { reqId: 'REQ-20990101-999' }), [], '过滤无匹配返回空（不抛错）');
});

t('R3 上下文：readTicketFull 带 req 元信息与三文档全文；需求删除后 missing 不崩；未绑定单不变', () => {
  const { dataDir } = mkProject();
  const req = mkReq(dataDir, '需求标题甲');
  const dir = core.resolveItemDir(dataDir, req.id).dir;

  const a = oncall.createTicket(dataDir, { title: 't', question: 'q', by: 'board', req: req.id });
  const full = oncall.readTicketFull(dataDir, a.id);
  assert.equal(full.reqId, req.id, '全文带 reqId');
  assert.equal(full.req.id, req.id);
  assert.equal(full.req.title, '需求标题甲');
  assert.equal(full.req.status, 'submitted');
  assert.equal(full.req.missing, false);
  const names = (full.req.docs || []).map((d) => d.name);
  assert.deepEqual(names, ['README.md', 'design.md', 'test-cases.md'], '应带 README/design/test-cases 全文');
  assert.match(full.req.docs[0].content, /需求标题甲 的描述正文/, 'README 描述正文应全文带出');

  // 需求被删除：讨论单不崩、req 标记 missing
  fs.rmSync(dir, { recursive: true, force: true });
  const after = oncall.readTicketFull(dataDir, a.id);
  assert.equal(after.reqId, req.id, 'reqId 保留');
  assert.equal(after.req.missing, true, '需求删除后标记 missing');
  assert.deepEqual(after.req.docs, [], '上下文为空不崩');

  // 未绑定单：req 为 null，行为不变
  const u = oncall.createTicket(dataDir, { title: 'U', question: 'q', by: 'board' });
  const uFull = oncall.readTicketFull(dataDir, u.id);
  assert.equal(uFull.reqId, null);
  assert.equal(uFull.req, null);
});

t('R4 codex 提示词：绑定单注入归属需求节（元信息 + 三文档全文）；未绑定单无该节', () => {
  const { dataDir } = mkProject();
  const req = mkReq(dataDir, '需求标题乙');
  const a = oncall.createTicket(dataDir, { title: '追问设计取舍', question: '为什么这样设计', by: 'board', req: req.id });
  const prompt = oncall.buildOncallWorkerPrompt(dataDir, a.id);
  assert.match(prompt, new RegExp(`归属需求：${req.id}（需求标题乙，状态 submitted）`), '应含归属需求元信息行');
  for (const name of ['README.md', 'design.md', 'test-cases.md']) {
    assert.ok(prompt.includes(`【${name}】`), `应含 ${name} 全文标记`);
  }
  assert.match(prompt, /需求标题乙 的描述正文/, 'README 正文应注入');
  assert.match(prompt, /只读回答/, '只读口径保留');

  const u = oncall.createTicket(dataDir, { title: 'U', question: 'q', by: 'board' });
  assert.ok(!oncall.buildOncallWorkerPrompt(dataDir, u.id).includes('归属需求'), '未绑定单提示词不变');
});

/* ---------- R5：CLI ---------- */

const runCli = (args, cwd) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'atb.mjs'), ...args, '--dir', cwd], {
    cwd, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  p.stdout.on('data', (c) => { out += c; });
  p.stderr.on('data', (c) => { err += c; });
  p.on('close', (code) => resolve({ code, out, err }));
});

t('R5 CLI：new --req 创建；list --req 过滤并显示 [REQ-…]；show 输出归属需求与文档上下文', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-oncall-req-cli-')));
  let r = await runCli(['init'], root);
  assert.equal(r.code, 0, `init 应成功（stderr：${r.err}）`);
  r = await runCli(['new', 'req', '需求标题丙', '--desc', 'CLI 需求描述'], root);
  assert.equal(r.code, 0, `new req 应成功（stderr：${r.err}）`);
  r = await runCli(['list', '--json'], root);
  const reqId = JSON.parse(r.out.slice(r.out.indexOf('{'))).items[0].id;

  r = await runCli(['oncall', 'new', '--title', '澄清需求', '--question', 'q1', '--req', reqId], root);
  assert.equal(r.code, 0, `oncall new --req 应成功（stderr：${r.err}）`);
  assert.match(r.out, /ASK-\d{8}-001/);
  await runCli(['oncall', 'new', '--title', '无关讨论', '--question', 'q2'], root);

  r = await runCli(['oncall', 'list', '--req', reqId, '--json'], root);
  const list = JSON.parse(r.out.slice(r.out.indexOf('{')));
  assert.equal(list.count, 1, 'list --req 应只含绑定单');
  assert.equal(list.tickets[0].reqId, reqId);

  r = await runCli(['oncall', 'list', '--req', reqId], root);
  assert.match(r.out, new RegExp(`\\[${reqId}\\]`), '文本列表应显示 [REQ-…] 标记');

  const askId = list.tickets[0].id;
  r = await runCli(['oncall', 'show', askId], root);
  assert.match(r.out, new RegExp(`归属需求：${reqId}（需求标题丙，状态 submitted）`), 'show 应含归属需求行');
  assert.match(r.out, /【README\.md】/, 'show 应含 README 全文');
  assert.match(r.out, /【design\.md】/, 'show 应含 design 全文');
  assert.match(r.out, /【test-cases\.md】/, 'show 应含 test-cases 全文');
  assert.match(r.out, /CLI 需求描述/, 'show 应注入需求描述正文');

  r = await runCli(['oncall', 'show', askId, '--json'], root);
  const show = JSON.parse(r.out.slice(r.out.indexOf('{')));
  assert.equal(show.req.id, reqId, 'show --json 应含 req.id');
  assert.ok(show.req.docs.length >= 1, 'show --json 应含文档上下文');

  // 非法 --req 应失败
  r = await runCli(['oncall', 'new', '--title', 'x', '--req', 'REQ-20990101-999'], root);
  assert.notEqual(r.code, 0, '不存在的 --req 应失败');

  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
});

/* ---------- R6：serve API ---------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function reqHttp(port, method, pathname, body) {
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

t('R6 serve：创建带 req、/api/oncall/tickets?req= 过滤、board/详情带 reqId/req、非法 req 400', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-oncall-req-serve-'));
  const root = path.join(tmp, 'proj');
  fs.mkdirSync(root);
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
      try { await reqHttp(port, 'GET', '/api/health'); up = true; break; } catch {}
    }
    assert.ok(up, '服务应启动');

    let r = await reqHttp(port, 'POST', `/api/new${P}`, { type: 'req', title: '需求标题丁', description: 'API 需求描述' });
    assert.equal(r.status, 201, `创建需求应成功（${JSON.stringify(r.json)}`);
    const reqId = r.json.id;

    // 创建绑定讨论
    r = await reqHttp(port, 'POST', `/api/oncall/ticket${P}`, { title: '评审 design 取舍', question: 'q', req: reqId });
    assert.equal(r.status, 200, `创建绑定讨论应成功（${JSON.stringify(r.json)}`);
    const askId = r.json.id;
    assert.equal(r.json.reqId, reqId, '响应应带 reqId');
    await reqHttp(port, 'POST', `/api/oncall/ticket${P}`, { title: '无关讨论', question: 'q' });

    // board 卡片带 reqId
    r = await reqHttp(port, 'GET', `/api/oncall/board${P}`);
    const card = r.json.tickets.find((x) => x.id === askId);
    assert.equal(card.reqId, reqId, 'board 卡片应带 reqId');

    // 按需求过滤端点（需求抽屉区块数据源）
    r = await reqHttp(port, 'GET', `/api/oncall/tickets${P}&req=${encodeURIComponent(reqId)}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.tickets.length, 1, '按需求过滤应只含绑定单');
    assert.equal(r.json.tickets[0].id, askId);
    r = await reqHttp(port, 'GET', `/api/oncall/tickets${P}&req=${encodeURIComponent('REQ-20990101-999')}`);
    assert.equal(r.json.tickets.length, 0, '无匹配返回空');

    // 详情带 req 上下文
    r = await reqHttp(port, 'GET', `/api/oncall/ticket/${askId}${P}`);
    assert.equal(r.json.req.id, reqId);
    assert.equal(r.json.req.missing, false);
    assert.ok(r.json.req.docs.length >= 1, '详情应含文档上下文');

    // 空串 req 等价缺省；非法 req 400
    r = await reqHttp(port, 'POST', `/api/oncall/ticket${P}`, { title: '空串等价缺省', question: 'q', req: '' });
    assert.equal(r.status, 200);
    assert.equal(r.json.reqId, null);
    r = await reqHttp(port, 'POST', `/api/oncall/ticket${P}`, { title: 'x', question: 'q', req: 'REQ-20990101-999' });
    assert.equal(r.status, 400, '不存在的 req 应 400');
    r = await reqHttp(port, 'POST', `/api/oncall/ticket${P}`, { title: 'x', question: 'q', req: 'BUG-20990101-999' });
    assert.equal(r.status, 400, 'Bug 编号应 400');
  } finally {
    server.kill();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});

/* ---------- R7：前端静态契约 ---------- */

t('R7 UI：REQ-20260909-004 起讨论不绑定需求——需求抽屉旧绑定记录只读保留（两态口径），双向跳转接缝不变', () => {
  const html = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  const oncallJs = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'oncall.js'), 'utf8');
  const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');

  // 统一新建弹窗：讨论类型不再有关联需求输入（REQ-20260909-004 开放式讨论）
  assert.ok(!html.includes('id="fReq"'), '新建弹窗不应再有关联需求输入 fReq');
  assert.ok(!app.includes("req: $('#fReq')"), '提交创建不再携带 req');

  // 需求详情抽屉：旧绑定讨论记录区块（只读保留，创建入口已移除）
  assert.match(app, /关联讨论（旧绑定记录）/, '需求抽屉应有「关联讨论（旧绑定记录）」区块');
  assert.ok(!app.includes('id="reqDiscNew"'), '不再提供「＋ 发起讨论」入口（新讨论不绑定需求）');
  assert.match(app, /\/api\/oncall\/tickets/, '仍调用按需求过滤端点读取旧绑定讨论');
  assert.match(app, /无关联讨论记录/, '应有空态说明（引导改用文档讨论区块）');
  assert.match(app, /atb:open-req/, '应监听讨论侧跳回需求的事件');
  assert.match(app, /ATBOncall\??\.openItem/, '需求区块应能打开讨论详情（openItem）');
  assert.match(app, /discStatusLabel/, '旧绑定讨论按两态口径（讨论中/已归档）展示');

  // 讨论侧：旧单归属徽标与跳回接缝保留（新讨论不绑定）
  assert.match(oncallJs, /旧绑定/, '讨论详情应显示旧绑定需求');
  assert.match(oncallJs, /oc-req/, '应有归属需求徽标样式类');
  assert.match(oncallJs, /atb:open-req/, '点击归属徽标应派发跳回事件');
  assert.match(oncallJs, /openItem/, 'ATBOncall 应导出 openItem 供需求区块跳入');
  assert.match(css, /\.oc-req/, '样式表应有 oc-req 徽标样式');
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
