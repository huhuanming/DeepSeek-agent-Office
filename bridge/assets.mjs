// assets.mjs — 鲸鱼娘逐帧动画素材服务
//
// 素材来自桌面版桌宠插件：<petDir>/<clip>/<clip>_001.webp ...
// 清单来自 petDir 同级的 pet-manifest.json（含 baseSize / fps / 帧顺序）。
// 只暴露 CONTRACT 第 3 节要求的 /api/pet 索引 + /pet/<clip>/<frame> 图片流，
// 对 clip/frame 做白名单 + 路径穿越校验，图片走长缓存。

import { readdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const CLIP_PATTERN = /^[a-z0-9_]+$/u
const FRAME_PATTERN = /^[a-z0-9_]+\.webp$/u
const FALLBACK_BASE_SIZE = 412
const FALLBACK_MAX_WIDTH = 412
const FALLBACK_MAX_HEIGHT = 344
const FALLBACK_FPS = 24

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function toNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

/**
 * @param {ReturnType<import('./state.mjs').loadConfig>} config
 */
export function createAssetService(config) {
  const root = path.resolve(config.petDir)
  const manifestPath = path.resolve(root, '..', 'pet-manifest.json')
  const exposedClips = new Set(config.exposedClips)
  let indexPromise = null
  let clipFrameCounts = null

  async function readManifest() {
    let manifest = null
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch (err) {
      console.warn(`[assets] 读取 pet-manifest.json 失败，改为扫描目录：${err.message}`)
    }

    const clips = {}
    const counts = {}

    if (manifest && asRecord(manifest.clips)) {
      for (const [clip, info] of Object.entries(manifest.clips)) {
        const frames = Array.isArray(info?.frames) ? info.frames : []
        if (frames.length === 0) continue
        clips[clip] = frames
          .map((frame) => path.basename(String(frame)))
          .filter((frame) => FRAME_PATTERN.test(frame))
          .map((frame) => `/pet/${clip}/${frame}`)
        counts[clip] = clips[clip].length
      }
    } else {
      // 没有清单时的兜底：直接列目录
      let entries = []
      try {
        entries = await readdir(root, { withFileTypes: true })
      } catch (err) {
        console.warn(`[assets] 素材目录不可读：${root} — ${err.message}`)
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || !CLIP_PATTERN.test(entry.name)) continue
        const dir = path.join(root, entry.name)
        let files = []
        try {
          files = await readdir(dir)
        } catch {
          continue
        }
        const frames = files.filter((file) => FRAME_PATTERN.test(file)).sort()
        if (frames.length === 0) continue
        clips[entry.name] = frames.map((frame) => `/pet/${entry.name}/${frame}`)
        counts[entry.name] = frames.length
      }
    }

    const chosen = {}
    for (const clip of config.exposedClips) {
      if (clips[clip]?.length) chosen[clip] = clips[clip]
    }
    // config 里没列、但清单里存在的 clip 也兜底带上（避免网页请求新 clip 时 404 一片）
    for (const [clip, frames] of Object.entries(clips)) {
      if (!chosen[clip] && exposedClips.has(clip)) chosen[clip] = frames
    }

    const model = {
      baseSize: toNumber(manifest?.baseSize, FALLBACK_BASE_SIZE),
      maxFrameWidth: toNumber(manifest?.maxFrameWidth, FALLBACK_MAX_WIDTH),
      maxFrameHeight: toNumber(manifest?.maxFrameHeight, FALLBACK_MAX_HEIGHT),
      fps: toNumber(asRecord(manifest?.assetSource)?.fps, FALLBACK_FPS),
      clips: chosen,
    }
    clipFrameCounts = counts
    return model
  }

  function getIndex() {
    if (!indexPromise) indexPromise = readManifest()
    return indexPromise
  }

  /** 校验并解析 /pet/<clip>/<frame> 的真实磁盘路径；不合法返回 null */
  function resolveFrame(clip, frame) {
    if (!CLIP_PATTERN.test(clip) || !FRAME_PATTERN.test(frame)) return null
    const fullPath = path.resolve(root, clip, frame)
    if (fullPath !== path.join(root, clip, frame)) return null
    if (!fullPath.startsWith(root + path.sep)) return null
    return fullPath
  }

  async function exists() {
    try {
      const entries = await readdir(root)
      return entries.length > 0
    } catch {
      return false
    }
  }

  function getFrameCounts() {
    return clipFrameCounts ?? {}
  }

  return {
    getIndex,
    resolveFrame,
    exists,
    getFrameCounts,
    getRoot: () => root,
    getManifestPath: () => manifestPath,
  }
}
