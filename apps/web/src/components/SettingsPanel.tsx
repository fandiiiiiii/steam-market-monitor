"use client";

import { useEffect, useState } from "react";
import { apiSend, fmtTime, getAdminToken, setAdminToken } from "@/lib/client";
import type { SettingsView } from "@/app/page";
import type { HealthInfo } from "@/app/page";
import { Alert } from "./ui";

interface Props {
  settings: SettingsView;
  onSaved: () => Promise<void>;
  health: HealthInfo | null;
}

export function SettingsPanel({ settings, onSaved, health }: Props) {
  const [form, setForm] = useState({
    pollEnabled: settings.pollEnabled,
    globalCooldownSec: settings.globalCooldownSec,
    quietHoursStart: settings.quietHoursStart,
    quietHoursEnd: settings.quietHoursEnd,
    currency: settings.currency ?? "CNY",
    steamCookie: "",
    webhookKey: "",
  });
  const [adminToken, setAdminTokenState] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      pollEnabled: settings.pollEnabled,
      globalCooldownSec: settings.globalCooldownSec,
      quietHoursStart: settings.quietHoursStart,
      quietHoursEnd: settings.quietHoursEnd,
      currency: settings.currency ?? "CNY",
      steamCookie: "",
      webhookKey: "",
    });
    setAdminTokenState(getAdminToken());
  }, [settings]);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      if (adminToken !== getAdminToken()) setAdminToken(adminToken);
      await apiSend("PUT", "/api/settings", {
        pollEnabled: form.pollEnabled,
        globalCooldownSec: Number(form.globalCooldownSec),
        quietHoursStart: form.quietHoursStart || null,
        quietHoursEnd: form.quietHoursEnd || null,
        currency: form.currency,
        steamCookie: form.steamCookie,
        webhookKey: form.webhookKey,
      });
      setForm((f) => ({ ...f, webhookKey: "" }));
      setMsg("设置已保存");
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const testNotify = async (mode?: "event") => {
    setTesting(true);
    setMsg(null);
    setErr(null);
    try {
      const body = mode === "event" ? { mode: "event", ...(form.webhookKey ? { key: form.webhookKey } : {}) } : form.webhookKey ? { key: form.webhookKey } : {};
      await apiSend<{ ok: boolean }>("POST", "/api/notify/test", body);
      // 测试成功后自动把输入框里的 key 保存到设置（避免只测试未保存导致巡检不推送）
      if (form.webhookKey) {
        await apiSend("PUT", "/api/settings", { webhookKey: form.webhookKey });
        setForm((f) => ({ ...f, webhookKey: "" }));
        await onSaved();
      }
      setMsg(
        (mode === "event" ? "模拟告警已发送" : "测试消息已发送") +
          (form.webhookKey ? "，webhook key 已自动保存" : "") +
          "，请到企业微信群查看",
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      {msg && <Alert kind="ok">{msg}</Alert>}
      {err && <Alert kind="err">{err}</Alert>}

      <h3 style={{ fontSize: 14, marginTop: 0 }}>企业微信推送</h3>
      <div className="field">
        <label>机器人 Webhook Key {settings.webhookKeyMasked ? `（当前：${settings.webhookKeyMasked}）` : "（未配置）"}</label>
        <input
          type="text"
          value={form.webhookKey}
          placeholder={settings.webhookKeySet ? "留空保持不变；输入新值则覆盖" : "群机器人 webhook 地址中 key= 后面的部分"}
          onChange={(e) => setForm({ ...form, webhookKey: e.target.value })}
        />
        <span className="hint">
          创建方式：群聊 → 添加群机器人 → 复制 Webhook 地址中 key= 后面的部分粘贴到这里
          （也可以直接粘贴整个 webhook 地址，会自动提取）。报错 93000 = key 不正确
        </span>
      </div>
      <div className="flex mt8">
        <button className="btn primary" onClick={() => testNotify()} disabled={testing}>
          {testing ? "发送中…" : "发送测试消息"}
        </button>
        <button className="btn" onClick={() => testNotify("event")} disabled={testing}>
          📢 模拟市场告警
        </button>
      </div>

      <h3 style={{ fontSize: 14, marginTop: 20 }}>巡检</h3>
      <div className="form-grid">
        <label className="check-row">
          <input
            type="checkbox"
            checked={form.pollEnabled}
            onChange={(e) => setForm({ ...form, pollEnabled: e.target.checked })}
          />
          启用定时巡检（云端 Cron 每分钟一轮）
        </label>
        <div className="field">
          <label>全局事件冷却（秒）</label>
          <input
            type="number"
            min={10}
            max={86400}
            value={form.globalCooldownSec}
            onChange={(e) => setForm({ ...form, globalCooldownSec: Number(e.target.value) })}
          />
          <span className="hint">与物品级冷却取较大值生效</span>
        </div>
        <div className="field">
          <label>显示币种（默认人民币；市场页显示的币种，如港币请选 HKD）</label>
          <select
            value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value as "CNY" | "HKD" | "USD" })}
          >
            <option value="CNY">人民币 ¥</option>
            <option value="HKD">港币 HK$</option>
            <option value="USD">美元 $</option>
          </select>
          <span className="hint">
            汇率每日自动联网获取并缓存；配置 Steam Cookie 后直接使用市场页真实币种价格，无需换算
          </span>
        </div>
        <div className="field">
          <label>免打扰开始（HH:mm）</label>
          <input
            type="time"
            value={form.quietHoursStart}
            onChange={(e) => setForm({ ...form, quietHoursStart: e.target.value })}
          />
        </div>
        <div className="field">
          <label>免打扰结束（HH:mm）</label>
          <input type="time" value={form.quietHoursEnd} onChange={(e) => setForm({ ...form, quietHoursEnd: e.target.value })} />
          <span className="hint">按北京时间计算；两端均留空则关闭；支持跨天（如 23:00 ~ 08:00）</span>
        </div>
      </div>

      <h3 style={{ fontSize: 14, marginTop: 20 }}>Steam 登录 Cookie（强烈建议）</h3>
      <div className="field">
        <label>Cookie {settings.steamCookieSet ? "（已配置）" : "（未配置，价格按美元+汇率换算）"}</label>
        <input
          type="text"
          value={form.steamCookie}
          placeholder="steamLoginSecure=xxxx; sessionid=yyyy"
          onChange={(e) => setForm({ ...form, steamCookie: e.target.value })}
        />
        <span className="hint">
          配置后价格直接是你 Steam 账号的真实币种价格（如港币），无需汇率换算；求购数据也有望获取。
          获取方法：浏览器登录 Steam → 打开 steamcommunity.com → 按 F12 → 上方选
          "Application/应用" 标签 → 左侧 Cookies → steamcommunity.com →
          找到 <b>steamLoginSecure</b> 和 <b>sessionid</b> 两行，把"值"按
          steamLoginSecure=值; sessionid=值 的格式拼起来粘贴到这里（留空则保持不变）
        </span>
      </div>

      <h3 style={{ fontSize: 14, marginTop: 20 }}>安全</h3>
      <div className="field">
        <label>管理口令（对应部署环境变量 ADMIN_TOKEN，未配置则无需填写）</label>
        <input type="password" value={adminToken} onChange={(e) => setAdminTokenState(e.target.value)} />
        <span className="hint">保存后浏览器会记住该口令，用于写操作鉴权</span>
      </div>

      <div className="flex mt8">
        <button className="btn primary" onClick={save} disabled={saving}>
          {saving ? "保存中…" : "保存设置"}
        </button>
      </div>

      {health && (
        <div className="muted mt8">
          <div>最近巡检：{health.health.lastRunAt ? fmtTime(health.health.lastRunAt) : "尚未运行"}</div>
          <div>
            最近成功：
            {health.health.lastSuccessAt ? fmtTime(health.health.lastSuccessAt) : "尚未成功"}
            （累计 {health.health.roundsRun} 轮，已推送 {health.health.pushed} 条）
          </div>
          {health.health.lastError && <div style={{ color: "var(--red)" }}>最近错误：{health.health.lastError}</div>}
        </div>
      )}
    </div>
  );
}
