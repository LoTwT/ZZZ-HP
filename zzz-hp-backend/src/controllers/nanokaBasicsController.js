/**
 * nanoka 采集（基础数据）管理端接口：**只读预览 + 按勾选录入**，写入走既有 upsert 服务。
 *
 * 另有「浏览器直采」的两个接口：`/scan`（索引比对）与 `/collect`（单条详情映射）。
 * 抓 nanoka 一律由**浏览器**完成（浏览器走用户系统代理），服务端不联网。
 */
import {
  applyNanokaCandidates,
  collectNanokaEntry,
  previewNanokaCandidates,
  scanNanokaBasics,
} from '../services/nanokaBasicsService.js'
import { fail, success, failInternal } from '../utils/response.js'

/** POST /api/admin/nanoka/preview —— 吃候选文档（本地采集产物），返回逐字段状态，不写库 */
export async function previewNanokaCandidatesHandler(req, res) {
  try {
    const doc = req.body?.doc ?? req.body
    const data = await previewNanokaCandidates(doc)
    const counts = data.entries.reduce(
      (acc, entry) => {
        for (const field of entry.fields) acc[field.status] = (acc[field.status] ?? 0) + 1
        return acc
      },
      { insert: 0, fill: 0, conflict: 0, equal: 0, exists: 0, stale: 0 },
    )
    return success(res, { ...data, counts }, '候选已解析（未写入）')
  } catch (err) {
    return fail(res, err.message || '候选解析失败', 400, { error: err.message })
  }
}

/** POST /api/admin/nanoka/apply —— 只写勾选的条目/字段 */
export async function applyNanokaCandidatesHandler(req, res) {
  try {
    const summary = await applyNanokaCandidates(req.body ?? {})
    const message = `录入完成：新增 ${summary.created}，更新 ${summary.updated}，跳过 ${summary.skipped}，失败 ${summary.failed}`
    return success(res, summary, message)
  } catch (err) {
    return fail(res, err.message || '录入失败', 400, { error: err.message })
  }
}

/** POST /api/admin/nanoka/scan —— 吃浏览器抓来的索引（character.json / weapon.json），只比对，不写库 */
export async function scanNanokaBasicsHandler(req, res) {
  try {
    const { buildTag, charIndex, weaponIndex } = req.body ?? {}
    const data = await scanNanokaBasics({ buildTag, charIndex, weaponIndex })
    const { counts } = data
    const message = `比对完成：缺失角色 ${counts.missingAgents}，缺失音擎 ${counts.missingWengines}；本地多出角色 ${counts.extraLocalAgents}、音擎 ${counts.extraLocalWengines}`
    return success(res, data, message)
  } catch (err) {
    return fail(res, err.message || '索引比对失败', 400, { error: err.message })
  }
}

/** POST /api/admin/nanoka/collect —— 吃浏览器抓来的单条详情，映射成候选条目（不写库） */
export async function collectNanokaBasicsHandler(req, res) {
  try {
    const data = collectNanokaEntry(req.body ?? {})
    const dropped = data.unsupported.length
    const message = dropped
      ? `已映射候选条目（未写库）；有 ${dropped} 项仓库没有对应字段，已丢弃`
      : '已映射候选条目（未写库）'
    return success(res, data, message)
  } catch (err) {
    return fail(res, err.message || '详情映射失败', 400, { error: err.message })
  }
}
