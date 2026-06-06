import { Bot, Context } from 'koishi'
import {} from 'koishi-plugin-cron'
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

export const inject = {
  required: ['cron'],
}

export const usage = `
## 插件功能说明

定时发送广播消息，支持一条广播同时启用多个 Bot，支持群聊与私聊目标，支持变量模板和 anti-ban 延迟。

## 变量与标签说明

- \`{time}\` - 当前时间，仅包含小时和分钟
- \`{date}\` - 当前日期
- \`{target_id}\` - 当前发送目标 ID，群聊时为群 ID，私聊时为用户 ID
- \`{target_name}\` - 当前发送目标名称，群聊时为群名，私聊时为用户昵称/用户名
- \`{imageURL="..."}\` - 插入图片，支持本地路径、file URL、http(s) URL
- \`{fileURL="..."}\` - 插入文件，支持本地路径、file URL、http(s) URL
- \`<at id="123456789"></at>\` - @ 指定用户

## Cron 表达式示例

- \`30 7 * * *\` - 每天 7:30
- \`0 12 * * 1-5\` - 工作日中午 12:00
- \`0 9 1 * *\` - 每月 1 日 9:00
- \`*/30 * * * *\` - 每 30 分钟

## 更新日志 v0.1.4

- 为定时任务添加唯一 ID ，避免对单一任务注册大量 cron 任务。
`

interface RegisteredTask {
  dispose: () => void
}

const registeredTasks = new Map<string, RegisteredTask>()
const runningTasks = new Set<string>()

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

  const enabledBroadcasts = config.broadcasts.filter((b) => b.enabled)

  logger.info(
    `plugin loaded, ${enabledBroadcasts.length}/${config.broadcasts.length} broadcasts enabled`,
  )

  for (const [broadcastIndex, broadcast] of enabledBroadcasts.entries()) {
    const broadcastName = broadcast.name || '(unnamed)'
    const taskId = createTaskId(broadcast, broadcastIndex)

    if (!broadcast.cronExpression.trim()) {
      logger.warn(`[${broadcastName}] skipped, cron expression is empty`)
      continue
    }

    if (!broadcast.targets.length) {
      logger.warn(`[${broadcastName}] skipped, no targets configured`)
      continue
    }

    if (!broadcast.template.trim()) {
      logger.warn(`[${broadcastName}] skipped, template is empty`)
      continue
    }

    verboseLog(
      `[register] task=${taskId}, broadcast=${broadcastName}, cron=${broadcast.cronExpression}, targets=${broadcast.targets.length}`,
    )

    try {
      const previousTask = registeredTasks.get(taskId)
      if (previousTask) {
        logger.warn(
          `[register] task=${taskId}, duplicate taskId detected, disposing previous cron task`,
        )
        previousTask.dispose()
      }

      const dispose = ctx.cron(broadcast.cronExpression, async () => {
        await executeBroadcast(config, broadcast, taskId)
      })

      registeredTasks.set(taskId, { dispose })
      ctx.on('dispose', () => {
        if (registeredTasks.get(taskId)?.dispose === dispose) {
          registeredTasks.delete(taskId)
        }
      })

      debugLog(`[register] task=${taskId}, broadcast=${broadcastName} registered successfully`)
    } catch (error) {
      logger.warn(
        `[register] task=${taskId}, failed to register broadcast=${broadcastName}: ${error instanceof Error ? error.message : String(error)}`,
      )
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

function createTaskId(broadcast: BroadcastConfig, index: number) {
  const broadcastName = sanitizeTaskPart(broadcast.name || 'unnamed')
  const cronSlug = sanitizeCronPart(broadcast.cronExpression)
  const targetsHash = hashTargets(broadcast.targets)

  return `${name}:${broadcastName}#${index}:${cronSlug}:t${targetsHash}`
}

function sanitizeTaskPart(value: string) {
  return value
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[,:#]/g, '-') || 'unnamed'
}

function sanitizeCronPart(value: string) {
  return value
    .trim()
    .replace(/\*/g, 'star')
    .replace(/\s+/g, '_') || 'empty'
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
