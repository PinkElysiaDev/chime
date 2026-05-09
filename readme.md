# koishi-plugin-chime

[![npm](https://img.shields.io/npm/v/koishi-plugin-chime?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-chime)

一个用于定时发送消息的 Koishi 插件，可对不同群聊配置不同广播定时策略，原生兼容 multi-bot-controller 插件。

## 插件功能

- 按 Cron 表达式配置定时广播
- 一条广播可以同时配置多个 Bot 发送范围
- 同时支持群聊发送和私聊发送
- 使用 table 配置广播发送范围：`platform` / `botId` / `type` / `id`
- 支持多目标串行发送
- 消息模板支持变量替换和 `<at>` 标签
- Anti-ban 机制：固定间隔 + 随机抖动，避免平台风控

## 依赖

- `koishi-plugin-cron`

## 配置说明

### 广播配置

每个广播项包含：

| 字段 | 说明 |
|------|------|
| `enabled` | 是否启用此广播 |
| `name` | 广播名称（用于日志标识） |
| `cronExpression` | Cron 表达式 |
| `targets` | 广播发送范围表格 |
| `template` | 消息模板 |

### 广播发送范围 targets

`targets` 是 table 型数组。每一行表示一个 Bot 向一个群聊或私聊目标发送消息。

| 字段 | 说明 |
|------|------|
| `platform` | Bot 平台名称，例如 `onebot` |
| `botId` | Bot 账号 ID |
| `type` | 发送目标类型：`guild` 群聊 / `private` 私聊 |
| `id` | 目标群聊 ID 或私聊用户 ID |

示例：

| platform | botId | type | id |
|----------|-------|------|----|
| onebot | 123456 | guild | 10001 |
| onebot | 123456 | private | 20001 |
| onebot | 654321 | guild | 10002 |

### Anti-Ban 配置

| 字段 | 说明 |
|------|------|
| `enabled` | 是否启用 anti-ban 延迟 |
| `baseDelaySeconds` | 多目标发送时的基础间隔秒数 |
| `jitterPercent` | 随机抖动百分比，例如 50 表示 ±50% |

## 模板变量

| 变量 | 说明 |
|------|------|
| `{time}` | 当前完整日期时间 |
| `{date}` | 当前日期 |
| `{bot_id}` | Bot 标识（platform:selfId） |
| `{bot_platform}` | Bot 平台名称 |
| `{bot_self_id}` | Bot 账号 ID |
| `{target_id}` | 当前发送目标 ID |
| `{target_type}` | 当前发送目标类型，值为 `guild` 或 `private` |
| `{group_id}` | 当前群聊目标 ID，仅群聊目标时有值；用于兼容旧模板 |
| `{private_id}` | 当前私聊目标 ID，仅私聊目标时有值 |

## 标签支持

```html
<at id="123456789"></at>
```

该标签会被转换为 Koishi 的 at 消息段，用于在广播消息中 @ 指定用户。

## Cron 表达式示例

| 表达式 | 说明 |
|--------|------|
| `30 7 * * *` | 每天 7:30 |
| `0 12 * * 1-5` | 工作日中午 12:00 |
| `0 9 1 * *` | 每月 1 日 9:00 |
| `*/30 * * * *` | 每 30 分钟 |
| `0 8,20 * * *` | 每天 8:00 和 20:00 |

## 私聊发送说明

私聊发送会根据当前适配器能力自动选择可用路径：

1. `sendPrivateMessage(userId, message)`
2. `createDirectChannel(userId)` 后使用 `sendMessage(channelId, message)`
3. `getDmChannel(userId)` 后使用 `sendMessage(channelId, message)`

如果当前适配器不支持私聊发送，插件会输出 warn 日志并继续处理其他目标。

## License

MIT
