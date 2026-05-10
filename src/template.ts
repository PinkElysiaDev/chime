import { h } from 'koishi'
import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Logger } from 'koishi'
import type { TemplateContext } from './types'

const SPECIAL_TAG_REGEX = /<at\s+id=(["'])([^"']+)\1\s*><\/at>|<at\s+id=(["'])([^"']+)\3\s*\/>|\{(imageURL|fileURL)=(["'])(.*?)\6\}/gi
const REMOTE_URL_REGEX = /^https?:\/\//i
const FILE_URL_REGEX = /^file:\/\//i

export interface TemplateRenderOptions {
  allowLocalResources: boolean
  logger: Logger
}

export async function renderTemplate(
  template: string,
  context: TemplateContext,
  options: TemplateRenderOptions,
): Promise<h[]> {
  const rendered = replaceVariables(template, context)
  return parseTemplateElements(rendered, options)
}

function replaceVariables(template: string, context: TemplateContext): string {
  const replacements: Record<keyof TemplateContext, string> = {
    time: context.time ?? '',
    date: context.date ?? '',
    target_id: context.target_id ?? '',
    target_name: context.target_name ?? '',
  }

  let output = template
  for (const [key, value] of Object.entries(replacements)) {
    output = output.replaceAll(`{${key}}`, value)
  }
  return output
}

async function parseTemplateElements(
  content: string,
  options: TemplateRenderOptions,
): Promise<h[]> {
  const result: h[] = []
  let lastIndex = 0

  for (const match of content.matchAll(SPECIAL_TAG_REGEX)) {
    const index = match.index ?? 0
    if (index > lastIndex) {
      result.push(h.text(content.slice(lastIndex, index)))
    }

    if (match[2] || match[4]) {
      const id = match[2] || match[4]
      result.push(h.at(id))
    } else {
      const type = match[5] as 'imageURL' | 'fileURL' | undefined
      const rawUrl = match[7] || ''

      if (type) {
        result.push(await renderResourceElement(type, rawUrl, options))
      } else {
        result.push(h.text(match[0]))
      }
    }

    lastIndex = index + match[0].length
  }

  if (lastIndex < content.length) {
    result.push(h.text(content.slice(lastIndex)))
  }

  if (result.length === 0) {
    result.push(h.text(content))
  }

  return result
}

async function renderResourceElement(
  type: 'imageURL' | 'fileURL',
  rawUrl: string,
  options: TemplateRenderOptions,
): Promise<h> {
  const label = type === 'imageURL' ? '图片' : '文件'

  try {
    const url = resolveResourceUrl(rawUrl, options)
    return type === 'imageURL' ? h.image(url) : h.file(url)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    options.logger.warn(
      `[template] failed to resolve ${type}=${JSON.stringify(rawUrl)}: ${message}`,
    )
    return h.text(`[${label}加载失败: ${rawUrl}]`)
  }
}

function resolveResourceUrl(rawUrl: string, options: TemplateRenderOptions) {
  const trimmed = rawUrl.trim()
  if (!trimmed) {
    throw new Error('resource url is empty')
  }

  if (REMOTE_URL_REGEX.test(trimmed)) {
    return trimmed
  }

  if (FILE_URL_REGEX.test(trimmed)) {
    if (!options.allowLocalResources) {
      throw new Error('local resources are disabled')
    }

    const localPath = fileURLToPath(trimmed)
    if (!existsSync(localPath)) {
      throw new Error(`local file not found: ${localPath}`)
    }

    return trimmed
  }

  if (!options.allowLocalResources) {
    throw new Error('local resources are disabled')
  }

  const resolvedPath = isAbsolute(trimmed) ? trimmed : resolve(process.cwd(), trimmed)
  if (!existsSync(resolvedPath)) {
    throw new Error(`local file not found: ${resolvedPath}`)
  }

  return pathToFileURL(resolvedPath).href
}
