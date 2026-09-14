// 本地 E2E / 开发联调用 mock 服务器（Steam 市场 + 企业微信）
// 用法：node scripts/mock-servers.mjs <steamPort> <wecomPort>
import { createServer } from "node:http";

const [steamPort, wecomPort] = process.argv.slice(2).map(Number);
const HASH = "Star - Dragon's Bane(Non-CN)";
const APP_ID = 1203220;

const state = {
  listings: [{ listingId: "1001", price: 1000 }],
  buyGraph: [["800.00", 2, "2 orders @ ¥800.00"]],
  sellGraph: [["1000.00", 1, "1 order @ ¥1000.00"]],
};

function rowHtml(listingId, price) {
  return `<div class="market_listing_row market_recent_listing_row" id="listing_${listingId}_999${listingId}">
    <div class="market_listing_item_name_block">
      <a href="https://steamcommunity.com/market/listings/${APP_ID}/${encodeURIComponent(HASH)}" class="market_listing_item_name_link">
        <span class="market_listing_item_name">${HASH}</span>
      </a>
    </div>
    <span class="market_listing_price market_listing_price_with_fee">¥ ${price.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
  </div>`;
}

const steam = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "POST" && url.pathname === "/__reset") {
    state.listings = [{ listingId: "1001", price: 1000 }];
    state.sellGraph = [["1000.00", 1, "1 order @ ¥1000.00"]];
    state.buyGraph = [["800.00", 2, "2 orders @ ¥800.00"]];
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === "POST" && url.pathname === "/__new-listing") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { price, listingId } = JSON.parse(body);
      state.listings.push({ listingId: String(listingId ?? Math.floor(Math.random() * 1e9)), price });
      state.sellGraph = state.listings
        .map((l) => [String(l.price), 1, `1 order @ ¥${l.price}`])
        .sort((a, b) => Number(a[0]) - Number(b[0]));
      state.buyGraph = [
        ["850.00", 1, "1 order @ ¥850.00"],
        ["800.00", 3, "3 orders @ ¥800.00"],
      ];
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, listings: state.listings.length }));
    });
    return;
  }
  res.setHeader("content-type", "application/json; charset=utf-8");
  if (url.pathname.endsWith("/render/") || url.pathname.endsWith("/render")) {
    res.end(
      JSON.stringify({
        success: true,
        total_count: state.listings.length,
        results_html: state.listings.map((l) => rowHtml(l.listingId, l.price)).join("\n"),
      }),
    );
    return;
  }
  if (url.pathname.startsWith("/market/listings/")) {
    res.setHeader("content-type", "text/html; charset=utf-8");
    const html = `<html><head><script>Market_LoadOrderSpread( 123456 );</script></head><body>
      ${state.listings.map((l) => rowHtml(l.listingId, l.price)).join("\n")}
    </body></html>`;
    res.end(html);
    return;
  }
  if (url.pathname === "/market/itemordershistogram") {
    res.end(
      JSON.stringify({
        success: 1,
        sell_order_count: String(state.sellGraph.length),
        buy_order_count: String(state.buyGraph.length),
        lowest_sell_order: state.sellGraph.length ? state.sellGraph[0][0] : "",
        highest_buy_order: state.buyGraph.length ? state.buyGraph[0][0] : "",
        sell_order_graph: state.sellGraph,
        buy_order_graph: state.buyGraph,
      }),
    );
    return;
  }
  if (url.pathname.startsWith("/market/search/render")) {
    res.end(
      JSON.stringify({
        success: true,
        total_count: state.listings.length,
        results_html: state.listings.map((l) => rowHtml(l.listingId, l.price)).join("\n"),
      }),
    );
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

const wecom = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    console.log("[mock-wecom] 收到推送:", body.slice(0, 200).replace(/\n/g, " "));
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ errcode: 0, errmsg: "ok" }));
  });
});

steam.listen(steamPort, "127.0.0.1", () => console.log(`[mock-steam] http://127.0.0.1:${steamPort}`));
wecom.listen(wecomPort, "127.0.0.1", () => console.log(`[mock-wecom] http://127.0.0.1:${wecomPort}`));
