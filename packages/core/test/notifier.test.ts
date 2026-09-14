import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeWebhookKey, Notifier } from "../src/index.ts";

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type FetchCall = { url: string; body: string };

function makeFetch(impl: Array<() => Promise<Response>>) {
  const calls: FetchCall[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, body: String(init.body) });
    const fn = impl.shift();
    if (!fn) throw new Error("no more mock responses");
    return fn();
  };
  return { fetchImpl, calls };
}

describe("normalizeWebhookKey", () => {
  it("从完整地址提取 key", () => {
    assert.equal(
      normalizeWebhookKey("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc-123-xyz"),
      "abc-123-xyz",
    );
  });
  it("纯 key 原样返回", () => {
    assert.equal(normalizeWebhookKey("abc-123-xyz"), "abc-123-xyz");
    assert.equal(normalizeWebhookKey("  abc-123-xyz  "), "abc-123-xyz");
  });
});

describe("Notifier", () => {
  it("发送 markdown 消息成功", async () => {
    const { fetchImpl, calls } = makeFetch([async () => jsonRes({ errcode: 0, errmsg: "ok" })]);
    const n = new Notifier({ fetchImpl });
    const ok = await n.send("secret-key", "## hello");
    assert.equal(ok, true);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes("qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret-key"));
    const body = JSON.parse(calls[0].body);
    assert.equal(body.msgtype, "markdown");
    assert.equal(body.markdown.content, "## hello");
  });

  it("接口级错误不重试并抛出", async () => {
    const { fetchImpl, calls } = makeFetch([async () => jsonRes({ errcode: 93000, errmsg: "invalid webhook key" })]);
    const n = new Notifier({ fetchImpl });
    await assert.rejects(() => n.send("bad", "x"), /93000/);
    assert.equal(calls.length, 1);
  });

  it("网络错误重试一次后成功", async () => {
    const { fetchImpl, calls } = makeFetch([
      async () => {
        throw new TypeError("fetch failed");
      },
      async () => jsonRes({ errcode: 0, errmsg: "ok" }),
    ]);
    const n = new Notifier({ fetchImpl });
    const ok = await n.send("k", "x");
    assert.equal(ok, true);
    assert.equal(calls.length, 2);
  });

  it("未配置 key 时不发请求", async () => {
    const { fetchImpl, calls } = makeFetch([]);
    const n = new Notifier({ fetchImpl });
    assert.equal(await n.send("", "x"), false);
    assert.equal(calls.length, 0);
  });

  it("sendTest 未配置 key 抛错", async () => {
    const n = new Notifier({});
    await assert.rejects(() => n.sendTest(""), /尚未配置/);
  });
});
