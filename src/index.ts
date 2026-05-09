import { Context } from 'koishi'
import {} from 'koishi-plugin-cron'
import { Config, name } from './config'
import type { BroadcastConfig, Config as ChimeConfig, TemplateContext } from './types'
import { renderTemplate } from './template'
import { sendToDestinations } from './sender'
import { getBotId } from './utils'

export { Config, name } from './config'
export * from './types'

export const inject = {
  required: ['cron'],
}

export const usage = `
## 插件功能说明

定时向指定群聊/频道发送广播消息，支持多 Bot、多目标、变量模板和 anti-ban 延迟。

## 变量与标签说明

- \`{time}\` - 当前时间（完整日期时间）
- \`{date}\` - 当前日期
- \`{bot_id}\` - Bot 标识（platform:selfId）
- \`{bot_platform}\` - Bot 平台名称
- \`{bot_self_id}\` - Bot 账号 ID
- \`{group_id}\` - 当前发送目标群/频道 ID
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

    if (!broadcast.destinations.length) {
      logger.warn(`[${broadcastName}] skipped, no destinations configured`)
      continue
    }

    if (!broadcast.template.trim()) {
      logger.warn(`[${broadcastName}] skipped, template is empty`)
      continue
    }

    verboseLog(
      `[register] broadcast=${broadcastName}, cron=${broadcast.cronExpression}, platform=${broadcast.platform}, botId=${broadcast.botId}, destinations=${broadcast.destinations.length}`,
    )

    try {
      ctx.cron(broadcast.cronExpression, async () => {
        await executeBroadcast(ctx, config, broadcast)
      })
      debugLog(`[register] broadcast=${broadcastName} registered successfully`)
    } catch (error) {
      logger.warn(
        `[register] failed to register broadcast=${broadcastName}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async function executeBroadcast(
    ctx: Context,
    config: ChimeConfig,
    broadcast: BroadcastConfig,
  ) {
    const broadcastName = broadcast.name || '(unnamed)'
    const botKey = `${broadcast.platform}:${broadcast.botId}`

    verboseLog(`[trigger] broadcast=${broadcastName}, looking for bot=${botKey}`)

    const bot = ctx.bots[botKey]

    if (!bot) {
      logger.warn(
        `[trigger] broadcast=${broadcastName}, bot ${botKey} not found or offline`,
      )
      return
    }

    const now = new Date()
    const baseContext = {
      time: now.toLocaleString(),
      date: now.toLocaleDateString(),
      bot_id: getBotId(broadcast.platform, broadcast.botId),
      bot_platform: broadcast.platform,
      bot_self_id: broadcast.botId,
    }

    // 如果模板中不包含 {group_id}，所有目标共用同一条渲染结果，直接批量发送
    if (!broadcast.template.includes('{group_id}')) {
      const templateContext: TemplateContext = { ...baseContext, group_id: '' }
      const message = renderTemplate(broadcast.template, templateContext)

      verboseLog(
        `[template] broadcast=${broadcastName}, rendered segments=${message.length}`,
      )

      await sendToDestinations(bot, broadcast.destinations, message, {
        antiBan: config.antiBan,
        logger,
        debug: config.debug,
        verboseLogging: config.verboseLogging,
        broadcastName,
      })
    } else {
      // 模板包含 {group_id}，需要逐个目标渲染并发送
      for (let i = 0; i < broadcast.destinations.length; i++) {
        const destination = broadcast.destinations[i]
        const templateContext: TemplateContext = { ...baseContext, group_id: destination }
        const message = renderTemplate(broadcast.template, templateContext)

        verboseLog(
          `[template] broadcast=${broadcastName}, destination=${destination}, rendered segments=${message.length}`,
        )

        if (i > 0 && config.antiBan.enabled) {
          const { computeDelayMs, sleep } = await import('./utils')
          const delayMs = computeDelayMs(config.antiBan.baseDelaySeconds, config.antiBan.jitterPercent)
          if (delayMs > 0) {
            verboseLog(`[sender] broadcast=${broadcastName}, waiting ${delayMs}ms before sending to ${destination}`)
            await sleep(delayMs)
          }
        }

        try {
          await bot.sendMessage(destination, message)
          if (config.debug || config.verboseLogging) {
            logger.info(`[sender] broadcast=${broadcastName}, sent to ${destination}`)
          }
        } catch (error) {
          logger.warn(
            `[sender] broadcast=${broadcastName}, failed to send to ${destination}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
    }

    debugLog(`[done] broadcast=${broadcastName} completed`)
  }
}
