import { ApiError } from './api'

const ERROR_CODE_ZH: Record<string, string> = {
  UNAUTHORIZED: '未登录或会话已过期，请重新登录',
  INVALID_BODY: '请求参数不正确，请重试',
  INVALID_SINCE: '同步游标无效，请稍后重试',
  INVALID_NOTE_ID: '笔记标识无效，请刷新页面后重试',
  USER_NOT_FOUND: '未找到保险库，请检查访问地址或稍后重试',
  USERNAME_MISMATCH: '保险库标识不匹配，请检查访问地址',
  VAULT_NOT_INITIALIZED: '保险库尚未创建，请先在首台设备点击“创建保险库”',
  VAULT_ALREADY_INITIALIZED: '保险库已创建，无需重复创建',
  MULTI_USER_UNSUPPORTED: '检测到多个用户记录：当前部署仅支持单用户。请联系管理员处理',
  NO_CHALLENGE: '认证参数缺失，请点击“重新准备”后再试',
  NO_CREDENTIALS: '未找到可用的 Passkey：请先在首台设备“创建保险库”，或用“添加新设备”加入',
  MISSING_CREDENTIAL_ID: '缺少 Passkey 标识，请重试',
  CREDENTIAL_NOT_FOUND: '未找到该 Passkey，请重试或更换设备',
  INVALID_TOKEN: '令牌无效，请重试或重新生成',
  TOKEN_EXPIRED: '令牌已过期，请重新生成',
  CODE_CONFLICT: '配对口令生成失败，请重试',
  INVALID_SESSION_CODE: '配对码格式不正确',
  HANDSHAKE_NOT_FOUND: '配对会话不存在，请在已登录设备重新生成配对口令',
  HANDSHAKE_EXPIRED: '配对会话已过期，请在已登录设备重新生成配对口令',
  HANDSHAKE_NOT_READY: '旧设备尚未确认，或密钥尚未发送',
  NO_JOIN_YET: '新设备尚未加入配对会话',
  ALREADY_JOINED: '该配对口令已被使用，请重新生成',
  ALREADY_CONFIRMED: '该会话已确认，请在新设备继续完成',
  FORBIDDEN: '无权限执行该操作',
  VERIFY_FAILED: 'Passkey 验证失败',
  NOT_VERIFIED: '未通过 Passkey 验证',
  LAST_DEVICE: '至少保留一个设备（最后一个设备不能删除）',
  DEVICE_REVOKED: '此设备已被移除，权限已撤销；已为你锁定本地内容，请在其他设备重新添加/解锁。',
}

export function formatErrorZh(err: unknown): string {
  if (err instanceof ApiError) {
    const payload: any = err.payload
    const code = typeof payload?.error === 'string' ? payload.error : null
    const message = typeof payload?.message === 'string' ? payload.message : null

    const m = /^(GET|POST|DELETE)\s+(\S+)\s+failed$/.exec(err.message)
    const method = m?.[1]
    const path = m?.[2]

    const parts: string[] = []
    parts.push(method && path ? `请求失败：${method} ${path}（${err.status}）` : `请求失败（${err.status}）`)

    if (code) {
      const zh = ERROR_CODE_ZH[code]
      parts.push(zh ? `${zh}（${code}）` : code)
    }
    if (message) parts.push(message)

    return parts.join('\n')
  }

  if (err instanceof Error) return err.message
  return String(err)
}
