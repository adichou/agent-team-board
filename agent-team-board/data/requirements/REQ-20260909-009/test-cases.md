# 测试用例 — REQ-20260909-009 新建条目的描述支持截图

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

自动化覆盖：`scripts/tests/item-attachment-store.test.mjs`（S1–S7，数据层）、
`scripts/tests/item-attachment-serve.test.mjs`（V1–V4，服务接口）、
`scripts/tests/item-shot-ui.test.mjs`（U1–U6，前端静态契约 + vm 行为）。
浏览器人工验收：粘贴 ⌘V 实际剪贴板交互、点击放大视觉、深浅色与窄屏（M1–M3）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| S1 | 创建需求 / Bug 带 attachments：文件落盘条目目录 attachments/ 子目录，README 描述（需求）/ 现象（Bug）节末尾按添加顺序追加 `![截图](attachments/…)` 引用行 | 高 | 通过 |
| S2 | 同名附件自动加序号不覆盖（shot.png / shot-2.png），README 引用落盘后的最终文件名 | 高 | 通过 |
| S3 | 服务端二次校验：非白名单后缀 / 超 8MB / 防穿越文件名 / 缺数据 → 抛错整单拒绝，不留半写入条目目录（不创建目录、不占号） | 高 | 通过 |
| S4 | 张数上限 9：超过上限整单拒绝并给出明确错误 | 高 | 通过 |
| S5 | 无附件创建口径不变：README 无引用行、无 attachments/ 目录 | 高 | 通过 |
| S6 | 「✎ 修改」兼容（REQ-20260908-011）：编辑框载入描述节原文（含图片行）；仅改标题保存不动描述节图片行；改描述整体替换保留提交文本中的图片行 | 高 | 通过 |
| S7 | 附件读取：白名单图片后缀、文件名防穿越、超 8MB 不在线展示 | 高 | 通过 |
| V1 | POST /api/new 带附件 → 201，文件落盘 + README 引用；GET /api/item/:id/attachment/:name 返回原字节，响应头 image MIME + nosniff + 收敛 CSP + no-store | 高 | 通过 |
| V2 | POST /api/new 非法附件（非图片后缀 / 穿越文件名 / 超 8MB / 超张数）→ 400 且条目未创建（不产生重复条目） | 高 | 通过 |
| V3 | 附件读取端点防穿越与非白名单：`../status.json` 与 `.sh` 均 400 | 高 | 通过 |
| V4 | 兼容：不带 attachments 的旧调用仍 201 创建成功 | 高 | 通过 |
| U1 | 静态契约：新建弹窗描述下方存在截图区块（fShotRow / fShotPick / fShotFile / fShotList / 计数 / 空态 / 错误行），文件选择 accept 限定图片且多选 | 高 | 通过 |
| U2 | 类型切换：讨论隐藏截图区块，需求 / Bug 显示 | 高 | 通过 |
| U3 | 提交：需求 / Bug 请求体携带 attachments[{name,dataBase64}]（按添加顺序）；讨论请求不携带 | 高 | 通过 |
| U4 | 本地即时校验：非图片 / 超 8MB / 达 9 张上限被拒并就地提示，不进入缩略图列表；移除后计数回落可再添加 | 高 | 通过 |
| U5 | 重新打开弹窗清空上次截图（对齐 openModal 重置口径） | 高 | 通过 |
| U6 | 抽屉 README 图片接管：相对 attachments/ 引用改写为 /api/item/:id/attachment/:name（含 project 参数）；http(s)/data: 等绝对地址不接管；点击放大接线 #oncallLightbox；加载失败替换为占位提示 | 高 | 通过 |
| M1 | 浏览器人工：⌘V / Ctrl+V 粘贴剪贴板截图自动命名（paste-<时间戳>.<后缀>）进入缩略图；点击放大、点击任意处 / Esc 关闭 | 中 | 人工验收 |
| M2 | 浏览器人工：深浅色外观正常、窄屏（≤736px）缩略图可换行、上传 / 移除按钮可键盘聚焦操作 | 中 | 人工验收 |
| M3 | 浏览器人工：创建失败（如服务停止）时标题 / 描述 / 已附截图全部保留，可重试 | 中 | 人工验收 |
