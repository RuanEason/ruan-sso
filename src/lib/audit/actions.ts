import { AuditAction } from "@prisma/client"

/**
 * Runtime list of every audit action, derived from the generated Prisma enum
 * rather than hand-maintained. A new action added to the schema becomes
 * filterable and documented automatically, so the list cannot drift.
 */
export const AUDIT_ACTIONS = Object.values(AuditAction) as AuditAction[]

/** Human-readable labels for the admin view. */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  LOGIN_SUCCESS: "登录成功",
  LOGIN_FAILURE: "登录失败",
  LOGIN_BLOCKED: "登录被限流",
  LOGOUT: "登出",
  REGISTER: "自助注册",

  CONSENT_GRANTED: "同意授权",
  CONSENT_DENIED: "拒绝/被拒授权",
  CONSENT_REVOKED: "撤销授权",

  TOKEN_ISSUED: "签发令牌",
  TOKEN_REFRESHED: "刷新令牌",

  ADMIN_USER_CREATED: "管理员创建用户",
  ADMIN_USER_UPDATED: "管理员修改用户",
  ADMIN_USER_DELETED: "管理员删除用户",
  ADMIN_APP_CREATED: "管理员注册应用",
  ADMIN_APP_UPDATED: "管理员修改应用",
  ADMIN_APP_DELETED: "管理员删除应用",
  ADMIN_ORG_CREATED: "管理员创建组织",
  ADMIN_ORG_UPDATED: "管理员修改组织",
  ADMIN_ORG_DELETED: "管理员删除组织",
  ADMIN_MEMBER_ADDED: "管理员添加成员",
  ADMIN_MEMBER_REMOVED: "管理员移除成员",
  ADMIN_SESSION_REVOKED: "管理员撤销会话",
}

/**
 * Badge tone per action. Failures and destructive operations are highlighted so
 * an investigator scanning the list sees them without reading every row.
 */
export type AuditSeverity = "neutral" | "success" | "warning" | "danger"

export function auditSeverity(action: AuditAction): AuditSeverity {
  if (
    action === "LOGIN_FAILURE" ||
    action === "LOGIN_BLOCKED" ||
    action === "CONSENT_DENIED"
  ) {
    return "warning"
  }
  if (action.endsWith("_DELETED") || action.endsWith("_REMOVED")) {
    return "danger"
  }
  if (
    action === "LOGIN_SUCCESS" ||
    action === "REGISTER" ||
    action === "CONSENT_GRANTED"
  ) {
    return "success"
  }
  return "neutral"
}
