import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../api/client.js";

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function NotificationBell({ token }) {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef(null);

  const unread = notifications.filter(n => !n.isRead).length;

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiFetch("/api/notifications", { token });
      setNotifications(data || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const markRead = async (id) => {
    try {
      await apiFetch(`/api/notifications/${id}/read`, { token, method: "POST" });
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    } catch { /* silent */ }
  };

  const markAllRead = async () => {
    try {
      await apiFetch("/api/notifications/read-all", { token, method: "POST" });
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    } catch { /* silent */ }
  };

  return (
    <div ref={dropdownRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => { setOpen(v => !v); if (!open) load(); }}
        style={{
          background: "none", border: "none", cursor: "pointer",
          fontSize: 18, position: "relative", padding: "4px 6px",
          color: "var(--text2)", lineHeight: 1,
        }}
        title="Notifications"
        aria-label="Notifications"
      >
        🔔
        {unread > 0 && (
          <span style={{
            position: "absolute", top: 0, right: 0,
            background: "var(--red, #ef4444)", color: "#fff",
            borderRadius: "50%", fontSize: 10, fontWeight: 700,
            minWidth: 16, height: 16, lineHeight: "16px",
            textAlign: "center", padding: "0 3px",
          }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: "absolute", right: 0, top: "calc(100% + 6px)",
          width: 320, maxHeight: 420, overflowY: "auto",
          background: "var(--bg2)", border: "1px solid var(--border)",
          borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
          zIndex: 9999,
        }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "10px 14px", borderBottom: "1px solid var(--border)", fontSize: 13, fontWeight: 600,
          }}>
            <span>Notifications</span>
            {unread > 0 && (
              <button onClick={markAllRead} style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 11, color: "var(--accent)", fontWeight: 600,
              }}>Mark all read</button>
            )}
          </div>

          {loading ? (
            <div style={{ padding: "24px 14px", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
              Loading…
            </div>
          ) : notifications.length === 0 ? (
            <div style={{ padding: "24px 14px", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
              No notifications yet.
            </div>
          ) : (
            notifications.map(n => (
              <div
                key={n.id}
                onClick={() => markRead(n.id)}
                style={{
                  padding: "10px 14px",
                  borderBottom: "1px solid var(--border2)",
                  background: n.isRead ? "transparent" : "rgba(99,102,241,0.06)",
                  cursor: "pointer",
                  transition: "background 0.15s",
                }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>
                    {n.entityType === "vault_version" ? "📎" : n.entityType === "rejection" ? "⚠️" : "📋"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: n.isRead ? 400 : 600, fontSize: 12, color: "var(--text)", marginBottom: 2 }}>
                      {n.title}
                    </div>
                    {n.body && (
                      <div style={{ fontSize: 11, color: "var(--text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {n.body}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 3 }}>
                      {timeAgo(n.createdAt)}
                    </div>
                  </div>
                  {!n.isRead && (
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", flexShrink: 0, marginTop: 4 }} />
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
