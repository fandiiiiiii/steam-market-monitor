import { NextResponse, type NextRequest } from "next/server";
import { getCatalog } from "@/lib/catalog";
import { errMsg } from "@steam-monitor/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

/** 目录索引自检：查看索引条目数与关键词命中情况 */
export async function GET(req: NextRequest) {
  const appId = Number(req.nextUrl.searchParams.get("appid") ?? 1203220);
  try {
    const catalog = await getCatalog(appId);
    const hit = (kw: string) =>
      catalog
        .filter((r) => r.name.includes(kw) || r.marketHashName.toLowerCase().includes(kw.toLowerCase()))
        .slice(0, 10)
        .map((r) => ({ name: r.name, hash: r.marketHashName }));
    return NextResponse.json({
      appId,
      catalogTotal: catalog.length,
      hit花重锦: hit("花重锦"),
      hit谪星Count: catalog.filter((r) => r.name.includes("谪星")).length,
      hit信手: hit("信手"),
      sample: catalog.slice(0, 5).map((r) => r.name),
    });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 502 });
  }
}
