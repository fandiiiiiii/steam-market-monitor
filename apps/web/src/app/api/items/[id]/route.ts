import { type MonitorItem } from "@steam-monitor/core";
import { NextResponse, type NextRequest } from "next/server";
import { adminAuthorized } from "@/lib/auth";
import { store } from "@/lib/singletons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

const EDITABLE = new Set<keyof MonitorItem>([
  "displayName",
  "enabled",
  "watchSell",
  "watchBuy",
  "maxPrice",
  "minBuyPrice",
  "priceDropPct",
  "snipedAlert",
  "cooldownSec",
]);

export async function GET(_req: NextRequest, ctx: Ctx) {
  const items = await store.getItems();
  const item = items.find((i) => i.id === ctx.params.id);
  if (!item) return NextResponse.json({ error: "物品不存在" }, { status: 404 });
  return NextResponse.json({ item });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  if (!adminAuthorized(req)) return NextResponse.json({ error: "未授权" }, { status: 401 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const items = await store.getItems();
  const idx = items.findIndex((i) => i.id === ctx.params.id);
  if (idx < 0) return NextResponse.json({ error: "物品不存在" }, { status: 404 });
  const item = items[idx];
  const next: MonitorItem = { ...item };
  for (const [k, v] of Object.entries(body ?? {})) {
    if (!EDITABLE.has(k as keyof MonitorItem)) continue;
    if (k === "displayName") {
      if (typeof v !== "string" || !v.trim()) continue;
      next.displayName = v.trim();
    } else if (k === "cooldownSec") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 10 || n > 86400) return NextResponse.json({ error: "cooldownSec 需在 10~86400 之间" }, { status: 400 });
      next.cooldownSec = n;
    } else if (k === "maxPrice" || k === "minBuyPrice" || k === "priceDropPct") {
      if (v === null || v === "") {
        (next as any)[k] = null;
      } else {
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) return NextResponse.json({ error: `${k} 必须是正数或留空` }, { status: 400 });
        (next as any)[k] = n;
      }
    } else {
      (next as any)[k] = !!v;
    }
  }
  items[idx] = next;
  await store.saveItems(items);
  return NextResponse.json({ item: next });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  if (!adminAuthorized(req)) return NextResponse.json({ error: "未授权" }, { status: 401 });
  const items = await store.getItems();
  const idx = items.findIndex((i) => i.id === ctx.params.id);
  if (idx < 0) return NextResponse.json({ error: "物品不存在" }, { status: 404 });
  items.splice(idx, 1);
  await store.saveItems(items);
  return NextResponse.json({ ok: true });
}
