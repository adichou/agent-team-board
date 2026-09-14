#!/usr/bin/env node
// atb —— Agent Team Board 命令行工具。
// 用法：node atb.mjs <init|new|claim|rename|delete|status|report|list|show|move|prune-locks> [参数]
// 说明：accepted / planned / done 三个人工专属状态在 Agent 的 Bash 工具里会被
//       hooks/state-guard.mjs 拦截；本 CLI 面向用户终端与 Status Board。

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from './lib/core.mjs';
import * as batch from './lib/batch.mjs';
import * as oncall from './lib/oncall-store.mjs';
import * as refine from './lib/refine-store.mjs';
// REQ-20260911-010：commit-store（提交规范内核）不再被 CLI 直接引用——批量 commit 命令组已回退，
// 索引查询走 gitFlow（REQ-20260911-009）。
import * as taskSettings from './lib/task-settings.mjs';
import * as growth from './lib/growth-store.mjs';
import * as hold from './lib/hold-store.mjs';
import * as holdStates from './lib/hold-states.mjs';
import * as gitFlow from './lib/git-flow.mjs';

const args = process.argv.slice(2);

let cwd = process.cwd();
{
  const i = args.indexOf('--dir');
  if (i !== -1 && args[i + 1]) {
    cwd = args[i + 1];
    args.splice(i, 2);
  }
}

const jsonOut = args.includes('--json');
{
  const i = args.indexOf('--json');
  if (i !== -1) args.splice(i, 1);
}

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const USAGE = `atb —— 智能体团队看板 CLI

用法：
  atb init                                     初始化 docs/agent-team-board/
  atb new req  <标题> [--desc <描述>] [--accept]  创建需求（缺省状态 submitted；--accept 一步创建并接受）
  atb new bug  <标题> [--desc <描述>] [--accept]  创建 Bug（缺省状态 submitted；--accept 一步创建并接受；
                                               一律独立 Bug，引入来源写 design.md）
  atb claim <ID> [--by <会话标识>]             认领条目（accepted/planned → in-progress，原子锁）
  atb rename <ID> <新标题> [--desc <文本|->]   更改待接受条目标题与描述（仅待接受；--desc - 从 stdin 读多行，
                                               可省略标题仅改描述，标题/描述一次保存）
  atb delete <ID>                              删除待接受条目（目录整体移除，不可恢复）
  atb status <ID> <状态> [--force]            变更状态；accepted/planned/done 仅限人工在终端执行；
                                               --force 越过待人工决策未答项的确认完成拦截（显式二次确认后）
  atb report <ID> [--coverage N] [--framework 名称] [--summary 文本] [--by 会话] [--run RUN-ID]
                                               写 test-report.md，标记待人工确认完成（--run 关联批量执行）
  atb batch create                           创建 AI 开发批次（有未结束批次时入队排队，结束后自动接续）
  atb batch next [--batch ID] [--by 会话]      worker 领取本批一项（原子预留 + 项目实施互斥）
  atb batch check [--batch ID]                 主调度最小核对（当前项/计数/nextAction，≤2KiB）
  atb batch summary [--batch ID]               批次摘要（续接/看板用：当前执行、计数、最近记录、提示词）
  atb batch pause [--off] [--batch ID]         暂停/恢复后续领取（不停止在途执行）
  atb batch records [--batch ID] [--offset N] [--limit N]
                                               执行记录分页
  atb batch delete <BATCH-ID>                 删除未在执行的批次（在途/待核对会被拒绝）
  atb run receipt <RUN-ID> --result reported --report-ref 文件
                                               上报回执（reported 必带 --report-ref：条目 test-report 相对引用）
  atb run receipt <RUN-ID> --result blocked|failed --reason 短句
                                               [--safe-to-continue|--no-safe-to-continue]
                                               阻塞/失败回执（必带 reason；≤2KiB，详细错误落盘后引用）
  atb run release <RUN-ID> [--reason 短句]     释放未认领的预留（认领冲突换单等）
  atb run autocommit <RUN-ID>                  重试到待测试自动提交（REQ-20260911-009；幂等，
                                               已提交分组不重复；仅 reported 运行可重试）
  atb hold declare <ID> (--question 问题)... [--reason 短句] [--run RUN-ID] [--by 会话]
                                               worker 声明条目待人工决策（附问题清单；随后仍交 blocked 回执）
  atb hold list [--all]                        待人工确认清单（等待时长 / 未答计数 / 原因；不随批次结束消失）
  atb hold show <ID>                           单条详情（问题清单 / 作答进度 / 事件留痕）
  atb hold answer <ID> --q <问题号> --text <答复> [--note 补充] [--by 人工]
                                               人工补决策（仅人工；支持草稿，缺项时复工禁用）
  atb hold resume <ID> [--by 人工]             人工复工（决策齐备 → 条目回已计划队列重新取单）
  atb hold cancel <ID> [--note 说明] [--by 人工]
                                               人工作废声明（条目状态不变）
  atb list [--type req|bug] [--status <状态>]  列出条目（--json 输出 JSON）
  atb show <ID>                                查看条目详情（--json 输出 JSON）
  atb move <BUG-ID> [--req <REQ-ID>|--standalone]
                                               移动 Bug 归属
  atb prune-locks [--dry-run]                  清理失效认领锁（条目不在办/不存在/已过期的锁）
  atb serve [--port N] [--open] [--log FILE]   后台启动看板服务；--open 同时打开系统浏览器

终端命令安装（REQ-20260908-007；装好后直接敲 atb …，无需 node 全路径；不依赖看板数据目录）：
  atb cli install [--to <目录>]                安装终端命令（在目标目录创建指向 bin/atb 的符号链接；
                                               缺省自动选择：PATH 中可写的 /usr/local/bin → ~/.local/bin
                                               → ~/bin；均不可用时创建 ~/.local/bin 并提示加入 PATH）
  atb cli uninstall [--to <目录>]              卸载终端命令（仅删除指向本插件 bin/atb 的链接）
  atb cli status                               查看安装状态（包装器位置、候选目录、PATH 提示）

Oncall 咨询看板（REQ-20260907-001；咨询单独立 ASK 序列，不进 REQ/BUG 状态机）：
  atb oncall new --title <标题> [--req <REQ-ID>] [--question-file <md>]
                                              创建咨询单（状态 待回复；正文可留空＝以标题作为正文；
                                              --req 绑定需求：派单读单自动携带该需求 README/design/test-cases）
  atb oncall list [--status pending|answering|answered|failed] [--req <REQ-ID>] [--json]
  atb oncall show <ASK-ID> [--json]           咨询单详情（含问题与各轮回答全文；绑定单含需求文档上下文）
  atb oncall ask <ASK-ID> --question-file <md> 追问（追加轮次，拉回待回复）
  atb oncall answer <ASK-ID> --by <会话> --mode zcode|codex [--file <md>]
                                              回答回传（缺省 --file 时从 stdin 读；转已回复）
  atb oncall dispatch <ASK-ID>… --mode zcode [--staff <客服人员>]
                                              生成 Oncall 主调度提示词（复制到 Zcode 新会话）

开放式讨论逐轮记录（REQ-20260910-018；讨论 Agent 会话经统一入口逐轮保存，看板只读展示）：
  atb disc show <ASK-ID> [--json]               讨论（新会话恢复上下文用：背景 + 纪要版本 + 全部轮次）
  atb disc round <ASK-ID> --file <round.json>   保存一轮（统一追加入口；round.json =
                                               {"user":"用户原文","summary":"回复总结","session":"来源会话","key":"幂等键"}；
                                               同 key 重试返回既有轮不重复；归属/字段不符明确报错）
  atb disc minutes <ASK-ID> --file <minutes.md> --base-version <N>
                                               更新纪要（乐观版本校验；版本冲突提示重读后再整理）

需求完善（REQ-20260907-003；REQ-20260908-020 起面向已接受单批量补 README 说明文档，涉及 UI 需含界面展示；design/test-cases 留待开发阶段；全程保持 accepted，不占实施互斥）：
  atb refine create [--ids ID1,ID2]
                                              创建完善任务（候选=已接受未完善；冻结候选+缺失原因+文档基线）
  atb refine next [--batch ID] [--by 会话]   子 Agent 领取一项（refine 互斥；实时吸收新接受的单）
  atb refine done <RUN-ID> --summary <要点>  完成回执（须真实改过条目文档）
  atb refine fail <RUN-ID> --reason <短句>   失败回执
  atb refine release <RUN-ID> [--reason 短句] 释放未回执的预留
  atb refine check [--batch ID]              主调度最小核对（≤2KiB）
  atb refine summary [--batch ID]            批次摘要（当前/计数/最近记录/提示词）
  atb refine pause [--off] [--batch ID]      暂停/恢复后续领取
  atb refine abort [--batch ID]              终止任务（剩余项出局；在途需在对应子代理会话人工停止）
  atb refine records [--batch ID] [--offset N] [--limit N]  执行记录分页

提交索引（REQ-20260911-009；条目 ↔ commit 双向查询，只读）：
  atb commit log <ITEM-ID>                     查该单全部提交（hash+消息；账本与 git 历史合并）
  atb commit which <HASH|消息文本>             从提交反查条目（消息含单号 REQ-/BUG-）
  （人工触发的批量 commit 命令组已随 REQ-20260911-010 回退下线；本地提交唯一路径为
   开发完成到待测试的自动提交，见 atb run autocommit）

状态机：submitted → accepted → planned → in-progress → done（人工驳回：done → in-progress、accepted → submitted、planned → accepted 移出计划）

营销 project-growth 工作流（REQ-20260910-022；外部 Agent 会话的统一回执入口，写入 marketing/agent-runs/）：
  atb growth receipt <RUN-ID> --file <draft.json> [--session <来源会话>]
                                              写入 AI 任务回执草稿（幂等：同任务重复提交跳过；
                                              输入基线过期 / 跨项目 / 数据不足带候选均拒绝，不覆盖他人更新）
  atb growth show <RUN-ID>                    查看任务（输入引用及版本 / 状态 / 摘要 / 草稿引用 / 回执日志；
                                              新会话按任务 ID 读取接续上下文）
  atb growth list                             任务列表（waiting / received / done 与执行结果）`;

// 把 ["--flag", "值"] 与位置参数拆开；值里允许带空格（shell 引号保证成一个 token）
function parseOpts(tokens, valueFlags) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const eq = t.indexOf('=');
    if (t.startsWith('--')) {
      const name = eq === -1 ? t.slice(2) : t.slice(2, eq);
      let val = eq === -1 ? null : t.slice(eq + 1);
      if (val === null && valueFlags.has(name) && i + 1 < tokens.length) val = tokens[++i];
      opts[name] = val === null ? true : val;
    } else {
      pos.push(t);
    }
  }
  return { pos, opts };
}

function shortType(t) {
  return t === 'requirement' ? 'req' : 'bug';
}

function typeFromArg(s) {
  if (s === 'req' || s === 'requirement') return 'requirement';
  if (s === 'bug') return 'bug';
  return null;
}

function truncate(s, n) {
  s = String(s || '');
  return [...s].length > n ? [...s].slice(0, n - 1).join('') + '…' : s;
}

function fmtTable(items) {
  const cols = [
    ['ID', 17, (x) => x.id],
    ['类型', 4, (x) => shortType(x.type)],
    ['状态', 12, (x) => x.status],
    ['认领者', 14, (x) => truncate(x.owner || '-', 14)],
    ['标题', 40, (x) => truncate(x.title, 40)],
  ];
  const rows = items.map((x) => cols.map(([, w, f]) => truncate(String(f(x) ?? ''), w).padEnd(w)).join('  '));
  const head = cols.map(([, w, f], i) => truncate(cols[i][0], w).padEnd(w)).join('  ');
  return [head, ...rows].join('\n');
}

function printStatusLine(st) {
  const marks = { submitted: '○', accepted: '◎', planned: '◈', 'in-progress': '◐', done: '●' };
  console.log(`${marks[st.status] || '·'} ${st.id}  [${st.status}]  ${st.title}`);
}

async function main() {
  const [cmd, ...rest] = args;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(USAGE);
    return;
  }

  if (cmd === 'init') {
    const dir = core.initData(cwd);
    console.log(`✓ 已初始化看板数据目录：${dir}`);
    console.log('  Git 工作流已就绪：当前分支 dev（REQ-20260911-009：开发在 dev 分支进行，到待测试自动提交；仅本地操作不 push）');
    console.log('  下一步：atb new req "需求标题"');
    return;
  }

  if (cmd === 'new') {
    const dataDir = core.requireDataDir(cwd);
    const { pos, opts } = parseOpts(rest, new Set(['desc']));
    const type = typeFromArg(pos[0]);
    if (!type) die(`new 的第一个参数必须是 req 或 bug（得到：${pos[0] ?? '空'}）`);
    const title = pos.slice(1).join(' ').trim();
    if (!title) die('缺少标题：atb new req|bug <标题>');
    // REQ-20260908-009：去掉 Bug 归属需求选项——一律独立 Bug，源单写 design.md 引入来源节。
    if (opts.req != null || opts.parent != null) {
      die('--req/--parent 已不再支持：Bug 一律独立创建；引入来源（源单）请写入 design.md「引入来源」节');
    }
    const st = core.createItem(dataDir, {
      type,
      title,
      description: opts.desc || '',
      parent: null,
      by: core.actor(),
      // REQ-20260910-015：--accept 一步创建并接受（人工终端专属一步直达 accepted；Agent 侧被 state-guard 拦截）
      accept: opts.accept === true || opts.accept === 'true',
    });
    if (st.status === 'accepted') {
      console.log(`✓ 已创建 ${st.id}：${st.title}（已接受，「创建并接受」一步完成）`);
      console.log(`  目录：${core.resolveItemDir(dataDir, st.id).dir}`);
      console.log('  已直接进入已接受（未完善），进入 AI 分析候选，无需再人工接受');
    } else {
      console.log(`✓ 已创建 ${st.id}：${st.title}（状态 submitted）`);
      console.log(`  目录：${core.resolveItemDir(dataDir, st.id).dir}`);
      console.log('  等待人工接受（Status Board「接受」或终端 atb status <ID> accepted）');
    }
    if (jsonOut) console.log(JSON.stringify(st, null, 2));
    return;
  }

  if (cmd === 'claim') {
    const dataDir = core.requireDataDir(cwd);
    const { pos, opts } = parseOpts(rest, new Set(['by']));
    if (!pos[0]) die('用法：atb claim <ID> [--by <会话标识>]');
    const st = core.claim(dataDir, pos[0], opts.by || undefined);
    // 提示与实际流转一致（BUG-20260903-004）：主路径直达 in-progress；存量续认状态不变，不谎报
    const tip =
      st.status === 'in-progress'
        ? '状态 in-progress，可直接实施'
        : `状态 ${st.status}（存量条目续认，需人工放行为 in-progress 后实施）`;
    console.log(`✓ 已认领 ${st.id}（owner: ${st.owner}，${tip}）`);
    if (jsonOut) console.log(JSON.stringify(st, null, 2));
    return;
  }

  if (cmd === 'rename') {
    // REQ-20260907-011：待接受条目改标题（status.title 与文档首行同步）；仅 submitted 可改。
    // REQ-20260908-011：--desc 同时编辑描述（README 描述节整体替换）；--desc - 从 stdin 读多行；
    // 带 --desc 时标题可省略（仅改描述），与网页编辑弹窗同口径。
    const dataDir = core.requireDataDir(cwd);
    const { pos, opts } = parseOpts(rest, new Set(['desc']));
    const [id, ...titleParts] = pos;
    const title = titleParts.join(' ').trim();
    const hasDesc = Object.prototype.hasOwnProperty.call(opts, 'desc');
    if (!id || (!title && !hasDesc)) die('用法：atb rename <ID> <新标题> [--desc <文本|->]');
    if (hasDesc) {
      let desc = opts.desc === true ? '' : String(opts.desc); // 裸 --desc 视为清空描述
      if (desc === '-') desc = fs.readFileSync(0, 'utf8'); // stdin 多行
      const st = core.editItem(dataDir, id, { title: title || undefined, description: desc, by: core.actor() });
      console.log(`✓ 已编辑 ${st.id}：标题「${st.title}」，描述已写回 README 对应章节（待接受）`);
      if (jsonOut) console.log(JSON.stringify(st, null, 2));
      return;
    }
    const st = core.renameItem(dataDir, id, { title, by: core.actor() });
    console.log(`✓ 已更改 ${st.id} 标题：${st.title}（待接受，文档首行已同步）`);
    if (jsonOut) console.log(JSON.stringify(st, null, 2));
    return;
  }

  if (cmd === 'delete') {
    // REQ-20260908-003：删除待接受条目（仅 submitted；目录整体移除，单号计数器不回退）。
    // 删除为人工清理操作，Agent 侧请遵循「不代替人工处置条目」的看板纪律。
    const dataDir = core.requireDataDir(cwd);
    const { pos } = parseOpts(rest, new Set());
    const id = pos[0];
    if (!id) die('用法：atb delete <ID>');
    const r = core.deleteItem(dataDir, id, { by: core.actor() });
    console.log(`✓ 已删除 ${r.id}「${r.title}」（待接受，条目目录已整体移除，不可恢复）`);
    if (jsonOut) console.log(JSON.stringify({ ok: true, id: r.id, title: r.title, type: r.type }, null, 2));
    return;
  }

  if (cmd === 'status') {
    const dataDir = core.requireDataDir(cwd);
    const { pos, opts } = parseOpts(rest, new Set(['force']));
    const [id, to] = pos;
    if (!id || !to) die('用法：atb status <ID> <submitted|accepted|in-progress|done>');
    if (core.HUMAN_ONLY_TO.has(to)) {
      console.log(`⚠ ${to} 是人工专属状态；请确认这是用户本人操作（Agent 侧会被钩子拦截）。`);
    }
    const { changed, status: st } = core.setStatus(dataDir, id, to, {
      by: core.actor(),
      // REQ-20260911-007：--force 越过待人工决策未答项的确认完成拦截（仅人工终端；Agent 被 state-guard 拦）
      force: opts.force === true,
    });
    if (changed) printStatusLine(st);
    else console.log(`= ${id} 已处于 ${to}，无变化`);
    if (jsonOut) console.log(JSON.stringify(st, null, 2));
    return;
  }

  if (cmd === 'report') {
    const dataDir = core.requireDataDir(cwd);
    const { pos, opts } = parseOpts(rest, new Set(['coverage', 'framework', 'summary', 'by', 'run']));
    if (!pos[0]) die('用法：atb report <ID> [--coverage N] [--framework 名称] [--summary 文本] [--by 会话] [--run RUN-ID]');
    const st = core.report(dataDir, pos[0], {
      coverage: opts.coverage,
      framework: opts.framework || '',
      summary: opts.summary || '',
      by: opts.by || undefined,
      run: opts.run ? { runId: opts.run } : null,
    });
    const cov = st.lastReport?.coverage;
    console.log(`✓ 已写入测试报告：${core.resolveItemDir(dataDir, st.id).dir}/test-report.md`);
    console.log(`  ${st.id} 标记为「待人工确认完成」${cov != null ? `（覆盖率 ${cov}%）` : ''}${opts.run ? ` · 关联运行 ${opts.run}` : ''}`);
    if (jsonOut) console.log(JSON.stringify(st, null, 2));
    return;
  }

  // ---------- 批量开发（REQ-20260906-002；REQ-20260908-010 改名） ----------

  if (cmd === 'batch') {
    await batchCmd(rest);
    return;
  }

  // ---------- Oncall 咨询看板（REQ-20260907-001） ----------

  if (cmd === 'oncall') {
    await oncallCmd(rest);
    return;
  }

  // ---------- 开放式讨论逐轮记录（REQ-20260910-018） ----------

  if (cmd === 'disc') {
    await discCmd(rest);
    return;
  }

  // ---------- 需求完善（REQ-20260907-003） ----------

  if (cmd === 'refine') {
    await refineCmd(rest);
    return;
  }

  // ---------- 提交索引查询（REQ-20260911-009；原批量 commit 命令组已随 REQ-20260911-010 回退） ----------

  if (cmd === 'commit') {
    await commitCmd(rest);
    return;
  }

  // ---------- 待人工决策承接（REQ-20260911-007） ----------

  if (cmd === 'hold') {
    await holdCmd(rest);
    return;
  }

  if (cmd === 'run') {
    await runCmd(rest);
    return;
  }

  if (cmd === 'list') {
    const dataDir = core.requireDataDir(cwd);
    const { opts } = parseOpts(rest, new Set(['type', 'status']));
    let items = core.listItems(dataDir);
    if (opts.type) {
      const t = typeFromArg(opts.type);
      if (!t) die('--type 只能是 req 或 bug');
      items = items.filter((x) => x.type === t);
    }
    if (opts.status) {
      if (!core.STATES.includes(opts.status)) die(`--status 非法：${opts.status}`);
      items = items.filter((x) => x.status === opts.status);
    }
    if (jsonOut) {
      console.log(JSON.stringify({ count: items.length, items }, null, 2));
      return;
    }
    if (!items.length) {
      console.log('（暂无条目；用 atb new req|bug 创建）');
      return;
    }
    console.log(fmtTable(items));
    const counts = {};
    for (const x of items) counts[x.status] = (counts[x.status] || 0) + 1;
    console.log(`\n共 ${items.length} 条：` + core.STATES.map((s) => `${s} ${counts[s] || 0}`).join(' · '));
    return;
  }

  if (cmd === 'show') {
    const dataDir = core.requireDataDir(cwd);
    const { pos } = parseOpts(rest, new Set());
    if (!pos[0]) die('用法：atb show <ID>');
    const st = core.getItemDetail(dataDir, pos[0]);
    if (jsonOut) {
      console.log(JSON.stringify(st, null, 2));
      return;
    }
    console.log(`${st.id}  ${st.title}`);
    console.log(`  类型：${shortType(st.type)}    状态：${st.status}    归属：${st.parent || '-'}`);
    console.log(`  认领者：${st.owner || '-'}    创建：${st.createdAt}    更新：${st.updatedAt}`);
    if (st.agentCompletedAt) console.log(`  ⚑ Agent 已完成（${st.agentCompletedAt}），等待人工确认`);
    if (st.lastReport) {
      const r = st.lastReport;
      console.log(`  最近报告：${r.at}${r.coverage != null ? ` · 覆盖率 ${r.coverage}%` : ''}${r.framework ? ` · ${r.framework}` : ''}`);
    }
    if (st.type === 'requirement') {
      console.log(`  Bug：${st.bugCount}（未完成 ${st.openBugCount}）${(st.bugs || []).map((b) => b.id).join(' ')}`);
    }
    console.log(`  文档：${st.docs.join(' · ') || '无'}`);
    console.log('  历史：');
    for (const h of st.history || []) {
      console.log(`    ${h.at}  ${h.from ?? '∅'} → ${h.to}  by ${h.by}${h.note ? `（${h.note}）` : ''}`);
    }
    return;
  }

  if (cmd === 'move') {
    const dataDir = core.requireDataDir(cwd);
    const { pos, opts } = parseOpts(rest, new Set(['req', 'parent']));
    if (!pos[0]) die('用法：atb move <BUG-ID> [--req <REQ-ID>|--standalone]');
    const parent = opts.standalone ? null : opts.req || opts.parent || null;
    const { moved } = core.moveBug(dataDir, pos[0], parent);
    console.log(moved ? `✓ ${pos[0]} 已${parent ? `归属 ${parent}` : '改为独立 Bug'}` : `= ${pos[0]} 归属无变化`);
    return;
  }

  if (cmd === 'prune-locks') {
    const dataDir = core.requireDataDir(cwd);
    const { opts } = parseOpts(rest, new Set(['dry-run']));
    const apply = !opts['dry-run'];
    const res = core.pruneLocks(dataDir, { apply });
    const kept = res.kept.map((k) => k.name);
    if (jsonOut) {
      console.log(JSON.stringify({ ...res, dryRun: !apply }, null, 2));
      return;
    }
    if (res.removed.length) {
      console.log(`${apply ? '✓' : '⟳ 预览：'}${apply ? '' : '将'}清理 ${res.removed.length} 把失效认领锁：`);
      for (const r of res.removed) console.log(`  - ${r.name}（${r.reason}）`);
    } else {
      console.log(`= 认领锁干净：保留 ${kept.length} 把在办锁，无需清理`);
    }
    if (kept.length) console.log(`  保留 ${kept.length} 把在办锁：${kept.join(' ')}`);
    if (res.skipped.length) console.log(`  跳过非认领锁文件：${res.skipped.join(' ')}`);
    if (!apply) console.log('  （--dry-run 预览模式，未实际删除）');
    return;
  }

  if (cmd === 'growth') {
    await growthCmd(rest);
    return;
  }

  if (cmd === 'serve') {
    await serveCmd(rest);
    return;
  }

  if (cmd === 'cli') {
    cliCmd(rest);
    return;
  }

  die(`未知命令：${cmd}\n\n${USAGE}`);
}

// ---------- 营销 project-growth 工作流（REQ-20260910-022）：growth 子命令 ----------

const GROWTH_STATUS_LABEL = { waiting: '等待回执 · 尚未收到结果', received: '草稿待处理', done: '已处理' };

async function growthCmd(rest) {
  const [sub, idArg, ...subRest] = rest;
  const { opts } = parseOpts(subRest, new Set(['file', 'session']));
  const dataDir = core.requireDataDir(cwd);

  if (sub === 'receipt') {
    if (!idArg || !opts.file) die('用法：atb growth receipt <任务ID> --file <草稿JSON文件> [--session <来源会话>]');
    let draft;
    try {
      draft = JSON.parse(fs.readFileSync(String(opts.file), 'utf8'));
    } catch (e) {
      die(`草稿文件读取失败（${opts.file}）：${e.message}`);
    }
    let r;
    try {
      r = growth.saveAgentRunReceipt(dataDir, { id: idArg, draft, session: opts.session || null, by: 'cli' });
    } catch (e) {
      if (e.fields) {
        console.error(`✗ ${e.message}`);
        for (const [k, v] of Object.entries(e.fields)) console.error(`  · ${k}：${v}`);
        process.exit(1);
      }
      die(e.message);
    }
    const run = r.run;
    // 一行 JSON 回执：外部会话可核验「已保存」（没有回执不宣称已保存）
    const line = r.duplicate
      ? { ok: true, duplicate: true, runId: idArg, status: run.status, result: 'idempotent-skip', contentChanged: !!r.contentChanged, draftRef: run.draftRef }
      : { ok: true, duplicate: false, runId: idArg, status: run.status, result: 'success', session: run.session, summary: run.summary, draftRef: run.draftRef, receiptAt: run.receiptAt };
    console.log(JSON.stringify(line));
    return;
  }

  if (sub === 'show') {
    if (!idArg) die('用法：atb growth show <任务ID>');
    let run;
    try {
      run = growth.readAgentRun(dataDir, idArg);
    } catch (e) {
      die(e.message);
    }
    if (jsonOut) {
      console.log(JSON.stringify(run, null, 2));
      return;
    }
    const inputs = run.inputs.map((i) => `${i.ref}${i.revision == null ? '' : `@r${i.revision}`}`).join(' · ');
    console.log(`◉ ${run.id}  [${GROWTH_STATUS_LABEL[run.status] || run.status}]  ${growth.GROWTH_TYPE_LABEL[run.type]}${run.continueOf ? `（接续 ${run.continueOf}）` : ''}`);
    console.log(`  来源会话：${run.session || '—'}    写入时间：${run.receiptAt || '—'}    执行结果：${run.receipts.at(-1)?.result || 'waiting'}`);
    console.log(`  输入引用及版本：${inputs || '—'}`);
    if (run.observation) console.log(`  观察期：${run.observation.from} ~ ${run.observation.to}`);
    console.log(`  输出摘要：${run.summary || '—（尚未收到回执）'}`);
    console.log(`  草稿引用：${run.draftRef || '—'}`);
    if (run.draft && run.draft.candidates.length) {
      for (const c of run.draft.candidates) {
        const mark = c.state === 'adopted' ? '已采纳' : c.state === 'kept' ? '保留草稿' : '待处理';
        console.log(`  候选 [${c.id}] ${growth.CANDIDATE_KIND_LABEL[c.kind] || c.kind} · ${mark}${c.resultRef ? ` → ${c.resultRef}` : ''}：${truncate(c.title, 60)}`);
      }
    }
    if (run.receipts.length > 1 || (run.receipts.length && run.receipts.at(-1).result !== 'success')) {
      console.log('  回执日志：');
      for (const x of run.receipts) console.log(`    - ${x.at} ${x.result}${x.reason ? `（${truncate(x.reason, 120)}）` : ''}`);
    }
    console.log('  任务提示词与草稿全文见 docs/agent-team-board/marketing/agent-runs/ 目录（跨会话接续可直接读取）');
    return;
  }

  if (sub === 'list') {
    const g = growth.readGrowth(dataDir);
    if (!g.initialized) {
      console.log('= 营销档案未初始化（无 project-growth 任务）');
      return;
    }
    if (jsonOut) {
      console.log(JSON.stringify(g.runs, null, 2));
      return;
    }
    if (!g.runs.length) {
      console.log('= 暂无 project-growth 任务（在看板营销模块右上角入口复制提示词后登记）');
      return;
    }
    for (const r of g.runs) {
      if (r.corrupt) {
        console.log(`✗ ${r.id}  [记录损坏 · 只读]`);
        continue;
      }
      console.log(`◉ ${r.id}  [${GROWTH_STATUS_LABEL[r.status] || r.status}]  ${r.typeLabel}${r.continueOf ? `（接续 ${r.continueOf}）` : ''}  ${r.result}`);
    }
    return;
  }

  die(`未知子命令：${sub}\n\n用法：atb growth receipt <任务ID> --file <draft.json> [--session <会话>] | atb growth show <任务ID> | atb growth list`);
}

// ---------- Oncall 咨询看板（REQ-20260907-001）：oncall 子命令 ----------

const ONCALL_USAGE = `用法：
  atb oncall new --title <标题> [--req <REQ-ID>] [--question-file <md>]
                                                             创建咨询单（状态 待回复；正文可留空＝以标题作为正文；
                                                             --req 绑定需求，派单读单自动携带需求文档上下文）
  atb oncall list [--status pending|answering|answered|failed] [--req <REQ-ID>] [--json]
  atb oncall show <ASK-ID> [--json]                          详情（含问题与各轮回答全文；绑定单含需求文档上下文）
  atb oncall ask <ASK-ID> --question-file <md>               追问（追加轮次，拉回待回复）
  atb oncall answer <ASK-ID> --by <会话> --mode zcode|codex [--file <md>|--stdin]
                                                             回答回传（转已回复）
  atb oncall dispatch <ASK-ID>… --mode zcode [--staff <客服人员>]
                                                             生成主调度提示词（zcode 派单）`;

const ONCALL_STATUS_LABEL = { pending: '待回复', answering: '回复中', answered: '已回复', failed: '失败' };

function readStdinAll() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { s += c; });
    process.stdin.on('end', () => resolve(s));
    process.stdin.on('error', () => resolve(s));
  });
}

async function oncallCmd(rest) {
  const [sub, ...subRest] = rest;
  if (!sub) die(ONCALL_USAGE);
  const dataDir = core.requireDataDir(cwd);
  const { pos, opts } = parseOpts(subRest, new Set(['title', 'question-file', 'question', 'status', 'req', 'by', 'mode', 'file', 'staff', 'stdin']));

  if (sub === 'new') {
    if (!opts.title) die('缺少 --title');
    let question = opts.question || '';
    if (opts['question-file']) {
      try { question = fs.readFileSync(path.resolve(cwd, opts['question-file']), 'utf8'); }
      catch (e) { die(`读取问题文件失败：${e.message}`); }
    }
    // REQ-20260908-013：正文可留空（--question/--question-file 均缺省时以标题作为正文，store 层回退）
    // REQ-20260908-022：--req 绑定需求（store 层校验 REQ- 编号且存在，落 ticket.json reqId）
    const t = oncall.createTicket(dataDir, { title: opts.title, question, req: opts.req || null, by: core.actor() });
    console.log(`✓ 已创建 ${t.id}：${t.title}（状态 ${ONCALL_STATUS_LABEL[t.status]}，无需人工接受）`);
    console.log(`  目录：${oncall.ticketDir(dataDir, t.id)}`);
    if (t.reqId) console.log(`  归属需求：${t.reqId}（派单读单将自动携带该需求 README/design/test-cases 上下文）`);
    if (jsonOut) console.log(JSON.stringify(t, null, 2));
    return;
  }

  if (sub === 'list') {
    // REQ-20260908-022：--req 按归属需求过滤（可与 --status 组合）
    const tickets = oncall.listTickets(dataDir, { status: opts.status || null, reqId: opts.req || null });
    if (jsonOut) { console.log(JSON.stringify({ count: tickets.length, tickets }, null, 2)); return; }
    if (!tickets.length) {
      console.log(opts.req ? `（需求 ${opts.req} 暂无讨论单；用 atb oncall new --req ${opts.req} --title … 创建）` : '（暂无咨询单；用 atb oncall new 创建）');
      return;
    }
    console.log(['ID', '状态', '模式', '轮数', '标题'].join('  '));
    for (const x of tickets) {
      const title = `${x.reqId ? `[${x.reqId}] ` : ''}${truncate(x.title, 40)}`;
      console.log(`${x.id}  ${(ONCALL_STATUS_LABEL[x.status] || x.status).padEnd(4)}  ${(x.lastMode || '-').padEnd(6)}  ${String(x.roundCount).padEnd(2)}  ${title}`);
    }
    console.log(`\n共 ${tickets.length} 单`);
    return;
  }

  if (sub === 'show') {
    if (!pos[0]) die('用法：atb oncall show <ASK-ID> [--json]');
    const full = oncall.readTicketFull(dataDir, pos[0]);
    if (jsonOut) { console.log(JSON.stringify(full, null, 2)); return; }
    console.log(`${full.id}  ${full.title}`);
    console.log(`  状态：${ONCALL_STATUS_LABEL[full.status] || full.status}    轮数：${full.roundCount}    创建：${full.createdAt}`);
    // REQ-20260908-022：绑定单输出归属需求与文档全文（zcode 子代理读单即得上下文，追问轮同样生效）
    if (full.req) {
      console.log(`  归属需求：${full.req.id}（${full.req.missing || !full.req.title ? '需求已删除' : full.req.title}，状态 ${full.req.missing || !full.req.status ? '—' : full.req.status}）`);
      if (!full.req.missing && full.req.docs.length) {
        console.log('  ── 需求文档上下文（回答须基于以下最新落盘文档）──');
        for (const d of full.req.docs) {
          console.log(`  【${d.name}】`);
          for (const line of String(d.content).trim().split('\n')) console.log(`  ${line}`);
        }
      }
    }
    for (const r of full.rounds) {
      console.log(`  —— 第 ${r.no} 轮${r.mode ? `（${r.mode}${r.staff ? ` · 客服 ${r.staff}` : ''}）` : ''}${r.error ? ` ⚠ ${r.error}` : ''}`);
      console.log(`  问题：${String(r.question || '').trim().split('\n').join(' ').slice(0, 200)}`);
      if (r.answer) console.log(`  回答：${String(r.answer).trim().split('\n').join(' ').slice(0, 200)}`);
    }
    return;
  }

  if (sub === 'ask') {
    if (!pos[0]) die('用法：atb oncall ask <ASK-ID> --question-file <md>');
    if (!opts['question-file']) die('缺少 --question-file');
    let question;
    try { question = fs.readFileSync(path.resolve(cwd, opts['question-file']), 'utf8'); }
    catch (e) { die(`读取追问文件失败：${e.message}`); }
    const t = oncall.askTicket(dataDir, pos[0], { question, by: core.actor() });
    console.log(`✓ 已追问 ${t.id}（第 ${t.rounds.length} 轮，状态 ${ONCALL_STATUS_LABEL[t.status]}）`);
    return;
  }

  if (sub === 'answer') {
    if (!pos[0]) die('用法：atb oncall answer <ASK-ID> --by <会话> --mode zcode|codex [--file <md>]');
    if (!opts.by) die('缺少 --by（回答来源会话，如 oncall-20260907-张三）');
    const mode = opts.mode || 'zcode';
    if (mode !== 'zcode' && mode !== 'codex') die('--mode 只能是 zcode 或 codex');
    let answer = '';
    if (opts.file) {
      try { answer = fs.readFileSync(path.resolve(cwd, opts.file), 'utf8'); }
      catch (e) { die(`读取回答文件失败：${e.message}`); }
    } else {
      answer = await readStdinAll();
    }
    const t = oncall.answerTicket(dataDir, pos[0], { answer, by: opts.by, mode, staff: opts.staff || '' });
    console.log(`✓ 已回传 ${t.id} 第 ${t.rounds[t.rounds.length - 1].no} 轮回答（来源 ${opts.by}，状态 ${ONCALL_STATUS_LABEL[t.status]}）`);
    return;
  }

  if (sub === 'dispatch') {
    if (!pos.length) die('用法：atb oncall dispatch <ASK-ID>… --mode zcode [--staff <客服人员>]');
    const mode = opts.mode || 'zcode';
    const r = oncall.dispatchTickets(dataDir, { ids: pos, mode, staff: opts.staff || '', by: core.actor(), kind: 'batch' });
    if (mode === 'zcode') {
      console.log(`✓ 已派单 ${pos.length} 单（zcode${r.staff ? ` · 客服 ${r.staff}` : ' · 客服 未指定'}）；提示词如下（复制到 Zcode 本项目新会话发送）：`);
      console.log('  -----');
      for (const line of r.prompt.split('\n')) console.log(`  ${line}`);
      console.log('  -----');
    } else {
      console.log(`✓ 已派单 ${pos.length} 单（codex 后台执行由看板服务发起，CLI 仅记账；请通过看板派发）`);
    }
    return;
  }

  die(`未知子命令：oncall ${sub}\n\n${ONCALL_USAGE}`);
}

// ---------- 开放式讨论逐轮记录（REQ-20260910-018）：disc 子命令 ----------
// 统一写入入口的命令行形态：Agent 会话按启动/继续讨论提示词逐轮调用 round 与 minutes；
// 看板侧不提供写入端点，全部写入经此处（归属校验、幂等与版本保护在 oncall-store）。

const DISC_USAGE = `用法：
  atb disc show <ASK-ID> [--json]                讨论详情（背景 + 纪要版本 + 全部轮次；新会话恢复上下文用）
  atb disc round <ASK-ID> --file <round.json>    保存一轮（统一追加入口，同 key 重试不重复）
  atb disc minutes <ASK-ID> --file <minutes.md> --base-version <N>
                                                 更新纪要（乐观版本校验，冲突提示重读）`;

async function discCmd(rest) {
  const [sub, ...subRest] = rest;
  if (!sub) die(DISC_USAGE);
  const dataDir = core.requireDataDir(cwd);
  const { pos, opts } = parseOpts(subRest, new Set(['file', 'base-version']));

  if (sub === 'show') {
    if (!pos[0]) die('用法：atb disc show <ASK-ID> [--json]');
    const full = oncall.discussionFull(dataDir, pos[0]);
    if (jsonOut) {
      console.log(JSON.stringify({
        id: full.id,
        title: full.title,
        status: full.status,
        phase: full.phase,
        background: full.background,
        minutes: full.minutes,
        rounds: full.rounds,
        legacyRoundCount: full.legacyRoundCount,
      }, null, 2));
      return;
    }
    console.log(`◆ ${full.id} ${full.title}（${full.status === 'archived' ? '已归档' : '讨论中'}）`);
    console.log(`  已保存轮数：${full.rounds.length}${full.legacyRoundCount ? `（另有旧版历史问答 ${full.legacyRoundCount} 轮）` : ''}`);
    console.log(`  纪要版本：${full.minutes.version}${full.minutes.updatedAt ? `（更新于 ${full.minutes.updatedAt}）` : '（尚无纪要）'}${full.minutes.stale ? ' · 纪要待更新（落后于最新轮次）' : ''}`);
    if (full.minutes.content) console.log(`  纪要文件：${path.join(oncall.ticketDir(dataDir, full.id), 'minutes.md')}`);
    for (const r of full.rounds) {
      console.log(`  [${r.roundId}] ${r.at}${r.session ? ` · ${r.session}` : ''}`);
      console.log(`    用户：${truncate(r.user.replace(/\s+/g, ' '), 80)}`);
      console.log(`    总结：${truncate(r.summary.replace(/\s+/g, ' '), 80)}`);
    }
    return;
  }

  if (sub === 'round') {
    if (!pos[0]) die('用法：atb disc round <ASK-ID> --file <round.json>');
    let raw = '';
    if (opts.file) {
      try { raw = fs.readFileSync(path.resolve(cwd, opts.file), 'utf8'); }
      catch (e) { die(`读取轮次文件失败：${e.message}（本轮未保存，请检查路径后重试）`); }
    } else if (!process.stdin.isTTY) {
      raw = await readStdinAll();
    } else {
      die('缺少 --file <round.json>（或经 stdin 提供 JSON）');
    }
    let body;
    try { body = JSON.parse(raw); }
    catch (e) { die(`轮次文件不是合法 JSON：${e.message}（本轮未保存）`); }
    try {
      const r = oncall.appendDiscussionRound(dataDir, pos[0], {
        user: body.user,
        summary: body.summary,
        session: body.session,
        key: body.key,
      });
      if (r.duplicate) {
        console.log(`✓ 本轮此前已保存：第 ${r.no} 轮（${r.roundId}）——同 key 重试不产生重复轮次`);
      } else {
        console.log(`✓ 已保存第 ${r.no} 轮（${r.roundId}，${r.at}）`);
      }
      if (jsonOut) console.log(JSON.stringify(r, null, 2));
    } catch (e) {
      die(`保存轮次失败：${e.message}（本轮未保存；同 key 重试不会产生重复轮次）`);
    }
    return;
  }

  if (sub === 'minutes') {
    if (!pos[0]) die('用法：atb disc minutes <ASK-ID> --file <minutes.md> --base-version <N>');
    if (!opts.file) die('缺少 --file <minutes.md>');
    if (opts['base-version'] == null || opts['base-version'] === true) die('缺少 --base-version <N>（先 atb disc show 读取当前纪要版本）');
    let minutes = '';
    try { minutes = fs.readFileSync(path.resolve(cwd, opts.file), 'utf8'); }
    catch (e) { die(`读取纪要文件失败：${e.message}（纪要未更新，已保存轮次不受影响）`); }
    try {
      const r = oncall.saveDiscussionMinutes(dataDir, pos[0], {
        minutes,
        baseVersion: Number(opts['base-version']),
      });
      console.log(`✓ 纪要已更新（版本 ${r.version}，${r.updatedAt}）`);
      if (jsonOut) console.log(JSON.stringify(r, null, 2));
    } catch (e) {
      die(`纪要更新失败：${e.message}`);
    }
    return;
  }

  die(`未知子命令：disc ${sub}\n\n${DISC_USAGE}`);
}

// ---------- 需求完善（REQ-20260907-003）：refine 子命令 ----------

const REFINE_USAGE = `用法：
  atb refine create [--ids ID1,ID2]          创建完善任务并冻结候选（候选=已接受未完善；提示词通用，--mode 已忽略）
  atb refine next [--batch ID] [--by 会话]      子 Agent 领取一项（refine 互斥；实时吸收新接受的单）
  atb refine done <RUN-ID> --summary <要点>     完成回执（须真实改过条目文档）
  atb refine fail <RUN-ID> --reason <短句>      失败回执
  atb refine release <RUN-ID> [--reason 短句]   释放未回执的预留
  atb refine check [--batch ID]                 主调度最小核对（≤2KiB）
  atb refine summary [--batch ID]               批次摘要
  atb refine pause [--off] [--batch ID]         暂停/恢复后续领取
  atb refine abort [--batch ID]                 终止任务（剩余项出局、在途需人工停止）
  atb refine records [--batch ID] [--offset N] [--limit N]  执行记录分页

完善口径（REQ-20260908-015 / REQ-20260908-021 / BUG-20260908-017）：需求只补 README（描述 + 验收标准；涉及 UI 需含界面布局、
交互行为、状态反馈与界面展示——条目目录内可交互 html 演示 ui-demo.html，README 界面展示节链接
./ui-demo.html 并保留文字说明，单文件、内联 CSS/JS、无外网依赖、无构建步骤、浏览器直接打开可交互；
ASCII 线框仅作可选补充）；design/test-cases 留待开发阶段；Bug 补现象/复现步骤/
期望行为/验收说明——涉及 UI 的 Bug 同样须提供界面展示（界面展示节链接 ./ui-demo.html + 条目目录内
可交互 html 演示，建议对照展示缺陷现象与期望修复后状态）。REQ-20260908-020：完善面向已接受（accepted）单，条目保持已接受；
REQ-20260909-010：开启「完善完成后自动转入计划」（设置 → 批量任务）时，done 回执核验通过后由系统自动把条目
accepted → planned（回显「已自动转入计划」，属预期系统行为，Agent 不得据此暂停；Agent 自身仍不得改条目状态）；
REQ-20260909-011：仅子代理模式（提示词单一通用版，任意 Agent 会话可执行，不再按执行 Agent 分叉）`;

async function refineCmd(rest) {
  const [sub, ...subRest] = rest;
  if (!sub) die(REFINE_USAGE);
  const dataDir = core.requireDataDir(cwd);
  const projectRoot = path.resolve(dataDir, '..', '..');

  if (sub === 'create') {
    const { opts } = parseOpts(subRest, new Set(['mode', 'ids']));
    // REQ-20260909-011：--mode 保留但忽略（提示词单一通用版，任意值均按通用子代理模式创建）；
    // 子代理模型指令固定「跟随主调度会话」（设置手动覆盖入口已随本需求移除）
    void opts.mode;
    if (opts.dev !== undefined) {
      die('开发人员设置已移除（REQ-20260910-027）：创建完善任务不再需要开发人员。用法：atb refine create [--ids ID1,ID2]');
    }
    const ids = opts.ids ? String(opts.ids).split(',').map((s) => s.trim()).filter(Boolean) : null;
    const { batch: b, created, queued, queuePosition } = refine.createRefineBatch(dataDir, {
      ids, projectRoot,
      modelSource: 'follow',
    });
    // BUG-20260909-017：幂等返回存量批次时回显 prompt 按当前口径归一（旧模型行不再透出；账本不回写）
    // BUG-20260910-001：归一升级为全量口径（执行端段/旧领取前缀一并归一）
    // BUG-20260910-008：回显按当前「完善完成后自动转入计划」开关分态（实时口径，账本不回写）
    const autoPlanOn = refine.refineAutoPlanOn(dataDir);
    const prompt = taskSettings.normalizePromptForDisplay(b.prompt, { autoPlan: autoPlanOn });
    const payload = {
      batchId: b.batchId, created,
      queued: queued || undefined, queuePosition,
      mode: b.mode,
      counts: { candidates: b.candidates.length },
      prompt,
    };
    if (jsonOut) { console.log(JSON.stringify(payload)); return; }
    if (created && queued) console.log(`✓ 已创建完善批次 ${b.batchId} 并已加入队列，排第 ${queuePosition} 位`);
    else if (created) console.log(`✓ 已创建完善批次：${b.batchId}（子代理模式）`);
    else if (queued) console.log(`= 已有未结束的完善批次（幂等返回，未新建）：${b.batchId}（排第 ${queuePosition} 位）`);
    else console.log(`= 已有未结束完善批次（幂等返回，未新建）：${b.batchId}`);
    console.log(`  候选 ${b.candidates.length} 项 · 子代理模式（提示词通用，任意 Agent 会话可执行） · ${autoPlanOn ? '条目保持 accepted（已接受），不占实施互斥 · 完善后自动转入计划已开启：done 回执后系统自动 accepted → planned（回显「已自动转入计划」，属预期系统行为，Agent 不得据此暂停）' : '条目保持 accepted（已接受），不占实施互斥'}`);
    console.log('  完整清单已存：docs/agent-team-board/refine/batches/' + b.batchId + '/batch.json');
    if (prompt) {
      console.log('  主调度提示词（复制后在当前项目的 Agent 会话发送）：');
      console.log('  -----');
      for (const line of prompt.split('\n')) console.log(`  ${line}`);
      console.log('  -----');
    }
    return;
  }

  const needBatch = (opts) => opts.batch
    || (refine.queueHeadRefineBatch(dataDir) || {}).batchId
    || die('尚无完善批次：请先 atb refine create');

  if (sub === 'next') {
    const { opts } = parseOpts(subRest, new Set(['batch', 'by']));
    const batchId = needBatch(opts);
    const r = refine.nextRefineItem(dataDir, batchId, { owner: opts.by || undefined });
    if (r.stop) {
      const explain = {
        paused: '已暂停后续领取（在途执行不受影响）',
        blocked: '剩余项暂不可完善（不派空 worker）',
        finished: '本批完善范围已处理完毕',
        aborted: '任务已终止：不再派发后续项',
      }[r.stop] || r.stop;
      die(`完善批次 ${batchId} 未派发：${explain}\n  计数：${JSON.stringify(r.counts)}`);
    }
    if (jsonOut) { console.log(JSON.stringify(r)); return; }
    console.log(`✓ 已预留 ${r.itemId}（runId: ${r.runId}，owner: ${r.owner}）`);
    console.log(`  条目目录：${r.itemDir}`);
    console.log(`  缺失原因：${r.reasons.join('、')}`);
    console.log(`  文档：${(r.docs || []).join(' · ') || '无'}`);
    // REQ-20260908-015 / REQ-20260908-021 / BUG-20260908-017：完善口径收敛——需求只补 README（涉及 UI 界面展示须为
    // 可交互 html 演示：条目目录 ui-demo.html + README 界面展示节链接），design/test-cases 留待开发阶段；
    // 涉及 UI 的 Bug 同样须界面展示（演示建议对照缺陷现象与期望修复后状态）
    const target = r.type === 'requirement'
      ? '需求只补 README（描述 + 验收标准；涉及 UI 需含界面布局、交互行为、状态反馈与界面展示——创建可交互 ui-demo.html 并在界面展示节链接 ./ui-demo.html）'
      : 'Bug 补现象/复现步骤/期望行为/验收说明（涉及 UI 的 Bug 同样须界面展示——创建可交互 ui-demo.html 并在界面展示节链接 ./ui-demo.html）';
    console.log(`  下一步：直接编辑条目 markdown 补全——${target}（未知事实写「待确认」）→ refine done → 主会话 refine check`);
    return;
  }

  if (sub === 'done' || sub === 'fail') {
    const { pos, opts } = parseOpts(subRest, new Set(['summary', 'reason', 'by']));
    if (!pos[0]) die(`用法：atb refine ${sub} <RUN-ID> --${sub === 'done' ? 'summary 要点' : 'reason 短句'}`);
    const { receipt } = refine.finishRefineRun(dataDir, pos[0], {
      result: sub === 'done' ? 'done' : 'failed',
      summary: opts.summary || '',
      reason: opts.reason || '',
    });
    if (jsonOut) { console.log(JSON.stringify(receipt)); return; }
    console.log(`✓ 已收尾完善运行 ${pos[0]}（${receipt.result}），回执如下（原样返回主会话）：`);
    // REQ-20260909-010：done 回执在 JSON 前输出流转结果行（成功 / 未转及原因 / 警示），回执本身不因流转失败而失败
    if (receipt.result === 'done' && receipt.autoPlan) {
      if (receipt.autoPlan.transitioned) {
        console.log(`  已自动转入计划：${receipt.itemId}（accepted → planned，进入 AI 开发候选）`);
      } else if (receipt.autoPlan.reason === 'not-enabled') {
        console.log('  未开启自动转入计划：需人工移入计划（设置 → 批量任务 → 完善完成后自动转入计划）');
      } else {
        console.log(`  ${refine.autoPlanResultText(receipt.autoPlan)}`);
      }
    }
    console.log(JSON.stringify(receipt));
    return;
  }

  if (sub === 'release') {
    const { pos, opts } = parseOpts(subRest, new Set(['reason']));
    if (!pos[0]) die('用法：atb refine release <RUN-ID> [--reason 短句]');
    const r = refine.releaseRefineRun(dataDir, pos[0], { reason: opts.reason || '预留释放' });
    console.log(`✓ 已释放完善预留 ${r.runId}（${r.itemId} 保持 accepted，完善状态回置未完善）`);
    if (jsonOut) console.log(JSON.stringify(r));
    return;
  }

  if (sub === 'abort') {
    const { opts } = parseOpts(subRest, new Set(['batch']));
    const batchId = needBatch(opts);
    const r = refine.abortRefineBatch(dataDir, batchId);
    if (jsonOut) { console.log(JSON.stringify(r)); return; }
    console.log(`✓ 已终止完善任务 ${batchId}：停止派发后续项，剩余项已出局。`);
    console.log(`  ${r.notice}`);
    console.log(`  计数：${JSON.stringify(r.counts)}`);
    return;
  }

  if (sub === 'check') {
    const { opts } = parseOpts(subRest, new Set(['batch']));
    const r = refine.checkRefineBatch(dataDir, needBatch(opts));
    if (jsonOut) { console.log(JSON.stringify(r)); return; }
    const cur = r.current ? `${r.current.itemId}（${r.current.runId}，owner ${r.current.owner}，${r.current.phase}）` : '—';
    console.log(`完善批次 ${r.batchId} [${r.status}]  nextAction: ${r.nextAction}`);
    console.log(`  当前执行：${cur}`);
    console.log(`  计数：总计 ${r.counts.total} · 完成 ${r.counts.done} · 失败 ${r.counts.failed} · 出局 ${r.counts.skipped} · 已释放 ${r.counts.interrupted} · 待处理 ${r.counts.remaining}`);
    if (r.notice) console.log(`  ${r.notice}`);
    return;
  }

  if (sub === 'summary') {
    const { opts } = parseOpts(subRest, new Set(['batch']));
    const s = refine.refineSummary(dataDir, opts.batch || undefined);
    const payload = {
      batch: refine.refineBatchPublicView(s.batch),
      current: s.currentRun,
      counts: s.counts,
      records: s.records,
      nextAction: s.check.nextAction,
      notice: s.check.notice || null,
    };
    if (jsonOut) { console.log(JSON.stringify(payload)); return; }
    // REQ-20260913-003：公开视图不再透出批次号——文本摘要按本轮执行状态输出
    console.log(`完善任务 [${s.batch.status}]（${s.batch.mode}）  nextAction: ${s.check.nextAction}`);
    console.log(`  计数：${JSON.stringify(s.counts)}`);
    if (s.currentRun) console.log(`  当前执行：${s.currentRun.itemId}（${s.currentRun.runId}，${s.currentRun.phase}）`);
    for (const rec of s.records) console.log(`  · ${rec.itemId} ${rec.result} ${rec.at}${rec.summary ? `（${rec.summary}）` : ''}${rec.reason ? `（${rec.reason}）` : ''}`);
    if (s.check.notice) console.log(`  ${s.check.notice}`);
    return;
  }

  if (sub === 'pause') {
    const { opts } = parseOpts(subRest, new Set(['batch']));
    const batchId = needBatch(opts);
    const paused = !opts.off;
    // BUG-20260908-015：已终止/已结束批次不能暂停/恢复——透传明确错误而不是静默成功
    const terminalReason = refine.refineBatchTerminalReason(refine.getRefineBatch(dataDir, batchId));
    if (terminalReason) die(`完善批次 ${batchId} ${terminalReason}`);
    const b = refine.pauseRefineBatch(dataDir, batchId, paused);
    if (jsonOut) { console.log(JSON.stringify({ ok: true, batch: refine.refineBatchPublicView(b, { autoPlan: refine.refineAutoPlanOn(dataDir) }) })); return; }
    console.log(paused
      ? `✓ 已请求暂停后续领取（${batchId}）。在途执行不会被取消。`
      : `✓ 已恢复后续领取（${batchId}）。`);
    return;
  }

  if (sub === 'records') {
    const { opts } = parseOpts(subRest, new Set(['batch', 'offset', 'limit']));
    const batchId = needBatch(opts);
    const r = refine.listRefineRuns(dataDir, batchId, { offset: Number(opts.offset || 0), limit: Number(opts.limit || 20) });
    if (jsonOut) { console.log(JSON.stringify(r)); return; }
    console.log(`完善批次 ${batchId} 执行记录（${r.total} 条，offset ${Number(opts.offset || 0)}）：`);
    for (const rec of r.records) {
      console.log(`  · ${rec.runId}  ${rec.itemId}  ${rec.result}  ${rec.at}${rec.summary ? `（${rec.summary}）` : ''}${rec.reason ? `（${rec.reason}）` : ''}`);
    }
    if (!r.records.length) console.log('  （本页无记录）');
    return;
  }

  die(`未知子命令：refine ${sub}\n\n${REFINE_USAGE}`);
}

// ---------- 提交索引查询（REQ-20260911-009）：commit 子命令 ----------
// REQ-20260911-010：人工触发的批量 commit 命令组（create/next/done/fail/release/check/
// summary/records/pause/abort，原 REQ-20260910-013）已整体回退下线——本地提交唯一路径为
// REQ-20260911-009「开发完成到待测试自动提交」（atb run autocommit 可重试）。旧命令一律
// 明确报错，不产生任何 git 操作、不落任何账本；本命令组仅保留条目 ↔ commit 双向索引查询。

const COMMIT_USAGE = `用法：
  atb commit log <ITEM-ID>                     查该单全部提交（hash+消息；账本与 git 历史合并）
  atb commit which <HASH|消息文本>             从提交反查条目（消息含单号 REQ-/BUG-）

口径：只读查询，不执行任何 git 写操作。人工触发的批量 commit（REQ-20260910-013）已随
REQ-20260911-010 回退下线；本地提交唯一路径为开发完成到待测试的自动提交（REQ-20260911-009，
失败可 atb run autocommit <RUN-ID> 重试）。`;

// 已回退的批量 commit 旧子命令：统一明确提示，不留半可用状态
const ROLLED_BACK_COMMIT_SUBS = new Set(['create', 'next', 'done', 'fail', 'release', 'check', 'summary', 'records', 'pause', 'abort', 'status', 'runs']);

function commitRolledBackDie(sub) {
  die(`批量 commit 已回退（REQ-20260911-010）：atb commit ${sub} 属人工触发的批量提交流程，已整体下线。\n`
    + '本地 git 提交唯一路径：开发完成到待测试由系统自动提交（REQ-20260911-009；失败可 atb run autocommit <RUN-ID> 重试）。\n'
    + '本命令组仅保留索引查询（log / which）。不产生任何 git 操作。\n\n'
    + COMMIT_USAGE);
}

async function commitCmd(rest) {
  const [sub, ...subRest] = rest;
  if (!sub) die(COMMIT_USAGE);
  if (ROLLED_BACK_COMMIT_SUBS.has(sub)) commitRolledBackDie(sub);
  const dataDir = core.requireDataDir(cwd);
  const projectRoot = path.resolve(dataDir, '..', '..');

  // REQ-20260911-009 条目 ↔ commit 双向索引
  // 单 → 全部提交：账本（经核验）与 git 历史（消息含单号）合并，与看板「已提交」徽标同源
  if (sub === 'log') {
    const [itemId] = subRest;
    if (!itemId) die('用法：atb commit log <ITEM-ID>（查该单全部提交：hash + 消息）');
    const rows = gitFlow.itemCommitLog(dataDir, projectRoot, itemId);
    if (!rows.length) die(`${itemId} 尚无关联提交（自动提交完成后可查）`);
    if (jsonOut) { console.log(JSON.stringify(rows)); return; }
    console.log(`${itemId} 的提交（${rows.length} 个）：`);
    for (const r of rows) console.log(`  · ${r.hash.slice(0, 10)}  ${r.subject || '（消息不可读）'}  [${r.via === 'ledger' ? '账本核验' : 'git 历史'}]`);
    return;
  }

  // commit → 条目：从提交消息中的单号反查（hash 或直接粘贴消息文本均可）
  if (sub === 'which') {
    const [ref] = subRest;
    if (!ref) die('用法：atb commit which <HASH|消息文本>（从提交反查条目）');
    const hit = gitFlow.itemOfCommit(dataDir, projectRoot, ref);
    if (jsonOut) { console.log(JSON.stringify(hit)); return; }
    if (!hit) die('该提交消息不含本看板条目单号（REQ-/BUG-），无法反查');
    console.log(`${hit.itemId} ${hit.title}`);
    return;
  }

  die(`未知子命令：commit ${sub}\n\n${COMMIT_USAGE}`);
}

// ---------- 待人工决策承接（REQ-20260911-007）：hold 子命令 ----------
// 声明（declare）与查询（list/show）面向 worker 与人工；作答（answer）/ 复工（resume）/
// 作废（cancel）为人工专属——Agent 的 Bash 调用会被 hooks/state-guard.mjs 拦截（与
// atb status accepted|planned|done 同口径），人工在终端或 Status Board 操作。

const HOLD_USAGE = `用法：
  atb hold declare <ID> (--question 决策问题)... [--reason 短句] [--run RUN-ID] [--by 会话]
                                        worker 声明条目待人工决策（附问题清单，可关联运行）
  atb hold list [--all] [--json]        待人工确认清单（等待时长/未答计数/原因；--all 含已复工/作废/闭环）
  atb hold show <ID>                    单条详情（问题清单、作答进度、事件留痕）
  atb hold answer <ID> --q <问题号> --text <答复> [--note 补充说明] [--by 人工]
                                        人工作答（仅人工；支持部分作答草稿，缺项时复工保持禁用）
  atb hold resume <ID> [--by 人工]      人工复工（决策齐备后条目回已计划队列，被 AI 开发重新取单）
  atb hold cancel <ID> [--note 说明] [--by 人工]
                                        人工作废声明（条目状态不变，按其他方式处理）`;

// 可重复值参数收集：--question a --question b → [a, b]（parseOpts 会覆盖重复键，此处手工收集）
function collectRepeated(tokens, name, pos, opts) {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== `--${name}`) continue;
    const v = tokens[i + 1];
    if (v != null && !v.startsWith('--')) { pos.push(v); i++; }
  }
  return pos;
}

async function holdCmd(rest) {
  const [sub, ...subRest] = rest;
  const dataDir = core.requireDataDir(cwd);
  if (!sub || sub === 'help' || sub === '--help') {
    console.log(HOLD_USAGE);
    return;
  }

  if (sub === 'declare') {
    const { pos, opts } = parseOpts(subRest, new Set(['reason', 'run', 'by']));
    const id = pos[0];
    if (!id) die('用法：atb hold declare <ID> (--question 决策问题)... [--reason 短句] [--run RUN-ID] [--by 会话]');
    const questions = collectRepeated(subRest, 'question', []);
    const rec = hold.declareHold(dataDir, id, {
      questions,
      reason: opts.reason || '',
      runId: opts.run || null,
      by: opts.by || undefined,
    });
    if (jsonOut) { console.log(JSON.stringify({ ok: true, itemId: id, unanswered: holdStates.unansweredCount(rec), round: rec.round })); return; }
    console.log(`✓ 已声明 ${id} 待人工决策（第 ${rec.round} 轮，${rec.questions.length} 项问题，${(rec.declaredBy || '').trim()}）`);
    if (rec.runId) console.log(`  关联运行：${rec.runId}`);
    console.log('  待人工确认视图：Status Board「待人工确认」聚合区 · atb hold list · 条目目录 decisions.md');
    console.log('  下一步：交 blocked 回执收尾本次运行（atb run receipt <RUN-ID> --result blocked --reason "待人工决策"），人工补齐决策并复工后条目回到已计划队列');
    return;
  }

  if (sub === 'list') {
    const { opts } = parseOpts(subRest, new Set(['all']));
    const r = hold.listHolds(dataDir, { all: opts.all === true });
    if (jsonOut) { console.log(JSON.stringify(r)); return; }
    if (!r.items.length) {
      console.log(opts.all ? '（无待人工决策记录）' : '（当前没有待人工确认的条目）');
      return;
    }
    console.log(`待人工确认（${r.count}）：`);
    for (const it of r.items) {
      console.log(`  ⚠ ${it.itemId}  ${truncate(it.title, 30)}  [${it.stateLabel}]  已等待 ${hold.waitingText(it.declaredAt)}`);
      console.log(`    未答 ${it.unanswered}/${it.total}${it.reason ? ` · ${truncate(it.reason, 40)}` : ''}${it.runId ? ` · 运行 ${it.runId}` : ''}`);
    }
    return;
  }

  if (sub === 'show') {
    const { pos } = parseOpts(subRest, new Set());
    if (!pos[0]) die(`用法：atb hold show <ID>`);
    const d = hold.holdDetail(dataDir, pos[0]);
    if (jsonOut) { console.log(JSON.stringify(d)); return; }
    console.log(`${d.itemId} ${d.title}  [${d.stateLabel}]（第 ${d.round} 轮，历史 ${d.archivedRounds} 轮）`);
    console.log(`  声明：${d.declaredAt}（${d.declaredBy}）${d.runId ? ` · 运行 ${d.runId}` : ''} · 已等待 ${hold.waitingText(d.declaredAt)}`);
    if (d.reason) console.log(`  原因：${d.reason}`);
    console.log(`  问题（未答 ${d.unanswered}/${d.total}）：`);
    for (const q of d.questions) {
      console.log(`    ${q.answer ? '✓' : '○'} ${q.id} ${q.text}${q.answer ? ` → ${truncate(q.answer, 40)}（${q.answeredBy || '?'}）` : ''}${q.note ? `〔${truncate(q.note, 30)}〕` : ''}`);
    }
    for (const e of d.events.slice(-8)) {
      console.log(`    · ${String(e.at).slice(0, 19).replace('T', ' ')} ${e.kind}${e.by ? `（${e.by}）` : ''}${e.note ? `：${truncate(e.note, 40)}` : ''}`);
    }
    return;
  }

  if (sub === 'answer') {
    const { pos, opts } = parseOpts(subRest, new Set(['q', 'text', 'note', 'by']));
    const id = pos[0];
    if (!id || !opts.q || opts.text == null) die(`用法：atb hold answer <ID> --q <问题号> --text <答复> [--note 补充说明] [--by 人工]`);
    const r = hold.answerHold(dataDir, id, { answers: [{ q: opts.q, text: opts.text, note: opts.note || '' }], by: opts.by || undefined });
    if (jsonOut) { console.log(JSON.stringify(r)); return; }
    console.log(`✓ 已保存 ${id} 决策草稿（未答 ${r.unanswered}/${r.total}${r.missing ? `，缺 ${r.missing.join(' / ')}` : '，已齐备可复工'}）`);
    return;
  }

  if (sub === 'resume') {
    const { pos, opts } = parseOpts(subRest, new Set(['by']));
    const id = pos[0];
    if (!id) die('用法：atb hold resume <ID> [--by 人工]');
    const r = hold.resumeHold(dataDir, id, { by: opts.by || undefined });
    if (jsonOut) { console.log(JSON.stringify(r)); return; }
    console.log(`✓ 已复工 ${id}：条目回到已计划（planned）队列，可被 AI 开发重新取单；决策记录见条目目录 decisions.md`);
    return;
  }

  if (sub === 'cancel') {
    const { pos, opts } = parseOpts(subRest, new Set(['note', 'by']));
    const id = pos[0];
    if (!id) die('用法：atb hold cancel <ID> [--note 说明] [--by 人工]');
    const r = hold.cancelHold(dataDir, id, { note: opts.note || '', by: opts.by || undefined });
    if (jsonOut) { console.log(JSON.stringify(r)); return; }
    console.log(`✓ 已作废 ${id} 的待人工决策声明（条目状态不变，按其他方式处理）`);
    return;
  }

  die(`未知子命令：hold ${sub}\n\n${HOLD_USAGE}`);
}

// ---------- 批量开发（REQ-20260906-002；REQ-20260908-010 改名）：batch / run 子命令 ----------

const BATCH_USAGE = `用法：
  atb batch create                      创建批次并输出主调度提示词（有未结束批次时入队排队）
  atb batch next [--batch ID] [--by 会话]   worker 领取一项（原子预留 + 项目实施互斥）
  atb batch check [--batch ID]        主调度最小核对（≤2KiB）
  atb batch summary [--batch ID]      批次摘要（当前执行/计数/最近记录/提示词）
  atb batch pause [--off] [--batch ID]  暂停/恢复后续领取
  atb batch abort [--batch ID]          终止任务（停止派发、剩余项出局；在途需人工停止）
  atb batch records [--batch ID] [--offset N] [--limit N]  执行记录分页
  atb batch delete <BATCH-ID>     删除未在执行的批次（在途/待核对会被拒绝）
  atb run receipt <RUN-ID> --result reported --report-ref <文件>  上报回执（--report-ref 必填）
  atb run receipt <RUN-ID> --result blocked|failed --reason <短句>  阻塞/失败回执（--reason 必填）
  atb run release <RUN-ID> [--reason 短句]  释放未认领的预留
  atb run autocommit <RUN-ID>  重试到待测试自动提交（幂等；仅 reported 运行可重试）`;

function batchPublicView(b) {
  // 主会话/摘要视图：不含 candidates 全队列（上下文载荷合同）；limit 已随上限设置移除（REQ-20260908-019）
  // BUG-20260910-001：prompt 按当前口径归一（存量批次冻结的执行端字样不再透出；账本不回写）
  // REQ-20260910-027：不再透出开发人员字段（存量账本保留不迁移）
  const { batchId, mode, status, pauseRequested, createdAt, lastActivityAt } = b;
  const prompt = taskSettings.normalizePromptForDisplay(b.prompt);
  // BUG-20260909-001：公开人工终止口径（Boolean 归一化：存量缺字段 → false，自然结束不误判）
  return {
    batchId, mode, status, pauseRequested, createdAt, lastActivityAt, prompt,
    abortRequested: Boolean(b.abortRequested), aborted: Boolean(b.aborted),
  };
}

async function batchCmd(rest) {
  const [sub, ...subRest] = rest;
  if (!sub) die(BATCH_USAGE);
  const dataDir = core.requireDataDir(cwd);
  const projectRoot = path.resolve(dataDir, '..', '..');

  if (sub === 'create') {
    const { opts } = parseOpts(subRest, new Set());
    if (opts.limit !== undefined) {
      die('批次上限设置已移除（REQ-20260908-019）：创建批次默认冻结全部可入批候选，无需 --limit。用法：atb batch create');
    }
    if (opts.dev !== undefined) {
      die('开发人员设置已移除（REQ-20260910-027）：创建批次不再需要开发人员。用法：atb batch create');
    }
    // REQ-20260909-011：提示词单一通用版（不再按执行 Agent 分叉）；子代理模型指令固定
    // 「跟随主调度会话」（设置手动覆盖入口已随本需求移除）
    const { batch: b, created, queued, queuePosition, pruned } = batch.createBatch(dataDir, {
      projectRoot,
      modelSource: 'follow',
    });
    const blocked = batch.blockedCountAtCreate(dataDir, b);
    const prunedCount = created && pruned ? pruned.removed.length : 0;
    // BUG-20260910-001：幂等返回存量批次时回显 prompt 按当前口径归一（新建路径幂等无变化；账本不回写）
    const prompt = taskSettings.normalizePromptForDisplay(b.prompt);
    const payload = { batchId: b.batchId, created, queued: queued || undefined, queuePosition, counts: { candidates: b.candidates.length, blocked, pruned: prunedCount }, prompt };
    if (jsonOut) { console.log(JSON.stringify(payload)); return; }
    if (created && queued) {
      console.log(`✓ 已创建批次 ${b.batchId} 并已加入队列，排第 ${queuePosition} 位，当前批次结束后自动开始`);
    } else if (created) {
      console.log(`✓ 已创建批次：${b.batchId}`);
    } else if (queued) {
      console.log(`= 队尾已有相同候选的排队批次（幂等返回，未新建）：${b.batchId}（排第 ${queuePosition} 位，当前批次结束后自动开始）`);
    } else {
      console.log(`= 已有未结束批次（幂等返回，未新建）：${b.batchId}`);
    }
    console.log(`  候选 ${b.candidates.length} · 受依赖阻塞 ${blocked}`);
    if (prunedCount) {
      console.log(`  已清理最旧批次 ${prunedCount} 个（最多保留 ${batch.BATCH_RETENTION_MAX} 个）：${pruned.removed.join('、')}`);
    }
    console.log('  完整清单已存：docs/agent-team-board/dispatch/batches/' + b.batchId + '/batch.json');
    console.log('  提示词（复制后在当前项目的 Agent 会话发送；复制成功不代表已启动，登记运行后才显示执行中）：');
    console.log('  -----');
    for (const line of prompt.split('\n')) console.log(`  ${line}`);
    console.log('  -----');
    return;
  }

  // 缺省批次解析队首（最早未结束，REQ-20260906-025）：排队批次不被最新批次顶掉；
  // 全部结束时回退最新批次（已结束面板 / 创建下一批语义）。
  const needBatch = (opts) => opts.batch
    || (batch.queueHeadBatch(dataDir) || batch.latestBatch(dataDir) || {}).batchId
    || die('尚无批次：请先 atb batch create');

  if (sub === 'next') {
    const { opts } = parseOpts(subRest, new Set(['batch', 'by']));
    const batchId = needBatch(opts);
    const r = batch.nextItem(dataDir, batchId, { owner: opts.by || undefined });
    if (r.stop) {
      const explain = {
        paused: '已暂停后续领取（在途执行不受影响；立即停止请到 Zcode 原生任务界面操作）',
        blocked: '本批仅余依赖受阻项，暂无可实施候选（不派空 worker）',
        finished: '本批范围已处理完毕（新接受的条目留给下一批）',
      }[r.stop] || r.stop;
      die(`批次 ${batchId} 未派发：${explain}\n  计数：${JSON.stringify(r.counts)}`);
    }
    if (jsonOut) { console.log(JSON.stringify(r)); return; }
    console.log(`✓ 已预留 ${r.itemId}（runId: ${r.runId}，owner: ${r.owner}）`);
    console.log(`  条目目录：${r.itemDir}`);
    console.log(`  执行规范：${r.workerSpec}`);
    console.log(`  文档：${(r.docs || []).join(' · ') || '无'}`);
    console.log('  下一步：claim 同一 owner → TDD 实施 → report --run → run receipt');
    return;
  }

  if (sub === 'check') {
    const { opts } = parseOpts(subRest, new Set(['batch']));
    const batchId = needBatch(opts);
    const r = batch.checkBatch(dataDir, batchId);
    if (jsonOut) { console.log(JSON.stringify(r)); return; }
    const cur = r.current ? `${r.current.itemId}（${r.current.runId}，owner ${r.current.owner}，${r.current.phase}）` : '—';
    console.log(`批次 ${r.batchId} [${r.status}]  nextAction: ${r.nextAction}`);
    console.log(`  当前执行：${cur}`);
    console.log(`  计数：总计 ${r.counts.total} · 已上报 ${r.counts.reported} · 受阻 ${r.counts.blocked} · 失败 ${r.counts.failed} · 待处理 ${r.counts.remaining}${r.counts.blockedPending ? ` · 受阻待处理 ${r.counts.blockedPending}` : ''}`);
    if (r.notice) console.log(`  ${r.notice}`);
    return;
  }

  if (sub === 'summary') {
    const { opts } = parseOpts(subRest, new Set(['batch']));
    const batchId = opts.batch || undefined;
    const s = batch.batchSummary(dataDir, batchId);
    const payload = {
      batch: batchPublicView(s.batch),
      current: s.currentRun,
      counts: s.counts,
      blockedCount: s.blockedIds.length,
      records: s.records,
      nextAction: s.check.nextAction,
      notice: s.check.notice || null,
    };
    if (jsonOut) { console.log(JSON.stringify(payload)); return; }
    console.log(`批次 ${s.batch.batchId} [${s.batch.status}]  nextAction: ${s.check.nextAction}`);
    console.log(`  计数：${JSON.stringify(s.counts)} · 受阻 ${s.blockedIds.length} 项`);
    if (s.currentRun) console.log(`  当前执行：${s.currentRun.itemId}（${s.currentRun.runId}，${s.currentRun.phase}）`);
    for (const rec of s.records) console.log(`  · ${rec.itemId} ${rec.result} ${rec.at}${rec.reason ? `（${rec.reason}）` : ''}`);
    if (s.check.notice) console.log(`  ${s.check.notice}`);
    return;
  }

  if (sub === 'pause') {
    const { opts } = parseOpts(subRest, new Set(['batch']));
    const batchId = needBatch(opts);
    const paused = !opts.off;
    // BUG-20260908-023：已终止/已结束批次不能暂停/恢复——透传明确错误而不是静默成功
    const terminalReason = batch.batchTerminalReason(batch.getBatch(dataDir, batchId));
    if (terminalReason) die(`批次 ${batchId} ${terminalReason}`);
    const b = batch.pauseBatch(dataDir, batchId, paused);
    if (jsonOut) { console.log(JSON.stringify({ ok: true, batch: batchPublicView(b) })); return; }
    console.log(paused
      ? `✓ 已请求暂停后续领取（${batchId}）。在途执行不会被取消；立即停止请到 Zcode 原生任务界面操作。`
      : `✓ 已恢复后续领取（${batchId}），worker 可继续领取下一项。`);
    return;
  }

  if (sub === 'abort') {
    // REQ-20260908-020 终止开发任务：停止派发、剩余项出局、在途运行落人工终止 interrupted、锁释放
    const { opts } = parseOpts(subRest, new Set(['batch']));
    const batchId = needBatch(opts);
    const r = batch.abortBatch(dataDir, batchId);
    if (jsonOut) { console.log(JSON.stringify(r)); return; }
    console.log(`✓ 已终止开发任务 ${batchId}：停止派发后续项，剩余项已出局。`);
    console.log(`  ${r.notice}`);
    console.log(`  计数：${JSON.stringify(r.counts)}`);
    return;
  }

  if (sub === 'records') {
    const { opts } = parseOpts(subRest, new Set(['batch', 'offset', 'limit']));
    const batchId = needBatch(opts);
    const offset = Number(opts.offset || 0);
    const limit = Number(opts.limit || 20);
    const r = batch.listRuns(dataDir, batchId, { offset, limit });
    if (jsonOut) { console.log(JSON.stringify(r)); return; }
    console.log(`批次 ${batchId} 执行记录（${r.total} 条，offset ${offset}）：`);
    for (const rec of r.records) console.log(`  · ${rec.runId}  ${rec.itemId}  ${rec.result}  ${rec.at}${rec.reason ? `（${rec.reason}）` : ''}`);
    if (!r.records.length) console.log('  （本页无记录）');
    return;
  }

  if (sub === 'delete') {
    // REQ-20260907-013 删除未在执行的批次：破坏性操作必须显式指定批次号，不走缺省解析（防误删队首）
    const { pos, opts } = parseOpts(subRest, new Set(['batch']));
    const batchId = pos[0] || opts.batch;
    if (!batchId) die(`用法：atb batch delete <BATCH-ID>（或 --batch <ID>）\n只允许删除未在执行的批次；在途运行 / 待人工核对会被拒绝。`);
    const r = batch.deleteBatch(dataDir, String(batchId));
    if (jsonOut) { console.log(JSON.stringify(r)); return; }
    console.log(`✓ 已删除批次 ${r.batchId}（仅移除批次账本；条目与运行记录不受影响，队列位次自动前移）`);
    return;
  }

  die(`未知子命令：batch ${sub}\n\n${BATCH_USAGE}`);
}

async function runCmd(rest) {
  const [sub, runId, ...subRest] = rest;
  if (!sub || !runId) die(BATCH_USAGE);
  const dataDir = core.requireDataDir(cwd);

  if (sub === 'receipt') {
    const { opts } = parseOpts(subRest, new Set(['result', 'report-ref', 'reason', 'safe-to-continue', 'no-safe-to-continue']));
    let safe = null;
    if (opts['safe-to-continue']) safe = true;
    if (opts['no-safe-to-continue']) safe = false;
    const { receipt } = batch.finishRun(dataDir, runId, {
      result: opts.result,
      reportRef: opts['report-ref'] || null,
      reason: opts.reason || '',
      safeToContinue: safe,
    });
    if (jsonOut) { console.log(JSON.stringify(receipt)); return; }
    console.log(`✓ 已收尾运行 ${runId}（${receipt.result}），回执如下（原样返回主会话）：`);
    console.log(JSON.stringify(receipt));
    return;
  }

  if (sub === 'release') {
    const { opts } = parseOpts(subRest, new Set(['reason']));
    const r = batch.releaseReservation(dataDir, runId, { reason: opts.reason || '预留释放' });
    console.log(`✓ 已释放预留 ${r.runId}（${r.itemId} 可被重新领取/他人认领）`);
    if (jsonOut) console.log(JSON.stringify(r));
    return;
  }

  // REQ-20260911-009 自动提交重试：到待测试自动提交失败的运行，人工/流程重试（幂等）
  if (sub === 'autocommit') {
    const r = batch.retryAutoCommit(dataDir, runId);
    if (jsonOut) { console.log(JSON.stringify(r)); return; }
    const ac = r.autoCommit;
    if (ac.status === 'committed') {
      console.log(`✓ 已完成 ${r.itemId} 的自动提交（${ac.commits.length} 个提交）：`);
      for (const c of ac.commits) console.log(`  · ${c.hash.slice(0, 10)}  ${c.subject}`);
    } else {
      console.log(`= ${r.itemId} 自动提交跳过/未完成（${ac.status}）：${ac.reason || '无'}`);
    }
    // BUG-20260913-006：待人工路径显式提示，不静默留脏
    if (Array.isArray(ac.pendingManual) && ac.pendingManual.length) {
      console.log(`! ${ac.pendingManual.length} 个预留前已脏且本单动过的路径待人工核对提交：`);
      for (const p of ac.pendingManual) console.log(`  ? ${p}`);
    }
    return;
  }

  die(`未知子命令：run ${sub}\n\n${BATCH_USAGE}`);
}

// ---------- 终端命令安装（REQ-20260908-007）：bin/atb 包装器 + cli install/uninstall/status ----------

const CLI_USAGE = `用法：
  atb cli install [--to <目录>]     安装终端命令（目标目录创建指向 bin/atb 的符号链接；
                                    缺省自动选择：PATH 中可写的 /usr/local/bin → ~/.local/bin
                                    → ~/bin；均不可用时创建 ~/.local/bin 并提示加入 PATH）
  atb cli uninstall [--to <目录>]   卸载终端命令（仅删除指向本插件 bin/atb 的链接；
                                    缺省扫描全部候选目录）
  atb cli status                    查看安装状态（包装器位置、候选目录、PATH 提示）

说明：本子命令与看板数据目录无关，可在任意目录执行（无需先 atb init）。
注意：--to 指安装目标目录；全局 --dir 指看板项目根，两者语义不同。`;

function cliCmd(rest) {
  const [sub, ...subRest] = rest;
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    console.log(CLI_USAGE);
    return;
  }

  const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const binPath = path.join(pluginRoot, 'bin', 'atb');
  if (!fs.existsSync(binPath)) die(`缺少包装器脚本：${binPath}（插件安装不完整）`);

  // --to 指安装目标目录（不用 --dir：那是全局的看板项目根旗标，进入子命令前已被剥离）
  const { opts } = parseOpts(subRest, new Set(['to']));
  const home = os.homedir();
  const candidates = ['/usr/local/bin', path.join(home, '.local', 'bin'), path.join(home, 'bin')];

  const isWritableDir = (d) => {
    try {
      const st = fs.statSync(d);
      if (!st.isDirectory()) return false;
      fs.accessSync(d, fs.constants.W_OK | fs.constants.X_OK);
      return true;
    } catch { return false; }
  };
  const dirInPath = (d) => {
    const target = path.resolve(d);
    return String(process.env.PATH || '').split(path.delimiter).some((p) => p && path.resolve(p) === target);
  };
  // 「同一文件」判断：双侧 realpath 实化比较（安装侧可能是经插件缓存软链的路径）
  const pointsToWrapper = (link) => {
    try {
      return fs.realpathSync(link) === fs.realpathSync(binPath);
    } catch { return false; }
  };
  const linkState = (d) => {
    const link = path.join(d, 'atb');
    const st = fs.lstatSync(link, { throwIfNoEntry: false });
    if (!st) return 'none';
    if (st.isSymbolicLink() && pointsToWrapper(link)) return 'ours';
    return 'foreign';
  };
  const pathHint = (d) => console.log(
    `  ⚠ ${d} 不在 PATH 中，请加入后生效（zsh/bash 示例）：\n` +
    `    echo 'export PATH="${d}:$PATH"' >> ~/.zshrc && source ~/.zshrc`
  );

  if (sub === 'install') {
    let dir = opts.to ? path.resolve(cwd, opts.to) : null;
    let needPathHint = false;
    if (!dir) {
      // 候选序：优先「在 PATH 且可写」，其次「可写」，最后创建 ~/.local/bin
      dir = candidates.find((d) => dirInPath(d) && isWritableDir(d))
        || candidates.find((d) => isWritableDir(d))
        || path.join(home, '.local', 'bin');
    }
    fs.mkdirSync(dir, { recursive: true });
    if (!(fs.statSync(binPath).mode & 0o111)) fs.chmodSync(binPath, 0o755); // 修复丢失的执行位

    const link = path.join(dir, 'atb');
    const state = linkState(dir);
    if (state === 'ours') {
      console.log(`= 已安装：${link} → ${binPath}（幂等返回，无需重复安装）`);
      return;
    }
    if (state === 'foreign') {
      die(`${link} 已存在且不指向本插件 bin/atb，拒绝覆盖。\n  请先手动处理（确认无用后删除：rm ${link}），再重新执行安装。`);
    }
    fs.symlinkSync(binPath, link, 'file');
    console.log(`✓ 已安装终端命令：${link} → ${binPath}`);
    if (!dirInPath(dir)) { needPathHint = true; pathHint(dir); }
    console.log('  验证：新开终端执行 atb --help（或在当前 shell 执行 hash -r 后重试）');
    if (jsonOut) console.log(JSON.stringify({ ok: true, link, target: binPath, inPath: !needPathHint }));
    return;
  }

  if (sub === 'uninstall') {
    const dirs = opts.to ? [path.resolve(cwd, opts.to)] : candidates;
    let removed = 0;
    for (const d of dirs) {
      const state = linkState(d);
      if (state === 'none') continue;
      const link = path.join(d, 'atb');
      if (state === 'foreign') {
        if (opts.to) die(`${link} 不是指向本插件 bin/atb 的链接，拒绝删除。`);
        continue; // 扫描模式：外来文件跳过不碰
      }
      fs.unlinkSync(link);
      console.log(`✓ 已卸载终端命令：${link}`);
      removed++;
    }
    if (!removed) console.log('= 未安装：未发现指向本插件 bin/atb 的 atb 命令，无需卸载');
    if (jsonOut) console.log(JSON.stringify({ ok: true, removed }));
    return;
  }

  if (sub === 'status') {
    console.log(`包装器：${binPath}${fs.statSync(binPath).mode & 0o111 ? '' : '（⚠ 缺执行位，install 时会自动修复）'}`);
    let installed = false;
    for (const d of candidates) {
      const state = linkState(d);
      const label = state === 'ours' ? `已安装 → ${binPath}` : state === 'foreign' ? '外来文件（非本插件，未触碰）' : '未安装';
      if (state === 'ours') installed = true;
      console.log(`  ${d}：${label}`);
    }
    console.log(installed
      ? '  状态：可直接在终端使用 atb 命令'
      : '  状态：未安装；执行 atb cli install 后即可在终端直接使用 atb 命令');
    return;
  }

  die(`未知子命令：cli ${sub}\n\n${CLI_USAGE}`);
}

// ---------- serve：一键启动看板服务（REQ-20260902-003） ----------

const http = await import('node:http');

function probeHealth(port) {
  return new Promise((resolve) => {
    const req = http.default.request(
      { hostname: '127.0.0.1', port, path: '/api/health', method: 'GET', timeout: 1500 },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ ok: res.statusCode === 200, body: data }));
      }
    );
    req.on('error', () => resolve({ ok: false }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
    req.end();
  });
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- BUG-20260907-017：看板服务版本过旧检测与自动重启 ----------
// 服务是常驻进程（路由集启动时固化），静态前端却实时读盘；代码更新后旧进程缺新接口
// （如 /api/refine/*），新前端调用得 404「未知接口」报错。serve 探活复用前先比对：
// 磁盘服务代码（server.mjs + lib/*.mjs）mtime 新于服务启动时间，或 health 无 startedAt
// （早于本修复的服务）→ 视为过旧，SIGTERM 优雅重启（服务端落账收尾），一条命令自愈。

function serverCodeMtime(scriptsDir) {
  let latest = 0;
  const see = (f) => {
    try { const m = fs.statSync(f).mtimeMs; if (m > latest) latest = m; } catch {}
  };
  see(path.join(scriptsDir, 'server.mjs'));
  try {
    for (const n of fs.readdirSync(path.join(scriptsDir, 'lib'))) {
      if (n.endsWith('.mjs')) see(path.join(scriptsDir, 'lib', n));
    }
  } catch {}
  return latest;
}

function pidOnPort(port) {
  // health 未暴露 pid 的老服务：借 lsof 按端口定位（macOS/Linux；不可用时返回 null 走手动指引）
  try {
    const r = spawnSync('lsof', ['-nP', '-ti', `tcp:${port}`], { encoding: 'utf8', timeout: 3000 });
    const pids = String(r.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
    return pids.length ? Number(pids[0]) : null;
  } catch {
    return null;
  }
}

const waitPortFree = async (port, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const h = await probeHealth(port);
    if (!h.ok) return true;
    await sleepMs(200);
  }
  return false;
};

async function serveCmd(rest) {
  const { pos, opts } = parseOpts(rest, new Set(['port', 'log']));
  if (opts.help || opts.h) {
    console.log('用法：atb serve [--port N] [--open] [--log FILE]\n后台启动看板服务（已运行则复用；版本过旧时自动重启）；--open 同时用系统浏览器打开当前项目看板。');
    return;
  }
  const port = Number(opts.port || process.env.ATB_PORT || 8888);
  const dataDir = core.dataDirFrom(cwd);
  const projectRoot = dataDir ? path.resolve(dataDir, '..', '..') : path.resolve(cwd);
  const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

  // 探活：已运行 → 校验版本（过旧自动重启，否则复用）
  let health = await probeHealth(port);
  if (health.ok) {
    let info = null;
    try { info = JSON.parse(health.body || '{}'); } catch { info = null; }
    const diskNew = serverCodeMtime(scriptsDir);
    const startedAt = info && info.startedAt ? Date.parse(info.startedAt) : NaN;
    const stale = Number.isFinite(startedAt)
      ? diskNew > startedAt + 1000 // 1s 容差：避免同秒写入/启动的边界误判
      : true; // health 无 startedAt：服务早于本修复，必为过旧
    if (!stale) {
      console.log(`✓ 看板已在运行（复用现有实例）：http://127.0.0.1:${port}`);
      console.log(`  项目：${projectRoot}`);
    } else {
      const oldPid = (info && Number.isFinite(Number(info.pid)) ? Number(info.pid) : null) ?? pidOnPort(port);
      console.log(`⚠ 看板服务版本过旧${Number.isFinite(startedAt) ? `（启动于 ${info.startedAt}，磁盘代码已更新）` : '（早于本版本，health 无启动时间）'}，正在自动重启加载新版本…`);
      let replaced = false;
      if (oldPid) {
        try { process.kill(oldPid, 'SIGTERM'); } catch {}
        if (await waitPortFree(port)) replaced = true;
      }
      if (!replaced) {
        console.error(`✗ 无法自动重启过旧服务（未能停止旧进程${oldPid ? ` pid ${oldPid}` : '：未定位到进程，且 lsof 不可用'}）。`);
        console.error(`  请手动执行：kill ${oldPid || `$(lsof -ti tcp:${port})`} && atb serve --port ${port}`);
        process.exit(1);
      }
      health = await probeHealth(port); // 旧进程已停：走下方冷启动分支
    }
  }
  if (!health.ok) {
    const serverPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.mjs');
    const logFile = opts.log || '/tmp/agent-team-board.log';
    const child = spawn(process.execPath, [serverPath], {
      cwd: projectRoot,
      env: { ...process.env, ATB_PORT: String(port) },
      detached: true,
      stdio: ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')],
    });
    child.unref();
    let up = false;
    for (let i = 0; i < 25; i++) {
      await sleepMs(200);
      if ((await probeHealth(port)).ok) { up = true; break; }
    }
    if (!up) {
      console.error(`✗ 服务启动失败，日志：${logFile}`);
      process.exit(1);
    }
    console.log(`✓ 看板服务已后台启动：http://127.0.0.1:${port}`);
    console.log(`  项目：${projectRoot}`);
    console.log(`  PID：${child.pid}（停止：kill ${child.pid}）· 日志：${logFile}`);
  }

  if (opts.open) {
    const url = `http://127.0.0.1:${port}/?project=${encodeURIComponent(projectRoot)}`;
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    try {
      spawn(opener, [url], { detached: true, stdio: 'ignore' }).unref();
      console.log(`✓ 已在系统浏览器打开：${url}`);
      console.log('  提示：ZCode 内置浏览器右侧面板需在会话内用 /board 打开。');
    } catch {
      console.log(`请手动打开：${url}`);
    }
  } else {
    console.log(`  打开：http://127.0.0.1:${port}（或加 --open 自动打开浏览器）`);
  }
}

try {
  await main();
} catch (e) {
  die(e.message);
}
