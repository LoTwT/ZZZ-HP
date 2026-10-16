import { Router } from 'express'
import {
  applyNanokaCandidatesHandler,
  previewNanokaCandidatesHandler,
} from '../controllers/nanokaBasicsController.js'
import { requireAdmin } from '../middleware/requireAdmin.js'

const router = Router()

// 候选文档来自本地采集（tools/nanoka-scan.mjs + tools/nanoka-candidates.mjs），服务端不抓网络
router.post('/preview', requireAdmin, previewNanokaCandidatesHandler)
router.post('/apply', requireAdmin, applyNanokaCandidatesHandler)

export default router
