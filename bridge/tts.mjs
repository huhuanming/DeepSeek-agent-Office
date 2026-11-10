// tts.mjs — 鲸鱼娘语音合成（edge-tts 中文神经语音）
//
// 设计：
//   - 调本机 venv 里的 edge-tts（微软神经语音，中文自然度好，免费，个人使用）
//   - 生成的 mp3 按 (voice + text) 的 sha1 缓存在磁盘，同一句只合成一次
//   - 同一句并发请求去重
//   - 失败时抛错，由 HTTP 层返回 503，网页端回退到 Android 系统 TTS
//   - 关掉：config.tts.enabled = false 或环境变量 TTS_ENABLED=0
//
// 安装语音引擎：tools/setup-tts.sh（会在 ~/.dsh-office-tts/venv 装 edge-tts）

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_VOICE = 'zh-CN-XiaoyiNeural'

export function createTtsService(ttsConfig = {}) {
  const enabled = ttsConfig?.enabled !== false
  const voice = typeof ttsConfig?.voice === 'string' && ttsConfig.voice ? ttsConfig.voice : DEFAULT_VOICE
  const bin = ttsConfig?.bin || ''
  const cacheDir = ttsConfig?.cacheDir || ''
  const timeoutMs = Number(ttsConfig?.timeoutMs) > 0 ? Number(ttsConfig.timeoutMs) : 12_000
  const maxChars = Number(ttsConfig?.maxChars) > 0 ? Number(ttsConfig.maxChars) : 200

  /** @type {Map<string, Promise<Buffer>>} */
  const inflight = new Map()
  let cacheReady = false

  function binAvailable() {
    return Boolean(bin) && existsSync(bin)
  }

  function hashOf(text, v) {
    return createHash('sha1').update(`${v}\n${text}`).digest('hex')
  }

  async function ensureCacheDir() {
    if (cacheReady || !cacheDir) return
    await mkdir(cacheDir, { recursive: true })
    cacheReady = true
  }

  function runEdgeTts(text, outPath) {
    return new Promise((resolve, reject) => {
      const child = spawn(bin, ['--voice', voice, '--text', text, '--write-media', outPath], {
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      let stderr = ''
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`tts 超时（>${timeoutMs}ms）`))
      }, timeoutMs)
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk || '')
        if (stderr.length > 4000) stderr = stderr.slice(-4000)
      })
      child.once('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
      child.once('close', (code) => {
        clearTimeout(timer)
        if (code === 0) resolve()
        else reject(new Error(`edge-tts 退出码 ${code}：${stderr.slice(-300)}`))
      })
    })
  }

  /**
   * 合成一句中文语音，返回 mp3 Buffer。
   * @param {string} rawText
   * @param {string} [voiceOverride]
   */
  async function speak(rawText, voiceOverride) {
    if (!enabled) throw new Error('tts 已关闭')
    if (!binAvailable()) throw new Error(`找不到 edge-tts：${bin}`)
    const text = String(rawText ?? '')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, maxChars)
    if (!text) throw new Error('空文本')

    const v = voiceOverride || voice
    await ensureCacheDir()
    const key = hashOf(text, v)
    const filePath = cacheDir ? path.join(cacheDir, `${key}.mp3`) : ''

    if (filePath) {
      try {
        return await readFile(filePath)
      } catch {
        /* 缓存未命中，继续合成 */
      }
    }

    const existing = inflight.get(key)
    if (existing) return existing

    const task = (async () => {
      const tmpPath = filePath
        ? `${filePath}.${process.pid}.${Date.now()}.tmp`
        : path.join(process.env.TMPDIR || '/tmp', `dsh-office-tts-${process.pid}-${Date.now()}.mp3`)
      try {
        await runEdgeTts(text, tmpPath)
        const buffer = await readFile(tmpPath)
        if (!buffer.length) throw new Error('edge-tts 输出为空')
        if (filePath) {
          await rename(tmpPath, filePath).catch(async () => {
            // rename 跨设备失败时退化为复制
            await writeFile(filePath, buffer)
            await unlink(tmpPath).catch(() => {})
          })
        } else {
          await unlink(tmpPath).catch(() => {})
        }
        return buffer
      } finally {
        await unlink(tmpPath).catch(() => {})
      }
    })()

    inflight.set(key, task)
    try {
      return await task
    } finally {
      inflight.delete(key)
    }
  }

  return {
    speak,
    voice,
    bin,
    cacheDir,
    available: () => enabled && binAvailable(),
  }
}
