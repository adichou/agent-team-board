# 修复设计

## 引入来源

- REQ-20260914-001：挂起确认侧栏首次打开时，先调用 confirmPanelMsg，再加载详情并渲染消息节点。已用 atb show 核验源单存在。

## 根因与方案

初始 HTML 的 confirmForm 为空，confirmPanelMsg 节点只在 renderConfirmForm 中生成。首次打开清空消息时访问 null.textContent，导致 loadConfirmDetail 未执行，界面保留初始加载文字。

在 confirmPanelMsg 中增加节点不存在时的提前返回，保留节点存在时的文字与错误样式更新。无需引入库，原生 DOM 判空的实现与维护成本更低。

## 实施边界

用户已明确授权本次无认领锁例外：仅修复面板并补回归测试。BUG-020 的项目挂起阻止 claim；随后用户明确要求提交 Git 并推进待测试；通过 atb status in-progress 与 atb report 完成状态上报。不解除 BUG-020 挂起，不执行其确认提交。

## 验证设计

执行真实 openConfirmPanel/loadConfirmDetail 函数，模拟初始 HTML 中存在的节点，缺失节点返回 null。仅替换 API 与表单渲染边界，验证请求、加载/错误/表单状态切换及迟到响应丢弃。
