import { Schema } from 'koishi'
import type { AntiBanConfig, BroadcastConfig, Config as ChimeConfig } from './types'

const DEFAULT_TEMPLATE = `大家好！现在是 {time}，这是一条定时广播消息。`

const antiBanSchema: Schema<AntiBanConfig> = Schema.object({
  enabled: Schema.boolean()
    .default(true)
    .description('启用 anti-ban 延迟'),
  baseDelaySeconds: Schema.number()
    .min(0)
    .max(300)
    .step(0.1)
    .default(4)
    .description('多目标发送时的基础间隔秒数，0 表示不额外延迟'),
  jitterPercent: Schema.number()
    .min(0)
    .max(100)
    .step(1)
    .default(50)
    .description('发送间隔随机抖动百分比，例如 50 表示 ±50%'),
})

const broadcastSchema: Schema<BroadcastConfig> = Schema.object({
  enabled: Schema.boolean()
    .default(true)
    .description('是否启用此广播'),
  name: Schema.string()
    .default('')
    .description('广播名称（用于日志标识）'),
  cronExpression: Schema.string()
    .required()
    .description('Cron 表达式，例如 "30 7 * * *" 表示每天 7:30'),
  platform: Schema.string()
    .required()
    .description('Bot 平台名称，例如 onebot'),
  botId: Schema.string()
    .required()
    .description('Bot 账号 ID'),
  destinations: Schema.array(Schema.string())
    .role('table')
    .default([])
    .description('发送目标群/频道 ID 列表'),
  template: Schema.string()
    .role('textarea')
    .default(DEFAULT_TEMPLATE)
    .description('消息模板，支持变量：{time} {date} {bot_id} {bot_platform} {bot_self_id} {group_id}，支持 <at id="..."></at> 标签'),
})

export const ConfigSchema: Schema<ChimeConfig> = Schema.intersect([
  Schema.object({
    antiBan: antiBanSchema,
    debug: Schema.boolean()
      .default(false)
      .description('启用调试日志'),
    verboseLogging: Schema.boolean()
      .default(false)
      .description('启用详细日志'),
  }).description('发送与日志设置'),
  Schema.object({
    broadcasts: Schema.array(broadcastSchema)
      .role('list')
      .default([])
      .description('广播任务列表'),
  }).description('广播配置'),
])

export const name = 'chime'
export const Config = ConfigSchema
