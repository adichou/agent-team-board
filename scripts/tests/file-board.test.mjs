#!/usr/bin/env node
// REQ-20260830-002 File Board 集成测试 —— 真实起 server（随机端口 + 临时项目）
// 用法：node scripts/tests/file-board.test.mjs
// 覆盖 test-cases.md 的 F1–F6、F12；F7 经 REQ-20260906-007 改写为横幅结构契约（B3/B4）。
// REQ-20260906-007：目录树改横幅呈现，新增 B1/B2/B5/B6/B7；旧树专属 F10/F11/F13 随树退役删除。
// REQ-20260906-021：源码视图自动换行（跨文件保持），新增 W1–W4。

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as core from '../lib/core.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------- 测试环境 ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atb-fileboard-'));
const project = fs.realpathSync(tmp);
fs.mkdirSync(project, { recursive: true });
core.initData(project);
core.createItem(core.dataDirFrom(project), { type: 'requirement', title: '示例需求', by: 'test' });
// 干扰项与特殊文件
fs.mkdirSync(path.join(project, 'node_modules', 'pkg'), { recursive: true });
fs.writeFileSync(path.join(project, 'node_modules', 'pkg', 'x.js'), 'module.exports=1');
fs.writeFileSync(path.join(project, 'script.sh'), 'echo hello\n');
fs.writeFileSync(path.join(project, 'data.json'), JSON.stringify({ a: 1 }, null, 2));
fs.writeFileSync(path.join(project, 'big.bin'), 'x'.repeat(1024 * 1024 + 1));
fs.writeFileSync(path.join(project, 'blob.dat'), Buffer.from([0x00, 0x01, 0x02, 0x00]));
// REQ-20260906-010：图片预览 fixtures（1x1 PNG / svg / 超 8MB 假 png）
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
fs.writeFileSync(path.join(project, 'dot.png'), PNG_1PX);
fs.writeFileSync(
  path.join(project, 'icon.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>',
);
fs.writeFileSync(path.join(project, 'huge.png'), Buffer.alloc(8 * 1024 * 1024 + 1, 0x61));

const registryFile = path.join(tmp, 'projects.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function request(method, url, body) {
  const __http = http;
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = __http.request(
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
const get = (url, expect = 200) => request('GET', url).then((r) => {
  assert.equal(r.status, expect, `GET ${url} → ${r.status}（期望 ${expect}）：${JSON.stringify(r.json)}`);
  return r.json;
});

// 二进制原始响应（REQ-20260906-010 /api/fs/raw）：保留字节与响应头
function requestRaw(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

let serverProc = null;
let base = '';

async function tryStartServer(port) {
  const proc = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'server.mjs')], {
    cwd: project,
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

t('F1 列项目根：目录在前、字段齐全、排除项隐藏', async () => {
  const d = await get(`${base}/api/fs?path=`);
  const names = d.entries.map((e) => e.name);
  assert.ok(names.includes('docs'), '应含 docs 目录');
  assert.ok(names.includes('script.sh') && names.includes('data.json'), '应含普通文件');
  assert.ok(!names.includes('node_modules'), '不应列出 node_modules');
  assert.ok(d.entries.every((e) => !e.name.startsWith('.')), '不应列出点开头条目');
  const firstDirIdx = d.entries.findIndex((e) => e.dir);
  const lastFileIdx = d.entries.map((e) => e.dir).lastIndexOf(false);
  assert.ok(firstDirIdx < lastFileIdx || !d.entries.some((e) => e.dir === false), '目录应排在文件前');
  const file = d.entries.find((e) => e.name === 'data.json');
  assert.ok(typeof file.size === 'number' && file.mtime, '文件应带 size/mtime');
});

t('F2 列数据目录 docs/agent-team-board', async () => {
  const d = await get(`${base}/api/fs?path=${Q('docs/agent-team-board')}`);
  const names = d.entries.map((e) => e.name);
  assert.ok(names.includes('requirements'), '应含 requirements');
  assert.ok(names.includes('config.json') && names.includes('README.md'), '应含 config.json / README.md');
});

t('F3 越界与排除路径一律 400', async () => {
  await get(`${base}/api/fs?path=${Q('../')}`, 400);
  await get(`${base}/api/fs?path=${Q('/etc')}`, 400);
  await get(`${base}/api/fs?path=${Q('docs/../..')}`, 400);
  await get(`${base}/api/fs?path=${Q('node_modules/pkg')}`, 400);
  await get(`${base}/api/fs/file?path=${Q('node_modules/pkg/x.js')}`, 400);
  await get(`${base}/api/fs/file?path=${Q('.git/config')}`, 400);
});

t('F4 读文本文件返回内容与扩展名', async () => {
  const md = await get(`${base}/api/fs/file?path=${Q('docs/agent-team-board/README.md')}`);
  assert.match(md.content, /Agent Team Board 数据目录/);
  assert.equal(md.ext, 'md');
  const sh = await get(`${base}/api/fs/file?path=${Q('script.sh')}`);
  assert.match(sh.content, /echo hello/);
  assert.equal(sh.ext, 'sh');
  const json = await get(`${base}/api/fs/file?path=${Q('data.json')}`);
  assert.equal(json.ext, 'json');
});

t('F5 超过 1MB 的文件返回明确提示', async () => {
  const r = await request('GET', `${base}/api/fs/file?path=${Q('big.bin')}`);
  assert.equal(r.status, 400, `期望 400，得到 ${r.status}`);
  assert.match(r.json.error || '', /1MB/, `提示应说明大小限制：${JSON.stringify(r.json)}`);
});

t('F6 二进制文件返回明确提示', async () => {
  const r = await request('GET', `${base}/api/fs/file?path=${Q('blob.dat')}`);
  assert.equal(r.status, 400, `期望 400，得到 ${r.status}`);
  assert.match(r.json.error || '', /二进制/, `提示应说明是二进制：${JSON.stringify(r.json)}`);
});

t('F7/B3/B4 横幅结构契约（REQ-20260906-007）：横幅容器 + 查看器，旧树/分隔条退役', () => {
  const web = path.join(pluginRoot, 'scripts', 'web');
  for (const f of ['highlight.min.js', 'highlight-github.min.css', 'highlight-github-dark.min.css']) {
    assert.ok(fs.existsSync(path.join(web, f)), `缺少 vendor 文件 ${f}`);
  }
  const html = fs.readFileSync(path.join(web, 'index.html'), 'utf8');
  assert.match(html, /highlight\.min\.js/, 'index.html 应引入 highlight.js');
  assert.match(html, /data-view="status"/, '应含看板视图 Tab');
  // REQ-20260909-013：「文件」入口暂态隐藏（数据与 /api/fs 能力保留；恢复步骤见 requirements/REQ-20260909-013/design.md）
  assert.doesNotMatch(html, /data-view="files"/, '「文件」Tab 随 REQ-20260909-013 暂态隐藏');
  assert.match(html, /id="fileBanner"/, '应含横幅容器 #fileBanner');
  assert.match(html, /id="fileCrumb"/, '应含面包屑 #fileCrumb');
  assert.match(html, /id="bannerStack"/, '应含层栈容器 #bannerStack');
  assert.match(html, /id="fileViewer"/, '应含文件查看器容器 #fileViewer');
  // 旧目录树与竖向分隔条退役：结构与依赖一并移除（vendor 文件保留在 web/ 目录但不加载）
  assert.doesNotMatch(html, /id="fileTree"/, '不应再有文件树容器 #fileTree');
  assert.doesNotMatch(html, /id="fileSplitter"/, '不应再有分隔条 #fileSplitter');
  assert.doesNotMatch(html, /wunderbaum/, '不应再加载 wunderbaum（脚本/样式）');
  assert.doesNotMatch(html, /\/splitter\.js/, '不应再加载 splitter.js');
  assert.ok(
    html.indexOf('/banner.js') !== -1 && html.indexOf('/banner.js') < html.indexOf('/app.js'),
    'banner.js 应在 app.js 之前加载（window.ATBBanner 就位）',
  );
  const js = fs.readFileSync(path.join(web, 'app.js'), 'utf8');
  assert.doesNotMatch(js, /mar10\.Wunderbaum/, 'app.js 不应再实例化 Wunderbaum');
  assert.doesNotMatch(js, /fileTree|fileSplitter|ATBSplitter/, 'app.js 不应再引用树/分隔条');
  assert.match(js, /highlightElement|hljs\.highlight/, 'app.js 应调用 hljs 高亮');
});

// ---------- REQ-20260906-007 横幅文件浏览（目录树 → 横幅条带） ----------

const B = createRequire(import.meta.url)(path.join(pluginRoot, 'scripts', 'web', 'banner.js'));

t('B1 层栈状态机：openLayer 追加/截断，truncateTo 回跳，均纯函数不改动原栈', () => {
  const root = B.openLayer([], '');
  assert.deepEqual(root, [''], '空栈进入根目录应得到仅含根层的栈');
  let layers = B.openLayer(root, 'docs');
  assert.deepEqual(layers, ['', 'docs'], '进入子目录应追加一层');
  layers = B.openLayer(layers, 'docs/agent-team-board');
  assert.deepEqual(layers, ['', 'docs', 'docs/agent-team-board'], '继续下钻继续追加');
  const snapshot = layers.slice();
  const truncated = B.openLayer(layers, 'docs');
  assert.deepEqual(truncated, ['', 'docs'], '重复打开已在栈中的目录应截断到该层（含）');
  assert.deepEqual(layers, snapshot, 'openLayer 不得改动原栈（纯函数）');
  assert.deepEqual(B.truncateTo(layers, 'docs'), ['', 'docs'], '面包屑回跳应截断到该层（含）');
  assert.deepEqual(B.truncateTo(layers, ''), [''], '回跳根应只剩根层');
  assert.deepEqual(B.truncateTo(layers, 'not/in/stack'), layers, '回跳未知路径应原样返回');
  assert.deepEqual(B.openLayer(layers, ''), [''], '进入根目录等同于截断到根层');
});

t('B2 面包屑派生：crumbOf 逐段产出，首段为根；DEFAULT_PATH 保持 docs/agent-team-board', () => {
  assert.equal(B.DEFAULT_PATH, 'docs/agent-team-board', '默认展开路径应与旧树行为一致');
  const layers = ['', 'docs', 'docs/agent-team-board'];
  const crumb = B.crumbOf(layers, '项目');
  assert.deepEqual(
    crumb,
    [
      { name: '项目', path: '' },
      { name: 'docs', path: 'docs' },
      { name: 'agent-team-board', path: 'docs/agent-team-board' },
    ],
    '面包屑应逐段派生，段名取路径末段，根段用注入的项目名',
  );
});

t('B5 接线契约：app.js 用 ATBBanner 状态机渲染，chip 事件委托分发，新层滚入视野', () => {
  const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  assert.match(js, /ATBBanner\.openLayer/, '进入目录应经状态机 openLayer');
  assert.match(js, /ATBBanner\.truncateTo/, '面包屑回跳应经状态机 truncateTo');
  assert.match(js, /ATBBanner\.crumbOf/, '面包屑渲染应经状态机 crumbOf 派生');
  assert.match(js, /ATBBanner\.DEFAULT_PATH/, '默认展开路径应取 ATBBanner.DEFAULT_PATH');
  assert.match(js, /\$\('#fileBanner'\)\.addEventListener\('click'/, 'chip 点击应经 #fileBanner 事件委托');
  assert.match(js, /scrollIntoView/, '新增层条带应自动滚入视野');
  assert.match(js, /async function openFile/, '文件打开逻辑 openFile 应保留');
});

t('B6 CSS 契约：纵向布局 + 条带横向滚动 + 限高堆栈 + 主题变量配色与 mask 图标', () => {
  const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
  const rule = (sel) => {
    const m = flat.match(new RegExp(`(?:^|[{}])\\s*${sel.replace(/[.*+?^${}()[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
    assert.ok(m, `缺少规则 ${sel}`);
    return m[1];
  };
  assert.match(rule('.file-view'), /flex-direction:\s*column/, '文件视图应为纵向布局（横幅上、内容下）');
  assert.match(rule('.banner-row'), /overflow-x:\s*auto/, '每层条带应可横向滚动');
  assert.match(rule('.banner-stack'), /overflow-y:\s*auto/, '层栈应可纵向滚动');
  assert.match(rule('.banner-stack'), /max-height/, '层栈应限高避免挤压内容区');
  const chip = rule('.fchip');
  assert.match(chip, /background:\s*var\(--/, 'chip 底色应取主题变量');
  assert.match(chip, /border[^;]*var\(--/, 'chip 边框应取主题变量');
  assert.match(flat, /\.fchip\.active\s*\{[^}]*var\(--primary\)/, '选中态应取主题色');
  assert.match(flat, /\.fchip-icon\s*\{[^}]*mask-image/, 'chip 图标应为 mask 矢量（随主题变色）');
  // 旧树样式退役
  assert.doesNotMatch(flat, /div\.wunderbaum/, '不应再保留 Wunderbaum 树覆盖样式');
  assert.doesNotMatch(flat, /\.file-tree/, '不应再保留 .file-tree 样式');
  assert.doesNotMatch(flat, /\.file-splitter/, '不应再保留 .file-splitter 样式');
});

t('F12 滚动条主题适配：双主题变量 + 标准/WebKit 双通道（BUG-20260903-003）', () => {
  const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');
  // 亮色 :root 定义滚动条滑块色变量（与 --muted 同色系）
  assert.match(css, /:root\s*{[^}]*--scrollbar-thumb:\s*rgba?\(/s, '亮色 :root 应定义 --scrollbar-thumb');
  assert.match(css, /:root\s*{[^}]*--scrollbar-thumb-hover:/s, '亮色 :root 应定义 --scrollbar-thumb-hover');
  // 暗色媒体查询内重定义 → 暗色下滑块不再亮白
  const dark = css.match(/@media \(prefers-color-scheme: dark\)\s*{([\s\S]*?\n})/);
  assert.ok(dark, '应存在暗色媒体查询');
  assert.match(dark[1], /--scrollbar-thumb:/, '暗色块应重定义 --scrollbar-thumb');
  // 标准属性通道：html 上设置并随继承统一覆盖文件树/内容区/看板列/抽屉等全部滚动容器
  assert.match(css, /html\s*{[^}]*scrollbar-color:\s*var\(--scrollbar-thumb\)/s, 'html 应设 scrollbar-color（继承到所有滚动容器）');
  // WebKit 兜底通道：全局伪元素规则取同一主题变量，轨道透明
  assert.match(css, /^::-webkit-scrollbar\s*{[^}]*}/m, '应有全局 ::-webkit-scrollbar 尺寸规则');
  assert.match(css, /::-webkit-scrollbar-thumb\s*{[^}]*background:\s*var\(--scrollbar-thumb\)/s, '滑块色应取主题变量');
  assert.match(css, /::-webkit-scrollbar-track\s*{[^}]*background:\s*transparent/s, '轨道应透明以透出面板底色');
});

// F13（树层级缩进压缩）随 REQ-20260906-007 目录树退役一并删除。

// ---------- REQ-20260906-010 md/图片渲染展示 + 复制路径与行号 ----------

t('R1 raw 端点返回图片原始字节、正确 MIME 与安全响应头', async () => {
  const r = await requestRaw(`${base}/api/fs/raw?path=${Q('dot.png')}`);
  assert.equal(r.status, 200, `dot.png 应 200，得到 ${r.status}`);
  assert.equal(r.headers['content-type'], 'image/png', 'Content-Type 应为 image/png');
  assert.ok(r.buf.equals(PNG_1PX), '响应字节应与源文件完全一致');
  assert.equal(r.headers['x-content-type-options'], 'nosniff', '应带 nosniff');
  assert.match(r.headers['content-security-policy'] || '', /default-src\s+'none'/, 'CSP 应禁一切外部加载');
});

t('R2 raw 仅放行图片后缀白名单并给出各自 MIME', async () => {
  const cases = [
    ['a.jpg', 'image/jpeg'], ['b.jpeg', 'image/jpeg'], ['c.gif', 'image/gif'],
    ['d.webp', 'image/webp'], ['icon.svg', 'image/svg+xml'], ['f.ico', 'image/x-icon'],
    ['g.bmp', 'image/bmp'], ['h.avif', 'image/avif'],
  ];
  for (const [name, mime] of cases) {
    if (name.includes('/')) continue;
    fs.writeFileSync(path.join(project, name), PNG_1PX); // 服务端只看后缀，字节不校验魔数
    const r = await requestRaw(`${base}/api/fs/raw?path=${Q(name)}`);
    assert.equal(r.status, 200, `${name} 应放行`);
    assert.equal(r.headers['content-type'], mime, `${name} MIME 应为 ${mime}，得到 ${r.headers['content-type']}`);
  }
  for (const name of ['script.sh', 'data.json']) {
    const r = await request('GET', `${base}/api/fs/raw?path=${Q(name)}`);
    assert.equal(r.status, 400, `${name} 非图片后缀应 400`);
    assert.match(r.json.error || '', /图片/, `提示应说明仅支持图片：${JSON.stringify(r.json)}`);
  }
});

t('R3 raw 安全边界：越界/不存在/目录/超限一律 400', async () => {
  await get(`${base}/api/fs/raw?path=${Q('../')}`, 400);
  await get(`${base}/api/fs/raw?path=${Q('/etc/passwd')}`, 400);
  await get(`${base}/api/fs/raw?path=${Q('node_modules/pkg/x.js')}`, 400);
  await get(`${base}/api/fs/raw?path=${Q('not-exist.png')}`, 400);
  await get(`${base}/api/fs/raw?path=${Q('docs')}`, 400);
  await get(`${base}/api/fs/raw?path=`, 400);
  const r = await request('GET', `${base}/api/fs/raw?path=${Q('huge.png')}`);
  assert.equal(r.status, 400, '超 8MB 图片应 400');
  assert.match(r.json.error || '', /8MB/, `提示应说明大小上限：${JSON.stringify(r.json)}`);
});

t('R4 结构契约：openFile 分流图片（raw）与 md（renderMd 默认渲染可切源码）', () => {
  const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  assert.match(js, /const IMAGE_EXT = new Set\(/, '应定义 IMAGE_EXT 图片后缀集合');
  assert.match(js, /\/api\/fs\/raw/, '图片应经 /api/fs/raw 取原始字节');
  assert.match(js, /file-image/, '应渲染 .file-image 图片元素');
  assert.match(js, /renderMd/, 'md 渲染应复用抽屉的 renderMd');
  assert.match(js, /mdSource/, '应记录 md 源码/渲染态（mdSource）');
  assert.match(js, /源码/, '工具条应提供源码/渲染切换入口');
});

t('R5 结构契约：行号点击复制 路径:行号，工具条可复制路径（含降级）', () => {
  const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  assert.match(js, /code-lns/, '源码视图应有行号槽 .code-lns');
  assert.match(js, /data-line/, '行号应带 data-line');
  assert.match(js, /function bindFileViewerOnce/, '查看器应有一次性委托绑定函数 bindFileViewerOnce');
  assert.match(js, /viewer\.addEventListener\('click'/, '行号/工具条点击应经 #fileViewer 事件委托（绑定一次）');
  assert.match(js, /bindFileViewerOnce\(\);/, 'initFileBoard 应调用 bindFileViewerOnce');
  assert.match(js, /function fileLineRef/, '应有 路径:行号 组装函数 fileLineRef');
  assert.match(js, /function copyPlain/, '应有通用剪贴板复制 copyPlain');
  assert.match(js, /execCommand\('copy'\)/, 'copyPlain 应保留 execCommand 降级');
  assert.match(js, /复制路径/, '工具条应有「复制路径」按钮');
});

t('R6 回归：文本文件仍走 /api/fs/file + hljs 高亮，契约不变', async () => {
  const sh = await get(`${base}/api/fs/file?path=${Q('script.sh')}`);
  assert.equal(sh.ext, 'sh');
  assert.match(sh.content, /echo hello/);
  const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  assert.match(js, /highlightElement/, 'hljs 高亮调用应保留');
});

t('R7 CSS 契约：查看器工具条/行号槽/图片样式齐备且取主题变量', () => {
  const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
  const rule = (sel) => {
    const m = flat.match(new RegExp(`(?:^|[{}])\\s*${sel.replace(/[.*+?^${}()[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
    assert.ok(m, `缺少规则 ${sel}`);
    return m[1];
  };
  assert.match(rule('.file-viewer-bar'), /display:\s*flex/, '工具条应为横向布局');
  const ln = rule('.code-lns .ln');
  assert.match(ln, /cursor:\s*pointer/, '行号应可点击');
  assert.match(ln, /color:\s*var\(--/, '行号色应取主题变量');
  assert.match(rule('.code-lns'), /line-height/, '行号槽应显式行高（与代码对齐）');
  const img = rule('.file-image');
  assert.match(img, /max-width:\s*100%/, '图片不应超出查看器宽度');
  assert.match(img, /display:\s*block/, '图片应块级展示');
});

t('R8 index.html 占位文案提及图片预览与行号复制（可发现性）', () => {
  const html = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'index.html'), 'utf8');
  const viewer = html.match(/id="fileViewer"[^<]*<p[^>]*>([^<]*)<\/p>/);
  assert.ok(viewer, '应保留 #fileViewer 占位提示');
  assert.match(viewer[1], /图片/, '提示应提及图片');
  assert.match(viewer[1], /行号/, '提示应提及行号复制');
});

// ---------- REQ-20260906-021 源码视图自动换行（跨文件保持） ----------

t('W1 结构契约：banner 状态含 wrap 字段，源码态工具条渲染换行开关，渲染态/图片不渲染', () => {
  const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  // 状态字段：默认不换行（与现状一致），挂在 banner 状态上随文件切换保持
  assert.match(js, /function newBannerState\(\)\s*\{[\s\S]*?wrap:\s*false/, 'newBannerState 应包含 wrap: false 字段');
  // 按钮：data-wrap-toggle + aria-pressed，文案显示目标态（与 md 切换按钮同一惯例）
  assert.match(js, /data-wrap-toggle/, '工具条应有 data-wrap-toggle 换行开关按钮');
  assert.match(js, /aria-pressed/, '换行开关应带 aria-pressed 状态');
  assert.match(js, /自动换行/, '按钮文案应含「自动换行」');
  assert.match(js, /不换行/, '开启态按钮文案应显示目标态「不换行」');
  // viewerBarHtml 的 wrap 参数经解构传入（未传即不渲染按钮 → 渲染态 md / 图片分支天然隐藏）
  assert.match(js, /function viewerBarHtml\(key,\s*\{\s*isMd,\s*mdSource,\s*wrap\s*\}\)/, 'viewerBarHtml 应解构 wrap 参数');
});

t('W2 结构契约：wrap 贯穿 openFile→buildCodeView，委托翻转后重开当前文件实现跨文件保持', () => {
  const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  // buildCodeView 接收 wrap 并挂 class
  assert.match(js, /function buildCodeView\(key,\s*content,\s*ext,\s*wrap\)/, 'buildCodeView 应接收 wrap 参数');
  assert.match(js, /classList\.(?:add|toggle)\('wrap'/, '应根据 wrap 给 .file-code 容器挂 wrap class');
  // openFile 源码视图调用点（非 md 与 md 源码态共用同一 fall-through）传 wrap；渲染态调用不传（按钮隐藏）
  assert.match(js, /viewerBarHtml\(key, \{ isMd, mdSource: source, wrap: state\.banner\.wrap \}\)/, '源码视图调用应传 wrap: state.banner.wrap');
  assert.match(js, /viewerBarHtml\(key, \{ isMd, mdSource: source \}\)/, '渲染态 md 调用不传 wrap（换行按钮隐藏）');
  assert.match(js, /buildCodeView\(key,\s*f\.content,\s*f\.ext,\s*state\.banner\.wrap\)/, 'buildCodeView 调用应传入 state.banner.wrap');
  // 委托切换：翻转 state.banner.wrap 后按 activeFile 重开（同 md 切换模式）
  assert.match(js, /closest\('\[data-wrap-toggle\]'\)/, '事件委托应处理 data-wrap-toggle');
  assert.match(js, /state\.banner\.wrap\s*=\s*!state\.banner\.wrap/, '切换应翻转 state.banner.wrap（跨文件保持的关键）');
});

t('W3 CSS 契约：wrap 态软换行 + 行号槽隐藏 + 按钮选中态取主题色', () => {
  const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
  const rule = (sel) => {
    const m = flat.match(new RegExp(`(?:^|[{}])\\s*${sel.replace(/[.*+?^${}()[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
    assert.ok(m, `缺少规则 ${sel}`);
    return m[1];
  };
  const pre = rule('.file-code.wrap pre');
  assert.match(pre, /white-space:\s*pre-wrap/, 'wrap 态 pre 应软换行');
  assert.match(pre, /overflow-wrap:\s*anywhere/, '超长无空格串应可断行（overflow-wrap: anywhere）');
  assert.match(rule('.file-code.wrap .code-lns'), /display:\s*none/, 'wrap 态行号槽应隐藏（软换行下无法保持 1:1 对齐）');
  const active = rule('.file-viewer-acts .btn[aria-pressed="true"]');
  assert.match(active, /--primary/, '换行开关选中态应取主题色');
});

t('W4 回归：默认不换行路径不变（文本契约 / 高亮 / 行号复制契约保留）', async () => {
  const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  assert.match(js, /highlightElement/, 'hljs 高亮调用应保留');
  assert.match(js, /code-lns/, '行号槽 .code-lns 应保留（默认视图）');
  assert.match(js, /data-line/, '行号 data-line 复制契约应保留');
  const sh = await get(`${base}/api/fs/file?path=${Q('script.sh')}`);
  assert.equal(sh.ext, 'sh');
  assert.match(sh.content, /echo hello/, '/api/fs/file 文本契约不回归');
});

// ---------- BUG-20260907-003 回归：buildCodeView 必须返回容器元素而非布尔入参 ----------
// 行为级回归：提取 buildCodeView 源码在 DOM stub 沙箱内真实执行，
// 断言返回 .file-code 容器（可直接 appendChild），杜绝再出现 `return wrap;` 类笔误。

t('G1 回归（BUG-20260907-003）：buildCodeView 返回 .file-code 容器元素（非布尔 wrap），viewer.appendChild 不再抛 TypeError', () => {
  const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  // 结构守卫：函数体不允许出现裸 `return wrap;`（布尔入参）——历史缺陷形态
  assert.doesNotMatch(js, /\breturn wrap\s*;/, 'buildCodeView 不得返回布尔入参 wrap');
  const fn = js.match(/^function buildCodeView[\s\S]*?^\}/m);
  assert.ok(fn, '应能提取 buildCodeView 函数源码');
  // 最小 DOM stub：元素带 classList/append/appendChild，足够构造行号槽与 pre/code
  const makeEl = (isFragment = false) => {
    const set = new Set();
    return {
      className: '', textContent: '', title: '', type: '', children: [], isFragment,
      classList: { add: (c) => set.add(c), contains: (c) => set.has(c) },
      // 真实 DOM 语义：append(fragment) 会把 fragment 子节点展平移入（行号槽依赖该行为）
      appendChild(c) {
        if (c.isFragment) this.children.push(...c.children);
        else this.children.push(c);
      },
      append(...cs) { cs.forEach((c) => this.appendChild(c)); },
      setAttribute() {},
    };
  };
  const sandbox = {
    document: { createElement: () => makeEl(false), createDocumentFragment: () => makeEl(true) },
    window: {},
    HL_LANG: { js: 'javascript' },
    fileLineRef: (p, n) => `${p}:${n}`,
  };
  vm.createContext(sandbox);
  sandbox.__src = 'let a = 1\nlet b = 2';
  const ret = vm.runInContext(`${fn[0]}\nbuildCodeView('a.js', __src, 'js', false)`, sandbox);
  // 返回值必须是元素容器：布尔/undefined 会让真实浏览器 appendChild 抛 TypeError（本 Bug 现象）
  assert.equal(typeof ret, 'object', `返回值应为对象元素，实际 ${typeof ret}`);
  assert.ok(ret, '返回值不应为空');
  assert.equal(ret.className, 'file-code', '容器应为 .file-code');
  assert.equal(ret.classList.contains('wrap'), false, 'wrap=false 不挂 wrap class');
  const [lns, pre] = ret.children;
  assert.equal(lns.children.length, 2, '行号槽按钮应与内容行数 1:1');
  assert.equal(lns.children[0].textContent, '1', '行号从 1 开始');
  assert.equal(pre.children[0].textContent, sandbox.__src, 'code 应承载原始内容');
  // wrap=true：容器挂 wrap class（软换行 CSS 契约入口）
  const ret2 = vm.runInContext(`buildCodeView('a.js', __src, 'js', true)`, sandbox);
  assert.equal(ret2.className, 'file-code', 'wrap 态容器仍应为 .file-code 元素');
  assert.equal(ret2.classList.contains('wrap'), true, 'wrap=true 应挂 wrap class');
});

// ---------- BUG-20260907-011 横幅会话级缓存：模块切回时对当前层栈后台重拉 ----------

t('S1 结构契约（BUG-20260907-011）：切回文件模块后台重拉层栈，旧幂等直返退役', () => {
  const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  assert.match(js, /async function refreshBannerLayers/, '应定义后台重拉函数 refreshBannerLayers');
  // 旧的「初始化过直接 return」正是本 Bug 根因形态，不允许再出现
  assert.doesNotMatch(js, /if \(state\.banner\.initialized\) return;/, 'initFileBoard 不得再幂等直返（会话级缓存根因）');
  assert.match(
    js,
    /if \(state\.banner\.initialized\) \{\s*\n\s*refreshBannerLayers\(\)/,
    '幂等短路应改为调用 refreshBannerLayers 后 return（模块切回重拉）',
  );
  assert.match(js, /state\.banner\.refreshing/, '应有单飞标记 state.banner.refreshing 防并发重复拉取');
  assert.match(js, /function newBannerState\(\)\s*\{[\s\S]*?refreshing:\s*false/, 'newBannerState 应含 refreshing: false 字段');
});

t('S2 行为（BUG-20260907-011）：refreshBannerLayers 逐层重拉更新缓存、单飞、单层失败容错', async () => {
  const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  const fn = js.match(/^async function refreshBannerLayers[\s\S]*?^\}/m);
  assert.ok(fn, '应能提取 refreshBannerLayers 函数源码');
  const mkSandbox = (fetchImpl) => {
    const calls = [];
    const renders = [];
    const sandbox = {
      state: {
        banner: {
          layers: ['', 'docs'],
          entriesByPath: {
            '': [{ name: 'old.txt', dir: false }],
            docs: [{ name: 'stale.txt', dir: false }],
          },
          refreshing: false,
        },
      },
      fetchDirEntries: async (p) => { calls.push(p); return fetchImpl(p); },
      renderBanner: () => renders.push(Date.now()),
    };
    vm.createContext(sandbox);
    sandbox.__calls = calls;
    sandbox.__renders = renders;
    return sandbox;
  };
  // 基本路径：两层各重拉一次，外部新增文件 tiny.png 进入缓存，渲染一次
  const ok = mkSandbox(async (p) => (p === '' ? [{ name: 'tiny.png', dir: false }, { name: 'docs', dir: true }] : [{ name: 'fresh.md', dir: false }]));
  await vm.runInContext(`${fn[0]}\nrefreshBannerLayers()`, ok);
  assert.deepEqual(ok.__calls.sort(), ['', 'docs'].sort(), '应对层栈每层各拉取一次');
  assert.ok(ok.state.banner.entriesByPath[''].some((e) => e.name === 'tiny.png'), '根层缓存应含外部新增文件 tiny.png');
  assert.ok(ok.state.banner.entriesByPath.docs.some((e) => e.name === 'fresh.md'), '深层缓存应同步更新');
  assert.equal(ok.__renders.length, 1, '拉取完成后应渲染一次');
  assert.equal(ok.state.banner.refreshing, false, '完成后单飞标记应复位');
  // 单飞：in-flight 期间再次调用不重复拉取
  const fly = mkSandbox(async () => { await new Promise((r) => setTimeout(r, 30)); return []; });
  const p1 = vm.runInContext(`${fn[0]}\nrefreshBannerLayers()`, fly);
  await vm.runInContext(`refreshBannerLayers()`, fly); // refreshing=true 期间并发的调用
  await p1;
  assert.equal(fly.__calls.length, 2, '并发的第二次调用不应产生额外拉取（仅首轮两层）');
  // 容错：单层失败保留旧缓存、其余层照常更新、不抛错且标记复位
  const bad = mkSandbox(async (p) => { if (p === 'docs') throw new Error('boom'); return [{ name: 'tiny.png', dir: false }]; });
  await vm.runInContext(`${fn[0]}\nrefreshBannerLayers()`, bad); // 不应 reject
  assert.ok(bad.state.banner.entriesByPath[''].some((e) => e.name === 'tiny.png'), '成功层应更新');
  assert.ok(bad.state.banner.entriesByPath.docs.some((e) => e.name === 'stale.txt'), '失败层应保留旧缓存');
  assert.equal(bad.state.banner.refreshing, false, '失败后单飞标记也应复位');
});

t('S3 回归（BUG-20260907-011）：首次初始化契约保留，幂等短路不再吞掉后续默认展开', () => {
  const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
  assert.match(js, /await openDirLayer\(''\)/, '首次进入仍应加载根层 openLayer(\'\')');
  assert.match(js, /ATBBanner\.DEFAULT_PATH\.split\('\/'\)/, '默认路径逐层展开逻辑应保留');
});

// ---------- 执行 ----------
let failed = 0;
try {
  for (const port of [28336, 28536, 28736]) {
    try {
      const r = await tryStartServer(port);
      serverProc = r.proc;
      base = r.base;
      break;
    } catch (e) {
      if (port === 28736) throw e;
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
