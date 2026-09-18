# BUG-20260918-001 serve 轮询实时 git 扫描持 index.lock，与终端 git 写操作互相锁冲突

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-18T00:29:00.159Z

## 现象

## 现象

Status Board 页面开着（前端 2 秒轮询）时，用户终端执行 git add/commit 报 fatal: Unable to create .git/index.lock: File exists。2026-09-18 REQ-20260916-007 挂起确认补交（1763 个待入库路径）时连续四次撞锁。

## 根因（已实测定位）

前端 2 秒轮询 /api/confirms → listConfirms() → viewRecord()（confirm-store.mjs:723 scopeOfRec）→ confirmScopeForRun() → workingTreeSnapshot()（git status/diff 全量扫描工作区）。git status 默认做「机会性刷新 index stat 缓存」的可选写，须先创建 index.lock；工作区变更越多持锁窗口越长（1763 路径时达数百毫秒），与终端 git add 的持锁窗口重叠即冲突。

佐证：busy-loop 抓捕器在锁出现瞬间抓到持锁 git 子进程的父进程为 node scripts/server.mjs（pid 92965，2026-09-18 08:03，2-3 秒周期）；停止两个 serve 实例后锁彻底消失。注意：实测仓库级 git config core.optionalLocks=false 后轮询空闲期锁消失，但脚本运行期间仍出现锁冲突——链路中可能还有不受该配置约束的持锁 git 调用，修复时需定位完整清单。

## 修复方向

轮询链路（listConfirms / confirmDetail 及其他跑 git 的轮询接口）的 git 调用统一加 --no-optional-locks（gitRaw/spawn 统一注入或逐命令）；可叠加扫描结果 TTL 缓存（数秒）降低全量扫描频率。

## 验收标准

1. Status Board 页面开着时，终端并行执行 git add/commit 不再出现 index.lock: File exists；
2. 挂起确认面板的实时计数（本单可归属/归属待确认）行为不变；
3. 测试覆盖：模拟轮询与 git 写操作并发场景。

## 复现步骤

1.

## 期望行为
