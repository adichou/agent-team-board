#!/usr/bin/env node
// REQ-20260920-004 命令模块（atb 命令界面按钮下发）—— 注册表 / 服务端 / 前端契约 / i18n 测试 C1~C4。
// C1：注册表与 atb.mjs 命令面双向一致（无虚构无遗漏）、排除三组恒不出现、高危/禁用清单、白名单校验。
// C2：服务端全链路（清单 / 白名单拒绝 / 真实执行成功与失败 / 同项目在途互斥 / run-status / 静态资源）。
// C3：前端契约（页签位置 / 容器 / 加载顺序 / app.js 接线 / commands.js 行为标记 / 样式）。
// C4：i18n 中英同步（commands.js 源码片段 + 注册表数据全覆盖）。
// 用法：node scripts/tests/req-20260920-004.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as cliRegistry from '../lib/cli-registry.mjs';
import { makeScanner, extractFragments } from './lib/js-string-scanner.mjs';
import '../web/i18n.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function req(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const r = http.request({
      hostname: '127.0.0.1', port, path: pathname, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 10000,
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

// 轮询 run-status 直至结束（最长 maxMs），返回最终 job；超时抛错（防悬挂）
async function waitFinished(port, P, maxMs = 20000) {
  const deadline = Date.now() + maxMs;
  for (;;) {
    const r = await req(port, 'GET', `/api/cli/run-status${P}`);
    assert.equal(r.status, 200, `run-status 应可用：${r.text}`);
    if (!r.json.running) return r.json;
    if (Date.now() > deadline) throw new Error('执行未在时限内结束（悬挂在执行中）');
    await sleep(150);
  }
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* ---------- C1 命令注册表 ---------- */

t('C1a 注册表与 atb.mjs 命令面双向一致（无虚构、无遗漏）', () => {
  const atbSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'atb.mjs'), 'utf8');
  const registered = new Set();
  for (const m of atbSrc.matchAll(/if \(cmd === '([a-z][\w-]*)'\)/g)) registered.add(m[1]);
  assert.ok(registered.size >= 20, `应提取到 atb.mjs 主命令面（得到 ${registered.size}）`);
  const excluded = new Set(['oncall', 'disc', 'growth', 'help']);
  const cliTop = new Set(cliRegistry.allCommands().map((c) => c.name.split(' ')[0]));
  // 无虚构：注册表首 token 全部是 atb.mjs 已注册主命令
  const fictional = [...cliTop].filter((x) => !registered.has(x));
  assert.deepEqual(fictional, [], `注册表出现 atb 未注册命令（虚构）：${fictional.join('、')}`);
  // 无遗漏：atb.mjs 主命令（排除三组与 help）全部被注册表覆盖
  const missing = [...registered].filter((x) => !excluded.has(x) && !cliTop.has(x));
  assert.deepEqual(missing, [], `注册表遗漏 atb 已注册命令：${missing.join('、')}`);
});

t('C1b 排除三组恒不出现（oncall / disc / growth）', () => {
  assert.deepEqual([...cliRegistry.EXCLUDED_PREFIXES].sort(), ['disc', 'growth', 'oncall']);
  for (const c of cliRegistry.allCommands()) {
    const top = c.name.split(' ')[0];
    assert.ok(!cliRegistry.EXCLUDED_PREFIXES.includes(top), `命令 ${c.name} 不应进入注册表（排除组）`);
  }
});

t('C1c 分组结构、高危 / 禁用 / 长耗时清单符合验收口径', () => {
  const groups = cliRegistry.CLI_GROUPS;
  const labels = groups.map((g) => g.label);
  for (const want of ['数据与分发', '条目生命周期', 'AI 开发', '执行回执', '人工决策', '挂起确认', 'AI 分析', '发布文档 AI 总结', '查询', '服务', '终端命令']) {
    assert.ok(labels.includes(want), `缺少分组「${want}」`);
  }
  const names = new Set(cliRegistry.allCommands().map((c) => c.name));
  const wantNames = [
    'init', 'migrate', 'rebuild', 'pack',
    'new req', 'new bug', 'claim', 'rename', 'delete', 'status', 'report', 'move', 'prune-locks',
    'batch create', 'batch next', 'batch check', 'batch summary', 'batch pause', 'batch records', 'batch delete',
    'run receipt', 'run release', 'run autocommit',
    'hold declare', 'hold list', 'hold show', 'hold answer', 'hold resume', 'hold cancel',
    'confirm list', 'confirm show',
    'refine create', 'refine next', 'refine done', 'refine fail', 'refine release', 'refine check', 'refine summary', 'refine pause', 'refine abort', 'refine records',
    'summary start', 'summary file', 'summary done', 'summary fail', 'summary show',
    'list', 'show', 'commit log', 'commit which',
    'serve',
    'cli install', 'cli uninstall', 'cli status',
  ];
  for (const n of wantNames) assert.ok(names.has(n), `注册表缺少命令 ${n}`);
  const danger = cliRegistry.allCommands().filter((c) => c.danger).map((c) => c.name);
  for (const d of ['delete', 'status', 'batch delete', 'refine abort', 'migrate', 'rebuild', 'prune-locks', 'pack']) {
    assert.ok(danger.includes(d), `高危清单缺少 ${d}（验收下限）`);
  }
  assert.ok(!danger.includes('serve'), 'serve 仅影响告知，不列入高危');
  for (const c of cliRegistry.allCommands()) {
    if (c.name.startsWith('cli ')) assert.equal(c.disabled, true, `${c.name} 应为禁用（终端指引）`);
  }
  const serve = cliRegistry.findCommand('serve');
  assert.ok(serve && serve.serve === true, 'serve 应带 serve 标记（影响告知）');
});

t('C1d validateRunRequest 白名单校验', () => {
  assert.equal(cliRegistry.validateRunRequest({ command: 'no-such-cmd', args: [] }).ok, false, '未注册命令拒绝');
  assert.equal(cliRegistry.validateRunRequest({ command: 42, args: [] }).ok, false, 'command 非字符串拒绝');
  assert.equal(cliRegistry.validateRunRequest().ok, false, '缺 body 拒绝');
  assert.equal(cliRegistry.validateRunRequest({ command: 'list', args: '--json' }).ok, false, 'args 非数组拒绝');
  assert.equal(cliRegistry.validateRunRequest({ command: 'list', args: [42] }).ok, false, 'args 含非字符串拒绝');
  assert.equal(cliRegistry.validateRunRequest({ command: 'list', args: ['--dir', '/tmp'] }).ok, false, 'args 携带 --dir 拒绝');
  assert.equal(cliRegistry.validateRunRequest({ command: 'cli status', args: [] }).ok, false, 'disabled 命令拒绝执行');
  assert.equal(cliRegistry.validateRunRequest({ command: 'batch delete', args: [] }).ok, false, 'batch delete 必填参数缺失时以表单校验为准（服务端放行，白名单只管命令面）');
  const ok = cliRegistry.validateRunRequest({ command: 'show', args: ['REQ-20260920-004'] });
  assert.equal(ok.ok, true, '合法命令通过');
  assert.equal(ok.spec.name, 'show');
});

/* ---------- C2 服务端全链路 ---------- */

t('C2 服务端命令清单 / 白名单执行 / 互斥 / run-status 全链路', async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atb-cli-serve-')));
  const projA = path.join(tmp, 'projA');
  const projB = path.join(tmp, 'projB');
  fs.mkdirSync(projA);
  fs.mkdirSync(projB);
  core.initData(projA);
  core.initData(projB);
  const dataDirA = core.dataDirFrom(projA);
  const itemA = core.createItem(dataDirA, { type: 'requirement', title: '演示需求（含 空格）', by: 'test' });

  const reg = path.join(tmp, 'reg.json');
  const spawnOnPort = async (port) => {
    const child = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
      cwd: projA,
      env: { ...process.env, ATB_PORT: String(port), ATB_REGISTRY: reg },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try {
        const h = await req(port, 'GET', '/api/health');
        if (h.json && h.json.port === port) return child;
      } catch {}
      if (child.exitCode !== null) break;
    }
    child.kill('SIGTERM');
    return null;
  };
  let server = null;
  let port = 0;
  for (let i = 0; i < 6 && !server; i++) {
    port = 31000 + Math.floor(Math.random() * 20000);
    server = await spawnOnPort(port);
  }
  assert.ok(server, `服务应启动（最后端口 ${port}）`);
  const P = `?project=${encodeURIComponent(projA)}`;
  const PB = `?project=${encodeURIComponent(projB)}`;
  try {
    // C2a 命令清单：分组 / 命令 / 参数元数据；排除三组不出现
    let r = await req(port, 'GET', '/api/cli/commands');
    assert.equal(r.status, 200, `清单应可用：${r.text}`);
    assert.ok(Array.isArray(r.json.groups) && r.json.groups.length === 12, `分组数应 12（数据与分发…终端命令，含发布文档 AI 总结 / AI 翻译）：${r.json.groups?.length}`);
    const flat = r.json.groups.flatMap((g) => g.commands.map((c) => c.name));
    assert.ok(flat.includes('batch delete') && flat.includes('commit which') && flat.includes('prune-locks'));
    assert.ok(!flat.some((n) => /^(oncall|disc|growth)\b/.test(n)), '排除三组恒不出现');
    const showCmd = r.json.groups.flatMap((g) => g.commands).find((c) => c.name === 'show');
    assert.ok(showCmd.args?.length >= 1 && showCmd.args[0].required === true, 'show 应带必填 ID 参数元数据');
    const delCmd = r.json.groups.flatMap((g) => g.commands).find((c) => c.name === 'delete');
    assert.equal(delCmd.danger, true, 'delete 应标高危');

    // C2b 白名单拒绝：未注册 / --dir 注入 / disabled / args 非数组
    r = await req(port, 'POST', `/api/cli/run${P}`, { command: 'rm -rf', args: ['/'] });
    assert.equal(r.status, 400, '未注册命令必须拒绝');
    r = await req(port, 'POST', `/api/cli/run${P}`, { command: 'list', args: ['--dir', '/tmp'] });
    assert.equal(r.status, 400, 'args 携带 --dir 必须拒绝（项目根由服务端注入）');
    r = await req(port, 'POST', `/api/cli/run${P}`, { command: 'cli status', args: [] });
    assert.equal(r.status, 400, 'disabled 命令（cli 组）拒绝执行');
    r = await req(port, 'POST', `/api/cli/run${P}`, { command: 'list', args: '--json' });
    assert.equal(r.status, 400, 'args 非数组拒绝');
    r = await req(port, 'POST', `/api/cli/run${P}`, { command: null, args: [] });
    assert.equal(r.status, 400, 'command 缺失拒绝');

    // C2c 真实执行成功：参数数组逐个传递（标题含空格完整创建，不经 shell 拆分）
    r = await req(port, 'POST', `/api/cli/run${P}`, { command: 'new req', args: ['界面 创建 的 需求（含空格）'] });
    assert.equal(r.status, 200, `new req 应受理：${r.text}`);
    assert.ok(r.json.runId, '受理响应应带 runId');
    let job = await waitFinished(port, P);
    assert.equal(job.exitCode, 0, `new req 应成功：${job.stderr}`);
    assert.ok(job.durationMs >= 0);
    const created = core.listItems(dataDirA).find((x) => x.title === '界面 创建 的 需求（含空格）');
    assert.ok(created, '参数按数组逐个传递（含空格标题完整创建，非 shell 拼接拆分）');

    r = await req(port, 'POST', `/api/cli/run${P}`, { command: 'list', args: [] });
    assert.equal(r.status, 200);
    job = await waitFinished(port, P);
    assert.equal(job.exitCode, 0, `list 应成功：${job.stderr}`);
    assert.ok(job.stdout.includes(itemA.id), 'stdout 完整回显条目');
    assert.match(job.stdout, /演示需求/);

    // C2d 失败链路：退出码非 0 + stderr 完整回显
    r = await req(port, 'POST', `/api/cli/run${P}`, { command: 'show', args: ['REQ-20990101-999'] });
    assert.equal(r.status, 200);
    job = await waitFinished(port, P);
    assert.notEqual(job.exitCode, 0, '不存在条目应失败');
    assert.ok(String(job.stderr).length > 0, 'stderr 完整回显');

    // C2e 同项目在途互斥：第一发完成前（node 冷启动窗口）再发同项目 409；他项目不受影响
    r = await req(port, 'POST', `/api/cli/run${P}`, { command: 'list', args: [] });
    assert.equal(r.status, 200);
    const r2 = await req(port, 'POST', `/api/cli/run${P}`, { command: 'list', args: [] });
    assert.equal(r2.status, 409, '同项目在途时应 409 拒绝重复下发');
    const rB = await req(port, 'POST', `/api/cli/run${PB}`, { command: 'list', args: [] });
    assert.equal(rB.status, 200, '互斥按项目隔离：他项目可下发');
    await waitFinished(port, P);
    await waitFinished(port, PB);

    // C2f run-status：无执行记录的项目返回 404（服务重启内存丢失 → 前端判结果未知）
    const projC = path.join(tmp, 'projC');
    fs.mkdirSync(projC);
    core.initData(projC);
    r = await req(port, 'GET', `/api/cli/run-status?project=${encodeURIComponent(projC)}`);
    assert.equal(r.status, 404, '无记录应 404');
    // 在途时 run-status 报 running 与命令回显
    r = await req(port, 'POST', `/api/cli/run${P}`, { command: 'list', args: ['--json'] });
    assert.equal(r.status, 200);
    r = await req(port, 'GET', `/api/cli/run-status${P}`);
    assert.equal(r.status, 200);
    assert.equal(typeof r.json.running, 'boolean');
    assert.equal(r.json.name, 'list');
    job = await waitFinished(port, P);
    assert.equal(job.exitCode, 0);
    assert.match(job.stdout, /"count"/, '--json 参数逐个透传生效');

    // C3d 静态 commands.js 可获取且挂载 ATBCommands
    r = await req(port, 'GET', '/commands.js');
    assert.equal(r.status, 200, '静态 commands.js 应可获取');
    assert.match(r.text, /ATBCommands/, 'commands.js 应挂载 ATBCommands');
  } finally {
    server.kill('SIGTERM');
    await sleep(200);
  }
});

/* ---------- C3 前端契约 ---------- */

t('C3a index.html：命令页签位于任务与设置之间；容器与加载顺序', () => {
  const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
  const runsIdx = html.indexOf('data-view="runs"');
  const cmdIdx = html.indexOf('data-view="commands"');
  const setIdx = html.indexOf('data-view="settings"');
  assert.ok(runsIdx > 0 && cmdIdx > 0 && setIdx > 0, '顶栏应有 任务 / 命令 / 设置 页签');
  assert.ok(runsIdx < cmdIdx && cmdIdx < setIdx, '「命令」页签应位于「任务」与「设置」之间');
  assert.ok(html.includes('id="commandsView"'), '应有 #commandsView 容器');
  const jsIdx = html.indexOf('<script src="/commands.js"></script>');
  const appIdx = html.indexOf('<script src="/app.js"></script>');
  assert.ok(jsIdx > 0 && jsIdx < appIdx, 'commands.js 必须在 app.js 之前加载');
});

t('C3b app.js 接线：VIEWS / setView 联动 / 副标题 / 全局搜索隐藏 / `/` 聚焦模块搜索', () => {
  const app = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
  assert.match(app, /VIEWS = \[[^\]]*'commands'/, 'VIEWS 应含 commands');
  assert.match(app, /ATBCommands\?\.enter/, 'setView 应联动 ATBCommands.enter');
  assert.match(app, /MODULE_SUB[\s\S]*?commands:/, 'MODULE_SUB 应含命令模块副标题');
  assert.match(app, /state\.view === 'commands'/, '命令模块应隐藏全局搜索框（updatePageHead 分支）');
  assert.match(app, /ATBCommands\?\.focusSearch/, '`/` 快捷键在命令模块应聚焦模块内搜索框');
});

t('C3c commands.js 行为标记：竖排页签 / 平铺列表 / 高危确认 / serve 告知 / cli 指引 / 历史 20 / 去重 10 / 必填 / 预览 / 初始化引导', () => {
  const js = fs.readFileSync(path.join(webRoot, 'commands.js'), 'utf8');
  assert.match(js, /window\.ATBCommands/, '应挂载 window.ATBCommands');
  assert.ok(js.includes('最近执行') && js.includes('全部命令'), '左缘竖排页签两项');
  assert.ok(js.includes('vertical-rl') || fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8').includes('vertical-rl'), '竖排页签形态（CSS）');
  for (const mark of [
    '需确认',            // 高危按钮文字标识（不只靠颜色）
    '确认执行',          // 高危二次确认框
    '影响提示',          // serve 按钮标识
    '服务重启中',        // serve 断连预期态
    '终端执行',          // cli 组禁用标识
    '（无输出）',        // 无输出命令明确显示
    '必填项缺失',        // 必填校验就近提示
    '--dir',             // 命令预览与下发绑定项目根
    '初始化看板',        // 未初始化项目引导（needsBoard）
    '附加参数',          // 常用选项入口
  ]) {
    assert.ok(js.includes(mark), `commands.js 应包含行为标记「${mark}」`);
  }
  assert.match(js, /20/, '执行历史上限 20 出现于源码');
  assert.match(js, /> 20|>= 20|length = 20|splice\(20|slice\(0, ?20\)/, '历史超 20 淘汰最旧');
  assert.match(js, /> 10|>= 10|length = 10|splice\(10|slice\(0, ?10\)/, '最近执行去重上限 10');
  assert.match(js, /exitCode === 0|code === 0/, '最近执行仅成功（退出码 0）计入');
  assert.match(js, /run-status/, '应轮询 run-status');
  assert.doesNotMatch(js, /清空历史/, '不提供「清空历史」入口');
});

t('C3d style.css：命令模块样式存在', () => {
  const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');
  for (const sel of ['.commands-view', '.cmd-ltab', '.cmd-item', '.cmd-detail']) {
    assert.ok(css.includes(sel), `style.css 应含 ${sel}`);
  }
});

/* ---------- C4 i18n 中英同步 ---------- */

t('C4 commands.js 静态片段与注册表数据全部命中词典', () => {
  const I = globalThis.ATBI18N;
  assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');
  const { EN, EN_DYNAMIC, ALLOWLIST } = I._dict;
  const js = fs.readFileSync(path.join(webRoot, 'commands.js'), 'utf8');
  const { texts, attrs } = extractFragments(makeScanner().run(js).map((r) => r));
  const miss1 = [...new Set([...texts, ...attrs])].filter((s) => !(s in EN || s in EN_DYNAMIC || s in ALLOWLIST));
  assert.deepEqual(miss1, [], `commands.js 片段缺词典：\n${miss1.map((s) => '  - ' + s).join('\n')}`);
  // 注册表数据（分组名 / 命令说明 / 参数标签 / 占位提示）全部入词典
  const dataTexts = new Set();
  for (const g of cliRegistry.CLI_GROUPS) {
    dataTexts.add(g.label);
    for (const c of g.commands) {
      dataTexts.add(c.desc);
      for (const a of c.args || []) {
        dataTexts.add(a.label);
        if (a.placeholder) dataTexts.add(a.placeholder);
      }
      if (c.options) dataTexts.add(c.options);
      if (c.disabledReason) dataTexts.add(c.disabledReason);
    }
  }
  const miss2 = [...dataTexts].filter((s) => !(s in EN) && !(s in EN_DYNAMIC) && !/^[\x20-\x7e]+$/.test(s));
  assert.deepEqual(miss2, [], `注册表数据缺词典：\n${miss2.map((s) => '  - ' + s).join('\n')}`);
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
