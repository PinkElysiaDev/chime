import { h } from 'koishi'
import type { TemplateContext } from './types'

const AT_TAG_REGEX = /<at\s+id=(["'])([^"']+)\1\s*><\/at>|<at\s+id=(["'])([^"']+)\3\s*\/>/gi

export function renderTemplate(template: string, context: TemplateContext): h[] {
  const rendered = replaceVariables(template, context)
  return parseTemplateElements(rendered)
}

function replaceVariables(template: string, context: TemplateContext): string {
  const replacements: Record<keyof TemplateContext, string> = {
    time: context.time ?? '',
    date: context.date ?? '',
    bot_id: context.bot_id ?? '',
    bot_platform: context.bot_platform ?? '',
    bot_self_id: context.bot_self_id ?? '',
    group_id: context.group_id ?? '',
  }

  let output = template
  for (const [key, value] of Object.entries(replacements)) {
    output = output.replaceAll(`{${key}}`, value)
  }
  return output
}

function parseTemplateElements(content: string): h[] {
  const result: h[] = []
  let lastIndex = 0

  for (const match of content.matchAll(AT_TAG_REGEX)) {
    const index = match.index ?? 0
    if (index > lastIndex) {
      result.push(h.text(content.slice(lastIndex, index)))
    }

    const id = match[2] || match[4]
    if (id) {
      result.push(h.at(id))
    } else {
      result.push(h.text(match[0]))
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
