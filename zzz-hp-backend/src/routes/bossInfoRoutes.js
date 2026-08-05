import { Router } from 'express'
import {
  listBossInfo,
  lookupBossInfo,
  patchBossInfo,
  searchBossInfo,
} from '../controllers/bossInfoController.js'

const router = Router()

router.get('/lookup', lookupBossInfo)
router.get('/search', searchBossInfo)
router.get('/list', listBossInfo)
router.put('/:id', patchBossInfo)

export default router
