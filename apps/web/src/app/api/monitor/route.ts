import { NextResponse, type NextRequest } from "next/server";
import { runRound } from "@steam-monitor/core";
import { monitorAuthorized } from "@/lib/auth";
import { ensureDefaults, notifier, steam, store } from "@/lib/singletons";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 巡检入口：
 * - Vercel Cron 每分钟调用（携带 CRON_SECRET 鉴权头）
 * - 管理页面"立即巡检"按钮手动调用（携带 x-admin-token）
 */
export async function POST(req: NextRequest) {
  if (!monitorAuthorized(req)) return NextResponse.json({ error: "未授权" }, { status: 401 });
  await ensureDefaults();
  const summary = await runRound({ store, steam, notifier, onLog: (m) => console.log(m) });
  return NextResponse.json(summary);
}
