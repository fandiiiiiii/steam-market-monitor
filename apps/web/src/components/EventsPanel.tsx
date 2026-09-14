"use client";

import type { EventRecord, MonitorItem } from "@steam-monitor/core";
import { useEffect, useState } from "react";
import { EVENT_TYPE_LABEL, fmtTime } from "@/lib/client";
import { Badge, Empty } from "./ui";

interface Props {
  events: EventRecord[];
  items: MonitorItem[];
  onRefresh: (itemId?: string) => Promise<void>;
}

export function EventsPanel({ events, items, onRefresh }: Props) {
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const nameOf = (id: string) => items.find((i) => i.id === id)?.displayName ?? id;
  const filtered = filter === "all" ? events : events.filter((e) => e.itemId === filter);

  const refresh = async () => {
    setLoading(true);
    try {
      await onRefresh(filter === "all" ? undefined : filter);
    } finally {
      setLoading(false);
    }
  };

  // 每分钟自动刷新（跟随当前筛选）
  useEffect(() => {
    const t = setInterval(() => {
      void onRefresh(filter === "all" ? undefined : filter).catch(() => {});
    }, 60_000);
    return () => clearInterval(t);
  }, [filter, onRefresh]);

  return (
    <div>
      <div className="flex mb8" style={{ justifyContent: "space-between" }}>
        <div className="flex">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">全部物品</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.displayName}
              </option>
            ))}
          </select>
          <span className="muted" style={{ alignSelf: "center" }}>
            每分钟自动刷新
          </span>
        </div>
        <button className="btn small" onClick={refresh} disabled={loading}>
          {loading ? "刷新中…" : "刷新"}
        </button>
      </div>
      {filtered.length === 0 && <Empty text="暂无事件记录。事件会在监控检测到变化时产生。" />}
      {filtered.map((e) => {
        const label = EVENT_TYPE_LABEL[e.type] ?? { text: e.type, cls: "info" };
        return (
          <div className="event-item" key={e.id}>
            <div className="title">
              <Badge cls={label.cls}>{label.text}</Badge>
              <span style={{ fontWeight: 600 }}>{nameOf(e.itemId)}</span>
              <span className="muted">{fmtTime(e.ts)}</span>
              {e.pushed ? <Badge cls="ok">已推送</Badge> : <Badge>未推送</Badge>}
            </div>
            <div className="detail">{e.title}：{e.detail}</div>
          </div>
        );
      })}
    </div>
  );
}
