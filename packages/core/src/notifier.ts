import { buildTestMessage } from "./templates.ts";
import { errMsg, sleep } from "./util.ts";

export interface NotifierOptions {
  /** 企业微信接口根地址，默认 https://qyapi.weixin.qq.com */
  baseUrl?: string;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

interface WeComResponse {
  errcode: number;
  errmsg: string;
}

/**
 * 企业微信群机器人推送（webhook 方式，无需企业主体认证）。
 * 限速：单机器人 20 条/分钟，由调用方（runner）通过合并与冷却控制。
 */
export class Notifier {
  private readonly baseUrl: string;
  private readonly fetchImpl: (url: string, init: RequestInit) => Promise<Response>;
  private readonly timeoutMs: number;

  constructor(opts: NotifierOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "https://qyapi.weixin.qq.com").replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.timeoutMs = opts.timeoutMs ?? 10000;
  }

  private webhookUrl(key: string): string {
    return `${this.baseUrl}/cgi-bin/webhook/send?key=${encodeURIComponent(key)}`;
  }

  /**
   * 发送一条 markdown 消息。
   * @returns 是否成功送达（errcode === 0）
   */
  async send(key: string, markdown: string): Promise<boolean> {
    if (!key) return false;
    const url = this.webhookUrl(key);
    const body = JSON.stringify({ msgtype: "markdown", markdown: { content: markdown } });
    let lastErr = "未知错误";
    for (let attempt = 0; attempt < 2; attempt++) {
      let j: WeComResponse;
      try {
        const res = await this.fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        j = (await res.json()) as WeComResponse;
      } catch (e) {
        // 仅网络层错误重试一次
        lastErr = errMsg(e);
        if (attempt === 0) {
          await sleep(1000);
          continue;
        }
        throw new Error(`企业微信推送失败：${lastErr}`);
      }
      if (j.errcode === 0) return true;
      // 接口级错误（key 无效、限流等）重试无意义
      throw new Error(`企业微信返回错误 ${j.errcode}: ${j.errmsg}`);
    }
    throw new Error(`企业微信推送失败：${lastErr}`);
  }

  /** 发送测试消息 */
  async sendTest(key: string): Promise<boolean> {
    if (!key) throw new Error("尚未配置企业微信 webhook key");
    return this.send(key, buildTestMessage(Date.now()));
  }
}
