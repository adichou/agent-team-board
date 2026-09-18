# 测试报告 — REQ-20260903-003 一键派发升级：深链拉起 codex 新会话预填提示词；zcode 深链打开项目工作区（会话标题以单号关联）

- 时间：2026-09-03T04:12:32.330Z
- 执行者：atb-0903-f549
- 测试框架：node:assert（t() 风格静态契约 + 纯函数单测 + 临时端口集成）
- 覆盖率：92%

## 总结

新增 lib/dispatch.mjs 纯函数（shQuote 单引号转义、.command 生成、两条降级深链构造）+ 服务端 POST /api/dispatch/codex（CLI 探测→mkdtemp 生成 0o755 脚本→open 拉起；缺位返回 deeplink 降级信号；ATB_CODEX_CLI/ATB_OPEN_CMD 测试接缝）+ 前端 launchCodex/launchZcode（剪贴板常驻兜底→端点/深链，反馈「已拉起 Codex 会话 ✓」「已复制并打开 ZCode ✓」）。12 项自动化用例全绿（含 /bin/sh 回读注入探针、假 CLI+open 记录器集成），全量 15 个测试文件无回归，v1 提示词语义不变；7736 服务已重启加载新端点并实测非法单号 400。M1/M2 真实拉起待用户手工验收。另登记 BUG-20260903-004（claim 提示文案残留待对齐措辞）。

## 明细

### 自动化（2026-09-03，全部通过）

```
node scripts/tests/dispatch-launch.test.mjs   → 12/12 ✓
node scripts/tests/dispatch.test.mjs（v1 回归） →  4/4 ✓
全量 scripts/tests/*.test.mjs（15 个文件）     → 全部通过
```

- 注入安全：提示词/路径含引号、`$(...)`、反引号、分号时，经 `shQuote` 包裹后由真实 `/bin/sh` printf 回读与原文逐字一致（无执行痕迹）。
- 集成（临时端口 + `ATB_CODEX_CLI` 假 CLI + `ATB_OPEN_CMD` 记录器，不打扰 7736）：CLI 缺位 → `{ok:false,fallback:'deeplink'}`；成功 → 记录器收到 0o755 的 `.command`，内容含标签标题行与 `exec '<CLI>' -C '<项目根>' '<提示词>'`；非法单号 → 400 且无临时目录副作用。

### 真机核验（Agent 侧，2026-09-03）

- codex CLI 在位：`/Applications/ChatGPT.app/Contents/Resources/codex`（2.3GB Mach-O，2026-08-31）。
- 7736 服务已重启加载新端点（旧进程 08:41 早于改动 11:42）；实测 `POST /api/dispatch/codex` 非法单号返回 `400 {"error":"非法单号：../evil"}`，无副作用。
- 未替用户触发真实派发（会实际拉起 Terminal 并消耗一个 codex 会话），留 M1。

### 手工验收（M1/M2，待用户）

1. **M1 codex**：Status Board 打开任一 accepted 条目 → 点「派发给 codex」→ 预期新开 Terminal 标签、标题=单号，codex 在该项目根下自动开始执行提示词；按钮显示「已拉起 Codex 会话 ✓」。可将 ChatGPT.app 临时改名验证降级：按钮应回退深链（预填提示词）且剪贴板已有全文。
2. **M2 zcode**：点「派发给 zcode」→ 预期 ZCode 打开/聚焦当前看板项目工作区，剪贴板提示词首行为 `/dev <ID>`，按钮显示「已复制并打开 ZCode ✓」；新会话粘贴发送后自动标题含单号。
3. 结果请回填 test-cases.md 的 M1/M2 行。
