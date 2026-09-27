# 测试用例 — REQ-20260927-001 只需需求或 bug 创建时同步提交到 git。

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 分层（对齐 REQ-20260923-004）：L1 git-flow 收口内核（真实 git 临时仓库）→
> L2 三通道集成（CLI / 服务端 / 批量登记）→ L3 rebuild 与收口幂等交互 → L4 静态接线契约。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| C1 | git 仓库创建需求：产生一条 `doc: 创建条目 <ID>` 提交，仅含条目目录路径（README/design/test-cases），过 validateCommitSubject，工作区不残留，不切分支不配远端 | P0 | ✓ |
| C2 | Bug 条目同口径（data/bugs/<ID>） | P0 | ✓ |
| C3 | 不卷入无关改动：预置其他条目脏改动 + 板外脏文件/未跟踪文件，创建提交仅含新条目目录，预置差异原样保留 | P0 | ✓ |
| C4 | 创建带附件：attachments/ 一并入库 | P1 | ✓ |
| C5 | 非 git 仓库：skipped 注明原因，创建不抛错 | P0 | ✓ |
| C6 | 条目目录在仓库外：skipped；目录不存在（回滚残留）：skipped 不空提交 | P1 | ✓ |
| C7 | 提交失败（index.lock）：failed 带人工补提交指引；解锁后重试 committed | P0 | ✓ |
| C8 | data/ 被 .gitignore：无差异 → skipped 不产生空提交 | P1 | ✓ |
| C9 | CLI `atb new`：回显 `↳ 已同步提交 <hash7>：doc: 创建条目 <ID>`，git log 含单号 | P0 | ✓ |
| C10 | CLI `atb new --accept`（创建并接受）同样触发同步提交 | P0 | ✓ |
| C11 | 服务端 POST /api/new：201 响应带 gitCommit（committed + 短号），git log 含单号 | P0 | ✓ |
| C12 | 批量登记 oncall.createItems：逐条结果带 gitCommit，提交内容含 README 补写来源行 | P0 | ✓ |
| C13 | 「创建并接受」accept 环节失败回滚：不留条目目录、不产生创建提交；对已消失目录调用内核 skipped | P1 | ✓ |
| C14 | rebuild：仅创建留痕提交 → submitted 不误判 done（note 注明留痕）；留痕 + 开发提交 → done 且依据为开发提交 | P0 | ✓ |
| C15 | 收口幂等交互：历史已含创建提交时，autoCommitForRun 仍按差集归因提交 doc/业务组（不跳过）；无改动时幂等跳过口径不变 | P0 | ✓ |
| C16 | 静态接线契约：atb new / server /api/new / oncall.createItems / marketing.linkActivityReq 四处均在 createItem 后调用 commitItemCreation；gitFlow 导出新函数与 isItemTraceCommitSubject | P1 | ✓ |

> 落地：scripts/tests/req-20260927-001.test.mjs（16 用例，先红后绿）；营销通道经 C16 静态契约覆盖接线。
