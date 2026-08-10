import { Router } from 'express'
import {
  uploadBossImage,
  uploadBuffImage,
  uploadCalculatorImage,
  uploadCalculatorPublicImage,
  uploadGuestbookImage,
} from '../middleware/upload.js'
import {
  uploadBoss,
  uploadBuff,
  uploadCalculator,
  uploadCalculatorPublic,
  ensureCalculatorPublic,
  uploadGuestbook,
  handleUploadError,
} from '../controllers/uploadController.js'
import { requireAdmin } from '../middleware/requireAdmin.js'

const router = Router()

router.post('/boss', requireAdmin, uploadBossImage, handleUploadError, uploadBoss)
router.post('/buff', requireAdmin, uploadBuffImage, handleUploadError, uploadBuff)
router.post('/calculator', requireAdmin, uploadCalculatorImage, handleUploadError, uploadCalculator)
router.post(
  '/calculator-public',
  requireAdmin,
  uploadCalculatorPublicImage,
  handleUploadError,
  uploadCalculatorPublic,
)
router.post('/calculator-public/ensure', requireAdmin, ensureCalculatorPublic)
// 留言板用户发帖上传，保持公开（另有用户侧风控）
router.post('/guestbook', uploadGuestbookImage, handleUploadError, uploadGuestbook)

export default router
