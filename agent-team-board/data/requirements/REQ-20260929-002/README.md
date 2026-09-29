# REQ-20260929-002 发布模块删除 Web App 构建目标，不再校验任何构建目标

- 状态：submitted（待人工接受）
- 创建：2026-09-29T02:16:25.972Z

## 描述

cili_search（Chrome 扩展，master 主干）发布 1.0.0 在 webapp-build 阶段失败：冻结源码无 package.json / 根 index.html，Web App 构建识别必然失败。人工定夺：发布模块删除 Web App 构建目标（webapp-build / webapp-verify 阶段与 webapp 目标卡），发布流程不再校验、不执行任何产品源码构建；保留源码原子推送与官网构建部署回验。范围：构建发布（BPUB，build-publish 模块与发布页签 UI）；产品发布（PREL）页签不在本单范围。

## 验收标准

- [ ] （待补充）
