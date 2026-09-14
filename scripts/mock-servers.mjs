// 本地 E2E / 开发联调用 mock 服务器（Steam 市场 + 企业微信）
// 用法：node scripts/mock-servers.mjs <steamPort> <wecomPort>
import { createServer } from "node:http";

const [steamPort, wecomPort] = process.argv.slice(2).map(Number);
const HASH = "Star - Dragon's Bane(Non-CN)";

const state = {
  count: 1,
  price: 1000,
  buyGraph: [["800.00", 2, "2 orders @ ¥800.00"]],
  sellGraph: [["1000.00", 1, "1 order @ ¥1000.00"]],
};

const steam = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "POST" && url.pathname === "/__reset") {
    state.count = 1;
    state.price = 1000;
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
      const { price } = JSON.parse(body);
      state.count += 1;
      if (price < state.price) state.price = price;
      state.sellGraph = [[String(state.price), 1, `1 order @ ¥${state.price}`]];
      state.buyGraph = [
        ["850.00", 1, "1 order @ ¥850.00"],
        ["800.00", 3, "3 orders @ ¥800.00"],
      ];
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, count: state.count }));
    });
    return;
  }
  res.setHeader("content-type", "application/json; charset=utf-8");
  if (url.pathname.startsWith("/market/listings/")) {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(`<html><head><script>Market_LoadOrderSpread( 123456 );</script></head><body></body></html>`);
    return;
  }
  if (url.pathname === "/market/itemordershistogram") {
    res.end(
      JSON.stringify({
        success: 1,
        sell_order_count: String(state.count),
        buy_order_count: String(state.buyGraph.reduce((a, p) => a + Number(p[1]), 0)),
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
        start: 0,
        pagesize: 10,
        total_count: 1,
        searchdata: { query: HASH, total_count: 1 },
        results: [
          {
            name: HASH,
            hash_name: HASH,
            sell_listings: state.count,
            sell_price: Math.round(state.price * 100),
            app_icon: "https://example.com/icon.jpg",
            app_name: "永劫无间",
          },
        ],
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
