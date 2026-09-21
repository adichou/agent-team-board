// REQ-20260920-003 构建和发布流程整改 —— 发布流程纯逻辑层（publish-flow）。
// 只做无副作用计算与可注入读取的求值（fs 读取经注入函数传入），供 server.mjs / build-store /
// 前端提示词装配复用；不直写任何 git / 状态文件。
// 覆盖口径（README 落定）：
//   - 版本号：从计划编号后两段提取（BLD-20260920-001 → 20260920-001），保留前导零，
//     界面各处复用同一提取，不另让用户重复输入；
//   - 发布文档：README / CHANGELOG / FEATURES / AGENTS 四类 × 语言集（REQ-20260921-010，
//     默认 cn,en，可配置）动态展开；README 按语言链接 CHANGELOG 与 FEATURES（同语言互链）；
//   - AI 写作提示词：技术写作人员角色 + 子代理流程 + 项目路径 / 计划号 / 版本号 / 关联范围 /
//     文档清单 / 写作约束（简练通俗、不罗列原文、不编造）；
//   - AI 翻译提示词（REQ-20260921-012）：以已审核默认语言文档为唯一基准，产出剩余语言
//     全部文档（atb translate 逐文件回执）；
//   - 官网提示词：在官网仓库执行、读已发布版本 CHANGELOG / FEATURES 双语材料、提交消息带
//     完整计划号，不强制官网技术栈；
//   - 计划号匹配：完整计划号 + 标识边界（BLD-20260920-0010 不冒充 BLD-20260920-001）；
//   - 官网检测：仅提交者时间不早于推送成功时间（含等于边界）的提交参与匹配；起点缺失 →
//     waiting（缺少推送完成时间，待核对），不做全历史扫描；预算未读完窗口 → scanning
//     （本轮检测未完成，不当未命中）；窗口读完无命中 → missed；命中 → hit 带证据；
//   - 文档状态机（三阶段七态 + 基准变更检测 + 整体完结门禁，REQ-20260921-012）：见
//     evaluateDocsFlow 注释；提交口径状态机 / 五步门禁：见 evaluateDocsState /
//     publishStepsState 注释。

import crypto from 'node:crypto';

// ---------- 版本号提取 ----------

// 计划编号 → 版本号：取后两段（YYYYMMDD-NNN），前导零保留；非法（长度 / 前缀）返回 null。
export function versionNumberOf(planId) {
  const m = /^BLD-(\d{8})-(\d{3})$/.exec(String(planId || ''));
  if (!m) return null;
  return `${m[1]}-${m[2]}`;
}

// ---------- 发布文档清单（REQ-20260921-010 按语言集动态展开） ----------

export const PUBLISH_DOC_KEYS = ['README', 'CHANGELOG', 'FEATURES', 'AGENTS'];
// 默认语言集按需求原文 cn,en；语言缩写以国际规范为准（2–3 个字母），cn / zh、jp / ja 均合法。
export const DEFAULT_DOC_LANGS = ['cn', 'en'];

const LANG_CODE_RE = /^[a-zA-Z]{2,3}$/;

// 语言集校验（列表项）：空项（连续逗号）、非 2–3 字母缩写、重复项（不自动去重）均报错；
// 返回 { langs }（小写归一）或 { langs: null, error }。
function validateLangParts(parts) {
  const seen = new Set();
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) return { langs: null, error: `存在空的语言项（连续逗号）：第 ${i + 1} 项为空` };
    if (!LANG_CODE_RE.test(p)) {
      return { langs: null, error: `存在非法缩写「${p.slice(0, 20)}」：语言缩写以国际规范为准（2–3 个字母，如 cn / zh / en / fr / ja）` };
    }
    const low = p.toLowerCase();
    if (seen.has(low)) return { langs: null, error: `语言重复：「${low}」出现多次` };
    seen.add(low);
  }
  return { langs: parts.map((p) => p.toLowerCase()), error: null };
}

// 语言集数组入参（v.langs 健壮读取 / 服务端保存共用）。
export function normalizeLangsList(list) {
  if (!Array.isArray(list) || !list.length) {
    return { langs: null, error: '语言集不能为空（至少一个语言缩写，如 cn,en）' };
  }
  return validateLangParts(list.map((x) => String(x ?? '').trim()));
}

// 语言集字符串入参（输入框原文，逗号分隔）：空白容错 + 大小写归一。
export function normalizeDocLangs(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { langs: null, error: '语言集不能为空（至少一个语言缩写，如 cn,en）' };
  return validateLangParts(s.split(',').map((x) => x.trim()));
}

// 版本记录取语言集：v.langs 合法（数组或逗号串）则用之；缺失 / 非法整体回退默认 cn,en
//（求值入口统一从这里取，语言集是文件清单的唯一事实源）。
export function docLangsOf(v) {
  const raw = v?.langs;
  if (raw == null) return [...DEFAULT_DOC_LANGS];
  const r = Array.isArray(raw) ? normalizeLangsList(raw) : normalizeDocLangs(raw);
  return r.langs || [...DEFAULT_DOC_LANGS];
}

// 文档清单 = 4 类 × 语言集全部语言：第一个语言（默认语言）不带后缀，其余 <KEY>_<lang>.md
//（REQ-20260921-010 需求原文命名；存量 <KEY>.en.md 点号命名不迁移、不并存识别）。
export function publishDocFiles(langs = DEFAULT_DOC_LANGS) {
  const ls = docLangsOf({ langs });
  const out = [];
  for (const key of PUBLISH_DOC_KEYS) {
    ls.forEach((lang, i) => {
      out.push({ key, lang, file: `${key}${i === 0 ? '' : `_${lang}`}.md` });
    });
  }
  return out;
}

export function docFileOf(key, lang, langs = DEFAULT_DOC_LANGS) {
  const k = String(key || '').trim().toUpperCase();
  const l = String(lang || '').trim().toLowerCase();
  const idx = docLangsOf({ langs }).indexOf(l);
  if (!PUBLISH_DOC_KEYS.includes(k) || idx < 0) return null;
  return `${k}${idx === 0 ? '' : `_${l}`}.md`;
}

export function isPublishDocFile(file, langs = DEFAULT_DOC_LANGS) {
  const name = String(file || '').trim();
  return publishDocFiles(langs).some((f) => f.file === name);
}

// 常见语言显示名（未命中原样显示缩写）；显示名随文件名一并 data-i18n-skip 豁免（标识不是文案）。
const LANG_NAMES = {
  cn: '中文', zh: '中文', en: 'English', fr: 'Français', jp: '日本語', ja: '日本語',
  de: 'Deutsch', es: 'Español', ko: '한국어', ru: 'Русский', it: 'Italiano', pt: 'Português',
};
export function langNameOf(lang) {
  const l = String(lang || '').trim().toLowerCase();
  return LANG_NAMES[l] || l;
}

// README 按语言链接 CHANGELOG 与 FEATURES（同语言互链）；其余文档无链接要求。
// README.md → 无后缀互链；README_<lang>.md → 同后缀互链。
export function readmeDocLinks(file) {
  const m = /^README(_[a-z]{2,3})?\.md$/.exec(String(file || '').trim());
  if (!m) return [];
  const suffix = m[1] || '';
  return [`CHANGELOG${suffix}.md`, `FEATURES${suffix}.md`];
}

// 默认语言 / 剩余语言清单（REQ-20260921-012 阶段划分依据）：默认语言 = 语言集首语言
//（文件不带后缀）；剩余语言 = 其余语言（<KEY>_<lang>.md，AI 翻译产出范围）。
export function defaultDocFiles(langs = DEFAULT_DOC_LANGS) {
  const ls = docLangsOf({ langs });
  return publishDocFiles(ls).filter((f) => f.lang === ls[0]);
}
export function restDocFiles(langs = DEFAULT_DOC_LANGS) {
  const ls = docLangsOf({ langs });
  return publishDocFiles(ls).filter((f) => f.lang !== ls[0]);
}

// ---------- 提示词装配 ----------

const shortHash = (h) => String(h || '').slice(0, 12);

// AI 总结提示词（REQ-20260921-008，原 buildDocWritingPrompt 更名并按新工作流调整；
// REQ-20260921-012 范围收窄为阶段一：仅默认语言 4 文件）：
// 主会话派发给「技术写作人员」角色的子代理，逐文件总结当前版本发布文档的**默认语言**
//（语言集首语言）四个文件；子代理经 atb summary CLI 逐文件回执进度（正在总结 → 已总结
// 待审核），完成后交短回执。剩余语言文档由阶段二 AI 翻译（buildDocTranslatePrompt）产出，
// 不在本提示词范围内。
export function buildDocSummaryPrompt({ projectRoot, planId, items = [], runId = null, langs = DEFAULT_DOC_LANGS, atbPath = 'node scripts/atb.mjs' } = {}) {
  const version = versionNumberOf(planId) || planId;
  const ls = docLangsOf({ langs });
  const docFiles = defaultDocFiles(ls);
  const readmePair = 'README.md → CHANGELOG.md / FEATURES.md';
  const lines = [];
  lines.push(`你是技术写作人员，以子代理身份完成「${planId}」（版本号 ${version}）的发布文档 AI 总结任务（阶段一：默认语言先行）；主会话只派发本提示词并接收短回执，不在此展开代码修改。`);
  lines.push('');
  lines.push(`项目路径：${projectRoot || '（未提供）'}`);
  lines.push(`发布计划号：${planId}（版本号 ${version}）`);
  if (runId) lines.push(`执行编号：${runId}`);
  lines.push('关联范围（按实际代码与提交核实变化，不简单罗列需求 / Bug 原文）：');
  for (const it of items) lines.push(`- ${it.itemId}（commit ${shortHash(it.commit)}）${it.title || ''}`);
  lines.push('');
  lines.push(`本阶段只总结默认语言（语言集首语言 ${ls[0]}）的 ${docFiles.length} 个文档（${PUBLISH_DOC_KEYS.length} 类 × 1）；语言集 ${ls.join(',')} 的其余语言文档待默认语言全部人工审核后由「AI 翻译」产出，不在本轮总结范围：`);
  for (const f of docFiles) lines.push(`- ${f.file}（${langNameOf(f.lang)} / ${f.key}）`);
  lines.push('');
  if (runId) {
    lines.push('逐文件进度回执（在项目根执行；atb 指 ' + atbPath + '，下同）：');
    lines.push(`1. 开始总结某文件：atb summary file ${runId} --file <文件名> --state summarizing`);
    lines.push(`2. 该文件总结完成：atb summary file ${runId} --file <文件名> --state summarized`);
    lines.push(`3. 全部完成：atb summary done ${runId} --summary "<一两句要点>"`);
    lines.push(`4. 中断 / 无法完成：atb summary fail ${runId} --reason "<短句原因>"`);
    lines.push(`已审核（reviewed）的文件跳过不再总结；不修改上述 ${docFiles.length} 个文档以外的任何文件。`);
    lines.push('');
  }
  lines.push('写作约束：');
  lines.push('- 文字简练、通俗易懂：说明用户能做什么、使用方式与本次变化；不得编造已实现能力。');
  lines.push(`- README 按语言链接同语言 CHANGELOG 与 FEATURES（${readmePair}），链接必须真实可达。`);
  lines.push('- AGENTS 只描述适用协作规则，不把营销说明写成执行规则。');
  lines.push('- 文档与当前版本范围一致：未纳入本版发布的功能不得写成已发布。');
  lines.push('- 完成后以短回执汇报（哪些文件已总结 / 关键结论），不粘贴全文。');
  return lines.join('\n');
}

// AI 翻译提示词（REQ-20260921-012 阶段二）：以**已审核的默认语言文档磁盘内容为唯一翻译
// 基准**（readFile 注入、全文嵌入提示词——启动时点即基准快照，检出基准更新时按最新磁盘
// 内容重新生成即「按最新基准翻译」），逐文件产出剩余语言全部文件（4 × (N−1)）；子代理经
// atb translate CLI 逐文件回执进度（正在翻译 → 已翻译待审核）。不得引入基准外信息、
// 不得编造。
export function buildDocTranslatePrompt({ projectRoot, planId, items = [], runId = null, langs = DEFAULT_DOC_LANGS, readFile = null, atbPath = 'node scripts/atb.mjs' } = {}) {
  const version = versionNumberOf(planId) || planId;
  const ls = docLangsOf({ langs });
  const baseFiles = defaultDocFiles(ls);
  const targets = restDocFiles(ls);
  const read = typeof readFile === 'function' ? readFile : () => null;
  const lines = [];
  lines.push(`你是技术翻译人员，以子代理身份完成「${planId}」（版本号 ${version}）的发布文档 AI 翻译任务（阶段二：默认语言已全部人工审核）；主会话只派发本提示词并接收短回执，不在此展开代码修改。`);
  lines.push('');
  lines.push(`项目路径：${projectRoot || '（未提供）'}`);
  lines.push(`发布计划号：${planId}（版本号 ${version}）`);
  if (runId) lines.push(`执行编号：${runId}`);
  lines.push('关联范围（翻译时了解本版内容语境，不展开代码修改）：');
  for (const it of items) lines.push(`- ${it.itemId}（commit ${shortHash(it.commit)}）${it.title || ''}`);
  lines.push('');
  lines.push(`翻译基准（已人工审核的默认语言 ${ls[0]} 文档，唯一基准——语义以此为准，不得引入基准外信息，不得编造）：`);
  for (const f of baseFiles) {
    const text = read(f.file);
    lines.push(`===== ${f.file}（默认语言 ${ls[0]}，已审核基准） =====`);
    lines.push(text == null ? '（文件缺失：跳过该类型翻译并在回执说明）' : String(text).replace(/\s*$/, ''));
    lines.push('===== 基准结束 =====');
  }
  lines.push('');
  lines.push(`请逐个产出以下 ${targets.length} 个剩余语言文档（${PUBLISH_DOC_KEYS.length} 类 × ${ls.length - 1} 语言，剩余语言 ${ls.slice(1).join(',')}），每个文件写入后其状态变为「已翻译待审核」，等待人工审查：`);
  for (const f of targets) lines.push(`- ${f.file}（${langNameOf(f.lang)} / ${f.key}，基准 ${f.key}.md）`);
  lines.push('');
  if (runId) {
    lines.push('逐文件进度回执（在项目根执行；atb 指 ' + atbPath + '，下同）：');
    lines.push(`1. 开始翻译某文件：atb translate file ${runId} --file <文件名> --state translating`);
    lines.push(`2. 该文件翻译完成（先写盘再回执）：atb translate file ${runId} --file <文件名> --state translated`);
    lines.push(`3. 全部完成：atb translate done ${runId} --summary "<一两句要点>"`);
    lines.push(`4. 中断 / 无法完成：atb translate fail ${runId} --reason "<短句原因>"`);
    lines.push(`已审核（reviewed）的目标文件跳过不再翻译；不修改上述 ${targets.length} 个文档与基准文档以外的任何文件。`);
    lines.push('');
  }
  lines.push('翻译约束：');
  lines.push('- 以基准文档为唯一翻译基准：与默认语言语义一致，不增删信息，不得编造能力或范围。');
  lines.push('- 各剩余语言行文地道（README / CHANGELOG 面向用户，AGENTS 为协作规则），结构与基准对应。');
  lines.push(`- README 按语言链接同语言 CHANGELOG 与 FEATURES（${ls.slice(1).map((l) => `README_${l}.md → CHANGELOG_${l}.md / FEATURES_${l}.md`).join('；')}），链接必须真实可达。`);
  lines.push('- 文档与当前版本范围一致：未纳入本版发布的功能不得写成已发布。');
  lines.push('- 完成后以短回执汇报（哪些文件已翻译 / 关键结论），不粘贴全文。');
  return lines.join('\n');
}

// 官网 AI 写作提示词：在官网仓库执行；读取本项目已发布版本的 CHANGELOG / FEATURES 中英文
// 材料，按官网自身架构更新内容；完成提交消息带完整计划号。不强制官网技术栈 / 目录 / 构建。
export function buildSiteWritingPrompt({ projectRoot, siteRoot, planId, baseline = null } = {}) {
  const version = versionNumberOf(planId) || planId;
  const lines = [];
  lines.push(`你是技术写作人员，在官网仓库（${siteRoot || '（未提供）'}）内完成「${planId}」（版本号 ${version}）的官网同步。`);
  lines.push('');
  lines.push(`项目仓库（已发布基准${baseline ? ` ${shortHash(baseline)}` : ''}）：${projectRoot || '（未提供）'}`);
  lines.push(`发布计划号：${planId}（版本号 ${version}）`);
  lines.push('');
  lines.push('要求：');
  lines.push('- 只读取项目仓库已发布版本（上述基准）中的 CHANGELOG 与 FEATURES 中英文材料，不要读取 dev 分支尚未发布的内容。');
  lines.push('- 按官网仓库自身架构与目录组织更新相应内容；本提示词不假定官网技术栈、目录或构建命令。');
  lines.push('- 完成后请在官网仓库提交，提交消息必须包含完整计划号「' + planId + '」。');
  lines.push('- 以短回执汇报（改动位置与提交号），不粘贴全文。');
  return lines.join('\n');
}

// ---------- 计划号精确匹配 ----------

// 完整计划号 + 标识边界：命中位置左右不得紧邻 [A-Za-z0-9_-]（防 BLD-…-0010 / XBLD-… 冒充）。
export function planIdTokenMatches(text, planId) {
  const s = String(text || '');
  const id = String(planId || '');
  if (!s || !/^BLD-\d{8}-\d{3,}$/.test(id)) return false;
  const word = (ch) => /[A-Za-z0-9_-]/.test(ch);
  let i = s.indexOf(id);
  while (i !== -1) {
    const before = i > 0 ? s[i - 1] : '';
    const after = s[i + id.length] || '';
    if (!word(before) && !word(after)) return true;
    i = s.indexOf(id, i + 1);
  }
  return false;
}

// ---------- 官网时间窗扫描（纯函数） ----------

// commits：官网本地主分支提交（新→旧）[{ hash, subject, committerDate }]（读取方负责
// 按 limit+1 预算取数）；sinceIso：推送成功时间（null → waiting，不猜测起点）。
// 口径：仅提交者时间不早于起点（含等于边界）的提交参与匹配；budget 为本轮读取预算，
// 给入提交数超预算且未在预算内读完窗口 / 命中 → scanning（本轮检测未完成，可继续检测，
// 不当作未命中）；窗口读完无命中 → missed；命中 → hit（证据含 hash / subject / 匹配时间）。
export function scanSiteCommitsForPlan(commits, { planId, sinceIso, budget = 200 } = {}) {
  const list = Array.isArray(commits) ? commits : [];
  if (!sinceIso) return { status: 'waiting', scanned: 0, windowCount: 0, reason: '缺少推送完成时间，待核对（不使用猜测值，不做全历史扫描）' };
  const sinceMs = Date.parse(sinceIso);
  if (!Number.isFinite(sinceMs)) return { status: 'waiting', scanned: 0, windowCount: 0, reason: '推送完成时间无效，待核对' };
  const n = Math.max(1, Math.floor(Number(budget) || 200));
  let windowCount = 0;
  let scanned = 0;
  for (const c of list) {
    if (scanned >= n) break; // 预算用尽：后续未读
    scanned++;
    const t = Date.parse(c.committerDate || '');
    if (!Number.isFinite(t)) continue; // 时间不可解析：不参与匹配，也不终止窗口
    if (t < sinceMs) continue; // 早于起点：不参与（非单调历史继续向后读，防漏检）
    windowCount++;
    if (planIdTokenMatches(c.subject, planId)) {
      return {
        status: 'hit',
        scanned,
        windowCount,
        evidence: { hash: c.hash, subject: String(c.subject || ''), matchedAt: new Date().toISOString() },
      };
    }
  }
  if (list.length > n) {
    return { status: 'scanning', scanned, windowCount, reason: '本轮检测未完成，可继续检测（未读完时间窗口，不当未命中）' };
  }
  return { status: 'missed', scanned, windowCount };
}

// ---------- REQ-20260921-008 文档流水线状态机（REQ-20260921-012 扩展为三阶段七态） ----------

// 默认语言四态（阶段一）：
//   未总结 ──(AI 总结执行中)──▶ 正在总结 ──(该文件总结完成)──▶ 已总结待审核
//      │                                                        │
//      └──────(不经 AI 总结，直接审查修改后人工通过)────────────┤
//                                                               ▼
//      已总结待审核 ──(人工通过审核)──▶ 已审核 ──(再次编辑修改)──▶ 回到已总结待审核
// 剩余语言三态 + 已审核（阶段二，语义与默认语言一一对应）：
//   未翻译 ──(AI 翻译执行中)──▶ 正在翻译 ──(该文件翻译完成)──▶ 已翻译待审核 ──(人工通过审核)──▶ 已审核
//      │                                                            ▲ │
//      └──(基准变更检测：默认语言同类型文档 mtime 更新)──────────────┘  └─(再次编辑修改)──▶ 回到已翻译待审核
// 阶段三：4×N 全部已审核 → 人工「整体审查完结」（recordDocsFinalize）→ 提交解锁。
export const DOCS_FLOW_STATES = [
  'unsummarized', 'summarizing', 'summarized',
  'untranslated', 'translating', 'translated',
  'reviewed',
];
export const DOCS_FLOW_LABEL = {
  unsummarized: '未总结', summarizing: '正在总结', summarized: '已总结待审核',
  untranslated: '未翻译', translating: '正在翻译', translated: '已翻译待审核',
  reviewed: '已审核',
};

// 基准变更检测（REQ-20260921-012 本轮落定：磁盘 mtime 对比，纯函数）：
// 同类型文件两两对比（README.md ↔ README_<lang>.md，依次类推），默认语言文档 mtime
// **严格晚于**剩余语言文档 → 该剩余语言文档置回「未翻译」（未审核）、整体完结失效回退。
// statFile(file) → mtimeMs | null（注入解耦 fs）；mtime 缺失 / 相同不回退（mtime 为弱信号，
// 内容 hash 复核豁免按 README 待确认口径暂不做）。检测在每次求值读盘时发生，不依赖审查
// 界面的保存按钮——保存只是修改途径之一，外部编辑器 / IDE 直接落盘同样更新 mtime 被捕获。
export function detectBaselineShift(langs, statFile) {
  const stat = typeof statFile === 'function' ? statFile : () => null;
  const ls = docLangsOf({ langs });
  if (ls.length < 2) return [];
  const shifted = [];
  for (const key of PUBLISH_DOC_KEYS) {
    const baseMtime = stat(`${key}.md`);
    if (baseMtime == null || !Number.isFinite(Number(baseMtime))) continue;
    for (const lang of ls.slice(1)) {
      const file = `${key}_${lang}.md`;
      const m = stat(file);
      if (m == null || !Number.isFinite(Number(m))) continue;
      if (Number(baseMtime) > Number(m)) shifted.push(file);
    }
  }
  return shifted;
}

// 阶段状态求值（纯函数；发布文档流水线的唯一状态事实源，前端复用同口径渲染）：
//   - v.review.files[file].hash：人工「通过审核」时点的磁盘内容 sha256（build-store.recordDocsReview）；
//   - v.review.finalized：人工「整体审查完结」记录（build-store.recordDocsFinalize：
//     { at, langsKey, files }）；有效性实时求值——语言集未变（langsKey 匹配）且当前全部
//     已审核、无 scopeStale、无基准变更才算有效，任何变化即时失效回退（不固化放行）；
//   - readFile(file)：当前磁盘内容（注入解耦 fs）；
//   - marks = { summarizing, summarized, translating, translated }：AI 总结 / AI 翻译账本
//     聚合标记（docs-summary-store.summaryMarksForVer / docs-translate-store.translateMarksForVer）；
//   - opts.statFile(file) → mtimeMs | null：基准变更检测注入（缺省不做检测）。
// 判定优先级（默认语言）：正在总结 > 已审核（hash 一致且未 scopeStale）> 已总结待审核 > 未总结；
// 判定优先级（剩余语言）：基准变更回退未翻译 > 正在翻译 > 已审核 > 已翻译待审核 > 未翻译。
// scopeStale 口径沿用：发布范围变化时审核与整体完结一并失效（回退待审核），不弱化门禁。
// 输出：files（4 类 × 语言集语言数，带 isDefault 分组标识）、defaultFiles / restFiles、
// reviewedCount（合计）与分组计数、canTranslate（默认语言 4/4 已审核且存在剩余语言；
// translateMissing 为默认语言缺口明细）、baselineShift、canFinalize（4×N 全部已审核且无
// 失效源）、finalized（有效时 { at }）、canCommit（canFinalize && 完结有效——在「全部已
// 审核」门禁之上叠加完结条件，不弱化）、missing（未审核文件 + 状态）。
export function evaluateDocsFlow(v, readFile, marks = {}, opts = {}) {
  const read = typeof readFile === 'function' ? readFile : () => null;
  const scopeStale = !!(v?.docs && v.docs.scopeStale);
  const reviewFiles = (v?.review && v.review.files) || {};
  const finalRec = (v?.review && v.review.finalized) || null;
  const summarizing = new Set(marks.summarizing || []);
  const summarizedMarks = new Set(marks.summarized || []);
  const translating = new Set(marks.translating || []);
  const translatedMarks = new Set(marks.translated || []);
  const langs = docLangsOf(v);
  const defaultLang = langs[0];
  const baselineShift = new Set(detectBaselineShift(langs, opts.statFile));
  const files = publishDocFiles(langs).map((f) => {
    const isDefault = f.lang === defaultLang;
    let text = null;
    try { text = read(f.file); } catch { text = null; }
    const diskHash = text == null ? null : hashOf(text);
    const rec = reviewFiles[f.file] || null;
    const approved = !scopeStale && !!rec && diskHash != null && rec.hash === diskHash;
    let state;
    if (isDefault) {
      if (summarizing.has(f.file)) state = 'summarizing';
      else if (approved) state = 'reviewed';
      else if (summarizedMarks.has(f.file) || rec) state = 'summarized';
      else state = 'unsummarized';
    } else {
      if (baselineShift.has(f.file)) state = 'untranslated'; // 基准（默认语言）已更新：翻译过期，回退未翻译
      else if (translating.has(f.file)) state = 'translating';
      else if (approved) state = 'reviewed';
      else if (translatedMarks.has(f.file) || rec) state = 'translated';
      else state = 'untranslated';
    }
    return { ...f, isDefault, state };
  });
  const defaultFiles = files.filter((f) => f.isDefault);
  const restFiles = files.filter((f) => !f.isDefault);
  const reviewed = files.filter((f) => f.state === 'reviewed');
  const defaultReviewedCount = defaultFiles.filter((f) => f.state === 'reviewed').length;
  const restReviewedCount = restFiles.filter((f) => f.state === 'reviewed').length;
  const allReviewed = files.length > 0 && reviewed.length === files.length;
  const translateMissing = defaultFiles
    .filter((f) => f.state !== 'reviewed')
    .map((f) => ({ file: f.file, state: f.state }));
  const canTranslate = defaultFiles.length > 0 && defaultReviewedCount === defaultFiles.length && restFiles.length > 0;
  // 整体完结可用：4×N 全部已审核，且无 scopeStale / 基准变更失效源
  const canFinalize = allReviewed && !scopeStale && baselineShift.size === 0;
  // 完结记录有效：存在人工完结记录，且语言集未变、当前全部已审核、无失效源
  const finalizedOk = canFinalize && !!finalRec && finalRec.langsKey === langs.join(',');
  const missing = files
    .filter((f) => f.state !== 'reviewed')
    .map((f) => ({ file: f.file, state: f.state }));
  return {
    files,
    defaultFiles,
    restFiles,
    reviewedCount: reviewed.length,
    defaultReviewedCount,
    restReviewedCount,
    canTranslate,
    translateMissing,
    baselineShift: [...baselineShift],
    canFinalize,
    finalized: finalizedOk ? { at: finalRec.at } : null,
    canCommit: finalizedOk, // 全部已审核 + 整体审查已完结（叠加门禁，不弱化原「全部已审核」）
    missing,
    scopeStale,
  };
}

// ---------- 文档状态机（提交口径：evaluateDocsState，合并门禁沿用） ----------

const hashOf = (s) => crypto.createHash('sha256').update(String(s ?? '')).digest('hex');

// 评估发布文档状态（readFile(file) → 文本 | null，注入以便测试与真实 fs 解耦）：
//   - 无提交记录（v.docs 缺失）：已有编写内容 → overall 'uncommitted'（已写未提交），
//     完全没有 → 'none'（尚未编写）；
//   - 有记录：逐文件 state：磁盘缺失 / 内容 hash 与提交记录不一致 → 'uncommitted'（外部 IDE
//     修改或再次编辑后未提交）；范围过期（v.docs.scopeStale）→ 'needs-rewrite'；否则 'committed'；
//   - overall：uncommitted > needs-rewrite > committed（最差者胜），reasons 逐条说明。
export function evaluateDocsState(v, readFile) {
  const read = typeof readFile === 'function' ? readFile : () => null;
  const record = v?.docs || null;
  const langs = docLangsOf(v);
  const files = publishDocFiles(langs).map((f) => {
    const text = (() => { try { return read(f.file); } catch { return null; } })();
    const exists = text != null;
    const diskHash = exists ? hashOf(text) : null;
    const committedHash = record?.files?.[f.file] || null;
    let state;
    if (!record) state = 'unwritten';
    else if (!exists) state = 'uncommitted';
    else if (committedHash && diskHash === committedHash) state = 'committed';
    else state = 'uncommitted';
    if (record && record.scopeStale && state === 'committed') state = 'needs-rewrite';
    return { ...f, exists, diskHash, committedHash, state };
  });
  const reasons = [];
  if (!record) {
    const written = files.filter((f) => f.exists).length;
    reasons.push(written
      ? `已编写 ${written}/${files.length} 个文档，尚未提交到 Git（提交后才能合并）`
      : `尚未编写发布文档（README / CHANGELOG / FEATURES / AGENTS × 语言集 ${langs.join(',')} 共 ${files.length} 个文件）`);
  } else {
    if (record.scopeStale) reasons.push(`发布范围已变化（${record.staleReason || '条目或提交变化'}），文档需重新核对 / 编写后重新提交`);
    for (const f of files) {
      if (f.state === 'uncommitted') {
        reasons.push(f.exists ? `${f.file} 有未提交修改（内部编辑或外部 IDE 修改后未提交）` : `${f.file} 缺失（提交后被删除，需重新编写）`);
      }
    }
  }
  const overall = files.some((f) => f.state === 'uncommitted')
    ? 'uncommitted'
    : record?.scopeStale || files.some((f) => f.state === 'needs-rewrite')
      ? 'needs-rewrite'
      : record
        ? 'committed'
        : files.some((f) => f.exists) ? 'uncommitted' : 'none';
  return {
    files,
    overall,
    reasons,
    commitHash: record?.commitHash || null,
    committedScopeFp: record?.scopeFp || null,
    scopeStale: !!record?.scopeStale,
  };
}

// 范围指纹：所选条目 + 每条提交 hash + 文档基准（当前语言集全文件内容 hash）共同构成发布范围。
// 任一变化（增删条目 / 换 commit / 修改文档 / 语言集变化）→ 指纹变化 → 旧提交标识不放行。
export function publishScopeFingerprint(items, readFile, langs = DEFAULT_DOC_LANGS) {
  const read = typeof readFile === 'function' ? readFile : () => null;
  const part = (Array.isArray(items) ? items : [])
    .map((it) => `${it.itemId}:${String(it.commit || '').toLowerCase()}`)
    .sort();
  const docs = publishDocFiles(langs).map((f) => {
    let h = null;
    try { const t = read(f.file); h = t == null ? null : hashOf(t); } catch { h = null; }
    return `${f.file}:${h}`;
  });
  return hashOf(JSON.stringify({ items: part, docs }));
}

// ---------- 五步门禁 ----------

export const PUBLISH_STEPS = [
  { key: 'plan', label: '版本计划' },
  { key: 'link', label: '关联条目与提交' },
  { key: 'docs', label: '文档编写' },
  { key: 'merge', label: '合并入 main' },
  { key: 'release', label: '正式发布' },
];

const DOCS_GATE_TEXT = {
  none: '文档尚未编写提交（合并前置：所需文档已完成且最新变化已提交）',
  uncommitted: '文档有未提交修改，不得合并（请先提交文档）',
  'needs-rewrite': '发布范围已变化，文档需重新核对 / 编写并重新提交',
};

// 五步导航门禁（只读求值）：plan 恒可用；link / docs 在 merging / 推送完成（正式发布，
// BUG-20260920-005 基准后移：merged 未推送放开，供补关联后重新提交文档、重开合并）锁定；
// merge 需「有条目 + 文档 overall=committed + 状态可合并（draft/failed/merged 未推送）」；
// release 需 merged。locked 附 reason。
export function publishStepsState(v, docsEval) {
  const items = Array.isArray(v?.items) ? v.items : [];
  const status = v?.status || 'draft';
  const pushed = !!(v?.release && v?.release.pushedAt);
  const lockedScope = status === 'merging' || pushed;
  const canMerge = ['draft', 'failed', 'merged'].includes(status) && !pushed;
  const mergeReason = () => {
    if (status === 'merging') return '合并执行中';
    if (pushed) return '已正式发布，不可再合并（如需调整请新建版本）';
    if (!items.length) return '暂无关联条目：请先在「关联条目与提交」步骤关联';
    if (docsEval && docsEval.overall !== 'committed') return DOCS_GATE_TEXT[docsEval.overall] || '文档未就绪';
    return '';
  };
  const releaseReason = () => {
    if (status !== 'merged') return '合并入 main 完成后才能正式发布';
    return '';
  };
  return PUBLISH_STEPS.map((s) => {
    let locked = false;
    let reason = '';
    if (s.key === 'link' || s.key === 'docs') {
      locked = lockedScope;
      reason = locked ? (status === 'merging' ? '合并执行中' : '已正式发布，范围锁定（如需调整请新建版本）') : '';
    } else if (s.key === 'merge') {
      locked = !canMerge || !items.length || !docsEval || docsEval.overall !== 'committed';
      reason = mergeReason();
    } else if (s.key === 'release') {
      locked = status !== 'merged';
      reason = releaseReason();
    }
    return { ...s, locked, reason };
  });
}
