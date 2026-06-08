import { Schema } from 'koishi'
import type {
  AntiBanConfig,
  BroadcastConfig,
  BroadcastTargetConfig,
  Config as ChimeConfig,
  ResourceConfig,
  SafetyConfig,
} from './types'

const DEFAULT_TEMPLATE = `大家好！现在是 {time}，这是一条定时广播消息。`

const resourceSchema: Schema<ResourceConfig> = Schema.object({
  allowLocalResources: Schema.boolean()
    .default(true)
    .description('启用后可在模板中通过 {imageURL="..."} / {fileURL="..."} 发送本地或远程资源。'),
})

const antiBanSchema: Schema<AntiBanConfig> = Schema.object({
  enabled: Schema.boolean()
    .default(true)
    .description('启用 anti-ban 发送延迟。'),
  baseDelaySeconds: Schema.number()
    .min(0)
    .max(300)
    .step(0.1)
    .default(4)
    .description('多目标发送时的基础间隔秒数，0 表示不额外延迟。'),
  jitterPercent: Schema.number()
    .min(0)
    .max(100)
    .step(1)
    .default(50)
    .description('发送间隔随机抖动百分比，例如 50 表示 ±50%。'),
})

const safetySchema: Schema<SafetyConfig> = Schema.object({
  minTriggerIntervalSeconds: Schema.number()
    .min(0)
    .max(86400)
    .step(1)
    .default(60)
    .description('同一个任务两次实际触发之间的最小间隔秒数，0 表示关闭。'),
})

const broadcastTargetSchema: Schema<BroadcastTargetConfig> = Schema.object({
  platform: Schema.string()
    .required()
    .description('平台名称，例如 onebot。'),
  botId: Schema.string()
    .required()
    .description('Bot ID。'),
  type: Schema.union([
    Schema.const('guild' as const).description('群聊'),
    Schema.const('private' as const).description('私聊'),
  ])
    .default('guild')
    .description('发送目标类型。'),
  id: Schema.string()
    .required()
    .description('目标群聊或用户 ID。'),
})

const cronSchema = Schema.string()
  .description('五位或六位 cron 表达式。五位格式：分钟 小时 日期 月份 星期，例如 0 12 6 6 *；六位格式：秒 分钟 小时 日期 月份 星期，例如 30 0 12 6 6 *。')


const broadcastSchema: Schema<BroadcastConfig> = Schema.object({
  enabled: Schema.boolean()
    .default(true)
    .description('是否启用此广播。'),
  name: Schema.string()
    .default('')
    .description('广播名称，用于日志标识。'),
  cron: cronSchema,
  targets: Schema.array(broadcastTargetSchema)
    .role('table')
    .default([])
    .description('广播发送目标。每一行表示一个 Bot 向一个群聊或私聊目标发送消息。'),
  template: Schema.string()
    .role('textarea')
    .default(DEFAULT_TEMPLATE)
    .description('消息模板，支持变量：{time} {date} {target_id} {target_name} {imageURL="..."} {fileURL="..."}。'),
})

export const ConfigSchema: Schema<ChimeConfig> = Schema.intersect([
  Schema.object({
    antiBan: antiBanSchema,
    resource: resourceSchema,
    safety: safetySchema,
    debug: Schema.boolean()
      .default(false)
      .description('启用调试日志。'),
    verboseLogging: Schema.boolean()
      .default(false)
      .description('启用详细日志。'),
  }).description('发送与日志设置'),
  Schema.object({
    broadcasts: Schema.array(broadcastSchema)
      .role('list')
      .default([])
      .description('广播任务列表。'),
  }).description('广播配置'),
])

export const name = 'chime'
export const Config = ConfigSchema
