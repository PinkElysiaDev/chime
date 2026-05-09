import { Schema } from 'koishi'
import type {
  AntiBanConfig,
  BroadcastConfig,
  BroadcastTargetConfig,
  Config as ChimeConfig,
} from './types'

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

const broadcastTargetSchema: Schema<BroadcastTargetConfig> = Schema.object({
  platform: Schema.string()
    .required()
    .description('平台名称'),
  botId: Schema.string()
    .required()
    .description('Bot ID'),
  type: Schema.union([
    Schema.const('guild' as const).description('群聊'),
    Schema.const('private' as const).description('私聊'),
  ])
    .default('guild')
    .description('发送目标类型'),
  id: Schema.string()
    .required()
    .description('目标群聊/私聊 ID'),
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
  targets: Schema.array(broadcastTargetSchema)
    .role('table')
    .default([])
    .description(
      '广播发送范围。每一行表示一个 Bot 向一个群聊或私聊目标发送消息。',
    ),
  template: Schema.string()
    .role('textarea')
    .default(DEFAULT_TEMPLATE)
    .description(
      '消息模板，支持变量：{time} {date} {target_id} {target_name}，支持 <at id="..."></at> 标签',
    ),
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
