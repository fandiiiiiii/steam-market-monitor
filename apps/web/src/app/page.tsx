"use client";

import type { EventRecord, MonitorItem, RoundSummary } from "@steam-monitor/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { AddItemDialog } from "@/components/AddItemDialog";
import { EventsPanel } from "@/components/EventsPanel";
import { ItemDetail } from "@/components/ItemDetail";
import { ItemList } from "@/components/ItemList";
import { SettingsPanel } from "@/components/SettingsPanel";
import { Alert } from "@/components/ui";
import { apiGet, apiSend, currencySymbol } from "@/lib/client";

// 仪表盘为纯客户端页，无需静态生成
export const dynamic = "force-dynamic";

export interface HealthInfo {
  backend: "upstash-redis" | "file";
  serverTime: number;
  pollEnabled: boolean;
  webhookKeySet: boolean;
  itemsTotal: number;
  itemsEnabled: number;
  health: {
    lastRunAt: number;
    lastSuccessAt: number | null;
    consecutiveFailures: number;
    roundsRun: number;
    lastError: string | null;
    itemsChecked: number;
    itemsFailed: number;
    pushed: number;
    durationMs: number;
  };
}

export interface SettingsView {
  pollEnabled: boolean;
  globalCooldownSec: number;
  quietHoursStart: string;
  quietHoursEnd: string;
  currency: "CNY" | "HKD" | "USD";
  webhookKeySet: boolean;
  webhookKeyMasked: string;
}

type Tab = "detail" | "events" | "settings";

export default function Page() {
  const [items, setItems] = useState<MonitorItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [tab, setTab] = useState<Tab>("detail");
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [pollResult, setPollResult] = useState<RoundSummary | null>(null);
  const loadedRef = useRef(false);

  const showError = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
  }, []);

  const refreshItems = useCallback(async () => {
    const { items } = await apiGet<{ items: MonitorItem[] }>("/api/items");
    setItems(items);
    return items;
  }, []);

  const refreshEvents = useCallback(async (itemId?: string) => {
    const { events } = await apiGet<{ events: EventRecord[] }>(
      `/api/events?limit=200${itemId ? `&itemId=${encodeURIComponent(itemId)}` : ""}`,
    );
    setEvents(events);
  }, []);

  const refreshHealth = useCallback(async () => {
    const h = await apiGet<HealthInfo>("/api/health");
    setHealth(h);
  }, []);

  const refreshSettings = useCallback(async () => {
    const s = await apiGet<{ settings: SettingsView }>("/api/settings");
    setSettings(s.settings);
  }, []);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    (async () => {
      try {
        const list = await refreshItems();
        const [first] = list;
        setSelectedId((cur) => cur ?? first?.id ?? null);
        await Promise.all([refreshEvents(), refreshHealth(), refreshSettings()]);
      } catch (e) {
        showError(e);
      }
    })();
  }, [refreshEvents, refreshHealth, refreshItems, refreshSettings, showError]);

  // 每分钟自动刷新健康状态
  useEffect(() => {
    const t = setInterval(() => refreshHealth().catch(() => {}), 60_000);
    return () => clearInterval(t);
  }, [refreshHealth]);

  const selected = items.find((i) => i.id === selectedId) ?? null;

  const runPoll = async () => {
    setPolling(true);
    setPollResult(null);
    try {
      const r = await apiSend<RoundSummary>("POST", "/api/monitor");
      setPollResult(r);
      await Promise.all([refreshItems(), refreshEvents(), refreshHealth()]);
    } catch (e) {
      showError(e);
    } finally {
      setPolling(false);
    }
  };

  const onAdded = async (item: MonitorItem) => {
    await refreshItems();
    setSelectedId(item.id);
    setTab("detail");
    await refreshHealth();
  };

  const onSaved = async () => {
    await refreshItems();
  };

  const onDeleted = async (nextId: string | null) => {
    await refreshItems();
    setSelectedId(nextId);
    await refreshHealth();
  };

  const onToggleEnabled = async (item: MonitorItem, enabled: boolean) => {
    try {
      await apiSend("PUT", `/api/items/${item.id}`, { enabled });
      await refreshItems();
    } catch (e) {
      showError(e);
    }
  };

  const onSaveSettings = async () => {
    await refreshSettings();
    await refreshHealth();
  };

  const statusBadge = health ? (
    <span className={`badge ${health.pollEnabled ? (health.health.consecutiveFailures > 0 ? "err" : "ok") : "off"}`}>
      {health.pollEnabled
        ? health.health.consecutiveFailures > 0
          ? `连续失败 ${health.health.consecutiveFailures} 轮`
          : "监控运行中"
        : "已暂停"}
    </span>
  ) : null;

  return (
    <div className="app">
      <div className="header">
        <h1>
          🛡️ Steam 市场监控
          {statusBadge}
          {health && <span className="badge info">存储：{health.backend === "upstash-redis" ? "Upstash Redis" : "本地文件"}</span>}
          {health && (
            <span className="badge">
              物品 {health.itemsEnabled}/{health.itemsTotal}
            </span>
          )}
        </h1>
        <div className="spacer" />
        <button className="btn" onClick={() => setAddOpen(true)}>
          ＋ 添加物品
        </button>
        <button className="btn primary" onClick={runPoll} disabled={polling}>
          {polling ? "巡检中…" : "⚡ 立即巡检"}
        </button>
      </div>

      {error && (
        <Alert kind="err">
          {error}
          <span style={{ float: "right", cursor: "pointer" }} onClick={() => setError(null)}>
            ✕
          </span>
        </Alert>
      )}
      {pollResult && (
        <Alert kind={pollResult.skipped ? "warn" : "ok"}>
          {pollResult.skipped
            ? `本轮已跳过（${pollResult.skipReason ?? "未知原因"}）`
            : `巡检完成：检查 ${pollResult.itemsChecked} 项，失败 ${pollResult.itemsFailed} 项，推送 ${pollResult.pushed} 条`}
          <span style={{ float: "right", cursor: "pointer" }} onClick={() => setPollResult(null)}>
            ✕
          </span>
        </Alert>
      )}

      <div className="columns">
        <div>
          <ItemList
            items={items}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setTab("detail");
            }}
            onToggleEnabled={onToggleEnabled}
            onAdd={() => setAddOpen(true)}
          />
        </div>
        <div className="card">
          <div className="tabs">
            <span className={`tab ${tab === "detail" ? "active" : ""}`} onClick={() => setTab("detail")}>
              物品详情
            </span>
            <span className={`tab ${tab === "events" ? "active" : ""}`} onClick={() => setTab("events")}>
              事件日志
            </span>
            <span className={`tab ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")}>
              全局设置
            </span>
          </div>

          {tab === "detail" &&
            (selected ? (
              <ItemDetail
                key={selected.id}
                item={selected}
                symbol={settings ? currencySymbol(settings.currency) : "¥"}
                onSaved={onSaved}
                onDeleted={onDeleted}
              />
            ) : (
              <div className="empty">尚未添加物品，点击左上角“添加物品”开始监控</div>
            ))}

          {tab === "events" && <EventsPanel events={events} items={items} onRefresh={refreshEvents} />}

          {tab === "settings" && settings && (
            <SettingsPanel settings={settings} onSaved={onSaveSettings} health={health} />
          )}
        </div>
      </div>

      {addOpen && <AddItemDialog onClose={() => setAddOpen(false)} onAdded={onAdded} />}
    </div>
  );
}
