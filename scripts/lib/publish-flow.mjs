// REQ-20260920-003 构建和发布流程整改 —— 发布流程纯逻辑层（publish-flow）。
// 只做无副作用计算与可注入读取的求值（fs 读取经注入函数传入），供 server.mjs / build-store /
// 前端提示词装配复用；不直写任何 git / 状态文件。
// 覆盖口径（README 落定）：
//   - 版本号：从计划编号后两段提取（BLD-20260920-001 → 20260920-001），保留前导零，
//     界面各处复用同一提取，不另让用户重复输入；
//   - 发布文档：README / CHANGELOG / FEATURES / AGENTS 四类 × 语言集（REQ-20260921-010，
//     默认 cn,en，可配置）动态展开 + LICENSE 单文件（REQ-20260922-002，A1 口径不随语言集、
//     不进 AI 总结 / 翻译）+ 自定义文档（REQ-20260922-003 引入；BUG-20260922-002 起随语言集
//     自动展开——默认语言 KEY.md + 其余语言 KEY_<lang>.md，其余语言进 AI 翻译，门禁 / pathspec /
//     指纹 / 基准变更检测全参与，与标准 4 类同口径）；README 按语言链接 CHANGELOG 与 FEATURES（同语言互链）；
//   - AI 总结提示词（REQ-20260921-007 前旧称 AI 写作提示词）：技术写作人员角色 + 子代理流程 +
//     项目路径 / 计划号 / 版本号 / 关联范围 / 文档清单 / 写作约束（简练通俗、不罗列原文、
//     不编造）；关联范围不内嵌条目标题（BUG-20260921-005）：REQ 仅列编号 + 条目文件路径规则
//     引导自行读取，BUG 汇总一句；
//   - AI 翻译提示词（REQ-20260921-012）：以已审核默认语言文档为唯一基准，产出剩余语言
//     全部文档（atb translate 逐文件回执）；
//   - 官网提示词：在官网仓库执行、读已发布版本 CHANGELOG / FEATURES 双语材料、提交消息带
//     完整计划号，不强制官网技术栈；
//   - 计划号匹配：完整计划号 + 标识边界（BLD-20260920-0010 不冒充 BLD-20260920-001）；
//   - 官网检测：仅提交者时间不早于推送成功时间（含等于边界）的提交参与匹配；起点缺失 →
//     waiting（缺少推送完成时间，待核对），不做全历史扫描；预算未读完窗口 → scanning
//     （本轮检测未完成，不当未命中）；窗口读完无命中 → missed；命中 → hit 带证据；
//   - 文档状态机（两阶段七态 + 基准变更检测 + 全审提交门禁，REQ-20260921-012 /
//     BUG-20260926-002 去除整体审查阶段）：见 evaluateDocsFlow 注释；提交口径状态机 /
//     五步门禁：见 evaluateDocsState / publishStepsState 注释。

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
// REQ-20260922-002 单文件类（A1 口径）：LICENSE 恒单文件 LICENSE.md，不随语言集展开
//（无 LICENSE_<lang>.md，许可证文本不翻译）；仅人工在审查对话框编写（口径 B：不进 AI
// 总结 / AI 翻译），参与状态机与门禁计数（口径 C：必选）。
export const PUBLISH_DOC_SINGLE_KEYS = ['LICENSE'];
// 默认语言集按需求原文 cn,en；语言缩写以国际规范为准（2–3 个字母），cn / zh、jp / ja 均合法。
export const DEFAULT_DOC_LANGS = ['cn', 'en'];

// REQ-20260922-003 自定义发布文档（文档编写页添加，可多份）。BUG-20260922-002 起随语言集
// 自动展开（与标准 4 类同构）：默认语言 <KEY>.md + 其余语言 <KEY>_<lang>.md，添加一次即全
// 语种就位；其余语言文件进 AI 翻译（基准 = 默认语言 <KEY>.md）；默认语言份进 AI 总结；七态
// 状态机、「通过审核」hash、全审提交门禁、pathspec、范围指纹与基准变更检测全参与。
// 命名与上限口径（design.md 落定）：字母开头 + 字母 / 数字 / 连字符 / 下划线，≤40 字符，
// .md 后缀可省略自动补全，大写归一；保留名 = 标准 4 类 / LICENSE 及其 _lang(2–3 字母)
// 后缀形态（防语言集变化后撞名）；上限 20 份；不支持子目录。
export const CUSTOM_DOC_MAX = 20;
export const CUSTOM_DOC_KEY_MAX = 40;
const CUSTOM_DOC_KEY_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const RESERVED_DOC_KEY_RE = /^(?:README|CHANGELOG|FEATURES|AGENTS|LICENSE)(?:_[A-Za-z]{2,3})?$/;

// 版本记录 v.customDocs 容错读取 + 归一（大写 / 去重保序 / 过滤非法；读取宽容不抛错，
// 非法历史数据静默剔除——写入侧 addCustomDoc / normalizeCustomDocName 才是权威校验）。
export function customDocsOf(v) {
  const raw = v?.customDocs;
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const x of raw) {
    const key = String(x ?? '').trim().toUpperCase();
    if (!CUSTOM_DOC_KEY_RE.test(key) || key.length > CUSTOM_DOC_KEY_MAX || RESERVED_DOC_KEY_RE.test(key)) continue;
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

// 自定义文档按语言集展开的文件名清单（与标准 4 类同构：首语言无后缀，其余 _lang）。
export function customDocFilesOf(key, langs = DEFAULT_DOC_LANGS) {
  const ls = docLangsOf({ langs });
  return ls.map((lang, i) => ({ key, lang, file: `${key}${i === 0 ? '' : `_${lang}`}.md`, custom: true }));
}

// BUG-20260922-002 清单级展开冲突检测：任一 KEY 展开出的文件名与另一 KEY 的展开文件
// 大小写不敏感重名即冲突（MIGRATION_EN.md ↔ MIGRATION_en.md；大小写不敏感文件系统同文件）。
// 供 normalizeCustomDocName（新 KEY 与既有清单比对）与 saveDocLangs（语言集扩展后既有清单
// 自查）共用；无冲突返回 null。
export function customDocsExpandConflict(customDocs, langs = DEFAULT_DOC_LANGS) {
  const keys = customDocsOf({ customDocs });
  const seen = new Map(); // lowerFile -> key
  for (const key of keys) {
    for (const { file } of customDocFilesOf(key, langs)) {
      const low = file.toLowerCase();
      if (seen.has(low)) return { a: key, b: seen.get(low), file };
      seen.set(low, key);
    }
  }
  return null;
}

// 自定义文档命名校验（服务端权威；前端 build.js validateCustomDocName 同口径镜像）：
// 返回 { key }（大写）或 { key: null, error }；existing = 已有自定义清单（大写 KEY）；
// langs = 当前语言集（展开重名比对用，缺省默认 cn,en）。
export function normalizeCustomDocName(raw, { existing = [], langs = DEFAULT_DOC_LANGS } = {}) {
  let name = String(raw ?? '').trim();
  const emptyErr = { key: null, error: '文件名不能为空（如 MIGRATION.md）' };
  if (!name) return emptyErr;
  if (/\.md$/i.test(name)) name = name.slice(0, -3);
  if (!name) return emptyErr;
  if (name.length > CUSTOM_DOC_KEY_MAX) return { key: null, error: `文件名过长（上限 ${CUSTOM_DOC_KEY_MAX} 字符）` };
  if (!CUSTOM_DOC_KEY_RE.test(name)) {
    return { key: null, error: '存在非法字符：仅允许字母开头，字母 / 数字 / 连字符 / 下划线（.md 后缀可省略，自动补全；不支持子目录）' };
  }
  const key = name.toUpperCase();
  if (RESERVED_DOC_KEY_RE.test(key)) {
    return { key: null, error: `与标准发布文档重名：${key}（README / CHANGELOG / FEATURES / AGENTS / LICENSE 及 _语言 后缀为保留名）` };
  }
  const have = (Array.isArray(existing) ? existing : []).map((x) => String(x ?? '').trim().toUpperCase());
  if (have.includes(key)) return { key: null, error: `自定义文档重复：${key}.md 已在清单中` };
  if (have.length >= CUSTOM_DOC_MAX) return { key: null, error: `超出自定义文档数量上限（${CUSTOM_DOC_MAX} 份）` };
  // BUG-20260922-002 展开重名：自定义文档添加一次即随语言集自动展开（MIGRATION →
  // MIGRATION.md + MIGRATION_en.md），逐语种手工添加的 workaround（如 MIGRATION_EN）展开后
  // 与既有 KEY 的语言文件重名，直接拦截（大小写不敏感）。
  const conflict = customDocsExpandConflict([...have, key], langs);
  if (conflict && (conflict.a === key || conflict.b === key)) {
    const other = conflict.a === key ? conflict.b : conflict.a;
    return { key: null, error: `自定义文档重复：${key}.md 展开后与自定义文档 ${other} 的 ${conflict.file} 重名（自定义文档添加一次即随语言集自动展开）` };
  }
  return { key };
}

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

// 文档清单 = 4 类 × 语言集全部语言 + 单文件类（REQ-20260922-002）：第一个语言（默认语言）
// 不带后缀，其余 <KEY>_<lang>.md（REQ-20260921-010 需求原文命名；存量 <KEY>.en.md 点号命名
// 不迁移、不并存识别）；单文件类（LICENSE）恒 <KEY>.md、lang=null、single=true，追加在末尾。
// BUG-20260922-002：自定义文档（customDocs = 大写 KEY 数组）随语言集自动展开（与标准 4 类
// 同构：默认语言 <KEY>.md + 其余 <KEY>_<lang>.md），逐 KEY 追加在末尾；不传 / 空数组时输出
// 与既有口径逐字节一致（不回归）。
export function publishDocFiles(langs = DEFAULT_DOC_LANGS, customDocs = []) {
  const ls = docLangsOf({ langs });
  const out = [];
  for (const key of PUBLISH_DOC_KEYS) {
    ls.forEach((lang, i) => {
      out.push({ key, lang, file: `${key}${i === 0 ? '' : `_${lang}`}.md` });
    });
  }
  for (const key of PUBLISH_DOC_SINGLE_KEYS) {
    out.push({ key, lang: null, file: `${key}.md`, single: true });
  }
  for (const key of customDocsOf({ customDocs })) {
    out.push(...customDocFilesOf(key, ls));
  }
  return out;
}

export function docFileOf(key, lang, langs = DEFAULT_DOC_LANGS, customDocs = []) {
  const k = String(key || '').trim().toUpperCase();
  if (PUBLISH_DOC_SINGLE_KEYS.includes(k)) return `${k}.md`; // 单文件类不带语言后缀（A1）
  const isCustom = customDocsOf({ customDocs }).includes(k);
  const l = String(lang || '').trim().toLowerCase();
  const idx = docLangsOf({ langs }).indexOf(l);
  if (!(isCustom || PUBLISH_DOC_KEYS.includes(k)) || idx < 0) return null;
  // BUG-20260922-002：自定义文档与标准 4 类同构按语言展开（不再恒单文件）
  return `${k}${idx === 0 ? '' : `_${l}`}.md`;
}

export function isPublishDocFile(file, langs = DEFAULT_DOC_LANGS, customDocs = []) {
  const name = String(file || '').trim();
  return publishDocFiles(langs, customDocs).some((f) => f.file === name);
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

// BUG-20260928-009 语言切换行（引入来源 REQ-20260921-012：两阶段流水线提示词无切换行要求，
// REQ-20260918-001 手工切换行随 AI 总结整体重写丢失）：同一 KEY 的语言集全互链行——
//   [中文](./README.md) | [English](./README_en.md)
// 首语言（默认语言）不带后缀、其余 <KEY>_<lang>.md；语言显示名复用 langNameOf（LANG_NAMES，
// 未命中回退缩写），语言集扩展时随语言集动态生成。关键性质：同一 KEY 的所有语言变体中该行
// 完全一致（各链接分别指向对应语言文件）——翻译轮直接镜像基准行，无需任何改写。
// 三处提示词（总结 / 翻译 / 校对）共用本生成器产出示例行。
export function docLangSwitchLine(key, langs = DEFAULT_DOC_LANGS) {
  const k = String(key || '').trim().toUpperCase();
  const ls = docLangsOf({ langs });
  return ls.map((lang, i) => `[${langNameOf(lang)}](./${k}${i === 0 ? '' : `_${lang}`}.md)`).join(' | ');
}

// 默认语言 / 剩余语言清单（REQ-20260921-012 阶段划分依据）：默认语言 = 语言集首语言
//（文件不带后缀）；剩余语言 = 其余语言（<KEY>_<lang>.md，AI 翻译产出范围）。
// REQ-20260922-002 口径 B：单文件类（LICENSE）不进 AI 总结 / 翻译范围，两清单均排除
// single 条目（defaultDocFiles 按 lang === 首语言天然排除；restDocFiles 显式排除 lang=null）。
// BUG-20260922-002：自定义文档随语言集展开后天然分流——默认语言 <KEY>.md 进 AI 总结
//（defaultDocFiles），其余语言 <KEY>_<lang>.md 进 AI 翻译（restDocFiles），与标准 4 类同口径。
export function defaultDocFiles(langs = DEFAULT_DOC_LANGS, customDocs = []) {
  const ls = docLangsOf({ langs });
  return publishDocFiles(ls, customDocs).filter((f) => f.lang === ls[0]);
}
export function restDocFiles(langs = DEFAULT_DOC_LANGS, customDocs = []) {
  const ls = docLangsOf({ langs });
  return publishDocFiles(ls, customDocs).filter((f) => f.lang != null && f.lang !== ls[0]);
}

// ---------- 提示词装配 ----------

const shortHash = (h) => String(h || '').slice(0, 12);

// BUG-20260921-005 关联范围精简（AI 总结 / AI 翻译同口径）：不再逐条内嵌条目标题。
// REQ 条目仅列编号，并以路径规则引导子代理按编号自行读取条目说明文件（项目路径已在
// 提示词头部给出，文件在磁盘可达）；BUG 条目对写作 / 翻译语境价值低，不逐条罗列、
// 不引导读取，统一汇总为一句「修复了 N 个 bug」。条目编号形态经 build-store 校验
// 必为 REQ-/BUG- 前缀；防御起见非 BUG 前缀一律按 REQ 清单处理。
function docScopeLines(items = []) {
  const lines = [];
  const reqIds = [];
  let bugCount = 0;
  for (const it of items || []) {
    const id = String(it?.itemId || '').trim();
    if (!id) continue;
    if (id.startsWith('BUG-')) bugCount += 1;
    else reqIds.push(id);
  }
  for (const id of reqIds) lines.push(`- ${id}`);
  if (bugCount > 0) lines.push(`- 修复了 ${bugCount} 个 bug（BUG 条目不逐条展开）`);
  if (reqIds.length > 0) {
    lines.push('需求详情按上列编号自行读取条目说明文件：<项目根>/agent-team-board/data/requirements/<REQ-ID>/（README.md、design.md 等），了解本版语境；Bug 修复无需逐条了解。');
  }
  return lines;
}

// AI 总结提示词（REQ-20260921-008，原 buildDocWritingPrompt 更名并按新工作流调整；
// REQ-20260921-012 范围收窄为阶段一：仅默认语言 4 文件）：
// 主会话派发给「技术写作人员」角色的子代理，逐文件总结当前版本发布文档的**默认语言**
//（语言集首语言）四个文件；子代理经 atb summary CLI 逐文件回执进度（正在总结 → 已总结
// 待审核），完成后交短回执。剩余语言文档由阶段二 AI 翻译（buildDocTranslatePrompt）产出，
// 不在本提示词范围内。
// REQ-20260921-006 提示词缓存命中优化：重组为「静态段在前 + 尾部运行参数区」——角色/阶段说明/
// 恒定回执命令段（<执行编号>/<文件名> 占位）/写作约束构成稳定公共前缀（有无 runId 均恒定形态）；
// 项目路径、计划号/版本号、执行编号、CLI 入口、默认语言文档清单、关联范围清单收敛到尾部参数区。
// 回执命令、CLI 参数与语义不变。REQ-20260922-003：静态段中的文档总数与构成说明随清单联动
//（含自定义文档；无自定义时与既有提示词逐字节一致），文档清单本体仍在尾部参数区。
// BUG-20260928-007：版本号同源——优先取调用方传入的计划 x.y.z version（REQ-20260922-006），
// 未传 / 存量计划（无 version 字段）沿用计划编号派生口径（YYYYMMDD-NNN，旧数据不迁移）。
export function buildDocSummaryPrompt({ projectRoot, planId, items = [], runId = null, langs = DEFAULT_DOC_LANGS, customDocs = [], atbPath = 'node scripts/atb.mjs', version = null } = {}) {
  const ver = version || versionNumberOf(planId) || planId;
  const ls = docLangsOf({ langs });
  const docFiles = defaultDocFiles(ls, customDocs);
  // REQ-20260922-003：默认语言文档清单 = 标准 4 类 + 全部自定义文档；总数与构成说明随清单
  //联动（无自定义时保持原文「4 个文档（4 类 × 1）」，与既有提示词逐字节一致）。
  const customCount = docFiles.filter((f) => f.custom).length;
  const shapeText = customCount > 0
    ? `${PUBLISH_DOC_KEYS.length} 类 + ${customCount} 自定义 × 1`
    : `${PUBLISH_DOC_KEYS.length} 类 × 1`;
  const readmePair = 'README.md → CHANGELOG.md / FEATURES.md';
  // BUG-20260928-009：语言切换行进总结约束——默认语言产物在首行一级标题下生成切换行（语言集内
  // 全互链），重写既有文档时保留（跨轮稳定）；翻译 / 校对轮对应镜像 / 核查（见各自提示词）。
  // 静态前缀口径（REQ-20260921-006）：约束行不含语言集相关内容（语言名 / 变体文件名），具体
  // 切换行随语言集在尾部运行参数区给出；无自定义文档时不出现「自定义」字样（REQ-20260922-003
  // 字节稳定口径），自定义文档同口径仅在清单含自定义时点明。
  const switchCustomNote = customCount > 0 ? '（自定义文档同口径）' : '';
  const common = [
    `你是技术写作人员，以子代理身份完成当前版本发布文档的 AI 总结任务（阶段一：默认语言先行）；主会话只派发本提示词并接收短回执，不在此展开代码修改。`,
    `本阶段只总结默认语言（语言集首语言，见运行参数）的 ${docFiles.length} 个文档（${shapeText}）；语言集的其余语言文档待默认语言全部人工审核后由「AI 翻译」产出，不在本轮总结范围（文档清单见运行参数）。`,
    '关联范围按实际代码与提交核实变化，不简单罗列需求 / Bug 原文（清单见运行参数）。',
    '',
    '逐文件进度回执（在项目根执行；atb 指运行参数「CLI 入口」给出的命令，下同）：',
    '1. 开始总结某文件：atb summary file <执行编号> --file <文件名> --state summarizing',
    '2. 该文件总结完成：atb summary file <执行编号> --file <文件名> --state summarized',
    '3. 全部完成：atb summary done <执行编号> --summary "<一两句要点>"',
    '4. 中断 / 无法完成：atb summary fail <执行编号> --reason "<短句原因>"',
    `已审核（reviewed）的文件跳过不再总结；不修改本阶段 ${docFiles.length} 个文档以外的任何文件。`,
    '',
    '写作约束：',
    '- 文字简练、通俗易懂：说明用户能做什么、使用方式与本次变化；不得编造已实现能力。',
    `- README 按语言链接同语言 CHANGELOG 与 FEATURES（${readmePair}），链接必须真实可达。`,
    `- 语言切换行：每个文档在首行一级标题下加一行语言切换行，语言集内全互链且同一文档的各语言变体中该行完全一致${switchCustomNote}，行内容按运行参数「语言切换行」以本 KEY 对应语言文件名生成，链接必须真实可达；重写 / 总结既有文档时保留该行。`,
    '- AGENTS 只描述适用协作规则，不把营销说明写成执行规则。',
    '- 文档与当前版本范围一致：未纳入本版发布的功能不得写成已发布。',
    '- 完成后以短回执汇报（哪些文件已总结 / 关键结论），不粘贴全文。',
  ];
  const params = [
    '运行参数（随任务变化，命令占位符以本区实际值为准）：',
    `项目路径：${projectRoot || '（未提供）'}`,
    `发布计划号：${planId}（版本号 ${ver}）`,
    `执行编号：${runId || '（未提供——进度回执命令需执行编号，请先经看板启动 AI 总结获取）'}`,
    `CLI 入口：${atbPath}`,
    `默认语言文档清单（语言集首语言 ${ls[0]}，共 ${docFiles.length} 个文档，${shapeText}）：`,
    ...docFiles.map((f) => (f.custom
      ? `- ${f.file}（${langNameOf(ls[0])} / 自定义）`
      : `- ${f.file}（${langNameOf(f.lang)} / ${f.key}）`)),
    // BUG-20260928-009：具体切换行随语言集在此给出（以 README 为例，各文档按本 KEY 对应语言
    // 文件名同构）——置于运行参数区，保持静态前缀跨语言集逐字一致（REQ-20260921-006）。
    `语言切换行（以 README 为例，各文档按本 KEY 对应语言文件名同构）：${docLangSwitchLine('README', ls)}`,
    '关联范围（按实际代码与提交核实变化，不简单罗列需求 / Bug 原文）：',
    ...docScopeLines(items),
  ];
  return [...common, '', ...params].join('\n');
}

// AI 翻译提示词（REQ-20260921-012 阶段二；BUG-20260923-003 口径重构）：以**已人工审核的
// 默认语言文档磁盘内容为唯一翻译基准**——提示词不内嵌文档全文（原 readFile 注入口径废弃，
// 避免提示词体积随文档长度线性膨胀），只给出基准 → 目标文件名对应清单与项目路径，各子代理
// 翻译时自行读盘（= 翻译时点最新已审核内容，等效且不旧于启动快照；启动前基准变更检测
// baselineShift 口径不变）。BUG-20260923-003：不再携带关联范围条目单号（items 不进入翻译
// 提示词，AI 总结阶段一口径不动）；派发口径由整批串行改为「每个目标文件一个子代理、全部
// 并行（并行子代理数 = 目标文件数，不设上限）」，每个子代理只负责翻译自己名下的一个文件
//（读自己名下基准 → 写自己名下目标 → 逐文件回执）。目标范围仍为剩余语言全部文件
//（4 × (N−1)，含自定义文档其余语言份，单文件类 LICENSE 不进范围）；回执命令、账本、
// translate.lock 与门禁行为不变；不得引入基准外信息、不得编造。
// BUG-20260928-007：版本号同源（口径同 buildDocSummaryPrompt）——优先取调用方传入的计划
// x.y.z version（REQ-20260922-006），未传 / 存量计划沿用计划编号派生口径（YYYYMMDD-NNN）。
export function buildDocTranslatePrompt({ projectRoot, planId, runId = null, langs = DEFAULT_DOC_LANGS, customDocs = [], atbPath = 'node scripts/atb.mjs', version = null } = {}) {
  const ver = version || versionNumberOf(planId) || planId;
  const ls = docLangsOf({ langs });
  // BUG-20260922-002：自定义文档随语言集展开后进入 AI 翻译——基准为其默认语言 <KEY>.md，
  // 目标为其剩余语言 <KEY>_<lang>.md（与标准 4 类同口径）。
  const targets = restDocFiles(ls, customDocs);
  const customTargetCount = targets.filter((f) => f.custom).length;
  const targetShape = customTargetCount > 0
    ? `${PUBLISH_DOC_KEYS.length} 类 + ${customTargetCount} 自定义 × ${ls.length - 1} 语言`
    : `${PUBLISH_DOC_KEYS.length} 类 × ${ls.length - 1} 语言`;
  const lines = [];
  lines.push(`你是发布文档 AI 翻译任务的派发协调者，负责「${planId}」（版本号 ${ver}）的翻译派发（阶段二：默认语言已全部人工审核）：对下列每个目标文件各派发一个子代理，全部并行（并行子代理数 = 目标文件数，不设上限），每个子代理只负责翻译自己名下的一个文件；派发与回执之外不展开代码修改。`);
  lines.push('');
  lines.push(`项目路径：${projectRoot || '（未提供）'}`);
  lines.push(`发布计划号：${planId}（版本号 ${ver}）`);
  if (runId) lines.push(`执行编号：${runId}`);
  lines.push('');
  lines.push(`翻译基准（唯一基准——已人工审核的默认语言 ${ls[0]} 文档，语义以基准文件为准，不得引入基准外信息，不得编造）：`);
  lines.push(`基准文档全文不内嵌于本提示词：各子代理翻译前自行读取项目路径下基准文件的磁盘内容（即翻译时点磁盘上的最新已审核内容）；基准文件缺失时该子代理跳过翻译并在回执中说明，不得编造基准内容。`);
  lines.push(`目标文件与基准文件对应（左基准 → 右目标，均在项目路径下，共 ${targets.length} 个目标文件，${targetShape}，剩余语言 ${ls.slice(1).join(',')}）：`);
  for (const f of targets) lines.push(`- ${f.key}.md → ${f.file}（${langNameOf(f.lang)} / ${f.key}${f.custom ? ' / 自定义' : ''}）`);
  lines.push('');
  if (runId) {
    lines.push('派发与逐文件进度回执（各子代理在项目根执行自己名下文件的回执命令；atb 指 ' + atbPath + '，下同）：');
    lines.push(`1. 子代理开工先回执：atb translate file ${runId} --file <自己名下文件名> --state translating`);
    lines.push(`2. 该文件翻译完成（先写盘再回执）：atb translate file ${runId} --file <文件名> --state translated`);
    lines.push(`3. 全部子代理完成后收尾：atb translate done ${runId} --summary "<一两句要点>"`);
    lines.push(`4. 某文件中断 / 无法完成：atb translate fail ${runId} --reason "<短句原因>"`);
    lines.push(`已审核（reviewed）的目标文件跳过不再派发；每个子代理只读取自己名下的基准文件、只写自己名下的目标文件，不修改上述 ${targets.length} 个目标文档与基准文档以外的任何文件。`);
    lines.push('');
  }
  lines.push('翻译约束：');
  lines.push('- 以基准文档为唯一翻译基准：与默认语言语义一致，不增删信息，不得编造能力或范围。');
  lines.push('- 各剩余语言行文地道（README / CHANGELOG 面向用户，AGENTS 为协作规则），结构与基准对应。');
  lines.push(`- README 按语言链接同语言 CHANGELOG 与 FEATURES（${ls.slice(1).map((l) => `README_${l}.md → CHANGELOG_${l}.md / FEATURES_${l}.md`).join('；')}），链接必须真实可达。`);
  // BUG-20260928-009：语言切换行镜像规则——切换行是「不增删信息」约束的显式例外（固定结构）；
  // 该行本身已按语言变体互链（各语言变体中完全一致），翻译轮直接镜像、无需改写，
  // 与下方「文内链接只改目标不改文本」口径（BUG-20260923-004）合并表述。
  lines.push(`- 语言切换行：基准首行一级标题下的语言切换行属固定结构，不视为基准外新增信息——目标文档在同样位置保留与基准完全一致的该行（如 ${docLangSwitchLine('README', ls)}）；该行链接已按各语言变体互链，直接镜像基准行、不改写链接文本。`);
  // BUG-20260923-004：文内链接重定向只改目标、不改文本——「链接必须真实可达」曾诱导 AI 把
  // 同语言变体目标文件名连文本一起改写（[AGENTS.md](./AGENTS.md) → [AGENTS_en.md](./AGENTS_en.md)）；
  // 补约束：可见链接文本保持基准原文，不把带语言后缀的文件名写进链接文本。
  const restLangs = ls.slice(1);
  if (restLangs.length) {
    const ex = restLangs[0];
    lines.push(`- 文内链接指向同语言变体文件时（如 AGENTS.md → AGENTS_${ex}.md）只改链接目标：可见链接文本保持基准原文（如 [AGENTS.md](./AGENTS_${ex}.md)），不得把带语言后缀的文件名写进链接文本。`);
  }
  // BUG-20260928-003：图片引用按语种对齐——基准引用 <name>.png（默认语言图）时目标语言对应
  // <name>_<lang>.png（<name>.png 与 <name>_en.png 的既有惯例）。
  // BUG-20260928-008：措辞消歧——「不存在则保持基准原引用」曾被读作保持默认语言引用（英文文档
  // 配中文截图）；明确口径：本地图片引用一律改写为 <name>_<lang>.<原扩展名> 语种变体（仅文件名
  // 加语种后缀，不改扩展名、不换基名），图片文件缺失不阻塞、由用户自行检查补图，不虚构图片文件。
  if (restLangs.length) {
    lines.push(`- 图片引用语种对齐：目标文档引用的本地图片一律与目标语言对应——基准引用 image/foo.png（默认语言图）时，目标语言文档对应引用一律改写为 image/foo_<目标语言>.png（仅文件名加语种后缀、不改扩展名、不换基名，不得指向不同基名的其他文件；<name>.png 与 <name>_en.png 的既有惯例）；对应语种图片文件是否存在不影响引用改写（不阻塞、不强求，界面显示不出图片由用户自行检查补图），不得虚构图片文件。`);
  }
  lines.push('- 文档与当前版本范围一致：未纳入本版发布的功能不得写成已发布。');
  lines.push('- 完成后以短回执汇报（哪些文件已翻译 / 关键结论），不粘贴全文。');
  return lines.join('\n');
}

// AI 校对提示词（REQ-20260924-001 整体审查自动检查之三）：派发给「校对人员」角色的子代理，
// 逐文件核查**默认语言**（语言集首语言）发布文档的错别字与语言习惯行文规范；校对只读不改
// 文档（不修改、不提交），结果经 atb docscheck CLI 逐文件回执（pass / fail + issues 问题
// 清单），账本落盘供看板轮询展示——核查结果自动上报。提示词形态沿用「静态段在前 + 尾部
// 运行参数区」缓存优化（REQ-20260921-006）：有无 runId 均恒定形态。
// BUG-20260928-007：版本号同源（口径同 buildDocSummaryPrompt）——优先取调用方传入的计划
// x.y.z version（REQ-20260922-006），未传 / 存量计划沿用计划编号派生口径（YYYYMMDD-NNN）。
export function buildDocProofreadPrompt({ projectRoot, planId, runId = null, langs = DEFAULT_DOC_LANGS, customDocs = [], atbPath = 'node scripts/atb.mjs', version = null } = {}) {
  const ver = version || versionNumberOf(planId) || planId;
  const ls = docLangsOf({ langs });
  const docFiles = publishDocFiles(ls, customDocs).filter((f) => f.lang === ls[0] && !f.single);
  const customCount = docFiles.filter((f) => f.custom).length;
  const shapeText = customCount > 0
    ? `${PUBLISH_DOC_KEYS.length} 类 + ${customCount} 自定义`
    : `${PUBLISH_DOC_KEYS.length} 类`;
  const common = [
    `你是校对人员，以子代理身份完成当前版本发布文档的 AI 校对任务（默认语言文档的错别字与语言习惯行文规范核查）；主会话只派发本提示词并接收短回执，不在此展开代码修改。`,
    `本任务只校对默认语言（语言集首语言，见运行参数）的 ${docFiles.length} 个文档（${shapeText}）；逐文件读取磁盘内容核查，逐文件回执结果（清单见运行参数）。`,
    '',
    '逐文件进度与结果回执（在项目根执行；atb 指运行参数「CLI 入口」给出的命令，下同）：',
    '1. 开始核查某文件：atb docscheck file <执行编号> --file <文件名> --state checking',
    '2. 该文件无问题：atb docscheck file <执行编号> --file <文件名> --state pass',
    '3. 该文件发现问题：atb docscheck file <执行编号> --file <文件名> --state fail --issues "<问题清单：每条问题独立一行、以行号开头（如：第 12 行：原文「××」→ 建议「××」），≤2000 字>"',
    '4. 全部完成：atb docscheck done <执行编号> --summary "<一两句要点（发现几处问题、严重程度）>"',
    '5. 中断 / 无法完成：atb docscheck fail <执行编号> --reason "<短句原因>"',
    '',
    '校对约束：',
    '- 只读核查：不修改、不保存、不提交任何文档或代码文件；发现问题只回执，不代改。',
    // REQ-20260924-004 口径 a：--issues 回执格式约束——每条问题独立成行、行号开头（界面按行
    // 拆分逐条展示并提供「修改」跳转；账本仍存整段文本，兼容既有 run）
    `- 回执格式：--issues 内每条问题独立一行、以行号开头（如「第 12 行：原文「××」→ 建议「××」」），条与条直接换行分隔；无行号的条目也独立成行（行首写「（无行号）：」），不空行、不整段连排、不加前后缀说明。`,
    `- 检查项：错别字（同音 / 形近 / 多字漏字）、语法与标点、${langNameOf(ls[0])}语言习惯与行文规范（面向用户的发布文档文体），不重写文风、不评判内容取舍。`,
    // REQ-20260924-006：链接有效性进校对范围；无法验证的链接（网络不可达 / 需要登录）必须
    // 与「确定失效」区分——一律标「待确认」，不得判成有效或确定失效（外链验证的超时 /
    // 重定向 / 登录态判定策略待定，先要求如实标注，不猜测）。
    '- 链接核查：逐一核查文档内可见超链接的有效性；网络不可达或需要登录才能验证的链接一律标注「待确认」，不得判为有效或确定失效（无法验证时如实标注，不猜测）。',
    // BUG-20260928-003：图片引用语种一致性进校对范围——默认语言文档应引用默认语言图片
    //（文件名不带语种后缀），引用了其他语种图片的必须在校对结果中显式提示（行号 + 引用
    // 路径 + 期望），交由用户确认处理；只读不改口径不变，图片文件是否存在不在判定范围。
    `- 图片语种核查：逐一核查文档内本地图片引用的语种一致性——默认语言（${langNameOf(ls[0])}）文档应引用默认语言图片（文件名不带语种后缀，如 foo.png）；引用了其他语种图片（如 foo_en.png）的必须按上述回执格式以问题形式显式提示（行号 + 引用路径 + 期望的默认语言图片），交由用户确认处理；图片文件是否存在不在判定范围，不强求改写。`,
    // BUG-20260928-009：语言切换行存在性与链接正确性进校对范围——切换行缺失 / 语言集不全 /
    // 链接目标不指向本 KEY 各语言变体文件的必须显式报问题（只读不改口径不变）。
    `- 语言切换行核查：默认语言文档首行一级标题下应有语言切换行（语言集内全互链、各语言变体中该行完全一致，如 ${docLangSwitchLine('README', ls)}；链接目标为本 KEY 的各语言变体文件，如 CHANGELOG 文档对应 CHANGELOG.md / ${ls.slice(1).map((l) => `CHANGELOG_${l}.md`).join(' / ')}）；该行缺失、语言集不全或链接目标不正确的必须按上述回执格式以问题形式显式提示，交由用户确认处理。`,
    '- 不编造问题：每条问题必须给出可定位的行号或原文片段与修改建议；拿不准的不报。',
    '- 不评价技术内容正确性（范围一致性由人工逐文件审查负责），只做语言文字层面核查。',
    '- 完成后以短回执汇报（哪些文件 pass / fail、共几处问题），不粘贴全文。',
  ];
  const params = [
    '运行参数（随任务变化，命令占位符以本区实际值为准）：',
    `项目路径：${projectRoot || '（未提供）'}`,
    `发布计划号：${planId}（版本号 ${ver}）`,
    `执行编号：${runId || '（未提供——结果回执命令需执行编号，请先经看板启动 AI 校对获取）'}`,
    `CLI 入口：${atbPath}`,
    `默认语言校对清单（语言集首语言 ${ls[0]}，共 ${docFiles.length} 个文档，${shapeText}）：`,
    ...docFiles.map((f) => (f.custom
      ? `- ${f.file}（${langNameOf(ls[0])} / 自定义）`
      : `- ${f.file}（${langNameOf(f.lang)} / ${f.key}）`)),
  ];
  return [...common, '', ...params].join('\n');
}

// 官网 AI 总结提示词（REQ-20260921-007 前旧称官网 AI 写作提示词）：在官网仓库执行；读取本项目
// 已发布版本的 CHANGELOG / FEATURES 中英文材料，按官网自身架构更新内容；完成提交消息带完整计划号。
// 不强制官网技术栈 / 目录 / 构建。
// BUG-20260928-006：版本号同源——优先取调用方传入的计划 x.y.z version（REQ-20260922-006），
// 未传 / 存量计划（无 version 字段）沿用计划编号派生口径（YYYYMMDD-NNN，旧数据不迁移）。
export function buildSiteWritingPrompt({ projectRoot, siteRoot, planId, baseline = null, version = null } = {}) {
  const ver = version || versionNumberOf(planId) || planId;
  const lines = [];
  lines.push(`你是技术写作人员，在官网仓库（${siteRoot || '（未提供）'}）内完成「${planId}」（版本号 ${ver}）的官网同步。`);
  lines.push('');
  lines.push(`项目仓库（已发布基准${baseline ? ` ${shortHash(baseline)}` : ''}）：${projectRoot || '（未提供）'}`);
  lines.push(`发布计划号：${planId}（版本号 ${ver}）`);
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
// 阶段收口（BUG-20260926-002）：4×N + 单文件全部已审核 → 提交解锁（无整体审查阶段）。
// REQ-20260922-002 单文件类三态（不进 AI，仅人工编写审查）：
//   未编写 ──(审查对话框人工编写保存)──▶ 待审核 ──(人工通过审核)──▶ 已审核
//     │                                                        │
//     └──────────────(文件在盘即视为已编写)──────────────────────┤
//                        已审核 ──(再次编辑修改 / 删盘)──▶ 回到待审核
export const DOCS_FLOW_STATES = [
  'unsummarized', 'summarizing', 'summarized',
  'untranslated', 'translating', 'translated',
  'reviewed',
  'unwritten', 'pending',
];
export const DOCS_FLOW_LABEL = {
  unsummarized: '未总结', summarizing: '正在总结', summarized: '已总结待审核',
  untranslated: '未翻译', translating: '正在翻译', translated: '已翻译待审核',
  reviewed: '已审核',
  unwritten: '未编写', pending: '待审核',
};

// 基准变更检测（REQ-20260921-012 本轮落定：磁盘 mtime 对比，纯函数）：
// 同类型文件两两对比（README.md ↔ README_<lang>.md，依次类推），默认语言文档 mtime
// **严格晚于**剩余语言文档 → 该剩余语言文档置回「未翻译」（未审核）。
// BUG-20260922-002：自定义文档同口径参与（MIGRATION.md ↔ MIGRATION_<lang>.md）。
// statFile(file) → mtimeMs | null（注入解耦 fs）；mtime 缺失 / 相同不回退（mtime 为弱信号，
// 内容 hash 复核豁免按 README 待确认口径暂不做）。检测在每次求值读盘时发生，不依赖审查
// 界面的保存按钮——保存只是修改途径之一，外部编辑器 / IDE 直接落盘同样更新 mtime 被捕获。
export function detectBaselineShift(langs, statFile, customDocs = []) {
  const stat = typeof statFile === 'function' ? statFile : () => null;
  const ls = docLangsOf({ langs });
  if (ls.length < 2) return [];
  const shifted = [];
  for (const key of [...PUBLISH_DOC_KEYS, ...customDocsOf({ customDocs })]) {
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
//     历史遗留的 v.review.finalized 完结快照（BUG-20260926-002 起完结阶段已去除）不再参与
//     求值，读取侧忽略、不改写历史记录；
//   - readFile(file)：当前磁盘内容（注入解耦 fs）；
//   - marks = { summarizing, summarized, translating, translated }：AI 总结 / AI 翻译账本
//     聚合标记（docs-summary-store.summaryMarksForVer / docs-translate-store.translateMarksForVer）；
//   - opts.statFile(file) → mtimeMs | null：基准变更检测注入（缺省不做检测）。
// 判定优先级（默认语言）：正在总结 > 已审核（hash 一致且审核基于当前范围）> 已总结待审核 > 未总结；
// 判定优先级（剩余语言）：基准变更回退未翻译 > 正在翻译 > 已审核 > 已翻译待审核 > 未翻译；
// 判定优先级（单文件类，REQ-20260922-002）：已审核 > 待审核（在盘或曾有审核记录）> 未编写。
// scopeStale 口径（BUG-20260926-004 修订）：发布范围变化使既有审核失效（回退待审核），
// 但失效不再是「重新核对动作无效」的死锁——逐文件重新「通过审核」即恢复：审核记录时点
//（review.files[file].at）晚于最近一次范围变化时点（docs.scopeChangedAt，markDocsScopeStale
// 落盘；存量数据无该字段时以最近一次文档提交时点 docs.committedAt 兜底——scopeStale 只会
// 在文档提交之后被标记）即视为基于当前范围的重新核对；时点无法定位时安全侧倾斜（审核一律
// 视为旧范围）。审核过程中范围再变（scopeChangedAt 刷新到审核时点之后）→ 再次失效。
// 输出：files（4 类 × 语言集语言数 + 单文件类）、defaultFiles / restFiles（single 归
// defaultFiles 计入默认语言组展示与计数）、reviewedCount（合计）与分组计数、canTranslate
//（默认语言 4 类已审核且存在剩余语言——A1 口径下单文件类不锁 AI 翻译；translateMissing 为
// 默认语言 4 类缺口明细）、baselineShift、canCommit（REQ-20260921-008「全部已审核」门禁；
// BUG-20260926-002 起不叠加整体审查完结条件；BUG-20260926-004 起「已审核」隐含「审核基于
// 当前范围」——时点校验并入逐文件判定，提交端点以提交时点复算结果为准）、missing（未审核
// 文件 + 状态）。
export function evaluateDocsFlow(v, readFile, marks = {}, opts = {}) {
  const read = typeof readFile === 'function' ? readFile : () => null;
  const scopeStale = !!(v?.docs && v.docs.scopeStale);
  // BUG-20260926-004 范围变化时点：scopeChangedAt 优先，存量数据回退 committedAt；
  // 解析失败 / 均缺失 → null（安全侧：审核视为旧范围）。
  const staleSinceMs = (() => {
    if (!scopeStale) return null;
    for (const iso of [v?.docs?.scopeChangedAt, v?.docs?.committedAt]) {
      const ms = Date.parse(String(iso ?? ''));
      if (Number.isFinite(ms)) return ms;
    }
    return null;
  })();
  const reviewFresh = (rec) => {
    if (!scopeStale) return true; // 范围未变化：hash 一致即有效（既有口径）
    if (staleSinceMs == null) return false; // 无法定位范围变化时点：安全侧倾斜
    const atMs = Date.parse(String(rec?.at ?? ''));
    return Number.isFinite(atMs) && atMs > staleSinceMs; // 严格晚于：以落盘时点为准
  };
  const reviewFiles = (v?.review && v.review.files) || {};
  const summarizing = new Set(marks.summarizing || []);
  const summarizedMarks = new Set(marks.summarized || []);
  const translating = new Set(marks.translating || []);
  const translatedMarks = new Set(marks.translated || []);
  const langs = docLangsOf(v);
  const customDocs = customDocsOf(v);
  const defaultLang = langs[0];
  const baselineShift = new Set(detectBaselineShift(langs, opts.statFile, customDocs));
  const files = publishDocFiles(langs, customDocs).map((f) => {
    const isDefault = !!f.single || f.lang === defaultLang; // 单文件类归默认语言组（默认语言页签展示并计数）
    let text = null;
    try { text = read(f.file); } catch { text = null; }
    const diskHash = text == null ? null : hashOf(text);
    const rec = reviewFiles[f.file] || null;
    // BUG-20260926-004：approved = hash 一致 + 审核基于当前范围（scopeStale 期间以时点校验
    // 判定新鲜度），不再以 !scopeStale 一票否决——范围变化后重新「通过审核」可恢复
    const approved = !!rec && diskHash != null && rec.hash === diskHash && reviewFresh(rec);
    let state;
    if (f.single && !f.custom) {
      // 单文件类（LICENSE）：不经 AI 总结 / 翻译，人工编写 → 待审核 → 已审核（编辑 / 删盘回退待审核）
      if (approved) state = 'reviewed';
      else if (text != null || rec) state = 'pending';
      else state = 'unwritten';
    } else if (isDefault) {
      // 默认语言四态；自定义文档默认语言份同走本分支（进 AI 总结、七态与审核 hash）
      if (summarizing.has(f.file)) state = 'summarizing';
      else if (approved) state = 'reviewed';
      else if (summarizedMarks.has(f.file) || rec) state = 'summarized';
      else state = 'unsummarized';
    } else {
      // 剩余语言四态；BUG-20260922-002 起自定义文档其余语言份同走本分支（进 AI 翻译）
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
  // AI 翻译解锁只看默认语言非单文件文件（LICENSE 不锁，REQ-20260922-002 A1 口径；
  // BUG-20260922-002：自定义文档默认语言 <KEY>.md 与标准 4 类同口径参与解锁——未审即锁，
  // 缺口进 translateMissing；其基准必须先经人工审核）
  const langDefaultFiles = defaultFiles.filter((f) => !f.single);
  const langDefaultReviewed = langDefaultFiles.filter((f) => f.state === 'reviewed').length;
  const translateMissing = langDefaultFiles
    .filter((f) => f.state !== 'reviewed')
    .map((f) => ({ file: f.file, state: f.state }));
  const canTranslate = langDefaultFiles.length > 0 && langDefaultReviewed === langDefaultFiles.length && restFiles.length > 0;
  // 提交门禁（BUG-20260926-002 回归 REQ-20260921-008 原口径）：语言集内全部文件已审核即可
  // 提交——不再叠加整体审查完结条件。BUG-20260926-004：「已审核」判定含审核新鲜度时点校验
  //（hash 一致 + 基于当前范围），全部已审核天然隐含「审核记录之后发布范围未再变化」；
  // scopeStale 期间重新逐文件审核即可恢复（提交端点以提交时点复算结果为准，不放宽）。
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
    canCommit: allReviewed,
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
  const customDocs = customDocsOf(v);
  const files = publishDocFiles(langs, customDocs).map((f) => {
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
    // BUG-20260922-002：自定义文档随语言集展开为多文件，提示按 KEY 份数计（非文件数）
    const customKeyCount = new Set(files.filter((f) => f.custom).map((f) => f.key)).size;
    reasons.push(written
      ? `已编写 ${written}/${files.length} 个文档，尚未提交到 Git（提交后才能合并）`
      : `尚未编写发布文档（README / CHANGELOG / FEATURES / AGENTS × 语言集 ${langs.join(',')}${customKeyCount ? ` + ${customKeyCount} 个自定义文档` : ''} + LICENSE.md 共 ${files.length} 个文件）`);
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

// 范围指纹：所选条目 + 每条全部提交 hash + 文档基准（当前语言集全文件内容 hash）共同构成发布范围。
// 任一变化（增删条目 / 换 commit / 补入提交 / 修改文档 / 语言集变化）→ 指纹变化 → 旧提交标识不放行。
// BUG-20260921-015：一条目多提交全量参与指纹（补入提交即范围变化）；旧单提交形态兜底 [commit]。
export function publishScopeFingerprint(items, readFile, langs = DEFAULT_DOC_LANGS, customDocs = []) {
  const read = typeof readFile === 'function' ? readFile : () => null;
  const part = (Array.isArray(items) ? items : [])
    .map((it) => {
      const commits = [...new Set((Array.isArray(it?.commits) && it.commits.length ? it.commits : [it?.commit])
        .map((h) => String(h || '').trim().toLowerCase()).filter(Boolean))];
      return `${it.itemId}:${commits.join(',')}`;
    })
    .sort();
  // REQ-20260922-003：自定义文档随 pathspec 进入提交范围，内容一并参与指纹
  const docs = publishDocFiles(langs, customDocs).map((f) => {
    let h = null;
    try { const t = read(f.file); h = t == null ? null : hashOf(t); } catch { h = null; }
    return `${f.file}:${h}`;
  });
  return hashOf(JSON.stringify({ items: part, docs }));
}

// ---------- 五步门禁 ----------

// REQ-20260926-002 五步重定义：选择条目与提交 → 挑选合并 → 文档与翻译 → 文档合并 → 发布。
// 与旧流程（版本计划 / 关联条目与提交 / 文档编写 / 合并入 main / 正式发布）的关键差异：
//   - 「关联条目与提交」并入第一步「选择条目与提交」（link 键移除，前端快照恢复归一 link → plan）；
//   - 挑选合并不再要求先完成发布文档（先合入功能，再依据实际合入内容编写文档）；
//   - 文档编写（含翻译与审核）在挑选合并完成后进行（旧计划已有文档提交记录的兼容解锁）；
//   - 新增「文档合并」步：审核通过的文档单独提交、合入 main 并记录到版本计划（直接关联 BLD）；
//   - 最后一步「发布」= 推送到远端 + 官网资料更新（两动作分别展示结果）。
export const PUBLISH_STEPS = [
  { key: 'plan', label: '选择条目与提交' },
  { key: 'merge', label: '挑选合并' },
  { key: 'docs', label: '文档与翻译' },
  { key: 'docmerge', label: '文档合并' },
  { key: 'release', label: '发布' },
];

const DOCS_GATE_TEXT = {
  none: '文档尚未编写提交（文档合并前置：所需文档已审核并最新提交）',
  uncommitted: '文档有未提交修改，不得合并（请先提交文档）',
  'needs-rewrite': '发布范围已变化，文档需重新核对 / 编写并重新提交',
};

// 五步导航门禁（只读求值，REQ-20260926-002 口径；BUG-20260928-005 起锁定基准换发布确认）：
//   - plan 恒可用；merge 需有条目且状态可合并（draft/failed/merged，merging 防重复、发布
//     确认（正式发布）后锁定）——不再要求文档已提交；
//   - docs 在挑选合并完成后解锁（status=merged 或已有条目合入 / 旧计划已有文档提交记录——
//     不要求重新执行已完成操作）；merging / 发布确认后锁定；
//   - docmerge 需文档 overall=committed（已提交且基于当前范围）；merging / 发布确认后锁定；
//   - release 需已合并（merged）且文档已合并入 main（v.docsMerge 落账）；已发布（确认后）
//     放开供查看结果。
// BUG-20260928-005：仅推送（release.pushedAt）不锁定——推送是事实不是「正式发布」，正式
// 发布以「发布」按钮二次确认（release.confirmedAt，一键发布链路 start 落账）为准。
export function publishStepsState(v, docsEval) {
  const items = Array.isArray(v?.items) ? v.items : [];
  const status = v?.status || 'draft';
  const released = !!(v?.release && v?.release.confirmedAt);
  const docsMerged = !!(v?.docsMerge && v?.docsMerge.commitHash);
  const legacyDocs = !!(v?.docs && v?.docs.commitHash); // 旧流程（先文档后合并）已有提交记录
  const anyMerged = status === 'merged' || items.some((x) => x.mergedAt);
  const scopeLocked = () => (status === 'merging' ? '合并执行中' : '已正式发布，范围锁定（如需调整请新建版本）');
  return PUBLISH_STEPS.map((s) => {
    let locked = false;
    let reason = '';
    if (s.key === 'merge') {
      if (status === 'merging') { locked = true; reason = '合并执行中'; }
      else if (released) { locked = true; reason = '已正式发布，不可再合并（如需调整请新建版本）'; }
      else if (!items.length) { locked = true; reason = '暂无关联条目：请先在「选择条目与提交」步骤关联'; }
    } else if (s.key === 'docs') {
      if (status === 'merging' || released) { locked = true; reason = scopeLocked(); }
      else if (!anyMerged && !legacyDocs) { locked = true; reason = '挑选合并完成后，依据本版实际合入内容编写文档'; }
    } else if (s.key === 'docmerge') {
      if (status === 'merging' || released) { locked = true; reason = scopeLocked(); }
      else if (!docsEval || docsEval.overall !== 'committed') {
        locked = true;
        reason = (docsEval && DOCS_GATE_TEXT[docsEval.overall]) || '文档尚未编写提交';
      }
    } else if (s.key === 'release') {
      if (!released) {
        if (status !== 'merged') { locked = true; reason = '挑选合并完成后才能发布'; }
        else if (!docsMerged) { locked = true; reason = '发布文档合并入 main 完成后才能发布（先完成「文档合并」）'; }
      }
    }
    return { ...s, locked, reason };
  });
}
