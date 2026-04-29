# CodeM Agent Guide

本仓库当前使用轻量 `.trellis` 结构管理开发规范。

## 阅读顺序

开始较大改动前，建议按下面顺序建立上下文：

1. `README.md`
2. `.trellis/workflow.md`
3. `.trellis/spec/frontend/index.md`
4. `.trellis/spec/backend/index.md`
5. `.trellis/spec/guides/index.md`

## 当前约定

- frontend 代码范围：`src/**`
- backend 代码范围：`server/**`
- 类型与常量优先集中到 `src/types.ts`、`src/constants.ts`
- 纯 helper 优先放 `src/lib/**`
- 共享行为优先放 `src/hooks/**`
- 页面结构块优先放 `src/components/**`
- 修改前端或后端代码后，如果判断当前运行中的开发服务需要刷新生效，应主动重启项目服务，并在回复里说明已重启。
- 仅修改 Web 版相关代码时，不要顺手构建或重启桌面版；仅在修改桌面壳、Tauri 配置、窗口材质、桌面专属样式或用户明确要求查看桌面版时，才主动构建并重启桌面版。
- 需要推送代码时，默认推送到 Gitee 远端 `gitee` 的 `main` 分支；除非用户明确要求，否则不要只推送到 GitHub。
- 修复问题时优先定位并修正真实数据来源或真实流程，尽可能不要用兜底逻辑掩盖问题；只有在必须兼容旧数据、外部异常或不可控输入时才加兜底，并说明原因。

## 任务与提案

- 开发任务沉淀目录：`.trellis/tasks/`
- 行为提案与变更说明目录：`openspec/`

## 当前阶段说明

仓库目前只启用了轻量规范骨架：

- 有规范文档
- 有任务目录
- 没有自动化脚本体系
- 没有 developer workspace / session record 流程

如果后续团队协作规模扩大，可以在当前骨架上继续补全。
