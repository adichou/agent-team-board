# 测试用例 — REQ-20260910-015 创建需求或 bug，支持创建并接受

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

测试文件：`scripts/tests/create-accept-20260910-015.test.mjs`（C/L/S/G 组，core + CLI + 服务 + 守卫）、
`scripts/tests/create-accept-ui-20260910-015.test.mjs`（U 组，前端 vm + 模拟 DOM）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| C1 | core：`createItem(accept:true)` 直接产出 accepted——status/history 两条（null→submitted「创建」、submitted→accepted「创建并接受」）/ 文档模板齐全（需求 README+design+test-cases，Bug README+design）/ refine 索引 unrefined 且无 reaccepted 标记 | P0 | ✅ |
| C2 | core：与分步等价——`createItem(accept)` 与 `createItem`+`setStatus accepted` 的 status/history 形态/refine 索引逐项一致；缺省（无 accept）仍 submitted、无 refine 记录、history 仅一条 | P0 | ✅ |
| C3 | core：原子性——接受环节写状态失败（mock writeStatus 抛错）时回滚删除条目目录并抛错，不留半成品 | P1 | ✅ |
| L1 | CLI：`atb new req <标题> --accept` 成功，输出含「已接受」，status.json 为 accepted 且 refine 索引 unrefined；`atb new bug <标题> --accept` 同口径 | P0 | ✅ |
| L2 | CLI：不带 `--accept` 输出与现状一致（「状态 submitted」+ 等待人工接受提示）；USAGE 帮助含 `[--accept]` | P0 | ✅ |
| S1 | server：`POST /api/new {accept:true}` → 201 返回 status accepted，条目目录文档/refine 索引齐备；带附件时附件照常落盘且 README 有引用行 | P0 | ✅ |
| S2 | server：缺省与非法值兼容——不带 `accept`、`accept:false`、`accept:"true"`（非严格布尔）均落 submitted（旧客户端零影响）；非法附件 + `accept:true` 整单 400 且不留条目目录 | P0 | ✅ |
| G1 | 守卫：`atb new req t --accept`、`node …/atb.mjs new bug t --accept`、`--ac""cept` 拆词、`--accept=true` 均 exit 2 且含人工专属指引；`atb new req t`（无开关）放行 | P0 | ✅ |
| G2 | 守卫：curl 调 `/api/new` 带 `"accept":true`（含 `"accept": true` 空白变体）与 `accept=true` 表单形态均 exit 2；不带标记的普通创建放行；`accept":false` 放行 | P0 | ✅ |
| U1 | UI 静态契约：底栏存在 `#fSubmitAccept`「创建并接受」（取消与创建之间）、`.btn.accent` 样式存在；`syncNewFormFields` 在 ask 隐藏、req/bug 显示 | P0 | ✅ |
| U2 | UI 提交：`accept` 路径请求体携带 `accept:true`、成功 toast「（已接受）」；普通创建不带 `accept` 字段、toast「（待接受）」；讨论不出现接受入口 | P0 | ✅ |
| U3 | UI 防重复与复位：在途时「创建」「创建并接受」均禁用且文案「创建中…」，收尾各自复位；失败保留表单/附件并 toast 报错（共享 catch/finally）；openModal 重置两按钮 | P1 | ✅ |
