# BUG-20260928-013 发布流程删除官网 content/ 双语成对内容文件的强制检查

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-28T14:34:12.030Z
- 引入来源：REQ-20260916-004（构建发布官网目标适配 app-homepage-repo 新站点架构，引入「content/<产品id>/ 中英成对 md 双语材料」强制口径）

## 现象

对 agent-team-board 项目创建发布 v1.0.0 预检 / 执行时报错，发布被阻断：

> ✕ 发布失败：缺少：content/agent-team-board/changelog/v1.0.0.zh.md、content/agent-team-board/changelog/v1.0.0.en.md、content/agent-team-board/faq.zh.md、content/agent-team-board/faq.en.md、content/agent-team-board/support.zh.md、content/agent-team-board/support.en.md、content/agent-team-board/docs/ 的中英成对文档（如 docs/quick-start.zh.md 与 docs/quick-start.en.md）

即发布流程强制要求官网仓库 `content/<产品id>/` 目录下存在 changelog 版本文件、faq / support 中英文件与 docs 中英成对文档；本项目官网并未按该结构提供这些文件，发布无法通过。

## 复现步骤

1. 在 agent-team-board 项目（官网仓库已配置 homepageRepoRoot 与产品 id 映射）对已合并版本创建发布 v1.0.0。
2. 运行预检（或发布执行到对应阶段）。
3. 报「缺少：content/agent-team-board/changelog/…、faq…、support…、docs/ 的中英成对文档」，发布失败。

## 期望行为

- 删除对这类文件的检查：发布流程不再强制要求 `content/<产品id>/` 下的 `changelog/v<版本>.zh.md` / `.en.md`、`faq.zh.md` / `.en.md`、`support.zh.md` / `.en.md`、`docs/` 中英成对文档的存在。
- 这些文件不存在时预检与发布不再报错、不再阻断（缺失即跳过，不参与材料指纹收集）。
- 口径（按登记指示「删除这类文件的检查」）：**整段删除，不做缺失降级提示**——包括预检「双语材料」中的存在性检查、材料指纹对这些文件的收集，以及官网回验（site-verify）中对 changelog / docs 内容的内联检查；`src/data/apps.js` 产品注册检查保留。

## 验收标准

1. 官网仓库 `content/<产品id>/` 下无任何 changelog / faq / support / docs 文件时，发布预检「双语材料」检查通过（apps.js 注册检查仍生效）。
2. 发布执行 site-deploy / site-verify 阶段不再因上述文件缺失而失败；官网回验不再要求产物内联 `/content/<产品id>/changelog/…` 与 `docs/…` 内容路径。
3. 相关测试（含 build-publish 系列用例）按新口径更新并通过；`npm test` 全量通过。
