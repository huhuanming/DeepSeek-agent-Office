// server.mjs — DSH Office TV 的 Mac 端 bridge
//
// 零依赖：只用 node: 内置模块（node:http / node:fs / node:dgram / node:os / node:path）。
//
// 职责（见 CONTRACT.md 第 2、3 节）：
//   GET  /health                       健康检查
//   GET  /api/state                    办公室实时状态（2 秒轮询，no-store）
//   POST /api/chat                     鲸鱼娘对话 / 实时解说（无 key 时 narration）
//   GET  /api/pet                      鲸鱼娘帧索引
//   GET  /pet/<clip>/<frame>.webp      鲸鱼娘逐帧 webp（长缓存、防目录穿越）
//   GET  /                            302 → /tv
//   静态  /tv /app.js /style.css ...   由 bridge/web/ 提供
//   UDP  8766                          响应 "DSH_OFFICE_TV?" 发现请求
//
// 运行：node bridge/server.mjs   （PORT / PET_DIR 等环境变量可覆盖 config.json）

import http from 'node:http'
import dgram from 'node:dgram'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  BRIDGE_NAME,
  BRIDGE_VERSION,
  createStateReader,
  loadConfig,
} from './state.mjs'
import { createAssetService } from './assets.mjs'
import { createChatService } from './chat.mjs'
import { createTtsService } from './tts.mjs'

const DISCOVERY_REQUEST = 'DSH_OFFICE_TV?'
const DISCOVERY_RESPONSE_PREFIX = 'DSH_OFFICE_TV!'
const MAX_BODY_BYTES = 64 * 1024

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.map': 'application/json; charset=utf-8',
}

const config = loadConfig()
const tts = createTtsService(config.tts)
const stateReader = createStateReader(config)
const assets = createAssetService(config)
const chat = createChatService(config)

let lastGoodModel = null
let petIndexBuffer = null
let petIndexAt = 0
const PET_INDEX_TTL_MS = 60_000

// ---------------------------------------------------------------------------
// 响应工具
// ---------------------------------------------------------------------------

function sendBuffer(req, res, status, contentType, body, headers = {}) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8')
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  res.end(buffer)
}

function sendJson(req, res, status, value, headers = {}) {
  const body = JSON.stringify(value)
  sendBuffer(req, res, status, 'application/json; charset=utf-8', body, {
    'Cache-Control': 'no-store, max-age=0',
    ...headers,
  })
}

function sendText(req, res, status, text, headers = {}) {
  sendBuffer(req, res, status, 'text/plain; charset=utf-8', `${text}\n`, {
    'Cache-Control': 'no-store, max-age=0',
    ...headers,
  })
}

function friendlyNotFound(req, res, detail = '') {
  const lines = [
    '这里没有你要找的东西～',
    detail || '试试打开 /tv 看办公室，或者 /health 看看 bridge 还活着没有。',
  ]
  sendText(req, res, 404, lines.join('\n'))
}

// ---------------------------------------------------------------------------
// 请求体 & 路径工具
// ---------------------------------------------------------------------------

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('请求体太大'), { statusCode: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function parseJsonBody(req) {
  let raw = ''
  try {
    raw = await readRequestBody(req)
  } catch (err) {
    if (err.statusCode === 413) return { body: null, error: err }
    return { body: {}, error: null }
  }
  if (!raw.trim()) return { body: {}, error: null }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { body: parsed, error: null }
    }
    return { body: {}, error: null }
  } catch {
    // JSON 解析失败要容错：当成空请求，返回 200 + 一句可爱提示
    return { body: {}, error: 'invalid-json' }
  }
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------

async function handleRequest(req, res) {
  const method = req.method || 'GET'
  const rawUrl = req.url || '/'

  let url
  try {
    url = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`)
  } catch {
    sendText(req, res, 400, '请求地址不合法')
    return
  }
  const pathname = safeDecode(url.pathname)
  if (pathname === null) {
    sendText(req, res, 400, '请求地址编码不合法')
    return
  }
  const isRead = method === 'GET' || method === 'HEAD'

  // --- 健康检查 -----------------------------------------------------------
  if (pathname === '/health') {
    if (!isRead) return sendText(req, res, 405, '只支持 GET')
    sendJson(req, res, 200, { ok: true, name: BRIDGE_NAME, version: BRIDGE_VERSION })
    return
  }

  // --- 办公室状态 ---------------------------------------------------------
  if (pathname === '/api/state') {
    if (!isRead) return sendText(req, res, 405, '只支持 GET')
    try {
      const model = await stateReader.read()
      lastGoodModel = model
      sendJson(req, res, 200, model)
    } catch (err) {
      console.error(`[http] /api/state 计算失败：${err.message}`)
      if (lastGoodModel) {
        sendJson(req, res, 200, lastGoodModel)
      } else {
        sendJson(req, res, 500, { error: 'state_unavailable', message: '状态暂时读不到，稍后再试' })
      }
    }
    return
  }

  // --- 鲸鱼娘对话 ---------------------------------------------------------
  if (pathname === '/api/chat') {
    if (method !== 'POST') return sendText(req, res, 405, '请用 POST 访问 /api/chat')
    let parsedBody
    try {
      parsedBody = await parseJsonBody(req)
    } catch (err) {
      sendText(req, res, 500, '读取请求失败，请再试一次')
      return
    }
    const { body, error } = parsedBody
    let model = lastGoodModel
    try {
      model = await stateReader.read()
      lastGoodModel = model
    } catch (err) {
      console.error(`[http] /api/chat 读取状态失败：${err.message}`)
      if (!model) model = { ts: Date.now(), pet: { mood: 'idle', since: Date.now() }, stats: { sessions: 0, running: 0, teammates: 0 }, workspaces: [] }
    }
    const question = typeof body?.question === 'string' ? body.question : ''
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
    try {
      const result = await chat.answer(question, model, { sessionId })
      const reply = error === 'invalid-json'
        ? '小朋友，我刚才没听清，你再说一遍好不好～'
        : result.reply
      sendJson(req, res, 200, { reply, speak: error === 'invalid-json' ? reply : result.speak, source: result.source })
    } catch (err) {
      console.error(`[http] /api/chat 失败：${err.message}`)
      sendJson(req, res, 200, {
        reply: '哎呀，我刚刚走神了，你再说一次好不好～',
        speak: '哎呀，我刚刚走神了，你再说一次好不好～',
        source: 'narration',
      })
    }
    return
  }

  // --- 鲸鱼娘语音合成（edge-tts → mp3，磁盘缓存） -------------------------
  if (pathname === '/api/tts') {
    if (!isRead) return sendText(req, res, 405, '只支持 GET')
    const text = (url.searchParams.get('text') || '').trim()
    const voiceOverride = (url.searchParams.get('voice') || '').trim()
    if (!text) return sendText(req, res, 400, '缺少 text 参数')
    try {
      const mp3 = await tts.speak(text, voiceOverride || undefined)
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Content-Length': mp3.length,
        'Cache-Control': 'public, max-age=604800',
        'X-Tts-Voice': voiceOverride || tts.voice,
      })
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      res.end(mp3)
    } catch (err) {
      console.warn(`[http] /api/tts 失败：${err.message}`)
      sendText(req, res, 503, 'tts_unavailable')
    }
    return
  }

  // --- 鲸鱼娘帧索引 -------------------------------------------------------
  if (pathname === '/api/pet') {
    if (!isRead) return sendText(req, res, 405, '只支持 GET')
    try {
      const now = Date.now()
      if (!petIndexBuffer || now - petIndexAt > PET_INDEX_TTL_MS) {
        const index = await assets.getIndex()
        petIndexBuffer = Buffer.from(JSON.stringify(index), 'utf8')
        petIndexAt = now
      }
      sendBuffer(req, res, 200, 'application/json; charset=utf-8', petIndexBuffer, {
        'Cache-Control': 'no-store, max-age=0',
      })
    } catch (err) {
      console.error(`[http] /api/pet 失败：${err.message}`)
      sendJson(req, res, 200, { baseSize: 412, maxFrameWidth: 412, maxFrameHeight: 344, fps: 24, clips: {} })
    }
    return
  }

  // --- 鲸鱼娘帧图片 -------------------------------------------------------
  if (pathname.startsWith('/pet/')) {
    if (!isRead) return sendText(req, res, 405, '只支持 GET')
    const segments = pathname.split('/').filter(Boolean) // ['pet', clip, frame]
    if (segments.length !== 3) return friendlyNotFound(req, res, '鲸鱼娘帧地址不对哦。')
    const [, clip, frame] = segments
    const framePath = assets.resolveFrame(clip, frame)
    if (!framePath) {
      return friendlyNotFound(req, res, '鲸鱼娘帧地址不对哦。')
    }
    let fileStat
    try {
      fileStat = await stat(framePath)
    } catch {
      return friendlyNotFound(req, res, `鲸鱼娘没有这一帧：${clip}/${frame}`)
    }
    if (!fileStat.isFile()) return friendlyNotFound(req, res, '鲸鱼娘帧不是一个文件。')
    res.writeHead(200, {
      'Content-Type': 'image/webp',
      'Content-Length': fileStat.size,
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    const stream = createReadStream(framePath)
    stream.on('error', (err) => {
      console.error(`[http] 读取鲸鱼娘帧失败：${err.message}`)
      res.destroy()
    })
    stream.pipe(res)
    return
  }

  // --- 根路径跳电视页 -----------------------------------------------------
  if (pathname === '/' || pathname === '') {
    if (!isRead) return sendText(req, res, 405, '只支持 GET')
    res.writeHead(302, { Location: '/tv', 'Cache-Control': 'no-store, max-age=0' })
    res.end()
    return
  }

  if (pathname === '/favicon.ico') {
    res.writeHead(204)
    res.end()
    return
  }

  if (!isRead) {
    sendText(req, res, 405, '这个地址只支持 GET')
    return
  }

  // --- 静态文件（bridge/web/） --------------------------------------------
  const relativePath = pathname === '/tv' ? 'index.html' : pathname.replace(/^\/+/u, '')
  if (!relativePath || relativePath.includes('\0') || relativePath.split('/').includes('..')) {
    return friendlyNotFound(req, res)
  }
  const filePath = path.resolve(config.webDir, relativePath)
  if (filePath !== config.webDir && !filePath.startsWith(config.webDir + path.sep)) {
    return friendlyNotFound(req, res)
  }

  let fileStat
  try {
    fileStat = await stat(filePath)
  } catch {
    if (pathname === '/tv') {
      return sendText(
        req,
        res,
        404,
        [
          '电视网页还没装好～',
          `bridge 还活着，但 ${config.webDir}/index.html 还不存在。`,
          '等 web-scene-builder 把 bridge/web/ 交付后刷新这个地址就好。',
        ].join('\n'),
        { 'Retry-After': '30' },
      )
    }
    return friendlyNotFound(req, res)
  }
  if (fileStat.isDirectory()) {
    return friendlyNotFound(req, res, '这是一个目录，不是网页。')
  }

  const extension = path.extname(filePath).toLowerCase()
  const contentType = MIME_TYPES[extension] || 'application/octet-stream'
  const cacheControl =
    extension === '.html' || extension === '.htm'
      ? 'no-cache'
      : 'public, max-age=3600'
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': fileStat.size,
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  const stream = createReadStream(filePath)
  stream.on('error', (err) => {
    console.error(`[http] 读取静态文件失败：${err.message}`)
    res.destroy()
  })
  stream.pipe(res)
}

// ---------------------------------------------------------------------------
// 网络地址 / UDP 发现
// ---------------------------------------------------------------------------

function interfacePriority(address) {
  if (address.startsWith('192.168.')) return 0
  if (address.startsWith('10.')) return 1
  const match = /^172\.(\d+)\./u.exec(address)
  if (match) {
    const octet = Number(match[1])
    if (octet >= 16 && octet <= 31) return 2
  }
  if (address.startsWith('169.254.')) return 8
  if (address.startsWith('127.')) return 9
  return 5
}

function listIPv4Addresses() {
  const addresses = []
  const interfaces = os.networkInterfaces()
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue
      if (entry.family !== 'IPv4' && entry.family !== 4) continue
      if (!entry.address || entry.address.startsWith('127.')) continue
      addresses.push({ name, address: entry.address })
    }
  }
  addresses.sort((a, b) => {
    const diff = interfacePriority(a.address) - interfacePriority(b.address)
    return diff !== 0 ? diff : a.address.localeCompare(b.address)
  })
  return addresses
}

function preferredAddress(addresses) {
  return addresses[0]?.address ?? '127.0.0.1'
}

function setupDiscovery() {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  let bound = false

  socket.on('message', (message, remote) => {
    const text = message.toString('utf8').trim()
    if (text !== DISCOVERY_REQUEST) return
    const addresses = listIPv4Addresses()
    const ip = preferredAddress(addresses)
    const reply = `${DISCOVERY_RESPONSE_PREFIX}http://${ip}:${config.port}/tv`
    socket.send(Buffer.from(reply, 'utf8'), remote.port, remote.address, (err) => {
      if (err) {
        console.warn(`[udp] 回复发现请求失败：${err.message}`)
      } else {
        console.log(`[udp] 发现请求来自 ${remote.address}:${remote.port} → ${reply}`)
      }
    })
  })

  socket.on('error', (err) => {
    console.warn(`[udp] 发现服务异常（HTTP 不受影响）：${err.message}`)
    try {
      socket.close()
    } catch {
      /* 已经关了 */
    }
  })

  socket.on('listening', () => {
    bound = true
    try {
      socket.setBroadcast(true)
    } catch {
      /* 某些网卡不支持广播，忽略 */
    }
    console.log(`[udp] 发现服务监听 0.0.0.0:${config.discoveryPort}（等待 "${DISCOVERY_REQUEST}"）`)
  })

  socket.bind(config.discoveryPort, '0.0.0.0')
  return {
    close: () => {
      if (!bound) return
      try {
        socket.close()
      } catch {
        /* 忽略 */
      }
    },
  }
}

// ---------------------------------------------------------------------------
// 启动 / 关闭
// ---------------------------------------------------------------------------

function logStartup(addresses) {
  const metrics = stateReader.getMetrics()
  const petExists = assets.getFrameCounts()
  const key = process.env[config.apiKeyEnv] || config.apiKey
  const lines = [
    '',
    '┌──────────────────────────────────────────────┐',
    `│  ${BRIDGE_NAME}  bridge v${BRIDGE_VERSION}  ·  Node ${process.version}  │`,
    '└──────────────────────────────────────────────┘',
    `HTTP 监听        http://${config.host}:${config.port}  （PID ${process.pid}）`,
    `电视地址        ${addresses.length > 0 ? addresses.map((item) => `http://${item.address}:${config.port}/tv`).join('\n                ') : `http://127.0.0.1:${config.port}/tv（只找到 loopback）`}`,
    `状态目录        ${config.projcacheDir}`,
    `状态文件数      ${metrics.fileCount} 个（解析成功 ${metrics.parsedCount} 个）`,
    `素材目录        ${config.petDir}`,
    `素材状态        ${Object.keys(petExists).length > 0 ? '可用 ✓' : '未找到 ✗（/pet 会 404）'}`,
    `电视网页目录    ${config.webDir}`,
    `鲸鱼娘对话      ${key ? 'LLM 模式（已配置 ' + config.apiKeyEnv + '）' : 'narration 模式（未配置 ' + config.apiKeyEnv + '）'}`,
    `鲸鱼娘语音      ${tts.available() ? 'edge-tts 中文神经语音（' + tts.voice + '）' : '未启用（网页回退系统 TTS）'}`,
    `UDP 发现        ${config.discoveryPort}（收到 "${DISCOVERY_REQUEST}" 回 "DSH_OFFICE_TV!http://<内网IP>:${config.port}/tv"）`,
    `静态文件        ${config.webDir}/index.html → GET /tv`,
    '',
  ]
  console.log(lines.join('\n'))
}

function createServer() {
  const server = http.createServer((req, res) => {
    const startedAt = process.hrtime.bigint()
    const method = req.method || 'GET'
    const requestPath = req.url || '/'

    let finished = false
    const logRequest = () => {
      if (finished) return
      finished = true
      const ms = Number(process.hrtime.bigint() - startedAt) / 1e6
      const remote = req.socket?.remoteAddress ?? '-'
      const status = res.statusCode
      const level = status >= 500 ? 'ERR ' : status >= 400 ? 'WARN' : 'OK  '
      console.log(`[http] ${level} ${method} ${requestPath} ${status} ${ms.toFixed(1)}ms ${remote}`)
    }
    res.on('finish', logRequest)
    res.on('close', logRequest)

    Promise.resolve()
      .then(() => handleRequest(req, res))
      .catch((err) => {
        console.error(`[http] 请求处理异常：${method} ${requestPath} — ${err.stack || err.message}`)
        if (!res.headersSent) {
          sendText(req, res, 500, '哎呀，bridge 打了个喷嚏。请稍后再试～')
        } else {
          res.destroy()
        }
      })
  })

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[bridge] 端口 ${config.port} 已被占用。先停掉旧进程，或换端口：PORT=8766 node bridge/server.mjs`)
    } else {
      console.error(`[bridge] HTTP 服务启动失败：${err.message}`)
    }
    process.exit(1)
  })

  server.keepAliveTimeout = 65_000
  server.headersTimeout = 70_000
  return server
}

async function main() {
  const addresses = listIPv4Addresses()

  // 预热一次状态，启动日志里能看到真实文件数；失败也不阻塞启动
  try {
    lastGoodModel = await stateReader.read()
    await assets.getIndex()
  } catch (err) {
    console.warn(`[bridge] 启动预热失败（服务继续）：${err.message}`)
  }

  const server = createServer()
  const discovery = setupDiscovery()
  logStartup(addresses)

  server.listen(config.port, config.host, () => {
    console.log(`[bridge] 已就绪，打开 http://localhost:${config.port}/tv 或电视上的地址。Ctrl+C 退出。`)
  })

  let closing = false
  const shutdown = (signal) => {
    if (closing) return
    closing = true
    console.log(`\n[bridge] 收到 ${signal}，正在优雅退出…`)
    discovery.close()
    server.close(() => {
      console.log('[bridge] HTTP 已关闭')
    })
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections()
    const forceTimer = setTimeout(() => {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
      console.log('[bridge] 退出。')
      process.exit(0)
    }, 600)
    forceTimer.unref()
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  // 电视服务要皮实：单个异常不让整个 bridge 挂掉
  process.on('uncaughtException', (err) => {
    console.error(`[bridge] 未捕获异常（服务继续运行）：${err.stack || err.message}`)
  })
  process.on('unhandledRejection', (reason) => {
    console.error(`[bridge] 未处理的 Promise 拒绝（服务继续运行）：${reason?.stack || reason}`)
  })
}

main().catch((err) => {
  console.error(`[bridge] 启动失败：${err.stack || err.message}`)
  process.exit(1)
})
