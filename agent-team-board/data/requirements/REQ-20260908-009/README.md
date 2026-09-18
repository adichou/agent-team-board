# REQ-20260908-009 去掉 bug 单的归属需求选项，默认都是独立 Bug，然后需要在 Bug 单的设计说明书中明确表明引入问题的源单是什么

- 状态：in-progress
- 创建：2026-09-08T02:12:10.851Z

## 描述

现状：创建 Bug 时可以选择「归属需求」（CLI `atb new bug --req <REQ-ID>`、Status Board 新建表单的归属下拉、`POST /api/new` 的 `parent` 字段），Bug 会落到 `requirements/<REQ-ID>/bugs/` 子目录；归属判断不清时先建独立、再用 `atb move` 挪动。

问题：目录归属把「关联」固化在物理结构上，与「引入来源」的归因要求（REQ-20260830-004：修复阶段必须归因到源单）脱节——单看目录无法知道 Bug 是哪个需求引入的，整理归属还要挪目录。

目标：

1. **去掉创建 Bug 的归属需求选项**：`atb new bug` 不再接受 `--req/--parent`（传了报错并指引）；Status Board 新建表单去掉「归属需求（可选）」下拉；`POST /api/new` 对 bug 传 `parent` 返回 400。新建 Bug 一律是独立 Bug（顶层 `bugs/` 目录，`status.parent === null`）。
2. **Bug 设计说明书标明源单**：创建 Bug 时除 README 外同时生成 `design.md`（设计说明书），内含「引入来源（源单）」节：登记时可填 `未定位（排查过程：…）` 或暂空待排查，修复阶段必须归因（REQ-/BUG- 编号需经 `atb list` 核验，禁止编造）。
3. 存量归属 Bug 的读取（`resolveItemDir` 扫描 `requirements/*/bugs/`）与 `atb move` 整理能力保留，兼容既有数据；`atb new bug` 用法说明、SKILL 文档同步更新。

## 验收标准

- [ ] `atb new bug "标题" --req <REQ-ID>` 报错退出，提示 Bug 一律独立、源单写 design.md；`atb new bug "标题"` 正常创建。
- [ ] `core.createItem` 对 bug 传 `parent` 抛 AtbError；新建 Bug `status.parent === null`、目录在顶层 `bugs/`。
- [ ] 新建 Bug 生成 README.md 与 design.md；README 不再有「归属需求」行；design.md 含「引入来源」节与三选一填写指引（REQ-/BUG- 编号 / 未定位（排查过程：…）/ 登记时暂空）。
- [ ] `POST /api/new` type=bug 带 `parent` 返回 400 错误提示；Web 新建表单不再出现归属下拉、不提交 parent 字段。
- [ ] 存量归属 Bug（目录在 `requirements/*/bugs/`）仍可被 list/show/resolveItemDir 读取；`atb move <BUG-ID> --req|--standalone` 行为不变。
- [ ] CLI 帮助（USAGE）与 SKILL.md 中 `new bug` 用法描述同步去掉 `--req`，改述为「一律独立 Bug，引入来源写 design.md」。
- [ ] 新增测试覆盖上述行为，既有测试全量通过（构造存量归属 Bug 的用例改走 `moveBug`）。
