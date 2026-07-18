# CodeM 领域词汇

本文件记录 CodeM 中容易混淆的核心业务术语，供产品、设计和实现统一使用。

## 普通聊天 AI 配置

**厂商**：
提供 AI 模型服务的品牌主体。同一厂商在常用厂商列表中只出现一次。
_避免：供应商配置、渠道_

**渠道**：
厂商提供的一组独立产品、计费或地区入口，例如标准 API、Coding Plan、Token Plan、国内区或国际区。
_避免：厂商、接口类型_

**接口类型**：
渠道实际支持的请求协议族，例如 OpenAI Chat、OpenAI Responses、Anthropic 或 Gemini。
_避免：模型、渠道_

**接口配置**：
一个渠道与一个接口类型对应的连接信息，包括 API 地址、密钥入口和接口文档。
_避免：厂商、供应商实例_

**供应商实例**：
用户保存的一份可独立启用、持有密钥并管理模型的普通聊天连接配置。同一厂商可以保存多个供应商实例。
_避免：厂商模板、Agent Provider_

## Agent 配置

**Agent Provider**：
负责执行编码任务的原生 Agent 运行器，例如 Claude Code、Codex、Grok Build 或 OpenCode。
_避免：厂商、普通聊天供应商、Agent 渠道_

**Agent 渠道**：
供某个 Agent Provider 调用模型服务的一份连接配置，包括接口地址、凭据、协议和模型目录。
_避免：Agent Provider、普通聊天供应商实例_

**系统当前配置**：
Agent Provider 在 CodeM 之外启动时实际采用的配置，是 CodeM 默认跟随但不主动接管的配置来源。
_避免：CodeM 默认渠道、CC Switch 渠道_

**CodeM 渠道**：
由 CodeM 保存并在应用内共享的 Agent 渠道，只在用户选用时影响 CodeM 发起的 Agent 任务。
_避免：系统当前配置、普通聊天供应商实例_
