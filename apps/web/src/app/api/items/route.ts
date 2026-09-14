import { type MonitorItem, genId, nowTs } from "@steam-monitor/core";
import { NextResponse, type NextRequest } from "next/server";
import { adminAuthorized } from "@/lib/auth";
import { coerceItemInput } from "@/lib/items";
import { ensureDefaults, store } from "@/lib/singletons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureDefaults();
  const items = await store.getItems();
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  if (!adminAuthorized(req)) return NextResponse.json({ error: "未授权" }, { status: 401 });
  await ensureDefaults();
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const parsed = coerceItemInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const items = await store.getItems();
  if (items.some((i) => i.appId === parsed.item.appId && i.marketHashName === parsed.item.marketHashName)) {
    return NextResponse.json({ error: "该物品已在监控列表中" }, { status: 409 });
  }
  const item: MonitorItem = { ...parsed.item, id: genId(), createdAt: nowTs() };
  items.push(item);
  await store.saveItems(items);
  return NextResponse.json({ item });
}
