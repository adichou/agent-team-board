// REQ-20260916-007 旧布局一键迁移（docs/agent-team-board/ → agent-team-board/{data,runtime}）。
// 入口：CLI `atb migrate` 与 Status Board 设置页（POST /api/migrate）。
// 口径（与仓库存量迁移一致）：
//   · 条目文档（requirements/bugs 下各条目的 markdown / attachments / licenses 等）
//     git mv（已跟踪，保留历史）或移动文件（未跟踪）→ data/；
//   · 条目 status.json → runtime/status/<ID>.json（被跟踪者先 git rm --cached，本地保留）；
//   · 其余全部目录/文件（.locks、dispatch、refine、commits、confirms、holds、oncall、
//     builds、releases、tasks、discussions、marketing、test-runs、test-audits、config.json、
//     模块 settings/policies/dispatches.json、README.md、板内 .gitignore 等）→ runtime/
//     （被跟踪者先 git rm -r --cached，本地保留）；
//   · skills 目标：docs/agent-team-board/batch-execution.md 由调用方决定（本仓迁移时迁
//     skills/agent-team-board/ 并重写；通用项目内该文件归 runtime 共享文档）。
// 约束：幂等可重试（已完成步骤天然 no-op）、失败如实报告不损坏数据、迁移前后条目清单
// （ID/状态/标题）一致、不自动 commit（变更留工作区，随收口提交）。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  AtbError,
  BOARD_REL_DIR,
  LEGACY_DATA_REL_DIR,
  ensureRuntimeIgnore,
} from './core.mjs';

const GIT_TIMEOUT_MS = 60_000;

function gitRaw(root, args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: GIT_TIMEOUT_MS });
}

function gitOk(root, args, label) {
  const r = gitRaw(root, args);
  if (r.status !== 0) {
    const detail = String(r.stderr || r.stdout || '').split('\n').filter(Boolean).slice(0, 3).join('；');
    throw new AtbError(`${label || `git ${args[0]}`}失败${detail ? `：${detail}` : ''}`.slice(0, 300));
  }
  return String(r.stdout || '');
}

const isGitRepo = (root) => {
  const r = gitRaw(root, ['rev-parse', '--is-inside-work-tree']);
  return r.status === 0 && String(r.stdout).trim() === 'true';
};

// 仓库内被 git 跟踪的路径集合（相对 root）
function trackedFiles(root) {
  const out = gitRaw(root, ['ls-files']);
  if (out.status !== 0) return new Set();
  return new Set(String(out.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean));
}

// 条目目录内的用户数据文件（迁移到 data/ 的部分）：status.json 除外全部保留
const isItemStatusFile = (name) => name === 'status.json';

// ---------- 探测（GET /api/layout/state 与迁移前置判断共用） ----------

export function layoutState(cwd) {
  let dir = path.resolve(cwd);
  for (;;) {
    const legacy = path.join(dir, LEGACY_DATA_REL_DIR);
    if (fs.existsSync(legacy)) {
      return { projectRoot: dir, legacy: true, modern: false, legacyDir: legacy };
    }
    const board = path.join(dir, BOARD_REL_DIR);
    if (fs.existsSync(path.join(board, 'data')) || fs.existsSync(path.join(board, 'runtime'))) {
      return { projectRoot: dir, legacy: false, modern: true, boardDir: board };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return { projectRoot: dir, legacy: false, modern: false };
    dir = parent;
  }
}

// ---------- 迁移 ----------

// 单个条目目录迁移：文档 → data 同构路径；status.json → runtime/status/<ID>.json。
// tracked 为仓库跟踪路径集合（无 git 时 null，全部按未跟踪处理）。
function migrateItemDir(root, itemAbs, dataTargetAbs, runtimeStatusDir, tracked, moved) {
  const id = path.basename(itemAbs);
  fs.mkdirSync(dataTargetAbs, { recursive: true });
  for (const name of fs.readdirSync(itemAbs).sort()) {
    const src = path.join(itemAbs, name);
    const rel = path.relative(root, src).split(path.sep).join('/');
    if (fs.statSync(src).isDirectory()) {
      // 嵌套 bugs 目录（data/requirements/<REQ>/bugs/<BUG>）递归按条目处理
      if (name === 'bugs') {
        for (const bugName of fs.readdirSync(src).sort()) {
          migrateItemDir(root, path.join(src, bugName), path.join(dataTargetAbs, 'bugs', bugName), runtimeStatusDir, tracked, moved);
        }
        continue;
      }
      // 其余子目录（attachments 等）：整目录搬移
      const dst = path.join(dataTargetAbs, name);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      movePath(root, src, dst, tracked ? tracked.has(rel) : false, moved);
      continue;
    }
    if (isItemStatusFile(name)) {
      const dst = path.join(runtimeStatusDir, `${id}.json`);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      movePath(root, src, dst, tracked ? tracked.has(rel) : false, moved, { untrack: true });
      continue;
    }
    const dst = path.join(dataTargetAbs, name);
    movePath(root, src, dst, tracked ? tracked.has(rel) : false, moved);
  }
}

// 路径搬移：已跟踪 → git mv（保留历史）；未跟踪 → 直接 rename。
// untrack（应用数据退出版本控制）：git rm --cached 后 rename（本地保留）。
function movePath(root, src, dst, isTracked, moved, { untrack = false } = {}) {
  if (!fs.existsSync(src)) return; // 已迁移过（幂等重入）
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (fs.existsSync(dst)) {
    throw new AtbError(`迁移目标已存在：${dst}（源 ${src}）；请人工核对后重试`);
  }
  const rel = path.relative(root, src).split(path.sep).join('/');
  if (untrack && isTracked) {
    gitOk(root, ['rm', '-q', '--cached', '--', rel], 'git rm --cached');
    fs.renameSync(src, dst);
    moved.untracked.push(rel);
    return;
  }
  if (isTracked) {
    gitOk(root, ['mv', '--', rel, path.relative(root, dst).split(path.sep).join('/')], 'git mv');
    moved.gitted.push(rel);
    return;
  }
  fs.renameSync(src, dst);
  moved.plain.push(rel);
}

function removeEmptyDirsUp(dir, stop) {
  let cur = path.resolve(dir);
  const top = path.resolve(stop);
  for (;;) {
    if (cur === top || cur === path.dirname(top)) return;
    try {
      if (fs.readdirSync(cur).length) return;
      fs.rmdirSync(cur);
    } catch {
      return;
    }
    cur = path.dirname(cur);
  }
}

// 递归清除 dir 下所有「只含空目录」的空目录树（迁移搬移后的残留壳），返回是否全空。
function pruneEmptyTree(dir) {
  let st;
  try { st = fs.statSync(dir); } catch { return true; }
  if (!st.isDirectory()) return false;
  let empty = true;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) {
      if (!pruneEmptyTree(p)) empty = false;
    } else {
      empty = false;
    }
  }
  if (empty) {
    try { fs.rmdirSync(dir); } catch { /* 并发写入兜底：保留待下次重试 */ }
  }
  return empty;
}

// 主入口：迁移旧布局项目。返回迁移统计；已是新布局 → changed=false。
export function migrateLayout(cwd, { skillsDir = null } = {}) {
  const st = layoutState(cwd);
  if (!st.legacy) {
    if (st.modern) {
      return { changed: false, reason: '已是新布局（agent-team-board/），无需迁移', projectRoot: st.projectRoot };
    }
    throw new AtbError('未找到旧布局数据（docs/agent-team-board）：请先在项目根执行 atb init');
  }
  const root = st.projectRoot;
  const legacyDir = st.legacyDir;
  // 插件源码仓库特例（2026-09-17 人工确认）：batch-execution.md 迁 skills/agent-team-board/
  // 并按用户数据整理（机制文档属用户数据）；其他项目该文件归 runtime 共享文档。
  // 自动探测：根下存在 skills/agent-team-board/SKILL.md（本产品仓库标记）。
  if (!skillsDir) {
    const own = path.join(root, 'skills', 'agent-team-board');
    if (fs.existsSync(path.join(own, 'SKILL.md'))) skillsDir = own;
  }
  const board = path.join(root, BOARD_REL_DIR);
  const dataDir = path.join(board, 'data');
  const runtimeDir = path.join(board, 'runtime');
  const hasGit = isGitRepo(root);
  const tracked = hasGit ? trackedFiles(root) : null;

  // 迁移前条目清单（核验基线）：旧布局残留 ∪ 已迁入 data 的条目（部分迁移后重入续迁）
  const before = itemInventory(legacyDir);
  const beforeMigrated = itemInventory(dataDir, path.join(runtimeDir, 'status'));
  for (const [id, rec] of beforeMigrated) if (!before.has(id)) before.set(id, rec);

  const moved = { gitted: [], plain: [], untracked: [] };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(runtimeDir, 'status'), { recursive: true });

  for (const name of fs.readdirSync(legacyDir).sort()) {
    const src = path.join(legacyDir, name);
    // 批量任务详解（2026-09-17 人工确认）：本仓库迁 skills/agent-team-board/ 并重写；
    // skillsDir 显式给出时按用户数据处理
    if (name === 'batch-execution.md' && skillsDir) {
      fs.mkdirSync(skillsDir, { recursive: true });
      movePath(root, src, path.join(skillsDir, name), tracked ? tracked.has(`docs/agent-team-board/${name}`) : false, moved);
      continue;
    }
    if (name === 'requirements' || name === 'bugs') {
      for (const itemName of fs.readdirSync(src).sort()) {
        const itemAbs = path.join(src, itemName);
        if (!fs.statSync(itemAbs).isDirectory()) { // 非条目杂项：归 runtime
          movePath(root, itemAbs, path.join(runtimeDir, name, itemName), tracked && tracked.has(`docs/agent-team-board/${name}/${itemName}`), moved, { untrack: true });
          continue;
        }
        migrateItemDir(root, itemAbs, path.join(dataDir, name, itemName), path.join(runtimeDir, 'status'), tracked, moved);
      }
      continue;
    }
    // 其余（应用数据）：整目录/文件 → runtime，被跟踪者退出版本控制（本地保留）
    const rel = `docs/agent-team-board/${name}`;
    movePath(root, src, path.join(runtimeDir, name), tracked ? tracked.has(rel) : false, moved, { untrack: true });
  }

  // 兜底：旧前缀下仍被跟踪的残留（如空目录占位）退出索引；随后递归清除空旧目录
  if (hasGit) {
    const still = [...trackedFiles(root)].filter((p) => p.startsWith(`${LEGACY_DATA_REL_DIR}/`));
    for (const p of still) {
      gitOk(root, ['rm', '-q', '--cached', '--ignore-unmatch', '--', p], 'git rm --cached 兜底');
      moved.untracked.push(p);
    }
  }
  pruneEmptyTree(legacyDir);
  if (fs.existsSync(legacyDir)) {
    removeEmptyDirsUp(legacyDir, root); // 旧目录仍有内容（不应发生）：仅清其上的空父链
  } else {
    removeEmptyDirsUp(path.dirname(legacyDir), root); // 旧目录已清空：连带清空的 docs/ 壳
  }
  ensureRuntimeIgnore(root);
  // runtime/README.md 缺失时由 initData 模板重建口径：留空（后续首次写账本前 core 不强制）
  fs.mkdirSync(path.join(runtimeDir, 'status'), { recursive: true });

  // 迁移后核验：条目清单（ID/状态/标题）一致
  const after = itemInventory(dataDir, path.join(runtimeDir, 'status'));
  const beforeKeys = [...before.keys()].sort();
  const afterKeys = [...after.keys()].sort();
  if (JSON.stringify(beforeKeys) !== JSON.stringify(afterKeys)) {
    throw new AtbError(`迁移核验失败：条目清单不一致（前 ${beforeKeys.length} 后 ${afterKeys.length}）；数据已保留，请人工核对后重试`);
  }
  for (const [id, rec] of before) {
    const a = after.get(id);
    if (!a || a.status !== rec.status || a.title !== rec.title) {
      throw new AtbError(`迁移核验失败：${id} 状态/标题不一致（前 ${rec.status}/${rec.title} 后 ${a ? `${a.status}/${a.title}` : '缺失'}）`);
    }
  }

  return {
    changed: true,
    projectRoot: root,
    dataDir,
    runtimeDir,
    moved: { gitMv: moved.gitted.length, plain: moved.plain.length, untracked: moved.untracked.length },
    items: afterKeys.length,
  };
}

// 条目清单：旧布局（status.json 在条目目录）与新布局（runtime/status/<ID>.json）双形态
function itemInventory(itemsRootDir, statusDir = null) {
  const map = new Map();
  const readJsonSafe = (f) => {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
  };
  const collect = (dir, statusOf) => {
    for (const type of ['requirements', 'bugs']) {
      const tdir = path.join(dir, type);
      if (!fs.existsSync(tdir)) continue;
      for (const name of fs.readdirSync(tdir).sort()) {
        const itemDir = path.join(tdir, name);
        if (!fs.statSync(itemDir).isDirectory()) continue;
        const st = statusOf(itemDir, name);
        if (st) map.set(name, { status: st.status, title: st.title });
        const nested = path.join(itemDir, 'bugs');
        if (fs.existsSync(nested)) {
          for (const bname of fs.readdirSync(nested).sort()) {
            const st2 = statusOf(path.join(nested, bname), bname);
            if (st2) map.set(bname, { status: st2.status, title: st2.title });
          }
        }
      }
    }
  };
  if (statusDir) {
    collect(itemsRootDir, (itemDir, name) => readJsonSafe(path.join(statusDir, `${name}.json`)));
  } else {
    collect(itemsRootDir, (itemDir) => readJsonSafe(path.join(itemDir, 'status.json')));
  }
  return map;
}
