import type { DetectEvent, EventType, MonitorItem } from "./types.ts";
import { fmtTime, marketUrl, truncateBytes } from "./util.ts";

/** 企业微信 markdown 内容上限（字节） */
export const WECOM_MARKDOWN_MAX_BYTES = 4096;

const EVENT_COLORS: Partial<Record<EventType, string>> = {
  new_listing: "warning",
  buy_order_change: "info",
  price_drop: "warning",
  sniped: "comment",
  monitor_error: "warning",
  monitor_recovered: "info",
};

/**
 * 生成物品事件的企业微信 markdown 消息体。
 * 同一物品同一轮内的多个事件合并为一条消息。
 */
export function buildItemMessage(item: MonitorItem, events: DetectEvent[], ts: number): string {
  const sections = events
    .map((e) => {
      const color = EVENT_COLORS[e.type] ?? "info";
      return `<font color="${color}">◆ ${e.title}</font>\n${e.detail}`;
    })
    .join("\n\n");

  const lines = [
    `## <font color="warning">Steam 市场监控</font>`,
    `> 物品：**${item.displayName}**`,
    `> 市场名：${item.marketHashName}`,
    `> 时间：${fmtTime(ts)}`,
    ``,
    sections,
    ``,
    `[前往市场查看](${marketUrl(item.appId, item.marketHashName)})`,
  ];
  return truncateBytes(lines.join("\n"), WECOM_MARKDOWN_MAX_BYTES);
}

/** 系统级消息（监控异常 / 恢复） */
export function buildSystemMessage(events: DetectEvent[], ts: number): string {
  const sections = events
    .map((e) => {
      const color = EVENT_COLORS[e.type] ?? "info";
      return `<font color="${color}">◆ ${e.title}</font>\n${e.detail}`;
    })
    .join("\n\n");
  const lines = [
    `## <font color="comment">Steam 市场监控 · 系统</font>`,
    `> 时间：${fmtTime(ts)}`,
    ``,
    sections,
  ];
  return truncateBytes(lines.join("\n"), WECOM_MARKDOWN_MAX_BYTES);
}

/** 测试消息 */
export function buildTestMessage(ts: number): string {
  const lines = [
    `## <font color="info">Steam 市场监控</font>`,
    `> 这是一条测试消息，机器人连接正常。`,
    `> 时间：${fmtTime(ts)}`,
  ];
  return truncateBytes(lines.join("\n"), WECOM_MARKDOWN_MAX_BYTES);
}
