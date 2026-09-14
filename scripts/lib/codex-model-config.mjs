// REQ-20260906-024 Codex 派发模型配置 —— 纯规则层 + 只读能力读取。
// 职责：
//   - 模型/推理强度形态校验（长度、控制字符、选项注入防护）
//   - modelSelection 归一化：{mode:'inherit'} | {mode:'explicit', modelId, reasoningEffort}
//   - 本机有效配置多层解析（用户 config.toml → profile → 项目 .codex/config.toml），
//     只经 TOML 子集提取器读需要的键，来源如实标注；解析不了就报缺失，不猜默认模型
//   - 模型目录（codex debug models，只读能力）：已知/档位兼容校验；目录不可用不伪报已验证
//   - 配置快照构造（非敏感字段 + 配置指纹），供 run 落盘与续跑固定使用
// 不做：账户可用性验证（真实验证按钮才会发起一次最小模型请求）、任何模型智能路由。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

// ---------- 形态校验（M06：数组直传之外的第二道防线） ----------

// 模型 ID 形态：字母数字开头，允许 . : / _ + -（覆盖 slug 与 OSS 路径形态），≤200
export const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,199}$/;
// 推理强度形态：小写字母开头的小写字母/数字/连字符，≤40（档位随模型能力变化，不在此硬编码集合）
export const EFFORT_RE = /^[a-z][a-z0-9-]{0,39}$/;

export function validateModelId(id) {
  if (typeof id !== 'string' || !id.length) return { ok: false, error: '模型 ID 不能为空' };
  if (id.length > 200) return { ok: false, error: '模型 ID 过长（≤200 字符）' };
  if (/[\u0000-\u001f\u007f]/.test(id)) return { ok: false, error: '模型 ID 含控制字符' };
  if (id.startsWith('-')) return { ok: false, error: '模型 ID 不能是选项形态（以 - 开头）' };
  if (/\s/.test(id)) return { ok: false, error: '模型 ID 不能含空白字符' };
  if (/["'`$;|&<>\\]/.test(id)) return { ok: false, error: '模型 ID 含特殊字符' };
  if (!MODEL_ID_RE.test(id)) return { ok: false, error: '模型 ID 形态非法' };
  return { ok: true, error: null };
}

export function validateReasoningEffort(e) {
  if (typeof e !== 'string' || !e.length) return { ok: false, error: '推理强度不能为空' };
  if (e.length > 40) return { ok: false, error: '推理强度过长（≤40 字符）' };
  if (/[\u0000-\u001f\u007f\s]/.test(e)) return { ok: false, error: '推理强度含控制字符或空白' };
  if (e.startsWith('-')) return { ok: false, error: '推理强度不能是选项形态' };
  if (/["'`$;|&<>\\=]/.test(e)) return { ok: false, error: '推理强度含特殊字符' };
  if (!EFFORT_RE.test(e)) return { ok: false, error: '推理强度形态非法' };
  return { ok: true, error: null };
}

const SECRET_FIELD_RE = /(api[-_]?(key|token)|secret|password|credential|bearer|auth)/i;

// 归一化 modelSelection：缺省/inherit 通过；explicit 必须模型与强度成对且形态合法；不接受敏感字段
export function normalizeModelSelection(sel) {
  if (sel == null) return { ok: true, value: { mode: 'inherit' } };
  if (typeof sel !== 'object' || Array.isArray(sel)) return { ok: false, error: 'modelSelection 必须是对象', value: null };
  for (const k of Object.keys(sel)) {
    if (!['mode', 'modelId', 'reasoningEffort'].includes(k)) {
      return { ok: false, error: `modelSelection 不接受字段：${k}（仅 mode/modelId/reasoningEffort；不收集密钥）`, value: null };
    }
    if (SECRET_FIELD_RE.test(k)) return { ok: false, error: `modelSelection 不接受敏感字段：${k}`, value: null };
  }
  if (sel.mode === 'inherit') return { ok: true, value: { mode: 'inherit' } };
  if (sel.mode !== 'explicit') return { ok: false, error: `mode 必须是 inherit 或 explicit（得到：${sel.mode}）`, value: null };
  const m = validateModelId(sel.modelId);
  if (!m.ok) return { ok: false, error: `modelId 非法：${m.error}`, value: null };
  const e = validateReasoningEffort(sel.reasoningEffort);
  if (!e.ok) return { ok: false, error: `reasoningEffort 非法：${e.error}（explicit 必须同时指定模型与推理强度）`, value: null };
  return { ok: true, value: { mode: 'explicit', modelId: sel.modelId, reasoningEffort: sel.reasoningEffort } };
}

// ---------- TOML 子集提取器（M01：只提取需要的键，解析不了的行如实记 parseSkipped） ----------

function tomlScalar(raw) {
  const s = raw.trim();
  if (/^"/.test(s)) {
    const m = s.match(/^"((?:[^"\\]|\\.)*)"/);
    if (!m) return null;
    try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; }
  }
  if (/^'/.test(s)) {
    const m = s.match(/^'([^']*)'/);
    return m ? m[1] : null;
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  return null; // 数组/内联表/浮点等复杂值：本提取器不用，交给能力核验（doctor）
}

// 提取 keys 指定的标量键：返回 { values: {key:{value,table}}, tables: {<table>:{key:value}} , parseSkipped }
// 语法外的行计入 parseSkipped（行号），不猜测含义；表头支持 [a] 与 [a.b]
export function extractTomlKeys(text, keys = ['model', 'model_reasoning_effort', 'model_provider', 'profile']) {
  const want = new Set(keys);
  const values = {};
  const tables = { '': {} };
  let table = '';
  let inMultiline = false; // 三引号字符串/多行数组内：跳过（本提取器不跨行取值）
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inMultiline) {
      if (/"""|'''/.test(line)) inMultiline = false;
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (/"""|'''/.test(trimmed) && !/"""[\s\S]*"""|'''[\s\S]*'''/.test(trimmed)) { inMultiline = true; continue; }
    const header = trimmed.match(/^\[+([^\]]+)\]+$/);
    if (header) {
      table = header[1].trim().replace(/^"|"$/g, '');
      if (!tables[table]) tables[table] = {};
      continue;
    }
    const kv = trimmed.match(/^([A-Za-z0-9_"'.-]+)\s*=\s*(.+?)(?:#.*)?$/);
    if (!kv) continue;
    const key = kv[1].replace(/^"|"$/g, '');
    if (!want.has(key)) continue;
    const value = tomlScalar(kv[2]);
    if (value === null) continue; // 复杂值不猜测
    tables[table][key] = value;
    if (table === '') values[key] = { value, table };
  }
  return { values, tables, parseSkipped: [] };
}

// ---------- 配置层读取与继承解析（M01：按实际 CODEX_HOME / 项目层文件） ----------

// 层序（低 → 高）：用户 config.toml → profile（config.toml [profiles.X] 表 → $CODEX_HOME/X.config.toml v2 文件）→ 项目 .codex/config.toml
export function readModelConfigLayers({ projectRoot, codexHome = null, env = process.env, fsImpl = fs } = {}) {
  const home = codexHome || env.CODEX_HOME || path.join(env.HOME || '~', '.codex');
  const userPath = path.join(home, 'config.toml');
  const read = (p) => {
    try { return { exists: true, raw: fsImpl.readFileSync(p, 'utf8') }; } catch { return { exists: false, raw: '' }; }
  };
  const user = { kind: 'user-config', path: userPath, ...read(userPath) };
  const layers = [user];
  // profile 选择：仅从用户层顶层 profile 键读取（项目层不允许覆盖 profile 选择，与 CLI 安全边界一致）
  const userKeys = extractTomlKeys(user.raw);
  const profileName = userKeys.values.profile?.value;
  if (typeof profileName === 'string' && profileName) {
    const table = userKeys.tables[`profiles.${profileName}`];
    if (table && (table.model !== undefined || table.model_reasoning_effort !== undefined || table.model_provider !== undefined)) {
      layers.push({
        kind: 'profile-table', path: `${userPath} [profiles.${profileName}]`, exists: true,
        raw: Object.entries(table).filter(([k]) => ['model', 'model_reasoning_effort', 'model_provider'].includes(k))
          .map(([k, v]) => `${k} = ${JSON.stringify(v)}\n`).join(''),
      });
    }
    const profileV2Path = path.join(home, `${profileName}.config.toml`);
    const v2 = { kind: 'profile-file', path: profileV2Path, ...read(profileV2Path) };
    if (v2.exists) layers.push(v2);
  }
  const projectPath = path.join(projectRoot, '.codex', 'config.toml');
  const project = { kind: 'project-config', path: projectPath, ...read(projectPath) };
  if (project.exists) layers.push(project);
  return layers;
}

function tableValueOf(layer, keysImpl) {
  const parsed = keysImpl(layer.raw);
  return parsed.values;
}

// 继承解析：逐层（低 → 高）覆盖；只认显式配置值，不猜默认。effort 缺失留给目录默认补（buildModelSnapshot）
export function resolveInheritedModel(layers, { keys = extractTomlKeys } = {}) {
  const sources = { model: null, reasoningEffort: null, provider: null };
  let modelId = null;
  let reasoningEffort = null;
  let provider = null;
  for (const layer of layers) {
    if (!layer.exists || !layer.raw) continue;
    const v = tableValueOf(layer, keys);
    if (v.model && typeof v.model.value === 'string') { modelId = v.model.value; sources.model = layer.kind; }
    if (v.model_reasoning_effort && typeof v.model_reasoning_effort.value === 'string') { reasoningEffort = v.model_reasoning_effort.value; sources.reasoningEffort = layer.kind; }
    if (v.model_provider && typeof v.model_provider.value === 'string') { provider = v.model_provider.value; sources.provider = layer.kind; }
  }
  const unresolved = [];
  if (!modelId) unresolved.push('model');
  if (!reasoningEffort) unresolved.push('reasoning-effort');
  return { ok: unresolved.length === 0, modelId, reasoningEffort, provider, sources, unresolved };
}

// ---------- 选择优先级（M02：本项 explicit > 项目 explicit > 继承） ----------

function norm(sel) {
  const r = normalizeModelSelection(sel);
  return r.ok ? r.value : { mode: 'inherit' };
}

export function effectiveSelection({ itemSelection = null, projectSelection = null } = {}) {
  const item = norm(itemSelection);
  const project = norm(projectSelection);
  if (item.mode === 'explicit') return { selection: item, source: 'item-explicit' };
  if (project.mode === 'explicit') return { selection: project, source: 'project-explicit' };
  return { selection: { mode: 'inherit' }, source: 'inherit' };
}

// ---------- 模型目录（只读能力：codex debug models；不可用不伪报） ----------

// 归一化目录条目：{slug, displayName, defaultEffort, efforts}
function normCatalogEntry(m) {
  if (!m || typeof m !== 'object') return null;
  const slug = m.slug || m.model || null;
  if (typeof slug !== 'string' || !slug) return null;
  const rawEfforts = m.supported_reasoning_levels || m.reasoning_levels || [];
  const efforts = rawEfforts.map((e) => (typeof e === 'string' ? e : e && typeof e === 'object' ? (e.effort || e.level) : null))
    .filter((x) => typeof x === 'string' && x);
  return {
    slug,
    displayName: m.display_name || m.displayName || slug,
    defaultEffort: m.default_reasoning_level || m.defaultReasoningLevel || null,
    efforts,
  };
}

// 目录缓存：同一 CLI + 工作目录短窗内复用（保存/轮询不逐个试跑模型；目录读取不发模型请求）
const CATALOG_TTL_MS = 30_000;
const catalogCache = new Map(); // key → { at, value }

// 读取模型目录（只读能力 codex debug models；真实列表，非固定清单）。失败如实返回原因。
export function loadModelCatalog({ cliPath, cwd = null, env = null, runSync = null, ttlMs = CATALOG_TTL_MS, noCache = false } = {}) {
  if (typeof cliPath !== 'string' || !cliPath) {
    return { ok: false, reason: '未配置 codex CLI，无法读取模型目录', models: [] };
  }
  const key = `${cliPath}|${cwd || ''}`;
  const hit = catalogCache.get(key);
  if (!noCache && hit && Date.now() - hit.at < ttlMs) return hit.value;
  let result;
  try {
    const run = runSync || ((args, opts) => spawnSync(cliPath, args, opts));
    const r = run(['debug', 'models'], {
      cwd: cwd || undefined,
      env: { ...process.env, ...(env || {}) },
      encoding: 'utf8', timeout: 15_000, maxBuffer: 8 * 1024 * 1024,
    });
    if (r.error || r.status !== 0 || !r.stdout) {
      const reason = r.error ? `无法执行 CLI：${r.error.message}`
        : `CLI 返回非零（${r.status}）：${String(r.stderr || '').trim().slice(0, 300)}`;
      result = { ok: false, reason: `${reason}；可手动输入模型 ID（标注“尚未验证”）`, models: [] };
    } else {
      let parsed = null;
      try { parsed = JSON.parse(r.stdout); } catch { parsed = null; }
      const models = Array.isArray(parsed?.models)
        ? parsed.models.map(normCatalogEntry).filter(Boolean)
        : [];
      result = models.length
        ? { ok: true, reason: null, models, loadedAt: new Date().toISOString() }
        : { ok: false, reason: 'CLI 模型目录为空或格式不识别；可手动输入模型 ID（标注“尚未验证”）', models: [] };
    }
  } catch (e) {
    result = { ok: false, reason: `读取模型目录失败：${e.message}`, models: [] };
  }
  if (result.ok) catalogCache.set(key, { at: Date.now(), value: result });
  return result;
}

// 从目录条目取档位（兼容 CLI 原始形态与 loadModelCatalog 归一化形态）
export function catalogInfoFor(catalog, modelId) {
  if (!catalog || !catalog.ok || !Array.isArray(catalog.models)) {
    return { known: false, efforts: [], defaultEffort: null, displayName: null };
  }
  const m = catalog.models.find((x) => x && (x.slug === modelId || x.model === modelId));
  if (!m) return { known: false, efforts: [], defaultEffort: null, displayName: null };
  const rawEfforts = m.supported_reasoning_levels || m.reasoning_levels || m.efforts || [];
  const efforts = rawEfforts.map((e) => (typeof e === 'string' ? e : e && typeof e === 'object' ? (e.effort || e.level) : null)).filter(Boolean);
  return {
    known: true,
    efforts,
    defaultEffort: m.default_reasoning_level || m.defaultReasoningLevel || m.defaultEffort || null,
    displayName: m.display_name || m.displayName || m.displayName || null,
  };
}

// ---------- 配置指纹（验证结果绑定配置版本；内容变化即失效） ----------

export function fingerprintLayers(layers) {
  const h = crypto.createHash('sha256');
  for (const layer of layers || []) {
    h.update(String(layer.kind)); h.update('\0');
    if (layer.exists) h.update(String(layer.raw)); h.update('\0');
  }
  return h.digest('hex').slice(0, 16);
}

// ---------- 快照构造（M03/M16：非敏感字段；已知不兼容拒绝；未知标注 unverified） ----------

export function buildModelSnapshot({ selection, source, inherit = null, catalog = null, layers = [], cliVersion = null } = {}) {
  const n = normalizeModelSelection(selection);
  if (!n.ok) return { ok: false, error: n.error };
  const sel = n.value;
  const resolvedAt = new Date().toISOString();

  if (sel.mode === 'explicit') {
    const info = catalogInfoFor(catalog, sel.modelId);
    if (info.known && info.efforts.length && !info.efforts.includes(sel.reasoningEffort)) {
      return {
        ok: false,
        error: `模型 ${sel.modelId} 不支持推理强度 ${sel.reasoningEffort}（支持：${info.efforts.join('、')}）；请重新选择`,
      };
    }
    return {
      ok: true,
      snapshot: {
        mode: 'explicit', modelId: sel.modelId, reasoningEffort: sel.reasoningEffort,
        provider: null, source, sources: {}, cliVersion,
        configFingerprint: fingerprintLayers(layers), resolvedAt,
        catalog: { known: info.known, effortSupported: info.known ? info.efforts.includes(sel.reasoningEffort) : null, defaultEffort: info.defaultEffort },
        verification: info.known ? 'unverified' : 'unverified', // 目录已知只代表形态合法，账户可用仍需真实验证
      },
    };
  }

  // inherit：必须有继承解析结果；模型缺失直接阻止
  if (!inherit || !inherit.modelId) {
    return { ok: false, error: '无法解析本机有效模型配置（未在任何配置层找到 model）：请显式选择模型后重试' };
  }
  const info = catalogInfoFor(catalog, inherit.modelId);
  let effort = inherit.reasoningEffort;
  let effortSource = inherit.sources.reasoningEffort;
  if (!effort && info.known && info.defaultEffort) {
    effort = info.defaultEffort;
    effortSource = 'catalog-default';
  }
  if (!effort) {
    return { ok: false, error: '无法解析推理强度：配置层未设置且模型目录不可用（或该模型无默认档位）；请显式选择推理强度' };
  }
  if (info.known && info.efforts.length && !info.efforts.includes(effort)) {
    return { ok: false, error: `本机配置的模型 ${inherit.modelId} 不支持推理强度 ${effort}（支持：${info.efforts.join('、')}）` };
  }
  return {
    ok: true,
    snapshot: {
      mode: 'inherit', modelId: inherit.modelId, reasoningEffort: effort, provider: inherit.provider,
      source: 'inherit',
      sources: { model: inherit.sources.model, reasoningEffort: effortSource, provider: inherit.sources.provider },
      cliVersion, configFingerprint: fingerprintLayers(layers), resolvedAt,
      catalog: { known: info.known, effortSupported: info.known ? info.efforts.includes(effort) : null, defaultEffort: info.defaultEffort },
      verification: 'unverified',
    },
  };
}

// ---------- 失败分类补充（M09/M10：结构化优先，泛化 HTTP 错误不归为模型问题） ----------

export const MODEL_FAILURE_KINDS = ['model-missing', 'model-denied', 'effort-unsupported'];

export function classifyModelFailure(stderr) {
  const s = String(stderr || '');
  if (/model\s+["'“”]?[\w.:-]+["'”]?\s+(?:was\s+)?not\s+found|unknown\s+model|no\s+such\s+model|model\s+does\s+not\s+exist/i.test(s)) return { kind: 'model-missing' };
  if (/do\s+not\s+have\s+access\s+to\s+model|model\s+["'“”]?[\w.:-]+["'”]?\s+is\s+not\s+available|not\s+entitled|no\s+access\s+to\s+model|model\s+.*(?:403|permission)/i.test(s)) return { kind: 'model-denied' };
  if (/(?:invalid|unsupported|unknown)\s+(?:value\s+of\s+)?model_reasoning_effort|(?:invalid|unsupported|unknown)\s+reasoning\s+(?:effort|level)|reasoning\s+(?:effort|level)\s+(?:is\s+)?(?:not\s+supported|invalid|unsupported)/i.test(s)) return { kind: 'effort-unsupported' };
  return null;
}
