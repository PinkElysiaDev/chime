import { Bot, Context } from 'koishi'
import { Config, name } from './config'
import type {
  BroadcastConfig,
  BroadcastTargetConfig,
  Config as ChimeConfig,
  TemplateContext,
} from './types'
import { renderTemplate } from './template'
import { PreparedBroadcastTarget, sendToTargets } from './sender'

export { Config, name } from './config'
export * from './types'

export const usage = `
## 插件功能说明

定时发送广播消息，支持一条广播同时启用多个 Bot，支持群聊与私聊目标，支持变量模板、本地或远程资源，以及 anti-ban 发送延迟。

## 定时规则

本插件使用五位 cron 表达式：分钟 小时 日期 月份 星期。

示例：

- 0 12 6 6 *：每年 6 月 6 日 12:00。
- */5 * * * *：每 5 分钟。
- 0 9-18/2 * * 1-5：工作日 9 到 18 点之间每 2 小时。

## 模板变量

- {time}：当前时间，仅包含小时和分钟。
- {date}：当前日期。
- {target_id}：当前发送目标 ID。
- {target_name}：当前发送目标名称。
- {imageURL="..."}：插入图片，支持本地路径、file URL、http(s) URL。
- {fileURL="..."}：插入文件，支持本地路径、file URL、http(s) URL。

## 0.1.5 版本更新说明
- 采用内置 cron 解析以避免官方插件的 bug 。
`

interface RegisteredTask {
  dispose: () => void
}

interface ScheduledTask {
  dispose: () => void
  nextRunAt: Date
}

const MAX_SAFE_DELAY_MS = 24 * 60 * 60 * 1000
const MIN_INTERVAL_SECONDS = 60
const registeredTasks = new Map<string, RegisteredTask>()
const runningTasks = new Set<string>()
const lastTriggerTimes = new Map<string, number>()

export function apply(ctx: Context, config: ChimeConfig) {
  const logger = ctx.logger(name)

  const debugLog = (...args: unknown[]) => {
    if (config.debug) {
      logger.debug(args.join(' '))
    }
  }

  const verboseLog = (...args: unknown[]) => {
    if (config.verboseLogging) {
      logger.info(args.join(' '))
    }
  }

  const enabledBroadcasts = config.broadcasts.filter((broadcast) => broadcast.enabled)

  logger.info(
    `plugin loaded, ${enabledBroadcasts.length}/${config.broadcasts.length} broadcasts enabled`,
  )

  for (const [broadcastIndex, broadcast] of enabledBroadcasts.entries()) {
    const broadcastName = broadcast.name || '(unnamed)'

    if (!broadcast.cron) {
      const legacyCron = (broadcast as { cronExpression?: unknown }).cronExpression
      const legacySchedule = (broadcast as { schedule?: unknown }).schedule
      const legacyTupleCron = Array.isArray((broadcast as { cron?: unknown }).cron)
      if (legacyTupleCron) {
        logger.warn(`[${broadcastName}] skipped, cron 已从五元组改为字符串，请改为类似 0 12 6 6 * 的五位 cron 表达式`)
      } else if (typeof legacyCron === 'string' && legacyCron.trim()) {
        logger.warn(
          `[${broadcastName}] skipped, cronExpression 已不再支持，请迁移到字符串 cron 表达式，cronExpression=${legacyCron}`,
        )
      } else if (legacySchedule) {
        logger.warn(`[${broadcastName}] skipped, schedule 已不再支持，请迁移到字符串 cron 表达式`)
      } else {
        logger.warn(`[${broadcastName}] skipped, cron 表达式缺失`)
      }
      continue
    }

    const taskId = createTaskId(broadcast, broadcastIndex)

    if (!broadcast.targets.length) {
      logger.warn(`[${broadcastName}] skipped, no targets configured`)
      continue
    }

    if (!broadcast.template.trim()) {
      logger.warn(`[${broadcastName}] skipped, template is empty`)
      continue
    }

    try {
      const previousTask = registeredTasks.get(taskId)
      if (previousTask) {
        logger.warn(
          `[register] task=${taskId}, duplicate taskId detected, disposing previous scheduled task`,
        )
        previousTask.dispose()
      }

      const scheduledTask = scheduleBroadcast(config, broadcast, taskId)
      if (!scheduledTask) continue

      registeredTasks.set(taskId, { dispose: scheduledTask.dispose })
      ctx.on('dispose', () => {
        if (registeredTasks.get(taskId)?.dispose === scheduledTask.dispose) {
          registeredTasks.delete(taskId)
        }
        lastTriggerTimes.delete(taskId)
        scheduledTask.dispose()
      })

      verboseLog(
        `[register] task=${taskId}, broadcast=${broadcastName}, cron=${formatCronExpression(broadcast.cron)}, nextRunAt=${formatDateTime(scheduledTask.nextRunAt)}, targets=${broadcast.targets.length}`,
      )
      debugLog(`[register] task=${taskId}, broadcast=${broadcastName} registered successfully`)
    } catch (error) {
      logger.warn(
        `[register] task=${taskId}, failed to register broadcast=${broadcastName}: ${formatError(error)}`,
      )
    }
  }

  function scheduleBroadcast(
    config: ChimeConfig,
    broadcast: BroadcastConfig,
    taskId: string,
  ): ScheduledTask | undefined {
    const broadcastName = broadcast.name || '(unnamed)'
    let disposed = false
    let disposeTimer: (() => void) | undefined

    const scheduleNext = (initial = false): Date | undefined => {
      if (disposed || !broadcast.cron) return

      const nextRunAt = getNextCronRunAt(broadcast.cron, new Date())
      if (!nextRunAt) {
        logger.warn(
          `[schedule] task=${taskId}, broadcast=${broadcastName}, no valid future run found for cron=${formatCronExpression(broadcast.cron)}`,
        )
        return
      }

      disposeTimer = scheduleAt(nextRunAt, async () => {
        try {
          await executeBroadcast(config, broadcast, taskId)
        } catch (error) {
          logger.warn(
            `[trigger] task=${taskId}, broadcast=${broadcastName}, failed: ${formatError(error)}`,
          )
        } finally {
          if (!disposed) {
            scheduleNext()
          }
        }
      })

      if (!initial) {
        verboseLog(
          `[schedule] task=${taskId}, broadcast=${broadcastName}, nextRunAt=${formatDateTime(nextRunAt)}`,
        )
      }

      return nextRunAt
    }

    const nextRunAt = scheduleNext(true)
    if (!nextRunAt) return

    return {
      nextRunAt,
      dispose: () => {
        disposed = true
        disposeTimer?.()
      },
    }
  }

  async function executeBroadcast(
    config: ChimeConfig,
    broadcast: BroadcastConfig,
    taskId: string,
  ) {
    const broadcastName = broadcast.name || '(unnamed)'
    const preparedTargets: PreparedBroadcastTarget[] = []
    const now = new Date()

    if (runningTasks.has(taskId)) {
      logger.warn(
        `[trigger] task=${taskId}, broadcast=${broadcastName}, skipped because previous run is still active`,
      )
      return
    }

    const minTriggerIntervalSeconds = Math.max(
      0,
      config.safety?.minTriggerIntervalSeconds ?? MIN_INTERVAL_SECONDS,
    )
    const nowMs = Date.now()

    if (minTriggerIntervalSeconds > 0) {
      const lastTriggerAt = lastTriggerTimes.get(taskId)
      const minIntervalMs = minTriggerIntervalSeconds * 1000

      if (lastTriggerAt !== undefined && nowMs - lastTriggerAt < minIntervalMs) {
        const remainingSeconds = Math.ceil((minIntervalMs - (nowMs - lastTriggerAt)) / 1000)
        logger.warn(
          `[trigger] task=${taskId}, broadcast=${broadcastName}, skipped because global min trigger interval is active, remaining=${remainingSeconds}s, minInterval=${minTriggerIntervalSeconds}s`,
        )
        return
      }

      lastTriggerTimes.set(taskId, nowMs)
    }

    runningTasks.add(taskId)

    try {
      verboseLog(
        `[trigger] task=${taskId}, broadcast=${broadcastName}, preparing ${broadcast.targets.length} targets`,
      )

      for (const target of broadcast.targets) {
        const botKey = `${target.platform}:${target.botId}`

        if (!target.id.trim()) {
          logger.warn(
            `[trigger] task=${taskId}, broadcast=${broadcastName}, skipped empty target id, bot=${botKey}, type=${target.type}`,
          )
          continue
        }

        verboseLog(
          `[trigger] task=${taskId}, broadcast=${broadcastName}, looking for bot=${botKey}, type=${target.type}, id=${target.id}`,
        )

        const bot = ctx.bots[botKey]

        if (!bot) {
          logger.warn(
            `[trigger] task=${taskId}, broadcast=${broadcastName}, bot ${botKey} not found or offline`,
          )
          continue
        }

        const templateContext = await buildTemplateContext(bot, now, target)
        const message = await renderTemplate(broadcast.template, templateContext, {
          allowLocalResources: config.resource.allowLocalResources,
          logger,
        })

        verboseLog(
          `[template] task=${taskId}, broadcast=${broadcastName}, bot=${botKey}, type=${target.type}, id=${target.id}, rendered segments=${message.length}`,
        )

        preparedTargets.push({
          bot,
          target,
          message,
        })
      }

      if (!preparedTargets.length) {
        logger.warn(`[trigger] task=${taskId}, broadcast=${broadcastName}, no valid targets to send`)
        return
      }

      await sendToTargets(preparedTargets, {
        antiBan: config.antiBan,
        logger,
        debug: config.debug,
        verboseLogging: config.verboseLogging,
        broadcastName,
        taskId,
      })

      debugLog(`[done] task=${taskId}, broadcast=${broadcastName} completed`)
    } finally {
      runningTasks.delete(taskId)
    }
  }
}

function scheduleAt(targetTime: Date, callback: () => Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const tick = () => {
    if (disposed) return

    const remainingMs = targetTime.getTime() - Date.now()
    if (remainingMs <= 0) {
      void callback()
      return
    }

    timer = setTimeout(tick, Math.min(remainingMs, MAX_SAFE_DELAY_MS))
  }

  tick()

  return () => {
    disposed = true
    if (timer) clearTimeout(timer)
  }
}

interface ParsedCronField {
  values: number[]
  wildcard: boolean
}

interface ParsedCron {
  minute: ParsedCronField
  hour: ParsedCronField
  dayOfMonth: ParsedCronField
  month: ParsedCronField
  dayOfWeek: ParsedCronField
}

function getNextCronRunAt(cron: string, now: Date) {
  const parsed = parseCronExpression(cron)
  const start = new Date(now.getTime() + 60 * 1000)
  start.setSeconds(0, 0)

  const deadline = new Date(now)
  deadline.setFullYear(deadline.getFullYear() + 8)
  deadline.setSeconds(59, 999)

  for (const candidate = start; candidate <= deadline; candidate.setMinutes(candidate.getMinutes() + 1)) {
    if (matchesCron(candidate, parsed)) return new Date(candidate)
  }
}

function parseCronExpression(expression: string): ParsedCron {
  const fields = expression.trim().split(/\s+/).filter(Boolean)
  if (fields.length !== 5) {
    throw new Error(`cron 表达式必须是 5 位：分钟 小时 日期 月份 星期，当前为 ${fields.length} 位`)
  }

  return {
    minute: parseCronField(fields[0], 0, 59),
    hour: parseCronField(fields[1], 0, 23),
    dayOfMonth: parseCronField(fields[2], 1, 31),
    month: parseCronField(fields[3], 1, 12),
    dayOfWeek: parseCronField(fields[4], 0, 7, (value) => value === 7 ? 0 : value),
  }
}

function parseCronField(
  source: string,
  min: number,
  max: number,
  normalize: (value: number) => number = (value) => value,
): ParsedCronField {
  const field = String(source).trim()
  if (!field) throw new Error('cron field cannot be empty')

  const values = new Set<number>()
  const parts = field.split(',')
  for (const part of parts) {
    addCronPartValues(part.trim(), min, max, normalize, values)
  }

  if (!values.size) throw new Error(`cron field has no values: ${source}`)
  return {
    values: [...values].sort((left, right) => left - right),
    wildcard: field === '*',
  }
}

function addCronPartValues(
  part: string,
  min: number,
  max: number,
  normalize: (value: number) => number,
  values: Set<number>,
) {
  const match = /^(\*|\d+|\d+-\d+)(?:\/(\d+))?$/.exec(part)
  if (!match) throw new Error(`unsupported cron field syntax: ${part}`)

  const step = match[2] ? Number(match[2]) : 1
  if (!Number.isInteger(step) || step <= 0) throw new Error(`invalid cron step: ${part}`)

  const base = match[1]
  let start: number
  let end: number

  if (base === '*') {
    start = min
    end = max
  } else if (base.includes('-')) {
    const [rangeStart, rangeEnd] = base.split('-').map(Number)
    assertCronValue(rangeStart, min, max, part)
    assertCronValue(rangeEnd, min, max, part)
    if (rangeStart > rangeEnd) throw new Error(`invalid cron range: ${part}`)
    start = rangeStart
    end = rangeEnd
  } else {
    start = Number(base)
    assertCronValue(start, min, max, part)
    end = start
  }

  for (let value = start; value <= end; value += step) {
    values.add(normalize(value))
  }
}

function assertCronValue(value: number, min: number, max: number, source: string) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`cron value out of range: ${source}`)
  }
}

function matchesCron(date: Date, cron: ParsedCron) {
  if (!cron.minute.values.includes(date.getMinutes())) return false
  if (!cron.hour.values.includes(date.getHours())) return false
  if (!cron.month.values.includes(date.getMonth() + 1)) return false

  const dayOfMonthMatches = cron.dayOfMonth.values.includes(date.getDate())
  const dayOfWeekMatches = cron.dayOfWeek.values.includes(date.getDay())

  if (cron.dayOfMonth.wildcard && cron.dayOfWeek.wildcard) return true
  if (cron.dayOfMonth.wildcard) return dayOfWeekMatches
  if (cron.dayOfWeek.wildcard) return dayOfMonthMatches
  return dayOfMonthMatches || dayOfWeekMatches
}

function createTaskId(broadcast: BroadcastConfig, index: number) {
  const broadcastName = sanitizeTaskPart(broadcast.name || 'unnamed')
  const scheduleSlug = sanitizeTaskPart(formatCronExpression(broadcast.cron))
  const targetsHash = hashTargets(broadcast.targets)

  return `${name}:${broadcastName}#${index}:${scheduleSlug}:t${targetsHash}`
}

function sanitizeTaskPart(value: string) {
  return value
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[,:#]/g, '-') || 'unnamed'
}

function formatCronExpression(cron?: string) {
  return cron?.trim().replace(/\s+/g, '_') || 'missing-cron'
}


function formatDateTime(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function hashTargets(targets: BroadcastTargetConfig[]) {
  const source = targets
    .map((target) => `${target.platform}:${target.botId}:${target.type}:${target.id}`)
    .join('|')
  let hash = 0x811c9dc5

  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return (hash >>> 0).toString(36).slice(0, 6).padStart(6, '0')
}

async function buildTemplateContext(
  bot: Bot,
  now: Date,
  target: BroadcastTargetConfig,
): Promise<TemplateContext> {
  return {
    time: now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
    date: now.toLocaleDateString(),
    target_id: target.id,
    target_name: await getTargetName(bot, target),
  }
}

async function getTargetName(bot: Bot, target: BroadcastTargetConfig) {
  if (target.type === 'guild') {
    try {
      return (await bot.getGuild(target.id))?.name || target.id
    } catch {
      return target.id
    }
  }

  const anyBot = bot as any

  if (typeof anyBot.getUser === 'function') {
    try {
      const user = await anyBot.getUser(target.id)
      return user?.nick || user?.name || user?.username || target.id
    } catch {
      return target.id
    }
  }

  return target.id
}

