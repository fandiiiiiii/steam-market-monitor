"use client";

import type { MonitorItem } from "@steam-monitor/core";
import { Badge } from "./ui";

interface Props {
  items: MonitorItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleEnabled: (item: MonitorItem, enabled: boolean) => void;
  onAdd: () => void;
}

export function ItemList({ items, selectedId, onSelect, onToggleEnabled, onAdd }: Props) {
  return (
    <div className="card">
      <div className="flex mb8" style={{ justifyContent: "space-between" }}>
        <span className="muted">监控列表（{items.length}）</span>
        <button className="btn small" onClick={onAdd}>
          ＋ 添加
        </button>
      </div>
      <div className="item-list">
        {items.length === 0 && <div className="empty">暂无监控物品</div>}
        {items.map((item) => (
          <div
            key={item.id}
            className={`item-row ${item.id === selectedId ? "active" : ""}`}
            onClick={() => onSelect(item.id)}
          >
            <div className="name">
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.displayName}
              </span>
              <span
                role="switch"
                aria-checked={item.enabled}
                className={`toggle ${item.enabled ? "on" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleEnabled(item, !item.enabled);
                }}
              />
            </div>
            <div className="meta">
              {item.enabled ? (
                <>
                  {item.watchSell && <Badge cls="sell">卖家上架</Badge>}
                  {item.watchBuy && <Badge cls="buy">求购</Badge>}
                  {!item.watchSell && !item.watchBuy && <Badge>无监控类型</Badge>}
                </>
              ) : (
                <Badge cls="off">已停用</Badge>
              )}
              <span>App {item.appId}</span>
              {item.maxPrice != null && <span>上限 ¥{item.maxPrice}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
