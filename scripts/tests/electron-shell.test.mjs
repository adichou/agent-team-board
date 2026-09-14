#!/usr/bin/env node
// REQ-20260905-001 Electron 桌面壳 —— 静态契约 + 服务拉起/探活/回收集成
// 用法：node scripts/tests/electron-shell.test.mjs
// 集成用例只依赖纯 Node（electron/service.mjs 不 import electron），无需安装 Electron。

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const serverPath = path.join(pluginRoot, 'scripts', 'server.mjs');
const mainSrcPath = path.join(pluginRoot, 'electron', 'main.mjs');
const serviceSrcPath = path.join(pluginRoot, 'electron', 'service.mjs');
const shellCssSrcPath = path.join(pluginRoot, 'electron', 'shell-css.mjs');
const webCssPath = path.join(pluginRoot, 'scripts', 'web', 'style.css');
const pkgPath = path.join(pluginRoot, 'package.json');

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

// 被测模块（红阶段文件尚不存在时保持 null，用例内显式失败）
let service = null;
try { service = await import(serviceSrcPath); } catch {}
let shellCss = null;
try { shellCss = await import(shellCssSrcPath); } catch {}

function readSrc(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

// 取一个当前空闲的 TCP 端口（关掉探针后存在理论竞争，测试可接受）
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function getHealth(port) {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: '/api/health', method: 'GET', timeout: 1500 },
      (res) => resolve(res.statusCode === 200)
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

function pidAlive(pid) {
  try { return process.kill(pid, 0); } catch { return false; }
}

// 直接以 node 拉起一个看板服务（模拟「终端已起服务」），返回子进程
function startServer(port, tmp) {
  const child = spawn(process.execPath, [serverPath], {
    cwd: tmp,
    env: { ...process.env, ATB_PORT: String(port), ATB_HOST: '127.0.0.1', ATB_REGISTRY: path.join(tmp, 'registry.json') },
    stdio: 'ignore',
  });
  return child;
}

async function waitHealth(port, tries = 50) {
  for (let i = 0; i < tries; i++) {
    if (await getHealth(port)) return true;
    await sleepMs(200);
  }
  return false;
}

// ensureService 的隔离环境：临时项目目录 + 临时注册表
function makeEnv(tmp) {
  return {
    ...process.env,
    ATB_REGISTRY: path.join(tmp, 'registry.json'),
  };
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// ---------- 静态契约 ----------

t('V1 package.json 契约：main 指向壳入口、app 脚本、electron/electron-builder 开发依赖', () => {
  const src = readSrc(pkgPath);
  assert.ok(src, '根目录应存在 package.json');
  const pkg = JSON.parse(src);
  assert.equal(pkg.main, 'electron/main.mjs', 'main 应指向 electron/main.mjs');
  assert.ok(pkg.scripts && /electron/.test(pkg.scripts.app || ''), 'scripts.app 应以 electron 启动');
  assert.ok(pkg.devDependencies?.electron, 'devDependencies 应含 electron');
  assert.ok(pkg.devDependencies?.['electron-builder'], 'devDependencies 应含 electron-builder');
});

t('V2 main.mjs 静态契约：建窗 1360×850、hiddenInset、加载 127.0.0.1、关窗回收并退出', () => {
  const src = readSrc(mainSrcPath);
  assert.ok(src, '应存在 electron/main.mjs');
  assert.match(src, /BrowserWindow/, '应创建 BrowserWindow');
  assert.match(src, /1360/, '窗口宽应为 1360');
  assert.match(src, /850/, '窗口高应为 850');
  assert.match(src, /hiddenInset/, 'macOS 应使用 hiddenInset 标题栏');
  assert.match(src, /loadURL|loadFile/, '应加载页面');
  assert.match(src, /127\.0\.0\.1/, '页面应指向本机服务');
  assert.match(src, /ensureService/, '应经 service 模块拉起服务');
  assert.match(src, /stopService/, '应经 service 模块回收服务');
  assert.match(src, /window-all-closed/, '应处理 window-all-closed');
  assert.match(src, /app\.quit\(\)/, '关窗后应退出应用');
});

t('V3 service.mjs 静态契约：ELECTRON_RUN_AS_NODE 拉起 server.mjs、健康探活、EADDRINUSE 容忍', () => {
  const src = readSrc(serviceSrcPath);
  assert.ok(src, '应存在 electron/service.mjs');
  assert.doesNotMatch(src, /require\(['"]electron|from ['"]electron['"]/, 'service 不得 import electron（保持纯 Node 可测）');
  assert.match(src, /ELECTRON_RUN_AS_NODE/, '子进程应以 ELECTRON_RUN_AS_NODE 运行');
  assert.match(src, /server\.mjs|serverPath/, '应拉起 scripts/server.mjs');
  assert.match(src, /api\/health/, '应以 /api/health 探活');
  assert.match(src, /spawn/, '应 spawn 子进程');
  assert.match(src, /EADDRINUSE|占用/, '应容忍端口被占（子进程退出不判死或明确提示）');
});

t('V4 注入契约（BUG-20260905-003 / BUG-20260909-019）：壳层经 insertCSS 为 .topbar 注入交通灯让位样式并以 !important 稳定赢得层叠，web 业务代码零改动', () => {
  // 让位样式应为可测纯模块（不 import electron），导出字符串常量供 main 与测试共用
  assert.ok(shellCss, '应存在 electron/shell-css.mjs（可测纯模块）');
  assert.doesNotMatch(
    readSrc(shellCssSrcPath) || '',
    /require\(['"]electron|from ['"]electron['"]/,
    'shell-css 不得 import electron（保持纯 Node 可测）'
  );
  const css = shellCss.TRAFFIC_LIGHT_INSET_CSS;
  assert.equal(typeof css, 'string', '应导出 TRAFFIC_LIGHT_INSET_CSS 样式字符串');
  const m = css.match(/\.topbar\s*{[^}]*padding-left:\s*(\d+)px\s*(!important)?\s*;/);
  assert.ok(m, '注入样式应作用于 .topbar 并设置 padding-left');
  assert.ok(Number(m[1]) >= 70, `让位内边距应不小于交通灯宽度约 70px（当前 ${m[1]}px）`);
  // BUG-20260909-019：insertCSS 注入表与页面 <link> 样式表同为 author origin、同 specificity，
  // 不保证排在页面规则之后（实测被 style.css 的 .topbar { padding: 10px 18px } 压制），
  // 让位声明必须带 !important 才能不依赖样式表顺序稳定赢得层叠。
  assert.ok(m[2], '让位声明必须带 !important：author 同特异性竞争下注入规则不保证居后，无 !important 会回退为遮挡（BUG-20260909-019）');
  // 让位须全宽度生效：≤640px 竖屏分支同样存在交通灯，规则不得包进宽度 @media
  assert.doesNotMatch(css, /@media[^{]*\{/, '让位规则不得包进 @media 条件（竖屏分支同样需要让位）');

  // 壳层窗口应经 webContents.insertCSS 注入该样式（仅 Electron 生效）
  const mainSrc = readSrc(mainSrcPath);
  assert.match(mainSrc, /insertCSS/, 'main.mjs 应经 webContents.insertCSS 注入样式');
  assert.match(mainSrc, /TRAFFIC_LIGHT_INSET_CSS/, 'main.mjs 应使用 shell-css 模块的注入样式');

  // 浏览器直连场景不受影响：web 业务样式不含壳层让位值，.topbar 基础规则保持原内边距
  const webCss = readSrc(webCssPath);
  assert.ok(webCss, '应存在 scripts/web/style.css');
  assert.doesNotMatch(webCss, /78px/, 'web 业务样式不应包含壳层注入的让位内边距 78px');
  assert.match(webCss, /\.topbar\s*{[^}]*padding:\s*10px 18px/, 'web 端 .topbar 基础内边距应保持原样');
});

t('V5 注入契约（BUG-20260909-020）：顶栏拖动区经壳层注入，交互控件 no-drag 豁免，web 业务代码零改动', () => {
  // 拖动区样式应为可测纯模块（不 import electron），导出字符串常量供 main 与测试共用
  assert.ok(shellCss, '应存在 electron/shell-css.mjs（可测纯模块）');
  const css = shellCss.TOPBAR_DRAG_REGION_CSS;
  assert.equal(typeof css, 'string', '应导出 TOPBAR_DRAG_REGION_CSS 拖动区样式字符串');

  // 拖动区作用于 .topbar（顶栏整体承担标题栏角色）；hiddenInset 下窗口移动依赖页面 drag region
  const m = css.match(/\.topbar\s*\{[^}]*-webkit-app-region:\s*drag\s*(!important)?\s*;/);
  assert.ok(m, '注入样式应作用于 .topbar 并声明 -webkit-app-region: drag');
  // BUG-20260909-019 口径：壳层注入声明一律 !important，不依赖注入表与页面 <link> 的顺序
  assert.ok(m[1], 'drag 声明必须带 !important：author 同特异性竞争下注入规则不保证居后（BUG-20260909-019 规范）');

  // drag 区会吞鼠标事件：顶栏交互容器（项目切换 / 待处理徽标 /「＋ 新建」）须显式 no-drag
  // （app-region 为继承属性，容器与子元素一并声明）
  const nd = css.match(/\.topbar\s+\.top-actions[^{]*\{[^}]*-webkit-app-region:\s*no-drag\s*(!important)?\s*;/);
  assert.ok(nd, '应为 .top-actions 及其子元素声明 -webkit-app-region: no-drag（豁免交互控件）');
  assert.ok(nd[1], 'no-drag 声明必须带 !important（与 drag 声明同口径）');

  // 拖动区须全宽度生效：不得包进宽度 @media（≤640px 竖屏分支顶栏同样需要可拖）
  assert.doesNotMatch(css, /@media[^{]*\{/, '拖动区规则不得包进 @media 条件（全宽度生效）');

  // 壳层窗口应注入该常量（与让位样式同通道，仅 Electron 生效）
  const mainSrc = readSrc(mainSrcPath);
  assert.match(mainSrc, /TOPBAR_DRAG_REGION_CSS/, 'main.mjs 应注入 shell-css 模块的拖动区样式');

  // 浏览器直连场景零回归：web 业务源码（html/css/js）不得引入任何 app-region 规则
  const webDir = path.join(pluginRoot, 'scripts', 'web');
  for (const f of fs.readdirSync(webDir)) {
    if (!/\.(html|css|js|mjs)$/.test(f)) continue;
    const src = readSrc(path.join(webDir, f));
    assert.ok(src !== null, `应可读取 scripts/web/${f}`);
    assert.doesNotMatch(src, /app-region/, `web 业务文件 scripts/web/${f} 不应包含 app-region 规则（仅壳层注入）`);
  }
});

// ---------- 集成（真实子进程，无需 Electron） ----------

t('I1 空闲端口：ensureService 拉起 server.mjs 并探活就绪', async () => {
  assert.ok(service, 'electron/service.mjs 应存在且可导入');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-electron-'));
  try {
    const port = await freePort();
    const handle = await service.ensureService({ port, serverPath, projectRoot: tmp, maxWaitMs: 10000, env: makeEnv(tmp) });
    try {
      assert.equal(handle.reused, false, '空闲端口应新起服务');
      assert.ok(handle.child?.pid > 0, '应返回子进程');
      assert.ok(await waitHealth(port, 5), '服务应已就绪（/api/health 200）');
    } finally {
      service.stopService(handle);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

t('I2 端口已有看板服务：复用现有实例，不新起子进程', async () => {
  assert.ok(service, 'electron/service.mjs 应存在且可导入');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-electron-'));
  try {
    const port = await freePort();
    const existing = startServer(port, tmp);
    try {
      assert.ok(await waitHealth(port), '预置 server 应已启动');
      const handle = await service.ensureService({ port, serverPath, projectRoot: tmp, maxWaitMs: 5000, env: makeEnv(tmp) });
      try {
        assert.equal(handle.reused, true, '应复用现有实例');
        assert.equal(handle.child, null, '复用时不应新起子进程');
        assert.equal(pidAlive(existing.pid), true, '原 server 不应被杀');
      } finally {
        service.stopService(handle); // 复用句柄无子进程，不应误杀 existing
      }
      assert.equal(pidAlive(existing.pid), true, 'stopService 复用句柄后原 server 仍应存活');
    } finally {
      existing.kill();
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

t('I3 stopService：子进程被终止，重复调用幂等', async () => {
  assert.ok(service, 'electron/service.mjs 应存在且可导入');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-electron-'));
  try {
    const port = await freePort();
    const handle = await service.ensureService({ port, serverPath, projectRoot: tmp, maxWaitMs: 10000, env: makeEnv(tmp) });
    const pid = handle.child.pid;
    assert.ok(pid > 0, '应拿到子进程 PID');
    service.stopService(handle);
    await sleepMs(800);
    assert.equal(pidAlive(pid), false, '子进程应已被终止');
    service.stopService(handle); // 幂等
    service.stopService({ child: null }); // 无子进程句柄不抛
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

t('I4 端口被非看板进程占用：超时明确报错且不遗留子进程', async () => {
  assert.ok(service, 'electron/service.mjs 应存在且可导入');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-electron-'));
  // 占端口：一个对 /api/health 永不回 200 的普通 http 服务
  const blocker = http.createServer((req, res) => { res.writeHead(404).end(); });
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  const port = blocker.address().port;
  try {
    await assert.rejects(
      () => service.ensureService({ port, serverPath, projectRoot: tmp, maxWaitMs: 2000, env: makeEnv(tmp) }),
      (e) => {
        assert.match(String(e.message), /占用|EADDRINUSE|就绪/, '错误信息应含端口占用/未就绪提示');
        const pid = e.child?.pid;
        if (pid) {
          assert.equal(pidAlive(pid), false, '失败路径应回收 spawn 出的子进程');
        } else {
          assert.match(String(e.message), /占用/, '未携带子进程时，错误应源于端口占用探测');
        }
        return true;
      },
      'ensureService 应在超时后报错'
    );
  } finally {
    blocker.close();
    fs.rmSync(tmp, { recursive: true, force: true });
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
