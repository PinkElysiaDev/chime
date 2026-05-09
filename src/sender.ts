import type { Bot, h, Logger } from 'koishi'
import type { AntiBanConfig, BroadcastTargetConfig } from './types'
import { computeDelayMs, sleep } from './utils'

interface SenderOptions {
  antiBan: AntiBanConfig
  logger: Logger
  debug?: boolean
  verboseLogging?: boolean
  broadcastName?: string
}

export interface PreparedBroadcastTarget {
  bot: Bot
  target: BroadcastTargetConfig
  message: h[]
}

export async function sendToTargets(
  targets: PreparedBroadcastTarget[],
  options: SenderOptions,
) {
  const broadcastName = options.broadcastName || '(unnamed)'

  for (let index = 0; index < targets.length; index++) {
    const item = targets[index]
    const { bot, target, message } = item

    if (options.verboseLogging) {
      options.logger.info(
        `[sender] broadcast=${broadcastName}, target ${index + 1}/${targets.length}, bot=${target.platform}:${target.botId}, type=${target.type}, id=${target.id}`,
      )
    }

    if (index > 0 && options.antiBan.enabled) {
      const delayMs = computeDelayMs(
        options.antiBan.baseDelaySeconds,
        options.antiBan.jitterPercent,
      )

      if (delayMs > 0) {
        if (options.verboseLogging) {
          options.logger.info(
            `[sender] broadcast=${broadcastName}, waiting ${delayMs}ms before sending to ${target.type}:${target.id}`,
          )
        }
        await sleep(delayMs)
      }
    }

    try {
      const sendPath = await sendSingleTarget(bot, target, message, options)
      if (options.debug || options.verboseLogging) {
        options.logger.info(
          `[sender] broadcast=${broadcastName}, sent to ${target.type}:${target.id}, bot=${target.platform}:${target.botId}, path=${sendPath}`,
        )
      }
    } catch (error) {
      options.logger.warn(
        `[sender] broadcast=${broadcastName}, failed to send to ${target.type}:${target.id}, bot=${target.platform}:${target.botId}: ${error instanceof Error ? error.stack || error.message : String(error)}`,
      )
    }
  }
}

async function sendSingleTarget(
  bot: Bot,
  target: BroadcastTargetConfig,
  message: h[],
  options: SenderOptions,
) {
  const broadcastName = options.broadcastName || '(unnamed)'

  if (target.type === 'guild') {
    if (options.verboseLogging) {
      options.logger.info(
        `[sender] broadcast=${broadcastName}, path=guild-sendMessage, target=${target.id}`,
      )
    }
    await bot.sendMessage(target.id, message)
    return 'guild-sendMessage'
  }

  const anyBot = bot as any

  if (typeof anyBot.sendPrivateMessage === 'function') {
    if (options.verboseLogging) {
      options.logger.info(
        `[sender] broadcast=${broadcastName}, path=sendPrivateMessage, target=${target.id}`,
      )
    }
    await anyBot.sendPrivateMessage(target.id, message)
    return 'sendPrivateMessage'
  }

  if (typeof anyBot.createDirectChannel === 'function') {
    if (options.verboseLogging) {
      options.logger.info(
        `[sender] broadcast=${broadcastName}, path=createDirectChannel, target=${target.id}`,
      )
    }
    const channel = await anyBot.createDirectChannel(target.id)
    const channelId = typeof channel === 'string' ? channel : channel?.id
    if (!channelId) {
      throw new Error('failed to resolve direct channel id')
    }

    await anyBot.sendMessage(channelId, message)
    return 'createDirectChannel->sendMessage'
  }

  if (typeof anyBot.getDmChannel === 'function') {
    if (options.verboseLogging) {
      options.logger.info(
        `[sender] broadcast=${broadcastName}, path=getDmChannel, target=${target.id}`,
      )
    }
    const channel = await anyBot.getDmChannel(target.id)
    const channelId = typeof channel === 'string' ? channel : channel?.id
    if (!channelId) {
      throw new Error('failed to resolve dm channel id')
    }

    await anyBot.sendMessage(channelId, message)
    return 'getDmChannel->sendMessage'
  }

  throw new Error('private message is not supported by current adapter')
}
