import { Router } from 'express'
import {
  applyNanokaCandidatesHandler,
  collectNanokaBasicsHandler,
  previewNanokaCandidatesHandler,
  scanNanokaBasicsHandler,
} from '../controllers/nanokaBasicsController.js'
import { requireAdmin } from '../middleware/requireAdmin.js'

const router = Router()

// 候选文档来自本地采集（tools/nanoka-scan.mjs + tools/nanoka-candidates.mjs）或浏览器直采，服务端不抓网络
router.post('/preview', requireAdmin, previewNanokaCandidatesHandler)
router.post('/apply', requireAdmin, applyNanokaCandidatesHandler)

// 浏览器直采：索引比对（不写库）+ 单条详情映射（不写库）。抓 nanoka 由浏览器负责，服务端不联网。
router.post('/scan', requireAdmin, scanNanokaBasicsHandler)
router.post('/collect', requireAdmin, collectNanokaBasicsHandler)

export default router
