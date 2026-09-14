// REQ-20260908-020 批量任务设置 —— Agent 展示 + 「任务类型 × Agent」四路子代理模型/智能档位。
// REQ-20260909-005：每路新增模型来源 source（follow=跟随主调度会话（默认）| manual=手动指定），
// follow 时创建任务不再注入固定模型/档位行，改为「与会话一致」指令；manual 沿用固定行。
// REQ-20260909-010：新增 refine 分区——完善完成后自动转入计划（autoPlanAfterDone，默认 false=手动移入计划）。
// 存储：<dataDir>/tasks/settings.json
//   { version: 1,
//     agents:  { refine: ['zcode','codex'], develop: ['zcode','codex'] },   // 任务启动区可见的执行 Agent
//     models:  { refine: { zcode: { source, model, level }, codex: { source, model, level } },
//                develop: { zcode: { source, model, level }, codex: { source, model, level } } },
//     refine:  { autoPlanAfterDone: false } }                                // 完善流转开关
// level 缺省值（仅为手动档缺省建议，可改）：完善工作流高智能档（补需求/单说明），开发工作流一般智能档。

import fs from 'node:fs';
import path from 'node:path';
import { AtbError, writeJsonAtomic } from './core.mjs';

export const TASK_KINDS = ['refine', 'develop'];
export const TASK_AGENTS = ['zcode', 'codex'];
export const TASK_LEVELS = ['high', 'medium', 'low'];
export const TASK_LEVEL_LABEL = { high: '高', medium: '中', low: '低' };
export const TASK_KIND_LABEL = { refine: '批量完善', develop: '批量开发' };
export const TASK_AGENT_LABEL = { zcode: 'zcode', codex: 'codex' };
// REQ-20260909-005：子代理模型来源（默认 follow——与主调度会话一致；manual——显式覆盖）
export const TASK_MODEL_SOURCES = ['follow', 'manual'];
export const TASK_SOURCE_LABEL = { follow: '跟随主调度会话', manual: '手动指定' };
export const defaultLevelOf = (kind) => (kind === 'refine' ? 'high' : 'medium');

// REQ-20260909-005：跟随主调度会话的提示词指令行（批量开发 / 批量完善共用同一口径）。
// REQ-20260909-011：措辞通用化——不再点名具体执行端参数（如 codex exec 的 --model /
// model_reasoning_effort），也不指向设置「批量任务」静态值（按 Agent 的模型配置已随本需求移除）；
// 语义不变：能显式指定的执行端显式传入与会话一致的值，不能的不另行指定、默认继承主会话配置。
export const FOLLOW_SESSION_PROMPT_LINE =
  '子代理模型与智能/推理档位：跟随主调度会话——启动每个子代理时，其模型与智能/推理档位必须与当前主调度会话保持一致：'
  + '执行端支持显式指定时显式传入与会话一致的值，'
  + '不支持的执行端不另行指定、依赖子代理默认继承主会话配置；'
  + '不得改用其他静态值，也不得落到与主会话不同的默认档。';

// BUG-20260909-017：存量完善批次账本冻结的 REQ-20260908-020 时代固定模型行展示归一——
// 读到整行「子代理模型配置：…（来自设置「批量任务」，启动子代理时按此传递）。」时替换为
// FOLLOW_SESSION_PROMPT_LINE，其余行逐字不动。仅作用于展示/回显层，调用方不回写账本（历史原样保留）。
const LEGACY_MODEL_LINE_RE = /^子代理模型配置：.*来自设置「批量任务」.*$/;
export function normalizePromptModelLine(prompt) {
  if (typeof prompt !== 'string' || !prompt.includes('子代理模型配置：')) return prompt;
  return prompt
    .split('\n')
    .map((line) => (LEGACY_MODEL_LINE_RE.test(line.trim()) ? FOLLOW_SESSION_PROMPT_LINE : line))
    .join('\n');
}

// BUG-20260910-008：批量完善提示词「条目状态约束」两态文案——生成层（refine-store 的
// buildRefinePrompt / buildRefineWorkerPrompt）与展示归一层（normalizePromptForDisplay）共用唯一
// 事实源；常量定义在本模块（refine-store 依赖 task-settings，反向定义会环引）。
// - OFF 态（refine.autoPlanAfterDone=false，默认）＝REQ-20260908-020 原约束行，逐字保留（零回归）；
// - ON 态（开启「完善完成后自动转入计划」）＝REQ-20260909-010 系统流转（done 回执核验通过后由系统
//   自动 accepted → planned，非 Agent 操作）被提示词承认并告知：看到「已自动转入计划」或条目变为
//   planned 均属预期系统行为，Agent（主调度与子代理）不得据此暂停/中止/等待人工确认；Agent 自身
//   纪律不放宽（不改 status.json、不执行 atb status——state-guard 拦截规则不变）。
// ON 段整段替换 OFF 行（首行文案与 OFF 行不同，形态互不为前缀，归一双向无歧义）。
export const REFINE_SCHEDULER_KEEP_ACCEPTED_LINE = '硬性约束：条目全程保持 accepted（已接受）；不要修改业务源码；不要修改条目 status.json；';
export const REFINE_SCHEDULER_AUTO_PLAN_LINES = [
  '硬性约束：完善期间条目保持 accepted（已接受）；不要修改业务源码；不要修改条目 status.json；',
  // REQ-20260913-003：「本批」→「本轮」（去批次概念；存量冻结的「本批已开启」由归一层统一改写）
  '不要执行 atb status（改条目状态仅限人工与系统）；本轮已开启「完善完成后自动转入计划」：',
  '子代理 refine done 回执核验通过后，系统（非 Agent）会自动把条目 accepted → planned（回显「已自动转入计划」）；',
  '看到该输出或条目变为 planned 均属预期系统行为，不要据此暂停、中止或等待人工确认——照常 refine check，',
  'nextAction=continue 时继续派发下一个子代理；',
];
export const REFINE_WORKER_KEEP_ACCEPTED_LINE = '3. 条目保持 accepted（已接受）：不要修改业务源码、不要改 status.json、不要 claim/report、';
export const REFINE_WORKER_AUTO_PLAN_LINES = [
  '3. 条目保持 accepted（已接受）——本任务已开启「完善完成后自动转入计划」：你输出补全要点并经核验记账后，',
  '   系统（非你）会自动把条目 accepted → planned（回显「已自动转入计划」）；条目变为 planned 属预期系统行为，',
  '   不要据此暂停或等待人工确认；你自身不得改状态：不要修改业务源码、不要改 status.json、不要执行 atb status、不要 claim/report、',
];

// BUG-20260910-011：完善提示词的演示质量门槛与 Bug 分支四行文案——生成层（refine-store 的
// buildRefinePrompt / buildRefineWorkerPrompt）与展示归一层（normalizePromptForDisplay）共用唯一
// 事实源（常量定义在本模块，refine-store 依赖 task-settings，反向定义会环引；沿 REFINE_SCHEDULER_*
// 常量模式）。RFB-20260909-016~022 时代冻结的旧口径（Bug 分支只有「Bug 补现象/复现步骤/期望行为/
// 验收说明。」、约束行演示许可只给需求）由 normalizePromptForDisplay 在展示层归一到本口径（账本不回写）。
export const REFINE_UI_DEMO_QUALITY = '单文件 html（内联 CSS/JS）、无外网依赖、无构建步骤、浏览器直接打开可交互，'
  + '覆盖界面布局/交互行为/状态反馈（正常/空/加载/失败等状态切换；深浅色适配可选，ASCII 线框仅作可选补充）';
export const REFINE_BUG_DOC_LINES = [
  '   design/test-cases 留待开发阶段；Bug 补现象/复现步骤/期望行为/验收说明——涉及 UI 的 Bug',
  '   （现象为界面问题或修复会改动界面）同样须提供界面展示：界面展示节链接 ./ui-demo.html',
  `   并在条目目录创建 ui-demo.html 可交互演示，质量门槛同需求：${REFINE_UI_DEMO_QUALITY}，`,
  '   演示建议对照展示缺陷现象与期望修复后状态（如通过状态切换/开关对比）；',
];
// 旧口径整行（RFB-20260909-016~022 冻结原文；更早批次的更旧形态不逐一归一——领取输出始终携带现行口径）
const LEGACY_REFINE_BUG_DOC_LINE = '   design/test-cases 留待开发阶段；Bug 补现象/复现步骤/期望行为/验收说明。';
const LEGACY_REFINE_DEMO_PERMIT_REQ_ONLY = '不要调用 claim/report、不要写 test-report.md、不要 git commit；只编辑条目目录下 markdown（涉及 UI 的需求可另建约定的 ui-demo.html）。';
// 主调度提示词约束行（演示文件许可覆盖需求与 Bug；worker 提示词为另一形态，留在 refine-store）
export const REFINE_DEMO_PERMIT_LINE = '不要调用 claim/report、不要写 test-report.md、不要 git commit；只编辑条目目录下 markdown（涉及 UI 的需求或 Bug 可另建约定的 ui-demo.html）。';

// BUG-20260910-001：存量批次冻结提示词的展示/回显层全量归一——在 BUG-20260909-017 模型行归一之上，
// 补齐 REQ-20260909-011 通用化前的执行端专属残留（覆盖 refine/batches 与 dispatch/batches 存量全量变体）：
// - 点名 codex exec 参数的 REQ-20260909-005 旧跟随行 → 现行 FOLLOW_SESSION_PROMPT_LINE；
// - 完善侧「执行 Agent：zcode/codex。在 … 新建会话…（general-purpose 子 Agent）派发一项，」行 → 删除；
// - 完善侧头行「每轮新启动一个( general-purpose)? 子 Agent，按执行流程完善本批一个[待已]接受条目的文档。」
//   → 现行通用句（其后首个非执行端行为旧命名行时按现行两行拆分，否则单行完整句）；
// - 旧命名行「子(代)会话命名统一为：<批次号>-refine-<序号>…」/「子会话命名统一为：<条目编号>（如 …）…」
//   → 「子代理会话命名统一为：<条目编号>（与主调度会话区分）。」（相邻变体带前半句）；
// - codex 模式「codex 口径：领取/回执命令…」说明行 → 通用说明行；
// - 开发侧 general-purpose 两行段 → 现行「每轮新启动一个子代理…」+「每个子代理只做一项；…」两行；
// - 领取前缀 `--by zcode-refine-` / `--by codex-refine-` → `--by refine-`（前缀仅为会话标识字符串，
//   不影响锁与账本语义——REQ-20260909-011 单一通用前缀同口径）。
// 规则均为冻结提示词的整行精确形态匹配，对现行 buildRefinePrompt / generatePrompt 输出幂等；
// 仅作用于展示/回显层，调用方不回写账本（历史原样保留——沿用 BUG-20260909-017 处置口径）。
const LEGACY_FOLLOW_LINE_PREFIX = '子代理模型与智能/推理档位：跟随主调度会话';
const REFINE_HEAD_SPLIT = '在当前项目的 Agent 会话中执行本提示词：每轮新启动一个子代理，按执行流程完善本批';
const REFINE_HEAD_FULL = '在当前项目的 Agent 会话中执行本提示词：每轮新启动一个子代理，按执行流程完善本批一个已接受条目的文档。';
const REFINE_NAME_WITH_BODY = '一个已接受条目的文档。子代理会话命名统一为：<条目编号>（与主调度会话区分）。';
const REFINE_NAME_ONLY = '子代理会话命名统一为：<条目编号>（与主调度会话区分）。';
const DEV_HEAD_LINE = '每轮新启动一个子代理，按执行规范自行选择本批一个可实施条目，认领、实施、测试并上报。';
const DEV_NAME_LINE = '每个子代理只做一项；子代理会话命名统一为：<条目编号>（与主调度会话区分）。';

const isLegacyExecLine = (s) => /^执行 Agent：\S+。/.test(s) && s.includes('派发一项');
const isLegacyNameLine = (s) =>
  /^子代理会话命名统一为：.*-refine-<序号>，与主调度会话区分。$/.test(s)
  || /^子会话命名统一为：<条目编号>/.test(s);
const isLegacyRefineHead = (s) =>
  /^每轮新启动一个( general-purpose)? ?子 Agent，按执行流程完善本批一个[待已]接受条目的文档。$/.test(s);
const LEGACY_DEV_HEAD = '每轮新启动一个 general-purpose 子 Agent，按执行规范自行选择本批';
const LEGACY_DEV_BODY = '一个可实施条目，认领、实施、测试并上报。每个子 Agent 只做一项。';
const LEGACY_CODEX_NOTE_RE = /^codex 口径：领取\/回执命令在子会话内执行（工作目录用 --dir .* 指定）；$/;

// REQ-20260913-003 去批次概念：现行生成层的头行（批量开发 / 批量完善），与 batch.generatePrompt /
// refine.buildRefinePrompt 的现行输出逐字一致——归一层把存量冻结的旧头行（含「本批」口径）统一
// 归一到这两行；旧头行常量（DEV_HEAD_LINE / REFINE_HEAD_* / REFINE_NAME_*）即旧口径的精确形态。
const DEV_HEAD_NOW = '每轮新启动一个子代理，按执行规范领取当前队列中最早的一个可实施条目，认领、实施、测试并上报。';
const REFINE_HEAD_NOW = '在当前项目的 Agent 会话中执行本提示词：每轮新启动一个子代理，按执行流程完善当前队列中最早的一个已接受条目的文档。';
// REQ-20260913-003：存量冻结提示词的批次行删除规则（整行精确/前缀形态，展示层，账本不回写）——
// 「批次：…」「完善批次：…」行删除；nextBatch 排队接续行删除；「只传…批次标识…」行换现行口径。
const LEGACY_BATCH_LINE_RE = /^(批次|完善批次)：\S+/;
const LEGACY_DEV_SCOPE_LINE = '只传本项目、批次标识与规范路径，不复制本会话的历史实施记录。';
const DEV_SCOPE_LINE_NOW = '只传项目根与规范路径，不复制本会话的历史实施记录。';

// BUG-20260910-008：整行连续序列替换（完善约束段 OFF ⇄ ON 两方向归一共用）——命中 from 数组
// 的完整连续行序列时整段替换为 to，全部出现处均替换；未命中原样返回（幂等）。
function replaceLineSeq(lines, from, to) {
  if (!Array.isArray(from) || !from.length || !lines.includes(from[0])) return lines;
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (i + from.length <= lines.length && from.every((s, k) => lines[i + k] === s)) {
      out.push(...to);
      i += from.length;
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  return out;
}

// 展示/回显层归一。opts.autoPlan（BUG-20260910-008，可选）：
// - true：完善提示词的 OFF 约束行（主调度/worker 两形态，含存量冻结原文）替换为 ON 文案
//   （补「完善完成后自动转入计划」系统流转说明——防严格 Agent 把 accepted → planned 当约束违反而暂停）；
// - false：冻结的 ON 文案归一回 OFF 约束行（实时口径两方向，见 refine-store refineAutoPlanOn 注释）；
// - 缺省/null：不触碰约束行（既有调用形态零回归；开发侧提示词不含完善约束行，传值也无影响）。
export function normalizePromptForDisplay(prompt, { autoPlan = null } = {}) {
  if (typeof prompt !== 'string' || !prompt) return prompt;
  // 领取前缀归一（字符串级字面量替换，不碰其余文本）
  let text = prompt.split('--by zcode-refine-').join('--by refine-')
    .split('--by codex-refine-').join('--by refine-')
    // REQ-20260913-003：完善领取前缀去批次尾号（refine-<批次尾号>-<序号> → refine-<序号>）
    .split('--by refine-<批次尾号>-<序号>').join('--by refine-<序号>');
  // REQ-20260913-003：核对入口去批次标识——「批次摘要入口」前缀换「调度核对入口」，
  // `--batch <id>` 实参整体移除（含前导空格）；对新版生成输出幂等（新版不含这些形态）。
  if (text.includes('批次')) {
    text = text.split('批次摘要入口：').join('调度核对入口：')
      .replace(/ ?--batch \S+/g, '');
  }
  const lines = text.split('\n');
  let out = [];
  let lastPushed = null;
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (LEGACY_MODEL_LINE_RE.test(s)) { out.push(FOLLOW_SESSION_PROMPT_LINE); lastPushed = FOLLOW_SESSION_PROMPT_LINE; continue; }
    if (s.startsWith(LEGACY_FOLLOW_LINE_PREFIX) && s !== FOLLOW_SESSION_PROMPT_LINE) { out.push(FOLLOW_SESSION_PROMPT_LINE); lastPushed = FOLLOW_SESSION_PROMPT_LINE; continue; }
    if (isLegacyExecLine(s)) continue; // 执行端行删除
    // REQ-20260913-003：批次行与排队接续说明行删除（展示层，账本不回写）
    if (LEGACY_BATCH_LINE_RE.test(s)) continue;
    if (s.includes('nextBatch')) continue;
    if (s === LEGACY_DEV_SCOPE_LINE) { out.push(DEV_SCOPE_LINE_NOW); lastPushed = DEV_SCOPE_LINE_NOW; continue; }
    if (LEGACY_CODEX_NOTE_RE.test(s)) {
      out.push('领取/回执命令在子代理会话内执行（工作目录用 --dir 指定）。');
      lastPushed = out[out.length - 1];
      continue;
    }
    if (s === LEGACY_DEV_HEAD && (lines[i + 1] || '').trim() === LEGACY_DEV_BODY) {
      out.push(DEV_HEAD_LINE, DEV_NAME_LINE);
      lastPushed = DEV_NAME_LINE;
      i++; // 消费合并的第二行
      continue;
    }
    if (isLegacyRefineHead(s)) {
      // 其后首个非执行端行是旧命名行 → 按现行两行拆分（第二行由命名行规则输出）；否则单行完整句
      let j = i + 1;
      while (j < lines.length && isLegacyExecLine(lines[j].trim())) j++;
      const adjacentRename = j < lines.length && isLegacyNameLine(lines[j].trim());
      out.push(adjacentRename ? REFINE_HEAD_SPLIT : REFINE_HEAD_FULL);
      lastPushed = out[out.length - 1];
      continue;
    }
    if (isLegacyNameLine(s)) {
      const line = lastPushed === REFINE_HEAD_SPLIT ? REFINE_NAME_WITH_BODY : REFINE_NAME_ONLY;
      out.push(line);
      lastPushed = line;
      continue;
    }
    out.push(lines[i]);
    lastPushed = lines[i];
  }
  // BUG-20260910-011：存量长跑批次冻结提示词的 Bug 演示口径归一（展示层，账本不回写）——
  // RFB-20260909-016~022 时代 Bug 分支未含界面展示要求、约束行演示许可只给需求；
  // 归一到现行口径（与生成层共用常量，见 REFINE_BUG_DOC_LINES / REFINE_DEMO_PERMIT_LINE），
  // 对现行生成输出幂等。
  out = replaceLineSeq(out, [LEGACY_REFINE_BUG_DOC_LINE], REFINE_BUG_DOC_LINES);
  out = replaceLineSeq(out, [LEGACY_REFINE_DEMO_PERMIT_REQ_ONLY], [REFINE_DEMO_PERMIT_LINE]);
  // REQ-20260913-003：头行归一到现行「当前队列中最早」口径（两行拆分形态与单行旧句均收敛；
  // 对现行生成输出幂等——现行输出即 DEV_HEAD_NOW / REFINE_HEAD_NOW，不再命中旧序列）
  out = replaceLineSeq(out, [DEV_HEAD_LINE], [DEV_HEAD_NOW]);
  out = replaceLineSeq(out, [REFINE_HEAD_FULL], [REFINE_HEAD_NOW]);
  out = replaceLineSeq(out, [REFINE_HEAD_SPLIT, REFINE_NAME_WITH_BODY], [REFINE_HEAD_NOW]);
  // REQ-20260913-003：措辞级收尾（旧头行归一后仍可能残留的批次量词）——「批次调度员」→
  // 「批量开发调度员」、「批次计数」→「本轮计数」、「本批」→「本轮」（含 AUTO_PLAN 约束段的
  // 「本批已开启」，与 REFINE_SCHEDULER_AUTO_PLAN_LINES 现行「本轮已开启」措辞对齐，使下方
  // 开关分态整段替换仍可命中）。对新版生成输出幂等（新版不含这些措辞）。
  if (out.some((l) => l.includes('批'))) {
    out = out.join('\n')
      .split('批次调度员').join('批量开发调度员')
      .split('批次计数').join('本轮计数')
      .split('本批').join('本轮')
      .split('\n');
  }
  // BUG-20260910-008：完善约束段按开关分态归一（其余规则之上最后套用；对现行生成输出幂等）
  if (autoPlan === true) {
    out = replaceLineSeq(out, [REFINE_SCHEDULER_KEEP_ACCEPTED_LINE], REFINE_SCHEDULER_AUTO_PLAN_LINES);
    out = replaceLineSeq(out, [REFINE_WORKER_KEEP_ACCEPTED_LINE], REFINE_WORKER_AUTO_PLAN_LINES);
  } else if (autoPlan === false) {
    out = replaceLineSeq(out, REFINE_SCHEDULER_AUTO_PLAN_LINES, [REFINE_SCHEDULER_KEEP_ACCEPTED_LINE]);
    out = replaceLineSeq(out, REFINE_WORKER_AUTO_PLAN_LINES, [REFINE_WORKER_KEEP_ACCEPTED_LINE]);
  }
  return out.join('\n');
}

const MODEL_ID_MAX_CHARS = 120;

function taskSettingsPath(dataDir) {
  return path.join(dataDir, 'tasks', 'settings.json');
}

function defaultSettings() {
  const models = {};
  for (const kind of TASK_KINDS) {
    models[kind] = {};
    for (const agent of TASK_AGENTS) {
      models[kind][agent] = { source: 'follow', model: '', level: defaultLevelOf(kind) };
    }
  }
  return {
    version: 1,
    agents: { refine: [...TASK_AGENTS], develop: [...TASK_AGENTS] },
    models,
    // REQ-20260909-010：完善完成后自动转入计划——默认关闭（= 手动移入计划，保持现状）
    refine: { autoPlanAfterDone: false },
  };
}

// 读取（缺省合并默认值；存量字段缺失回退默认，不整体覆盖）
// REQ-20260908-026：全部隐藏是合法持久态（启动区据此禁用并提示），空列表不再回退全量
export function loadTaskSettings(dataDir) {
  const def = defaultSettings();
  let saved = null;
  try {
    saved = JSON.parse(fs.readFileSync(taskSettingsPath(dataDir), 'utf8'));
  } catch { /* 未初始化 */ }
  if (!saved || typeof saved !== 'object') return def;
  const out = def;
  if (saved.agents && typeof saved.agents === 'object') {
    for (const kind of TASK_KINDS) {
      const list = saved.agents[kind];
      if (Array.isArray(list)) {
        out.agents[kind] = TASK_AGENTS.filter((a) => list.includes(a));
      }
    }
  }
  if (saved.models && typeof saved.models === 'object') {
    for (const kind of TASK_KINDS) {
      const km = saved.models[kind];
      if (!km || typeof km !== 'object') continue;
      for (const agent of TASK_AGENTS) {
        const m = km[agent];
        if (!m || typeof m !== 'object') continue;
        const hasSource = TASK_MODEL_SOURCES.includes(m.source);
        // REQ-20260909-005 迁移：存量无 source 字段时按值判定——model 非空或档位偏离该类缺省
        // 即视为手工配置痕迹 → manual（值原样保留）；缺省形态与「从未保存」在存储上不可区分
        //（REQ-20260909-001 起 agents-only 保存同样写入缺省形态），一律落新默认 follow。
        if (typeof m.model === 'string' && m.model.trim()) out.models[kind][agent].model = m.model.trim().slice(0, MODEL_ID_MAX_CHARS);
        if (TASK_LEVELS.includes(m.level)) out.models[kind][agent].level = m.level;
        if (hasSource) out.models[kind][agent].source = m.source;
        else out.models[kind][agent].source = (out.models[kind][agent].model || out.models[kind][agent].level !== defaultLevelOf(kind)) ? 'manual' : 'follow';
      }
    }
  }
  // REQ-20260909-010：完善流转开关——宽松读（仅严格 true 视为开启），存量缺字段按默认关闭回退
  if (saved.refine && typeof saved.refine === 'object' && saved.refine.autoPlanAfterDone === true) {
    out.refine.autoPlanAfterDone = true;
  }
  // 未知分区（如过渡期残留的 commit）按既有口径忽略：读取不透出、保存不写回
  return out;
}

// 保存：patch 支持 { agents?, models?, refine? } 局部合并；非法值整体拒绝（不产生半截配置）。
// 未知分区键（如过渡期残留的 commit）按 agents/models 先例忽略：不落盘、不报错。
export function saveTaskSettings(dataDir, patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new AtbError('patch 必须是对象（{ agents?, models?, refine? }）');
  }
  const cur = loadTaskSettings(dataDir);
  const next = {
    version: 1,
    agents: { refine: [...cur.agents.refine], develop: [...cur.agents.develop] },
    models: {
      refine: { zcode: { ...cur.models.refine.zcode }, codex: { ...cur.models.refine.codex } },
      develop: { zcode: { ...cur.models.develop.zcode }, codex: { ...cur.models.develop.codex } },
    },
    refine: { ...cur.refine },
  };
  if (patch.agents !== undefined) {
    if (!patch.agents || typeof patch.agents !== 'object') throw new AtbError('agents 必须是对象');
    for (const kind of TASK_KINDS) {
      const list = patch.agents[kind];
      if (list === undefined) continue;
      if (!Array.isArray(list)) throw new AtbError(`agents.${kind} 必须是数组`);
      const bad = list.filter((x) => !TASK_AGENTS.includes(x));
      if (bad.length) throw new AtbError(`agents.${kind} 含非法 Agent：${bad.join('、')}（只能是 ${TASK_AGENTS.join(' / ')}）`);
      // REQ-20260908-026：允许全部隐藏（启动区禁用并提示到任务设置取消隐藏），不再拒绝空列表
      const uniq = TASK_AGENTS.filter((a) => list.includes(a));
      next.agents[kind] = uniq;
    }
  }
  if (patch.models !== undefined) {
    if (!patch.models || typeof patch.models !== 'object') throw new AtbError('models 必须是对象');
    for (const kind of TASK_KINDS) {
      const km = patch.models[kind];
      if (km === undefined) continue;
      if (!km || typeof km !== 'object') throw new AtbError(`models.${kind} 必须是对象`);
      for (const agent of TASK_AGENTS) {
        const m = km[agent];
        if (m === undefined) continue;
        if (!m || typeof m !== 'object') throw new AtbError(`models.${kind}.${agent} 必须是对象`);
        // REQ-20260909-005：模型来源。显式 follow 不清空既有 model/level（保値，切回手动回显）；
        // 非法值整体拒绝（沿用「不产生半截配置」口径）。
        if (m.source !== undefined) {
          if (!TASK_MODEL_SOURCES.includes(m.source)) {
            throw new AtbError(`models.${kind}.${agent}.source 来源非法：${m.source}（只能是 ${TASK_MODEL_SOURCES.map((x) => `${x}（${TASK_SOURCE_LABEL[x]}）`).join(' / ')}）`);
          }
          next.models[kind][agent].source = m.source;
        }
        if (m.model !== undefined) {
          const model = String(m.model ?? '').trim();
          if ([...model].length > MODEL_ID_MAX_CHARS) throw new AtbError(`模型标识不能超过 ${MODEL_ID_MAX_CHARS} 字符`);
          next.models[kind][agent].model = model;
        }
        if (m.level !== undefined) {
          if (!TASK_LEVELS.includes(m.level)) {
            throw new AtbError(`models.${kind}.${agent}.level 档位非法：${m.level}（只能是 ${TASK_LEVELS.map((x) => `${x}（${TASK_LEVEL_LABEL[x]}）`).join(' / ')}）`);
          }
          next.models[kind][agent].level = m.level;
        }
        // 兼容旧客户端（REQ-20260908-020 API 语义不回退）：不带 source 写入非空 model → 视为手动
        if (m.source === undefined && next.models[kind][agent].model) {
          next.models[kind][agent].source = 'manual';
        }
      }
    }
  }
  if (patch.refine !== undefined) {
    // REQ-20260909-010：完善流转开关。必须是 { autoPlanAfterDone: boolean }——非法值整体拒绝
    // （沿「不产生半截配置」口径，agents/models 分区不受影响）。
    if (!patch.refine || typeof patch.refine !== 'object') throw new AtbError('refine 必须是对象');
    if (patch.refine.autoPlanAfterDone === undefined) throw new AtbError('refine.autoPlanAfterDone 必须是布尔值（完善完成后自动转入计划开关）');
    if (typeof patch.refine.autoPlanAfterDone !== 'boolean') {
      throw new AtbError(`refine.autoPlanAfterDone 必须是布尔值，得到：${JSON.stringify(patch.refine.autoPlanAfterDone)}`);
    }
    next.refine.autoPlanAfterDone = patch.refine.autoPlanAfterDone;
  }
  fs.mkdirSync(path.dirname(taskSettingsPath(dataDir)), { recursive: true });
  writeJsonAtomic(taskSettingsPath(dataDir), next);
  return next;
}

// 任务启动区可见的执行 Agent（隐藏的 Agent 不出现在启动选项）
export function visibleAgents(settings, kind) {
  const s = settings || defaultSettings();
  const list = s.agents && Array.isArray(s.agents[kind]) ? s.agents[kind] : TASK_AGENTS;
  return TASK_AGENTS.filter((a) => list.includes(a));
}

// REQ-20260909-005：某路子代理模型配置的规范化读取（缺省合并 + 来源归一）。
// 返回 { source, model, level }——供创建任务的两条路径（server / CLI）统一取值。
export function modelConfigOf(settings, kind, agent) {
  const cfg = settings && settings.models && settings.models[kind] && settings.models[kind][agent]
    ? settings.models[kind][agent]
    : {};
  return {
    source: TASK_MODEL_SOURCES.includes(cfg.source) ? cfg.source : 'follow',
    model: typeof cfg.model === 'string' ? cfg.model : '',
    level: TASK_LEVELS.includes(cfg.level) ? cfg.level : defaultLevelOf(kind),
  };
}

// REQ-20260909-010：完善完成后自动转入计划开关的规范化读取（缺省/异常形态一律关闭）。
// 供完善回执两条路径（zcode finishRefineRun / codex server settle）统一取值。
export function autoPlanAfterRefineDone(settings) {
  return !!(settings && settings.refine && typeof settings.refine === 'object'
    && settings.refine.autoPlanAfterDone === true);
}
