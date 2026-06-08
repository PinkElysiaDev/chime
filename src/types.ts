export interface AntiBanConfig {
  enabled: boolean
  baseDelaySeconds: number
  jitterPercent: number
}

export interface ResourceConfig {
  allowLocalResources: boolean
}

export interface SafetyConfig {
  minTriggerIntervalSeconds: number
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
  cron?: string
  targets: BroadcastTargetConfig[]
  template: string
}

export interface Config {
  antiBan: AntiBanConfig
  resource: ResourceConfig
  safety: SafetyConfig
  debug: boolean
  verboseLogging: boolean
  broadcasts: BroadcastConfig[]
}

export interface TemplateContext {
  time: string
  date: string
  target_id: string
  target_name: string
}
