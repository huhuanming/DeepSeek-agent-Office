// chat.mjs — 鲸鱼娘对话 / 解说
//
// 两种模式（CONTRACT 第 3 节）：
//   1. 没配置 DEEPSEEK_API_KEY：source="narration"，用 /api/state 的实时状态
//      拼出鲸鱼娘口吻的中文短句，绝不编造不存在的会话/人物/数字。
//   2. 配置了 key：走 api.deepseek.com，system prompt 注入办公室状态摘要，
//      限制 120 字、不要 Markdown；超时/失败/空回复一律降级成 narration，绝不 500。
//
// 语气：住在办公室里的像素鲸鱼娘，陪 6~10 岁小朋友看电视；中文、短句、可爱但不幼稚。

import { flattenSessions, formatDuration, hashSeed, pick, summarizeOffice } from './state.mjs'

const MAX_QUESTION_LENGTH = 500
const MAX_REPLY_LENGTH = 160

const LLM_SYSTEM_PROMPT = (summary) =>
  [
    '你是「鲸鱼娘」，一只住在 DeepSeek Harness 办公室里的像素小鲸鱼，正陪电视前的小朋友一起看办公室。',
    '说话要求：中文、口语、短句；一次只说 1~3 句，总共不超过 120 个字；',
    '不要 Markdown、不要列表、不要代码块、不要表情符号、不要引号包围整段话；语气温柔可爱，适合 6~10 岁小朋友。',
    '你只能根据下面提供的「办公室实时状态」回答，绝对不要编造不存在的会话、人物、数字或任务；',
    '状态里没有的信息就说你不知道，再可爱地岔开话题。',
    '如果小朋友问的是和办公室无关的闲聊，可以可爱地回应，但不要编造办公室的事。',
    '',
    '办公室实时状态：',
    summary,
  ].join('\n')

function normalizeQuestion(raw) {
  if (typeof raw !== 'string') return ''
  return raw.replace(/\s+/gu, ' ').trim().slice(0, MAX_QUESTION_LENGTH)
}

function classify(question) {
  const text = String(question ?? '')
  if (/谁.*(最|更).*(努力|忙|辛苦|厉害)|最努力|最忙|谁在忙|谁最/.test(text)) return 'hardest'
  if (/故事|讲讲|讲个|讲一个|新鲜事|八卦|好玩/.test(text)) return 'story'
  if (/几(个|位|只)|多少|一共/.test(text)) return 'count'
  if (/多久|多长时间|几个小时| 多久了/.test(text)) return 'duration'
  if (/进度|待办|做到哪|完成|todo|清单/.test(text)) return 'progress'
  if (/休息|睡着|安静|闲|空/.test(text)) return 'quiet'
  return 'busy'
}

function joinTitles(sessions, limit = 2) {
  return sessions
    .slice(0, limit)
    .map((session) => `「${session.title}」`)
    .join('、')
}

function speakerNames(sessions) {
  const names = new Set()
  for (const session of sessions) {
    for (const member of session.team) names.add(member.name)
  }
  return [...names]
}

function noOfficeNarration(seed) {
  return pick(
    [
      '办公室里现在一个人都没有，安安静静的，只有我在吐泡泡～',
      '咦，办公室空空的，小伙伴们都还没来上班呢。先戳戳我玩吧～',
      '现在没有小伙伴在上班哦，我先在门口等你。戳一下我就有反应啦～',
    ],
    seed,
  )
}

function idleNarration(sessions, seed) {
  const idle = sessions.filter((session) => session.status === 'idle')
  const success = sessions.filter((session) => session.status === 'success')
  if (success.length > 0) {
    return `刚才${joinTitles(success, 1)}把活儿干完啦，大家都在休息。现在办公室安安静静的～`
  }
  if (idle.length > 0) {
    return pick(
      [
        `现在办公室里静悄悄的，${joinTitles(idle, 1)}正趴在桌上打盹呢。你可以戳戳我～`,
        `小伙伴们都休息啦，${joinTitles(idle, 1)}在偷偷伸懒腰。要不要按长按 OK 和我聊天呀？`,
      ],
      seed,
    )
  }
  return pick(
    ['大家都休息啦，办公室里只有键盘的呼噜声～', '现在没有小伙伴在忙哦，我先陪你坐一会儿～'],
    seed,
  )
}

function focusNarration(focus, seed) {
  if (!focus) return ''
  const helpers = focus.team
    .filter((member) => member.state === 'running')
    .map((member) => member.name)
  if (focus.status === 'working') {
    const pieces = [`你问的是${joinTitles([focus], 1)}呀！`]
    pieces.push(`它正在认真工作，已经忙了 ${formatDuration(focus.elapsedSec)}，现在是第 ${focus.step} 步。`)
    if (focus.todos.total > 0) {
      pieces.push(`小清单上完成 ${focus.todos.done} 项啦。`)
    }
    if (helpers.length > 0) pieces.push(`${helpers.slice(0, 2).join('、')}在帮它呢。`)
    return pieces.join('')
  }
  if (focus.status === 'waiting') {
    return `${joinTitles([focus], 1)}在等人确认一下，先停一停哦。`
  }
  if (focus.status === 'success') {
    return `${joinTitles([focus], 1)}刚刚干完一件活儿，真棒！`
  }
  return pick(
    [
      `${joinTitles([focus], 1)}现在在休息，安安静静地趴着呢。`,
      `${joinTitles([focus], 1)}这会儿没有在忙，正在偷偷打个盹～`,
    ],
    seed,
  )
}

function buildNarration(question, model, options = {}) {
  const sessions = flattenSessions(model)
  const seed = hashSeed(`${question}|${sessions.length}|${new Date().getMinutes()}`)
  if (sessions.length === 0) return noOfficeNarration(seed)

  const running = sessions.filter((session) => session.status === 'working')
  const waiting = sessions.filter((session) => session.status === 'waiting')
  const success = sessions.filter((session) => session.status === 'success')
  const idle = sessions.filter((session) => session.status === 'idle')
  const teammates = speakerNames(sessions)
  const intent = classify(question)

  // 指定了 sessionId：直接解说那一个（网页面板里点某个工位时用）
  const focus = options.sessionId
    ? sessions.find((session) => session.id === options.sessionId)
    : null
  if (focus && intent !== 'story') return focusNarration(focus, seed)

  if (intent === 'hardest') {
    if (running.length === 0) {
      return pick(
        [
          '现在大家都在休息，没有人在忙哦。不过我觉得，每个人都很努力呀！',
          '这会儿没有人正在忙呢。他们休息好了才有力气继续帮忙呀～',
        ],
        seed,
      )
    }
    const busiest = [...running].sort((a, b) => b.elapsedSec - a.elapsedSec)[0]
    const pieces = [`现在最努力的是${joinTitles([busiest], 1)}！`, `已经忙了 ${formatDuration(busiest.elapsedSec)}啦。`]
    if (busiest.todos.total > 0) {
      pieces.push(`它的小清单上已经完成 ${busiest.todos.done} 项了。`)
    }
    const helpers = busiest.team.filter((member) => member.state === 'running').map((member) => member.name)
    if (helpers.length > 0) {
      pieces.push(`旁边还有 ${helpers.slice(0, 2).join('、')} 在帮忙呢。`)
    }
    return pieces.join('')
  }

  if (intent === 'story') {
    const pieces = ['今天办公室可热闹啦～']
    if (running.length > 0) {
      pieces.push(`${joinTitles(running, 1)}正在认真干活，键盘敲得噼里啪啦的。`)
    }
    if (waiting.length > 0) {
      pieces.push(`${joinTitles(waiting, 1)}先停下来等人确认一下。`)
    }
    if (idle.length > 0) {
      pieces.push(`${joinTitles(idle, 1)}在旁边打盹，偷偷流了一点口水。`)
    }
    if (success.length > 0) {
      pieces.push(`刚才${joinTitles(success, 1)}完成了一件小事，大家都给它鼓掌。`)
    }
    pieces.push('我就在旁边看着大家，顺便陪你看电视～')
    return pieces.join('')
  }

  if (intent === 'count') {
    const pieces = [`办公室现在有 ${sessions.length} 个小伙伴哦。`]
    if (running.length > 0) pieces.push(`${running.length} 个在忙，`)
    if (waiting.length > 0) pieces.push(`${waiting.length} 个在等确认，`)
    if (idle.length > 0) pieces.push(`${idle.length} 个在休息。`)
    if (teammates.length > 0) pieces.push(`还有 ${teammates.slice(0, 3).join('、')} 这些帮手呢。`)
    return pieces.join('')
  }

  if (intent === 'duration') {
    if (running.length === 0) {
      return `现在没有人正在忙哦。大家上一轮都忙完啦，正在歇一歇～`
    }
    const busiest = [...running].sort((a, b) => b.elapsedSec - a.elapsedSec)[0]
    return `忙得最久的是${joinTitles([busiest], 1)}，已经工作 ${formatDuration(busiest.elapsedSec)}啦。它还在认真敲键盘呢。`
  }

  if (intent === 'progress') {
    const withTodos = sessions
      .filter((session) => session.todos.total > 0)
      .sort((a, b) => (b.running ? 1 : 0) - (a.running ? 1 : 0))
    if (withTodos.length === 0) {
      return '现在还没有小伙伴在写任务清单呢。等他们开工了，我再来告诉你进度～'
    }
    const target = withTodos[0]
    return `${joinTitles([target], 1)}的小清单上有 ${target.todos.total} 件事，已经完成 ${target.todos.done} 件啦。`
  }

  if (intent === 'quiet') {
    if (running.length === 0 && waiting.length === 0) {
      return idleNarration(sessions, seed)
    }
  }

  // 默认：他们在忙什么
  if (running.length > 0) {
    const pieces = [`小朋友你好呀～办公室里有 ${running.length} 位小伙伴在忙哦。`]
    const busiest = [...running].sort((a, b) => b.elapsedSec - a.elapsedSec)[0]
    pieces.push(`${joinTitles([busiest], 1)}已经忙了 ${formatDuration(busiest.elapsedSec)}啦。`)
    const others = running.filter((session) => session.id !== busiest.id)
    if (others.length > 0) pieces.push(`还有${joinTitles(others, 1)}也在认真干活。`)
    if (waiting.length > 0) pieces.push(`有一位在等大人按确认，先停一会儿。`)
    if (success.length > 0) pieces.push(`刚刚${joinTitles(success, 1)}还完成了一件小事呢。`)
    return pieces.join('')
  }
  if (waiting.length > 0) {
    return `现在${joinTitles(waiting, 1)}在等人确认一下，大家都先停下来等一等。你也想看的话，再按一次和我聊聊呀～`
  }
  if (success.length > 0) {
    return `刚刚${joinTitles(success, 1)}干完了一件活儿，真棒！现在大家在休息，你可以戳戳我玩～`
  }
  return idleNarration(sessions, seed)
}

/** 去掉 Markdown / 多余空白，保证能直接上电视字幕和 TTS */
function cleanForTv(text) {
  let value = String(text ?? '')
    .replace(/\r/g, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^[ \t]*#{1,6}[ \t]*/gmu, '')
    .replace(/^[ \t]*[-*+][ \t]+/gmu, '')
    .replace(/^[ \t]*>[ \t]*/gmu, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/[*_`~]/gu, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
  if (value.length > MAX_REPLY_LENGTH) {
    const cut = value.slice(0, MAX_REPLY_LENGTH)
    const lastStop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'))
    value = lastStop > 40 ? cut.slice(0, lastStop + 1) : `${cut.replace(/[，、；：,;:]$/u, '')}～`
  }
  return value
}

async function askLlm(question, model, config, focusTitle = '') {
  const apiKey = process.env[config.apiKeyEnv] || config.apiKey || ''
  if (!apiKey) return null

  const baseUrl = String(config.llm?.baseUrl || 'https://api.deepseek.com').replace(/\/+$/u, '')
  const timeoutMs = Number(config.llm?.timeoutMs) || 8000
  const summary = summarizeOffice(model)
  const userContent = focusTitle
    ? `我想问「${focusTitle}」：${question || '它现在在忙什么？'}`
    : question || '他们在忙什么？'
  const body = {
    model: config.llm?.model || 'deepseek-chat',
    messages: [
      { role: 'system', content: LLM_SYSTEM_PROMPT(summary) },
      { role: 'user', content: userContent },
    ],
    stream: false,
    max_tokens: Number(config.llm?.maxTokens) || 260,
    temperature: 1.1,
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`DeepSeek API HTTP ${response.status} ${detail.slice(0, 120)}`)
  }
  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content
  const cleaned = cleanForTv(content)
  if (!cleaned) throw new Error('DeepSeek API 返回了空内容')
  return cleaned
}

/**
 * @param {ReturnType<import('./state.mjs').loadConfig>} config
 */
export function createChatService(config) {
  async function answer(rawQuestion, model, options = {}) {
    const question = normalizeQuestion(rawQuestion)
    const focus = options.sessionId
      ? flattenSessions(model).find((session) => session.id === options.sessionId)
      : null
    const narration = buildNarration(question, model, options)

    try {
      const llmReply = await askLlm(question, model, config, focus?.title ?? '')
      if (llmReply) {
        return { reply: llmReply, speak: llmReply, source: 'llm' }
      }
    } catch (err) {
      // 失败一定要降级，不要 500，不要让孩子看到错误
      console.warn(`[chat] LLM 调用失败，降级为 narration：${err.message}`)
    }

    return { reply: narration, speak: narration, source: 'narration' }
  }

  return { answer }
}
