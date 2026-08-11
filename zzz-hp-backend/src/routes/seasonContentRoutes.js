import { Router } from 'express'
import { requireAdmin } from '../middleware/requireAdmin.js'
import {
  previewSeasonContentHandler,
  softDeleteSeasonContentHandler,
  purgeSeasonContentHandler,
  restoreSeasonContentHandler,
  cleanupSeasonContentHandler,
} from '../controllers/seasonContentController.js'

const router = Router()

router.post('/preview', requireAdmin, previewSeasonContentHandler)
router.post('/soft-delete', requireAdmin, softDeleteSeasonContentHandler)
router.post('/purge', requireAdmin, purgeSeasonContentHandler)
router.post('/restore', requireAdmin, restoreSeasonContentHandler)
router.post('/cleanup', requireAdmin, cleanupSeasonContentHandler)

export default router
