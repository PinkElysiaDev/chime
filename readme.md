# koishi-plugin-chime

[![npm](https://img.shields.io/npm/v/koishi-plugin-chime?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-chime)

一个用于定时向指定群聊/频道发送广播消息的 Koishi 插件。

## 插件功能

- 按 Cron 表达式配置定时广播
- 每个广播独立指定 Bot（platform + botId）
- 支持多目标群聊/频道串行发送
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
| `platform` | Bot 平台名称，例如 `onebot` |
| `botId` | Bot 账号 ID |
| `destinations` | 发送目标群/频道 ID 列表 |
| `template` | 消息模板 |

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
| `{group_id}` | 当前发送目标群/频道 ID |

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

## License

MIT
