import { Context } from 'koishi'
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
import { getBotId } from './utils'

export { Config, name } from './config'
export * from './types'

export const inject = {
  required: ['cron'],
}

export const usage = `
## 插件功能说明

定时发送广播消息，支持一条广播同时启用多个 Bot，支持群聊与私聊目标，支持变量模板和 anti-ban 延迟。

## 广播范围配置

每条广播中的 \`targets\` 是一个表格。每一行表示一次发送目标：

- \`platform\` - Bot 平台名称，例如 onebot
- \`botId\` - Bot 账号 ID
- \`type\` - 发送目标类型：群聊或私聊
- \`id\` - 目标群聊 ID 或私聊用户 ID

## 变量与标签说明

- \`{time}\` - 当前时间（完整日期时间）
- \`{date}\` - 当前日期
- \`{bot_id}\` - Bot 标识（platform:selfId）
- \`{bot_platform}\` - Bot 平台名称
- \`{bot_self_id}\` - Bot 账号 ID
- \`{target_id}\` - 当前发送目标 ID
- \`{target_type}\` - 当前发送目标类型（guild/private）
- \`{group_id}\` - 当前群聊目标 ID，仅群聊时有值
- \`{private_id}\` - 当前私聊目标 ID，仅私聊时有值
- \`<at id="123456789"></at>\` - @ 指定用户

## Cron 表达式示例

- \`30 7 * * *\` - 每天 7:30
- \`0 12 * * 1-5\` - 工作日中午 12:00
- \`0 9 1 * *\` - 每月 1 日 9:00
- \`*/30 * * * *\` - 每 30 分钟
`

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

  for (const broadcast of enabledBroadcasts) {
    const broadcastName = broadcast.name || '(unnamed)'

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
      `[register] broadcast=${broadcastName}, cron=${broadcast.cronExpression}, targets=${broadcast.targets.length}`,
    )

    try {
      ctx.cron(broadcast.cronExpression, async () => {
        await executeBroadcast(config, broadcast)
      })
      debugLog(`[register] broadcast=${broadcastName} registered successfully`)
    } catch (error) {
      logger.warn(
        `[register] failed to register broadcast=${broadcastName}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async function executeBroadcast(
    config: ChimeConfig,
    broadcast: BroadcastConfig,
  ) {
    const broadcastName = broadcast.name || '(unnamed)'
    const preparedTargets: PreparedBroadcastTarget[] = []
    const now = new Date()

    verboseLog(
      `[trigger] broadcast=${broadcastName}, preparing ${broadcast.targets.length} targets`,
    )

    for (const target of broadcast.targets) {
      const botKey = `${target.platform}:${target.botId}`

      if (!target.id.trim()) {
        logger.warn(
          `[trigger] broadcast=${broadcastName}, skipped empty target id, bot=${botKey}, type=${target.type}`,
        )
        continue
      }

      verboseLog(
        `[trigger] broadcast=${broadcastName}, looking for bot=${botKey}, type=${target.type}, id=${target.id}`,
      )

      const bot = ctx.bots[botKey]

      if (!bot) {
        logger.warn(
          `[trigger] broadcast=${broadcastName}, bot ${botKey} not found or offline`,
        )
        continue
      }

      const templateContext = buildTemplateContext(now, target)
      const message = renderTemplate(broadcast.template, templateContext)

      verboseLog(
        `[template] broadcast=${broadcastName}, bot=${botKey}, type=${target.type}, id=${target.id}, rendered segments=${message.length}`,
      )

      preparedTargets.push({
        bot,
        target,
        message,
      })
    }

    if (!preparedTargets.length) {
      logger.warn(`[trigger] broadcast=${broadcastName}, no valid targets to send`)
      return
    }

    await sendToTargets(preparedTargets, {
      antiBan: config.antiBan,
      logger,
      debug: config.debug,
      verboseLogging: config.verboseLogging,
      broadcastName,
    })

    debugLog(`[done] broadcast=${broadcastName} completed`)
  }
}

function buildTemplateContext(
  now: Date,
  target: BroadcastTargetConfig,
): TemplateContext {
  return {
    time: now.toLocaleString(),
    date: now.toLocaleDateString(),
    bot_id: getBotId(target.platform, target.botId),
    bot_platform: target.platform,
    bot_self_id: target.botId,
    target_id: target.id,
    target_type: target.type,
    group_id: target.type === 'guild' ? target.id : '',
    private_id: target.type === 'private' ? target.id : '',
  }
}
