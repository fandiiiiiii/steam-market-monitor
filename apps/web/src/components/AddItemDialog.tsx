"use client";

import type { MonitorItem } from "@steam-monitor/core";
import { useState } from "react";
import { apiGet, apiSend } from "@/lib/client";
import { Alert, Modal } from "./ui";

interface Props {
  onClose: () => void;
  onAdded: (item: MonitorItem) => void;
}

type Mode = "search" | "url" | "manual";

const NARAKA_APP_ID = 1203220;

/** 常见谪星示例（一键添加） */
const PRESETS: Array<{ hash: string; label: string }> = [
  { hash: "Star - Dragon's Bane(Non-CN)", label: "谪星·信手斩龙（国际服）" },
  { hash: "Star - Dragon's Bane(CN)", label: "谪星·信手斩龙（国服）" },
  { hash: "Star - Variance(Non-CN)", label: "谪星·无定法（国际服）" },
  { hash: "Star - Variance(CN)", label: "谪星·无定法（国服）" },
];

export function AddItemDialog({ onClose, onAdded }: Props) {
  const [mode, setMode] = useState<Mode>("search");
  const [appId, setAppId] = useState(String(NARAKA_APP_ID));
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ marketHashName: string; name: string; iconUrl?: string }>>([]);
  const [searching, setSearching] = useState(false);
  const [url, setUrl] = useState("");
  const [resolving, setResolving] = useState(false);
  const [manualHash, setManualHash] = useState("");
  const [manualName, setManualName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);

  const doSearch = async () => {
    setError(null);
    setResults([]);
    if (!query.trim()) return;
    setSearching(true);
    try {
      const r = await apiGet<{ results: Array<{ marketHashName: string; name: string; iconUrl?: string }> }>(
        `/api/items/suggest?appid=${encodeURIComponent(appId)}&q=${encodeURIComponent(query)}`,
      );
      setResults(r.results);
      if (r.results.length === 0) setWarn("没有找到相关物品，换个关键词试试");
      else setWarn(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  };

  const resolveUrl = async () => {
    setError(null);
    setWarn(null);
    if (!url.trim()) return;
    setResolving(true);
    try {
      const r = await apiSend<{ appId: number; marketHashName: string; nameId: number | null; warn: string | null }>(
        "POST",
        "/api/items/resolve-url",
        { url },
      );
      if (r.warn) setWarn(r.warn);
      await createItem(r.appId, r.marketHashName);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResolving(false);
    }
  };

  const createItem = async (appIdNum: number, hash: string, name?: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiSend<{ item: MonitorItem }>("POST", "/api/items", {
        appId: appIdNum,
        marketHashName: hash,
        displayName: name,
      });
      onAdded(r.item);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="添加监控物品" onClose={onClose}>
      <div className="tabs">
        <span className={`tab ${mode === "search" ? "active" : ""}`} onClick={() => setMode("search")}>
          搜索添加
        </span>
        <span className={`tab ${mode === "url" ? "active" : ""}`} onClick={() => setMode("url")}>
          粘贴市场链接
        </span>
        <span className={`tab ${mode === "manual" ? "active" : ""}`} onClick={() => setMode("manual")}>
          手动输入
        </span>
      </div>

      {error && <Alert kind="err">{error}</Alert>}
      {warn && <Alert kind="warn">{warn}</Alert>}

      {mode === "search" && (
        <div>
          <div className="form-grid">
            <div className="field">
              <label>AppID（永劫无间 1203220，支持任意 Steam 游戏）</label>
              <input type="number" value={appId} onChange={(e) => setAppId(e.target.value)} />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>关键词（物品名，如：谪星 / Dragon）</label>
              <div className="flex">
                <input
                  type="text"
                  value={query}
                  style={{ flex: 1 }}
                  placeholder="输入关键词后点击搜索"
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && doSearch()}
                />
                <button className="btn primary" onClick={doSearch} disabled={searching}>
                  {searching ? "搜索中…" : "搜索"}
                </button>
              </div>
            </div>
          </div>
          <div className="mt8 muted">永劫无间谪星示例（点击直接添加）：</div>
          <div className="flex wrap mt8">
            {PRESETS.map((p) => (
              <button key={p.hash} className="btn small" disabled={busy} onClick={() => createItem(NARAKA_APP_ID, p.hash, p.label)}>
                {p.label}
              </button>
            ))}
          </div>
          {results.length > 0 && (
            <div className="search-results">
              {results.map((r) => (
                <div
                  key={r.marketHashName}
                  className="search-result"
                  onClick={() => createItem(Number(appId), r.marketHashName, r.name)}
                >
                  {r.iconUrl && <img src={r.iconUrl} alt="" loading="lazy" />}
                  <div style={{ minWidth: 0 }}>
                    <div className="rname">{r.name}</div>
                    <div className="rhash">{r.marketHashName}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === "url" && (
        <div>
          <div className="field">
            <label>粘贴 Steam 市场商品页链接</label>
            <input
              type="text"
              value={url}
              placeholder="https://steamcommunity.com/market/listings/1203220/..."
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && resolveUrl()}
            />
            <span className="hint">支持任意游戏的商品页；解析成功后会先做一次 nameid 预检</span>
          </div>
          <div className="footer">
            <button className="btn" onClick={onClose}>
              取消
            </button>
            <button className="btn primary" onClick={resolveUrl} disabled={resolving || busy}>
              {resolving ? "解析中…" : "解析并添加"}
            </button>
          </div>
        </div>
      )}

      {mode === "manual" && (
        <div>
          <div className="form-grid">
            <div className="field">
              <label>AppID</label>
              <input type="number" value={appId} onChange={(e) => setAppId(e.target.value)} />
            </div>
            <div className="field">
              <label>market_hash_name（市场名）</label>
              <input
                type="text"
                value={manualHash}
                placeholder="如 Star - Dragon's Bane(Non-CN)"
                onChange={(e) => setManualHash(e.target.value)}
              />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>显示名（可选，默认同市场名）</label>
              <input type="text" value={manualName} placeholder="如：长剑谪星·信手斩龙" onChange={(e) => setManualName(e.target.value)} />
            </div>
          </div>
          <div className="footer">
            <button className="btn" onClick={onClose}>
              取消
            </button>
            <button
              className="btn primary"
              disabled={busy || !manualHash.trim()}
              onClick={() => createItem(Number(appId), manualHash.trim(), manualName.trim() || undefined)}
            >
              添加
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
