import { Router } from 'express'
import {
  getCalculatorBuffs,
  getFollowUpSkillRules,
  getSkillSubcategories,
  getDamageEventModes,
  removeAgent,
  removeBangboo,
  removeDriveDisc,
  removeFollowUpSkillRule,
  removeSkillSubcategory,
  removeDamageEventMode,
  removeWengine,
  saveAgent,
  saveBangboo,
  saveDriveDisc,
  saveFollowUpSkillRule,
  saveSkillSubcategory,
  saveDamageEventMode,
  saveWengine,
} from '../controllers/calculatorBuffController.js'
import { requireAdmin } from '../middleware/requireAdmin.js'

const router = Router()

router.get('/', getCalculatorBuffs)

router.get('/skill-subcategories', getSkillSubcategories)
router.put('/skill-subcategories', requireAdmin, saveSkillSubcategory)
router.delete('/skill-subcategories/:id', requireAdmin, removeSkillSubcategory)

router.get('/follow-up-rules', getFollowUpSkillRules)
router.put('/follow-up-rules', requireAdmin, saveFollowUpSkillRule)
router.delete('/follow-up-rules/:id', requireAdmin, removeFollowUpSkillRule)

router.get('/damage-event-modes', getDamageEventModes)
router.put('/damage-event-modes', requireAdmin, saveDamageEventMode)
router.delete('/damage-event-modes/:id', requireAdmin, removeDamageEventMode)

router.put('/agents', requireAdmin, saveAgent)
router.delete('/agents/:id', requireAdmin, removeAgent)

router.put('/bangboos', requireAdmin, saveBangboo)
router.delete('/bangboos/:id', requireAdmin, removeBangboo)

router.put('/drive-discs', requireAdmin, saveDriveDisc)
router.delete('/drive-discs/:id', requireAdmin, removeDriveDisc)

router.put('/wengines', requireAdmin, saveWengine)
router.delete('/wengines/:id', requireAdmin, removeWengine)

export default router
