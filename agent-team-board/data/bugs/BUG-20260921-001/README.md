# BUG-20260921-001 req-20260920-003.test.mjs L4 夹具硬编码当日条目编号，跨日运行必失败

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-20T16:20:21.095Z

## 现象

scripts/tests/req-20260920-003.test.mjs L4 服务接口用例在临时看板 core.createItem 后按硬编码编号 REQ-20260920-001 / REQ-20260920-002 推状态（约 390-393 行），而编号由 nextId 按本地日期生成（core.mjs localDateStamp）；本地日期越过 2026-09-20 后（如 2026-09-21 00:00 起）创建的实际编号为 REQ-YYYYMMDD-001，setStatus 报『找不到 REQ-20260920-001』，整文件 L4 用例必失败。与 BUG-20260920-005 改动无关（失败点在夹具阶段，先于任何被改代码路径；用独立临时目录复现：core.initData + createItem 返回 REQ-20260921-001）。修复方向：改为捕获 createItem 返回的真实 id（同 build-serve.test.mjs 的 reqA/reqB 口径）或以固定日期注入 localDateStamp。发现于 BUG-20260920-005 批量实施收口跑全量时。

## 复现步骤

1.

## 期望行为
