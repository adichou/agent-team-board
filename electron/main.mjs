#!/usr/bin/env node
// Status Board 桌面壳 —— Electron 主进程（REQ-20260905-001）。
// 启动时以 ELECTRON_RUN_AS_NODE 拉起 scripts/server.mjs 子进程，/api/health 就绪后加载看板页面；
// 关闭窗口回收子进程并退出。业务代码零改动，壳层不额外加 UI（交通灯由 hiddenInset 融入页面左上）。

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog } from 'electron';
import { ensureService, stopService } from './service.mjs';
import { TRAFFIC_LIGHT_INSET_CSS, TOPBAR_DRAG_REGION_CSS } from './shell-css.mjs';

const PORT = Number(process.env.ATB_PORT || 8888);
const APP_URL = `http://127.0.0.1:${PORT}`;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let svc = null;

async function start() {
  svc = await ensureService({
    port: PORT,
    serverPath: path.join(projectRoot, 'scripts', 'server.mjs'),
    projectRoot,
  });
  const win = new BrowserWindow({
    width: 1360,
    height: 850,
    titleBarStyle: 'hiddenInset',
    show: false,
  });
  win.once('ready-to-show', () => win.show());
  // hiddenInset 下每次页面加载完成后（含 Cmd-R 重载）注入两条壳层样式，仅本窗口生效：
  // 1) 交通灯让位 .topbar { padding-left: 78px !important }（BUG-20260905-003 / BUG-20260909-019）；
  // 2) 顶栏拖动区 -webkit-app-region: drag + 交互控件 no-drag 豁免（BUG-20260909-020：
  //    无拖动区则按住顶栏无法移动窗口）。让位声明带 !important 以稳定赢得层叠
  //    （BUG-20260909-019：同 specificity 下注入表不保证排在页面样式之后）。
  win.webContents.on('did-finish-load', () => {
    win.webContents.insertCSS(`${TRAFFIC_LIGHT_INSET_CSS}\n${TOPBAR_DRAG_REGION_CSS}`).catch((e) => {
      // 不再静默吞错：注入失败直接回退为遮挡 + 不可拖形态，须可见于终端日志以便排查
      console.error('[shell] 壳层样式（交通灯让位/顶栏拖动区）注入失败:', e?.message || e);
    });
  });
  await win.loadURL(APP_URL);
}

app.whenReady().then(start).catch((e) => {
  dialog.showErrorBox('Agent Team Board 无法启动', String(e?.message || e));
  app.quit();
});

// 退出协调（REQ-20260906-003）：壳拥有自建服务时，先让服务优雅关停
// （停止取单 → 取消受管执行 → 账本落盘）再退出；复用外部服务时不杀它。
let serviceStopping = false;
async function stopServiceAndQuit() {
  if (serviceStopping) return;
  serviceStopping = true;
  try {
    await stopService(svc);
  } finally {
    app.quit();
  }
}

app.on('window-all-closed', () => {
  stopServiceAndQuit();
});

// Cmd-Q 等退出路径的兜底：拦下首次退出请求，完成服务收尾后再真正退出
app.on('before-quit', (e) => {
  if (serviceStopping) return;
  e.preventDefault();
  stopServiceAndQuit();
});
