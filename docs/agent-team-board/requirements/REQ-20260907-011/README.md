# REQ-20260907-011 待接受需求和 Bug 可以由用户自行更改标题。已接受的需求可以驳回变为待接受

- 状态：in-progress（已认领实施）
- 创建：2026-09-07T15:26:19.641Z

## 描述

看板条目在「待接受（submitted）」阶段常因登记时表述仓促而需要修正标题；而误接受的需求 /
Bug 目前只能停留在已接受列，缺少退回待接受的入口。本需求补齐这两个人工操作：

1. **改标题**：待接受（submitted）的需求和 Bug，用户可以自行更改标题。标题同时是
   status.json 的 `title` 字段与条目文档（README / design / test-cases）首行的一部分，
   两处必须同步更新，避免看板与文档不一致。
2. **驳回接受**：已接受（accepted）的需求可以驳回，状态退回待接受（submitted）。
   与「驳回完成（done → in-progress）」同属人工回退操作。

操作入口与现有人工操作一致：Status Board 网页（主入口）与终端 CLI（`atb` 命令）。

## 验收标准

- [ ] submitted 状态的需求 / Bug（独立与归属）可通过网页与 CLI 更改标题；
      `status.json.title` 与条目目录下各 markdown 文档首行标题同步为新标题，history 留痕。
- [ ] 非 submitted 状态（accepted / in-progress / done）不允许改标题，明确报错。
- [ ] 新标题校验与创建时一致：非空、不超过 120 字；与原标题相同视为无意义操作，明确报错。
- [ ] accepted → submitted 驳回可用（网页与 CLI），history 留痕；语义为人工回退，与
      done → in-progress 同级。
- [ ] in-progress / done 不能直接驳回回 submitted（状态机保持既有单向主干，仅新增
      accepted → submitted 一条人工回退边）。
- [ ] 网页：待接受卡片与详情页提供「改标题」入口；已接受详情页提供「驳回接受」按钮，
      且接受操作新增撤销（撤销接受 = 驳回回待接受）。
- [ ] 「修改（提示词）」「需求完善」等既有入口不受影响；全部既有测试保持通过。
