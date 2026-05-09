export interface AntiBanConfig {
  enabled: boolean
  baseDelaySeconds: number
  jitterPercent: number
}

export interface BroadcastConfig {
  enabled: boolean
  name: string
  cronExpression: string
  platform: string
  botId: string
  destinations: string[]
  template: string
}

export interface Config {
  antiBan: AntiBanConfig
  debug: boolean
  verboseLogging: boolean
  broadcasts: BroadcastConfig[]
}

export interface TemplateContext {
  time: string
  date: string
  bot_id: string
  bot_platform: string
  bot_self_id: string
  group_id: string
}
