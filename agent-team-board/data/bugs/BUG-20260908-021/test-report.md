# 测试报告 — BUG-20260908-021 需求详情中的交互 Demo 相对链接打开后返回 404

- 时间：2026-09-08T17:24:44.769Z
- 执行者：zcode-batch-018-1
- 测试框架：node:assert/strict + 真实 HTTP 集成 + vm 沙箱（scripts/tests/item-demo-link.test.mjs）
- 覆盖率：91%

## 总结

看板侧修复：新增只读端点 GET /api/item/:id/demo/:name（?project= 绑定多项目；名称白名单+realpath 防穿越+2MB 上限；nosniff+CSP default-src none 仅放行内联脚本/样式与 data: 资源，fetch/XHR 禁→演示页无法触达管理 API），前端 loadDoc 后经 linkupDocDemo 把条目文档内单文件名 .html/.htm 相对链接改写至该端点并 noopener 新标签打开；条目/文件缺失 404、非法路径 400 均返回人读 HTML 提示页；README 源 ./ui-demo.html 写法不变，REQ-20260907-004 同形态链接自动覆盖。引入来源归因 REQ-20260908-021（已核验）。新增测试 11 用例全绿；全套件 99 文件 915 用例 0 失败。注意：运行中的看板服务需 atb serve 重启后新端点生效

## 明细

（可粘贴命令输出、失败用例说明等）
