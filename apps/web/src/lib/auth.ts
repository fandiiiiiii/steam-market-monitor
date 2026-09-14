import type { NextRequest } from "next/server";

/**
 * 管理页面写操作鉴权：
 * - 未配置 ADMIN_TOKEN：放行（本地开发 / 内网使用）
 * - 已配置：要求请求头 x-admin-token 匹配（管理页在"设置"中输入口令后保存在 localStorage）
 */
export function adminAuthorized(req: NextRequest): boolean {
  const admin = process.env.ADMIN_TOKEN;
  if (!admin) return true;
  return req.headers.get("x-admin-token") === admin;
}

/**
 * 巡检入口（/api/monitor）鉴权：
 * - Vercel Cron 配置了 CRON_SECRET 时会自动携带 Authorization: Bearer <CRON_SECRET>
 * - 页面手动触发时可携带 x-admin-token
 */
export function monitorAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth === `Bearer ${secret}`) return true;
    if (req.headers.get("x-cron-secret") === secret) return true;
    return adminAuthorized(req);
  }
  return adminAuthorized(req);
}
