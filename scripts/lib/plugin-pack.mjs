// REQ-20260916-007 插件打包（atb pack <outDir>）—— 分发产物口径（2026-09-17 人工确认）。
// 以插件根为源整仓拷贝（维持现有整仓分发口径），排除不进分发包的路径：
//   agent-team-board/（项目根看板数据：data 用户数据与 runtime 应用数据均不进包——
//     前者属使用方项目、后者不跨设备）、AGENTS.md（仅作仓库源码，对分发对象无意义）、
//     node_modules/（零运行时依赖，全为开发工具链）、electron/ 与 output/（桌面 App
//     构建链与产物，与插件分发属两条产品线）；另排除 .git/、dist/ 与日志文件。
// skills/ 完整随包分发（ZCode/Codex 双宿主各自按官方插件机制声明加载）。
// 产物自校验：遍历输出树断言不含被排除路径。

import fs from 'node:fs';
import path from 'node:path';
import { AtbError } from './core.mjs';

// 排除清单（相对插件根的第一段路径 / 文件名）
export const PACK_EXCLUDES = [
  'agent-team-board', // 项目根看板数据（data + runtime 均不进包）
  'AGENTS.md',        // 仅作仓库源码
  'node_modules',     // 开发工具链（零运行时依赖）
  'electron',         // 桌面 App 构建链
  'output',           // 桌面 App 产物
  'dist',             // 构建产物
  '.git',             // 版本库元数据
];

const EXCLUDE_SET = new Set(PACK_EXCLUDES);
const isExcludedAtRoot = (name) => EXCLUDE_SET.has(name);
// 任意层级排除：版本库元数据与日志（名字不会与源码目录冲突）
const isExcludedAnywhere = (name) => name === '.git' || name.endsWith('.log');

function copyTreeFiltered(from, to, excluded, atRoot = false) {
  fs.mkdirSync(to, { recursive: true });
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    // 命名排除仅作用于插件根第一段（skills/agent-team-board 等同名子目录不受影响）
    if ((atRoot && isExcludedAtRoot(ent.name)) || isExcludedAnywhere(ent.name)) {
      excluded.push(ent.name);
      continue;
    }
    const src = path.join(from, ent.name);
    const dst = path.join(to, ent.name);
    if (ent.isDirectory()) copyTreeFiltered(src, dst, excluded, false);
    else if (ent.isFile()) fs.copyFileSync(src, dst);
    // 符号链接等其他形态不进包（缓存安装形态由宿主自行建立）
  }
}

// 打包到 outDir（须不存在或为空目录，防止覆写已有产物）。返回统计与自校验结果。
export function packPlugin(pluginRoot, outDir) {
  const from = path.resolve(pluginRoot);
  const to = path.resolve(outDir);
  if (!fs.existsSync(from)) throw new AtbError(`插件根不存在：${from}`);
  if (fs.existsSync(to)) {
    const left = fs.readdirSync(to).filter((n) => n !== '.DS_Store');
    if (left.length) throw new AtbError(`输出目录非空（${left.slice(0, 3).join('、')}）：请指定空目录或先清理`);
  }
  // 输出目录不应位于插件根内部（排除目录之外的自嵌套）
  if (to === from || to.startsWith(from + path.sep)) {
    throw new AtbError('输出目录不能位于插件根内部');
  }
  const excluded = [];
  copyTreeFiltered(from, to, excluded, true);
  // 自校验：输出树中不含被排除路径；skills/ 完整在包
  const verify = verifyPack(to);
  if (!verify.ok) {
    throw new AtbError(`打包自校验失败：${verify.violations.slice(0, 5).join('、')}`);
  }
  return {
    outDir: to,
    files: verify.files,
    bytes: verify.bytes,
    excludedNames: [...new Set(excluded)],
    skillsComplete: fs.existsSync(path.join(to, 'skills', 'agent-team-board', 'SKILL.md')),
  };
}

export function verifyPack(dir) {
  const violations = [];
  let files = 0;
  let bytes = 0;
  const walk = (d, atRoot) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (ent.name === '.DS_Store') continue;
      if ((atRoot && isExcludedAtRoot(ent.name)) || isExcludedAnywhere(ent.name)) violations.push(ent.name);
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p, false);
      else if (ent.isFile()) { files++; bytes += fs.statSync(p).size; }
    }
  };
  walk(dir, true);
  return { ok: violations.length === 0, violations, files, bytes };
}
