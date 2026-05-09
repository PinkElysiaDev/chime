import type { Bot, h, Logger } from 'koishi'
import type { AntiBanConfig } from './types'
import { computeDelayMs, sleep } from './utils'

interface SenderOptions {
  antiBan: AntiBanConfig
  logger: Logger
  debug?: boolean
  verboseLogging?: boolean
  broadcastName?: string
}

export async function sendToDestinations(
  bot: Bot,
  destinations: string[],
  message: h[],
  options: SenderOptions,
) {
  for (let index = 0; index < destinations.length; index++) {
    const destination = destinations[index]
    const broadcastName = options.broadcastName || '(unnamed)'

    if (options.verboseLogging) {
      options.logger.info(
        `[sender] broadcast=${broadcastName}, destination ${index + 1}/${destinations.length}, id=${destination}`,
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
            `[sender] broadcast=${broadcastName}, waiting ${delayMs}ms before sending to ${destination}`,
          )
        }
        await sleep(delayMs)
      }
    }

    try {
      await bot.sendMessage(destination, message)
      if (options.debug || options.verboseLogging) {
        options.logger.info(
          `[sender] broadcast=${broadcastName}, sent to ${destination}`,
        )
      }
    } catch (error) {
      options.logger.warn(
        `[sender] broadcast=${broadcastName}, failed to send to ${destination}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
