import { Router } from 'express'
import { addBuff, queryBuff, removeBuff } from '../controllers/dataController.js'
import { requireAdmin } from '../middleware/requireAdmin.js'

const router = Router()

router.get('/search', queryBuff)
router.post('/', requireAdmin, addBuff)
router.delete('/:id', requireAdmin, removeBuff)

export default router
