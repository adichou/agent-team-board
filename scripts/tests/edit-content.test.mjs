#!/usr/bin/env node
// REQ-20260908-011 待接受条目编辑标题 + 描述（一次改完 + 按钮文案消歧）
// BUG-20260908-022：「修改提示词」功能整体下线——U4/U5 改写为下线契约，新增 C12 报错文案口径
// BUG-20260909-003：入口可见文案统一「✎ 修改」——U1 断言更新，新增 U6 文案统一契约
// 用法：node scripts/tests/edit-content.test.mjs
// 覆盖 test-cases.md 的 C1–C12、U1–U6（U6 见 BUG-20260909-003；U5 回归另由 run-all 全量兜底）。
// 模式对齐 rename-reject.test.mjs：core 集成 + 真实服务 HTTP + CLI 子进程 + UI 静态/沙箱。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as core from '../lib/core.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = path.join(PLUGIN_ROOT, 'scripts', 'server.mjs');
const ATB_CLI = path.join(PLUGIN_ROOT, 'scripts', 'atb.mjs');
const ATB_SRC = fs.readFileSync(ATB_CLI, 'utf8');
const APP_JS = fs.readFileSync(path.join(PLUGIN_ROOT, 'scripts', 'web', 'app.js'), 'utf8');
const STYLE_CSS = fs.readFileSync(path.join(PLUGIN_ROOT, 'scripts', 'web', 'style.css'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tempProject(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `atb-edit-${tag}-`));
  core.initData(root);
  return { root, dataDir: core.dataDirFrom(root) };
}

const firstLine = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8').split('\n')[0];
const readMe = (dir) => fs.readFileSync(path.join(dir, 'README.md'), 'utf8');

// 从 README 全文截取二级节原文（与服务端/前端口径一致，测试侧独立实现以便校验）
function sectionOf(text, heading) {
  const lines = String(text).split('\n');
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start + 1, end).join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
}

// ---------- core：编辑标题 + 描述（C1–C9） ----------

t('C1 submitted 需求同时改标题 + 描述：title、三份文档首行、README 描述节同步，history 一条留痕', () => {
  const { dataDir } = tempProject('c1');
  const it = core.createItem(dataDir, { type: 'requirement', title: '旧标题', description: '旧描述', by: 'test' });
  const st = core.editItem(dataDir, it.id, { title: '新标题', description: '全新描述\n第二行', by: 'human' });
  assert.equal(st.title, '新标题', 'status.title 应更新');
  assert.equal(st.status, 'submitted', '编辑不得变更状态');
  const dir = core.resolveItemDir(dataDir, it.id).dir;
  assert.equal(firstLine(dir, 'README.md'), `# ${it.id} 新标题`, 'README 首行同步');
  assert.equal(firstLine(dir, 'design.md'), `# 设计 — ${it.id} 新标题`, 'design 首行同步');
  assert.equal(firstLine(dir, 'test-cases.md'), `# 测试用例 — ${it.id} 新标题`, 'test-cases 首行同步');
  assert.equal(sectionOf(readMe(dir), '## 描述'), '全新描述\n第二行', 'README 描述节应整体替换为新描述');
  assert.ok(readMe(dir).includes('## 验收标准'), '描述节之后的章节应保留');
  const tail = core.readStatus(dir).history.at(-1);
  assert.equal(`${tail.from}->${tail.to}`, 'submitted->submitted', 'history 追加留痕');
  assert.match(tail.note, /标题 \+ 描述修改/, '留痕应可追溯标题与描述同时修改');
  assert.match(tail.note, /新标题/, '留痕应含新标题');
});

t('C2 submitted Bug（独立与归属）改描述写回「## 现象」节，其余小节不受影响', () => {
  const { dataDir } = tempProject('c2');
  const req = core.createItem(dataDir, { type: 'requirement', title: '宿主需求', by: 'test' });
  const alone = core.createItem(dataDir, { type: 'bug', title: '独立 Bug', description: '独立旧现象', by: 'test' });
  const nested = core.createItem(dataDir, { type: 'bug', title: '归属 Bug', description: '归属旧现象', by: 'test' });
  core.moveBug(dataDir, nested.id, req.id); // 归属 Bug 经 move 构造（存量形态）
  core.editItem(dataDir, alone.id, { description: '独立新现象', by: 'human' });
  core.editItem(dataDir, nested.id, { description: '归属新现象', by: 'human' });
  for (const [bug, expect] of [[alone, '独立新现象'], [nested, '归属新现象']]) {
    const dir = core.resolveItemDir(dataDir, bug.id).dir;
    assert.equal(sectionOf(readMe(dir), '## 现象'), expect, `${bug.id} 现象节应替换`);
    assert.ok(readMe(dir).includes('## 复现步骤'), '复现步骤节应保留');
    assert.ok(readMe(dir).includes('## 期望行为'), '期望行为节应保留');
    assert.equal(bug.title, '独立 Bug' === expect ? '独立 Bug' : bug.title, '仅改描述不得动标题');
    assert.equal(firstLine(dir, 'README.md'), `# ${bug.id} ${bug.title}`, '首行不应变化');
  }
  assert.equal(core.readStatus(core.resolveItemDir(dataDir, alone.id).dir).title, '独立 Bug', 'title 保持');
});

t('C3 仅改描述（标题传当前值或不传）保存成功，不触发「与原标题相同」报错', () => {
  const { dataDir } = tempProject('c3');
  const a = core.createItem(dataDir, { type: 'requirement', title: '保持标题', description: '旧描述', by: 'test' });
  const b = core.createItem(dataDir, { type: 'requirement', title: '保持标题乙', description: '旧描述', by: 'test' });
  const stA = core.editItem(dataDir, a.id, { title: '保持标题', description: '新描述甲', by: 'human' });
  const stB = core.editItem(dataDir, b.id, { description: '新描述乙', by: 'human' });
  assert.equal(stA.title, '保持标题', '标题不变');
  assert.equal(stB.title, '保持标题乙', '标题未传时保持原值');
  assert.match(core.readStatus(core.resolveItemDir(dataDir, a.id).dir).history.at(-1).note, /^描述修改/);
});

t('C4 仅改标题（描述不传）行为与既有 renameItem 一致', () => {
  const { dataDir } = tempProject('c4');
  const a = core.createItem(dataDir, { type: 'requirement', title: '甲旧题', description: '同一描述', by: 'test' });
  const b = core.createItem(dataDir, { type: 'requirement', title: '乙旧题', description: '同一描述', by: 'test' });
  core.renameItem(dataDir, a.id, { title: '甲新题', by: 'human' });
  core.editItem(dataDir, b.id, { title: '乙新题', by: 'human' });
  const dirA = core.resolveItemDir(dataDir, a.id).dir;
  const dirB = core.resolveItemDir(dataDir, b.id).dir;
  assert.equal(firstLine(dirA, 'README.md'), `# ${a.id} 甲新题`);
  assert.equal(firstLine(dirB, 'README.md'), `# ${b.id} 乙新题`);
  assert.equal(firstLine(dirA, 'design.md'), `# 设计 — ${a.id} 甲新题`);
  assert.equal(firstLine(dirB, 'design.md'), `# 设计 — ${b.id} 乙新题`);
  assert.equal(sectionOf(readMe(dirA), '## 描述'), sectionOf(readMe(dirB), '## 描述'), '仅改标题不得动描述节');
  const noteA = core.readStatus(dirA).history.at(-1).note;
  const noteB = core.readStatus(dirB).history.at(-1).note;
  assert.equal(noteA.replace(/甲/g, 'X'), noteB.replace(/乙/g, 'X'), '留痕口径应一致（仅标题词不同）');
});

t('C5 标题与描述均无变化（或均未传）拒绝，明确提示无变化，不写盘', () => {
  const { dataDir } = tempProject('c5');
  const it = core.createItem(dataDir, { type: 'requirement', title: '原标题', description: '原描述', by: 'test' });
  const dir = core.resolveItemDir(dataDir, it.id).dir;
  const before = readMe(dir);
  const histBefore = core.readStatus(dir).history.length;
  assert.throws(() => core.editItem(dataDir, it.id, { title: '原标题', description: '原描述', by: 'human' }), /均无变化/);
  assert.throws(() => core.editItem(dataDir, it.id, { by: 'human' }), /均无变化/);
  assert.equal(readMe(dir), before, 'README 不得被写');
  assert.equal(core.readStatus(dir).history.length, histBefore, '不得追加留痕');
});

t('C6 标题非法（空 / 超 120 字）拒绝，且描述不落盘（原子性）', () => {
  const { dataDir } = tempProject('c6');
  const it = core.createItem(dataDir, { type: 'requirement', title: '原标题', description: '原描述', by: 'test' });
  const dir = core.resolveItemDir(dataDir, it.id).dir;
  assert.throws(() => core.editItem(dataDir, it.id, { title: '   ', description: '新描述', by: 'human' }), /标题不能为空/);
  assert.throws(() => core.editItem(dataDir, it.id, { title: '长'.repeat(121), description: '新描述', by: 'human' }), /120/);
  assert.equal(sectionOf(readMe(dir), '## 描述'), '原描述', '描述不得先落盘');
  assert.equal(core.readStatus(dir).title, '原标题', '标题保持');
});

t('C7 accepted / in-progress / done 状态拒绝编辑并报错（与 renameItem 同口径）', () => {
  const { dataDir } = tempProject('c7');
  const acc = core.createItem(dataDir, { type: 'requirement', title: '已接受', by: 'test' });
  core.setStatus(dataDir, acc.id, 'accepted', { by: 'human' });
  const dev = core.createItem(dataDir, { type: 'requirement', title: '开发中', by: 'test' });
  core.setStatus(dataDir, dev.id, 'accepted', { by: 'human' });
  core.claim(dataDir, dev.id, 'tester');
  core.report(dataDir, dev.id, { summary: '收尾释放实施互斥', by: 'tester' });
  const fin = core.createItem(dataDir, { type: 'requirement', title: '已完成', by: 'test' });
  core.setStatus(dataDir, fin.id, 'accepted', { by: 'human' });
  core.claim(dataDir, fin.id, 'tester');
  core.setStatus(dataDir, fin.id, 'done', { by: 'human' });
  for (const id of [acc.id, dev.id, fin.id]) {
    const st = core.getItemDetail(dataDir, id);
    assert.throws(() => core.editItem(dataDir, id, { title: '改不掉', description: '也改不掉', by: 'human' }), core.AtbError, `${st.status} 应拒绝`);
    assert.equal(core.getItemDetail(dataDir, id).title, st.title, `${st.status} 标题应保持不变`);
  }
});

t('C8 README 缺描述节（被人工删改）时明确报错，不做模糊写入、标题也不落盘', () => {
  const { dataDir } = tempProject('c8');
  const it = core.createItem(dataDir, { type: 'requirement', title: '原标题', description: '原描述', by: 'test' });
  const dir = core.resolveItemDir(dataDir, it.id).dir;
  const broken = readMe(dir).replace('## 描述', '## 需求说明'); // 节标题被人工改写
  fs.writeFileSync(path.join(dir, 'README.md'), broken);
  assert.throws(() => core.editItem(dataDir, it.id, { title: '新标题', description: '新描述', by: 'human' }), /## 描述.*节|缺少「## 描述」节/);
  assert.ok(readMe(dir).includes('## 需求说明'), '原文不得被改写');
  assert.equal(core.readStatus(dir).title, '原标题', '整单拒绝：标题不得先落盘');
});

t('C9 描述清空提交——写回「（待补充）」占位（与创建模板一致）', () => {
  const { dataDir } = tempProject('c9');
  const it = core.createItem(dataDir, { type: 'bug', title: '缺陷', description: '有现象', by: 'test' });
  const st = core.editItem(dataDir, it.id, { description: '', by: 'human' });
  assert.equal(st.title, '缺陷', '标题不受影响');
  const dir = core.resolveItemDir(dataDir, it.id).dir;
  assert.equal(sectionOf(readMe(dir), '## 现象'), '（待补充）', '清空应写回占位');
});

// ---------- server HTTP 集成（C10） ----------

function httpRequest(port, method, p, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const rq = http.request({
      hostname: '127.0.0.1', port, path: p, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 5000,
    }, (rs) => {
      let out = '';
      rs.on('data', (c) => { out += c; });
      rs.on('end', () => resolve({ code: rs.statusCode, body: out }));
    });
    rq.on('error', reject);
    rq.on('timeout', () => { rq.destroy(); reject(new Error('request timeout')); });
    if (payload) rq.write(payload);
    rq.end();
  });
}

t('C10 服务端：POST /api/item/:id/content 合法更新返回 200 与最新 status；非 submitted、非法参数返回 4xx', async () => {
  const { root, dataDir } = tempProject('c10');
  const sub = core.createItem(dataDir, { type: 'requirement', title: '待接受编辑', description: '旧描述', by: 'test' });
  const acc = core.createItem(dataDir, { type: 'bug', title: '已接受编辑', by: 'test' });
  core.setStatus(dataDir, acc.id, 'accepted', { by: 'human' });

  const port = 26000 + Math.floor(Math.random() * 8000);
  const registry = path.join(os.tmpdir(), `atb-reg-${process.pid}-${Math.random().toString(16).slice(2)}.json`);
  const child = spawn(process.execPath, [SERVER], {
    cwd: root,
    env: { ...process.env, ATB_PORT: String(port), ATB_HOST: '127.0.0.1', ATB_REGISTRY: registry },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      await sleep(100);
      up = await httpRequest(port, 'GET', '/api/health').then((r) => r.code === 200).catch(() => false);
    }
    assert.ok(up, '测试服务应启动');

    const ok = await httpRequest(port, 'POST', `/api/item/${sub.id}/content`, { title: '改后标题', description: '改后描述' });
    assert.equal(ok.code, 200, `合法编辑应成功：${ok.body}`);
    const resp = JSON.parse(ok.body);
    assert.equal(resp.title, '改后标题', '响应应带最新 status');
    const dir = core.resolveItemDir(dataDir, sub.id).dir;
    assert.equal(core.readStatus(dir).title, '改后标题', '服务端写入生效');
    assert.equal(sectionOf(readMe(dir), '## 描述'), '改后描述', '描述节写入生效');

    const onlyDesc = await httpRequest(port, 'POST', `/api/item/${sub.id}/content`, { description: '仅改描述' });
    assert.equal(onlyDesc.code, 200, `仅改描述应成功：${onlyDesc.body}`);

    const badState = await httpRequest(port, 'POST', `/api/item/${acc.id}/content`, { title: '不应生效' });
    assert.equal(badState.code, 400, '非 submitted 编辑应按业务错误返回 400');
    const badTitle = await httpRequest(port, 'POST', `/api/item/${sub.id}/content`, { title: '' });
    assert.equal(badTitle.code, 400, '空标题应返回 400');
    const noChange = await httpRequest(port, 'POST', `/api/item/${sub.id}/content`, {});
    assert.equal(noChange.code, 400, '空 body 均未传应返回 400');
  } finally {
    child.kill();
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(registry, { force: true }); } catch {}
  }
});

// ---------- CLI 子进程（C11） ----------

t('C11 CLI：rename 旧用法回归；--desc 与网页同口径生效（--desc - 走 stdin）', () => {
  const { root, dataDir } = tempProject('c11');
  assert.match(ATB_SRC, /atb rename <ID> <新标题>/, 'usage 应保留 rename 旧用法');
  assert.match(ATB_SRC, /core\.editItem\(/, '应调用 core.editItem');

  const old = core.createItem(dataDir, { type: 'requirement', title: '旧用法', description: '旧描述', by: 'test' });
  const both = core.createItem(dataDir, { type: 'requirement', title: '双改', description: '旧描述', by: 'test' });
  const descOnly = core.createItem(dataDir, { type: 'bug', title: '仅描述', description: '旧现象', by: 'test' });

  const r1 = spawnSync(process.execPath, [ATB_CLI, 'rename', old.id, '新用法', '--dir', root], { encoding: 'utf8' });
  assert.equal(r1.status, 0, `rename 旧用法应成功：${r1.stderr}`);
  assert.equal(core.readStatus(core.resolveItemDir(dataDir, old.id).dir).title, '新用法');

  const r2 = spawnSync(process.execPath, [ATB_CLI, 'rename', both.id, '双改新标题', '--desc', '双改新描述', '--dir', root], { encoding: 'utf8' });
  assert.equal(r2.status, 0, `rename --desc 应成功：${r2.stderr}`);
  const dirBoth = core.resolveItemDir(dataDir, both.id).dir;
  assert.equal(core.readStatus(dirBoth).title, '双改新标题');
  assert.equal(sectionOf(readMe(dirBoth), '## 描述'), '双改新描述');

  const r3 = spawnSync(process.execPath, [ATB_CLI, 'rename', descOnly.id, '--desc', '-', '--dir', root], {
    encoding: 'utf8', input: 'stdin 多行描述\n第二行\n',
  });
  assert.equal(r3.status, 0, `--desc - 读 stdin 应成功：${r3.stderr}`);
  const dirDesc = core.resolveItemDir(dataDir, descOnly.id).dir;
  assert.equal(core.readStatus(dirDesc).title, '仅描述', '仅描述：标题保持');
  assert.equal(sectionOf(readMe(dirDesc), '## 现象'), 'stdin 多行描述\n第二行');
});

// ---------- core：报错文案下线口径（C12，BUG-20260908-022） ----------

t('C12 非 submitted 报错文案不再引导「修改提示词」，且仍拒绝改标题/编辑并给出替代途径', () => {
  const { dataDir } = tempProject('c12');
  const acc = core.createItem(dataDir, { type: 'requirement', title: '已接受条目', by: 'test' });
  core.setStatus(dataDir, acc.id, 'accepted', { by: 'human' });
  const grab = (fn) => { try { fn(); return null; } catch (e) { return e; } };
  const errors = [
    grab(() => core.renameItem(dataDir, acc.id, { title: '改不掉', by: 'human' })),
    grab(() => core.editItem(dataDir, acc.id, { title: '改不掉', description: '也改不掉', by: 'human' })),
  ];
  assert.equal(errors.length, 2);
  for (const e of errors) {
    assert.ok(e instanceof core.AtbError, `非 submitted 应仍以 AtbError 拒绝：${e}`);
    assert.ok(!e.message.includes('修改提示词') && !e.message.includes('Status Board「修改」'), `报错不应再引导修改提示词：${e.message}`);
    assert.match(e.message, /直接编辑条目目录|另立新单/, `应给出替代途径：${e.message}`);
  }
  assert.equal(core.readStatus(core.resolveItemDir(dataDir, acc.id).dir).title, '已接受条目', '失败不得落盘');
});

// ---------- UI 静态契约（U1/U2/U4/U5） ----------

t('U1 UI 静态：submitted 卡片与详情页渲染编辑入口（覆盖标题 + 描述），非 submitted 不渲染', () => {
  const row = APP_JS.match(/function reqRowEl\(it\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(row, /\$\{it\.status === 'submitted' \? `[^`]*data-rename-id=/, 'submitted 卡片应有编辑入口');
  assert.match(row, /✎/, '卡片编辑入口应显示 ✎ 图标（BUG-20260910-007 图标化）');
  const drawerBtn = APP_JS.match(/function drawerActionsButtonHtml\(it\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(drawerBtn, /case 'submitted':[\s\S]*data-act="accepted"[\s\S]*data-rename-id=/, '详情页 submitted 应有编辑入口');
  assert.match(drawerBtn, /✎ 修改/, '详情页编辑入口文案应为「✎ 修改」（BUG-20260909-003）');
  assert.match(drawerBtn, /aria-label="编辑 \$\{esc\(it\.id\)\} 标题与描述"/, 'aria-label 应覆盖标题 + 描述');
});

// ---------- UI 静态契约（U6，BUG-20260909-003：入口文案统一「✎ 修改」） ----------

t('U6 UI 静态：卡片编辑入口图标化、抽屉保留「✎ 修改」文案，旧文案「改标题/描述」全部下线；悬停与无障碍名称保留标题/描述与仅待接受语义（BUG-20260909-003；BUG-20260910-007 卡片图标化）', () => {
  assert.ok(!APP_JS.includes('改标题/描述'), '旧入口文案「改标题/描述」应全部下线');
  const row = APP_JS.match(/function reqRowEl\(it\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(row, />✎<\/button>/, '卡片编辑入口应仅显示 ✎ 图标（BUG-20260910-007）');
  assert.match(row, /aria-label="编辑 \$\{esc\(it\.id\)\} 标题与描述"/, '卡片 aria-label 应含条目编号并保留标题与描述语义');
  assert.match(row, /title="编辑标题与描述（仅待接受）"/, '卡片悬停说明应保留仅待接受限制');
  const drawerBtn = APP_JS.match(/function drawerActionsButtonHtml\(it\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(drawerBtn, />✎ 修改<\/button>/, '详情抽屉编辑入口应显示「✎ 修改」');
  assert.match(drawerBtn, /aria-label="编辑 \$\{esc\(it\.id\)\} 标题与描述"/, '抽屉 aria-label 应含条目编号并保留标题与描述语义');
  assert.match(drawerBtn, /title="编辑标题与描述（仅待接受）"/, '抽屉悬停说明应保留仅待接受限制');
});

t('U2 UI 静态：REQ-20260911-001 编辑侧拉面板 + editItem 预填与提交契约', () => {
  assert.doesNotMatch(APP_JS, /window\.prompt\(/, 'IAB 内禁用同步 prompt');
  assert.match(APP_JS, /function extractDocSection\(/, '应有描述节截取辅助');
  assert.match(APP_JS, /\/api\/item\/\$\{encodeURIComponent\(id\)\}\/doc\/README\.md/, '预填应经 README 全文接口拉取');
  assert.match(APP_JS, /\/api\/item\/\$\{encodeURIComponent\(id\)\}\/content/, '提交应走 /api/item/:id/content');
  assert.match(APP_JS, /async function editItem\(/, '应存在编辑提交函数');
  // REQ-20260911-001：居中 uiEditForm 弹窗下线，改为 #editModalWrap 侧拉面板（详见 edit-side-panel 测试）
  assert.ok(!APP_JS.includes('uiEditForm'), '居中编辑弹窗应随 REQ-20260911-001 下线');
  assert.match(APP_JS, /\$\('#editModalWrap'\)/, '应操作编辑侧拉面板');
  // 失败不丢输入：submitEditPanel 捕获保存异常写入面板反馈，恢复可编辑并保留草稿重试
  const module = APP_JS.slice(APP_JS.indexOf('const editSide ='), APP_JS.indexOf('function bindRenameButtons'));
  assert.match(module, /catch \(e\) \{[\s\S]*?setEditBusy\(false\)/, '保存异常应被捕获并恢复可编辑');
  assert.match(module, /保存失败：\$\{e\.message\}/, '失败原因应写入面板反馈');
  assert.match(module, /保存中…/, '保存期间按钮应切换保存中态');
});

t('U3 UI 静态：Esc 取消且不发请求；点击面板外不关闭；Enter 在标题框提交、在文本域换行', () => {
  const chain = APP_JS.match(/function onGlobalKeydown\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(chain, /editPanelOpen\(\)[\s\S]{0,120}closeEditPanel\(\)/, 'Esc 应取消编辑面板（一次只关一层）');
  const wiring = APP_JS.slice(APP_JS.indexOf('/* ---------- 事件绑定与启动 ---------- */'));
  assert.doesNotMatch(wiring, /\$\('#editModalWrap'\)\.addEventListener\('click'/, '无遮罩：点击面板外不关闭');
  assert.match(wiring, /\$\('#eTitle'\)\?\.addEventListener\('keydown'[\s\S]{0,200}'Enter'/, '标题框 Enter 应提交');
});

t('U4 UI 静态：「修改提示词」功能整体下线，app.js / style.css 无残留（BUG-20260908-022）', () => {
  for (const sym of ['editableStatus', 'editBtnHtml', 'bindEditButtons', 'itemDirRel', 'fetchItemEditPrompt', 'copyEditPrompt', 'data-edit-id', '修改提示词']) {
    assert.ok(!APP_JS.includes(sym), `app.js 不应残留 ${sym}`);
  }
  assert.ok(!STYLE_CSS.includes('card-edit-btn'), 'style.css 不应残留 .card-edit-btn 样式');
  const row = APP_JS.match(/function reqRowEl\(it\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(!row.includes('>修改</button>'), '卡片不应保留旧「修改」文案');
  // 详情抽屉操作区占位回退不依赖 editBtnHtml，仍保留「—」兜底（无操作按钮的状态不出空白）
  assert.match(APP_JS, /drawerActionsButtonHtml\(it\) \|\| '<span class="muted" style="font-size:12px">—<\/span>'/, '抽屉操作区应保留占位兜底');
});

t('U5 UI 静态：删除 / 接受 / 单号复制 / 改标题描述等既有入口与共用能力保留', () => {
  assert.match(APP_JS, /async function copyPlain\(/, 'copyPlain 共用复制能力应保留');
  assert.match(APP_JS, /data-copy-id=/, '单号复制入口应保留');
  assert.match(APP_JS, /data-delete-id=/, '删除入口应保留');
  assert.match(APP_JS, /data-accept-id=/, '接受入口应保留');
  assert.match(APP_JS, /data-rename-id=/, '「✎ 修改」入口应保留');
  assert.match(APP_JS, /bindDeleteButtons\(drawer\)/, '详情页删除绑定应保留');
  assert.match(APP_JS, /bindCopyIdButtons\(drawer\)/, '详情页单号复制绑定应保留');
});

// ---------- UI 沙箱（U2/U3 后半：编辑提交流程） ----------

function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    dataset: {}, innerHTML: '', textContent: '', value: '', disabled: false, checked: false,
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    removeEventListener() {},
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); },
    remove() {},
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, removeAttribute() {}, focus() {},
    fire(event) { const e = { target: this, currentTarget: this, stopped: false, stopPropagation() { this.stopped = true; } }; return { e, result: this.listeners[event]?.(e) }; },
  };
}

const README_DOC = '# REQ-20990101-001 旧标题\n\n- 状态：submitted\n\n## 描述\n\n旧描述正文\n\n## 验收标准\n\n- [ ] （待补充）\n';

function uiSetup() {
  const source = APP_JS;
  const document = element();
  document.createElement = element;
  document.body = element();
  const requests = [];
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {} },
    window: { addEventListener() {}, removeEventListener() {}, confirm: () => true },
    fetch: async (url, opts) => {
      requests.push({ url, opts });
      const json = String(url).includes('/doc/README.md')
        ? { content: README_DOC }
        : {};
      return { ok: true, json: async () => json };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(source.split('/* ---------- 事件绑定与启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  state.board = { initialized: true, items: [
    { id: 'REQ-20990101-001', type: 'requirement', status: 'submitted', title: '旧标题' },
    { id: 'REQ-20990101-002', type: 'requirement', status: 'accepted', title: '已接受' },
  ] };
  run('toast = () => {}; updateBoardTabs = () => {}; markActiveTab = () => {}; refreshHealth = async () => {}; refreshDrawer = async () => {}; poll = async () => {};');
  return { sandbox, state, run, requests };
}

t('U2 沙箱：editItem 预填 README 描述节并提交 title + description 到 /content', async () => {
  const h = uiSetup();
  // REQ-20260911-001：编辑迁 #editModalWrap 侧拉面板，读取完成后预填并聚焦
  await h.run("editItem('REQ-20990101-001')");
  assert.equal(h.run("$('#eTitle').value"), '旧标题', '标题应预填当前值');
  assert.equal(h.run("$('#eDesc').value"), '旧描述正文', '描述应预填 README 描述节原文');
  h.run("$('#eTitle').value = '新标题'");
  h.run("$('#eDesc').value = '新描述正文'");
  await h.run('submitEditPanel()');
  const get = h.requests.find((r) => String(r.url).includes('/doc/README.md'));
  assert.ok(get, '应先拉 README 全文截取描述');
  const post = h.requests.find((r) => String(r.url).includes('/content'));
  assert.ok(post, '保存应发写请求');
  assert.match(post.url, /\/api\/item\/REQ-20990101-001\/content\?project=%2Fproject%2Fa$/);
  assert.equal(post.opts.method, 'POST');
  assert.deepEqual(JSON.parse(post.opts.body), { title: '新标题', description: '新描述正文' });
});

t('U3 沙箱：取消（关闭面板）与无变化不发写请求；非 submitted 直接返回', async () => {
  const h = uiSetup();
  await h.run("editItem('REQ-20990101-001')");
  h.run('closeEditPanel()'); // 取消：放弃未保存输入，不发写请求
  assert.ok(!h.requests.some((r) => String(r.url).includes('/content')), '取消不应发写请求');

  await h.run("editItem('REQ-20990101-001')"); // 重新打开读取当前已保存内容
  await h.run('submitEditPanel()'); // 与当前一致：无变化
  assert.equal(h.run("$('#editMsg').textContent"), '标题与描述均无变化', '无变化应面板内提示且不抛错');
  assert.ok(!h.requests.some((r) => String(r.url).includes('/content')), '无变化不应发写请求');
  h.run('closeEditPanel()');

  await h.run("editItem('REQ-20990101-002')"); // accepted：不开面板不发请求
  assert.ok(!h.requests.some((r) => String(r.url).includes('/content')), '非 submitted 不应发写请求');
  assert.equal(h.run("$('#editModalWrap').classList.contains('hidden')"), true, '非 submitted 不重开面板');
});

t('U3 沙箱：服务端报错写入面板反馈（面板保持可重试，草稿不丢）', async () => {
  const h = uiSetup();
  h.sandbox.fetch = async (url, opts) => {
    h.requests.push({ url, opts });
    if (String(url).includes('/content')) return { ok: false, json: async () => ({ error: '仅待接受可改' }) };
    return { ok: true, json: async () => ({ content: README_DOC }) };
  };
  await h.run("editItem('REQ-20990101-001')");
  h.run("$('#eTitle').value = '新标题'");
  h.run("$('#eDesc').value = '新描述'");
  await h.run('submitEditPanel()');
  assert.match(String(h.run("$('#editMsg').textContent")), /仅待接受可改/, '服务端错误应写入面板反馈');
  assert.equal(h.run("$('#eTitle').value"), '新标题', '失败不丢输入（草稿保留）');
  assert.equal(h.run("$('#editModalWrap').classList.contains('hidden')"), false, '失败面板保持可重试');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
