import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GUESTBOOK_IMAGE_ROOT = path.resolve(__dirname, '../../guestbook_image')

/**
 * 仅允许 guestbook_image 目录下的文件名，拒绝路径穿越。
 * @param {string} urlOrName
 * @returns {string | null} absolute path
 */
export function resolveGuestbookImagePath(urlOrName) {
  const raw = String(urlOrName || '').trim()
  if (!raw) return null
  let name = ''
  const fromUrl = raw.match(/\/guestbook_image\/([^/?#]+)/i)
  if (fromUrl) name = fromUrl[1]
  else if (!/[\\/]/.test(raw)) name = raw
  else return null

  name = path.basename(name)
  if (!name || name === '.' || name === '..') return null

  const full = path.resolve(GUESTBOOK_IMAGE_ROOT, name)
  const root = GUESTBOOK_IMAGE_ROOT.endsWith(path.sep)
    ? GUESTBOOK_IMAGE_ROOT
    : GUESTBOOK_IMAGE_ROOT + path.sep
  if (full !== GUESTBOOK_IMAGE_ROOT && !full.startsWith(root)) return null
  return full
}

/** @param {string[]} urls */
export function unlinkGuestbookImages(urls) {
  if (!Array.isArray(urls) || !urls.length) return 0
  let removed = 0
  for (const url of urls) {
    const full = resolveGuestbookImagePath(url)
    if (!full || !fs.existsSync(full)) continue
    try {
      fs.unlinkSync(full)
      removed += 1
    } catch {
      /* ignore */
    }
  }
  return removed
}
