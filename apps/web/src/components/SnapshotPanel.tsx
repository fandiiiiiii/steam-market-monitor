"use client";

import type { Histogram, SellListing } from "@steam-monitor/core";
import { fmtPrice, fmtTime } from "@/lib/client";
import { Alert } from "./ui";

interface Props {
  snapshot: {
    histogram: Histogram | null;
    listings: SellListing[];
    totalListings: number | null;
    fetchedAt: number;
    nameId?: number | null;
  };
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  marketUrl: string;
}

export function SnapshotPanel({ snapshot, loading, error, onRefresh, marketUrl }: Props) {
  const h = snapshot.histogram;
  const listings = snapshot.listings ?? [];
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

      {h && (
        <div className="stat-grid">
          <div className="stat">
            <div className="k">最低售价</div>
            <div className="v orange">{h.lowestSellOrder != null ? `¥${fmtPrice(h.lowestSellOrder)}` : "无"}</div>
          </div>
          <div className="stat">
            <div className="k">最高求购价</div>
            <div className="v green">{h.highestBuyOrder != null ? `¥${fmtPrice(h.highestBuyOrder)}` : "无"}</div>
          </div>
          <div className="stat">
            <div className="k">在售数量</div>
            <div className="v">{h.sellOrderCount}</div>
          </div>
          <div className="stat">
            <div className="k">求购数量</div>
            <div className="v">{h.buyOrderCount}</div>
          </div>
        </div>
      )}

      {h && (
        <div className="form-grid">
          <div className="graph">
            <div className="muted mb8">出售价格分布（低→高）</div>
            {h.sellGraph.slice(0, 10).map((p, i) => (
              <div className="bar-row" key={`s${i}`}>
                <span>¥{fmtPrice(p.price)}</span>
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
                <span>¥{fmtPrice(p.price)}</span>
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

      <div className="mt8">
        <div className="muted mb8">
          在售列表（最低价前 {listings.length} 条
          {snapshot.totalListings != null ? ` / 共 ${snapshot.totalListings} 条` : ""}）
        </div>
        {listings.length === 0 ? (
          <div className="muted">暂无在售或列表获取失败</div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>价格</th>
                <th>listingId</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((l) => (
                <tr key={l.listingId}>
                  <td>¥{fmtPrice(l.price)}</td>
                  <td className="mono">{l.listingId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
