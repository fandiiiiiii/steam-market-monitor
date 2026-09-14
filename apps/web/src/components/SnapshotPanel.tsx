"use client";

import type { Histogram } from "@steam-monitor/core";
import { fmtPrice, fmtTime } from "@/lib/client";
import { Alert } from "./ui";

interface Props {
  snapshot: {
    histogram: Histogram | null;
    sellCount: number | null;
    sellPrice: number | null;
    fetchedAt: number;
    nameId?: number | null;
  };
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  marketUrl: string;
  symbol?: string;
}

export function SnapshotPanel({ snapshot, loading, error, onRefresh, marketUrl, symbol = "¥" }: Props) {
  const h = snapshot.histogram;
  const sellPrice = snapshot.sellPrice ?? h?.lowestSellOrder ?? null;
  const maxQty = Math.max(1, ...(h?.sellGraph ?? []).map((p) => p.quantity), ...(h?.buyGraph ?? []).map((p) => p.quantity));

  return (
    <div>
      <div className="flex mb8" style={{ justifyContent: "space-between" }}>
        <span className="muted">行情快照（{snapshot.fetchedAt ? fmtTime(snapshot.fetchedAt) : "未获取"}）</span>
        <div className="flex">
          <a className="btn small" href={marketUrl} target="_blank" rel="noreferrer">
            打开市场页 ↗
          </a>
          <button className="btn small" onClick={onRefresh} disabled={loading}>
            {loading ? "抓取中…" : "刷新"}
          </button>
        </div>
      </div>

      {error && <Alert kind="err">{error}</Alert>}

      <div className="stat-grid">
        <div className="stat">
          <div className="k">最低售价</div>
          <div className="v orange">{sellPrice != null ? `${symbol}${fmtPrice(sellPrice)}` : "无在售"}</div>
        </div>
        <div className="stat">
          <div className="k">在售数量</div>
          <div className="v">{snapshot.sellCount ?? "-"}</div>
        </div>
        <div className="stat">
          <div className="k">最高求购价</div>
          <div className="v green">{h?.highestBuyOrder != null ? `${symbol}${fmtPrice(h.highestBuyOrder)}` : "无"}</div>
        </div>
        <div className="stat">
          <div className="k">求购数量</div>
          <div className="v">{h?.buyOrderCount ?? "-"}</div>
        </div>
      </div>

      {h && (
        <div className="form-grid">
          <div className="graph">
            <div className="muted mb8">出售价格分布（低→高）</div>
            {h.sellGraph.slice(0, 10).map((p, i) => (
              <div className="bar-row" key={`s${i}`}>
                <span>{symbol}{fmtPrice(p.price)}</span>
                <div className="bar-track">
                  <div className="bar-fill sell" style={{ width: `${(p.quantity / maxQty) * 100}%` }} />
                </div>
                <span className="muted">×{p.quantity}</span>
              </div>
            ))}
            {h.sellGraph.length === 0 && <div className="muted">暂无出售</div>}
          </div>
          <div className="graph">
            <div className="muted mb8">求购价格分布（低→高）</div>
            {h.buyGraph.slice(0, 10).map((p, i) => (
              <div className="bar-row" key={`b${i}`}>
                <span>{symbol}{fmtPrice(p.price)}</span>
                <div className="bar-track">
                  <div className="bar-fill buy" style={{ width: `${(p.quantity / maxQty) * 100}%` }} />
                </div>
                <span className="muted">×{p.quantity}</span>
              </div>
            ))}
            {h.buyGraph.length === 0 && <div className="muted">暂无求购</div>}
          </div>
        </div>
      )}

      {!h && <div className="muted mt8">求购数据暂不可用（正在适配新版市场接口）</div>}
    </div>
  );
}
