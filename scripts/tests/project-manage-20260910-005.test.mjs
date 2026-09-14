#!/usr/bin/env node
// REQ-20260910-005 项目管理（初始化 / 导入 / 移出）集成测试
// —— 真实起 server（随机端口 + 临时注册表 + 临时项目），另含前端静态契约与回归。
// 用法：node scripts/tests/project-manage-20260910-005.test.mjs
// 覆盖 test-cases.md 的 P1–P14；P15 为浏览器实测项。

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';

const __http = http;
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------- 测试环境 ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-projmanage-'));
// macOS 下 /var 是 /private/var 的符号链接，server 会做 realpath，测试路径需对齐
for (const name of ['projA', 'projB', 'projC', 'projD', 'projE']) {
  fs.mkdirSync(path.join(tmp, name), { recursive: true });
}
fs.mkdirSync(path.join(tmp, 'projA', 'sub'), { recursive: true }); // P2：已初始化项目的子目录
const projectA = fs.realpathSync(path.join(tmp, 'projA'));
const projectB = fs.realpathSync(path.join(tmp, 'projB'));
const projectC = fs.realpathSync(path.join(tmp, 'projC'));
const projectD = fs.realpathSync(path.join(tmp, 'projD'));
const projectE = fs.realpathSync(path.join(tmp, 'projE'));

core.initData(projectA);
core.initData(projectB);
const dataA = core.dataDirFrom(projectA);
const dataB = core.dataDirFrom(projectB);
core.createItem(dataA, { type: 'requirement', title: 'A 项目的需求', by: 'test' });
const itemB = core.createItem(dataB, { type: 'requirement', title: 'B 项目的需求', by: 'test' });
// 模拟已流转状态：移出→重导入后应原样保留
core.writeStatus(path.join(dataB, 'requirements', itemB.id), {
  ...core.readStatus(path.join(dataB, 'requirements', itemB.id)),
  status: 'accepted',
  history: [{ at: new Date().toISOString(), from: 'submitted', to: 'accepted', by: 'test' }],
});

const registryFile = path.join(tmp, 'projects.json');
const linkB = path.join(tmp, 'link-to-b'); // P6：符号链接形态导入
fs.symlinkSync(projectB, linkB);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let serverProc = null;
let base = '';

async function tryStartServer(port) {
  const proc = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: projectA, // 默认项目 = 启动目录（单项目兼容行为）
    env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: registryFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let err = '';
  proc.stderr.on('data', (c) => { err += c; });
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    try {
      const r = await request('GET', `http://127.0.0.1:${port}/api/health`);
      if (r.status === 200) return { proc, base: `http://127.0.0.1:${port}` };
    } catch {}
    if (proc.exitCode !== null) throw new Error(`server 提前退出: ${err}`);
  }
  proc.kill();
  throw new Error(`server 启动超时: ${err}`);
}

function request(method, url, body) {
  const http = __http;
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: body ? { 'Content-Type': 'application/json' } : {} },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let json = {};
          try { json = JSON.parse(data || '{}'); } catch {}
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function get(url, expect = 200) {
  const r = await request('GET', url);
  assert.equal(r.status, expect, `GET ${url} → ${r.status}（期望 ${expect}）：${JSON.stringify(r.json)}`);
  return r.json;
}
async function post(url, body, expect = 200) {
  const r = await request('POST', url, body ?? {});
  assert.equal(r.status, expect, `POST ${url} → ${r.status}（期望 ${expect}）：${JSON.stringify(r.json)}`);
  return r.json;
}

// ---------- 用例 ----------
const cases = [];
const t = (name, fn) => cases.push([name, fn]);
let health;

t('P1 preview：存在目录返回解析结果；相对路径 / 不存在目录 400', async () => {
  const r = await post(`${base}/api/project/preview`, { path: projectC });
  assert.equal(r.root, projectC);
  assert.equal(r.name, 'projC');
  assert.equal(r.initialized, false);
  assert.equal(r.wouldWrite, path.join(projectC, 'docs', 'agent-team-board'));
  await post(`${base}/api/project/preview`, { path: 'relative/path' }, 400);
  await post(`${base}/api/project/preview`, { path: path.join(tmp, 'not-exists') }, 400);
});

t('P2 preview：子目录 / 符号链接须明确解析到真实数据位置', async () => {
  const r = await post(`${base}/api/project/preview`, { path: path.join(projectA, 'sub') });
  assert.equal(r.root, path.join(projectA, 'sub'));
  assert.equal(r.initialized, true, '子目录应沿向上解析发现已有看板数据');
  assert.equal(r.dataDir, dataA, '解析到的数据目录是真实位置（projA 的数据目录）');
  const l = await post(`${base}/api/project/preview`, { path: linkB });
  assert.equal(l.root, projectB, '符号链接应显示解析后的真实路径');
});

t('P3 init（body.path）：创建数据 + 登记注册表 + 返回 root/projects；?project= 旧签名兼容', async () => {
  const r = await post(`${base}/api/init`, { path: projectC });
  assert.equal(r.root, projectC);
  assert.equal(r.dataDir, path.join(projectC, 'docs', 'agent-team-board'));
  assert.ok(fs.existsSync(path.join(projectC, 'docs', 'agent-team-board', 'config.json')), '初始化应落盘 config.json');
  assert.ok(r.projects.includes(projectC), '初始化后应加入项目列表');
  const saved = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  assert.ok(saved.projects.includes(projectC), '注册表文件应包含 projC');
  // 旧签名（multi-project M3）：POST /api/init?project=
  const r2 = await post(`${base}/api/init?project=${encodeURIComponent(projectD)}`);
  assert.equal(r2.root, projectD);
  assert.ok(r2.projects.includes(projectD));
});

t('P4 init 重复执行 400（已有数据不覆盖），报错含已存在的数据目录', async () => {
  const r = await post(`${base}/api/init`, { path: projectC }, 400);
  assert.match(r.error, /已初始化/, '应说明已有数据位置');
  // 数据未被覆盖重建：config.json 仍存在且 counters 未被重置为初始写入以外的状态
  const cfg = JSON.parse(fs.readFileSync(path.join(projectC, 'docs', 'agent-team-board', 'config.json'), 'utf8'));
  assert.equal(cfg.counters.requirement, 0, '重复初始化不得改写既有配置');
});

t('P5 register + requireInitialized：未初始化目录 400 提示改用初始化；已初始化目录成功', async () => {
  const bad = await post(`${base}/api/register`, { path: projectE, requireInitialized: true }, 400);
  assert.match(bad.error, /初始化/, '未初始化目录应提示改用初始化');
  const ok = await post(`${base}/api/register`, { path: projectB, requireInitialized: true });
  assert.equal(ok.root, projectB);
  assert.ok(ok.projects.includes(projectB));
});

t('P6 register 同一真实路径（含符号链接形态）不产生重复项，返回解析后 root', async () => {
  const before = (await get(`${base}/api/health`)).projects.filter((p) => p === projectB).length;
  assert.equal(before, 1);
  const r = await post(`${base}/api/register`, { path: linkB, requireInitialized: true });
  assert.equal(r.root, projectB, '符号链接导入应按解析后真实路径登记');
  const after = r.projects.filter((p) => p === projectB).length;
  assert.equal(after, 1, '同一真实路径重复导入不得新增重复项');
});

t('P7 remove：移出列表并落盘注册表；项目目录与看板数据保留', async () => {
  const r = await post(`${base}/api/project/remove`, { path: projectB });
  assert.equal(r.removed, projectB);
  assert.ok(!r.projects.includes(projectB), '移出后列表不含 projB');
  const saved = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  assert.ok(!saved.projects.includes(projectB), '注册表文件应同步移出');
  assert.ok(saved.removed.includes(projectB), '移出应记入 removed（防隐式重现）');
  // 磁盘保留：目录、数据目录、条目文档原样
  assert.ok(fs.existsSync(dataB), '移出不得删除数据目录');
  assert.ok(fs.existsSync(path.join(dataB, 'requirements', itemB.id, 'README.md')), '移出不得删除需求文档');
});

t('P8 remove 未注册路径 / 相对路径 400', async () => {
  await post(`${base}/api/project/remove`, { path: projectB }, 400); // P7 已移出
  await post(`${base}/api/project/remove`, { path: 'relative/path' }, 400);
});

t('P9 移出后 health 不再包含；移出默认项目后 defaultProject 指向剩余首项', async () => {
  health = await get(`${base}/api/health`);
  assert.ok(!health.projects.includes(projectB));
  assert.equal(health.defaultProject, projectA, '注册表首项是默认项目（启动目录播种）');
  await post(`${base}/api/project/remove`, { path: projectA });
  health = await get(`${base}/api/health`);
  assert.ok(!health.projects.includes(projectA));
  assert.equal(health.defaultProject, projectC, '移出默认项目后应指向剩余首项');
});

t('P10 移出后轮询/深链访问不隐式重新登记（数据仍可读）', async () => {
  const b = await get(`${base}/api/board?project=${encodeURIComponent(projectB)}`);
  assert.equal(b.initialized, true, '已移出项目数据仍可读（不误报失败）');
  assert.equal(b.items.length, 1);
  const h = await get(`${base}/api/health`);
  assert.ok(!h.projects.includes(projectB), '访问已移出项目不得使其在列表中自动重现');
});

t('P11 重新导入已移出项目：回到列表、条目状态原样、removed 标记清除', async () => {
  const r = await post(`${base}/api/register`, { path: projectB, requireInitialized: true });
  assert.ok(r.projects.includes(projectB), '重新导入应回到列表');
  const saved = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  assert.ok(!saved.removed.includes(projectB), '显式导入应清除 removed 标记');
  const b = await get(`${base}/api/board?project=${encodeURIComponent(projectB)}`);
  assert.equal(b.items[0].status, 'accepted', '重新导入后条目状态保持原样');
});

t('P12 移出最后一项：defaultProject=null、无参 board 返回 noProject、其余接口 400 引导', async () => {
  for (const p of [projectC, projectD, projectE, projectB, projectA]) {
    // projA 已在 P9 移出；逐个清空剩余注册项
    const h = await get(`${base}/api/health`);
    if (h.projects.includes(p)) await post(`${base}/api/project/remove`, { path: p });
  }
  const h = await get(`${base}/api/health`);
  assert.equal(h.projects.length, 0, '注册表应已清空');
  assert.equal(h.defaultProject, null, '启动目录已被移出时不得再自动播种为默认项目');
  const b = await get(`${base}/api/board`);
  assert.equal(b.noProject, true, '无参 board 应返回 noProject 空态载荷');
  assert.equal(b.initialized, false);
  assert.deepEqual(b.items, []);
  const r = await request('POST', `${base}/api/new`, { type: 'req', title: 'x' });
  assert.equal(r.status, 400, '空态下其余数据接口应 400 引导');
  assert.match(r.json.error, /管理项目|没有已注册项目/, '错误应指引到项目管理入口');
  // 空态下管理接口仍可用（否则无法自拔）
  const pv = await post(`${base}/api/project/preview`, { path: projectC });
  assert.equal(pv.root, projectC);
  const rg = await post(`${base}/api/register`, { path: projectC, requireInitialized: true });
  assert.ok(rg.projects.includes(projectC), '空态导入应可用');
});

t('P13 静态契约：入口按钮 / 弹窗骨架 / 确认文案 / 提交前校验 / busy 禁用 / 空态清理', () => {
  const html = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');
  // 顶栏入口 + 弹窗骨架
  assert.match(html, /id="btnProjManage"/, '顶栏应有「管理项目」按钮');
  for (const id of ['projModalWrap', 'projMode', 'projPath', 'projSubmit', 'projNotice', 'projList', 'projConfirm']) {
    assert.ok(html.includes(`id="${id}"`), `index.html 缺少 #${id}`);
  }
  // 空态双卡：初始化卡 + 无项目引导卡
  assert.ok(html.includes('id="initCard"') && html.includes('id="noProjectCard"'), '空态应区分「未初始化」与「暂无项目」');
  // 移出确认文案与语义
  assert.match(js, /仅从列表移出，目录及需求、Bug 文档保留/, '移出确认须说明保留语义');
  assert.match(js, /\/api\/project\/remove/, '应调用移出接口');
  // 提交前校验：空路径与相对路径
  assert.match(js, /请输入项目根目录的绝对路径/, '空路径应提交前提示');
  assert.match(js, /路径必须是绝对路径/, '相对路径应提交前提示');
  assert.match(js, /startsWith\('\/'\)/, '绝对路径判定');
  // busy 禁用重复提交
  assert.match(js, /projSetBusy/, '应有 busy 态管理');
  assert.match(js, /projSubmit/, 'busy 应控制提交按钮');
  // 初始化两步走：先 preview 展示实际写入位置再确认
  assert.match(js, /api\/project\/preview/, '初始化应先解析目标位置');
  assert.match(js, /将写入/, '应展示实际将写入的目标位置');
  // 导入：未初始化目录由服务端反馈（requireInitialized）
  assert.match(js, /requireInitialized: true/, '导入应校验已有看板数据');
  // 无项目空态：清记忆与 URL、渲染引导
  assert.match(js, /clearProjectState/, '移出最后一项应清理当前项目状态');
  assert.match(js, /localStorage\.removeItem\('atb\.project'\)/, '应清除记忆的当前项目');
  assert.match(js, /noProject/, '前端应识别 noProject 载荷');
  // 列表行布局：路径可换行不截断
  assert.match(css, /\.proj-path/, '应有项目路径样式');
  assert.match(css, /\.proj-path[^{]*\{[^}]*overflow-wrap:\s*anywhere/, '路径须可换行不被截断');
});

t('P14 回归：multi-project.test.mjs 全量通过', () => {
  const r = spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', 'tests', 'multi-project.test.mjs')], {
    stdio: 'pipe', encoding: 'utf8', timeout: 120000,
  });
  assert.equal(r.status, 0, `multi-project 回归失败：\n${(r.stdout || '') + (r.stderr || '')}`);
});

// ---------- 执行 ----------
let failed = 0;
try {
  for (const port of [27746, 27946, 28146]) {
    try {
      const r = await tryStartServer(port);
      serverProc = r.proc;
      base = r.base;
      break;
    } catch (e) {
      if (port === 28146) throw e;
    }
  }
  assert.ok(base, 'server 未能在候选端口启动');
  for (const [name, fn] of cases) {
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (e) {
      failed++;
      console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
    }
  }
} finally {
  if (serverProc) serverProc.kill();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
