#!/usr/bin/env node
// Status Board 本地服务 —— 零依赖 Node http，默认端口 8888。
// 单服务多项目：所有数据 API 支持 ?project=<项目根绝对路径>，
// 未传时用默认项目（注册表第一项，首启以启动目录播种）。
// 人工专属状态（accepted / planned / done / 驳回）通过本服务的 API 由人在网页上操作；
// Agent 侧的 Bash 调用会被 hooks/state-guard.mjs 拦截。

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as core from './lib/core.mjs';
import * as batch from './lib/batch.mjs';
import * as gitFlow from './lib/git-flow.mjs';
import * as dispatchStore from './lib/dispatch-store.mjs';
import * as oncall from './lib/oncall-store.mjs';
import * as marketing from './lib/marketing-store.mjs';
import * as releaseStore from './lib/release-store.mjs';
import * as buildStore from './lib/build-store.mjs';
import * as buildGit from './lib/build-git.mjs';
import { runGitPipeline, realExec as realGitExec } from './lib/release-git.mjs';
import { runApplePipeline, createRealAdapter as createRealAppleAdapter } from './lib/release-apple.mjs';
import { runElectronPipeline, readElectronProject } from './lib/release-electron.mjs';
import * as growth from './lib/growth-store.mjs';
import * as reqdisc from './lib/req-disc-store.mjs';
import * as refine from './lib/refine-store.mjs';
// REQ-20260911-010：commit-store（提交规范内核/已提交索引）不再被服务端直接引用——
// /api/commit/item-status 已换源至 gitFlow.itemCommitStatusIndex（REQ-20260911-009 索引）。
import * as refineStates from './lib/refine-states.mjs';
import * as holdStates from './lib/hold-states.mjs';
import * as holdStore from './lib/hold-store.mjs';
import * as taskSettings from './lib/task-settings.mjs';
import * as dispatch from './lib/dispatch.mjs';
import { createScheduler, createHub, detectCli, probeCliVersion, resolveModelForItem } from './lib/scheduler.mjs';
import { startCodexExec, classifyFailure } from './lib/codex-adapter.mjs';
import { checkCodexEnvironment } from './lib/codex-preflight.mjs';
import {
  effectiveSelection, readModelConfigLayers, resolveInheritedModel,
  buildModelSnapshot, loadModelCatalog, normalizeModelSelection,
} from './lib/codex-model-config.mjs';

const HOST = process.env.ATB_HOST || '127.0.0.1';
const cwd = process.cwd();
const SERVER_STARTED_AT = new Date().toISOString(); // BUG-20260907-017：health 暴露，供 atb serve 判定服务新旧
const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'web');
const ATB_CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'atb.mjs'); // project-growth 提示词中的统一回执 CLI（绝对路径）
const REGISTRY_PATH = process.env.ATB_REGISTRY || path.join(os.homedir(), '.agent-team-board', 'projects.json');

// REQ-20260908-004：回退 CI Board 的端口持久化，端口恢复 ATB_PORT 环境变量 > 8888。
const DEFAULT_PORT = 8888;
const PORT = Number(process.env.ATB_PORT) || DEFAULT_PORT;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
};

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// ---------- BUG-20260907-005：/api/* 跨站防护（CSRF / DNS rebinding） ----------
// 本服务绑定回环地址、无鉴权，承担人工专属状态流转（accepted/done/驳回），必须确保
// 请求只能来自同源看板页面或本机非浏览器客户端（curl / Electron 探活等，不带 Origin/Referer）。
// 恶意网页的跨站 fetch/表单 POST（含 text/plain 简单请求，无预检）浏览器必带 Origin，
// 与本服务源不符即 403；Origin 缺席时看 Referer；DNS rebinding 场景 Host 头会变成攻击者
// 域名，非回环 Host 一律 403。非浏览器客户端两个头都不带，保持原有可用性。

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function hostNameOf(hostHeader) {
  const h = String(hostHeader || '').trim().toLowerCase();
  if (!h) return '';
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1); // IPv6 形如 [::1]:8888
  return h.split(':')[0];
}

// Host 白名单：默认部署只认回环主机名；显式 ATB_HOST 时按绑定值放宽（0.0.0.0 = 明示局域网共享）
function hostAllowed(hostname) {
  if (LOOPBACK_HOSTS.has(hostname)) return true;
  const bind = String(process.env.ATB_HOST || '').toLowerCase();
  return !!bind && (bind === hostname || bind === '0.0.0.0' || bind === '::');
}

// 同源或回环别名（localhost/[::1] 打开的看板页，端口与本服务一致）放行
function originAllowed(origin, hostHeader) {
  const o = String(origin).toLowerCase();
  if (o === `http://${String(hostHeader || '').toLowerCase()}`) return true;
  let u;
  try { u = new URL(o); } catch { return false; }
  const portOk = u.port === String(PORT) || (!u.port && PORT === 80);
  return LOOPBACK_HOSTS.has(u.hostname.toLowerCase()) && portOk;
}

// 返回 null 放行；否则返回拒绝原因（调用方回 403）
function apiGuardReason(req) {
  const hostHeader = String(req.headers.host || '');
  const hostname = hostNameOf(hostHeader);
  if (!hostAllowed(hostname)) return `可疑 Host 头：${hostHeader || '(缺失)'}`;
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin) {
    if (origin === 'null' || !originAllowed(origin, hostHeader)) return `跨站 Origin：${origin}`;
    return null;
  }
  const referer = req.headers.referer;
  if (typeof referer === 'string' && referer) {
    let o;
    try { o = new URL(referer).origin; } catch {
      return `非法 Referer：${referer.slice(0, 100)}`;
    }
    if (o && o !== 'null' && !originAllowed(o, hostHeader)) return `跨站 Referer：${o}`;
  }
  return null;
}

// REQ-20260910-027：开发人员设置已移除——git user.name 首次预填函数与
// /api/batch/current 无批次响应的预填字段随创建表单输入框一并删除。

// ---------- 项目注册表（已知项目列表，供前端切换器使用） ----------

function loadRegistry() {
  try {
    const j = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    if (j && Array.isArray(j.projects)) return j;
  } catch {}
  return { version: 1, projects: [] };
}

function saveRegistry(reg) {
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2) + '\n');
}

function realPath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

// REQ-20260910-005：项目管理接口共用的路径校验——绝对路径、目录存在，返回 realpath
function resolveProjectPath(raw) {
  if (typeof raw !== 'string' || !raw) {
    throw new core.AtbError('path 必须是项目根的绝对路径，得到：(空)');
  }
  if (!path.isAbsolute(raw)) {
    throw new core.AtbError(`path 必须是项目根的绝对路径，得到：${raw}`);
  }
  const abs = realPath(path.resolve(raw));
  let st = null;
  try {
    st = fs.statSync(abs);
  } catch {}
  if (!st || !st.isDirectory()) {
    throw new core.AtbError(`项目目录不存在：${raw}`);
  }
  return abs;
}

// REQ-20260910-010：目录存在性分类——只读检测已登记项目根路径。
// exists=目录存在；missing=根目录已不可用（ENOENT 整目录删除、ENOTDIR 上级不是目录、
// 断开的符号链接、路径处变成普通文件——注册根必为目录，非目录即“根目录不存在”）；
// error=其他 stat 失败（EACCES/EPERM/EIO 等，无法确定存在性）→ 前端显示「检测失败/待确认」，
// 不纳入批量移出候选（宁可漏移不可误移）。
function classifyProjectRoot(root) {
  let st = null;
  let err = null;
  try {
    st = fs.statSync(root);
  } catch (e) {
    err = e;
  }
  if (st) {
    if (st.isDirectory()) return { state: 'exists', reason: null };
    return { state: 'missing', reason: '路径不是目录（可能是普通文件），项目根目录不存在' };
  }
  if (err && err.code === 'ENOENT') {
    let brokenLink = false; // 断开的符号链接：lstat 可见链接本身、stat 找不到目标
    try { brokenLink = fs.lstatSync(root).isSymbolicLink(); } catch {}
    return { state: 'missing', reason: brokenLink ? '断开的符号链接，目标目录不存在' : null };
  }
  if (err && err.code === 'ENOTDIR') {
    return { state: 'missing', reason: '上级路径不是目录，项目根目录不存在' };
  }
  const why = err && err.code ? `stat 失败（${err.code}）` : 'stat 失败（未知原因）';
  return { state: 'error', reason: `${why}，无法确定目录是否存在` };
}

// REQ-20260910-010：单项移出路径解析——不再要求目录存在（已删除/迁移的注册记录可清理）。
// 存在的路径仍 realpath 对齐注册表 canonical 根；不存在的路径原样规范化
//（注册根在登记时即已 realpath，canonical 路径按原串即可匹配）。
function resolveProjectRemovePath(raw) {
  if (typeof raw !== 'string' || !raw) {
    throw new core.AtbError('path 必须是项目根的绝对路径，得到：(空)');
  }
  if (!path.isAbsolute(raw)) {
    throw new core.AtbError(`path 必须是项目根的绝对路径，得到：${raw}`);
  }
  return realPath(path.resolve(raw));
}

// REQ-20260910-005：removed 记录被用户显式移出的真实路径——只用于两处闸门：
// ① resolveProject 隐式登记跳过（轮询/过期深链不得把已移出项目悄悄注册回来）；
// ② defaultProjectRoot 空表播种跳过（启动目录自身被移出时不再自动播种）。
// 显式入口（导入 register / 初始化 init）是用户意图，成功时从 removed 清除（重新导入语义）。
function removedProjects(reg) {
  return Array.isArray(reg.removed) ? reg.removed : [];
}

function registerProject(root, opts = {}) {
  const reg = loadRegistry();
  const removed = new Set(removedProjects(reg));
  let changed = false;
  if (!reg.projects.includes(root)) {
    reg.projects.push(root);
    changed = true;
  }
  if (opts.explicit && removed.has(root)) {
    removed.delete(root);
    changed = true;
  }
  if (!changed) return;
  if (removed.size) reg.removed = [...removed];
  else delete reg.removed;
  saveRegistry(reg);
}

// REQ-20260910-005 移出：仅改注册表（projects → removed），不触碰磁盘项目数据、
// 批次账本与运行中的任务；之后可通过导入（register）恢复展示。
function unregisterProject(root) {
  const reg = loadRegistry();
  const i = reg.projects.indexOf(root);
  if (i === -1) throw new core.AtbError(`该项目不在列表中：${root}`);
  reg.projects.splice(i, 1);
  reg.removed = [...new Set([...removedProjects(reg), root])];
  saveRegistry(reg);
}

function defaultProjectRoot() {
  const reg = loadRegistry();
  if (reg.projects.length) return reg.projects[0];
  const seeded = realPath(path.resolve(cwd));
  if (removedProjects(reg).includes(seeded)) return null; // 启动目录已被用户移出：保持空态，不回播
  registerProject(seeded);
  return seeded;
}

// ---------- REQ-20260910-003 全局任务看板：跨项目只读聚合 ----------

// 批次账本目录下解析失败的 batch.json 扫描（listBatches 会静默跳过坏账本；全局视图须显式
// 把「该项目读取失败」暴露出来——行内标注原因，不阻塞其他项目）。返回损坏批次号数组。
function corruptBatchIds(batchesDir) {
  const out = [];
  let names = [];
  try {
    names = fs.readdirSync(batchesDir);
  } catch {
    return out; // 目录不存在 = 该项目没有这类批次，不是错误
  }
  for (const n of names) {
    const file = path.join(batchesDir, n, 'batch.json');
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!j || !j.batchId) out.push(n);
    } catch {
      out.push(n);
    }
  }
  return out;
}

// 单项目聚合：开发批次 + 完善批次简报（均为只读 brief，不触发核对/结算/锁）。
// REQ-20260913-003：去批次概念——简报不再透出批次号，也不补「排队中」标记（存量排队账本
// 仍逐条入列，前端按状态归「待启动」档展示；同一时间只有一轮执行）。
// REQ-20260911-010：批量 Commit（CMT）批次简报随人工批量提交流程回退移除。
function projectTaskRows(root) {
  const dataDir = core.dataDirFrom(root);
  if (!dataDir) return []; // 未初始化注册项目：按「该项目无任务」处理而非报错（README 边界）
  const devBatches = batch.unfinishedBatches(dataDir).filter((b) => !b.aborted);
  const rfBatches = refine.unfinishedRefineBatches(dataDir).filter((b) => !b.aborted);
  const rows = [];
  devBatches.forEach((b) => rows.push(batch.batchBrief(dataDir, b)));
  rfBatches.forEach((b) => rows.push(refine.refineBatchBrief(dataDir, b)));
  return rows;
}

// 逐项目容错聚合：任何读盘异常（目录已不存在 / 账本损坏 / 权限等）只降级为该项目错误行。
function aggregateGlobalTasks() {
  return loadRegistry().projects.map((root) => {
    const row = { root, name: shortProjectDirName(root), status: 'ok', error: null, tasks: [] };
    try {
      let st = null;
      try {
        st = fs.statSync(root);
      } catch {}
      if (!st || !st.isDirectory()) {
        row.status = 'error';
        row.error = `项目目录不存在（该项目可能已迁移）：${root}`;
        return row;
      }
      const dataDir = core.dataDirFrom(root);
      if (dataDir) {
        const corrupt = [
          ...corruptBatchIds(path.join(dataDir, 'dispatch', 'batches')),
          ...corruptBatchIds(path.join(dataDir, 'refine', 'batches')),
          // REQ-20260911-010：commits/batches（CMT 批次账本）不再纳入——人工批量提交流程已回退，
          // 存量账本目录仅作历史数据保留，不再影响全局看板
        ];
        if (corrupt.length) {
          row.status = 'error';
          row.error = `批次账本 JSON 损坏：${corrupt.slice(0, 3).join('、')}${corrupt.length > 3 ? ` 等 ${corrupt.length} 个` : ''}`;
          return row;
        }
      }
      row.tasks = projectTaskRows(root);
    } catch (e) {
      row.status = 'error';
      row.error = `读取失败：${e && e.message ? e.message : '未知原因'}`;
    }
    return row;
  });
}

function shortProjectDirName(root) {
  const parts = String(root).split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(root);
}


// 解析 ?project= 参数：必须绝对路径且目录存在；首次命中即登记。
// REQ-20260910-005：已移出项目跳过隐式登记（数据仍可读——过期深链按现状展示，
// 但不得无提示恢复注册；重新加入走管理面板的导入/初始化显式入口）。
function resolveProject(u) {
  const raw = u.searchParams.get('project');
  if (!raw) return { root: defaultProjectRoot(), explicit: false };
  if (typeof raw !== 'string' || !path.isAbsolute(raw)) {
    throw new core.AtbError(`project 必须是项目根的绝对路径，得到：${raw}`);
  }
  const root = realPath(path.resolve(raw));
  let st = null;
  try {
    st = fs.statSync(root);
  } catch {}
  if (!st || !st.isDirectory()) {
    throw new core.AtbError(`项目目录不存在：${raw}`);
  }
  if (!removedProjects(loadRegistry()).includes(root)) registerProject(root);
  return { root, explicit: true };
}

// ---------- 请求体 ----------

// BUG-20260907-004：上限对齐附件场景 —— 前端单张图片附件 ≤8MB（app.js readAttachFile，
// 与 oncall-store ATTACHMENT_MAX_BYTES 一致），base64 内嵌 JSON 后 ≈10.7MB，故放宽至 12MB。
const BODY_MAX_BYTES = 12 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let overflowed = false;
    req.on('data', (c) => {
      if (overflowed) return; // 已判超限：继续读干剩余字节但不累积，保证 400 响应可送达（不 destroy 连接）
      size += c.length;
      if (size > BODY_MAX_BYTES) {
        overflowed = true;
        chunks.length = 0;
        reject(new core.AtbError(`请求体过大（>${BODY_MAX_BYTES / 1024 / 1024}MB）`));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveFile(res, rel) {
  const file = path.resolve(webRoot, rel);
  if (!(file + path.sep).startsWith(webRoot + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    // 本地看板始终取最新资源，避免浏览器启发式缓存旧版样式
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
}

// ---------- BUG-20260908-021：条目交互演示 HTML 端点（/api/item/:id/demo/:name，只读） ----------

const DEMO_HTML_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(html|htm)$/i;
const DEMO_HTML_MAX_BYTES = 2 * 1024 * 1024;
// 沙箱口径：演示约定为单文件、内联 CSS/JS、无外网依赖——只放行内联脚本/样式与 data: 资源；
// fetch/XHR 随 default-src 'none' 收敛被禁，演示页无法触达看板管理 API；base-uri/form-action/
// frame-ancestors 一并收紧。既有防护（防穿越、MIME 白名单、/api/fs/raw 的图片 CSP）一概不放宽。
const DEMO_HTML_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
  'media-src data:',
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function escapeHtmlText(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// 演示端点错误页：该端点会被浏览器直接导航打开，JSON 错误对人不友好——
// 返回人读 HTML 提示页，同样带 nosniff + 收敛 CSP（无脚本可执行，页面惰性）。
function sendDemoHtmlPage(res, code, message) {
  const body = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>演示打开失败</title></head>
<body style="font:14px/1.7 -apple-system,'PingFang SC',sans-serif;color:#57606a;padding:32px">
<h2 style="margin:0 0 12px;font-size:17px;color:#24292f">交互演示打开失败</h2>
<p>${escapeHtmlText(message)}</p>
<p>可回到看板条目详情确认演示文件是否仍在，或用系统浏览器直接打开条目目录下的该文件。</p>
<p><a href="/">← 返回看板</a></p>
</body></html>`;
  res.writeHead(code, {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    'Cache-Control': 'no-store',
  });
  res.end(body);
  return { streamed: true };
}

// BUG-20260909-005：API 路由未命中兜底的人读页（仅浏览器直接导航形态：GET 且 Accept 含
// text/html；fetch 默认 Accept 为 */*，仍走 JSON「未知接口」契约）。常驻进程路由集在启动时
// 固化而静态前端实时读盘，直接导航的链接（如条目演示页）在旧进程上会落到兜底——给人读
// 「版本过旧 + atb serve 自愈」指引，而不是一段裸 JSON（同 sendDemoHtmlPage 的收敛口径）。
function sendApiMissHtmlPage(res, pathname) {
  const body = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>接口不可用</title></head>
<body style="font:14px/1.7 -apple-system,'PingFang SC',sans-serif;color:#57606a;padding:32px">
<h2 style="margin:0 0 12px;font-size:17px;color:#24292f">接口不可用</h2>
<p>接口 ${escapeHtmlText(pathname)} 在当前看板服务上未命中。</p>
<p>若这是看板页面上的链接，通常是看板服务进程版本过旧（页面已更新、常驻服务尚未重启）：
请在终端运行 <code>atb serve</code> 自动重启过旧服务，然后回到看板刷新页面重试。</p>
<p><a href="/">← 返回看板</a></p>
</body></html>`;
  res.writeHead(404, {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    'Cache-Control': 'no-store',
  });
  res.end(body);
  return { streamed: true };
}

// ---------- File Board：项目内只读文件访问（防穿越、排除依赖目录） ----------

const FS_EXCLUDE = new Set(['node_modules', '.git']);
const FS_MAX_BYTES = 1024 * 1024;
// REQ-20260906-010：图片原始字节端点仅放行图片后缀（白名单），独立 8MB 上限
// （截图常超文本预览的 1MB；超大素材仅提示不预览，避免拖垮本地服务）
const FS_RAW_MAX_BYTES = 8 * 1024 * 1024;
const FS_RAW_IMAGE_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.bmp': 'image/bmp', '.avif': 'image/avif',
};

function resolveSafeFsPath(root, rel) {
  if (typeof rel !== 'string' || path.isAbsolute(rel)) {
    throw new core.AtbError('path 必须是项目内相对路径');
  }
  const segs = rel.split('/').filter(Boolean);
  if (segs.some((s) => s === '..' || s.startsWith('.') || FS_EXCLUDE.has(s))) {
    throw new core.AtbError(`非法或受限路径：${rel || '(空)'}`);
  }
  const abs = segs.length ? path.resolve(root, ...segs) : path.resolve(root);
  let real;
  try {
    real = fs.realpathSync(abs);
  } catch {
    throw new core.AtbError(`路径不存在：${rel}`);
  }
  const realRoot = fs.realpathSync(path.resolve(root));
  if (real !== realRoot && !(real + path.sep).startsWith(realRoot + path.sep)) {
    throw new core.AtbError(`路径越出项目根：${rel}`);
  }
  return real;
}

async function handleFsApi(req, res, u, pathname, root) {
  const rel = u.searchParams.get('path') || '';

  if (req.method === 'GET' && pathname === '/api/fs') {
    const abs = resolveSafeFsPath(root, rel);
    let st = null;
    try { st = fs.statSync(abs); } catch {}
    if (!st || !st.isDirectory()) throw new core.AtbError(`不是目录：${rel || '(项目根)'}`);
    const entries = [];
    for (const name of fs.readdirSync(abs)) {
      if (name.startsWith('.') || FS_EXCLUDE.has(name)) continue;
      let s = null;
      try { s = fs.statSync(path.join(abs, name)); } catch { continue; }
      entries.push({
        name,
        dir: s.isDirectory(),
        size: s.isDirectory() ? null : s.size,
        mtime: s.mtime.toISOString(),
      });
    }
    entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
    return sendJson(res, 200, { path: rel, parent: rel ? rel.split('/').slice(0, -1).join('/') : null, entries });
  }

  if (req.method === 'GET' && pathname === '/api/fs/file') {
    if (!rel) throw new core.AtbError('缺少 path 参数');
    const abs = resolveSafeFsPath(root, rel);
    let st = null;
    try { st = fs.statSync(abs); } catch {}
    if (!st || st.isDirectory()) throw new core.AtbError(`不是文件：${rel}`);
    if (st.size > FS_MAX_BYTES) {
      throw new core.AtbError(`文件 ${(st.size / 1024 / 1024).toFixed(1)}MB，超过 1MB 上限，不在线预览`);
    }
    const buf = fs.readFileSync(abs);
    if (buf.includes(0)) throw new core.AtbError('二进制文件，不支持在线预览');
    return sendJson(res, 200, {
      path: rel,
      name: path.basename(rel),
      ext: path.extname(rel).slice(1).toLowerCase(),
      size: st.size,
      content: buf.toString('utf8'),
    });
  }

  // REQ-20260906-010：图片原始字节（供 <img> 预览）。防穿越规则与 /api/fs/file 一致；
  // nosniff + 收紧 CSP（default-src 'none'）——svg 被直接导航打开也无法执行脚本。
  if (req.method === 'GET' && pathname === '/api/fs/raw') {
    if (!rel) throw new core.AtbError('缺少 path 参数');
    const abs = resolveSafeFsPath(root, rel);
    const mime = FS_RAW_IMAGE_MIME[path.extname(rel).toLowerCase()];
    if (!mime) {
      throw new core.AtbError(`仅支持图片预览（png/jpg/jpeg/gif/webp/svg/ico/bmp/avif）：${rel}`);
    }
    let st = null;
    try { st = fs.statSync(abs); } catch {}
    if (!st || st.isDirectory()) throw new core.AtbError(`不是文件：${rel}`);
    if (st.size > FS_RAW_MAX_BYTES) {
      throw new core.AtbError(`图片 ${(st.size / 1024 / 1024).toFixed(1)}MB，超过 8MB 上限，不在线预览`);
    }
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': st.size,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(abs).pipe(res);
    return { streamed: true };
  }

  return null;
}

// 网页（人工）允许执行的流转（REQ-20260903-001 回退：认领即实施，网页不做对齐确认；
// REQ-20260908-010：accepted ↔ planned 置计划/移出计划均为人工排期操作）
function boardTransitionAllowed(from, to) {
  if (from === 'submitted' && to === 'accepted') return true;
  if (from === 'accepted' && to === 'planned') return true; // 人工置计划（REQ-20260908-010）
  if (from === 'planned' && to === 'accepted') return true; // 人工移出计划（REQ-20260908-010）
  if (from === 'accepted' && to === 'submitted') return true; // 人工驳回接受（REQ-20260907-011）
  if (from === 'in-progress' && to === 'done') return true;
  if (from === 'done' && to === 'in-progress') return true; // 人工驳回完成
  return false;
}

// ---------- REQ-20260906-015 全局搜索：条目（id/标题）、条目文档正文、项目文件名 ----------

const SEARCH_MAX_HITS = 50;          // 每类结果上限，超限标记 truncated
const SEARCH_DOC_SNIPPET = 160;      // 文档命中摘要截断长度
const SEARCH_FS_MAX_DEPTH = 16;      // 文件递归深度上限（兜底防深路径/链接环）
const SEARCH_FS_MAX_ENTRIES = 20000; // 文件扫描条目上限（兜底防大项目拖垮本地服务）

// 文件名搜索：从项目根 DFS，忽略 FS_EXCLUDE（node_modules/.git）、隐藏条目与符号链接
function searchFiles(root, needle) {
  const hits = [];
  let scanned = 0;
  let truncated = false;
  const walk = (rel, depth) => {
    if (truncated) return;
    let names;
    try { names = fs.readdirSync(rel ? path.join(root, rel) : root); } catch { return; }
    for (const name of names) {
      if (truncated) return;
      if (name.startsWith('.') || FS_EXCLUDE.has(name)) continue;
      if (++scanned > SEARCH_FS_MAX_ENTRIES) return; // 扫描上限兜底：静默停止，不算命中截断
      const childRel = rel ? `${rel}/${name}` : name;
      let st;
      try { st = fs.lstatSync(path.join(root, childRel)); } catch { continue; }
      if (st.isSymbolicLink()) continue; // 防链接环
      if (st.isDirectory()) {
        if (depth < SEARCH_FS_MAX_DEPTH) walk(childRel, depth + 1);
        continue;
      }
      if (!st.isFile()) continue;
      if (!name.toLowerCase().includes(needle)) continue;
      hits.push({ path: childRel, size: st.size, mtime: st.mtime.toISOString() });
      if (hits.length >= SEARCH_MAX_HITS + 1) { truncated = true; return; } // 多取 1 条用于判定截断
    }
  };
  walk('', 0);
  return { hits: hits.slice(0, SEARCH_MAX_HITS), truncated };
}

// 条目文档正文搜索：跳过每篇首行 H1（单号与标题的冗余元信息），取首个匹配行
function searchDocs(dataDir, needle) {
  if (!dataDir) return { hits: [], truncated: false };
  const hits = [];
  let truncated = false;
  for (const st of core.listItems(dataDir)) {
    if (truncated) break;
    let dir;
    try { dir = core.resolveItemDir(dataDir, st.id).dir; } catch { continue; }
    let docs;
    try { docs = core.orderedDocs(dir); } catch { continue; }
    for (const name of docs) {
      if (truncated) break;
      let content;
      try { content = fs.readFileSync(path.join(dir, name), 'utf8'); } catch { continue; }
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('# ')) continue; // H1 = 标题冗余，不算内容命中
        if (!lines[i].toLowerCase().includes(needle)) continue;
        hits.push({
          id: st.id,
          name,
          line: i + 1,
          text: (lines[i].trim().length > SEARCH_DOC_SNIPPET ? lines[i].trim().slice(0, SEARCH_DOC_SNIPPET) + '…' : lines[i].trim()),
        });
        if (hits.length >= SEARCH_MAX_HITS + 1) { truncated = true; break; }
        break; // 每篇文档只取首个匹配行
      }
    }
  }
  return { hits: hits.slice(0, SEARCH_MAX_HITS), truncated };
}

// 条目搜索：id 或标题大小写不敏感子串命中
function searchItems(dataDir, needle) {
  if (!dataDir) return { hits: [], truncated: false };
  const matched = core
    .listItems(dataDir)
    .filter((st) => st.id.toLowerCase().includes(needle) || String(st.title || '').toLowerCase().includes(needle))
    .map((st) => ({ id: st.id, type: st.type, title: st.title, status: st.status }));
  return { hits: matched.slice(0, SEARCH_MAX_HITS), truncated: matched.length > SEARCH_MAX_HITS };
}

function handleSearchApi(res, u, root, dataDir) {
  const q = String(u.searchParams.get('q') || '').trim();
  const lower = q.toLowerCase();
  if (!lower) return sendJson(res, 200, { q, items: [], docs: [], files: [], truncated: [] });

  const items = searchItems(dataDir, lower);
  const docs = searchDocs(dataDir, lower);
  const files = searchFiles(root, lower);
  const truncated = [
    ...(items.truncated ? ['items'] : []),
    ...(docs.truncated ? ['docs'] : []),
    ...(files.truncated ? ['files'] : []),
  ];
  return sendJson(res, 200, {
    q,
    items: items.hits,
    docs: docs.hits,
    files: files.hits,
    truncated,
  });
}


// ---------- Codex 自动派发（REQ-20260906-003）：调度器中心 ----------

const HUB = createHub();               // 首期全服务自动实施并发固定 1
const schedulers = new Map();          // 项目根 → scheduler（懒建 + 建即恢复核对）
const ATB_CLI_ABS = fileURLToPath(new URL('./atb.mjs', import.meta.url));

function schedulerFor(root) {
  if (!schedulers.has(root)) {
    const dataDir = core.dataDirFrom(root);
    if (!dataDir) throw new core.AtbError(`项目未初始化看板，无法使用自动派发：${root}`);
    const s = createScheduler({
      projectRoot: root,
      dataDir,
      hub: HUB,
      atbCliPath: ATB_CLI_ABS,
      cli: {}, // 生产形态：目标 CLI 取自项目设置（settings.codex.cliPath / 自动探测）
      tickMs: Number(process.env.ATB_TICK_MS || 4000),
      cancelGraceMs: Number(process.env.ATB_CANCEL_GRACE_MS || 10_000),
      settleMs: Number(process.env.ATB_SETTLE_MS || 1500),
    });
    s.recover(); // 服务重启后先核对账本/锁/进程/上报，再决定是否继续取单
    s.start();
    schedulers.set(root, s);
  }
  return schedulers.get(root);
}

// 静态预检（不发模型请求）：CLI/版本/项目/工具/配置
function staticPreflight(root, dataDir) {
  const settings = dispatchStore.loadSettings(dataDir);
  const cliPath = settings.codex.cliPathExplicit ? settings.codex.cliPath : detectCli();
  const checks = checkCodexEnvironment({ cliPath, projectRoot: root, dataDir, allowNonGit: settings.codex.allowNonGit });
  const cliOk = checks.find((c) => c.id === 'cli').ok;
  checks.push({ id: 'project', ok: !!dataDir && fs.existsSync(root), label: '项目与看板数据目录', detail: root });
  let atbOk = false;
  try { atbOk = fs.statSync(ATB_CLI_ABS).isFile(); } catch {}
  checks.push({ id: 'atb-cli', ok: atbOk, label: 'atb 工具入口', detail: ATB_CLI_ABS });
  const c = settings.codex;
  const validConf = Number.isInteger(c.timeoutMin) && c.timeoutMin >= 5 && c.timeoutMin <= 240
    && Number.isInteger(c.retries) && c.retries >= 0 && c.retries <= 3;
  checks.push({ id: 'config', ok: validConf, label: '运行配置合法', detail: `单项时限 ${c.timeoutMin} 分钟 · 网络重试 ${c.retries} 次 · 重启续跑 ${c.resumeAfterRestart ? '开' : '关'}` });
  return { checks, cliPath: cliOk ? cliPath : null, allOk: checks.every((x) => x.ok), note: '以上为静态检查，不向模型发送请求，也未验证登录、CLI 沙箱写入权限和模型可达性；模型可达性请用「验证模型可达」按钮单独触发' };
}

// 最小模型验证（REQ-20260906-024 升级）：真实发起一次极小 codex exec（用户显式触发才调用，消耗一次模型请求）。
// 与正式运行共用同一解析与参数构造（M07）：待验证选择 → 解析快照 → startCodexExec 显式传参；
// 验证结果绑定模型/强度/配置指纹持久化，配置变化后前端标注「需要重新验证」。
async function modelPreflight(root, dataDir, cliPath, bodySelection = null) {
  const started = Date.now();
  const settings = dispatchStore.loadSettings(dataDir);
  const allowNonGit = settings.codex.allowNonGit;
  // 解析优先级与调度一致：请求携带选择 > 项目设置 > 继承（不因验证放宽规则）
  const eff = effectiveSelection({ itemSelection: null, projectSelection: bodySelection || settings.codex.modelSelection });
  const catalog = loadModelCatalog({ cliPath, cwd: root, noCache: true });
  let model = null;
  if (eff.selection.mode === 'explicit') {
    const snap = buildModelSnapshot({ selection: eff.selection, source: eff.source, catalog, cliVersion: probeCliVersion(cliPath) });
    if (!snap.ok) return { ok: false, error: snap.error, stage: 'resolve' };
    model = snap;
  } else {
    const layers = readModelConfigLayers({ projectRoot: root });
    const inherit = resolveInheritedModel(layers);
    const snap = buildModelSnapshot({ selection: { mode: 'inherit' }, source: 'inherit', inherit, catalog, layers, cliVersion: probeCliVersion(cliPath) });
    if (!snap.ok) return { ok: false, error: snap.error, stage: 'resolve' };
    model = snap;
  }
  const snapshot = model.snapshot;
  const finalFile = path.join(os.tmpdir(), `atb-model-preflight-${process.pid}.md`);
  const handle = startCodexExec({
    cliPath,
    projectRoot: root,
    allowNonGit,
    prompt: '请只回复两个字：可达',
    finalMessageFile: finalFile,
    model: snapshot.modelId,
    reasoningEffort: snapshot.reasoningEffort,
    timeoutMs: 90_000,
    cancelGraceMs: 5000,
    settleMs: 1000,
  });
  const res = await handle.promise;
  const finalMsg = fs.existsSync(finalFile) ? fs.readFileSync(finalFile, 'utf8').trim() : '';
  try { fs.unlinkSync(finalFile); } catch {}
  const cls = (!res.spawnError && res.code !== 0) ? classifyFailure(res.stderr, res.code) : null;
  const ok = !res.spawnError && res.code === 0 && !!finalMsg;
  const error = res.spawnError ? res.spawnError.message
    : res.code !== 0 ? String(res.stderr || '').split('\n').filter(Boolean).slice(-3).join('\n') : null;
  // 持久化验证结果（非敏感；绑定配置指纹，仅明确点击触发，保存/轮询不会写这里）
  try {
    const cur = dispatchStore.loadSettings(dataDir);
    dispatchStore.saveSettings(dataDir, {
      codex: {
        ...cur.codex,
        lastVerification: {
          modelId: snapshot.modelId, reasoningEffort: snapshot.reasoningEffort,
          configFingerprint: snapshot.configFingerprint, ok, at: new Date().toISOString(),
          error: ok ? null : String(error || '').slice(0, 800), note: cls ? `分类：${cls.kind}` : null,
        },
      },
    });
  } catch { /* 验证结果落盘失败不影响验证本身 */ }
  return {
    ok,
    stage: 'exec',
    durationMs: Date.now() - started,
    exitCode: res.code,
    threadId: res.threadId,
    model: { modelId: snapshot.modelId, reasoningEffort: snapshot.reasoningEffort, configFingerprint: snapshot.configFingerprint },
    failureKind: cls ? cls.kind : null,
    finalMessage: finalMsg || null,
    error,
  };
}

async function handleDispatchApi(req, res, u, pathname, root, dataDir) {
  if (req.method === 'GET' && pathname === '/api/dispatch/settings') {
    return sendJson(res, 200, { settings: dispatchStore.loadSettings(dataDir), detectedCli: detectCli(), atbCli: ATB_CLI_ABS });
  }

  if (req.method === 'POST' && pathname === '/api/dispatch/settings') {
    const body = JSON.parse((await readBody(req)) || '{}');
    return sendJson(res, 200, { settings: dispatchStore.saveSettings(dataDir, { codex: body.codex || {} }) });
  }

  if (req.method === 'GET' && pathname === '/api/dispatch/preflight') {
    return sendJson(res, 200, staticPreflight(root, dataDir));
  }

  if (req.method === 'POST' && pathname === '/api/dispatch/preflight/model') {
    const pre = staticPreflight(root, dataDir);
    if (!pre.allOk) return sendJson(res, 400, { error: '运行环境不可用，请先通过静态检查', checks: pre.checks });
    // REQ-20260906-024：验证使用待验证配置（请求可携带 modelSelection；缺省用项目设置/继承）
    const body = JSON.parse((await readBody(req)) || '{}');
    let selection = null;
    if (body.modelSelection !== undefined && body.modelSelection !== null) {
      const n = normalizeModelSelection(body.modelSelection);
      if (!n.ok) return sendJson(res, 400, { error: `modelSelection 非法：${n.error}` });
      selection = n.value;
    }
    const result = await modelPreflight(root, dataDir, pre.cliPath, selection);
    return sendJson(res, result.stage === 'resolve' && !result.ok ? 400 : 200, result);
  }

  // REQ-20260906-024：模型目录（只读能力 codex debug models；列表存在 ≠ 账户可用，不为候选逐个发请求）
  if (req.method === 'GET' && pathname === '/api/dispatch/codex/models') {
    const settings = dispatchStore.loadSettings(dataDir);
    const cliPath = settings.codex.cliPathExplicit ? settings.codex.cliPath : detectCli();
    const catalog = loadModelCatalog({ cliPath, cwd: root, noCache: u.searchParams.get('refresh') === '1' });
    return sendJson(res, 200, {
      ...catalog,
      note: '目录来自 CLI 只读能力，代表已知模型与档位，不等于当前账户可用；账户可用性需用「验证所选模型」真实触发。',
    });
  }

  // REQ-20260906-024：继承解析展示（只读配置层；刷新按钮触发，不发模型请求）
  if (req.method === 'GET' && pathname === '/api/dispatch/codex/model-inherit') {
    const settings = dispatchStore.loadSettings(dataDir);
    const cliPath = settings.codex.cliPathExplicit ? settings.codex.cliPath : detectCli();
    const layers = readModelConfigLayers({ projectRoot: root });
    const inherit = resolveInheritedModel(layers);
    const catalog = loadModelCatalog({ cliPath, cwd: root });
    return sendJson(res, 200, {
      inherit,
      layers: layers.map((x) => ({ kind: x.kind, path: x.path, exists: x.exists })),
      catalogOk: catalog.ok,
      catalogReason: catalog.reason || null,
      cliVersion: cliPath ? probeCliVersion(cliPath) : null,
      resolvedAt: new Date().toISOString(),
    });
  }

  // REQ-20260906-024：待处理记录（持久提示：刷新/切换项目/重启后仍可找到；服务重启自动恢复）
  if (req.method === 'GET' && pathname === '/api/dispatch/pending') {
    const items = dispatchStore.listModelPending(dataDir, { onlyOpen: true });
    return sendJson(res, 200, { count: items.length, items });
  }

  if (req.method === 'POST' && pathname === '/api/dispatch/codex/toggle') {
    const body = JSON.parse((await readBody(req)) || '{}');
    if (body.enabled) {
      const pre = staticPreflight(root, dataDir);
      if (!pre.allOk) {
        return sendJson(res, 400, { error: '运行环境未通过检查，不能开启自动派发', checks: pre.checks });
      }
      if (!dispatchStore.loadSettings(dataDir).codex.cliPathExplicit && pre.cliPath) {
        dispatchStore.saveSettings(dataDir, { codex: { cliPath: pre.cliPath } });
      }
    }
    const s = schedulerFor(root);
    if (body.enabled) s.enable();
    else s.disable();
    return sendJson(res, 200, { ok: true, status: s.status() });
  }

  if (req.method === 'GET' && pathname === '/api/dispatch/status') {
    return sendJson(res, 200, schedulerFor(root).status());
  }

  if (req.method === 'POST' && pathname === '/api/dispatch/codex/stop') {
    return sendJson(res, 200, schedulerFor(root).stopCurrent());
  }

  if (req.method === 'POST' && pathname === '/api/dispatch/codex/resume-item') {
    // BUG-20260906-008：恢复必须绑定请求方当前查看的 runId，不再接受空请求体代选
    const body = JSON.parse((await readBody(req)) || '{}');
    if (typeof body.runId !== 'string' || !body.runId.trim()) {
      throw new core.AtbError('缺少 runId：恢复必须绑定当前查看的执行');
    }
    return sendJson(res, 200, schedulerFor(root).resumeItem(body.runId));
  }

  // REQ-20260906-024 M12：以新配置重试本项（用户主动切换模型；保存/验证不会自动触发本接口）
  if (req.method === 'POST' && pathname === '/api/dispatch/codex/retry-item') {
    const body = JSON.parse((await readBody(req)) || '{}');
    if (typeof body.runId !== 'string' || !body.runId.trim()) {
      throw new core.AtbError('缺少 runId：重试必须绑定当前查看的执行');
    }
    return sendJson(res, 200, schedulerFor(root).retryItemWithConfig({
      runId: body.runId,
      modelSelection: body.modelSelection ?? null,
    }));
  }

  if (req.method === 'GET' && pathname === '/api/dispatch/runs') {
    const limit = Math.min(Number(u.searchParams.get('limit') || 20) || 20, 100);
    const offset = Math.max(Number(u.searchParams.get('offset') || 0) || 0, 0);
    return sendJson(res, 200, dispatchStore.listRuns(dataDir, { limit, offset }));
  }

  const runMatch = pathname.match(/^\/api\/dispatch\/runs\/(run-[0-9a-zA-Z-]+)$/);
  if (runMatch && req.method === 'GET') {
    const run = dispatchStore.getRun(dataDir, runMatch[1]);
    let finalSize = 0;
    try { finalSize = fs.statSync(path.join(dispatchStore.runDir(dataDir, run.runId), 'final-message.md')).size; } catch {}
    return sendJson(res, 200, { ...run, finalSize });
  }

  const logMatch = pathname.match(/^\/api\/dispatch\/runs\/(run-[0-9a-zA-Z-]+)\/log$/);
  if (logMatch && req.method === 'GET') {
    const name = u.searchParams.get('name') || 'events';
    const offset = Number(u.searchParams.get('offset') || 0) || 0;
    const limit = Math.min(Number(u.searchParams.get('limit') || 64 * 1024) || 64 * 1024, 256 * 1024);
    return sendJson(res, 200, dispatchStore.readLog(dataDir, logMatch[1], name, { offset, limit }));
  }

  return null;
}

// ---------- Oncall 咨询看板（REQ-20260907-001）：codex 后台执行器 + HTTP API ----------
// 咨询为只读问答：执行不占项目实施互斥（impl.lock），与 REQ/BUG 批次/Codex 派发互不影响；
// 项目内 oncall 执行并发 1，逐单串行（服务重启时旧执行按失败落账，详情页可重派）。

const oncallRunners = new Map(); // 项目根 → runner

function resolveOncallCli(dataDir) {
  const settings = dispatchStore.loadSettings(dataDir).codex;
  const cliPath = settings.cliPathExplicit ? settings.cliPath : detectCli();
  return cliPath && fs.existsSync(cliPath) ? cliPath : null;
}

function createOncallRunner({ projectRoot, dataDir }) {
  const queue = []; // runId 串行队列
  let current = null;

  function enqueue(runId) {
    queue.push(runId);
    pump();
  }

  function pump() {
    if (current || !queue.length) return;
    runOne(queue.shift());
  }

  function runOne(runId) {
    const run = oncall.getOncallRun(dataDir, runId);
    // 执行前复核：单据已被抢先回答/重派 → 跳过（不覆盖有效回答）
    const ticket = oncall.getTicket(dataDir, run.ticketId);
    if (ticket.status === 'answered') {
      oncall.updateOncallRun(dataDir, runId, { phase: 'skipped', endedAt: new Date().toISOString(), result: { reason: 'already-answered' } });
      pump();
      return;
    }
    current = runId;
    const settings = dispatchStore.loadSettings(dataDir).codex;
    const cliPath = settings.cliPathExplicit ? settings.cliPath : detectCli();
    const finalFile = path.join(oncall.oncallRunDir(dataDir, runId), 'final-message.md');
    oncall.updateOncallRun(dataDir, runId, { phase: 'running', startedAt: new Date().toISOString() });
    const handle = startCodexExec({
      cliPath,
      projectRoot,
      prompt: run.prompt,
      finalMessageFile: finalFile,
      allowNonGit: settings.allowNonGit,
      timeoutMs: (run.timeoutMin || settings.timeoutMin || 60) * 60_000,
      onEvent: ({ kind: k, event, line }) => {
        oncall.appendOncallEvent(dataDir, runId, k === 'diagnostic' ? { diag: line, at: new Date().toISOString() } : event);
        const tid = event && typeof event === 'object'
          ? (event.thread_id ?? event.threadId ?? (event.thread && event.thread.id) ?? (event.type === 'thread.started' ? event.id : null))
          : null;
        if (tid) oncall.updateOncallRun(dataDir, runId, { threadId: String(tid) });
      },
      onStderr: (chunk) => oncall.appendOncallStderr(dataDir, runId, chunk),
    });
    handle.promise.then((res) => settle(runId, handle.pid, res, finalFile)).catch(() => {});
  }

  function settle(runId, pid, res, finalFile) {
    current = null;
    const run = oncall.getOncallRun(dataDir, runId);
    const now = new Date().toISOString();
    oncall.updateOncallRun(dataDir, runId, {
      attempts: [...run.attempts, {
        startedAt: run.startedAt || now, pid: pid ?? null, exitCode: res.code ?? null,
        signal: res.signal || null, endedAt: now,
      }],
    });
    const finish = (phase, result, ticketError = null) => {
      oncall.updateOncallRun(dataDir, runId, { phase, endedAt: now, result });
      if (ticketError) {
        try {
          oncall.failRound(dataDir, run.ticketId, { error: ticketError, by: run.by || 'codex' });
        } catch { /* 单据已被人工处置（如已回答）：保留现状 */ }
      }
      pump();
    };
    if (res.spawnError) return finish('failed', { reason: 'cli-spawn-failed', detail: res.spawnError.message }, `codex CLI 启动失败：${res.spawnError.message}`);
    if (res.cancelled) return finish('failed', { reason: 'user-stop' }, '执行被停止');
    if (res.timedOut) return finish('failed', { reason: 'timeout' }, `超过时限（${run.timeoutMin || 60} 分钟）未完成`);
    const finalMsg = fs.existsSync(finalFile) ? fs.readFileSync(finalFile, 'utf8').trim() : '';
    if (res.code === 0 && finalMsg) {
      try {
        oncall.answerTicket(dataDir, run.ticketId, { answer: finalMsg, by: run.by || oncall.oncallSessionName({ staff: run.staff }), mode: 'codex', staff: run.staff || '' });
        finish('answered', { reason: 'answered' });
      } catch (e) {
        finish('failed', { reason: 'answer-rejected', detail: e.message }, `回传被拒：${e.message}`);
      }
      return;
    }
    const cls = res.code !== 0 ? classifyFailure(res.stderr, res.code) : null;
    const detail = String(res.stderr || '').trim().slice(-600) || `退出码 ${res.code}`;
    finish('failed', { reason: cls ? cls.kind : 'no-final-message', detail }, `${cls ? cls.kind : '执行失败'}：${detail}`);
  }

  // 服务重启恢复：未终态旧执行一律按失败落账（进程归属已不可考），详情页提供重派
  function recover() {
    const notes = [];
    for (const r of oncall.listOncallRuns(dataDir)) {
      if (r.phase !== 'queued' && r.phase !== 'running') continue;
      oncall.updateOncallRun(dataDir, r.runId, {
        phase: 'failed', endedAt: new Date().toISOString(),
        result: { reason: 'recovered-interrupted', detail: '服务重启，执行中断' },
      });
      try {
        oncall.failRound(dataDir, r.ticketId, { error: '服务重启，执行中断：可在详情页重派', by: 'server' });
      } catch { /* 单据已被人工处置 */ }
      notes.push(r.runId);
    }
    return notes;
  }

  return {
    enqueue,
    recover,
    snapshot: () => ({ current, queued: [...queue] }),
  };
}

function oncallRunnerFor(root) {
  if (!oncallRunners.has(root)) {
    const dataDir = core.dataDirFrom(root);
    if (!dataDir) throw new core.AtbError(`项目未初始化看板，无法使用 Oncall：${root}`);
    const runner = createOncallRunner({ projectRoot: root, dataDir });
    runner.recover();
    oncallRunners.set(root, runner);
  }
  return oncallRunners.get(root);
}

// ---------- 需求完善（REQ-20260907-003）：codex 逐项后台执行器 + HTTP API ----------
// 完善只编辑条目 markdown（涉及 UI 的需求另可建约定的 ui-demo.html 演示，REQ-20260908-021）：
// 不占项目实施互斥（impl.lock），与实施批次/Codex 实施互不影响；
// refine 互斥（refine.lock）与 zcode 子 Agent 共用（被占时稍后重试）；项目内 codex 完善并发 1。

const refineRunners = new Map(); // 项目根 → runner

function createRefineRunner({ projectRoot, dataDir }) {
  const queue = []; // runId 串行队列
  let current = null;
  let retryTimer = null;

  function enqueue(runId) {
    queue.push(runId);
    pump();
  }

  function pump() {
    if (current || !queue.length) return;
    runOne(queue.shift());
  }

  function scheduleRetry(runId, waitMs) {
    queue.unshift(runId); // 锁被 zcode 子 Agent 持有：优先重试
    retryTimer = setTimeout(() => {
      retryTimer = null;
      current = null;
      pump();
    }, waitMs);
    if (retryTimer.unref) retryTimer.unref();
  }

  // 执行前复核：条目仍已接受且文档基线未变（状态变化/人工编辑 → 出局落账）
  // REQ-20260909-010：核验口径对齐 finishRefineRun——面向已接受单（accepted），修正 REQ-20260908-020
  // 改造后遗留的 submitted 旧口径（旧口径下 codex 完善路径必然 precheck 出局）
  function precheck(run) {
    const batch = refine.getRefineBatch(dataDir, run.batchId);
    const cand = batch.candidates.find((c) => c.id === run.itemId);
    let dir = null;
    let st = null;
    try {
      dir = core.resolveItemDir(dataDir, run.itemId).dir;
      st = core.readStatus(dir);
    } catch { /* 目录损坏 */ }
    if (!st) return { out: '条目目录损坏，无法完善' };
    if (st.status !== 'accepted') return { out: `状态已变化（当前 ${st.status}），不再需要本批完善` };
    if (!cand) return { out: '不在批次冻结候选内' };
    // REQ-20260908-025：按基线自带版本口径重算比对（存量裸哈希按已知口径任一匹配=未编辑）
    if (!refine.docsUnchangedSince(dir, cand.baseline)) return { out: '冻结后文档已被人工编辑，基线失效' };
    return { cand, dir };
  }

  function runOne(runId) {
    let run;
    try { run = refine.getRefineRun(dataDir, runId); } catch { pump(); return; }
    if (run.phase !== 'queued') { pump(); return; }
    const pre = precheck(run);
    if (pre.out) {
      refine.updateRefineRun(dataDir, runId, {
        phase: 'skipped', reason: pre.out.slice(0, 200), finishedAt: new Date().toISOString(),
      });
      settleBatch(run.batchId);
      pump();
      return;
    }
    const got = refine.tryAcquireRefineLock(dataDir, {
      kind: 'codex-refine', batchId: run.batchId, runId, owner: run.owner, at: new Date().toISOString(),
    });
    if (!got.ok) {
      current = runId; // 占住槽位防止 pump 立即重入；定时器到点释放后再泵
      scheduleRetry(runId, 5000);
      return;
    }
    current = runId;
    const settings = dispatchStore.loadSettings(dataDir).codex;
    const cliPath = settings.cliPathExplicit ? settings.cliPath : detectCli();
    const finalFile = path.join(refine.refineRunDir(dataDir, runId), 'final-message.md');
    refine.updateRefineRun(dataDir, runId, { phase: 'running', startedAt: new Date().toISOString() });
    const handle = startCodexExec({
      cliPath,
      projectRoot,
      prompt: run.prompt,
      finalMessageFile: finalFile,
      allowNonGit: settings.allowNonGit,
      timeoutMs: (run.timeoutMin || settings.timeoutMin || 60) * 60_000,
      onEvent: ({ kind: k, event, line }) => {
        refine.appendRefineEvent(dataDir, runId, k === 'diagnostic' ? { diag: line, at: new Date().toISOString() } : event);
        const tid = event && typeof event === 'object'
          ? (event.thread_id ?? event.threadId ?? (event.thread && event.thread.id) ?? (event.type === 'thread.started' ? event.id : null))
          : null;
        if (tid) refine.updateRefineRun(dataDir, runId, { threadId: String(tid) });
      },
      onStderr: (chunk) => refine.appendRefineStderr(dataDir, runId, chunk),
    });
    handle.promise.then((res) => settle(runId, handle.pid, res, finalFile)).catch(() => {});
  }

  function settle(runId, pid, res, finalFile) {
    current = null;
    const run = refine.getRefineRun(dataDir, runId);
    const now = new Date().toISOString();
    refine.updateRefineRun(dataDir, runId, {
      attempts: [...run.attempts, {
        startedAt: run.startedAt || now, pid: pid ?? null, exitCode: res.code ?? null,
        signal: res.signal || null, endedAt: now,
      }],
    });
    const finish = (phase, extra) => {
      refine.updateRefineRun(dataDir, runId, { phase, finishedAt: now, ...extra });
      refine.releaseRefineLockForRun(dataDir, runId, run.owner);
      settleBatch(run.batchId);
      pump();
    };
    if (res.spawnError) return finish('failed', { reason: `cli-spawn-failed：${res.spawnError.message}`.slice(0, 200) });
    if (res.cancelled) return finish('failed', { reason: '执行被停止' });
    if (res.timedOut) return finish('failed', { reason: `超过时限（${run.timeoutMin || 60} 分钟）未完成` });
    const finalMsg = fs.existsSync(finalFile) ? fs.readFileSync(finalFile, 'utf8').trim() : '';
    if (res.code === 0 && finalMsg) {
      // 完成核验（与 zcode refine done 同口径，REQ-20260909-010 对齐 accepted）：
      // 条目仍已接受且文档相对基线确有变更
      const batch = refine.getRefineBatch(dataDir, run.batchId);
      const cand = batch.candidates.find((c) => c.id === run.itemId);
      let st = null;
      let changed = false;
      try {
        const dir = core.resolveItemDir(dataDir, run.itemId).dir;
        st = core.readStatus(dir);
        changed = cand ? !refine.docsUnchangedSince(dir, cand.baseline) : false;
      } catch { /* 目录损坏：changed=false */ }
      if (st && st.status === 'accepted' && changed) {
        // REQ-20260909-010：done 核验通过后由系统尝试自动转入计划（配置默认关闭；结果随运行
        // 账本落盘供面板标注，失败不改变 done 结果——完善完成事实不丢失）
        const plan = refine.autoPlanRefinedItem(dataDir, run.itemId, runId);
        return finish('done', { summary: finalMsg.slice(0, 200), autoPlan: plan });
      }
      return finish('failed', {
        reason: (st && st.status !== 'accepted'
          ? `条目已离开已接受（${st.status}）`
          : '未检测到补全变更（no-doc-change）').slice(0, 200),
      });
    }
    const cls = res.code !== 0 ? classifyFailure(res.stderr, res.code) : null;
    const detail = String(res.stderr || '').trim().slice(-120) || `退出码 ${res.code}`;
    finish('failed', { reason: `${cls ? cls.kind : 'no-final-message'}：${detail}`.slice(0, 200) });
  }

  // 运行终态后重估批次状态（codex 运行不占 currentRunId）
  function settleBatch(batchId) {
    try { refine.settleRefineBatch(dataDir, batchId); } catch { /* 批次被清理等：忽略 */ }
  }

  // 服务重启恢复：未终态的 codex 完善执行按失败落账（进程归属已不可考）
  function recover() {
    const notes = [];
    for (const r of refine.listRefineRunsWithOpen(dataDir)) {
      if (r.mode !== 'codex') continue; // zcode 预留交人工 refine release / fail 处理
      refine.updateRefineRun(dataDir, r.runId, {
        phase: 'failed',
        reason: '服务重启，执行中断：可重新创建完善批次',
        finishedAt: new Date().toISOString(),
      });
      refine.releaseRefineLockForRun(dataDir, r.runId, r.owner);
      settleBatch(r.batchId);
      notes.push(r.runId);
    }
    return notes;
  }

  return {
    enqueue,
    recover,
    snapshot: () => ({ current, queued: [...queue] }),
  };
}

function refineRunnerFor(root) {
  if (!refineRunners.has(root)) {
    const dataDir = core.dataDirFrom(root);
    if (!dataDir) throw new core.AtbError(`项目未初始化看板，无法使用需求完善：${root}`);
    const runner = createRefineRunner({ projectRoot: root, dataDir });
    runner.recover();
    refineRunners.set(root, runner);
  }
  return refineRunners.get(root);
}

async function handleOncallApi(req, res, u, pathname, root, dataDir) {
  // board：未初始化项目返回空态（前端引导初始化）
  if (req.method === 'GET' && pathname === '/api/oncall/board') {
    if (!dataDir) return sendJson(res, 200, { initialized: false, codexReady: false, tickets: [] });
    return sendJson(res, 200, {
      initialized: true,
      codexReady: !!resolveOncallCli(dataDir),
      tickets: oncall.listTickets(dataDir),
    });
  }
  if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);

  // REQ-20260908-022：按归属需求过滤讨论卡列表（需求详情抽屉「需求讨论」区块数据源）
  if (req.method === 'GET' && pathname === '/api/oncall/tickets') {
    const reqId = String(u.searchParams.get('req') || '').trim() || null;
    return sendJson(res, 200, { tickets: oncall.listTickets(dataDir, { reqId }) });
  }

  if (req.method === 'POST' && pathname === '/api/oncall/ticket') {
    const body = JSON.parse((await readBody(req)) || '{}');
    const t = oncall.createTicket(dataDir, {
      title: body.title,
      question: body.question,
      req: body.req == null ? null : body.req, // REQ-20260908-022：需求绑定讨论（store 层校验）
      attachments: Array.isArray(body.attachments) ? body.attachments : [],
      by: 'board',
    });
    return sendJson(res, 200, t);
  }

  const ticketMatch = pathname.match(/^\/api\/oncall\/ticket\/(ASK-\d{8}-\d{3})$/);
  if (ticketMatch && req.method === 'GET') {
    return sendJson(res, 200, oncall.readTicketFull(dataDir, ticketMatch[1]));
  }

  const roundMatch = pathname.match(/^\/api\/oncall\/ticket\/(ASK-\d{8}-\d{3})\/round\/(\d+)$/);
  if (roundMatch && req.method === 'GET') {
    const full = oncall.readTicketFull(dataDir, roundMatch[1]);
    const round = full.rounds.find((r) => r.no === Number(roundMatch[2]));
    if (!round) throw new core.AtbError(`不存在第 ${roundMatch[2]} 轮`);
    return sendJson(res, 200, { id: full.id, ...round });
  }

  const askMatch = pathname.match(/^\/api\/oncall\/ticket\/(ASK-\d{8}-\d{3})\/ask$/);
  if (askMatch && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}');
    const t = oncall.askTicket(dataDir, askMatch[1], {
      question: body.question,
      attachments: Array.isArray(body.attachments) ? body.attachments : [],
      by: 'board',
    });
    return sendJson(res, 200, t);
  }

  // 附件原始字节：白名单图片 MIME + nosniff + 收紧 CSP（同 /api/fs/raw 口径）
  const attMatch = pathname.match(/^\/api\/oncall\/ticket\/(ASK-\d{8}-\d{3})\/attachment\/([^/]+)$/);
  if (attMatch && req.method === 'GET') {
    const name = decodeURIComponent(attMatch[2]);
    const mime = oncall.attachmentMime(name);
    if (!mime) throw new core.AtbError(`仅支持图片附件预览：${name}`);
    let buf;
    try {
      buf = oncall.readAttachment(dataDir, attMatch[1], name);
    } catch (e) {
      throw new core.AtbError(e.message);
    }
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': buf.length,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      'Cache-Control': 'no-store',
    });
    res.end(buf);
    return { streamed: true };
  }

  if (req.method === 'POST' && pathname === '/api/oncall/dispatch') {
    const body = JSON.parse((await readBody(req)) || '{}');
    const ids = body.ids;
    const mode = body.mode;
    if (!Array.isArray(ids) || !ids.length) throw new core.AtbError('ids 必须是非空咨询单号数组');
    if (mode !== 'zcode' && mode !== 'codex') throw new core.AtbError(`mode 必须是 zcode 或 codex（得到：${mode}）`);
    if (mode === 'codex') {
      const cli = resolveOncallCli(dataDir);
      if (!cli) {
        throw new core.AtbError('codex CLI 未就绪：请先在「设置 → 模型与推理强度 / 运行环境」完成检查（Codex 后台入口已按 REQ-20260908-020 隐藏），或改用 zcode 派单');
      }
    }
    const staff = typeof body.staff === 'string' ? body.staff : '';
    const r = oncall.dispatchTickets(dataDir, { ids, mode, staff, by: 'board', kind: ids.length > 1 ? 'batch' : 'single' });
    const sessionName = oncall.oncallSessionName({ staff: r.staff });
    if (mode === 'codex') {
      const runner = oncallRunnerFor(root);
      const runs = ids.map((id) => {
        const t = oncall.getTicket(dataDir, id);
        const prompt = oncall.buildOncallWorkerPrompt(dataDir, id);
        const run = oncall.newOncallRun(dataDir, {
          ticketId: id, roundNo: t.rounds.length, projectRoot: root,
          prompt, staff: r.staff, by: sessionName,
          config: dispatchStore.loadSettings(dataDir).codex,
        });
        runner.enqueue(run.runId);
        return run.runId;
      });
      return sendJson(res, 200, { ok: true, mode, dispatched: r.dispatched, staff: r.staff, sessionName, runs });
    }
    return sendJson(res, 200, { ok: true, mode, dispatched: r.dispatched, staff: r.staff, sessionName, prompt: r.prompt });
  }

  if (req.method === 'POST' && pathname === '/api/oncall/redispatch') {
    const body = JSON.parse((await readBody(req)) || '{}');
    if (typeof body.id !== 'string' || !body.id.trim()) throw new core.AtbError('缺少 id：重派必须绑定咨询单');
    const mode = body.mode;
    if (mode !== 'zcode' && mode !== 'codex') throw new core.AtbError(`mode 必须是 zcode 或 codex（得到：${mode}）`);
    if (mode === 'codex') {
      const cli = resolveOncallCli(dataDir);
      if (!cli) throw new core.AtbError('codex CLI 未就绪：请先完成运行环境检查后重试');
    }
    const staff = typeof body.staff === 'string' ? body.staff : '';
    const r = oncall.redispatchTicket(dataDir, body.id, { mode, staff, by: 'board' });
    const sessionName = oncall.oncallSessionName({ staff: r.staff });
    if (mode === 'codex') {
      const runner = oncallRunnerFor(root);
      const t = oncall.getTicket(dataDir, body.id);
      const prompt = oncall.buildOncallWorkerPrompt(dataDir, body.id);
      const run = oncall.newOncallRun(dataDir, {
        ticketId: body.id, roundNo: t.rounds.length, projectRoot: root,
        prompt, staff: r.staff, by: sessionName,
        config: dispatchStore.loadSettings(dataDir).codex,
      });
      runner.enqueue(run.runId);
      return sendJson(res, 200, { ok: true, mode, dispatched: r.dispatched, staff: r.staff, sessionName, runId: run.runId });
    }
    return sendJson(res, 200, { ok: true, mode, dispatched: r.dispatched, staff: r.staff, sessionName, prompt: r.prompt });
  }

  if (req.method === 'GET' && pathname === '/api/oncall/dispatch/records') {
    const records = oncall.listDispatches(dataDir).map((rec) => {
      // codex 派单附带最新执行状态（失败原因/回传情况展示；zcode 回传在单据轮次上）
      const latest = rec.mode === 'codex'
        ? oncall.listOncallRuns(dataDir).find((r) => rec.ids.includes(r.ticketId)) || null
        : null;
      return { ...rec, run: latest ? { runId: latest.runId, phase: latest.phase, endedAt: latest.endedAt, result: latest.result } : null };
    });
    return sendJson(res, 200, { records });
  }

  return null;
}

// REQ-20260909-003 需求文档引用讨论：启动/收尾提示词、引用快照、纪要归档与说明同步。
// 独立 DISC 序列，不进 REQ/BUG 状态机、不改需求状态；看板不感知 Agent 在线状态，
// 成果一律经 PUBLISH.json 发布协议由 readOutcome 检测。
async function handleReqDiscApi(req, res, u, pathname, root, dataDir) {
  if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);

  // 需求当前讨论全量状态（需求抽屉区块数据源；随主轮询拉取即自动检测发布）
  if (req.method === 'GET' && pathname === '/api/req-disc') {
    const reqId = String(u.searchParams.get('req') || '').trim();
    if (!reqId) throw new core.AtbError('缺少 req：需传入需求编号（REQ-…）');
    return sendJson(res, 200, { discussion: reqdisc.discussionFull(dataDir, reqId) });
  }

  // 开始讨论：创建唯一讨论编号并绑定需求，返回启动提示词
  if (req.method === 'POST' && pathname === '/api/req-disc/start') {
    const body = JSON.parse((await readBody(req)) || '{}');
    const meta = reqdisc.createDiscussion(dataDir, { reqId: body.reqId, by: 'board' });
    return sendJson(res, 200, { discussion: reqdisc.discussionFull(dataDir, meta.reqId) });
  }

  const actionMatch = pathname.match(/^\/api\/req-disc\/(DISC-\d{8}-\d{3})\/(finish|continue|quote|archive|apply)$/);
  if (actionMatch && req.method === 'POST') {
    const [, id, action] = actionMatch;
    const body = JSON.parse((await readBody(req)) || '{}');
    if (action === 'finish') {
      reqdisc.requestFinish(dataDir, id, { by: 'board' });
    } else if (action === 'continue') {
      reqdisc.continueDiscussion(dataDir, id, { by: 'board' });
    } else if (action === 'quote') {
      reqdisc.saveQuote(dataDir, id, {
        doc: body.doc, startLine: body.startLine, endLine: body.endLine,
        version: body.version, text: body.text, by: 'board',
      });
    } else if (action === 'archive') {
      reqdisc.archiveRound(dataDir, id, { by: 'board' });
    } else {
      const applied = reqdisc.applyDraft(dataDir, id, { selected: body.selected, by: 'board' });
      return sendJson(res, 200, { applied, discussion: reqdisc.discussionFull(dataDir, reqdisc.getDiscussion(dataDir, id).reqId) });
    }
    return sendJson(res, 200, { discussion: reqdisc.discussionFull(dataDir, reqdisc.getDiscussion(dataDir, id).reqId) });
  }

  return null;
}

// REQ-20260909-004 开放式讨论模块：两态列表、创建、启动/收尾提示词、纪要读取、
// 候选需求/Bug 创建与归档。沿用 ASK 序列（oncall/tickets），不进 REQ/BUG 状态机。
async function handleDiscussionApi(req, res, u, pathname, root, dataDir) {
  // board：未初始化项目返回空态（前端引导初始化）
  if (req.method === 'GET' && pathname === '/api/discussion/board') {
    if (!dataDir) return sendJson(res, 200, { initialized: false, discussions: [] });
    return sendJson(res, 200, { initialized: true, discussions: oncall.listDiscussions(dataDir) });
  }
  if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);

  if (req.method === 'POST' && pathname === '/api/discussion') {
    const body = JSON.parse((await readBody(req)) || '{}');
    const meta = oncall.createDiscussion(dataDir, {
      title: body.title,
      background: body.background == null ? '' : body.background,
      by: 'board',
      // REQ-20260910-028：截图随创建一次提交（形态与 /api/new 一致）；store 层先全量校验
      // （张数/白名单/8MB/防穿越）再占号落盘，任一非法整单拒绝（400）不留半成品
      attachments: Array.isArray(body.attachments) ? body.attachments : [],
    });
    return sendJson(res, 200, { discussion: oncall.discussionFull(dataDir, meta.id) });
  }

  // REQ-20260910-028：讨论截图附件原始字节（详情背景内联展示用）。口径与
  // /api/oncall/ticket/:id/attachment/:name（同一 readAttachment 真源）及 /api/fs/raw 一致：
  // 白名单图片 MIME + nosniff + 收敛 CSP + no-store + 8MB 在线展示上限。
  const discAttMatch = pathname.match(/^\/api\/discussion\/(ASK-\d{8}-\d{3})\/attachment\/([^/]+)$/);
  if (discAttMatch && req.method === 'GET') {
    const name = decodeURIComponent(discAttMatch[2]);
    const mime = oncall.attachmentMime(name);
    if (!mime) throw new core.AtbError(`仅支持图片附件预览：${name}`);
    let buf;
    try {
      buf = oncall.readAttachment(dataDir, discAttMatch[1], name); // 归属/防穿越/8MB 在此校验（400 业务错误）
    } catch (e) {
      throw new core.AtbError(e.message);
    }
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': buf.length,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      'Cache-Control': 'no-store',
    });
    res.end(buf);
    return { streamed: true };
  }

  const idMatch = pathname.match(/^\/api\/discussion\/(ASK-\d{8}-\d{3})$/);
  if (idMatch && req.method === 'GET') {
    return sendJson(res, 200, { discussion: oncall.discussionFull(dataDir, idMatch[1]) });
  }

  const actionMatch = pathname.match(/^\/api\/discussion\/(ASK-\d{8}-\d{3})\/(finish|reread|archive|resume|create-items)$/);
  if (actionMatch && req.method === 'POST') {
    const [, id, action] = actionMatch;
    const body = JSON.parse((await readBody(req)) || '{}');
    if (action === 'create-items') {
      const r = oncall.createItems(dataDir, id, { items: Array.isArray(body.items) ? body.items : [], by: 'board' });
      return sendJson(res, 200, { results: r.results, discussion: oncall.discussionFull(dataDir, id) });
    }
    if (action === 'finish') oncall.requestFinish(dataDir, id, { by: 'board' });
    else if (action === 'archive') oncall.archiveDiscussion(dataDir, id, { by: 'board' });
    else if (action === 'resume') oncall.resumeDiscussion(dataDir, id, { by: 'board' });
    else oncall.readOutcome(dataDir, id); // reread：显式重读（发布协议校验 + 幂等盖章）
    return sendJson(res, 200, { discussion: oncall.discussionFull(dataDir, id) });
  }

  return null;
}

// REQ-20260910-019 营销模块接口（绑定 ?project=）：
//   GET  /api/marketing/state            两态读取（未初始化营销 / 未初始化看板 → initialized:false）
//   POST /api/marketing/init             显式初始化（读 README 仅形成草稿）
//   POST /api/marketing/profile          保存定位+证据（revision 乐观锁：过期 409）
//   POST /api/marketing/pricing          保存为定价新版本（永不覆盖、不自动成为当前）
//   POST /api/marketing/pricing/current  显式「设为当前方案」
// REQ-20260910-020 渠道与行动看板：
//   GET  /api/marketing/board            渠道 / 实验 / 行动集合（未初始化营销 → initialized:false）
//   POST /api/marketing/channel          新建渠道（可编辑空模板由前端提供）
//   POST /api/marketing/channel/save     更新渠道（revision 乐观锁：过期 409）
//   POST /api/marketing/experiment       新建实验（币种 / 零预算 / 定价版本绑定）
//   POST /api/marketing/experiment/save  更新实验（revision 乐观锁）
//   POST /api/marketing/experiment/copy  复制为新实验（新 ID + 来源；行动置草稿）
//   POST /api/marketing/activity         新建行动（渠道 / 实验 / 计划时间与时区）
//   POST /api/marketing/activity/save    更新行动字段（revision 乐观锁；状态不变量保护）
//   POST /api/marketing/activity/status  状态推进（链式下一步 / 停止；缺失凭据 → 400 fields）
//   POST /api/marketing/activity/correct 误操作更正（仅回退，记录原因与历史）
//   POST /api/marketing/activity/req     创建开发需求（submitted + 双向关联 + key 幂等重试）
// REQ-20260910-021 效果与复盘：
//   GET  /api/marketing/effect           指标卡片 / 派生 / 观察 / 复盘（?from&to&channel&experiment 筛选）
//   GET  /api/marketing/import/template  CSV 模板（UTF-8 text/csv 文本）
//   POST /api/marketing/metric           自定义指标定义（追加不覆盖；key / 名称唯一）
//   POST /api/marketing/observation      手工录入观察（同键同值幂等；修订需理由 → 400 fields）
//   POST /api/marketing/import/preview   CSV 预览校验（行级错误 / 冲突，不写盘）
//   POST /api/marketing/import/commit    CSV 原子提交（错误行 400；冲突行需 choices 修订或跳过）
//   POST /api/marketing/review           新建复盘（保存时固定观察快照；无数据须标数据不足）
// REQ-20260910-022 project-growth 工作流（AI 任务面板 / 运行记录 / 草稿采纳）：
//   GET  /api/marketing/growth            运行记录列表 + 技能可用性（未安装 → 列能力缺口）
//   POST /api/marketing/growth/run        创建任务并返回可复制提示词（type；review 需 from/to；continueOf 接续）
//   GET  /api/marketing/growth/run/:id    运行详情（含提示词留档与草稿；未知 404）
//   POST /api/marketing/growth/run/edit   编辑候选（title/verify/reason，保存回草稿）
//   POST /api/marketing/growth/run/adopt  显式采纳候选（经既有营销数据层落地；幂等）
//   POST /api/marketing/growth/run/keep   保留草稿（不写入正式档案）
//   回执不经 HTTP 由外部会话写入，走统一 CLI：atb growth receipt <ID> --file <draft.json> --dir <项目根>
async function handleMarketingApi(req, res, u, pathname, root, dataDir) {
  if (req.method === 'GET' && pathname === '/api/marketing/state') {
    // 无营销目录 / 未初始化看板：空态引导（项目可正常打开，历史项目不需迁移）
    if (!dataDir) return sendJson(res, 200, { initialized: false });
    return sendJson(res, 200, marketing.readState(dataDir));
  }
  if (req.method === 'GET' && pathname === '/api/marketing/board') {
    if (!dataDir) return sendJson(res, 200, { initialized: false });
    return sendJson(res, 200, marketing.readBoard(dataDir));
  }
  if (req.method === 'GET' && pathname === '/api/marketing/growth') {
    if (!dataDir) return sendJson(res, 200, growth.readGrowth(null));
    return sendJson(res, 200, growth.readGrowth(dataDir));
  }
  if (req.method === 'GET' && pathname === '/api/marketing/growth/inputs') {
    // 任务面板「将使用的项目资料」预览（按入口类型 + 复盘观察期实时采集，空项目 → 仅 README）
    if (!dataDir) return sendJson(res, 200, { initialized: false, inputs: [{ ref: 'README.md', revision: null }] });
    const q = u.searchParams;
    const type = q.get('type') || 'positioning';
    try {
      const obs = q.get('from') && q.get('to') ? { from: q.get('from'), to: q.get('to') } : null;
      return sendJson(res, 200, { initialized: true, inputs: growth.collectGrowthInputs(dataDir, { type, observation: obs }) });
    } catch (e) {
      if (e.fields) return sendJson(res, 400, { error: e.message, fields: e.fields });
      throw e;
    }
  }
  if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);

  // REQ-20260910-020：看板写操作统一分流（409 冲突 / 400 字段定位 / 其余 400 AtbError）
  const boardPost = async (fn) => {
    const body = JSON.parse((await readBody(req)) || '{}');
    try {
      return await fn(body);
    } catch (e) {
      if (e instanceof marketing.MarketingConflictError) {
        return sendJson(res, 409, { error: e.message, conflict: true, currentRevision: e.currentRevision });
      }
      if (e.fields) return sendJson(res, 400, { error: e.message, fields: e.fields });
      throw e;
    }
  };
  if (req.method === 'POST' && pathname === '/api/marketing/channel') {
    return boardPost((body) => sendJson(res, 201, marketing.createChannel(dataDir, { data: body.data, by: 'board' })));
  }
  if (req.method === 'POST' && pathname === '/api/marketing/channel/save') {
    return boardPost((body) => sendJson(res, 200, marketing.saveChannel(dataDir, {
      id: body.id, revision: body.revision, data: body.data, by: 'board',
    })));
  }
  if (req.method === 'POST' && pathname === '/api/marketing/experiment') {
    return boardPost((body) => sendJson(res, 201, marketing.createExperiment(dataDir, { data: body.data, by: 'board' })));
  }
  if (req.method === 'POST' && pathname === '/api/marketing/experiment/save') {
    return boardPost((body) => sendJson(res, 200, marketing.saveExperiment(dataDir, {
      id: body.id, revision: body.revision, data: body.data, by: 'board',
    })));
  }
  if (req.method === 'POST' && pathname === '/api/marketing/experiment/copy') {
    return boardPost((body) => sendJson(res, 201, marketing.copyExperiment(dataDir, {
      id: body.id, fromActivityId: body.fromActivityId, by: 'board',
    })));
  }
  if (req.method === 'POST' && pathname === '/api/marketing/activity') {
    return boardPost((body) => sendJson(res, 201, marketing.createActivity(dataDir, { data: body.data, by: 'board' })));
  }
  if (req.method === 'POST' && pathname === '/api/marketing/activity/save') {
    return boardPost((body) => sendJson(res, 200, marketing.saveActivity(dataDir, {
      id: body.id, revision: body.revision, data: body.data, by: 'board',
    })));
  }
  if (req.method === 'POST' && pathname === '/api/marketing/activity/status') {
    return boardPost((body) => sendJson(res, 200, marketing.setActivityStatus(dataDir, {
      id: body.id, revision: body.revision, to: body.to, payload: body.payload || {}, by: 'board',
    })));
  }
  if (req.method === 'POST' && pathname === '/api/marketing/activity/correct') {
    return boardPost((body) => sendJson(res, 200, marketing.correctActivityStatus(dataDir, {
      id: body.id, revision: body.revision, to: body.to, reason: body.reason, by: 'board',
    })));
  }
  if (req.method === 'POST' && pathname === '/api/marketing/activity/req') {
    // 创建成功 201；同 key 幂等重试命中 200（不重复创建 REQ）
    return boardPost(async (body) => {
      const r = await marketing.linkActivityReq(dataDir, {
        id: body.id, key: body.key, title: body.title, description: body.description, by: 'board',
      });
      return sendJson(res, r.created ? 201 : 200, r);
    });
  }

  // REQ-20260910-022 project-growth：任务创建 / 详情 / 候选处理（409 / 400 映射沿用 boardPost）
  if (req.method === 'POST' && pathname === '/api/marketing/growth/run') {
    return boardPost((body) => {
      const r = growth.createAgentRun(dataDir, {
        projectRoot: root,
        atbPath: ATB_CLI,
        type: body.type,
        observation: body.from && body.to ? { from: body.from, to: body.to } : null,
        continueOf: body.continueOf || null,
        by: 'board',
      });
      return sendJson(res, 201, r);
    });
  }
  const growthRunMatch = pathname.match(/^\/api\/marketing\/growth\/run\/([^/]+)$/);
  if (growthRunMatch && req.method === 'GET') {
    try {
      return sendJson(res, 200, growth.readAgentRun(dataDir, decodeURIComponent(growthRunMatch[1])));
    } catch (e) {
      if (e instanceof core.AtbError && /不存在/.test(e.message)) return sendJson(res, 404, { error: e.message });
      throw e;
    }
  }
  if (req.method === 'POST' && pathname === '/api/marketing/growth/run/edit') {
    return boardPost((body) => sendJson(res, 200, growth.editAgentRunCandidate(dataDir, {
      id: body.id, candidateId: body.candidateId, data: body.data || {}, by: 'board',
    })));
  }
  if (req.method === 'POST' && pathname === '/api/marketing/growth/run/adopt') {
    return boardPost((body) => sendJson(res, 200, growth.adoptAgentRunCandidate(dataDir, {
      id: body.id, candidateId: body.candidateId, data: body.data || null, by: 'board',
    })));
  }
  if (req.method === 'POST' && pathname === '/api/marketing/growth/run/keep') {
    return boardPost((body) => sendJson(res, 200, growth.keepAgentRunCandidate(dataDir, {
      id: body.id, candidateId: body.candidateId, by: 'board',
    })));
  }

  if (req.method === 'GET' && pathname === '/api/marketing/effect') {
    // 两态读取：未初始化营销 / 未初始化看板 → initialized:false（项目可正常打开）
    if (!dataDir) return sendJson(res, 200, { initialized: false });
    const q = u.searchParams;
    return sendJson(res, 200, marketing.readEffect(dataDir, {
      from: q.get('from') || null,
      to: q.get('to') || null,
      channelId: q.get('channel') || null,
      experimentId: q.get('experiment') || null,
    }));
  }
  if (req.method === 'GET' && pathname === '/api/marketing/import/template') {
    // 模板为纯文本 CSV（前端下载后按 UTF-8 填写）；返回 truthy 表示已应答
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(marketing.importTemplateCsv());
    return true;
  }

  // REQ-20260910-021：效果页写操作（400 字段定位 / 409 冲突沿用 boardPost）
  if (req.method === 'POST' && pathname === '/api/marketing/metric') {
    return boardPost((body) => sendJson(res, 201, marketing.addMetricDefinition(dataDir, { data: body.data, by: 'board' })));
  }
  if (req.method === 'POST' && pathname === '/api/marketing/observation') {
    return boardPost(async (body) => {
      const r = marketing.recordObservation(dataDir, { data: body.data, by: 'board' });
      return sendJson(res, r.created ? 201 : 200, r);
    });
  }
  if (req.method === 'POST' && pathname === '/api/marketing/import/preview') {
    return boardPost((body) => sendJson(res, 200, marketing.previewImportCsv(dataDir, {
      csv: body.csv, mapping: body.mapping || null,
    })));
  }
  if (req.method === 'POST' && pathname === '/api/marketing/import/commit') {
    return boardPost((body) => sendJson(res, 200, marketing.commitImportCsv(dataDir, {
      csv: body.csv, mapping: body.mapping || null, choices: body.choices || {}, by: 'board',
    })));
  }
  if (req.method === 'POST' && pathname === '/api/marketing/review') {
    return boardPost((body) => sendJson(res, 201, marketing.createReview(dataDir, { data: body.data, by: 'board' })));
  }

  if (req.method === 'POST' && pathname === '/api/marketing/init') {
    const profile = marketing.initProfile(dataDir, { projectRoot: root, by: 'board' });
    return sendJson(res, 201, marketing.readState(dataDir));
  }
  if (req.method === 'POST' && pathname === '/api/marketing/profile') {
    const body = JSON.parse((await readBody(req)) || '{}');
    try {
      return sendJson(res, 200, marketing.saveProfile(dataDir, {
        revision: body.revision,
        positioning: body.positioning,
        evidence: Array.isArray(body.evidence) ? body.evidence : [],
        by: 'board',
      }));
    } catch (e) {
      if (e instanceof marketing.MarketingConflictError) {
        return sendJson(res, 409, { error: e.message, conflict: true, currentRevision: e.currentRevision });
      }
      if (e.fields) return sendJson(res, 400, { error: e.message, fields: e.fields });
      throw e;
    }
  }
  if (req.method === 'POST' && pathname === '/api/marketing/pricing') {
    const body = JSON.parse((await readBody(req)) || '{}');
    try {
      const r = marketing.savePricing(dataDir, { data: body, by: 'board' });
      return sendJson(res, 201, r);
    } catch (e) {
      if (e.fields) return sendJson(res, 400, { error: e.message, fields: e.fields });
      throw e;
    }
  }
  if (req.method === 'POST' && pathname === '/api/marketing/pricing/current') {
    const body = JSON.parse((await readBody(req)) || '{}');
    return sendJson(res, 200, marketing.setCurrentPricing(dataDir, { version: body.version, by: 'board' }));
  }
  return null;
}

// REQ-20260910-029 发布模块接口（绑定 ?project=）：
//   GET  /api/release/state            列表 + 环境摘要（未初始化看板 → initialized:false）
//   GET  /api/release/targets          新建面板数据源（git remotes/分支、Apple 工程与 ASC 配置情况，脱敏）
//   POST /api/release/run              创建草稿（target + config；非可执行类型 400）
//   POST /api/release/run/save         更新草稿配置（仅 draft 可改）
//   POST /api/release/run/precheck     只跑只读阶段（Git 1–5 含 dry-run / Apple 1–3），不 push 不上传
//   POST /api/release/run/start        校验互斥与计划新鲜度后启动执行（异步推进，逐阶段持久化）
//   POST /api/release/run/retry        重试失败 / 中断阶段（只重跑未完成操作；Apple 先查询已有上传/版本）
//   POST /api/release/run/cancel       取消后续阶段（已发送到远端的操作不宣称撤回，取消后仍核对结果）
//   POST /api/release/run/refresh      重新查询外部真实状态（Git verify / Apple track），只读不重复执行
//   GET  /api/release/run/:id          运行详情（含阶段、日志、产物、操作历史；未知 404）
//   POST /api/release/sku              持久化 Bundle ID → SKU 映射

// 本进程内正在执行的发布运行（服务重启后无执行器 → running 阶段标记 interrupted 可重试）
const releaseActive = new Map();
const appleAdapter = createRealAppleAdapter();

function releaseRecover(dataDir) {
  try {
    releaseStore.recoverInterrupted(dataDir, { skipIds: [...releaseActive.keys()] });
  } catch { /* 数据目录异常不阻塞读取 */ }
}

function kickReleaseRun(dataDir, root, run, opts = {}) {
  releaseActive.set(run.id, { target: run.target, at: Date.now() });
  const exec = realGitExec();
  const cfg = releaseStore.readModuleConfig(dataDir);
  const p = run.target === 'git'
    ? runGitPipeline({ dataDir, projectRoot: root, runId: run.id, exec, cfg, ...opts })
    : run.target === 'electron'
      ? runElectronPipeline({ dataDir, projectRoot: root, runId: run.id, exec, cfg, ...opts })
      : runApplePipeline({ dataDir, projectRoot: root, runId: run.id, adapter: appleAdapter, exec, ...opts });
  p.catch(() => { /* 驱动内部已按阶段落盘；此处兜底防止未处理拒绝 */ })
    .finally(() => releaseActive.delete(run.id));
  return p;
}

function gitEnvSummary(root) {
  const r = (args) => {
    const x = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 15000 });
    return x.status === 0 ? x.stdout.trim() : null;
  };
  const repo = r(['rev-parse', '--is-inside-work-tree']) === 'true';
  return {
    repo,
    remotes: repo ? (r(['remote']) || '').split('\n').filter(Boolean) : [],
    currentBranch: repo ? (r(['symbolic-ref', '--short', 'HEAD']) || null) : null,
  };
}

async function handleReleaseApi(req, res, u, pathname, root, dataDir) {
  const notFound = () => sendJson(res, 404, { error: `未知接口：${req.method} ${pathname}` });
  if (req.method === 'GET' && pathname === '/api/release/state') {
    if (!dataDir) return sendJson(res, 200, { initialized: false });
    releaseRecover(dataDir);
    const cfg = releaseStore.readModuleConfig(dataDir);
    const appleRepo = cfg.appleRepoPaths?.appInfoRepo || '/Users/adichou/Documents/src/app-info-repo';
    const ascConfigured = fs.existsSync(path.join(os.homedir(), '.appstoreconnect', 'config.json'));
    // REQ-20260910-030 桌面应用（Electron）环境摘要（只读，供空态指引与新建面板默认值）
    const elProj = readElectronProject(root);
    const npmV = spawnSync('npm', ['-v'], { encoding: 'utf8', timeout: 15000 });
    const nodeV = spawnSync('node', ['-v'], { encoding: 'utf8', timeout: 15000 });
    return sendJson(res, 200, {
      initialized: true,
      runs: releaseStore.listRuns(dataDir),
      env: {
        git: gitEnvSummary(root),
        apple: {
          ascConfigured,
          appRepoExists: fs.existsSync(appleRepo),
          xcode: fs.existsSync('/usr/bin/xcodebuild'),
        },
        electron: {
          packageJson: elProj.packageJson,
          appName: elProj.appName,
          version: elProj.version,
          mainOk: elProj.mainOk,
          depsOk: elProj.depsOk,
          buildConfigOk: elProj.buildConfigOk,
          nodeOk: nodeV.status === 0,
          npmOk: npmV.status === 0,
          macArchDefault: process.arch === 'x64' ? 'x64' : 'arm64',
        },
      },
    });
  }
  if (req.method === 'GET' && pathname === '/api/release/targets') {
    if (!dataDir) return sendJson(res, 200, { initialized: false, git: { repo: false, remotes: [], branches: [] }, electron: null });
    const gitEnv = gitEnvSummary(root);
    let branches = [];
    if (gitEnv.repo) {
      const x = spawnSync('git', ['branch', '--format=%(refname:short)'], { cwd: root, encoding: 'utf8', timeout: 15000 });
      if (x.status === 0) branches = x.stdout.trim().split('\n').filter(Boolean);
    }
    let appleProjects = [];
    try {
      appleProjects = fs.readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .flatMap((d) => fs.readdirSync(path.join(root, d.name), { withFileTypes: true })
          .filter((f) => f.name.endsWith('.xcodeproj') || f.name.endsWith('.xcworkspace'))
          .map((f) => path.join(d.name, f.name)))
        .concat(fs.readdirSync(root, { withFileTypes: true })
          .filter((f) => f.name.endsWith('.xcodeproj') || f.name.endsWith('.xcworkspace'))
          .map((f) => f.name));
    } catch { /* 不可读目录 → 空列表 */ }
    const elDefaults = readElectronProject(root);
    return sendJson(res, 200, {
      initialized: true,
      git: { ...gitEnv, branches },
      apple: { projects: [...new Set(appleProjects)].slice(0, 50) },
      electron: { appName: elDefaults.appName, defaultVersion: elDefaults.version, macArchDefault: process.arch === 'x64' ? 'x64' : 'arm64', platforms: ['mac', 'win'] },
    });
  }
  if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);

  const runPost = async (fn) => {
    const body = JSON.parse((await readBody(req)) || '{}');
    try {
      return await fn(body);
    } catch (e) {
      if (e instanceof releaseStore.ReleaseConflictError) {
        return sendJson(res, 409, { error: e.message, conflict: true, activeRunId: e.activeRunId });
      }
      if (e instanceof core.AtbError && /找不到发布运行/.test(e.message)) {
        return sendJson(res, 404, { error: e.message });
      }
      if (e.fields) return sendJson(res, 400, { error: e.message, fields: e.fields });
      throw e;
    }
  };

  if (req.method === 'POST' && pathname === '/api/release/run') {
    return runPost((body) => {
      const run = releaseStore.createRun(dataDir, { target: body.target, config: body.config || {}, by: 'board' });
      return sendJson(res, 201, { run });
    });
  }
  if (req.method === 'POST' && pathname === '/api/release/run/save') {
    return runPost((body) => {
      const run = releaseStore.readRun(dataDir, body.id);
      if (run.status !== 'draft') throw new core.AtbError('仅草稿状态可修改配置（执行中配置不可变；失败后请新建运行）');
      releaseStore.validateRunConfig(run.target, body.config || {});
      return sendJson(res, 200, { run: releaseStore.mutateRun(dataDir, body.id, (r) => {
        r.config = body.config;
      }, { by: 'board', action: 'save-config' }) });
    });
  }
  const releaseRunMatch = pathname.match(/^\/api\/release\/run\/(REL-\d{8}-\d{3})$/);
  if (releaseRunMatch && req.method === 'GET') {
    return runPost(async () => {
      releaseRecover(dataDir);
      const run = releaseStore.readRun(dataDir, releaseRunMatch[1]);
      return sendJson(res, 200, { run, logs: releaseStore.readRunLogs(dataDir, run.id) });
    });
  }
  if (req.method === 'POST' && pathname === '/api/release/run/precheck') {
    return runPost((body) => {
      const run = releaseStore.readRun(dataDir, body.id);
      if (!['draft', 'failed'].includes(run.status)) {
        throw new core.AtbError(`当前状态（${releaseStore.RUN_STATUS_LABEL[run.status] || run.status}）不可预检`);
      }
      releaseStore.assertTargetFree(dataDir, run.target, { exceptId: run.id });
      if (run.status === 'failed') {
        releaseStore.mutateRun(dataDir, run.id, (r) => releaseStore.resetForRetry(r), { by: 'board', action: 'retry' });
      }
      // 预检只跑只读阶段：Git 1–5 含 dry-run / Apple 1–3 / Electron freeze + 本地预检（不安装不构建）
      kickReleaseRun(dataDir, root, run, run.target === 'git' ? { through: 'plan' } : run.target === 'electron' ? { through: 'local-precheck' } : { through: 'materials' });
      return sendJson(res, 200, { run: releaseStore.readRun(dataDir, run.id) });
    });
  }
  if (req.method === 'POST' && pathname === '/api/release/run/start') {
    return runPost((body) => {
      const run = releaseStore.readRun(dataDir, body.id);
      if (!['draft', 'failed'].includes(run.status)) {
        throw new core.AtbError(`当前状态（${releaseStore.RUN_STATUS_LABEL[run.status] || run.status}）不可启动`);
      }
      releaseStore.assertTargetFree(dataDir, run.target, { exceptId: run.id });
      if (run.status === 'failed') {
        releaseStore.mutateRun(dataDir, run.id, (r) => releaseStore.resetForRetry(r), { by: 'board', action: 'retry' });
      }
      kickReleaseRun(dataDir, root, run);
      return sendJson(res, 200, { run: releaseStore.readRun(dataDir, run.id) });
    });
  }
  if (req.method === 'POST' && pathname === '/api/release/run/retry') {
    return runPost((body) => {
      const run = releaseStore.readRun(dataDir, body.id);
      if (run.status !== 'failed') {
        throw new core.AtbError(`仅失败运行可重试（当前 ${releaseStore.RUN_STATUS_LABEL[run.status] || run.status}）`);
      }
      const failedStage = run.stages.find((s) => s.status === 'failed');
      if (failedStage && failedStage.error && failedStage.error.kind === 'rejected') {
        throw new core.AtbError('审核被拒不可原地重试：请启动修订版本（新运行将关联原运行）');
      }
      releaseStore.assertTargetFree(dataDir, run.target, { exceptId: run.id });
      releaseStore.mutateRun(dataDir, run.id, (r) => releaseStore.resetForRetry(r), { by: 'board', action: 'retry' });
      kickReleaseRun(dataDir, root, run);
      return sendJson(res, 200, { run: releaseStore.readRun(dataDir, run.id) });
    });
  }
  if (req.method === 'POST' && pathname === '/api/release/run/cancel') {
    return runPost((body) => {
      const run = releaseStore.readRun(dataDir, body.id);
      if (['succeeded', 'canceled'].includes(run.status)) {
        return sendJson(res, 200, { run }); // 幂等：已取消/已成功不再变化
      }
      // 已发送到远端的操作不宣称撤回：取消只停止后续阶段，取消后仍可「刷新状态」核对外部结果
      const canceled = releaseStore.mutateRun(dataDir, run.id, (r) => releaseStore.cancelRemaining(r, body.reason || ''), { by: 'board', action: 'cancel' });
      return sendJson(res, 200, { run: canceled });
    });
  }
  if (req.method === 'POST' && pathname === '/api/release/run/refresh') {
    return runPost(async (body) => {
      const run = releaseStore.readRun(dataDir, body.id);
      if (run.target === 'apple') {
        return sendJson(res, 200, { run: await runApplePipeline({ dataDir, projectRoot: root, runId: run.id, adapter: appleAdapter, refreshTrack: true }) });
      }
      // Git / Electron 刷新：前置阶段已完成时只重跑 verify（Git 读远端实际 ref / Electron 重新核验产物），只读不重复执行
      const verifyIdx = run.stages.findIndex((s) => s.key === 'verify');
      const beforeOk = verifyIdx > 0 && run.stages.slice(0, verifyIdx).every((s) => s.status === 'done' || s.status === 'skipped');
      if (!beforeOk) return sendJson(res, 200, { run });
      if (run.target === 'electron') {
        return sendJson(res, 200, { run: await runElectronPipeline({ dataDir, projectRoot: root, runId: run.id, exec: realGitExec(), through: 'verify', from: 'verify' }) });
      }
      return sendJson(res, 200, { run: await runGitPipeline({ dataDir, projectRoot: root, runId: run.id, exec: realGitExec(), through: 'verify', from: 'verify' }) });
    });
  }
  if (req.method === 'POST' && pathname === '/api/release/sku') {
    return runPost((body) => sendJson(res, 200, releaseStore.saveSkuMapping(dataDir, {
      bundleId: body.bundleId, sku: body.sku, isDefault: body.isDefault === true,
    })));
  }
  return notFound();
}


// REQ-20260913-001 构建模块接口（版本管理 + 分支浏览与同步；绑定 ?project=）：
//   GET  /api/build/state             汇总：initialized / isRepo / currentBranch / versions（merging 恢复后读取）
//   GET  /api/build/candidates        条目 ↔ commit 候选（core.listItems ∪ itemCommitStatusIndex；
//                                    BUG-20260913-001：仅已完成 done 条目进入候选）
//   GET  /api/build/branches          分支列表：current / local[] / remote[]（origin/xxx 短名）
//   GET  /api/build/branch-log        指定分支最近提交（≤50 条：hash/short/subject/author/date）
//   POST /api/build/version           创建版本计划（至少一个条目，每条带 40 位 commit；
//                                    BUG-20260913-001：非 done 条目拒绝纳入）
//   POST /api/build/version/save      编辑版本名称与描述（merging 锁定）
//   POST /api/build/version/items     条目增删与换选 commit（add / remove / commit；merging/merged 锁增删）
//   POST /api/build/version/merge     合并入 main（显式确认后调用；临时工作树逐条 --no-ff，不触碰当前工作区）
//   POST /api/build/version/delete    删除版本（REQ-20260913-004 显式确认后调用；draft/failed/merged 可删，
//                                    merging 409 拒绝；整目录移除，前端删除后统一刷新）
//   POST /api/build/fetch             同步远端（fetch --all --prune）
//   POST /api/build/push              推送本地分支（未建立上游时首推 -u 建立跟踪）
async function handleBuildApi(req, res, u, pathname, root, dataDir) {
  const notFound = () => sendJson(res, 404, { error: `未知接口：${req.method} ${pathname}` });
  // 冲突类（409）：合并重入 / 锁定态操作 / release git 运行互斥
  const runPost = async (fn) => {
    const body = JSON.parse((await readBody(req)) || '{}');
    try {
      return await fn(body);
    } catch (e) {
      if (e instanceof buildStore.BuildConflictError || e instanceof releaseStore.ReleaseConflictError) {
        return sendJson(res, 409, { error: e.message, conflict: true });
      }
      throw e; // AtbError → 外层统一 400；其余 → 500
    }
  };
  const requireBoard = () => {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    return dataDir;
  };

  if (req.method === 'GET' && pathname === '/api/build/state') {
    if (!dataDir) return sendJson(res, 200, { initialized: false });
    try { buildStore.recoverMerging(dataDir); } catch { /* 数据目录异常不阻塞读取 */ }
    const branches = buildGit.listBranches(root);
    return sendJson(res, 200, {
      initialized: true,
      isRepo: branches.isRepo,
      currentBranch: branches.current,
      versions: buildStore.listVersions(dataDir),
      statusLabels: buildStore.VERSION_STATUS_LABEL,
    });
  }
  if (req.method === 'GET' && pathname === '/api/build/candidates') {
    const board = requireBoard();
    const idx = gitFlow.itemCommitStatusIndex(board, root);
    // BUG-20260913-001：仅已完成（done）条目可纳入版本——候选在数据源头收窄，
    // 「新建版本」与「添加条目」两面板共用本接口，口径保持一致。
    const items = core.listItems(board)
      .filter((it) => it.status === 'done')
      .map((it) => {
        const rec = idx.get(it.id);
        return {
          itemId: it.id,
          title: it.title || '',
          status: it.status,
          type: it.type,
          commits: rec ? [...rec.commits] : [],
          lastCommittedAt: rec ? rec.lastCommittedAt : null,
        };
      });
    return sendJson(res, 200, { items });
  }
  if (req.method === 'GET' && pathname === '/api/build/branches') {
    return sendJson(res, 200, buildGit.listBranches(root));
  }
  if (req.method === 'GET' && pathname === '/api/build/branch-log') {
    const branch = u.searchParams.get('branch') || '';
    return sendJson(res, 200, buildGit.branchLog(root, branch));
  }
  if (req.method === 'POST' && pathname === '/api/build/version') {
    return runPost(async (body) => {
      const board = requireBoard();
      if (!buildGit.isGitRepo(root)) throw new core.AtbError('项目不是 git 仓库：请先初始化 git（可经 atb init），再创建版本计划');
      const boardItems = new Map(core.listItems(board).map((it) => [it.id, it]));
      const titles = new Map(core.listItems(board).map((it) => [it.id, it.title]));
      const items = Array.isArray(body.items) ? body.items : [];
      for (const it of items) {
        const id = String(it?.itemId || '');
        const boardItem = boardItems.get(id);
        if (!boardItem) {
          throw new core.AtbError(`条目 ${id || '（空）'} 不在本看板中，无法纳入版本`);
        }
        // BUG-20260913-001：与候选口径一致，未完成（非 done）条目拒绝纳入版本（数据口径兜底）
        if (boardItem.status !== 'done') {
          throw new core.AtbError(`条目 ${id} 尚未完成（当前状态：${boardItem.status}）：仅已完成（done）的需求单 / Bug 单可纳入版本计划`);
        }
      }
      const version = buildStore.createVersion(board, {
        name: body.name,
        items: items.map((it) => ({ ...it, title: titles.get(String(it?.itemId || '')) || '' })),
        by: 'board',
      });
      return sendJson(res, 201, { version });
    });
  }
  if (req.method === 'POST' && pathname === '/api/build/version/save') {
    return runPost((body) => {
      const board = requireBoard();
      return sendJson(res, 200, { version: buildStore.saveInfo(board, body.id, { name: body.name, description: body.description }) });
    });
  }
  if (req.method === 'POST' && pathname === '/api/build/version/items') {
    return runPost((body) => {
      const board = requireBoard();
      const v = buildStore.readVersion(board, body.id);
      if (body.action === 'add') {
        const itemsAll = core.listItems(board);
        const byId = new Map(itemsAll.map((it) => [it.id, it]));
        const titles = new Map(itemsAll.map((it) => [it.id, it.title]));
        const items = (Array.isArray(body.items) ? body.items : []).map((it) => ({ ...it, title: titles.get(String(it?.itemId || '')) || v.items.find((x) => x.itemId === it?.itemId)?.title || '' }));
        // BUG-20260913-001：「添加条目」与新建版本同口径——未完成（非 done）条目拒绝加入
        for (const it of items) {
          const boardItem = byId.get(String(it?.itemId || ''));
          if (boardItem && boardItem.status !== 'done') {
            throw new core.AtbError(`条目 ${it?.itemId} 尚未完成（当前状态：${boardItem.status}）：仅已完成（done）的需求单 / Bug 单可纳入版本计划`);
          }
        }
        return sendJson(res, 200, { version: buildStore.addItems(board, body.id, items) });
      }
      if (body.action === 'remove') {
        return sendJson(res, 200, { version: buildStore.removeItems(board, body.id, body.itemIds) });
      }
      if (body.action === 'commit') {
        return sendJson(res, 200, { version: buildStore.setItemCommit(board, body.id, body.itemId, body.commit) });
      }
      throw new core.AtbError('action 必须是 add / remove / commit');
    });
  }
  if (req.method === 'POST' && pathname === '/api/build/version/merge') {
    return runPost((body) => {
      const board = requireBoard();
      const v = buildStore.readVersion(board, body.id);
      if (v.status === 'merging') {
        throw new buildStore.BuildConflictError('版本正在合并中，请勿重复触发');
      }
      if (v.status === 'merged') {
        throw new buildStore.BuildConflictError('版本已合并入 main，无需重复合并');
      }
      // 与发布模块互斥（design.md 落定）：release 有活动 git 目标运行时拒绝合并（读侧校验，不改发布状态）
      releaseStore.assertTargetFree(board, 'git', {});
      // 前置校验（只读，不改版本状态：工作区脏 / main 缺失 / 提交缺失在此明确报 400）
      buildGit.precheckMerge(root, v.items);
      buildStore.beginMerge(board, v.id, { baseBranch: buildGit.listBranches(root).current });
      let version;
      try {
        const r = buildGit.mergeCommitsIntoMain(root, { versionId: v.id, versionName: v.name, items: v.items });
        version = buildStore.finishMerge(board, v.id, { results: r.results });
        version.mergeWarnings = r.warnings || [];
      } catch (e) {
        // 合并执行中异常（如切分支失败）：未覆盖的条目按失败落盘，版本置 failed 可重试
        const done = new Set(v.items.filter((x) => x.mergedAt).map((x) => x.itemId));
        version = buildStore.finishMerge(board, v.id, {
          results: v.items.filter((x) => !done.has(x.itemId)).map((x) => ({ itemId: x.itemId, ok: false, error: String(e.message || e).slice(0, 300) })),
        });
        version.mergeWarnings = [String(e.message || e).slice(0, 300)];
      }
      return sendJson(res, 200, { version });
    });
  }
  // REQ-20260913-004 删除版本：POST + JSON 范式（对齐 /api/batch/delete）。透传数据层结果与
  // 错误（BuildConflictError → 409，经 runPost）；删除后的最新版本状态由前端统一刷新 /state。
  if (req.method === 'POST' && pathname === '/api/build/version/delete') {
    return runPost((body) => {
      const board = requireBoard();
      return sendJson(res, 200, buildStore.deleteVersion(board, String(body.id || '')));
    });
  }
  if (req.method === 'POST' && pathname === '/api/build/fetch') {
    return runPost(() => sendJson(res, 200, buildGit.fetchRemote(root)));
  }
  if (req.method === 'POST' && pathname === '/api/build/push') {
    return runPost((body) => sendJson(res, 200, buildGit.pushBranch(root, { remote: body.remote, branch: body.branch })));
  }
  return notFound();
}

async function handleApi(req, res, u, pathname) {
  // ---- 与项目无关 ----
  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      port: PORT,
      version: '0.1.1',
      // BUG-20260907-017：暴露进程 pid 与启动时间——服务为常驻进程、路由集启动时固化，
      // 静态前端却实时读盘；代码更新后旧进程缺新接口（如 /api/refine/*）而前端已更新，
      // 出现「未知接口」报错。atb serve 据此识别版本过旧并自动重启。
      pid: process.pid,
      startedAt: SERVER_STARTED_AT,
      projects: loadRegistry().projects,
      defaultProject: defaultProjectRoot(),
    });
  }

  // REQ-20260910-003 全局任务看板：聚合全部注册项目「在工作」的批量任务（只读、与 ?project= 无关）。
  // 在工作口径 = unfinishedBatches / unfinishedRefineBatches（status !== finished），再排除已终止
  //（aborted）——已结束/已终止不出现，收尾后下一轮轮询自然移出；单项目读盘失败只影响该项目行。
  if (req.method === 'GET' && pathname === '/api/batch/global') {
    return sendJson(res, 200, { ok: true, projects: aggregateGlobalTasks() });
  }

  // ---------- REQ-20260910-005 项目管理（初始化 / 导入 / 移出） ----------
  // 全部放在 resolveProject 之前：注册表清空（全部移出）的空态下这些入口必须可用，
  // 且不得受 ?project= 隐式登记（removed 闸门）影响——目标一律由 body.path 显式指定。

  if (req.method === 'POST' && pathname === '/api/project/preview') {
    const body = JSON.parse((await readBody(req)) || '{}');
    const abs = resolveProjectPath(body.path);
    const dataDir = core.dataDirFrom(abs);
    const gitRoot = core.gitRootFrom(abs) || abs; // initData 的写入目标口径（git 根优先）
    return sendJson(res, 200, {
      ok: true,
      root: abs, // realpath：子目录 / 符号链接都明确显示解析后的目标
      name: shortProjectDirName(abs),
      dataDir, // 向上解析到的已有数据目录（可能在上级或仓库根），null = 未初始化
      wouldWrite: path.join(gitRoot, core.DATA_REL_DIR), // 初始化将写入的实际位置
      initialized: !!dataDir,
    });
  }

  if (req.method === 'POST' && pathname === '/api/project/remove') {
    const body = JSON.parse((await readBody(req)) || '{}');
    // REQ-20260910-010：放宽存在性校验——目录已不存在的注册记录也可移出（否则失效记录永远清不掉）
    const abs = resolveProjectRemovePath(body.path);
    unregisterProject(abs); // 不在列表中 → AtbError → 400；只改注册表，不触碰磁盘与任务
    const def = defaultProjectRoot(); // 先解析默认（可能重播种），再取一致快照
    return sendJson(res, 200, { ok: true, removed: abs, projects: loadRegistry().projects, defaultProject: def });
  }

  // REQ-20260910-010 目录存在性检测（只读）：逐项分类 + 汇总计数。
  // 不写注册表、不播种默认项目、不解析 ?project=（注册表级接口，空态下也可用）。
  if (req.method === 'POST' && pathname === '/api/project/scan') {
    const reg = loadRegistry();
    const rows = reg.projects.map((root) => ({ path: root, ...classifyProjectRoot(root) }));
    const summary = {
      total: rows.length,
      missing: rows.filter((r) => r.state === 'missing').length,
      error: rows.filter((r) => r.state === 'error').length,
    };
    return sendJson(res, 200, {
      ok: true,
      projects: rows,
      summary,
      defaultProject: reg.projects[0] ?? null, // 纯读取（不触发空表播种，保持检测只读）
    });
  }

  // REQ-20260910-010 批量移出不存在的目录：确认时在服务端逐项重新核实候选——
  // 已恢复存在 / 已不在注册表（其他窗口已移出）/ 状态无法确定 一律跳过并说明原因，
  // 只移出仍判 missing 的候选；绝不扩大到请求范围之外的项目（注册表其他项原样保留）。
  if (req.method === 'POST' && pathname === '/api/project/remove-missing') {
    const body = JSON.parse((await readBody(req)) || '{}');
    const paths = body.paths;
    if (!Array.isArray(paths) || !paths.length) {
      throw new core.AtbError('paths 必须是待移出项目根路径的非空数组');
    }
    for (const p of paths) {
      if (typeof p !== 'string' || !p || !path.isAbsolute(p)) {
        throw new core.AtbError(`paths 中的路径必须是绝对路径，得到：${p}`);
      }
    }
    const registered = new Set(loadRegistry().projects);
    const removed = [];
    const skipped = [];
    const failed = [];
    for (const raw of paths) {
      const root = resolveProjectRemovePath(raw);
      if (!registered.has(root)) {
        skipped.push({ path: root, reason: '不在当前项目列表中（可能已被其他窗口移出）' });
        continue;
      }
      const c = classifyProjectRoot(root);
      if (c.state === 'exists') {
        skipped.push({ path: root, reason: '目录已恢复存在，不再作为不存在目录移出' });
        continue;
      }
      if (c.state === 'error') {
        skipped.push({ path: root, reason: `状态无法确定（${c.reason || '检测失败'}），已跳过` });
        continue;
      }
      try {
        unregisterProject(root); // 仍判 missing → 仅改注册表（projects → removed），不触碰磁盘与任务
        removed.push(root);
      } catch (e) {
        failed.push({ path: root, reason: e && e.message ? e.message : '未知原因' });
      }
    }
    const def = defaultProjectRoot(); // 先解析默认（可能重播种），再取一致快照
    return sendJson(res, 200, {
      ok: true,
      removed,
      skipped,
      failed,
      projects: loadRegistry().projects,
      defaultProject: def,
    });
  }

  if (req.method === 'POST' && pathname === '/api/register') {
    const body = JSON.parse((await readBody(req)) || '{}');
    const abs = resolveProjectPath(body.path);
    // 导入语义（REQ-20260910-005）：要求目录已有看板数据；未初始化明确提示改用初始化
    if (body.requireInitialized && !core.dataDirFrom(abs)) {
      throw new core.AtbError(`该目录没有看板数据（${core.DATA_REL_DIR}）：如需新建请用「初始化项目」；若数据在上级目录，请导入对应项目根`);
    }
    registerProject(abs, { explicit: true }); // 显式导入：清除 removed 标记（重新导入语义）
    return sendJson(res, 200, { ok: true, root: abs, projects: loadRegistry().projects });
  }

  if (req.method === 'POST' && pathname === '/api/init') {
    // 兼容旧签名 ?project=（multi-project M3 与旧前端初始化按钮），新入口 body.path（管理面板）
    const body = JSON.parse((await readBody(req)) || '{}');
    const raw = typeof body.path === 'string' && body.path ? body.path : u.searchParams.get('project');
    const abs = resolveProjectPath(raw);
    const dir = core.initData(abs); // 已有数据（含向上解析到仓库根/上级）→ AtbError，不覆盖
    // 部分完成兜底：数据已落盘但登记失败时，明确告知已完成的步骤并指引用导入恢复（禁止重复覆盖数据）
    try {
      registerProject(abs, { explicit: true });
    } catch (e) {
      throw new core.AtbError(`初始化已完成（${dir}），但加入项目列表失败：${e && e.message ? e.message : '未知原因'}；请在「管理项目」中改用「导入项目」恢复`);
    }
    return sendJson(res, 200, { ok: true, dataDir: dir, root: abs, projects: loadRegistry().projects });
  }

  const { root } = resolveProject(u);
  // REQ-20260910-005：注册表为空且无可播种默认项目（全部被移出）→ 无项目空态。
  // 看板接口给出 noProject 载荷（前端渲染引导），其余数据接口 400 指引到管理入口。
  if (!root) {
    if (req.method === 'GET' && pathname === '/api/board') {
      return sendJson(res, 200, {
        noProject: true,
        initialized: false,
        dataDir: null,
        projectRoot: null,
        generatedAt: new Date().toISOString(),
        items: [],
      });
    }
    throw new core.AtbError('当前没有已注册项目：请通过右上「管理项目」初始化或导入项目');
  }
  const dataDir = core.dataDirFrom(root);

  // ---------- REQ-20260911-009 Git 工作流（设置页「Git 工作流」分区）：只读状态 + 人工初始化 dev ----------
  // branch-state 只读（进入设置页即加载）；init-dev 为人工网页操作（按需创建 dev 并整体切换，
  // 幂等；非 git 项目明确拒绝，不出现可点击但必然失败的入口）。
  if (req.method === 'GET' && pathname === '/api/git/branch-state') {
    return sendJson(res, 200, { ok: true, ...gitFlow.gitBranchState(root) });
  }
  if (req.method === 'POST' && pathname === '/api/git/init-dev') {
    const before = gitFlow.gitBranchState(root);
    if (!before.isRepo) {
      throw new core.AtbError('项目不是 git 仓库：请先在终端完成 git 初始化（或经 atb init 新项目初始化），再启用 dev 分支工作流');
    }
    const r = gitFlow.ensureDevWorkflow(root);
    return sendJson(res, 200, { ok: true, before, after: r.after, devCreated: r.devCreated, switched: r.switched });
  }

  // File Board 只读文件 API（与项目参数绑定）；handleFsApi 返回 null 表示未命中
  const fsResult = await handleFsApi(req, res, u, pathname, root);
  if (fsResult !== null) return fsResult;
  if (pathname.startsWith('/api/fs')) {
    return sendJson(res, 404, { error: `未知接口：${req.method} ${pathname}` });
  }

  // ---------- 批量开发（REQ-20260906-002；REQ-20260908-010 改名）：批次/运行账本/依赖策略接口，绑定 ?project= ----------

  const policyMatch = pathname.match(/^\/api\/item\/([^/]+)\/policy$/);
  if (policyMatch && (req.method === 'GET' || req.method === 'POST')) {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    const id = decodeURIComponent(policyMatch[1]);
    if (req.method === 'GET') {
      // REQ-20260906-024：一并返回本项模型策略（缺省继承）
      return sendJson(res, 200, {
        id,
        dependsOn: batch.dependenciesOf(dataDir, id),
        modelSelection: dispatchStore.loadItemModelSelection(dataDir, id),
      });
    }
    const body = JSON.parse((await readBody(req)) || '{}');
    // REQ-20260906-024：支持只改模型策略（缺省 dependsOn 时保留既有依赖，不互相清空）
    if (body.modelSelection !== undefined) {
      try {
        dispatchStore.saveItemModelSelection(dataDir, id, body.modelSelection ?? { mode: 'inherit' });
      } catch (e) {
        return sendJson(res, 400, { error: e.message });
      }
    }
    if (body.dependsOn !== undefined) {
      const r = batch.setDependencies(dataDir, id, Array.isArray(body.dependsOn) ? body.dependsOn : []);
      if (!r.ok) {
        // 字段级错误就地反馈（存在性/自依赖/环），不笼统 500
        return sendJson(res, 400, { error: r.errors.join('；'), errors: r.errors });
      }
    }
    return sendJson(res, 200, {
      ok: true, id,
      dependsOn: batch.dependenciesOf(dataDir, id),
      modelSelection: dispatchStore.loadItemModelSelection(dataDir, id),
    });
  }

  if (req.method === 'POST' && pathname === '/api/batch/create') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    const body = JSON.parse((await readBody(req)) || '{}');
    // REQ-20260908-019：上限设置已移除——body.limit 被忽略（存量字段不报错），候选全量冻结
    // REQ-20260909-011：提示词通用化（不再按执行 Agent 分叉）——body.agent 保留但忽略；
    // 子代理模型指令固定「跟随主调度会话」（手动覆盖入口已随设置精简移除，design.md 结论）
    // REQ-20260910-027：开发人员设置已移除——遗留同名入参忽略，响应不再含该字段
    // REQ-20260913-003：去批次概念——响应不再透出批次号与排队字段；重复启动由核心层抛
    // 「已有进行中的任务」→ 400 明确提示（不排队、不新建对象）。
    const { batch: b, created } = batch.createBatch(dataDir, {
      ids: Array.isArray(body.ids) ? body.ids : null, // 显式指定候选（REQ-20260908-026 终态任务单条目重试；列表勾选范围已随 BUG-20260909-006 移除）
      projectRoot: root,
      modelSource: 'follow',
    });
    return sendJson(res, 200, {
      ok: true,
      created,
      agent: b.agent,
      // 实时候选计数（建轮不冻结：账本 candidates 为空，按实时口径盘点）
      counts: { candidates: batch.effectiveCandidates(dataDir, b).length, blocked: batch.blockedCountAtCreate(dataDir, b) },
      // BUG-20260910-001：存量批次幂等返回时按当前口径归一（与批量完善同口径；新建路径幂等无变化）
      prompt: taskSettings.normalizePromptForDisplay(b.prompt),
    });
  }

  // REQ-20260908-020 终止开发任务（人工，二次确认后调用）
  if (req.method === 'POST' && pathname === '/api/batch/abort') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    const body = JSON.parse((await readBody(req)) || '{}');
    const b = body.batchId
      ? batch.getBatch(dataDir, String(body.batchId))
      : (batch.queueHeadBatch(dataDir) || batch.latestBatch(dataDir));
    if (!b) throw new core.AtbError('尚无批次：请先创建');
    const r = batch.abortBatch(dataDir, b.batchId);
    return sendJson(res, 200, r);
  }

  // REQ-20260910-002：任务模块「提示词」页签工作区入口可用性（只读探测，无副作用；
  // 探测不到 ≠ 深链必然失败，前端仅据此「禁用 + 说明」如实反馈）
  if (req.method === 'GET' && pathname === '/api/workspace/apps') {
    return sendJson(res, 200, dispatch.detectWorkspaceApps());
  }

  // REQ-20260908-020 批量任务设置：Agent 展示 + 「任务类型 × Agent」四路子代理模型/智能档位
  if (req.method === 'GET' && pathname === '/api/tasks/settings') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    return sendJson(res, 200, { settings: taskSettings.loadTaskSettings(dataDir) });
  }
  if (req.method === 'POST' && pathname === '/api/tasks/settings') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    const body = JSON.parse((await readBody(req)) || '{}');
    // REQ-20260909-011：agents / models 键保留但忽略（兼容旧客户端不报错，不落盘——按 Agent 的
    // 配置已随设置精简移除）；仅完善流转开关生效（REQ-20260909-010，省略即保留既有值）。
    const settings = taskSettings.saveTaskSettings(dataDir, {
      refine: body.refine ?? undefined,
    });
    return sendJson(res, 200, { ok: true, settings });
  }

  if (req.method === 'GET' && pathname === '/api/batch/prompt') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    // 缺省解析队首（存量排队账本兼容）：全部结束回退最新（「已结束面板 / 启动新一轮」语义）
    const b = batch.queueHeadBatch(dataDir) || batch.latestBatch(dataDir);
    if (!b) throw new core.AtbError('尚无任务：请先启动');
    // BUG-20260910-001：存量批次提示词按当前口径归一（点名 codex exec 的旧跟随行等不再透出）
    // REQ-20260913-003：不再透出批次号（提示词本身已去批次，核对入口不依赖批次标识）
    return sendJson(res, 200, { prompt: taskSettings.normalizePromptForDisplay(b.prompt) });
  }

  if (req.method === 'GET' && pathname === '/api/batch/current') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    // 缺省解析队首（REQ-20260906-025）：面板始终显示正在执行的批次，排队批次进 queue
    const b = batch.queueHeadBatch(dataDir) || batch.latestBatch(dataDir);
    if (!b) {
      // 创建表单数据：当前可入批候选与受阻数（实时，不建批次）。
      // BUG-20260909-006：勾选范围统计过滤已随列表「进入批量开发」入口移除——
      // 统计恒为已计划队列全量口径，残留的 ?ids= 参数被忽略
      const policies = batch.readPolicies(dataDir);
      const cands = batch.candidateItems(dataDir);
      const blocked = cands.filter((x) => batch.depBlocked(dataDir, x.id, policies)).length;
      // REQ-20260910-027：git user.name 预填字段已随开发人员输入框移除
      return sendJson(res, 200, { batch: null, stats: { candidates: cands.length, blocked } });
    }
    const s = batch.batchSummary(dataDir, b.batchId);
    let current = null;
    if (s.currentRun) {
      let title = '';
      try { title = core.readStatus(core.resolveItemDir(dataDir, s.currentRun.itemId).dir).title; } catch {}
      current = { ...s.currentRun, title };
    }
    // REQ-20260913-003：去批次概念——批次载荷不再透出批次号；排队批次列表（queue）整体移除
    //（存量排队账本仍按队首解析展示，不再透出队列概念）；待处理队列（pending）实时读取。
    return sendJson(res, 200, {
      batch: {
        mode: s.batch.mode,
        status: s.batch.status,
        pauseRequested: s.batch.pauseRequested,
        createdAt: s.batch.createdAt,
        lastActivityAt: s.batch.lastActivityAt,
        // BUG-20260909-001：透出人工终止口径（Boolean 归一化：存量缺字段 → false，自然结束不误判）
        abortRequested: Boolean(s.batch.abortRequested),
        aborted: Boolean(s.batch.aborted),
        // REQ-20260910-027：不再透出开发人员字段（存量账本保留不迁移）
        // BUG-20260910-001：面板「提示词」页签（#batchPrompt / 重新复制）数据源——存量批次按当前口径归一
        prompt: taskSettings.normalizePromptForDisplay(s.batch.prompt),
      },
      current,
      // blocked = 当前因依赖未满足而受阻的待处理项（面板口径）；blockedRuns = 已按 blocked 收尾的运行数
      counts: {
        total: s.counts.total,
        reported: s.counts.reported,
        failed: s.counts.failed,
        interrupted: s.counts.interrupted, // REQ-20260908-026：中断账计数（面板「异常」口径组成部分）
        remaining: s.counts.remaining,
        blocked: s.blockedIds.length,
        blockedRuns: s.counts.blocked,
      },
      blockedIds: s.blockedIds,
      records: s.records,
      recordsTotal: s.recordsTotal, // REQ-20260908-026：完整账面数（面板仅展示最近 2 次）
      pending: s.pending, // REQ-20260908-026：待处理队列（领取顺序，面板仅展示最近 2 条）
      nextAction: s.check.nextAction,
      notice: s.check.notice || null,
    });
  }

  // REQ-20260908-026：异常/已中断执行记录「重新执行」——核验占用后重排队本轮（终态任务由前端重建新任务承接）
  if (req.method === 'POST' && pathname === '/api/batch/retry') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    const body = JSON.parse((await readBody(req)) || '{}');
    const runId = String(body.runId || '').trim();
    if (!runId) throw new core.AtbError('缺少 runId：请指定要重新执行的运行');
    const r = batch.retryRun(dataDir, runId);
    return sendJson(res, 200, r);
  }

  if (req.method === 'POST' && pathname === '/api/batch/pause') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    const body = JSON.parse((await readBody(req)) || '{}');
    const b = body.batchId
      ? batch.getBatch(dataDir, String(body.batchId))
      : (batch.queueHeadBatch(dataDir) || batch.latestBatch(dataDir));
    if (!b) throw new core.AtbError('尚无批次：请先创建批次');
    // BUG-20260908-023：已终止/已结束批次不能暂停/恢复——返回明确错误而不是静默成功
    const terminalReason = batch.batchTerminalReason(b);
    if (terminalReason) throw new core.AtbError(terminalReason);
    const paused = body.paused !== false;
    const updated = batch.pauseBatch(dataDir, b.batchId, paused);
    return sendJson(res, 200, { ok: true, batchId: updated.batchId, pauseRequested: updated.pauseRequested, status: updated.status });
  }

  if (req.method === 'POST' && pathname === '/api/batch/delete') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    // REQ-20260907-013：删除未在执行的批次（在途运行 / needs_attention 由核心层拒绝 → 400）
    const body = JSON.parse((await readBody(req)) || '{}');
    const batchId = String(body.batchId || '').trim();
    if (!batchId) throw new core.AtbError('缺少 batchId：请指定要删除的批次');
    const r = batch.deleteBatch(dataDir, batchId);
    return sendJson(res, 200, r);
  }

  if (req.method === 'GET' && pathname === '/api/batch/records') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    const b = u.searchParams.get('batchId')
      ? batch.getBatch(dataDir, String(u.searchParams.get('batchId')))
      : (batch.queueHeadBatch(dataDir) || batch.latestBatch(dataDir));
    if (!b) throw new core.AtbError('尚无批次：请先创建批次');
    const offset = Math.max(0, Number(u.searchParams.get('offset') || 0) || 0);
    const limit = Math.min(100, Math.max(1, Number(u.searchParams.get('limit') || 20) || 20));
    const r = batch.listRuns(dataDir, b.batchId, { offset, limit });
    return sendJson(res, 200, { ...r }); // REQ-20260913-003：不再透出批次号
  }

  // ---------- 需求完善（REQ-20260907-003）：待接受条目批量补文档（不进状态机、不占实施互斥） ----------

  if (req.method === 'GET' && pathname === '/api/refine/candidates') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    let cands = refine.refineCandidates(dataDir);
    const ids = u.searchParams.get('ids');
    if (ids) {
      const want = new Set(ids.split(',').map((s) => s.trim()).filter(Boolean));
      cands = cands.filter((c) => want.has(c.id));
    }
    return sendJson(res, 200, { candidates: cands });
  }

  if (req.method === 'POST' && pathname === '/api/refine/create') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    const body = JSON.parse((await readBody(req)) || '{}');
    // REQ-20260909-011：提示词通用化（不再按执行 Agent 分叉）——body.mode 保留但忽略（任意值均按
    // 通用子代理模式创建，不再 400）；子代理模型指令固定「跟随主调度会话」（设置手动覆盖入口已移除）
    // REQ-20260910-027：开发人员设置已移除——遗留同名入参忽略，响应不再含该字段
    const ids = Array.isArray(body.ids) ? body.ids : null;
    // REQ-20260913-003：去批次概念——响应不再透出批次号与排队字段；重复启动由核心层抛
    // 「已有进行中的完善任务」→ 400 明确提示（不排队、不新建对象）。
    const { batch: b, created } = refine.createRefineBatch(dataDir, {
      ids, projectRoot: root,
      modelSource: 'follow',
    });
    return sendJson(res, 200, {
      ok: true,
      created,
      mode: b.mode,
      agent: b.agent || b.mode,
      // 实时候选计数（建轮不冻结：账本 candidates 为空，按实时口径盘点）
      counts: { candidates: refine.effectiveRefineCandidates(dataDir, b).length },
      // BUG-20260909-017：幂等返回存量批次时按当前口径归一（旧模型行不再透出；账本不回写）
      // BUG-20260910-001：归一升级为全量口径（执行端段/旧领取前缀一并归一）
      // BUG-20260910-008：按当前「完善完成后自动转入计划」开关分态（实时口径，账本不回写）
      prompt: taskSettings.normalizePromptForDisplay(b.prompt, { autoPlan: refine.refineAutoPlanOn(dataDir) }),
    });
  }

  if (req.method === 'POST' && pathname === '/api/refine/abort') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    const body = JSON.parse((await readBody(req)) || '{}');
    const b = body.batchId
      ? refine.getRefineBatch(dataDir, String(body.batchId))
      : refine.queueHeadRefineBatch(dataDir);
    if (!b) throw new core.AtbError('尚无完善任务：请先创建');
    const r = refine.abortRefineBatch(dataDir, b.batchId);
    return sendJson(res, 200, r);
  }

  if (req.method === 'GET' && pathname === '/api/refine/current') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    const stats = { candidates: refine.refineCandidates(dataDir).length };
    const b = u.searchParams.get('batchId')
      ? refine.getRefineBatch(dataDir, String(u.searchParams.get('batchId')))
      : refine.queueHeadRefineBatch(dataDir);
    if (!b) return sendJson(res, 200, { batch: null, stats });
    const s = refine.refineSummary(dataDir, b.batchId);
    return sendJson(res, 200, {
      batch: refine.refineBatchPublicView(s.batch),
      current: s.currentRun,
      counts: s.counts,
      records: s.records,
      // BUG-20260908-018：透传 run 总数，面板据此渲染「加载更多（x/N）」/「共 N 条」
      recordsTotal: s.recordsTotal,
      nextAction: s.check.nextAction,
      notice: s.check.notice ?? null,
      stats,
    });
  }

  if (req.method === 'GET' && pathname === '/api/refine/records') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    const b = u.searchParams.get('batchId')
      ? refine.getRefineBatch(dataDir, String(u.searchParams.get('batchId')))
      : refine.queueHeadRefineBatch(dataDir);
    if (!b) throw new core.AtbError('尚无完善批次：请先创建');
    const offset = Math.max(0, Number(u.searchParams.get('offset') || 0) || 0);
    const limit = Math.min(100, Math.max(1, Number(u.searchParams.get('limit') || 20) || 20));
    const r = refine.listRefineRuns(dataDir, b.batchId, { offset, limit });
    return sendJson(res, 200, { ...r }); // REQ-20260913-003：不再透出批次号
  }

  if (req.method === 'POST' && pathname === '/api/refine/pause') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    const body = JSON.parse((await readBody(req)) || '{}');
    const b = body.batchId
      ? refine.getRefineBatch(dataDir, String(body.batchId))
      : refine.queueHeadRefineBatch(dataDir);
    if (!b) throw new core.AtbError('尚无完善批次：请先创建');
    // BUG-20260908-015：已终止/已结束批次不能暂停/恢复——返回明确错误而不是静默成功
    const terminalReason = refine.refineBatchTerminalReason(b);
    if (terminalReason) throw new core.AtbError(terminalReason);
    const paused = body.paused !== false;
    const updated = refine.pauseRefineBatch(dataDir, b.batchId, paused);
    return sendJson(res, 200, { ok: true, batchId: updated.batchId, pauseRequested: updated.pauseRequested, status: updated.status });
  }

  // REQ-20260908-026：异常/已中断完善记录「重新执行」——核验后重排队尾（终态任务由前端重建新任务承接）
  if (req.method === 'POST' && pathname === '/api/refine/retry') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    const body = JSON.parse((await readBody(req)) || '{}');
    const runId = String(body.runId || '').trim();
    if (!runId) throw new core.AtbError('缺少 runId：请指定要重新执行的完善运行');
    const r = refine.retryRefineRun(dataDir, runId);
    return sendJson(res, 200, r);
  }

  // ---------- 已完成条目提交状态（BUG-20260910-014 保留部分；REQ-20260911-010 换源） ----------
  // 批量 Commit（CMT）面板路由 /api/commit/current|create|pause|abort|records 已随
  // REQ-20260911-010 回退移除（未知接口统一 404）；本地提交唯一路径为 REQ-20260911-009
  // 的「开发完成到待测试自动提交」。本接口纯只读，浏览页面不执行任何 git 写操作。

  // 条目提交状态索引：REQ-20260911-009 索引（自动提交账本 ∪ git 历史消息含单号，一次
  // log 扫描）；一个 commit 可关联多个单号、一个单号可关联多个 commit（doc/test/业务分组）。
  // 索引整体为空时 statuses={}（全部「未提交」，不报错）。
  if (req.method === 'GET' && pathname === '/api/commit/item-status') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    const statuses = {};
    for (const rec of gitFlow.itemCommitStatusIndex(dataDir, root).values()) {
      statuses[rec.itemId] = { commits: rec.commits, lastCommittedAt: rec.lastCommittedAt };
    }
    return sendJson(res, 200, { statuses });
  }

  if (req.method === 'GET' && pathname === '/api/board') {
    const data = core.boardData(root);
    // REQ-20260913-003：去批次概念——「已入批次」（batchEntry）数据源下线，board 不再附加该字段。
    if (dataDir) {
      // REQ-20260908-020：已接受条目附加完善三态（未完善/完善中/已完善），徽标随轮询刷新
      const rstates = refineStates.readRefineStates(dataDir);
      // REQ-20260911-007：活动待人工决策条目附加徽标数据（列表「⚠ 等人工决策」角标与聚合区共用）
      const holds = holdStates.readHolds(dataDir);
      for (const it of data.items) {
        if (it.status === 'accepted') {
          const rec = rstates[it.id];
          it.refineState = rec ? rec.state : 'unrefined'; // 无记录按未完善展示
        }
        const holdRec = holds.items[it.id];
        if (holdRec && holdRec.state === 'holding') {
          it.hold = {
            state: 'holding',
            unanswered: holdStates.unansweredCount(holdRec),
            total: holdRec.questions.length,
            declaredAt: holdRec.declaredAt,
            declaredBy: holdRec.declaredBy,
            runId: holdRec.runId || null,
          };
        }
      }
    }
    return sendJson(res, 200, data);
  }

  // ---------- REQ-20260911-007 待人工决策（hold）：聚合清单只读 + 人工决策/复工/作废 ----------
  // 决策/复工/作废为人工专属：Agent 的 curl 调用会被 state-guard 拦截（与人工状态接口同口径）。
  if (req.method === 'GET' && pathname === '/api/holds') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    const r = holdStore.listHolds(dataDir, { all: u.searchParams.get('all') === '1' });
    return sendJson(res, 200, r);
  }

  const holdActMatch = pathname.match(/^\/api\/hold\/([^/]+)\/(answer|resume|cancel)$/);
  if (holdActMatch && req.method === 'POST') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    const id = decodeURIComponent(holdActMatch[1]);
    const body = JSON.parse((await readBody(req)) || '{}');
    let r;
    if (holdActMatch[2] === 'answer') {
      r = holdStore.answerHold(dataDir, id, {
        answers: Array.isArray(body.answers) ? body.answers : [],
        by: 'board',
      });
    } else if (holdActMatch[2] === 'resume') {
      r = holdStore.resumeHold(dataDir, id, { by: 'board' });
    } else {
      r = holdStore.cancelHold(dataDir, id, { note: body.note || '', by: 'board' });
    }
    return sendJson(res, 200, r);
  }

  const holdMatch = pathname.match(/^\/api\/hold\/([^/]+)$/);
  if (holdMatch && req.method === 'GET') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    const id = decodeURIComponent(holdMatch[1]);
    return sendJson(res, 200, holdStore.holdDetail(dataDir, id));
  }

  // REQ-20260909-003 需求文档引用讨论（独立 DISC 序列）：提示词/引用/归档/应用
  if (pathname.startsWith('/api/req-disc')) {
    const r = await handleReqDiscApi(req, res, u, pathname, root, dataDir);
    if (r !== null) return r;
    return sendJson(res, 404, { error: `未知接口：${req.method} ${pathname}` });
  }

  // REQ-20260909-004 开放式讨论模块（沿用 ASK 序列）：两态列表/提示词/纪要读取/草稿创建
  if (pathname.startsWith('/api/discussion')) {
    const r = await handleDiscussionApi(req, res, u, pathname, root, dataDir);
    if (r !== null) return r;
    return sendJson(res, 404, { error: `未知接口：${req.method} ${pathname}` });
  }

  // Oncall 咨询看板（REQ-20260907-001）：独立 ASK 序列，不进 REQ/BUG 状态机
  if (pathname.startsWith('/api/oncall/')) {
    const r = await handleOncallApi(req, res, u, pathname, root, dataDir);
    if (r !== null) return r;
    return sendJson(res, 404, { error: `未知接口：${req.method} ${pathname}` });
  }

  // REQ-20260910-019 营销模块：项目营销档案 / 定位证据 / 定价版本（不进 REQ/BUG 状态机）
  if (pathname.startsWith('/api/marketing')) {
    const r = await handleMarketingApi(req, res, u, pathname, root, dataDir);
    if (r !== null) return r;
    return sendJson(res, 404, { error: `未知接口：${req.method} ${pathname}` });
  }

  // REQ-20260910-029 发布模块：Git 远端 / Apple App Store 发布流水线（不进 REQ/BUG 状态机）
  if (pathname.startsWith('/api/release')) {
    const r = await handleReleaseApi(req, res, u, pathname, root, dataDir);
    if (r !== null) return r;
    return sendJson(res, 404, { error: `未知接口：${req.method} ${pathname}` });
  }

  // REQ-20260913-001 构建模块：版本计划（合并入 main）与分支浏览同步（不进 REQ/BUG 状态机）
  if (pathname.startsWith('/api/build')) {
    const r = await handleBuildApi(req, res, u, pathname, root, dataDir);
    if (r !== null) return r;
    return sendJson(res, 404, { error: `未知接口：${req.method} ${pathname}` });
  }

  // REQ-20260906-015 全局搜索（只读，不触碰状态机；未初始化项目仍可搜文件）
  if (req.method === 'GET' && pathname === '/api/search') {
    return handleSearchApi(res, u, root, dataDir);
  }

  // ---------- Codex 自动派发（REQ-20260906-003）：配置/预检/开关/状态/运行账本/增量日志 ----------

  if (pathname.startsWith('/api/dispatch/')) {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    const r = await handleDispatchApi(req, res, u, pathname, root, dataDir);
    if (r !== null) return r;
    return sendJson(res, 404, { error: `未知接口：${req.method} ${pathname}` });
  }

  if (req.method === 'POST' && pathname === '/api/new') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    const body = JSON.parse((await readBody(req)) || '{}');
    const type = body.type === 'bug' ? 'bug' : body.type === 'req' || body.type === 'requirement' ? 'requirement' : null;
    if (!type) return sendJson(res, 400, { error: 'type 必须是 req 或 bug' });
    // REQ-20260908-009：Bug 一律独立创建（归属需求选项已去掉），源单写 design.md 引入来源节。
    if (body.parent) {
      return sendJson(res, 400, {
        error: 'Bug 不再支持创建时归属需求（一律独立 Bug）；引入来源（源单）请写入 design.md「引入来源」节',
      });
    }
    const st = core.createItem(dataDir, {
      type,
      title: body.title,
      description: body.description || '',
      parent: null,
      by: 'board',
      // REQ-20260909-009：截图随创建一次提交（形态沿用讨论单 dataBase64）；
      // core 侧先全量校验（张数/白名单/8MB/防穿越）再落盘，任一非法整单拒绝（400）
      attachments: Array.isArray(body.attachments) ? body.attachments : [],
      // REQ-20260910-015：创建并接受（弹窗「创建并接受」一步直达 accepted）；
      // 仅严格布尔 true 生效，缺省 / 非法值与旧客户端行为完全一致（落 submitted）
      accept: body.accept === true,
    });
    return sendJson(res, 201, st);
  }

  // REQ-20260909-009：条目截图附件原始字节（README 内联展示用）。端点口径对齐讨论单附件
  // 与 /api/fs/raw：白名单图片 MIME + nosniff + 收敛 CSP（svg 直接导航也无法执行脚本）+ no-store + 8MB。
  const itemAttMatch = pathname.match(/^\/api\/item\/([^/]+)\/attachment\/([^/]+)$/);
  if (itemAttMatch && req.method === 'GET') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    const id = decodeURIComponent(itemAttMatch[1]);
    const name = decodeURIComponent(itemAttMatch[2]);
    const mime = core.attachmentMime(name);
    if (!mime) throw new core.AtbError(`仅支持图片附件预览：${name}`);
    const { dir } = core.resolveItemDir(dataDir, id); // 非法编号 / 不存在在此抛错（400）
    const buf = core.readItemAttachment(dir, name);   // 防穿越 + 8MB 在线展示上限
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': buf.length,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      'Cache-Control': 'no-store',
    });
    res.end(buf);
    return { streamed: true };
  }

  // REQ-20260908-011：待接受条目编辑标题 + 描述（status.title、文档首行与 README 描述节整体替换；
  // core 校验仅 submitted 可改，任一字段非法整单拒绝不落盘；旧 /title 端点保留兼容）
  const contentMatch = pathname.match(/^\/api\/item\/([^/]+)\/content$/);
  if (contentMatch && req.method === 'POST') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    const id = decodeURIComponent(contentMatch[1]);
    const body = JSON.parse((await readBody(req)) || '{}');
    const st = core.editItem(dataDir, id, {
      title: body.title == null ? undefined : String(body.title),
      description: body.description == null ? undefined : String(body.description),
      by: 'board',
    });
    return sendJson(res, 200, st);
  }

  // REQ-20260907-011：待接受条目改标题（status.title 与文档首行同步，core 校验仅 submitted 可改）
  const titleMatch = pathname.match(/^\/api\/item\/([^/]+)\/title$/);
  if (titleMatch && req.method === 'POST') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    const id = decodeURIComponent(titleMatch[1]);
    const body = JSON.parse((await readBody(req)) || '{}');
    const st = core.renameItem(dataDir, id, { title: body.title, by: 'board' });
    return sendJson(res, 200, st);
  }

  const statusMatch = pathname.match(/^\/api\/item\/([^/]+)\/status$/);
  if (statusMatch && req.method === 'POST') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    const id = decodeURIComponent(statusMatch[1]);
    const body = JSON.parse((await readBody(req)) || '{}');
    const current = core.getItemDetail(dataDir, id);
    if (!boardTransitionAllowed(current.status, body.to)) {
      return sendJson(res, 403, {
        error:
          current.status === 'accepted'
            ? '网页端不承担认领：accepted 条目请由 Agent 执行 atb claim <ID>（自动进入 in-progress）'
            : `网页端不允许 ${current.status} → ${body.to}`,
      });
    }
    const { status: st } = core.setStatus(dataDir, id, body.to, {
      by: 'board',
      // REQ-20260911-007：确认完成遇待人工决策未答项拦截；force=true 仅为前端「二次确认」放行口径
      force: body.force === true,
    });
    return sendJson(res, 200, st);
  }

  const itemMatch = pathname.match(/^\/api\/item\/([^/]+)$/);
  // REQ-20260908-003：删除待接受条目（仅 submitted；目录整体移除。跨站防护已在 /api/* 入口统一生效）
  if (itemMatch && req.method === 'DELETE') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    const id = decodeURIComponent(itemMatch[1]);
    const r = core.deleteItem(dataDir, id, { by: 'board' });
    return sendJson(res, 200, { ok: true, id: r.id, title: r.title, type: r.type });
  }
  if (itemMatch && req.method === 'GET') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    const id = decodeURIComponent(itemMatch[1]);
    const detail = core.getItemDetail(dataDir, id);
    // 最近一次 Codex 自动派发执行（执行账本信息，不改变业务状态列）
    const lastRun = dispatchStore.lastRunForItem(dataDir, id);
    if (lastRun) {
      detail.lastCodexRun = lastRun.runId
        ? {
          runId: lastRun.runId, phase: lastRun.phase, endedAt: lastRun.endedAt, result: lastRun.result, threadId: lastRun.threadId,
          // REQ-20260906-024：条目详情展示模型/强度/来源；历史缺快照如实反馈「历史记录未记录」
          model: lastRun.modelSnapshot
            ? { modelId: lastRun.modelSnapshot.modelId, reasoningEffort: lastRun.modelSnapshot.reasoningEffort, source: lastRun.modelSnapshot.source, mode: lastRun.modelSnapshot.mode }
            : null,
          modelConfirmed: lastRun.modelConfirmed || null,
        }
        : null;
    }
    // REQ-20260906-024：条目存在未处理的模型待处理记录时打标（卡片/详情显示「模型配置待处理」）
    const openPending = dispatchStore.listModelPending(dataDir, { onlyOpen: true }).find((x) => x.itemId === id);
    if (openPending) detail.modelPending = { kind: openPending.kind, summary: openPending.summary, requestId: openPending.requestId };
    // REQ-20260913-003：去批次概念——「已入批次」（batchEntry）不再下发（与 /api/board 同口径）
    // REQ-20260908-020：已接受条目附加完善三态（详情页徽标 + 驳回按钮禁用判断）
    if (detail.status === 'accepted') {
      const rs = refineStates.refineStateOf(dataDir, id);
      detail.refineState = rs || 'unrefined';
    }
    // REQ-20260911-007：条目详情附加待人工决策概要（抽屉「待人工决策」区块与确认完成防呆提示共用）
    {
      const holdRec = holdStates.activeHoldOf(dataDir, id);
      if (holdRec) {
        detail.hold = {
          state: 'holding',
          unanswered: holdStates.unansweredCount(holdRec),
          total: holdRec.questions.length,
          declaredAt: holdRec.declaredAt,
          declaredBy: holdRec.declaredBy,
          runId: holdRec.runId || null,
          reason: holdRec.reason || null,
        };
      }
    }
    return sendJson(res, 200, detail);
  }

  const docMatch = pathname.match(/^\/api\/item\/([^/]+)\/doc\/([^/]+)$/);
  if (docMatch && req.method === 'GET') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    const id = decodeURIComponent(docMatch[1]);
    const name = decodeURIComponent(docMatch[2]);
    return sendJson(res, 200, { id, name, content: core.readDoc(dataDir, id, name) });
  }

  // BUG-20260908-021：条目演示 HTML（只读 GET，?project= 绑定多项目）。路径形态
  // /api/item/<编号>/demo/<文件名.html>：文件名白名单（无斜杠、无前导点、html/htm 后缀）
  // + realpath 必须落在条目目录内，无路径穿越面；2MB 上限防大文件拖垮本地服务。
  const demoMatch = pathname.match(/^\/api\/item\/([^/]+)\/demo\/([^/]+)$/);
  if (demoMatch && req.method === 'GET') {
    if (!dataDir) throw new core.AtbError(`未找到 ${core.DATA_REL_DIR}，请先初始化`);
    const id = decodeURIComponent(demoMatch[1]);
    const name = decodeURIComponent(demoMatch[2]);
    let dir;
    try {
      dir = core.resolveItemDir(dataDir, id).dir;
    } catch {
      return sendDemoHtmlPage(res, 404, `条目 ${id} 在当前项目中不存在（或已删除）。`);
    }
    if (!DEMO_HTML_NAME_RE.test(name)) {
      return sendDemoHtmlPage(res, 400, `演示路径非法：仅支持条目目录内的单文件名 .html（收到：${name}）。`);
    }
    const abs = path.join(dir, name);
    let real;
    try {
      real = fs.realpathSync(abs);
    } catch {
      return sendDemoHtmlPage(res, 404, `演示文件不存在：${name}（条目 ${id} 目录内未找到）。`);
    }
    const realDir = fs.realpathSync(dir);
    if (real !== realDir && !(real + path.sep).startsWith(realDir + path.sep)) {
      return sendDemoHtmlPage(res, 400, `演示路径越出条目目录：${name}`);
    }
    let st = null;
    try { st = fs.statSync(real); } catch {}
    if (!st || !st.isFile()) {
      return sendDemoHtmlPage(res, 400, `不是可打开的演示文件：${name}`);
    }
    if (st.size > DEMO_HTML_MAX_BYTES) {
      return sendDemoHtmlPage(res, 400, `演示文件 ${name} ${(st.size / 1024 / 1024).toFixed(1)}MB，超过 2MB 上限，不在线打开。`);
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': st.size,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': DEMO_HTML_CSP,
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(real).pipe(res);
    return { streamed: true };
  }

  // 严格形态未命中但命中条目 /demo/ 前缀（子目录、编码穿越、缺文件名等）：
  // 给人读提示页而不是「未知接口」JSON——该端点面向浏览器直接导航。
  if (req.method === 'GET' && pathname.startsWith('/api/item/') && /\/demo(\/|$)/.test(pathname)) {
    return sendDemoHtmlPage(res, 400, '演示路径非法：仅支持 /api/item/<编号>/demo/<文件名.html>。');
  }

  // BUG-20260909-005：浏览器直接导航形态（GET + Accept 含 text/html）未命中 API 时，
  // 返回人读过旧指引页而非裸 JSON——直接导航不经前端 api() 封装，旧进程缺新路由时
  // 用户只会看到一段 JSON 报错；fetch 形态（Accept: */* 等）保持既有 JSON 契约。
  if (req.method === 'GET' && /text\/html/i.test(String(req.headers.accept || ''))) {
    return sendApiMissHtmlPage(res, pathname);
  }
  return sendJson(res, 404, { error: `未知接口：${req.method} ${pathname}` });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${HOST}`);
  const pathname = decodeURIComponent(u.pathname);
  Promise.resolve()
    .then(async () => {
      if (pathname.startsWith('/api/')) {
        // BUG-20260907-005：跨站防护先于业务处理（含人工专属状态流转接口）
        const guardReason = apiGuardReason(req);
        if (guardReason) {
          return sendJson(res, 403, { error: `已拒绝：${guardReason}。本地看板 API 仅接受同源页面或本机命令行调用。` });
        }
        return await handleApi(req, res, u, pathname);
      }
      if (req.method !== 'GET') {
        return sendJson(res, 405, { error: 'method not allowed' });
      }
      return serveFile(res, pathname === '/' ? 'index.html' : pathname.slice(1));
    })
    .catch((e) => {
      sendJson(res, e instanceof core.AtbError ? 400 : 500, { error: e.message });
    });
});

function onListening() {
  console.log(`agent-team-board Status Board → http://${HOST}:${PORT}`);
  console.log(`  默认项目：${defaultProjectRoot()}`);
  console.log(`  数据：${core.dataDirFrom(defaultProjectRoot()) || '（未初始化，可在网页上点「初始化」）'}`);
  console.log(`  已知项目：${loadRegistry().projects.join(' ; ') || '（无）'}`);
  // 服务重启恢复：对注册表各项目核对 Codex 自动派发账本/锁/进程/上报（不自动重派，默认等待人工）
  for (const p of loadRegistry().projects) {
    try { schedulerFor(p); } catch (e) { console.error(`  派发恢复核对失败（${p}）：${e.message}`); }
  }
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用：Status Board 可能已在运行，直接打开 http://${HOST}:${PORT} 即可。`);
    console.error(`如需绑定其他端口：ATB_PORT=${PORT + 1} node ${process.argv[1]}`);
    process.exit(1);
  }
  console.error(e);
  process.exit(1);
});

server.listen(PORT, HOST, onListening);

// 优雅关停：停止取单 → 取消受管执行并等收尾（有界）→ 落盘退出。
// 浏览器标签关闭不影响本服务；Electron 壳拥有本进程时由 stopService 发 SIGTERM 走此路径。
// BUG-20260908-003：兜底强退必须先于任何 await 注册——任一 scheduler.shutdown() 或
// server.close() 回调挂起（如滞留 keep-alive 连接）时，进程也能在时限内退出、释放端口。
// ATB_SHUTDOWN_FORCE_MS 可收紧强退时限（测试用），缺省 20s 行为不变。
const shutdownForceMs = Number(process.env.ATB_SHUTDOWN_FORCE_MS) > 0 ? Number(process.env.ATB_SHUTDOWN_FORCE_MS) : 20_000;
async function shutdownServer() {
  setTimeout(() => process.exit(0), shutdownForceMs).unref();
  const waitMs = Math.max(0, shutdownForceMs - 2_000); // 给 server.close 留余量，不被 scheduler 等待挤占
  await Promise.race([
    Promise.all([...schedulers.values()].map((s) => s.shutdown({ cancelCurrent: true }).catch(() => {}))),
    new Promise((resolve) => setTimeout(resolve, waitMs).unref()),
  ]);
  server.close(() => process.exit(0));
  server.closeIdleConnections?.(); // 不让空闲 keep-alive 连接拖住 close 回调
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    shutdownServer().catch(() => process.exit(0));
  });
}
