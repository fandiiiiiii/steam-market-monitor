"use client";

import type { Histogram, MonitorItem } from "@steam-monitor/core";
import { useCallback, useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/client";
import { Alert } from "./ui";
import { SnapshotPanel } from "./SnapshotPanel";

interface Props {
  item: MonitorItem;
  symbol?: string;
  onSaved: () => Promise<void>;
  onDeleted: (nextId: string | null) => void;
}

interface SnapshotView {
  histogram: Histogram | null;
  sellCount: number | null;
  sellPrice: number | null;
  fetchedAt: number;
  nameId?: number | null;
}

const EMPTY_SNAP: SnapshotView = { histogram: null, sellCount: null, sellPrice: null, fetchedAt: 0 };

export function ItemDetail({ item, symbol = "¥", onSaved, onDeleted }: Props) {
  const [form, setForm] = useState({
    displayName: item.displayName,
    enabled: item.enabled,
    watchSell: item.watchSell,
    watchBuy: item.watchBuy,
    maxPrice: item.maxPrice ?? "",
    minBuyPrice: item.minBuyPrice ?? "",
    priceDropPct: item.priceDropPct ?? "",
    snipedAlert: item.snipedAlert,
    cooldownSec: item.cooldownSec,
  });
  const [snapshot, setSnapshot] = useState<SnapshotView | null>(null);
  const [snapCurrency, setSnapCurrency] = useState<string | undefined>(undefined);
  const [snapLoading, setSnapLoading] = useState(false);
  const [snapError, setSnapError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadSnapshot = useCallback(async () => {
    setSnapLoading(true);
    setSnapError(null);
    try {
      const r = await apiGet<{ snapshot: SnapshotView; currencySymbol?: string }>(`/api/items/${item.id}/snapshot`);
      setSnapshot(r.snapshot);
      setSnapCurrency(r.currencySymbol);
    } catch (e) {
      setSnapError(e instanceof Error ? e.message : String(e));
      setSnapshot((cur) => cur ?? EMPTY_SNAP);
    } finally {
      setSnapLoading(false);
    }
  }, [item.id]);

  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  // 每分钟自动刷新行情快照
  useEffect(() => {
    const t = setInterval(() => void loadSnapshot(), 60_000);
    return () => clearInterval(t);
  }, [loadSnapshot]);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      await apiSend("PUT", `/api/items/${item.id}`, {
        displayName: form.displayName,
        enabled: form.enabled,
        watchSell: form.watchSell,
        watchBuy: form.watchBuy,
        maxPrice: form.maxPrice === "" ? null : Number(form.maxPrice),
        minBuyPrice: form.minBuyPrice === "" ? null : Number(form.minBuyPrice),
        priceDropPct: form.priceDropPct === "" ? null : Number(form.priceDropPct),
        snipedAlert: form.snipedAlert,
        cooldownSec: Number(form.cooldownSec),
      });
      setMsg("已保存");
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    setErr(null);
    try {
      await apiSend("DELETE", `/api/items/${item.id}`);
      onDeleted(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  };

  const marketUrl = `https://steamcommunity.com/market/listings/${item.appId}/${encodeURIComponent(item.marketHashName)}`;

  return (
    <div>
      <div className="flex wrap mb8" style={{ justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{item.displayName}</div>
          <div className="muted">
            <span className="mono">{item.marketHashName}</span> · App {item.appId} · 添加于{" "}
            {new Date(item.createdAt).toLocaleDateString("zh-CN")}
          </div>
        </div>
      </div>

      {msg && <Alert kind="ok">{msg}</Alert>}
      {err && <Alert kind="err">{err}</Alert>}

      <SnapshotPanel
        snapshot={snapshot ?? EMPTY_SNAP}
        loading={snapLoading}
        error={snapError}
        onRefresh={loadSnapshot}
        marketUrl={marketUrl}
        symbol={snapCurrency ?? symbol}
      />

      <h3 style={{ fontSize: 14, marginTop: 20 }}>监控设置</h3>
      <div className="form-grid">
        <div className="field">
          <label>显示名</label>
          <input type="text" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
        </div>
        <div className="field">
          <label>事件冷却（秒）</label>
          <input
            type="number"
            min={10}
            max={86400}
            value={form.cooldownSec}
            onChange={(e) => setForm({ ...form, cooldownSec: Number(e.target.value) })}
          />
          <span className="hint">同类型事件合并推送的最小间隔（10~86400）</span>
        </div>
        <div className="field">
          <label>上架提醒价格上限（{symbol}，留空不限；有 Cookie 时按市场页币种填写）</label>
          <input
            type="number"
            step="0.01"
            value={form.maxPrice}
            placeholder="如 1500"
            onChange={(e) => setForm({ ...form, maxPrice: e.target.value })}
          />
        </div>
        <div className="field">
          <label>求购提醒最低价（{symbol}，留空不限）</label>
          <input
            type="number"
            step="0.01"
            value={form.minBuyPrice}
            placeholder="如 800"
            onChange={(e) => setForm({ ...form, minBuyPrice: e.target.value })}
          />
        </div>
        <div className="field">
          <label>降价提醒阈值（%，留空关闭）</label>
          <input
            type="number"
            step="0.1"
            min={0.1}
            max={100}
            value={form.priceDropPct}
            placeholder="如 5"
            onChange={(e) => setForm({ ...form, priceDropPct: e.target.value })}
          />
          <span className="hint">最低售价下降达到该幅度时提醒</span>
        </div>
      </div>

      <div className="form-grid mt8">
        <label className="check-row">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          启用监控
        </label>
        <label className="check-row">
          <input type="checkbox" checked={form.watchSell} onChange={(e) => setForm({ ...form, watchSell: e.target.checked })} />
          监控卖家上架
        </label>
        <label className="check-row">
          <input type="checkbox" checked={form.watchBuy} onChange={(e) => setForm({ ...form, watchBuy: e.target.checked })} />
          监控求购订单
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={form.snipedAlert}
            onChange={(e) => setForm({ ...form, snipedAlert: e.target.checked })}
          />
          最低价被秒提醒
        </label>
      </div>

      <div className="flex wrap mt8">
        <button className="btn primary" onClick={save} disabled={saving}>
          {saving ? "保存中…" : "保存设置"}
        </button>
        {confirmDelete ? (
          <>
            <span className="muted">确定删除该物品及其历史事件？</span>
            <button className="btn danger" onClick={remove} disabled={deleting}>
              {deleting ? "删除中…" : "确认删除"}
            </button>
            <button className="btn" onClick={() => setConfirmDelete(false)}>
              取消
            </button>
          </>
        ) : (
          <button className="btn danger" onClick={() => setConfirmDelete(true)}>
            删除物品
          </button>
        )}
      </div>
    </div>
  );
}
