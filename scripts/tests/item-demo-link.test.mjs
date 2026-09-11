#!/usr/bin/env node
// BUG-20260908-021 集成测试 —— 条目详情里的相对 .html 演示链接在看板内可打开
// 用法：node scripts/tests/item-demo-link.test.mjs
// 覆盖 test-cases.md 的 D1–D7（端点行为）与 U1–U4（前端接线契约/行为）。
// 方案：新增只读端点 /api/item/:id/demo/:name（按条目目录定位 .html，CSP 收敛沙箱）；
// 前端 loadDoc 渲染后经 linkupDocDemo 把「单文件名 .html/.htm」相对链接改写到该端点。

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as core from '../lib/core.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------- 测试环境：两个临时项目（同名演示文件，验证不串单/不串项目） ----------

function mkProject(tag, demoBody) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `atb-demolink-${tag}-`));
  const project = fs.realpathSync(tmp);
  core.initData(project);
  const dataDir = core.dataDirFrom(project);
  const item = core.createItem(dataDir, { type: 'requirement', title: `演示宿主${tag}`, by: 'test' });
  const dir = path.join(dataDir, 'requirements', item.id);
  fs.writeFileSync(path.join(dir, 'ui-demo.html'), demoBody);
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${item.id} 演示宿主${tag}\n\n[Demo](./ui-demo.html)\n`);
  // 同项目第二个条目（同日序号 +1）：验证同项目内同名演示文件不串单
  const item2 = core.createItem(dataDir, { type: 'requirement', title: `演示宿主${tag}二`, by: 'test' });
  const dir2 = path.join(dataDir, 'requirements', item2.id);
  fs.writeFileSync(path.join(dir2, 'ui-demo.html'), demoBody.replace('唯一标记', '唯一标记2'));
  return { tmp, project, dataDir, item, dir, item2, dir2 };
}

const PROJ_A = mkProject('a', '<!doctype html><html><body><p>demo-A-唯一标记</p><script>document.title="A"</script></body></html>');
const PROJ_B = mkProject('b', '<!doctype html><html><body><p>demo-B-唯一标记</p><script>document.title="B"</script></body></html>');
// 仅 A 项目有的第三个条目（当日 -003）：跨项目定位核验用（B 只有 -001/-002）
const PROJ_A_ITEM3 = core.createItem(PROJ_A.dataDir, { type: 'requirement', title: '演示宿主a三', by: 'test' });
fs.writeFileSync(
  path.join(PROJ_A.dataDir, 'requirements', PROJ_A_ITEM3.id, 'ui-demo.html'),
  '<!doctype html><html><body><p>demo-A3-唯一标记</p></body></html>',
);

const registryFile = path.join(PROJ_A.tmp, 'projects.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function request(method, url, body, extraHeaders) {
  const __http = http;
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = { ...(extraHeaders || {}) };
    if (body) headers['Content-Type'] = 'application/json';
    const req = __http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = {};
          try { json = JSON.parse(text || '{}'); } catch {}
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let serverProc = null;
let base = '';

async function tryStartServer(port) {
  const proc = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: PROJ_A.project,
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

// ---------- 用例 ----------
const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const Q = encodeURIComponent;

const demoUrl = (item, name, project) =>
  `${base}/api/item/${Q(item)}/demo/${Q(name)}?project=${Q(project)}`;

t('D1 演示端点返回条目目录内 HTML 原始字节 + 收敛 CSP（内联交互可用、外部加载全禁）', async () => {
  const r = await request('GET', demoUrl(PROJ_A.item.id, 'ui-demo.html', PROJ_A.project));
  assert.equal(r.status, 200, `ui-demo.html 应 200，得到 ${r.status}：${r.text.slice(0, 200)}`);
  assert.match(r.headers['content-type'] || '', /^text\/html; charset=utf-8/, 'Content-Type 应为 text/html; charset=utf-8');
  assert.equal(r.text, fs.readFileSync(path.join(PROJ_A.dir, 'ui-demo.html'), 'utf8'), '响应正文应与源文件逐字节一致');
  assert.equal(r.headers['x-content-type-options'], 'nosniff', '应带 nosniff');
  const csp = r.headers['content-security-policy'] || '';
  assert.match(csp, /default-src\s+'none'/, 'CSP 应 default-src none（fetch/XHR/外链全禁，管理接口隔离）');
  assert.match(csp, /script-src\s+'unsafe-inline'/, 'CSP 应放行内联脚本（演示按钮/页签交互）');
  assert.match(csp, /style-src\s+'unsafe-inline'/, 'CSP 应放行内联样式');
  assert.match(csp, /base-uri\s+'none'/, 'CSP 应禁 base 注入');
  assert.match(csp, /frame-ancestors\s+'none'/, 'CSP 应禁止被他页内嵌');
  assert.equal(r.headers['cache-control'], 'no-store', '应 no-store 与本地看板一致');
});

t('D2 同名文件不串单、不串项目', async () => {
  // 同项目两个条目、同名演示文件：各回各家（不串单）
  const a1 = await request('GET', demoUrl(PROJ_A.item.id, 'ui-demo.html', PROJ_A.project));
  const a2 = await request('GET', demoUrl(PROJ_A.item2.id, 'ui-demo.html', PROJ_A.project));
  assert.equal(a1.status, 200);
  assert.equal(a2.status, 200);
  assert.match(a1.text, /demo-A-唯一标记(?!2)/, 'A 条目一应返回自己的内容');
  assert.match(a2.text, /demo-A-唯一标记2/, 'A 条目二应返回自己的内容');
  assert.notEqual(a1.text, a2.text, '同项目不同条目的同名演示应能区分');
  // 跨项目：A 独有条目（-003）在 B 项目不存在（B 只有 -001/-002）→ 404，不回落默认项目
  const cross = await request('GET', demoUrl(PROJ_A_ITEM3.id, 'ui-demo.html', PROJ_B.project));
  assert.equal(cross.status, 404, `跨项目应 404，得到 ${cross.status}`);
  assert.match(cross.text, new RegExp(PROJ_A_ITEM3.id), '提示应包含条目号，说明定位上下文');
  // 同号条目（两项目各自的 REQ-…-001）按 project 参数各归各项目（多项目切换定位正确）
  const b1 = await request('GET', demoUrl(PROJ_B.item.id, 'ui-demo.html', PROJ_B.project));
  assert.equal(b1.status, 200);
  assert.match(b1.text, /demo-B-唯一标记/, 'B 项目条目应返回 B 项目内容');
  assert.notEqual(a1.text, b1.text, '两项目同号条目内容不得互串');
});

t('D3 文件/条目不存在 → 404 人读 HTML 提示页', async () => {
  const miss = await request('GET', demoUrl(PROJ_A.item.id, 'no-such.html', PROJ_A.project));
  assert.equal(miss.status, 404, `缺失文件应 404，得到 ${miss.status}`);
  assert.match(miss.headers['content-type'] || '', /^text\/html/, '提示应为 HTML（供直接导航打开时人读）');
  assert.match(miss.text, /no-such\.html/, '提示应包含缺失文件名');
  assert.match(miss.text, new RegExp(PROJ_A.item.id), '提示应包含条目号（定位到条目目录）');
  assert.match(miss.headers['content-security-policy'] || '', /default-src\s+'none'/, '提示页同样收敛 CSP');
  const noItem = await request('GET', demoUrl('REQ-19990101-999', 'ui-demo.html', PROJ_A.project));
  assert.equal(noItem.status, 404, `不存在条目应 404，得到 ${noItem.status}`);
  assert.match(noItem.text, /REQ-19990101-999/, '提示应包含条目号');
});

t('D4 非法名称一律 400 拒绝：子目录/穿越/非 html/隐藏文件/裸路径', async () => {
  const bad = [
    ['sub/x.html', '子目录'],
    ['../README.md', '向上穿越'],
  ];
  for (const [name] of bad) {
    const r = await request('GET', demoUrl(PROJ_A.item.id, name, PROJ_A.project));
    assert.equal(r.status, 400, `${name} 应 400，得到 ${r.status}：${r.text.slice(0, 120)}`);
    assert.doesNotMatch(r.text, /# BUG-20260908-021|# 设计/, `${name} 不得泄露条目文档内容`);
  }
  // %2F 解码后含斜杠：同样 400 提示页（不落到「未知接口」JSON）
  const enc = await request('GET', `${base}/api/item/${Q(PROJ_A.item.id)}/demo/..%2F..%2FREADME.md?project=${Q(PROJ_A.project)}`);
  assert.equal(enc.status, 400, `编码穿越应 400，得到 ${enc.status}`);
  assert.match(enc.headers['content-type'] || '', /^text\/html/, '编码穿越提示应为 HTML');
  for (const name of ['notes.md', '.hidden.html']) {
    const r = await request('GET', demoUrl(PROJ_A.item.id, name, PROJ_A.project));
    assert.equal(r.status, 400, `${name} 应 400，得到 ${r.status}`);
  }
  const bare = await request('GET', `${base}/api/item/${Q(PROJ_A.item.id)}/demo?project=${Q(PROJ_A.project)}`);
  assert.equal(bare.status, 400, `缺文件名应 400，得到 ${bare.status}`);
});

t('D5 演示文件超 2MB → 400 并说明上限', async () => {
  const big = path.join(PROJ_A.dir, 'big-demo.html');
  fs.writeFileSync(big, `<!-- ${'x'.repeat(2 * 1024 * 1024)} -->`);
  try {
    const r = await request('GET', demoUrl(PROJ_A.item.id, 'big-demo.html', PROJ_A.project));
    assert.equal(r.status, 400, `超限应 400，得到 ${r.status}`);
    assert.match(r.text, /2MB/, '提示应说明大小上限');
  } finally {
    fs.unlinkSync(big);
  }
});

t('D6 站点根静态路径行为不变（/ui-demo.html 仍 404 not found）', async () => {
  const r = await request('GET', `${base}/ui-demo.html`);
  assert.equal(r.status, 404);
  assert.equal(r.text, 'not found', 'serveFile 纯文本 404 契约保持');
});

t('D7 回归：文档 JSON / fs 列目录 / 图片 raw 均不受影响', async () => {
  const doc = await request('GET', `${base}/api/item/${Q(PROJ_A.item.id)}/doc/README.md?project=${Q(PROJ_A.project)}`);
  assert.equal(doc.status, 200);
  assert.match(doc.headers['content-type'] || '', /^application\/json/);
  assert.match(doc.json.content, /Demo\]\(\.\/ui-demo\.html\)/, 'README 源与相对链接写法不变');
  const PNG_1PX = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  fs.writeFileSync(path.join(PROJ_A.dir, 'dot.png'), PNG_1PX);
  const relPng = path.join('docs/agent-team-board/requirements', PROJ_A.item.id, 'dot.png').split(path.sep).join('/');
  const raw = await request('GET', `${base}/api/fs/raw?path=${Q(relPng)}&project=${Q(PROJ_A.project)}`);
  assert.equal(raw.status, 200, `raw 图片应 200，得到 ${raw.status}：${raw.text.slice(0, 160)}`);
  assert.equal(raw.headers['content-type'], 'image/png');
  const ls = await request('GET', `${base}/api/fs?path=${Q('docs/agent-team-board')}&project=${Q(PROJ_A.project)}`);
  assert.equal(ls.status, 200);
  assert.ok(ls.json.entries.some((e) => e.name === 'requirements'), 'fs 列目录应正常');
});

// ---------- BUG-20260909-005：服务过旧时演示链接的兜底体验 ----------

// D8 浏览器直接导航形态（GET + Accept: text/html）未命中 API → 人读过旧指引页；
// fetch 形态（无 Accept）→ 「未知接口」JSON 契约不变。
const NAV_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
t('D8 未命中 API：浏览器导航得人读过旧指引页，fetch 形态仍是 JSON 契约', async () => {
  const nav = await request('GET', `${base}/api/brand-new-endpoint`, null, { Accept: NAV_ACCEPT });
  assert.equal(nav.status, 404, `导航形态应 404，得到 ${nav.status}`);
  assert.match(nav.headers['content-type'] || '', /^text\/html/, '导航形态应返回 HTML 人读页');
  assert.match(nav.text, /版本过旧/, '指引页应说明可能是服务版本过旧');
  assert.match(nav.text, /atb serve/, '指引页应给出 atb serve 自愈指引');
  assert.match(nav.text, /\/api\/brand-new-endpoint/, '指引页应包含未命中的路径，便于定位');
  assert.match(nav.headers['content-security-policy'] || '', /default-src\s+'none'/, '指引页 CSP 应收敛');
  assert.equal(nav.headers['x-content-type-options'], 'nosniff');
  assert.equal(nav.headers['cache-control'], 'no-store');
  const apiLike = await request('GET', `${base}/api/brand-new-endpoint`); // node http 缺省不带 Accept
  assert.equal(apiLike.status, 404);
  assert.match(apiLike.headers['content-type'] || '', /^application\/json/, 'fetch 形态应保持 JSON 契约');
  assert.match(String(apiLike.json.error || ''), /^未知接口：/, 'fetch 形态错误文案契约不变');
});

// ---------- 前端接线契约 ----------

t('U1 结构契约：loadDoc 渲染后调用 linkupDocDemo 接管 #docView 内相对链接', () => {
  const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  assert.match(js, /function linkupDocDemo\(/, '应定义 linkupDocDemo');
  assert.match(
    js,
    /view\.innerHTML = renderMd\(res\.content\);\s*\n\s*linkupDocDemo\(view, state\.drawer\.id\)/,
    'loadDoc 渲染 markdown 后应调用 linkupDocDemo（携带当前条目号）',
  );
});

t('U2 结构契约：仅接管单文件名 .html/.htm，改写到条目演示端点并携带当前 project', () => {
  const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  const fn = js.match(/^function linkupDocDemo[\s\S]*?^\}/m);
  assert.ok(fn, '应能提取 linkupDocDemo 函数源码');
  assert.match(fn[0], /a\.href = apiUrl\(`\/api\/item\/\$\{encodeURIComponent\(itemId\)\}\/demo\//, '应改写到 /api/item/<id>/demo/ 并经 apiUrl 携带 project');
  assert.match(fn[0], /\(html\|htm\)/i, '后缀白名单应含 html 与 htm');
  assert.match(fn[0], /startsWith\('#'\)/, '锚点链接应跳过');
  assert.match(fn[0], /\[a-z\]\[a-z0-9\+\.-\]\*:/i, '协议绝对链接（http(s) 等）应跳过');
  // ./ 前缀剥离与逐形态取舍由 U4 在 vm 沙箱行为级断言，此处不做脆弱的源码字符匹配。
});

t('U3 结构契约：接管链接新标签打开且带 noopener', () => {
  {
    const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
    const fn = js.match(/^function linkupDocDemo[\s\S]*?^\}/m);
    assert.ok(fn, '应能提取 linkupDocDemo 函数源码');
    assert.match(fn[0], /a\.target = '_blank'/, '应设 target=_blank');
    assert.match(fn[0], /a\.rel = 'noopener noreferrer'/, '应设 rel=noopener noreferrer（演示页拿不到看板页引用）');
  }
});

t('U4 vm 行为：linkupDocDemo 对各形态链接逐条断言改写/跳过', () => {
  const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  const fn = js.match(/^function linkupDocDemo[\s\S]*?^\}/m);
  assert.ok(fn, '应能提取 linkupDocDemo 函数源码');
  const mkA = (href) => {
    const a = {
      href, target: '', rel: '', title: '', listeners: {},
      getAttribute: (k) => (k === 'href' ? href : null),
      addEventListener: (type, handler) => { a.listeners[type] = handler; },
    };
    return a;
  };
  const links = {
    dot: mkA('./ui-demo.html'),
    bare: mkA('ui-demo.html'),
    htm: mkA('layout-demo.htm'),
    http: mkA('https://example.com/page.html'),
    anchor: mkA('#section'),
    subdir: mkA('sub/page.html'),
    parent: mkA('../other.html'),
    rootAbs: mkA('/abs.html'),
    empty: mkA(''),
    md: mkA('./notes.md'),
    query: mkA('ui-demo.html?x=1'),
  };
  const view = { querySelectorAll: (sel) => (sel === 'a[href]' ? Object.values(links) : []) };
  const sandbox = {
    apiUrl: (p) => `http://board.test${p}${p.includes('?') ? '&' : '?'}project=/tmp/p1`,
    view, itemId: 'REQ-20260908-026',
  };
  vm.createContext(sandbox);
  sandbox.__view = view;
  vm.runInContext(`${fn[0]}\nlinkupDocDemo(__view, itemId)`, sandbox);
  const rewritten = (a) => decodeURIComponent(a.href);
  assert.match(rewritten(links.dot), /\/api\/item\/REQ-20260908-026\/demo\/ui-demo\.html\?project=/, './ui-demo.html 应改写到条目演示端点并带 project');
  assert.match(rewritten(links.bare), /\/demo\/ui-demo\.html/, '裸文件名同样接管');
  assert.match(rewritten(links.htm), /\/demo\/layout-demo\.htm\?/, '.htm 后缀同样接管');
  for (const [key, a] of Object.entries(links)) {
    if (['dot', 'bare', 'htm'].includes(key)) continue;
    assert.equal(a.href, a.getAttribute('href'), `${key}（${a.getAttribute('href')}）应保持原值不接管`);
    assert.equal(a.target, '', `${key} 不应设 target`);
  }
  for (const a of [links.dot, links.bare, links.htm]) {
    assert.equal(a.target, '_blank', '接管链接应新标签打开');
    assert.match(a.rel, /noopener/, '接管链接应带 noopener');
    assert.equal(typeof a.listeners.click, 'function', '接管链接应挂 click 预检监听（BUG-20260909-005）');
  }
  for (const [key, a] of Object.entries(links)) {
    if (['dot', 'bare', 'htm'].includes(key)) continue;
    assert.equal(a.listeners.click, undefined, `${key} 不应挂演示预检监听`);
  }
});

// BUG-20260909-005 U5：演示链接点击预检 guardDemoLinkClick——服务过旧关占位标签给自愈指引，
// 正常则以编程式 noopener 导航，网络异常兜底导航，弹窗拦截/非左键不拦截默认行为。
t('U5 vm 行为：演示链接点击预检——过旧给指引、正常 noopener 导航、异常兜底', async () => {
  const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  const linkFn = js.match(/^function linkupDocDemo[\s\S]*?^\}/m);
  const guardFn = js.match(/^function guardDemoLinkClick[\s\S]*?^\}/m);
  assert.ok(linkFn, '应能提取 linkupDocDemo 函数源码');
  assert.ok(guardFn, '应定义 guardDemoLinkClick（点击预检）');
  assert.match(linkFn[0], /guardDemoLinkClick/, 'linkupDocDemo 应为接管链接挂预检回调');
  const mkA5 = (href) => {
    const a = {
      href, target: '', rel: '', title: '', listeners: {},
      getAttribute: (k) => (k === 'href' ? href : null),
      addEventListener: (type, handler) => { a.listeners[type] = handler; },
    };
    return a;
  };
  const dot = mkA5('./ui-demo.html');
  const view = { querySelectorAll: (sel) => (sel === 'a[href]' ? [dot] : []) };
  const mkTab = () => ({ closed: false, opener: { board: true }, location: { href: '' }, close() { this.closed = true; } });
  const mkEv = (over) => ({
    button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    prevented: false, preventDefault() { this.prevented = true; }, ...over,
  });
  let tab = mkTab();
  let openImpl = () => tab;
  let fetchImpl = null;
  const toasts = [];
  const sandbox = {
    apiUrl: (p) => `http://board.test${p}${p.includes('?') ? '&' : '?'}project=/tmp/p1`,
    window: { open: (...a) => openImpl(...a) },
    fetch: (...a) => fetchImpl(...a),
    toast: (m, e) => toasts.push([m, e]),
    view, itemId: 'REQ-20260908-026',
  };
  vm.createContext(sandbox);
  sandbox.__view = view;
  vm.runInContext(`${guardFn[0]}\n${linkFn[0]}\nlinkupDocDemo(__view, itemId)`, sandbox);
  assert.equal(typeof dot.listeners.click, 'function', '接管链接应挂 click 监听');

  // U5b 过旧：404 JSON「未知接口」→ 关占位标签 + 错误 toast 自愈指引，不导航
  fetchImpl = async () => ({
    ok: false, status: 404,
    headers: { get: () => 'application/json; charset=utf-8' },
    json: async () => ({ error: '未知接口：GET /api/item/REQ-20260908-026/demo/ui-demo.html' }),
  });
  let ev = mkEv();
  await dot.listeners.click(ev);
  assert.equal(ev.prevented, true, '应拦截默认导航');
  assert.ok(tab.closed, '过旧时应关闭占位标签，不给用户留裸 JSON 新标签');
  assert.equal(tab.location.href, '', '过旧时不应导航占位标签');
  assert.equal(tab.opener.board, true, '过旧时无需切断 opener（标签已关）');
  assert.equal(toasts.length, 1, '应弹一条 toast');
  assert.match(String(toasts[0][0]), /未知接口/, 'toast 应保留原始错误语义');
  assert.match(String(toasts[0][0]), /版本过旧/, 'toast 应说明服务版本过旧');
  assert.match(String(toasts[0][0]), /atb serve/, 'toast 应给出 atb serve 自愈指引');
  assert.equal(toasts[0][1], true, 'toast 应为错误样式');

  // U5c 正常：2xx text/html → 编程式 noopener（opener=null）后真实导航
  tab = mkTab(); openImpl = () => tab; toasts.length = 0;
  fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => 'text/html; charset=utf-8' } });
  ev = mkEv();
  await dot.listeners.click(ev);
  assert.equal(ev.prevented, true, '正常路径同样由预检导航（拦截默认）');
  assert.equal(tab.closed, false, '正常时不应关标签');
  assert.equal(tab.opener, null, '导航前应切断 opener（编程式 noopener，等效 rel=noopener）');
  assert.match(tab.location.href, /\/api\/item\/REQ-20260908-026\/demo\/ui-demo\.html\?project=/, '应导航到演示端点');
  assert.equal(toasts.length, 0, '正常时不弹 toast');

  // U5d 兜底：预检网络异常 → 仍导航占位标签（与旧版直开等价）
  tab = mkTab(); openImpl = () => tab; toasts.length = 0;
  fetchImpl = async () => { throw new TypeError('fetch failed'); };
  ev = mkEv();
  await dot.listeners.click(ev);
  assert.equal(tab.closed, false, '异常兜底不应关标签');
  assert.match(tab.location.href, /\/demo\/ui-demo\.html/, '异常兜底应导航到演示 URL（人读提示页/演示页由服务端决定）');

  // U5b 变体：JSON 但非「未知接口」（如 403 跨站拒绝）→ 按普通结果导航（与旧版一致，不误报过旧）
  tab = mkTab(); openImpl = () => tab; toasts.length = 0;
  fetchImpl = async () => ({
    ok: false, status: 403,
    headers: { get: () => 'application/json; charset=utf-8' },
    json: async () => ({ error: '已拒绝：跨站 Origin' }),
  });
  ev = mkEv();
  await dot.listeners.click(ev);
  assert.equal(tab.closed, false, '非过旧 JSON 错误不关标签');
  assert.match(tab.location.href, /\/demo\/ui-demo\.html/, '非过旧 JSON 错误按原行为导航展示');
  assert.equal(toasts.length, 0, '非过旧错误不弹过旧指引');

  // U5e 弹窗拦截：window.open 返回 null → 不拦截默认导航
  openImpl = () => null; toasts.length = 0;
  ev = mkEv();
  await dot.listeners.click(ev);
  assert.equal(ev.prevented, false, '占位标签拿不到时应交还浏览器默认行为');

  // U5f 非普通左键（中键/修饰键）→ 不拦截
  openImpl = () => { throw new Error('中键不应触发 window.open'); };
  for (const over of [{ button: 1 }, { metaKey: true }, { ctrlKey: true }]) {
    ev = mkEv(over);
    await dot.listeners.click(ev);
    assert.equal(ev.prevented, false, `${JSON.stringify(over)} 应保留浏览器原生行为`);
  }
});

// ---------- 执行 ----------
let failed = 0;
try {
  for (const port of [28936, 28996, 29036]) {
    try {
      const r = await tryStartServer(port);
      serverProc = r.proc;
      base = r.base;
      break;
    } catch (e) {
      if (port === 29036) throw e;
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
  for (const p of [PROJ_A, PROJ_B]) {
    try { fs.rmSync(p.tmp, { recursive: true, force: true }); } catch {}
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
