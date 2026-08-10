import { ApiError } from './api'
import type { ApiErrorCode } from '@inkrypt/contracts/errors'

const ERROR_CODE_ZH: Record<ApiErrorCode, string> = {
  ALREADY_CONFIRMED: '该会话已确认，请在新设备继续完成',
  ALREADY_JOINED: '该配对口令已被使用，请重新生成',
  BAD_ORIGIN: '请求来源不受信任',
  CEREMONY_EXPIRED: '认证会话已过期，请重新准备',
  CEREMONY_NOT_FOUND: '认证会话不存在，请重新准备',
  CEREMONY_REPLAYED: '认证会话已被使用，请重新准备',
  CODE_CONFLICT: '配对口令生成失败，请重试',
  CREDENTIAL_NOT_FOUND: '未找到该 Passkey，请重试或更换设备',
  CSRF_BLOCKED: '请求被安全策略阻止，请刷新页面后重试',
  CURSOR_AHEAD: '本地同步游标超前，请重新同步保险库',
  DEVICE_GRANT_CONSUMED: '设备授权已被使用，请重新生成配对口令',
  DEVICE_GRANT_EXPIRED: '设备授权已过期，请重新生成配对口令',
  DEVICE_GRANT_NOT_READY: '旧设备尚未确认设备授权',
  DEVICE_REVOKED: '此设备已被移除，权限已撤销；已为你锁定本地内容，请在其他设备重新添加/解锁。',
  FORBIDDEN: '无权限执行该操作',
  HANDSHAKE_EXPIRED: '配对会话已过期，请在已登录设备重新生成配对口令',
  HANDSHAKE_NOT_FOUND: '配对会话不存在，请在已登录设备重新生成配对口令',
  HANDSHAKE_NOT_READY: '旧设备尚未确认，或密钥尚未发送',
  INTERNAL_ERROR: '服务发生内部错误，请稍后重试',
  INVALID_BODY: '请求参数不正确，请重试',
  INVALID_CURSOR: '同步游标无效，请重新同步',
  INVALID_NOTE_ID: '笔记标识无效，请刷新页面后重试',
  INVALID_PUBLIC_KEY: '配对公钥无效，请重新开始配对',
  INVALID_SESSION_CODE: '配对码格式不正确',
  INVALID_TOKEN: '授权口令无效，请重试或重新生成',
  LAST_DEVICE: '至少保留一个设备（最后一个设备不能删除）',
  MISCONFIGURED: '服务端配置不完整，请联系部署管理员',
  MISSING_CREDENTIAL_ID: '缺少 Passkey 标识，请重试',
  MULTI_USER_UNSUPPORTED: '检测到多个租户记录，请联系部署管理员处理',
  NO_CREDENTIALS: '未找到可用的 Passkey：请先创建保险库，或用“添加新设备”加入',
  NO_JOIN_YET: '新设备尚未加入配对会话',
  NOTE_NOT_FOUND: '笔记不存在或已被清理',
  NOT_VERIFIED: '未通过 Passkey 验证',
  PAYLOAD_TOO_LARGE: '笔记数据过大，请移除部分附件后重试',
  RATE_LIMITED: '请求过于频繁，请稍后重试',
  SETUP_TOKEN_INVALID: '初始化口令不正确',
  UNAUTHORIZED: '未登录或会话已过期，请重新登录',
  USER_NOT_FOUND: '未找到保险库，请检查访问地址或稍后重试',
  VAULT_NOT_INITIALIZED: '保险库尚未创建，请先在首台设备点击“创建保险库”',
  VAULT_ALREADY_INITIALIZED: '保险库已创建，无需重复创建',
  VERIFY_FAILED: 'Passkey 验证失败',
  VERSION_CONFLICT: '笔记已在其他设备更新，正在合并最新版本',
}

export function formatErrorZh(err: unknown): string {
  if (err instanceof ApiError) {
    const payload: any = err.payload
    const code = typeof payload?.error === 'string' ? payload.error : null
    const message = typeof payload?.message === 'string' ? payload.message : null

    const m = /^(GET|POST|PUT|DELETE)\s+(\S+)\s+failed$/.exec(err.message)
    const method = m?.[1]
    const path = m?.[2]

    const parts: string[] = []
    parts.push(method && path ? `请求失败：${method} ${path}（${err.status}）` : `请求失败（${err.status}）`)

    if (code) {
      const zh = ERROR_CODE_ZH[code as ApiErrorCode]
      parts.push(zh ? `${zh}（${code}）` : code)
    }
    if (message) parts.push(message)

    return parts.join('\n')
  }

  if (err instanceof Error) return err.message
  return String(err)
}
