import { parseExpression } from 'cron-parser'
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

## 0.1.6 版本更新说明
- 优化对 cron 的调用方式以避免 bug 。
`

interface RegisteredTask {
  dispose: () => void
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

  function scheduleBroadcast(config: ChimeConfig, broadcast: BroadcastConfig, taskId: string) {
    const broadcastName = broadcast.name || '(unnamed)'

    return createSafeCronTask(broadcast.cron!, async () => {
      try {
        await executeBroadcast(config, broadcast, taskId)
      } catch (error) {
        logger.warn(
          `[trigger] task=${taskId}, broadcast=${broadcastName}, failed: ${formatError(error)}`,
        )
      }
    }, {
      label: `task=${taskId}, broadcast=${broadcastName}`,
      cronLabel: formatCronExpression(broadcast.cron),
      warn: (message) => logger.warn(`[schedule] ${message}`),
      info: (nextRunAt) => verboseLog(
        `[schedule] task=${taskId}, broadcast=${broadcastName}, nextRunAt=${formatDateTime(nextRunAt)}`,
      ),
    })
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

function createSafeCronTask(
  cron: string,
  onTrigger: () => Promise<void>,
  hooks: {
    label: string
    cronLabel: string
    warn: (message: string) => void
    info?: (nextRunAt: Date) => void
  },
) {
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const scheduleNext = (initial = false): Date | undefined => {
    if (disposed) return

    let nextRunAt: Date | undefined
    try {
      nextRunAt = getNextCronRunAt(cron)
    } catch (error) {
      hooks.warn(`${hooks.label}, invalid cron=${hooks.cronLabel}: ${formatError(error)}`)
      return
    }

    if (!nextRunAt) {
      hooks.warn(`${hooks.label}, no valid future run found for cron=${hooks.cronLabel}`)
      return
    }

    if (!initial) hooks.info?.(nextRunAt)
    waitUntil(nextRunAt)
    return nextRunAt
  }

  const waitUntil = (targetTime: Date) => {
    if (disposed) return

    const remainingMs = targetTime.getTime() - Date.now()
    if (remainingMs <= 0) {
      void onTrigger().finally(() => scheduleNext())
      return
    }

    timer = setTimeout(() => waitUntil(targetTime), Math.min(remainingMs, MAX_SAFE_DELAY_MS))
  }

  const nextRunAt = scheduleNext(true)
  if (!nextRunAt) return

  return {
    nextRunAt,
    dispose: () => {
      disposed = true
      if (timer) clearTimeout(timer)
    },
  }
}

function getNextCronRunAt(cron: string) {
  return parseExpression(normalizeCronExpression(cron)).next().toDate()
}

function normalizeCronExpression(expression: string) {
  const fields = expression.trim().split(/\s+/).filter(Boolean)
  if (fields.length === 5) return `0 ${fields.join(' ')}`
  if (fields.length === 6) return fields.join(' ')
  throw new Error(`cron 表达式必须是 5 位或 6 位，当前为 ${fields.length} 位`)
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
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
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
