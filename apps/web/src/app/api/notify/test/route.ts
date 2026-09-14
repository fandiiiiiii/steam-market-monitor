import { NextResponse, type NextRequest } from "next/server";
import { adminAuthorized } from "@/lib/auth";
import { notifier, store } from "@/lib/singletons";
import { errMsg } from "@steam-monitor/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** 发送测试消息（可传临时 key 测试未保存的机器人） */
export async function POST(req: NextRequest) {
  if (!adminAuthorized(req)) return NextResponse.json({ error: "未授权" }, { status: 401 });
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // 允许无请求体
  }
  const settings = await store.getSettings();
  const key = (typeof body?.key === "string" && body.key.trim()) || settings.webhookKey;
  if (!key) return NextResponse.json({ error: "尚未配置企业微信 webhook key" }, { status: 400 });
  try {
    const ok = await notifier.sendTest(key);
    return NextResponse.json({ ok });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 502 });
  }
}
