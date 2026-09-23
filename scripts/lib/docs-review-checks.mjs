// REQ-20260924-001 整体审查自动检查 —— 纯逻辑层（docs-review-checks）。
// 只做无副作用计算与可注入读取（fs / fetch 经注入函数传入），供 server.mjs 与测试复用；
// 不直写任何文件 / 状态。覆盖需求原文的两类脚本可判定检查：
//   ① 各语言内容语言一致性：中文是中文内容、英文是英文内容……（启发式文字体系占比判定；
//      「以已审核默认语言为基准」的深层语义同构性超出脚本可判定范围，最终判断仍归人工完结）；
//   ② 文档内链接可达性：本地相对链接按项目根判存在；http/https 远程链接请求可达性
//      （先 HEAD，405/403/501 回退 GET；超时 / 网络错误 / HTTP≥400 记死链带原因）。

// ---------- 语言一致性检查（启发式文字体系占比） ----------

// Unicode 文字体系计数（核心区 + 常用扩展；只统计字母类字符，标点数字不计）。
const SCRIPT_RE = {
  han: /[\u2e80-\u2eff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g,
  kana: /[\u3040-\u309f\u30a0-\u30ff]/g,
  hangul: /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g,
  cyrillic: /[\u0400-\u04ff]/g,
  latin: /[A-Za-z\u00c0-\u024f]/g,
};

// 剥离不参与语言判定的区域：围栏代码块 / 行内代码 / 链接与图片目标（保留链接文本）。
// 替换保持换行数不变，供调用方按需保留行号语境。
export function stripNonProse(text) {
  const keepLines = (m) => '\n'.repeat((String(m).match(/\n/g) || []).length);
  let s = String(text ?? '');
  s = s.replace(/```[\s\S]*?```/g, keepLines).replace(/~~~[\s\S]*?~~~/g, keepLines);
  s = s.replace(/`[^`\n]*`/g, ' ');
  s = s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
  return s;
}

// 文字体系计数：{ han, kana, hangul, cyrillic, latin, letterish }（letterish = 五类合计）。
export function scriptCountsOf(text) {
  const s = stripNonProse(text);
  const c = { han: 0, kana: 0, hangul: 0, cyrillic: 0, latin: 0, letterish: 0 };
  for (const [key, re] of Object.entries(SCRIPT_RE)) {
    const n = (s.match(re) || []).length;
    c[key] = n;
    c.letterish += n;
  }
  return c;
}

// 西里尔语系缩写（其余未列语言按拉丁语系期望判定）。
const CYRILLIC_LANGS = new Set(['ru', 'uk', 'be', 'bg', 'sr', 'mk']);
const MIN_LETTERISH = 20; // 低于该字母字符数判「文本过短无法判定」，不通过（宁误报不漏报）

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);

// 按语言缩写判定内容是否为该语言本体：{ ok, detail }。阈值取宽松经验值——目标是拦
// 「没翻译 / 放错语言」这类结构性错误，不追求自然语言级识别。
export function expectLangOk(lang, counts) {
  const l = String(lang || '').trim().toLowerCase();
  const c = counts;
  if (c.letterish < MIN_LETTERISH) {
    return { ok: false, detail: `文本过短（字母类字符 ${c.letterish} < ${MIN_LETTERISH}），无法判定语言` };
  }
  const nonLatin = c.han + c.kana + c.hangul + c.cyrillic;
  if (l === 'cn' || l === 'zh') {
    const r = pct(c.han, c.letterish);
    return r >= 50
      ? { ok: true, detail: `汉字占比 ${r}%` }
      : { ok: false, detail: `汉字占比仅 ${r}%（要求 ≥50%），中文文档疑似非中文内容` };
  }
  if (l === 'ja' || l === 'jp') {
    const r = pct(c.kana + c.han, c.letterish);
    return c.kana > 0 && r >= 30
      ? { ok: true, detail: `假名 ${c.kana}，假名+汉字占比 ${r}%` }
      : { ok: false, detail: c.kana === 0 ? '未检出假名（日语文档必含假名），疑似中文或非日语内容' : `假名+汉字占比仅 ${r}%（要求 ≥30%）` };
  }
  if (l === 'ko') {
    const r = pct(c.hangul, c.letterish);
    return r >= 30
      ? { ok: true, detail: `谚文占比 ${r}%` }
      : { ok: false, detail: `谚文占比仅 ${r}%（要求 ≥30%），韩语文档疑似非韩语内容` };
  }
  if (CYRILLIC_LANGS.has(l)) {
    const r = pct(c.cyrillic, c.letterish);
    return r >= 50
      ? { ok: true, detail: `西里尔占比 ${r}%` }
      : { ok: false, detail: `西里尔占比仅 ${r}%（要求 ≥50%），疑似非该语言内容` };
  }
  // 其余按拉丁语系期望：主体为拉丁字母且非拉丁体系不显著（en 文件放中文内容即在此被拦）
  const nl = pct(nonLatin, c.letterish);
  const la = pct(c.latin, c.letterish);
  return nl <= 20 && la >= 50
    ? { ok: true, detail: `拉丁占比 ${la}%，非拉丁 ${nl}%` }
    : { ok: false, detail: `非拉丁字符占比 ${nl}%（要求 ≤20%）或拉丁占比 ${la}%（要求 ≥50%），疑似未翻译或非该语言内容` };
}

// 语言集内带语言文件逐个判定：docFiles = publishDocFiles(langs, customDocs)（单文件类
// lang=null 不参与——许可证文本不翻译）。返回 { files, ok, failed }。
export function checkDocLangs(docFiles, readFile) {
  const read = typeof readFile === 'function' ? readFile : () => null;
  const files = (Array.isArray(docFiles) ? docFiles : [])
    .filter((f) => f && f.lang != null)
    .map((f) => {
      let text = null;
      try { text = read(f.file); } catch { text = null; }
      if (text == null) return { file: f.file, lang: f.lang, ok: false, detail: '文件缺失或不可读' };
      const r = expectLangOk(f.lang, scriptCountsOf(text));
      return { file: f.file, lang: f.lang, ok: r.ok, detail: r.detail };
    });
  const failed = files.filter((f) => !f.ok).map((f) => f.file);
  return { files, ok: failed.length === 0, failed };
}

// ---------- 链接可达性检查 ----------

// 解析 Markdown 行内链接与图片目标：[{ href, line }]（line 1 起）。
// 跳过围栏代码块 / 行内代码内的示例链接与不可达性目标（纯锚点 #… / mailto: 等）；
// 支持尖括号目标 [t](<a b.md>)；链接目标可带 "title"。引用式链接（[t][ref]）不在范围。
export function extractMarkdownLinks(text) {
  const s = stripNonProseFences(String(text ?? ''));
  const out = [];
  const re = /(!?)\[([^\]]*)\]\(\s*(<[^>]*>|[^)\s]+)[^)]*\)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    let href = m[3];
    if (href.startsWith('<') && href.endsWith('>')) href = href.slice(1, -1);
    href = href.trim();
    if (!href || href.startsWith('#') || /^(mailto|javascript|tel):/i.test(href)) continue;
    const line = s.slice(0, m.index).split('\n').length;
    out.push({ href, line });
  }
  return out;
}

// 与 stripNonProse 的差异：仅剥离代码区（保留链接目标本身），同样保持换行数不变。
function stripNonProseFences(text) {
  const keepLines = (m) => '\n'.repeat((String(m).match(/\n/g) || []).length);
  return String(text)
    .replace(/```[\s\S]*?```/g, keepLines)
    .replace(/~~~[\s\S]*?~~~/g, keepLines)
    .replace(/`[^`\n]*`/g, ' ');
}

const REMOTE_LINK_CAP = 50; // 单轮远程链接检查上限（防病态文档拖垮检查）
const REMOTE_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 5000;

// 本地链接目标归一：剥 #锚点、URL 解码、按所在文档目录（发布文档均在项目根）归一。
function localTargetOf(file, href) {
  let h = String(href || '').split('#')[0].trim();
  try { h = decodeURIComponent(h); } catch { /* 保留原样 */ }
  if (!h) return null;
  const dir = pathPosixDirOf(String(file || ''));
  const joined = h.startsWith('/') ? h.slice(1) : `${dir ? `${dir}/` : ''}${h}`;
  return pathPosixNormalize(joined);
}
const pathPosixDirOf = (f) => (f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '');
const pathPosixNormalize = (p) => {
  const parts = [];
  for (const seg of String(p).split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
};

// 单条远程链接可达性：先 HEAD，405/403/501 回退 GET；注入 fetchFn（缺省 globalThis.fetch），
// 超时经 AbortController（环境不支持时退化为无超时）。返回 { ok, reason? }。
async function checkRemoteLink(fetchFn, url, timeoutMs) {
  if (typeof fetchFn !== 'function') return { ok: false, reason: '运行环境无 fetch，无法检查远程链接' };
  const attempt = async (method) => {
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ac && Number.isFinite(timeoutMs) ? setTimeout(() => ac.abort(), timeoutMs) : null;
    try {
      const res = await fetchFn(url, { method, redirect: 'follow', signal: ac ? ac.signal : undefined });
      return { ok: !!(res && res.ok), status: res ? res.status : 0, statusText: (res && res.statusText) || '', error: null, aborted: false };
    } catch (e) {
      const aborted = !!(ac && ac.signal && ac.signal.aborted);
      return { ok: false, status: 0, statusText: '', error: e, aborted };
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  let r = await attempt('HEAD');
  if (!r.ok && !r.error && [405, 403, 501].includes(r.status)) r = await attempt('GET');
  if (r.aborted) return { ok: false, reason: `请求超时（>${timeoutMs}ms）` };
  if (r.error) return { ok: false, reason: `请求失败：${String((r.error && r.error.message) || r.error).slice(0, 120)}` };
  if (r.ok) return { ok: true };
  return { ok: false, reason: `HTTP ${r.status} ${r.statusText}`.trim() };
}

// 并发池：按 limit 并发执行任务列表。
async function pooled(jobs, limit) {
  const results = new Array(jobs.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, jobs.length)) }, async () => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await jobs[i]();
    }
  });
  await Promise.all(workers);
  return results;
}

// 文档内链接可达性检查：docFiles = publishDocFiles(...)（含单文件类与自定义——所有文档内
// 的链接都检查）。existsFile(resolvedPath) 判本地存在；fetchFn 检远程。逐文件返回
// { file, total, dead: [{ href, line, reason }] }，聚合 { files, ok, deadTotal }。
export async function checkDocLinks(docFiles, readFile, { existsFile, fetchFn, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const read = typeof readFile === 'function' ? readFile : () => null;
  const exists = typeof existsFile === 'function' ? existsFile : () => true;
  const files = [];
  const remoteJobs = []; // { file, href, line, index }
  for (const f of (Array.isArray(docFiles) ? docFiles : [])) {
    if (!f || !f.file) continue;
    let text = null;
    try { text = read(f.file); } catch { text = null; }
    const entry = { file: f.file, total: 0, dead: [] };
    files.push(entry);
    if (text == null) continue;
    for (const { href, line } of extractMarkdownLinks(text)) {
      entry.total += 1;
      if (/^https?:\/\//i.test(href)) {
        remoteJobs.push({ entry, href, line });
        continue;
      }
      const target = localTargetOf(f.file, href);
      if (!target) {
        entry.dead.push({ href, line, reason: '空链接目标' });
        continue;
      }
      let ok = false;
      try { ok = exists(target) === true; } catch { ok = false; }
      if (!ok) entry.dead.push({ href, line, reason: `本地文件不存在：${target}` });
    }
  }
  const capped = remoteJobs.map((job, i) => (i < REMOTE_LINK_CAP ? { ...job, unchecked: false } : { ...job, unchecked: true }));
  const results = await pooled(capped.map((job) => async () => (job.unchecked
    ? { ok: false, reason: `超出单轮远程链接检查上限（${REMOTE_LINK_CAP}），未检查` }
    : checkRemoteLink(fetchFn, job.href, timeoutMs))), REMOTE_CONCURRENCY);
  capped.forEach((job, i) => {
    const r = results[i];
    if (!r || r.ok) return;
    job.entry.dead.push({ href: job.href, line: job.line, reason: r.reason || '不可达' });
  });
  const deadTotal = files.reduce((n, f) => n + f.dead.length, 0);
  return { files, ok: deadTotal === 0, deadTotal };
}
