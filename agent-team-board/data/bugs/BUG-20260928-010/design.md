# BUG-20260928-010 实施设计

## 引入来源（源单）

- REQ-20260913-001：已通过 atb show 核验存在；git log -S 定位构建 fmtTime 的引入提交为 4b7d8a2，直接截取 ISO 字符串，导致推送完成、版本更新和构建历史等时间均按 UTC 显示。
- 发布入口来源未定位：git log -S 只追溯到批量基线提交 6f2ead6，包含多个条目，无法可靠归因单一源单。

## 根因与方案

build.js 与 release.js 的 fmtTime 原实现只替换 T 并截取字符串，未转换时区。改为解析 Date 后通过本地 getFullYear/getMonth/getDate/getHours/getMinutes/getSeconds 展示，自动处理浏览器时区及夏令时。构建分钟精度与发布秒精度保持原样；构建发布结果的 fmtTimeLocal 复用同一入口。

审查 app、oncall、marketing、req-disc 已使用本地方法，新增跨时区回归覆盖这些入口。marketing 的 collectedAt 是日期输入而非时间戳，保留日期语义；序列化 toISOString 与 UTC 日期校验不属于界面时间展示，不改动。

开源选型：浏览器原生 Date 已完整提供时区转换能力，引入日期库的成本高于这项局部修复，不增加依赖。

## 实施与验证

先新增三时区六入口回归测试，上海用例复现 09:56 与预期 17:56 不符并跑红；修复后全部通过。覆盖正负偏移、跨年、冬夏令时、显式时区偏移及无效输入。所有已有文案不变，不新增翻译键；全量测试涵盖现有 i18n 与发布界面测试。
