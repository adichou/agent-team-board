#!/usr/bin/env node
// REQ-20260908-007 —— 终端可直接运行的 shell 命令：
// ① bin/atb POSIX 包装器（直接运行 / 经符号链接运行 / 参数透传）；
// ② atb cli install|uninstall|status（符号链接安装、幂等、外来文件保护、无需看板数据目录）；
// ③ USAGE / SKILL.md 帮助同步。
// 用法：node scripts/tests/cli-shell.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const atbCli = path.join(pluginRoot, 'scripts', 'atb.mjs');
const binAtb = path.join(pluginRoot, 'bin', 'atb');

const spawnProc = (cmd, args, cwd, timeoutMs = 20000) => new Promise((resolve) => {
  const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  p.stdout.on('data', (c) => { out += c; });
  p.stderr.on('data', (c) => { err += c; });
  const timer = setTimeout(() => { p.kill(); resolve({ code: 124, out, err }); }, timeoutMs);
  p.on('error', (e) => { clearTimeout(timer); resolve({ code: null, err: String(e.message), out }); });
  p.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
});

// 运行 node 版 CLI（任意目录可用，不依赖执行位）
const runAtb = (args, cwd) => spawnProc(process.execPath, [atbCli, ...args], cwd);
// 运行 shell 包装器（直接或经符号链接）
const runBin = (binPath, args, cwd) => spawnProc(binPath, args, cwd);

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-cli-shell-')));
const rm = (d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} };

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// T1 包装器文件基础属性：存在、shebang、执行位
t('T1 bin/atb 存在、带 shebang、有执行位', () => {
  const st = fs.statSync(binAtb);
  assert.ok(st.isFile(), 'bin/atb 应为普通文件');
  assert.ok(st.mode & 0o111, 'bin/atb 应有执行位');
  const head = fs.readFileSync(binAtb, 'utf8').split('\n')[0];
  assert.match(head, /^#!/, '首行应为 shebang');
});

// T2 直接运行：包装器能定位插件根并转交 node
t('T2 直接运行 bin/atb --help：退出 0，输出 atb 主用法', async () => {
  const r = await runBin(binAtb, ['--help'], tmp());
  assert.equal(r.code, 0, `退出码应为 0（err=${r.err}）`);
  assert.match(r.out, /atb —— 智能体团队看板 CLI/, '应输出主用法标题');
});

// T3 符号链接运行：安装到 PATH 的形态
t('T3 经符号链接运行：退出 0，输出主用法（链接解析穿透）', async () => {
  const d = tmp();
  try {
    fs.symlinkSync(binAtb, path.join(d, 'atb'));
    const r = await runBin(path.join(d, 'atb'), ['--help'], d);
    assert.equal(r.code, 0, `经链接运行应成功（err=${r.err}）`);
    assert.match(r.out, /atb —— 智能体团队看板 CLI/);
  } finally { rm(d); }
});

// T4 链接形态参数透传：数据命令真实可用
t('T4 链接形态参数透传：tmp/atb new req 在临时项目真实创建条目', async () => {
  const root = tmp();
  const d = tmp();
  try {
    assert.equal((await runAtb(['init'], root)).code, 0);
    fs.symlinkSync(binAtb, path.join(d, 'atb'));
    const r = await runBin(path.join(d, 'atb'), ['new', 'req', '包装器建单'], root);
    assert.equal(r.code, 0, `建单应成功（err=${r.err}）`);
    assert.match(r.out, /REQ-\d{8}-\d{3}/, '输出应含新单号');
    const id = r.out.match(/(REQ-\d{8}-\d{3})/)[0];
    const lst = await runAtb(['list', '--json'], root);
    assert.match(lst.out, new RegExp(id), '条目应已落盘');
  } finally { rm(root); rm(d); }
});

// T5 cli install：创建符号链接、realpath 指向本插件 bin/atb、链接形态 list 可用
t('T5 cli install --to <目录>：安装成功，链接指向本插件 bin/atb，atb list 可用', async () => {
  const root = tmp();
  const binDir = tmp();
  try {
    assert.equal((await runAtb(['init'], root)).code, 0);
    const anywhere = tmp(); // install 不要求在看板项目内执行
    const r = await runAtb(['cli', 'install', '--to', binDir], anywhere);
    rm(anywhere);
    assert.equal(r.code, 0, `install 应成功（err=${r.err}）`);
    const link = path.join(binDir, 'atb');
    assert.ok(fs.lstatSync(link).isSymbolicLink(), '应为符号链接');
    assert.equal(fs.realpathSync(link), fs.realpathSync(binAtb), 'realpath 应指向本插件 bin/atb');
    const lst = await runBin(link, ['list'], root);
    assert.equal(lst.code, 0, `链接形态 list 应可用（err=${lst.err}）`);
    assert.match(lst.out, /（暂无条目|共 \d+ 条）/, '应正常输出列表');
  } finally { rm(root); rm(binDir); }
});

// T6 install 幂等
t('T6 install 幂等：重复安装退出 0、输出「= 已安装」、链接不变', async () => {
  const binDir = tmp();
  const anywhere = tmp();
  try {
    const first = await runAtb(['cli', 'install', '--to', binDir], anywhere);
    assert.equal(first.code, 0);
    const link = path.join(binDir, 'atb');
    const before = fs.readlinkSync(link);
    const second = await runAtb(['cli', 'install', '--to', binDir], anywhere);
    assert.equal(second.code, 0, '重复 install 应幂等成功');
    assert.match(second.out, /= 已安装/, '应有幂等提示');
    assert.equal(fs.readlinkSync(link), before, '链接不应被重建');
  } finally { rm(binDir); rm(anywhere); }
});

// T7 install 拒绝覆盖外来文件
t('T7 install 拒绝覆盖：外来普通文件与他指链接均非 0 退出、原样保留', async () => {
  const foreign = tmp();
  const elsewhere = tmp();
  const anywhere = tmp();
  try {
    fs.writeFileSync(path.join(foreign, 'atb'), '#!/bin/sh\necho foreign\n');
    const a = await runAtb(['cli', 'install', '--to', foreign], anywhere);
    assert.notEqual(a.code, 0, '目标已有普通文件应拒绝');
    assert.equal(fs.readFileSync(path.join(foreign, 'atb'), 'utf8'), '#!/bin/sh\necho foreign\n', '外来文件不得被改动');

    fs.symlinkSync('/bin/true', path.join(elsewhere, 'atb'));
    const b = await runAtb(['cli', 'install', '--to', elsewhere], anywhere);
    assert.notEqual(b.code, 0, '目标已有他指链接应拒绝');
    assert.equal(fs.readlinkSync(path.join(elsewhere, 'atb')), '/bin/true', '他指链接不得被改动');
  } finally { rm(foreign); rm(elsewhere); rm(anywhere); }
});

// T8 uninstall：删除已装链接 + 幂等
t('T8 cli uninstall --to：删除已装链接；再次执行幂等返回「未安装」', async () => {
  const binDir = tmp();
  const anywhere = tmp();
  try {
    assert.equal((await runAtb(['cli', 'install', '--to', binDir], anywhere)).code, 0);
    const off = await runAtb(['cli', 'uninstall', '--to', binDir], anywhere);
    assert.equal(off.code, 0, 'uninstall 应成功');
    assert.ok(!fs.existsSync(path.join(binDir, 'atb')), '链接应已删除');
    const again = await runAtb(['cli', 'uninstall', '--to', binDir], anywhere);
    assert.equal(again.code, 0, '未安装时 uninstall 应幂等');
    assert.match(again.out, /未安装/, '应有未安装提示');
  } finally { rm(binDir); rm(anywhere); }
});

// T9 uninstall 拒绝删外来文件
t('T9 uninstall 拒绝删除外来文件：普通文件保留、非 0 退出', async () => {
  const foreign = tmp();
  const anywhere = tmp();
  try {
    fs.writeFileSync(path.join(foreign, 'atb'), 'keep me\n');
    const r = await runAtb(['cli', 'uninstall', '--to', foreign], anywhere);
    assert.notEqual(r.code, 0, '外来文件应拒绝删除');
    assert.equal(fs.readFileSync(path.join(foreign, 'atb'), 'utf8'), 'keep me\n', '文件应原样保留');
  } finally { rm(foreign); rm(anywhere); }
});

// T10 cli status：无需看板数据目录，输出包装器与候选目录状态
t('T10 cli status：在未 init 的目录运行，输出包装器路径与候选目录状态', async () => {
  const r = await runAtb(['cli', 'status'], tmp());
  assert.equal(r.code, 0, `status 应成功（err=${r.err}）`);
  assert.match(r.out, /bin\/atb/, '应展示包装器路径');
  assert.match(r.out, /\.local\/bin/, '应展示候选目录（~/.local/bin）');
});

// T11 帮助同步：主 USAGE 与 SKILL.md（SKILL.md 用 $ATB 指代 node 版 CLI）
t('T11 文档同步：主 USAGE 与 SKILL.md 含 cli install 用法', async () => {
  const h = await runAtb(['--help'], pluginRoot);
  assert.equal(h.code, 0);
  assert.match(h.out, /atb cli install/, '主 USAGE 应含 cli install');
  const skill = fs.readFileSync(path.join(pluginRoot, 'skills', 'agent-team-board', 'SKILL.md'), 'utf8');
  assert.match(skill, /\$ATB cli install/, 'SKILL.md 速查应含 cli install');
});

// T12 cli 子命令不依赖看板数据目录
t('T12 cli 子命令无需看板数据目录：未 init 目录执行 install/status 不报「未找到」', async () => {
  const d = tmp();
  const binDir = tmp();
  try {
    for (const args of [['cli', 'status'], ['cli', 'install', '--to', binDir], ['cli', 'uninstall', '--to', binDir]]) {
      const r = await runAtb(args, d);
      assert.equal(r.code, 0, `${args.join(' ')} 应不依赖数据目录（err=${r.err}）`);
      assert.ok(!/未找到 docs\/agent-team-board/.test(r.out + r.err), '不得因缺数据目录报错');
    }
  } finally { rm(d); rm(binDir); }
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
