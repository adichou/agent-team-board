#!/usr/bin/env node
// REQ-20260910-010 项目管理：自动检测不存在的目录并支持一键移出 —— 集成测试
// —— 真实起 server（随机端口 + 临时注册表 + 临时项目），另含前端静态契约与 ui-demo 离线检查。
// 用法：node scripts/tests/missing-dir-detect-20260910-010.test.mjs
// 覆盖 test-cases.md 的 S1–S4、B1–B4、F1–F4、R1。

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
const itemDir = path.join(pluginRoot, 'docs', 'agent-team-board', 'requirements', 'REQ-20260910-010');

// ---------- 测试环境 ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-missingdir-'));
// macOS 下 /var 是 /private/var 的符号链接，server 会做 realpath，测试路径需对齐
for (const name of ['goodA', 'goodB', 'goneC', 'targetDir', 'fileD', 'recoverH', 'lockParent']) {
  fs.mkdirSync(path.join(tmp, name), { recursive: true });
}
fs.mkdirSync(path.join(tmp, 'lockParent', 'sub'), { recursive: true }); // 检测失败形态：父目录去掉执行权限
const projectA = fs.realpathSync(path.join(tmp, 'goodA'));   // 启动目录（默认项目），数据保留基准
const projectB = fs.realpathSync(path.join(tmp, 'goodB'));   // 存在 + 有看板数据（B4 轮询/重导入基准）
const goneC = fs.realpathSync(path.join(tmp, 'goneC'));      // 注册后整目录删除（ENOENT）
const targetDir = fs.realpathSync(path.join(tmp, 'targetDir')); // 经符号链接注册，注册后目标删除（断链形态）
const fileD = fs.realpathSync(path.join(tmp, 'fileD'));      // 注册后目录被同名普通文件取代
const recoverH = fs.realpathSync(path.join(tmp, 'recoverH'));   // B2：确认前恢复存在 → 跳过
const lockParent = fs.realpathSync(path.join(tmp, 'lockParent'));
const lockSub = fs.realpathSync(path.join(tmp, 'lockParent', 'sub')); // stat 权限错误 → 检测失败
fs.symlinkSync(targetDir, path.join(tmp, 'linkToTarget')); // 经符号链接导入 targetDir

core.initData(projectA);
core.initData(projectB);
const dataA = core.dataDirFrom(projectA);
const dataB = core.dataDirFrom(projectB);
core.createItem(core.dataDirFrom(projectA), { type: 'requirement', title: 'A 项目的需求', by: 'test' });
core.createItem(core.dataDirFrom(projectB), { type: 'requirement', title: 'B 项目的需求', by: 'test' });
const registryFile = path.join(tmp, 'projects.json');

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
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

t('P0 准备：注册六个项目（含符号链接形态）后制造 缺失/断链/同名文件/权限锁定 形态', async () => {
  // 启动目录 goodA 已由首轮 /api/health 播种；其余显式注册（目录此时都存在）
  for (const p of [projectB, goneC, targetDir, fileD, recoverH, lockSub]) {
    const r = await post(`${base}/api/register`, { path: p });
    assert.ok(r.projects.includes(p), `注册应包含 ${p}`);
  }
  // 经符号链接注册同一真实路径不产生重复项（沿用 REQ-20260910-005 语义）
  const h0 = await get(`${base}/api/health`);
  assert.equal(h0.projects.filter((p) => p === targetDir).length, 1);
  // 制造形态：整目录删除 / 断开的符号链接（目标删除）/ 同名普通文件 / 父目录无执行权限（stat EACCES）
  fs.rmSync(goneC, { recursive: true });
  fs.rmSync(targetDir, { recursive: true });
  fs.rmSync(fileD, { recursive: true });
  fs.writeFileSync(fileD, 'now a file');
  if (!isRoot) fs.chmodSync(lockParent, 0o000);
});

t('S1 scan 逐项分类：存在 / 不存在（ENOENT、断链、同名文件）/ 检测失败（权限）与汇总计数', async () => {
  const r = await post(`${base}/api/project/scan`);
  assert.equal(r.ok, true);
  const byPath = new Map(r.projects.map((row) => [row.path, row]));
  assert.equal(r.projects.length, 7, '七个注册项逐项检测');
  assert.deepEqual(byPath.get(projectA), { path: projectA, state: 'exists', reason: null });
  assert.deepEqual(byPath.get(projectB), { path: projectB, state: 'exists', reason: null });
  const gone = byPath.get(goneC);
  assert.equal(gone.state, 'missing', '整目录删除应判不存在');
  const broken = byPath.get(targetDir);
  assert.equal(broken.state, 'missing', '符号链接目标删除后应判不存在（断链形态）');
  if (broken.reason) assert.match(broken.reason, /断开的符号链接/, '断链归类应说明原因');
  const fileRow = byPath.get(fileD);
  assert.equal(fileRow.state, 'missing', '路径处变成普通文件：项目根目录不存在');
  assert.match(fileRow.reason || '', /不是目录/, '应说明“不是目录”的归类依据');
  if (isRoot) {
    // root 下 chmod 000 不生效：降级断言为存在，不判 missing/error
    assert.equal(byPath.get(lockSub).state, 'exists');
  } else {
    const lockRow = byPath.get(lockSub);
    assert.equal(lockRow.state, 'error', 'stat 权限错误应判“检测失败”，不得当作不存在');
    assert.ok(lockRow.reason && lockRow.reason.length > 0, '检测失败须附原因');
  }
  assert.deepEqual(r.summary, {
    total: 7,
    missing: 3,
    error: isRoot ? 0 : 1,
  }, '汇总计数应准确（missing=3，error 视权限模拟生效与否）');
});

t('S2 scan 只读幂等：重复扫描结果一致、注册表字节不变；不隐式登记未知 ?project=', async () => {
  const before = fs.readFileSync(registryFile, 'utf8');
  const r1 = await post(`${base}/api/project/scan`);
  const r2 = await post(`${base}/api/project/scan`);
  assert.deepEqual(r2.projects, r1.projects, '两次扫描结果一致');
  assert.equal(fs.readFileSync(registryFile, 'utf8'), before, 'scan 不得写注册表');
  // scan 不解析 ?project=（注册表级接口），不得把任意路径隐式登记回来
  await post(`${base}/api/project/scan?project=${encodeURIComponent(path.join(tmp, 'never-registered'))}`);
  const h = await get(`${base}/api/health`);
  assert.ok(!h.projects.includes(path.join(tmp, 'never-registered')), 'scan 不得隐式登记 ?project= 路径');
  assert.equal(fs.readFileSync(registryFile, 'utf8'), before, 'scan 不得写注册表');
  if (!isRoot) fs.chmodSync(lockParent, 0o755); // 恢复执行权限：后续用例 lockSub 回到“存在”
});

t('S4 单项移出放宽：目录已不存在（含同名文件形态）的注册项可移出；未注册/相对路径仍 400', async () => {
  const r = await post(`${base}/api/project/remove`, { path: fileD });
  assert.equal(r.removed, fileD);
  assert.ok(!r.projects.includes(fileD), '移出后列表不含 fileD');
  const saved = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  assert.ok(saved.removed.includes(fileD), '移出应记入 removed（防隐式重现）');
  assert.equal(fs.readFileSync(fileD, 'utf8'), 'now a file', '同名文件不得被删除（只动注册表）');
  assert.ok(fs.existsSync(path.join(dataA, 'requirements')), '其他项目磁盘数据不受影响');
  await post(`${base}/api/project/remove`, { path: fileD }, 400); // 已移出 → 不在列表中
  await post(`${base}/api/project/remove`, { path: 'relative/path' }, 400);
});

t('B1 批量移出：仅移出仍不存在的候选，注册表/removed 落盘，health 一致，磁盘保留', async () => {
  const r = await post(`${base}/api/project/remove-missing`, { paths: [goneC, targetDir] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.removed, [goneC, targetDir], '仍不存在的候选全部移出');
  assert.deepEqual(r.skipped, [], '无跳过');
  assert.deepEqual(r.failed, [], '无失败');
  const h = await get(`${base}/api/health`);
  assert.deepEqual(h.projects, r.projects, '响应列表与 health 一致');
  assert.ok(!h.projects.includes(goneC) && !h.projects.includes(targetDir));
  assert.equal(h.defaultProject, projectA, '移出非默认项目不改变默认选择');
  const saved = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  for (const p of [goneC, targetDir, fileD]) {
    assert.ok(!saved.projects.includes(p), `注册表应已移出 ${p}`);
    assert.ok(saved.removed.includes(p), `removed 标记应包含 ${p}`);
  }
  assert.ok(h.projects.includes(projectA) && h.projects.includes(projectB) && h.projects.includes(lockSub),
    '存在项目与权限恢复项不受批量移出影响');
  assert.ok(fs.existsSync(path.join(dataB, 'requirements')), '磁盘看板数据保留');
});

t('B2 确认时重新核实：候选恢复存在 → 跳过；已不在列表 → 跳过；不扩大移出范围', async () => {
  fs.rmSync(recoverH, { recursive: true }); // 候选在确认前消失
  const scan1 = await post(`${base}/api/project/scan`);
  const row = scan1.projects.find((x) => x.path === recoverH);
  assert.equal(row.state, 'missing', '确认前扫描应判不存在');
  fs.mkdirSync(recoverH, { recursive: true }); // 确认时目录恢复存在
  const r = await post(`${base}/api/project/remove-missing`, { paths: [recoverH] });
  assert.deepEqual(r.removed, [], '恢复存在的候选不得移出');
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].path, recoverH);
  assert.match(r.skipped[0].reason, /恢复|存在/, '跳过原因应说明目录已恢复存在');
  const h1 = await get(`${base}/api/health`);
  assert.ok(h1.projects.includes(recoverH), '恢复存在的项目保留在列表');
  // 已被其他窗口移出（不在注册表）的候选 → 跳过并说明，不报失败
  const r2 = await post(`${base}/api/project/remove-missing`, { paths: [fileD] });
  assert.deepEqual(r2.removed, []);
  assert.match(r2.skipped[0].reason, /不在|列表|移出/, '应说明候选已不在列表');
  // 不扩大范围：范围外项目原样保留
  const h2 = await get(`${base}/api/health`);
  for (const p of [projectA, projectB, lockSub, recoverH]) {
    assert.ok(h2.projects.includes(p), `范围外项目 ${p} 不得被移出`);
  }
});

t('B3 状态无法确定不误删：检测失败形态跳过；非法请求 400 且注册表不变', async () => {
  if (!isRoot) {
    fs.chmodSync(lockParent, 0o000); // stat EACCES → 无法确定存在性
    const scan1 = await post(`${base}/api/project/scan`);
    assert.equal(scan1.projects.find((x) => x.path === lockSub).state, 'error');
    const r = await post(`${base}/api/project/remove-missing`, { paths: [lockSub] });
    assert.deepEqual(r.removed, [], '无法确定状态的候选不得移出');
    assert.match(r.skipped[0].reason, /无法确定|检测失败/, '应说明状态无法确定');
    const h = await get(`${base}/api/health`);
    assert.ok(h.projects.includes(lockSub), '检测失败的项目保留在列表');
    fs.chmodSync(lockParent, 0o755);
  } else {
    console.log('    （root 环境 chmod 不生效，跳过 EACCES 形态断言）');
  }
  const before = fs.readFileSync(registryFile, 'utf8');
  await post(`${base}/api/project/remove-missing`, {}, 400); // 缺 paths
  await post(`${base}/api/project/remove-missing`, { paths: [] }, 400); // 空数组
  await post(`${base}/api/project/remove-missing`, { paths: 'x' }, 400); // 非数组
  await post(`${base}/api/project/remove-missing`, { paths: ['relative/path'] }, 400); // 相对路径
  assert.equal(fs.readFileSync(registryFile, 'utf8'), before, '非法请求不得改写注册表');
});

t('B4 移出后轮询不隐式恢复：数据仍可读、health 不含；重新导入恢复且 removed 清除', async () => {
  await post(`${base}/api/project/remove`, { path: projectB }); // 存在项目单项移出（既有语义不回退）
  const b = await get(`${base}/api/board?project=${encodeURIComponent(projectB)}`);
  assert.equal(b.initialized, true, '已移出项目数据仍可读（不误报失败）');
  assert.equal(b.items.length, 1);
  const h = await get(`${base}/api/health`);
  assert.ok(!h.projects.includes(projectB), '轮询不得把已移出项目注册回来');
  const r = await post(`${base}/api/register`, { path: projectB, requireInitialized: true });
  assert.ok(r.projects.includes(projectB), '重新导入应回到列表');
  const saved = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  assert.ok(!saved.removed.includes(projectB), '显式导入应清除 removed 标记');
  assert.equal(b.items[0].title, 'B 项目的需求', '条目文档原样保留');
});

t('S3 空注册表：scan 返回空列表零计数；health defaultProject=null；board noProject 空态', async () => {
  for (const p of [projectA, lockSub, recoverH, projectB]) {
    const h = await get(`${base}/api/health`);
    if (h.projects.includes(p)) await post(`${base}/api/project/remove`, { path: p });
  }
  const r = await post(`${base}/api/project/scan`);
  assert.deepEqual(r.projects, []);
  assert.deepEqual(r.summary, { total: 0, missing: 0, error: 0 });
  const h = await get(`${base}/api/health`);
  assert.equal(h.projects.length, 0);
  assert.equal(h.defaultProject, null, '启动目录已被移出时不得再自动播种');
  const b = await get(`${base}/api/board`);
  assert.equal(b.noProject, true, '无参 board 应返回 noProject 空态载荷');
});

t('F1 前端结构契约：检测条 + 批量确认区 + 行内文字状态 + 打开面板自动检测', () => {
  const html = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  for (const id of ['projScanBar', 'projScanSummary', 'projScanBtn', 'projRemoveMissingBtn', 'projBatchConfirm', 'projBatchText', 'projBatchOk', 'projBatchCancel']) {
    assert.ok(html.includes(`id="${id}"`), `index.html 缺少 #${id}`);
  }
  assert.match(html, /id="projScanBtn"[^>]*>重新检测/, '「重新检测」按钮');
  // 打开面板即自动检测（openProjPanel 内触发扫描）
  assert.match(js, /async function openProjPanel\(\)[\s\S]{0,900}scanProjPanel\(/, 'openProjPanel 应自动触发检测');
  // 行内文字状态：存在 / 不存在 / 检测中 / 检测失败（待检测），不能仅靠颜色区分
  for (const word of ['存在', '不存在', '检测中', '检测失败', '待检测']) {
    assert.ok(js.includes(`'${word}'`) || js.includes(`"${word}"`), `app.js 应包含文字状态「${word}」`);
  }
  assert.ok(js.includes('proj-scan-state'), '行内状态应有独立元素承载');
});

t('F2 前端交互契约：扫描/批量移出接口、候选计数与禁用、确认语义、结果分项、busy、联动刷新', () => {
  const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  assert.match(js, /\/api\/project\/scan/, '应调用检测接口');
  assert.match(js, /\/api\/project\/remove-missing/, '应调用批量移出接口');
  assert.match(js, /移出所有不存在目录（\$\{/, '批量入口应显示候选数量');
  assert.match(js, /未发现不存在的目录/, '无候选时应明确提示');
  // 检测失败不沿用旧结果提交批量
  assert.match(js, /scan\.phase !== 'done'/, '批量候选仅来自成功完成的扫描');
  // 确认区：完整路径 + 仅移出列表语义
  assert.match(js, /仅从列表移出，不删除目录与文档，不停止任务/, '确认区须说明保留语义');
  assert.match(js, /list\.join\('\\n'\)/, '确认区应逐行列出完整路径');
  // 取消不变更
  assert.match(js, /已取消，项目列表未变更/, '取消应明确不变更');
  // 结果分项：成功/跳过（原因）/失败（路径），失败不显示全部成功
  assert.match(js, /成功 \$\{removed\.length\} 项，跳过 \$\{skipped\.length\} 项，失败 \$\{failed\.length\} 项/, '结果应分项计数');
  assert.match(js, /跳过 \$\{s\.path\}（\$\{s\.reason\}）/, '跳过项应列路径与原因');
  assert.match(js, /失败 \$\{f\.path\}（\$\{f\.reason\}）/, '失败项应列路径与原因');
  assert.match(js, /可重新检测后重试/, '失败项应引导重试');
  // busy 防重复提交：批量按钮与确认按钮纳入禁用集
  for (const id of ['projScanBtn', 'projRemoveMissingBtn', 'projBatchOk', 'projBatchCancel']) {
    assert.ok(js.includes(`\$('#${id}')`), `busy 管理应覆盖 #${id}`);
  }
  // 当前项目被移出：剩余首项 / 无项目空态（沿用单项移出逻辑）
  assert.match(js, /removed\.includes\(state\.project\)[\s\S]{0,400}clearProjectState/, '移出当前项目应回落到空态引导');
  // 列表与切换器同步更新
  assert.match(js, /renderProjectSel\(\)/, '完成后应刷新项目切换器');
});

t('F3 样式契约：检测条小屏可换行、摘要长文本不截断', () => {
  const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');
  assert.match(css, /\.proj-scan\s*\{[^}]*flex-wrap:\s*wrap/, '检测条应可换行（小屏不裁切按钮）');
  assert.match(css, /\.proj-scan-summary\s*\{[^}]*overflow-wrap:\s*anywhere/, '摘要文本应可换行不截断');
  assert.match(css, /\.proj-scan-acts\s*\{[^}]*flex-wrap:\s*wrap/, '按钮组应可换行');
});

t('F4 ui-demo.html 离线自包含：内联 CSS/JS、无外网依赖，覆盖核心场景与状态', () => {
  const demo = fs.readFileSync(path.join(itemDir, 'ui-demo.html'), 'utf8');
  assert.ok(demo.length > 0, 'ui-demo.html 应存在');
  assert.doesNotMatch(demo, /src=["']https?:\/\//, '不得外链脚本');
  assert.doesNotMatch(demo, /href=["']https?:\/\//, '不得外链样式');
  assert.doesNotMatch(demo, /@import/, '不得 @import');
  assert.doesNotMatch(demo, /url\(\s*["']?https?:\/\//, '不得引用外网资源');
  for (const word of ['移出所有不存在目录', '重新检测', '检测中', '不存在', '检测失败', '确认移出', '取消', '暂无项目']) {
    assert.ok(demo.includes(word), `ui-demo 应覆盖「${word}」`);
  }
});

t('R1 回归：project-manage-20260910-005 与 multi-project 全量通过', () => {
  for (const f of ['project-manage-20260910-005.test.mjs', 'multi-project.test.mjs']) {
    const r = spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', 'tests', f)], {
      stdio: 'pipe', encoding: 'utf8', timeout: 180000,
    });
    assert.equal(r.status, 0, `${f} 回归失败：\n${(r.stdout || '') + (r.stderr || '')}`);
  }
});

// ---------- 执行 ----------
let failed = 0;
try {
  for (const port of [27756, 27956, 28156]) {
    try {
      const r = await tryStartServer(port);
      serverProc = r.proc;
      base = r.base;
      break;
    } catch (e) {
      if (port === 28156) throw e;
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
  try { fs.chmodSync(lockParent, 0o755); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
