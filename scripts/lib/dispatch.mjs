// 一键派发构造纯函数（server 与单测共用，无副作用）。
// REQ-20260906-019：codex 一键派发改走批量开发方案（调度器后台 codex exec），
// 旧 .command + open 拉终端与 codex:// 深链降级链路移除；本文件仅保留 zcode 深链与单号校验。
// REQ-20260910-002：任务模块「提示词」页签补两端工作区入口——新增 codex 深链构造与深链宿主探测。

import fs from 'node:fs';

// 单号形态：REQ-/BUG-YYYYMMDD-NNN（一键派发端点参数校验白名单）
export const ITEM_ID_RE = /^(?:REQ|BUG)-\d{8}-\d{3}$/;

// zcode 深链：官方 workspace/open 路由（Finder「在 ZCode 中打开」同款），无会话创建/命名参数
export function buildZcodeWorkspaceUrl(root) {
  return `zcode://workspace/open?path=${encodeURIComponent(root)}`;
}

// codex 深链（REQ-20260910-002 design D1）：ChatGPT.app 无纯 workspace/open 路由（实机核查全部
// host 路由），threads/new?path= 是唯一能把工作区路径带入的已验证通道——打开/聚焦 Codex 并把
// 新会话输入框定位到该项目根；不传 prompt（不注入/不发送任何文本，用户手动粘贴）
export function buildCodexWorkspaceUrl(root) {
  return `codex://threads/new?path=${encodeURIComponent(root)}`;
}

// 深链宿主 app 存在性探测（design D2）：zcode:// 与 codex:// 的宿主均为 macOS 桌面 app。
// 仅存在性检查（只读）；探测不到 ≠ 深链必然失败（app 可能在非默认路径），调用方据此
// 「禁用 + 说明」如实反馈，而非拦截。exists/platform 可注入便于单测。
export function detectWorkspaceApps({ exists = (p) => fs.existsSync(p), platform = process.platform } = {}) {
  if (platform !== 'darwin') return { zcode: false, codex: false };
  return {
    zcode: exists('/Applications/ZCode.app'),
    codex: exists('/Applications/ChatGPT.app'),
  };
}
