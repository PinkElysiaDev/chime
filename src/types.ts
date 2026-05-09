export interface AntiBanConfig {
  enabled: boolean
  baseDelaySeconds: number
  jitterPercent: number
}

export interface BroadcastTargetConfig {
  platform: string
  botId: string
  type: 'guild' | 'private'
  id: string
}

export interface BroadcastConfig {
  enabled: boolean
  name: string
  cronExpression: string
  targets: BroadcastTargetConfig[]
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
  target_id: string
  target_type: string
  group_id: string
  private_id: string
}
