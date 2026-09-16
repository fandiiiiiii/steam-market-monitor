import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractNameId,
  parseCurrencyCode,
  parseItemPageOrders,
  parseMarketUrl,
  parsePriceString,
  parseSearchResults,
  parseSearchResultsJson,
  parseSellRows,
} from "../src/index.ts";

const HASH = "Star - Dragon's Bane(Non-CN)";
const HASH_ENC = encodeURIComponent(HASH);

function row(listingId: string, assetId: string, price: string, hashLink = HASH_ENC, name = HASH): string {
  return `<div class="market_listing_row market_recent_listing_row" id="listing_${listingId}_${assetId}">
    <div class="market_listing_item_name_block">
      <a href="https://steamcommunity.com/market/listings/1203220/${hashLink}" class="market_listing_item_name_link">
        <span class="market_listing_item_name" style="color: #CF6A32;">${name}</span>
      </a>
    </div>
    <div class="market_listing_right_cell market_listing_their_price">
      <span class="market_table_value">
        <span class="market_listing_price market_listing_price_with_fee">${price}</span>
      </span>
    </div>
  </div>`;
}

describe("parsePriceString", () => {
  it("解析人民币价格", () => {
    assert.equal(parsePriceString("¥ 8,520.00"), 8520);
    assert.equal(parsePriceString("¥ 0.03"), 0.03);
    assert.equal(parsePriceString("起价 ¥ 1,234.56"), 1234.56);
    assert.equal(parsePriceString("$0.15"), 0.15);
    assert.equal(parsePriceString("无"), null);
    assert.equal(parsePriceString(null), null);
  });
});

describe("parseCurrencyCode", () => {
  it("从价格文本解析币种", () => {
    assert.equal(parseCurrencyCode("$210.94 USD"), "USD");
    assert.equal(parseCurrencyCode("HK$7,281.49 HKD"), "HKD");
    assert.equal(parseCurrencyCode("¥1,234.56 CNY"), "CNY");
    assert.equal(parseCurrencyCode("$1.23"), "USD");
    assert.equal(parseCurrencyCode("HK$7,000.00"), "HKD");
    assert.equal(parseCurrencyCode("¥7000"), "CNY");
    assert.equal(parseCurrencyCode(undefined), null);
  });
});

describe("parseSearchResultsJson（新版结构化搜索接口）", () => {
  it("解析 results 数组并换算价格单位", () => {
    const results = parseSearchResultsJson([
      {
        name: "谪星·绚妙虹流(国服)",
        hash_name: "Star - Rainbow Flow(CN)",
        sell_listings: 71,
        sell_price: 21094,
        sell_price_text: "$210.94 USD",
        app_icon: "https://example.com/icon.jpg",
      },
      { name: "缺字段的条目" },
      null,
    ]);
    assert.equal(results.length, 1);
    assert.equal(results[0].marketHashName, "Star - Rainbow Flow(CN)");
    assert.equal(results[0].name, "谪星·绚妙虹流(国服)");
    assert.equal(results[0].sellListings, 71);
    assert.equal(results[0].sellPrice, 210.94);
    assert.equal(results[0].sellPriceCurrency, "USD");
    assert.equal(results[0].iconUrl, "https://example.com/icon.jpg");
  });

  it("港币价格文本解析", () => {
    const results = parseSearchResultsJson([
      { hash_name: "X", sell_price: 728149, sell_price_text: "HK$7,281.49 HKD" },
    ]);
    assert.equal(results[0].sellPrice, 7281.49);
    assert.equal(results[0].sellPriceCurrency, "HKD");
  });

  it("非数组输入返回空", () => {
    assert.deepEqual(parseSearchResultsJson(null), []);
    assert.deepEqual(parseSearchResultsJson({}), []);
  });
});

describe("parseItemPageOrders（物品页内嵌订单数据）", () => {
  it("解析订购/出售数据并换算价格单位", () => {
    const html = `<script>window.SSR.reactQueryState = {"state":{"data":{"amtMaxBuyOrder":598410,"amtMinSellOrder":700000,"eCurrency":23,"cBuyOrders":159,"cSellOrders":11,"rgCompactBuyOrders":[598410,1,564213,1,563310,2],"rgCompactSellOrders":[700000,1,708614,1]}, "dataUpdatedAt":1}};</script>`;
    const o = parseItemPageOrders(html);
    assert.ok(o);
    assert.equal(o!.buyCount, 159);
    assert.equal(o!.sellCount, 11);
    assert.equal(o!.highestBuy, 5984.1);
    assert.equal(o!.lowestSell, 7000);
    assert.equal(o!.currency, 23);
    assert.deepEqual(o!.buyOrders, [
      { price: 5984.1, quantity: 1 },
      { price: 5642.13, quantity: 1 },
      { price: 5633.1, quantity: 2 },
    ]);
    assert.deepEqual(o!.sellOrders.slice(0, 1), [{ price: 7000, quantity: 1 }]);
  });

  it("带转义的 HTML 也能解析", () => {
    const html = `\\\"state\\\":{\\\"data\\\":{\\\"amtMaxBuyOrder\\\":123456,\\\"rgCompactBuyOrders\\\":[123456,3]}}`;
    const o = parseItemPageOrders(html);
    assert.ok(o);
    assert.equal(o!.highestBuy, 1234.56);
    assert.deepEqual(o!.buyOrders, [{ price: 1234.56, quantity: 3 }]);
  });

  it("零在售时最低售价置空（页面占位值 23 分不算真实价格）", () => {
    const html = `<script>{"state":{"data":{"amtMaxBuyOrder":598410,"amtMinSellOrder":23,"eCurrency":23,"cBuyOrders":5,"cSellOrders":0,"rgCompactBuyOrders":[598410,1],"rgCompactSellOrders":[]}}}</script>`;
    const o = parseItemPageOrders(html);
    assert.ok(o);
    assert.equal(o!.sellCount, 0);
    assert.equal(o!.lowestSell, null);
    assert.equal(o!.highestBuy, 5984.1);
  });

  it("以订购列表第一条为准（amt 汇总字段可能滞后）", () => {
    const html = `<script>{"state":{"data":{"amtMaxBuyOrder":1346486,"amtMinSellOrder":700000,"eCurrency":23,"cBuyOrders":2,"cSellOrders":1,"rgCompactBuyOrders":[1355809,1,1346486,1],"rgCompactSellOrders":[700000,1]}}}</script>`;
    const o = parseItemPageOrders(html);
    assert.ok(o);
    assert.equal(o!.highestBuy, 13558.09);
    assert.equal(o!.buyOrders[0].price, 13558.09);
  });

  it("无数据时返回 null", () => {
    assert.equal(parseItemPageOrders("<html>nothing</html>"), null);
  });
});

describe("parseMarketUrl", () => {
  it("解析完整市场 URL", () => {
    assert.deepEqual(
      parseMarketUrl(`https://steamcommunity.com/market/listings/1203220/${HASH_ENC}?l=schinese`),
      { appId: 1203220, marketHashName: HASH },
    );
  });
  it("解析无参数 URL", () => {
    assert.deepEqual(parseMarketUrl(`steamcommunity.com/market/listings/730/AK-47%20%7C%20Redline`), {
      appId: 730,
      marketHashName: "AK-47 | Redline",
    });
  });
  it("非法 URL 返回 null", () => {
    assert.equal(parseMarketUrl("https://example.com/x"), null);
  });
});

describe("extractNameId", () => {
  it("提取 Market_LoadOrderSpread 中的 nameid", () => {
    const html = `<script>g_rgAssets = {};Market_LoadOrderSpread( 25066390 );</script>`;
    assert.equal(extractNameId(html), 25066390);
  });
  it("无 nameid 返回 null", () => {
    assert.equal(extractNameId("<html></html>"), null);
  });
});

describe("parseSellRows", () => {
  it("解析搜索结果的出售行", () => {
    const html = row("111", "222", "¥ 8,520.00") + row("333", "444", "¥ 8,600.00");
    const rows = parseSellRows(html, { appId: 1203220, marketHashName: HASH });
    assert.deepEqual(rows, [
      { listingId: "111", assetId: "222", price: 8520 },
      { listingId: "333", assetId: "444", price: 8600 },
    ]);
  });

  it("hashFilter 过滤掉其他物品的行", () => {
    const other = row("999", "888", "¥ 1.00", "Other%20Item", "Other Item");
    const html = row("111", "222", "¥ 8,520.00") + other;
    const rows = parseSellRows(html, { appId: 1203220, marketHashName: HASH });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].listingId, "111");
  });

  it("无价格行被忽略", () => {
    const html = `<div id="listing_1_2">no price here</div>`;
    assert.deepEqual(parseSellRows(html), []);
  });
});

describe("parseSearchResults", () => {
  it("按物品去重并提取名称", () => {
    const a = row("111", "222", "¥ 8,520.00", "Item%20A", "Item A");
    const b = row("333", "444", "¥ 8,600.00", "Item%20A", "Item A");
    const results = parseSearchResults(a + b, 1203220);
    assert.equal(results.length, 1);
    assert.equal(results[0].marketHashName, "Item A");
    assert.equal(results[0].name, "Item A");
  });

  it("忽略其他 appid 的行", () => {
    const html = row("111", "222", "¥ 1.00", "Item%20A", "Item A");
    assert.deepEqual(parseSearchResults(html, 730), []);
  });
});
