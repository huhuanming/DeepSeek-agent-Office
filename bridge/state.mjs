// state.mjs — 把 DSH 的本地状态缓存翻译成电视办公室模型
//
// 数据源：~/.dsh/storages/session_projcache/sessions/*.json
//   record.identity.cwd
//   record.rows.title.val
//   record.rows.sessionStats.val      （openStep != null 表示正在跑）
//   record.rows.sessionListMetadata.val（blank / lastPromptAt）
//   record.rows.agentTeam.val.members[]
//   record.rows.subagentCatalog.val.head.values[].childId
//   record.rows.todos.val
//   record.rows.userQuestions.val.questions.active
//   record.rows.timeContext.val.lastMessageTime
//
// 本文件只产出 CONTRACT.md 第 3 节的 OfficeModel（GET /api/state 的响应体），
// 另外导出 summarizeOffice()/formatDuration()/flattenSessions() 给 chat.mjs 用。
//
// 性能策略：整个目录 1 秒扫描一次；单文件按 mtime+size 缓存，内容没变就不重新 parse；
// 模型装配是纯内存操作，每次请求重新算（elapsedSec / 心情都依赖“现在”）。

import { readFile, readdir, stat } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const BRIDGE_DIR = path.dirname(fileURLToPath(import.meta.url))

export const BRIDGE_NAME = 'dsh-office-tv'
export const BRIDGE_VERSION = '0.1.0'

export const DEFAULT_EXPOSED_CLIPS = Object.freeze([
  'idle',
  'idle_yawn',
  'idle_stretch',
  'thinking',
  'working',
  'working_command',
  'working_search',
  'waiting',
  'success',
  'error',
  'poke',
  'head_pat',
  'tail',
])

const DEFAULT_CONFIG = Object.freeze({
  port: 8765,
  discoveryPort: 8766,
  host: '0.0.0.0',
  stateCacheMs: 1000,
  maxSessions: 24,
  maxSessionsPerWorkspace: 6,
  recentHours: 24,
  maxScanFiles: 240,
  projcacheDir: '~/.dsh/storages/session_projcache/sessions',
  petDir: '~/.dsh/profiles/desktop/node_modules/dsh-dafeiyu/assets/pet',
  webDir: 'web',
  apiKeyEnv: 'DEEPSEEK_API_KEY',
  tts: {
    enabled: true,
    voice: 'zh-CN-XiaoyiNeural',
    bin: '~/.dsh-office-tts/venv/bin/edge-tts',
    cacheDir: '~/.dsh-office-tts/cache',
    timeoutMs: 12000,
    maxChars: 200,
  },
  exposedClips: DEFAULT_EXPOSED_CLIPS,
  llm: {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    timeoutMs: 8000,
    maxTokens: 260,
  },
})

const SUCCESS_WINDOW_MS = 60_000
const PET_SUCCESS_MS = 6_000
const IDLE_MICRO_MIN_MS = 25_000
const IDLE_MICRO_MAX_MS = 40_000

export function expandHome(value) {
  if (typeof value !== 'string') return value
  const text = value.trim()
  if (!text) return text
  if (text === '~') return os.homedir()
  if (text.startsWith('~/') || text.startsWith('~\\')) {
    return path.join(os.homedir(), text.slice(2))
  }
  return text
}

function clampInt(value, min, max, fallback) {
  const number = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

/**
 * 读取 config.json + 环境变量覆盖。
 * 环境变量：PORT / DISCOVERY_PORT / PET_DIR / PROJCACHE_DIR / STATE_CACHE_MS / DSH_OFFICE_WEB_DIR
 */
export function loadConfig(env = process.env) {
  const configPath = path.join(BRIDGE_DIR, 'config.json')
  let fileConfig = {}
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'))
    if (parsed && typeof parsed === 'object') fileConfig = parsed
  } catch (err) {
    console.warn(`[config] 读取 config.json 失败，使用内置默认值：${err.message}`)
  }

  const config = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    llm: { ...DEFAULT_CONFIG.llm, ...(fileConfig.llm ?? {}) },
    tts: { ...DEFAULT_CONFIG.tts, ...(fileConfig.tts ?? {}) },
  }

  if (env.PORT) config.port = clampInt(env.PORT, 1, 65535, config.port)
  if (env.DISCOVERY_PORT) {
    config.discoveryPort = clampInt(env.DISCOVERY_PORT, 1, 65535, config.discoveryPort)
  }
  if (env.PET_DIR) config.petDir = env.PET_DIR
  if (env.PROJCACHE_DIR) config.projcacheDir = env.PROJCACHE_DIR
  if (env.STATE_CACHE_MS) {
    config.stateCacheMs = clampInt(env.STATE_CACHE_MS, 100, 10_000, config.stateCacheMs)
  }
  if (env.DSH_OFFICE_WEB_DIR) config.webDir = env.DSH_OFFICE_WEB_DIR
  if (env.TTS_VOICE) config.tts.voice = env.TTS_VOICE
  if (env.TTS_BIN) config.tts.bin = env.TTS_BIN
  if (env.TTS_CACHE_DIR) config.tts.cacheDir = env.TTS_CACHE_DIR
  if (env.TTS_ENABLED === '0' || env.TTS_ENABLED === 'false') config.tts.enabled = false

  config.stateCacheMs = clampInt(config.stateCacheMs, 100, 10_000, 1000)
  config.maxSessions = clampInt(config.maxSessions, 1, 100, 24)
  config.maxSessionsPerWorkspace = clampInt(
    config.maxSessionsPerWorkspace,
    1,
    config.maxSessions,
    6,
  )
  config.recentHours = clampInt(config.recentHours, 1, 24 * 30, 24)
  config.maxScanFiles = clampInt(config.maxScanFiles, config.maxSessions, 1000, 240)
  config.projcacheDir = path.resolve(expandHome(config.projcacheDir))
  config.petDir = path.resolve(expandHome(config.petDir))
  config.webDir = path.resolve(BRIDGE_DIR, expandHome(config.webDir))
  if (!Array.isArray(config.exposedClips) || config.exposedClips.length === 0) {
    config.exposedClips = [...DEFAULT_EXPOSED_CLIPS]
  }
  config.tts.bin = path.resolve(expandHome(config.tts.bin))
  config.tts.cacheDir = path.resolve(expandHome(config.tts.cacheDir))
  config.apiKey = env[config.apiKeyEnv] || ''
  return config
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function rowValue(rows, key) {
  if (!rows || typeof rows !== 'object') return undefined
  const row = rows[key]
  if (!row || typeof row !== 'object') return undefined
  return Object.prototype.hasOwnProperty.call(row, 'val') ? row.val : row
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function toArray(value) {
  return Array.isArray(value) ? value : []
}

function toNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function firstLine(text, maxLength = 60) {
  const normalized = String(text ?? '').replace(/\r/g, '').split('\n')[0].trim()
  if (!normalized) return ''
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized
}

/** 给小朋友/电视看的时长文案（秒 → 中文） */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(toNumber(seconds)))
  if (total < 10) return '刚刚开始'
  if (total < 60) return '不到 1 分钟'
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`
}

function questionTextOf(question) {
  if (typeof question === 'string') return question.trim()
  const record = asRecord(question)
  if (!record) return ''
  for (const key of ['text', 'question', 'title', 'prompt', 'message', 'content']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (Array.isArray(value)) {
      const joined = value
        .map((part) => (typeof part === 'string' ? part : textOf(asRecord(part)?.text)))
        .filter(Boolean)
        .join(' ')
        .trim()
      if (joined) return joined
    }
  }
  return ''
}

function pick(array, seed) {
  if (!Array.isArray(array) || array.length === 0) return ''
  const index = Math.abs(Math.trunc(seed)) % array.length
  return array[index]
}

function hashSeed(value) {
  let hash = 0
  const text = String(value ?? '')
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0
  }
  return hash
}

// ---------------------------------------------------------------------------
// 单个 session 文件 → 内部结构
// ---------------------------------------------------------------------------

function extractSession(entry, fileName) {
  const data = asRecord(entry?.data)
  const record = asRecord(data?.record)
  const rows = asRecord(record?.rows) ?? {}
  const identity = asRecord(record?.identity) ?? {}

  const stats = asRecord(rowValue(rows, 'sessionStats')) ?? {}
  const openStep = asRecord(stats.openStep)
  const meta = asRecord(rowValue(rows, 'sessionListMetadata')) ?? {}
  const timeContext = asRecord(rowValue(rows, 'timeContext')) ?? {}
  const titleInput = asRecord(rowValue(rows, 'titleInput')) ?? {}
  const userQuestions = asRecord(rowValue(rows, 'userQuestions')) ?? {}
  const activeQuestions = toArray(asRecord(userQuestions.questions)?.active)
  const teamRow = asRecord(rowValue(rows, 'agentTeam')) ?? {}
  const catalog = asRecord(rowValue(rows, 'subagentCatalog')) ?? {}
  const goal = asRecord(rowValue(rows, 'goal')) ?? {}
  const turnBoundary = asRecord(rowValue(rows, 'turnBoundary')) ?? {}
  const lastStepBoundary = asRecord(turnBoundary.lastStepBoundary)
  const llmRetry = asRecord(rowValue(rows, 'llmRetry'))
  const todoList = toArray(rowValue(rows, 'todos'))

  const id = fileName.replace(/\.json$/iu, '')
  const cwd = textOf(identity.cwd) || textOf(rowValue(rows, 'workingDirectory'))
  const title =
    textOf(rowValue(rows, 'title')) ||
    firstLine(asRecord(titleInput.first)?.text, 60) ||
    '新会话'
  const prompt = textOf(asRecord(titleInput.first)?.text)

  const teamMembers = toArray(teamRow.members)
    .map((member) => asRecord(member))
    .filter(Boolean)
    .map((member) => ({
      id: String(member.id ?? ''),
      name: textOf(member.name) || '小伙伴',
    }))
    .filter((member) => member.id)

  // subagentCatalog 里登记的子代理（有些不在 agentTeam.members 里）也挂到团队上
  const catalogChildren = toArray(asRecord(catalog.head)?.values)
    .map((value) => asRecord(value))
    .filter(Boolean)
    .map((value) => ({
      id: String(value.childId ?? ''),
      name: firstLine(textOf(value.label), 24) || '小助手',
    }))
    .filter((child) => child.id)
  const knownMembers = new Set(teamMembers.map((member) => member.id))
  for (const child of catalogChildren) {
    if (knownMembers.has(child.id)) continue
    knownMembers.add(child.id)
    teamMembers.push({ id: child.id, name: child.name })
  }

  const childIds = new Set()
  for (const child of catalogChildren) childIds.add(child.id)
  for (const member of teamMembers) childIds.add(member.id)
  for (const task of toArray(teamRow.tasks)) {
    const ownerId = asRecord(task)?.ownerId
    if (ownerId) childIds.add(String(ownerId))
  }

  // openStep 在步骤间隙会闪 null，不能作为“正在跑”的判据；
  // turnBoundary.openTurnStartSeq != null 才表示这一轮还没结束（实测可靠）。
  const openTurnStartSeq = turnBoundary.openTurnStartSeq
  const running = openTurnStartSeq !== null && openTurnStartSeq !== undefined
  const lastStepBoundaryKind = textOf(lastStepBoundary?.kind) || null
  const turnEnded = !running && lastStepBoundaryKind === 'end'
  // step 用真实步数（stats.steps / openStep.step）；turnBoundary.lastStepStartSeq 是事件序号，不是步数
  const step = toNumber(openStep?.step) || toNumber(stats.steps)

  const waitingText = questionTextOf(activeQuestions[0])
  const errorFlag =
    Boolean(goal.failure) ||
    (llmRetry !== null && Object.keys(llmRetry).length > 0) ||
    lastStepBoundary?.kind === 'error'

  const mtimeMs = toNumber(entry?.mtimeMs)
  const lastMessageTime = toNumber(timeContext.lastMessageTime)
  const lastPromptAt = toNumber(meta.lastPromptAt)
  const openStepStart = toNumber(openStep?.startTime)
  // 最近活动时间：优先真实消息时间；跑着的会话在装配时会用当前时间覆盖
  const baseActivityAt = Math.max(lastMessageTime, lastPromptAt, openStepStart) || mtimeMs

  const turns = toNumber(stats.turns)
  return {
    id,
    title,
    prompt,
    cwd,
    blank: Boolean(meta.blank),
    mtimeMs,
    stats,
    turns,
    steps: toNumber(stats.steps),
    step,
    openStep,
    running,
    turnEnded,
    lastStepBoundaryKind,
    lastPromptAt,
    waitingNow: activeQuestions.length > 0,
    waitingText: firstLine(waitingText, 24),
    teamMembers,
    childIds,
    todos: {
      total: todoList.length,
      done: todoList.filter((item) => asRecord(item)?.status === 'completed').length,
    },
    errorFlag,
    baseActivityAt,
  }
}

// ---------------------------------------------------------------------------
// 文件扫描 + 模型装配
// ---------------------------------------------------------------------------

/**
 * @param {ReturnType<typeof loadConfig>} config
 */
export function createStateReader(config) {
  const fileCache = new Map() // fullPath -> { mtimeMs, size, data }
  const track = new Map() // sessionId -> { wasRunning, lastSeenRunningAt, endedAt, seenAt }
  const petState = {
    mood: 'idle',
    since: Date.now(),
    successUntil: 0,
    microKind: null,
    microUntil: 0,
    nextMicroAt: Date.now() + IDLE_MICRO_MIN_MS,
  }

  let scanCache = null // { at, sessions }
  let metrics = {
    fileCount: 0,
    parsedCount: 0,
    lastScanAt: 0,
    lastError: null,
    scans: 0,
  }
  let lastWarnAt = 0

  function warn(message) {
    const now = Date.now()
    if (now - lastWarnAt < 5000) return // 坏文件很多时别刷屏
    lastWarnAt = now
    console.warn(`[state] ${message}`)
  }

  async function readOneFile(fullPath) {
    const fileStat = await stat(fullPath)
    const cached = fileCache.get(fullPath)
    if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
      return { data: cached.data, mtimeMs: fileStat.mtimeMs }
    }
    const text = await readFile(fullPath, 'utf8')
    let data = null
    try {
      data = JSON.parse(text)
    } catch (err) {
      warn(`会话文件 JSON 解析失败（已跳过）：${path.basename(fullPath)} — ${err.message}`)
      fileCache.delete(fullPath)
      return null
    }
    fileCache.set(fullPath, { mtimeMs: fileStat.mtimeMs, size: fileStat.size, data })
    return { data, mtimeMs: fileStat.mtimeMs }
  }

  async function scan(now) {
    if (scanCache && now - scanCache.at < config.stateCacheMs) return scanCache

    let names
    try {
      names = await readdir(config.projcacheDir)
    } catch (err) {
      metrics.lastError = err.message
      warn(`读取状态目录失败：${config.projcacheDir} — ${err.message}`)
      // 保留上次快照，避免一次 IO 抖动把办公室清空
      scanCache = { at: now, sessions: scanCache?.sessions ?? [] }
      return scanCache
    }

    const files = names
      .filter((name) => name.endsWith('.json') && !name.startsWith('.'))
      .slice(0, config.maxScanFiles)

    // 清理掉已经不存在的文件缓存（防止长期运行内存膨胀）
    if (fileCache.size > files.length + 64) {
      const alive = new Set(files.map((name) => path.join(config.projcacheDir, name)))
      for (const key of fileCache.keys()) {
        if (!alive.has(key)) fileCache.delete(key)
      }
    }

    const sessions = []
    await Promise.all(
      files.map(async (name) => {
        const fullPath = path.join(config.projcacheDir, name)
        try {
          const entry = await readOneFile(fullPath)
          if (!entry) return
          sessions.push(extractSession(entry, name))
        } catch (err) {
          // 单个坏文件/权限问题绝不影响整个服务
          warn(`读取会话文件失败（已跳过）：${name} — ${err.message}`)
        }
      }),
    )

    sessions.sort((a, b) => b.baseActivityAt - a.baseActivityAt)
    metrics = {
      ...metrics,
      fileCount: files.length,
      parsedCount: sessions.length,
      lastScanAt: now,
      scans: metrics.scans + 1,
    }
    scanCache = { at: now, sessions }
    return scanCache
  }

  // --- 状态推导 -----------------------------------------------------------

  function observe(session, now) {
    const previous = track.get(session.id) ?? {
      wasRunning: false,
      lastSeenRunningAt: 0,
      runningSince: 0,
      endedAt: null,
      seenAt: 0,
      lastStatus: 'idle',
    }
    let justEndedAt = null

    if (session.running) {
      if (!previous.wasRunning) {
        // “这一轮已经忙了多久”的锚点：优先本轮用户 prompt 时间（跨 bridge 重启也准），
        // 其次当前 step 开始时间；最多回看 6 小时，避免异常数据算出离谱时长。
        const promptAt = toNumber(session.lastPromptAt)
        const stepStart = toNumber(session.openStep?.startTime)
        const anchor = promptAt || stepStart || now
        previous.runningSince = Math.max(anchor, now - 6 * 3600_000)
      }
      previous.wasRunning = true
      previous.lastSeenRunningAt = now
      previous.endedAt = null
    } else if (previous.wasRunning) {
      // 上一轮还看到在跑，这一轮 turnBoundary 已关闭：把最后一次“看到在跑”的时刻当结束点
      previous.wasRunning = false
      previous.runningSince = 0
      if (session.turnEnded) {
        justEndedAt = previous.lastSeenRunningAt || now
        previous.endedAt = justEndedAt
      } else {
        previous.endedAt = null
      }
    } else if (previous.endedAt === null) {
      // bridge 启动前就已经结束的会话：确实跑完过（boundary=end），且文件 60 秒内更新过
      if (session.turnEnded && session.turns > 0 && now - session.mtimeMs <= SUCCESS_WINDOW_MS) {
        previous.endedAt = session.mtimeMs
      }
    }

    previous.seenAt = now
    track.set(session.id, previous)

    let status = 'idle'
    if (session.waitingNow) status = 'waiting'
    else if (session.running) status = 'working'
    else if (session.errorFlag) status = 'error'
    else if (previous.endedAt !== null && now - previous.endedAt <= SUCCESS_WINDOW_MS) {
      status = 'success'
    }

    return { status, justEndedAt, elapsedStart: previous.runningSince || now }
  }

  function activityFor(session, status) {
    const step = session.step
    if (status === 'waiting') {
      return session.waitingText ? `在等你确认 · ${session.waitingText}` : '在等你确认'
    }
    if (status === 'working') {
      // openStep 在步骤间隙会闪 null，有 openStep 时才细分“思考/调工具”
      if (session.openStep && session.openStep.firstTokenTime == null) {
        return `正在思考 · 第 ${step} 步`
      }
      return session.lastStepBoundaryKind === 'start'
        ? `正在调用工具 · 第 ${step} 步`
        : `正在认真工作 · 第 ${step} 步`
    }
    if (status === 'success') return '刚刚完成一项任务'
    if (status === 'error') return '遇到一点问题'
    return '正在休息'
  }

  function sessionWire(session, observed, byId, now) {
    const elapsedSec = session.running
      ? Math.max(0, Math.floor((now - toNumber(observed.elapsedStart)) / 1000))
      : 0
    const team = session.teamMembers.map((member) => {
      const child = byId.get(member.id)
      let state = 'idle'
      if (child) {
        if (child.session.running) state = 'running'
        else if (child.observed.status === 'waiting') state = 'waiting'
        else if (child.observed.status === 'success') state = 'success'
      }
      return { name: member.name, role: 'teammate', state }
    })
    return {
      id: session.id,
      title: session.title,
      running: session.running,
      status: observed.status,
      elapsedSec,
      step: session.step,
      turns: session.turns,
      activity: activityFor(session, observed.status),
      lastActivityAt: session.running ? now : session.baseActivityAt,
      todos: { done: session.todos.done, total: session.todos.total },
      team,
    }
  }

  function computeMood(wireSessions, now) {
    if (wireSessions.some((session) => session.status === 'waiting')) return 'waiting'

    const running = wireSessions.filter((session) => session.running)
    if (running.length > 0) {
      // 还没有任何 token 的步骤 = 模型正在想；已经有 token = 在干活/调工具
      return running.some((session) => session.openStep?.firstTokenTime == null)
        ? 'thinking'
        : 'working'
    }

    if (now < petState.successUntil) return 'success'

    // 闲着也要有生命感：约 25~40 秒打一次哈欠 / 伸个懒腰
    if (now >= petState.nextMicroAt) {
      petState.microKind = Math.random() < 0.55 ? 'idle_yawn' : 'idle_stretch'
      petState.microUntil = now + 2600 + Math.floor(Math.random() * 1600)
      petState.nextMicroAt =
        now + IDLE_MICRO_MIN_MS + Math.floor(Math.random() * (IDLE_MICRO_MAX_MS - IDLE_MICRO_MIN_MS))
    }
    if (now < petState.microUntil) return petState.microKind
    return 'idle'
  }

  function buildWorkspaces(wireSessions) {
    const groups = new Map()
    for (const item of wireSessions) {
      const cwd = item.session.cwd || '(未知工作区)'
      if (!groups.has(cwd)) groups.set(cwd, [])
      groups.get(cwd).push(item)
    }

    const baseCount = new Map()
    for (const cwd of groups.keys()) {
      const base = workspaceBaseName(cwd)
      baseCount.set(base, (baseCount.get(base) ?? 0) + 1)
    }

    const usedIds = new Set()
    const workspaces = []
    for (const [cwd, items] of groups) {
      let name = workspaceBaseName(cwd)
      if ((baseCount.get(name) ?? 0) > 1) {
        const parts = cwd.split(/[\\/]+/u).filter(Boolean)
        if (parts.length >= 2) name = `${parts.at(-2)}/${parts.at(-1)}`
      }
      let id = slugify(name)
      if (usedIds.has(id)) {
        let suffix = 2
        while (usedIds.has(`${id}-${suffix}`)) suffix += 1
        id = `${id}-${suffix}`
      }
      usedIds.add(id)
      workspaces.push({
        id,
        name,
        cwd,
        sessions: items.map((item) => item.wire),
      })
    }
    return workspaces
  }

  async function read() {
    const now = Date.now()
    const snapshot = await scan(now)

    const byId = new Map()
    for (const session of snapshot.sessions) {
      byId.set(session.id, { session, observed: observe(session, now) })
    }

    // 只展示“顶层”会话：被登记为 teammate/子代理的 session 不单独占工位，
    // 它会出现在父会话的 team 列表里。
    const childIds = new Set()
    for (const session of snapshot.sessions) {
      for (const childId of session.childIds) childIds.add(childId)
    }

    // 最近活动时间：跑着的会话就是“现在”，否则用消息/提问/文件更新时间
    const activityAt = (session) => (session.running ? now : session.baseActivityAt)
    const recentCutoff = now - config.recentHours * 3600_000
    const visible = snapshot.sessions
      .filter((session) => !childIds.has(session.id))
      .filter((session) => !session.blank || session.running)
      .filter((session) => session.running || activityAt(session) >= recentCutoff)

    // 每个工作区最多 N 个工位（电视页面按工作区分组渲染），再全局按最近活动倒序取前 24
    const byWorkspace = new Map()
    for (const session of visible) {
      const cwd = session.cwd || '(未知工作区)'
      if (!byWorkspace.has(cwd)) byWorkspace.set(cwd, [])
      byWorkspace.get(cwd).push(session)
    }
    const topLevel = [...byWorkspace.values()]
      .flatMap((sessions) =>
        sessions
          .sort((a, b) => activityAt(b) - activityAt(a))
          .slice(0, config.maxSessionsPerWorkspace),
      )
      .sort((a, b) => activityAt(b) - activityAt(a))
      .slice(0, config.maxSessions)

    const wired = topLevel.map((session) => {
      const entry = byId.get(session.id)
      return {
        session,
        observed: entry.observed,
        wire: sessionWire(session, entry.observed, byId, now),
      }
    })

    // 刚有任务结束 → 让鲸鱼娘播一次 success
    if (
      wired.some(
        (item) => item.observed.justEndedAt && now - item.observed.justEndedAt <= 15_000,
      )
    ) {
      petState.successUntil = now + PET_SUCCESS_MS
    }

    let mood = computeMood(
      wired.map((item) => item.wire),
      now,
    )
    if (mood !== petState.mood) {
      petState.mood = mood
      petState.since = now
    }

    const wireList = wired.map((item) => item.wire)
    return {
      ts: now,
      pet: { mood: petState.mood, since: petState.since },
      stats: {
        sessions: wireList.length,
        running: wireList.filter((session) => session.status === 'working').length,
        teammates: wireList.reduce(
          (total, session) =>
            total +
            session.team.filter(
              (member) => member.state === 'running' || member.state === 'waiting',
            ).length,
          0,
        ),
      },
      workspaces: buildWorkspaces(wired),
    }
  }

  return {
    read,
    getMetrics: () => ({ ...metrics, cacheFiles: fileCache.size }),
    getConfig: () => config,
  }
}

function workspaceBaseName(cwd) {
  const normalized = String(cwd || '').replace(/[\\/]+$/u, '')
  if (!normalized) return '未知工作区'
  if (normalized === os.homedir()) return '~'
  const base = path.basename(normalized)
  return base || normalized
}

function slugify(name) {
  const slug = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return slug || 'workspace'
}

/** 把办公室模型压成一段中文摘要，注入 LLM system prompt / 调试日志 */
export function summarizeOffice(model) {
  const sessions = flattenSessions(model)
  if (sessions.length === 0) return '办公室现在一个会话都没有，安静得能听见鲸鱼吐泡泡。'

  const running = sessions.filter((session) => session.status === 'working')
  const waiting = sessions.filter((session) => session.status === 'waiting')
  const success = sessions.filter((session) => session.status === 'success')
  const idle = sessions.filter((session) => session.status === 'idle')
  const parts = [
    `办公室共有 ${sessions.length} 个会话，分布在 ${(model.workspaces ?? []).length} 个工作区。`,
  ]

  if (running.length > 0) {
    const detail = running
      .slice(0, 6)
      .map((session) => {
        const team = session.team
          .filter((member) => member.state === 'running')
          .map((member) => member.name)
        const todos = session.todos?.total
          ? `，待办 ${session.todos.done}/${session.todos.total}`
          : ''
        const teamText = team.length ? `，团队成员 ${team.join('、')} 在忙` : ''
        return `「${session.title}」已工作 ${formatDuration(session.elapsedSec)}（第 ${session.step} 步${todos}${teamText}）`
      })
      .join('；')
    parts.push(`正在工作：${detail}。`)
  }
  if (waiting.length > 0) {
    parts.push(`等待确认：${waiting.slice(0, 3).map((session) => `「${session.title}」`).join('、')}。`)
  }
  if (success.length > 0) {
    parts.push(`最近完成：${success.slice(0, 3).map((session) => `「${session.title}」`).join('、')}。`)
  }
  if (idle.length > 0) {
    parts.push(`正在休息：${idle.slice(0, 3).map((session) => `「${session.title}」`).join('、')}。`)
  }
  const teammateNames = new Set()
  for (const session of sessions) {
    for (const member of session.team) teammateNames.add(member.name)
  }
  if (teammateNames.size > 0) {
    parts.push(`办公室里的团队成员：${[...teammateNames].slice(0, 12).join('、')}。`)
  }
  return parts.join('\n')
}

/** 给 narration 用的小工具：把模型里的会话摊平并带上工作区名 */
export function flattenSessions(model) {
  const flat = []
  for (const workspace of model?.workspaces ?? []) {
    for (const session of workspace.sessions ?? []) {
      flat.push({ ...session, workspace: workspace.name })
    }
  }
  return flat
}

export { pick, hashSeed }
