/**
 * nanoka 采集（基础数据）管理端接口：**只读预览 + 按勾选录入**，写入走既有 upsert 服务。
 */
import { applyNanokaCandidates, previewNanokaCandidates } from '../services/nanokaBasicsService.js'
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
