# 测试报告 — BUG-20260915-011 需求模块的当前选择条目和右侧的条目没有同步，请修复

- 时间：2026-09-15T08:12:16.871Z
- 执行者：zcode-batch-001
- 测试框架：node:assert/strict + vm 桩 DOM（run-all.mjs 聚合）
- 覆盖率：6%

## 总结

openDrawer 对齐 closeDrawer：重置 listSig 后、await refreshDrawer 前同步调用 renderBoard（带 initialized 守卫），一切打开/切换详情入口（点行/抽屉导航/键盘/跨模块跳转）左侧行 picked 高亮即时跟随，不再依赖轮询与数据变化；签名剪枝与关闭清除不回退。归因引入来源 REQ-20260907-004（atb list 核验）。新增 bug-drawer-picked-sync-20260915-011.test.mjs 6 用例（先红后绿），全量 248 测试文件 0 失败。

## 明细

（可粘贴命令输出、失败用例说明等）
