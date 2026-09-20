#!/usr/bin/env node
// REQ-20260918-003 clone 后从 git 历史重建看板状态（atb rebuild）
// 用法：node scripts/tests/req-20260918-003.test.mjs
// 覆盖（见条目 test-cases.md R1–R9）：
//   · 判定：有提交 → done / 无提交 → submitted（含正文含单号、嵌套 Bug、标题与创建时间解析）；
//   · 写入：runtime/status/<ID>.json 与现有结构一致，listItems / atb show 可读；
//   · 依据：命中提交 hash + 主题 / 无提交痕迹；
//   · 安全边界：runtime/status 已有非 rebuild 产生的条目状态 → 拒绝；
//   · 幂等：重跑不追加 history、不翻转已判定状态；中断后重跑补齐剩余；
//   · CLI：输出清单 + 汇总计数 + usage 登记帮助文本；
//   · 只读保障：git HEAD/提交数/分支/data 文档/config.json 不变；
//   · 空看板 / 未初始化 / 非 git 项目兜底。

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/core.mjs';
import * as rebuild from '../lib/rebuild.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ATB = path.join(pluginRoot, 'scripts', 'atb.mjs');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const tmpRoots = [];
const mkTmp = (prefix) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmpRoots.push(root);
  return root;
};

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r;
}

function atb(args, cwd) {
  const r = spawnSync(process.execPath, [ATB, ...args, '--dir', cwd], { encoding: 'utf8', timeout: 90_000 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

// 构造「clone 后」项目：data/ 条目文档齐全、runtime/ 不存在（或为空）、git 历史带部分单号提交
function mkCloneProj() {
  const root = mkTmp('atb-rebuild-');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 't@example.com']);
  git(root, ['config', 'user.name', 't']);
  const board = path.join(root, 'agent-team-board');
  const mkItem = (rel, id, title, withReadme = true) => {
    const dir = path.join(board, 'data', rel);
    fs.mkdirSync(dir, { recursive: true });
    if (withReadme) {
      fs.writeFileSync(path.join(dir, 'README.md'),
        `# ${id} ${title}\n\n- 状态：submitted（待人工接受）\n- 创建：2026-09-18T08:00:00.000Z\n\n## 描述\n\n正文\n`);
    } else {
      fs.writeFileSync(path.join(dir, 'design.md'), '# design\n'); // README 缺失：标题兜底为 ID
    }
  };
  mkItem('requirements/REQ-20260918-101', 'REQ-20260918-101', '需求甲标题');
  mkItem('requirements/REQ-20260918-102', 'REQ-20260918-102', '需求乙标题');
  mkItem('bugs/BUG-20260918-201', 'BUG-20260918-201', '缺陷丙标题');
  mkItem('requirements/REQ-20260918-101/bugs/BUG-20260918-202', 'BUG-20260918-202', '嵌套缺陷丁', false);
  fs.writeFileSync(path.join(root, '.gitignore'), 'agent-team-board/runtime/\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'chore: 初始导入']);
  fs.writeFileSync(path.join(root, 'feature-a.txt'), 'a\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'feat: 实现需求甲 REQ-20260918-101']);
  fs.writeFileSync(path.join(root, 'fix-c.txt'), 'c\n');
  git(root, ['add', '-A']);
  // 主题不含单号、正文含（commit-store「历史消息含单号」为全消息口径）
  git(root, ['commit', '-q', '-m', 'fix: 修复缺陷', '-m', '关联 BUG-20260918-201']);
  return root;
}

const boardOf = (root) => path.join(root, 'agent-team-board');
const statusFileOf = (root, id) => path.join(boardOf(root), 'runtime', 'status', `${id}.json`);
const readJsonFile = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

const IDS = {
  A: 'REQ-20260918-101', // 有提交（主题含单号）→ done
  B: 'REQ-20260918-102', // 无提交 → submitted
  C: 'BUG-20260918-201', // 有提交（正文含单号）→ done
  D: 'BUG-20260918-202', // 嵌套 Bug、无 README、无提交 → submitted
};

// ---------- R1 判定与写入 ----------

t('R1 判定与写入：有提交→done、无提交→submitted、正文含单号→done、嵌套 Bug 覆盖', () => {
  const root = mkCloneProj();
  const r = rebuild.rebuildBoardStatus(boardOf(root));
  assert.equal(r.total, 4, `应扫描到 4 个条目（含嵌套 Bug）：${JSON.stringify(r.lines)}`);
  assert.equal(r.done, 2);
  assert.equal(r.submitted, 2);
  assert.equal(r.written, 4);

  const stA = core.readStatus(path.join(boardOf(root), 'data', 'requirements', IDS.A));
  assert.equal(stA.status, 'done');
  assert.equal(stA.type, 'requirement');
  assert.equal(stA.title, '需求甲标题', '标题应从 README 首行解析');
  assert.equal(stA.createdAt, '2026-09-18T08:00:00.000Z', '创建时间应从 README「- 创建：」行解析');
  const stB = core.readStatus(path.join(boardOf(root), 'data', 'requirements', IDS.B));
  assert.equal(stB.status, 'submitted');
  const stC = core.readStatus(path.join(boardOf(root), 'data', 'bugs', IDS.C));
  assert.equal(stC.status, 'done', '提交正文含单号也应判 done（历史消息含单号口径）');
  assert.equal(stC.type, 'bug');
  const stD = core.readStatus(path.join(boardOf(root), 'data', 'requirements', IDS.A, 'bugs', IDS.D));
  assert.equal(stD.status, 'submitted');
  assert.equal(stD.title, IDS.D, 'README 缺失时标题兜底为 ID');
  assert.ok(stD.createdAt, 'README 缺失时 createdAt 兜底为当前时间');

  // history 留痕：from null → 判定状态，by 标记 rebuild 来源
  for (const st of [stA, stB, stC, stD]) {
    assert.ok(Array.isArray(st.history) && st.history.length === 1, `${st.id} history 应恰一条`);
    const h = st.history[0];
    assert.equal(h.from, null);
    assert.equal(h.to, st.status);
    assert.equal(h.by, rebuild.REBUILD_ACTOR);
    assert.ok(String(h.note || '').includes('rebuild'), `${st.id} history note 应留痕 rebuild 来源`);
  }
  assert.ok(String(stA.history[0].note).includes('REQ') || stA.history[0].note.includes('feat'), 'done 项 note 应含依据提交信息');
});

t('R2 结构与可读性：状态文件字段与现有结构一致，listItems 全量可读', () => {
  const root = mkCloneProj();
  rebuild.rebuildBoardStatus(boardOf(root));
  for (const id of Object.values(IDS)) {
    const st = readJsonFile(statusFileOf(root, id));
    for (const key of ['id', 'type', 'title', 'status', 'parent', 'owner', 'createdAt', 'updatedAt', 'agentCompletedAt', 'lastReport', 'history']) {
      assert.ok(Object.prototype.hasOwnProperty.call(st, key), `${id} 状态文件缺字段 ${key}`);
    }
    assert.equal(st.id, id);
  }
  const items = core.listItems(boardOf(root));
  assert.equal(items.length, 4, 'atb list 数据源应能读到全部条目');
  assert.deepEqual(items.map((x) => x.id).sort(), [...Object.values(IDS)].sort());
});

t('R3 依据提交：done 项给命中提交 hash 与主题，submitted 项无提交痕迹', () => {
  const root = mkCloneProj();
  const r = rebuild.rebuildBoardStatus(boardOf(root));
  const lineOf = (id) => r.lines.find((l) => l.id === id);
  const a = lineOf(IDS.A);
  assert.ok(/^[0-9a-f]{40}$/.test(a.basis.hash), '依据提交 hash 应为完整 40 位');
  assert.equal(a.basis.subject, 'feat: 实现需求甲 REQ-20260918-101');
  const c = lineOf(IDS.C);
  assert.equal(c.basis.subject, 'fix: 修复缺陷', '正文含单号时依据为主题行');
  const b = lineOf(IDS.B);
  assert.equal(b.basis, null, '无提交项依据应为 null');
  // hash 对得上真实历史
  const hashes = String(git(root, ['log', '--format=%H']).stdout).trim().split('\n');
  assert.ok(hashes.includes(a.basis.hash), '依据 hash 应存在于 git 历史');
});

// ---------- R4 安全边界 ----------

t('R4 安全边界：runtime/status 已有非 rebuild 产生的条目状态时拒绝执行', () => {
  const root = mkTmp('atb-rebuild-live-');
  const board = path.join(root, 'agent-team-board');
  fs.mkdirSync(path.join(board, 'data', 'requirements'), { recursive: true });
  fs.mkdirSync(path.join(board, 'data', 'bugs'), { recursive: true });
  fs.mkdirSync(path.join(board, 'runtime', 'status'), { recursive: true });
  // 活看板：正常 createItem 产生的状态（history by 不是 rebuild 标记）
  core.createItem(board, { type: 'requirement', title: '活看板条目', by: 't' });
  const liveFile = path.join(board, 'runtime', 'status');
  const before = fs.readdirSync(liveFile).sort();
  assert.ok(before.length > 0, '前置：活看板已有状态文件');
  assert.throws(() => rebuild.rebuildBoardStatus(board), (e) => {
    assert.ok(/拒绝重建|已存在条目状态/.test(e.message), `报错应说明拒绝重建：${e.message}`);
    return true;
  });
  assert.deepEqual(fs.readdirSync(liveFile).sort(), before, '拒绝时不得改动既有状态文件');
});

// ---------- R5 幂等可重试 ----------

t('R5 幂等：重跑不追加 history、不翻转已判定状态；中断后重跑补齐剩余', () => {
  const root = mkCloneProj();
  const board = boardOf(root);
  rebuild.rebuildBoardStatus(board);

  // 历史新增含 B 单号的提交后重跑：B 保持 submitted（不翻转），全部沿用、history 不增长
  fs.writeFileSync(path.join(root, 'late-b.txt'), 'b\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'fix: 补交 REQ-20260918-102']);
  const r2 = rebuild.rebuildBoardStatus(board);
  assert.equal(r2.written, 0, '全量重跑不应重写任何条目');
  assert.equal(r2.kept, 4);
  const stB = readJsonFile(statusFileOf(root, IDS.B));
  assert.equal(stB.status, 'submitted', '已判定 submitted 不因新增提交翻转为 done');
  assert.equal(stB.history.length, 1, '重跑不得追加 history');

  // 模拟中断：删除部分状态文件后重跑可补齐，其余沿用
  fs.unlinkSync(statusFileOf(root, IDS.A));
  const r3 = rebuild.rebuildBoardStatus(board);
  assert.equal(r3.written, 1);
  assert.equal(r3.kept, 3);
  const stA = readJsonFile(statusFileOf(root, IDS.A));
  assert.equal(stA.status, 'done');
  assert.equal(stA.history.length, 1);
  const stB2 = readJsonFile(statusFileOf(root, IDS.B));
  assert.equal(stB2.status, 'submitted');
  assert.equal(stB2.history.length, 1, '沿用条目 history 不重复追加');
});

// ---------- R6 CLI ----------

t('R6 CLI：输出清单与汇总计数、usage 登记帮助文本、list/show 可读', () => {
  const root = mkCloneProj();
  const a = atb(['rebuild'], root);
  assert.equal(a.code, 0, `rebuild 应成功：${a.err}`);
  assert.match(a.out, /重建完成：共 4 个条目（done 2 · submitted 2）/);
  assert.match(a.out, new RegExp(`${IDS.A} → done（[0-9a-f]{10} feat: 实现需求甲 ${IDS.A}）`));
  assert.match(a.out, new RegExp(`${IDS.B} → submitted（无提交痕迹）`));
  assert.match(a.out, new RegExp(`${IDS.C} → done（[0-9a-f]{10} fix: 修复缺陷）`));
  assert.match(a.out, new RegExp(`${IDS.D} → submitted（无提交痕迹）`));

  const l = atb(['list', '--json'], root);
  assert.equal(l.code, 0, `list 应正常：${l.err}`);
  const listed = JSON.parse(l.out);
  assert.equal(listed.count, 4);
  const s = atb(['show', IDS.A], root);
  assert.equal(s.code, 0, `show 应正常：${s.err}`);
  assert.match(s.out, /状态：done/);

  // usage 帮助登记
  const h = atb([], root);
  assert.match(h.out, /atb rebuild/, 'atb usage 应登记 rebuild 命令');
  const hh = atb(['rebuild', '--help'], root);
  assert.match(hh.out, /用法：atb rebuild/);
});

// ---------- R7 只读保障 ----------

function dirHash(dir) {
  const h = crypto.createHash('sha1');
  const walk = (d) => {
    for (const name of fs.readdirSync(d).sort()) {
      const p = path.join(d, name);
      if (fs.statSync(p).isDirectory()) { walk(p); continue; }
      h.update(path.relative(dir, p));
      h.update(fs.readFileSync(p));
    }
  };
  walk(dir);
  return h.digest('hex');
}

t('R7 只读保障：不产生提交/分支变更，不改 data/ 文档与 runtime 其余文件', () => {
  const root = mkCloneProj();
  const board = boardOf(root);
  fs.mkdirSync(path.join(board, 'runtime'), { recursive: true });
  const cfgPath = path.join(board, 'runtime', 'config.json');
  const cfgBody = JSON.stringify({ version: 1, date: '20260918', counters: { requirement: 2, bug: 2 } }, null, 2) + '\n';
  fs.writeFileSync(cfgPath, cfgBody);
  const head = String(git(root, ['rev-parse', 'HEAD']).stdout).trim();
  const count = String(git(root, ['rev-list', '--count', 'HEAD']).stdout).trim();
  const branches = String(git(root, ['branch', '--list']).stdout);
  const dataBefore = dirHash(path.join(board, 'data'));

  rebuild.rebuildBoardStatus(board);

  assert.equal(String(git(root, ['rev-parse', 'HEAD']).stdout).trim(), head, '不得移动 HEAD');
  assert.equal(String(git(root, ['rev-list', '--count', 'HEAD']).stdout).trim(), count, '不得产生新提交');
  assert.equal(String(git(root, ['branch', '--list']).stdout), branches, '不得创建/切换分支');
  assert.equal(dirHash(path.join(board, 'data')), dataBefore, 'data/ 条目文档不得被改动');
  assert.equal(fs.readFileSync(cfgPath, 'utf8'), cfgBody, 'runtime/config.json 不得被损坏');
});

// ---------- R8 空看板 / 未初始化 ----------

t('R8 空看板与未初始化：无条目时如实提示；未初始化给与现有命令一致的报错', () => {
  const root = mkTmp('atb-rebuild-empty-');
  git(root, ['init', '-q', '-b', 'main']);
  const board = boardOf(root);
  fs.mkdirSync(path.join(board, 'data', 'requirements'), { recursive: true });
  fs.mkdirSync(path.join(board, 'data', 'bugs'), { recursive: true });
  const r = rebuild.rebuildBoardStatus(board);
  assert.equal(r.total, 0);
  const a = atb(['rebuild'], root);
  assert.equal(a.code, 0);
  assert.match(a.out, /无可重建内容/);

  const nowhere = mkTmp('atb-rebuild-nowhere-');
  const e = atb(['rebuild'], nowhere);
  assert.equal(e.code, 1, '未初始化应退出非零');
  assert.match(e.err, /未找到 agent-team-board/, '报错口径应与现有命令一致');
});

// ---------- R9 非 git 项目兜底 ----------

t('R9 非 git 项目：不崩溃，全部条目按无提交痕迹判 submitted', () => {
  const root = mkTmp('atb-rebuild-nogit-');
  const board = boardOf(root);
  const dir = path.join(board, 'data', 'requirements', 'REQ-20260918-301');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), '# REQ-20260918-301 无仓库条目\n');
  const r = rebuild.rebuildBoardStatus(board);
  assert.equal(r.isRepo, false);
  assert.equal(r.total, 1);
  assert.equal(r.submitted, 1);
  assert.equal(readJsonFile(statusFileOf(root, 'REQ-20260918-301')).status, 'submitted');
  const a = atb(['rebuild'], root);
  assert.equal(a.code, 0, `非 git 项目 rebuild 应成功：${a.err}`);
  assert.match(a.out, /不是 git 仓库/);
});

// ---------- 运行 ----------

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
  }
}
try {
  for (const root of tmpRoots) fs.rmSync(root, { recursive: true, force: true });
} catch {}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
