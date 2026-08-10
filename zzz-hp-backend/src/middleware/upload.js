import multer from 'multer'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(__dirname, '../..')

const imageDirs = {
  boss: path.join(projectRoot, 'boss_image'),
  buff: path.join(projectRoot, 'buff_image'),
  calculator: path.join(projectRoot, 'calculator_image'),
  guestbook: path.join(projectRoot, 'guestbook_image'),
}

const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function createDiskUploader(type) {
  const dest = imageDirs[type]
  ensureDir(dest)

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        ensureDir(dest)
        cb(null, dest)
      } catch (err) {
        cb(err)
      }
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg'
      const safeExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext) ? ext : '.jpg'
      const name = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}${safeExt}`
      cb(null, name)
    },
  })

  return multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true)
      } else {
        cb(new Error('仅支持 jpg、png、gif、webp 格式图片'))
      }
    },
  })
}

const memoryUploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('仅支持 jpg、png、gif、webp 格式图片'))
    }
  },
})

export const uploadBossImage = createDiskUploader('boss').single('image')
export const uploadBuffImage = createDiskUploader('buff').single('image')
export const uploadCalculatorImage = createDiskUploader('calculator').single('image')
/** 留言 / 头像：先入内存，校验魔数后再落盘 */
export const uploadGuestbookImage = memoryUploader.single('image')
/** 计算器实体头像 → 前端 public 固定路径（kind、entityId 走 query） */
export const uploadCalculatorPublicImage = memoryUploader.single('image')

export { imageDirs }
