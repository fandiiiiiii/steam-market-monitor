import { type Settings } from "@steam-monitor/core";
import { NextResponse, type NextRequest } from "next/server";
import { adminAuthorized } from "@/lib/auth";
import { ensureDefaults, store } from "@/lib/singletons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "已配置";
  return `已配置（…${key.slice(-4)}）`;
}

export async function GET() {
  await ensureDefaults();
  const s = await store.getSettings();
  return NextResponse.json({
    settings: {
      pollEnabled: s.pollEnabled,
      globalCooldownSec: s.globalCooldownSec,
      quietHoursStart: s.quietHoursStart ?? "",
      quietHoursEnd: s.quietHoursEnd ?? "",
      webhookKeySet: !!s.webhookKey,
      webhookKeyMasked: maskKey(s.webhookKey),
    },
  });
}

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

export async function PUT(req: NextRequest) {
  if (!adminAuthorized(req)) return NextResponse.json({ error: "未授权" }, { status: 401 });
  await ensureDefaults();
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const s = await store.getSettings();
  const next: Settings = { ...s };

  if (typeof body?.pollEnabled === "boolean") next.pollEnabled = body.pollEnabled;
  if (body?.globalCooldownSec !== undefined) {
    const n = Number(body.globalCooldownSec);
    if (!Number.isFinite(n) || n < 10 || n > 86400) {
      return NextResponse.json({ error: "globalCooldownSec 需在 10~86400 之间" }, { status: 400 });
    }
    next.globalCooldownSec = n;
  }
  for (const f of ["quietHoursStart", "quietHoursEnd"] as const) {
    if (body?.[f] !== undefined) {
      const v = String(body[f] ?? "").trim();
      if (v && !TIME_RE.test(v)) return NextResponse.json({ error: `${f} 格式需为 HH:mm` }, { status: 400 });
      next[f] = v || null;
    }
  }
  // webhookKey：留空表示不修改；传值则覆盖
  if (typeof body?.webhookKey === "string" && body.webhookKey.trim()) {
    const key = body.webhookKey.trim();
    if (key.length > 200) return NextResponse.json({ error: "webhook key 过长" }, { status: 400 });
    next.webhookKey = key;
  }

  await store.saveSettings(next);
  return NextResponse.json({
    settings: {
      pollEnabled: next.pollEnabled,
      globalCooldownSec: next.globalCooldownSec,
      quietHoursStart: next.quietHoursStart ?? "",
      quietHoursEnd: next.quietHoursEnd ?? "",
      webhookKeySet: !!next.webhookKey,
      webhookKeyMasked: maskKey(next.webhookKey),
    },
  });
}
