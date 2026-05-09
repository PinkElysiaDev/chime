export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export function computeDelayMs(baseDelaySeconds: number, jitterPercent: number) {
  const baseMs = Math.max(0, baseDelaySeconds) * 1000
  if (baseMs === 0) return 0

  const jitter = Math.max(0, jitterPercent) / 100
  const minFactor = Math.max(0, 1 - jitter)
  const maxFactor = 1 + jitter
  const factor = minFactor + Math.random() * (maxFactor - minFactor)
  return Math.round(baseMs * factor)
}

export function getBotId(platform?: string, selfId?: string) {
  return `${platform ?? ''}:${selfId ?? ''}`
}
