import { isValidAdminSession } from '../services/adminSessionService.js'
import { fail } from '../utils/response.js'

/** 从 Authorization Bearer 或 X-Admin-Token 读取管理员会话 token */
export function readAdminToken(req) {
  const auth = req.headers.authorization
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim()
    if (token) return token
  }
  const headerToken = req.headers['x-admin-token']
  if (typeof headerToken === 'string' && headerToken.trim()) {
    return headerToken.trim()
  }
  return ''
}

export function isAdminRequest(req) {
  const token = readAdminToken(req)
  return Boolean(token && isValidAdminSession(token))
}

/** 管理端写接口鉴权：未登录或不带有效 token 返回 401 */
export function requireAdmin(req, res, next) {
  if (!isAdminRequest(req)) {
    return fail(res, '需要管理员登录', 401, { code: 'ADMIN_AUTH_REQUIRED' })
  }
  return next()
}
