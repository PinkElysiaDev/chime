# koishi-plugin-chime

[![npm](https://img.shields.io/npm/v/koishi-plugin-chime?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-chime)

一个用于定时发送广播消息的 Koishi 插件。支持五位 cron 表达式定时、多 Bot 与多目标、模板变量、本地或远程资源、以及 anti-ban 发送延迟。

## 功能特性

- 使用五位 cron 表达式，不依赖 `koishi-plugin-cron`。
- 内置安全分段调度器，避免长周期任务触发 `setTimeout()` 溢出。
- 一条广播可以同时发送到多个 Bot、群聊或私聊目标。
- 消息模板支持变量、`<at>` 标签、图片和文件。

## 配置

| 字段 | 说明 |
| --- | --- |
| `cron` | 五位 cron 表达式：`分钟 小时 日期 月份 星期`，例如 `0 12 6 6 *`。 |
| `targets` | 广播发送目标表格。 |
| `template` | 消息模板。 |

`cronExpression` 和结构化 `schedule` 已不再支持。旧配置会被跳过，并输出迁移警告。

## Cron 元组示例

```yaml
broadcasts:
  - name: 年度提醒
    cron: '0 12 6 6 *'
    targets: []
    template: '大家好！现在是 {time}。'
```

- `0 12 6 6 *`：每年 6 月 6 日 12:00。
- `*/5 * * * *`：每 5 分钟。
- `0 9-18/2 * * 1-5`：工作日 9 到 18 点之间每 2 小时。

支持的字段语法：`*`、数字、逗号列表、范围和步长，例如 `*/5`、`1,15`、`1-5`、`1-10/2`。

日期和星期在两者都受限时使用常见 cron 的 OR 语义。星期支持 `0..7`，其中 `0` 和 `7` 都表示周日。

插件会在内部解析 cron，并使用分段定时器，因此长周期任务不会导致 Node.js `setTimeout()` 溢出。
