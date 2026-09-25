"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

interface FallEvent {
  id: string;
  device_id: string;
  triggered_at: string;
  status: string;
}

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export default function LiveAlerts() {
  const [alerts, setAlerts] = useState<FallEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState("Connecting...");

  useEffect(() => {
    let mounted = true;

    async function loadExisting() {
      const { data, error } = await supabase
        .from("fall_events")
        .select("id, device_id, triggered_at, status")
        .eq("status", "unresolved")
        .order("triggered_at", {
          ascending: false,
        });

      if (!mounted) {
        return;
      }

      if (error) {
        console.error("Failed to load fall alerts:", error);
      } else if (data) {
        setAlerts(data as FallEvent[]);
      }

      setLoading(false);
    }

    void loadExisting();

    const channel = supabase
      .channel("live-fall-alerts")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "fall_events",
        },
        (payload) => {
          console.log("🚨 NEW FALL EVENT:", payload.new);

          const newAlert = payload.new as FallEvent;

          if (newAlert.status !== "unresolved") {
            return;
          }

          setAlerts((currentAlerts) => {
            if (currentAlerts.some((alert) => alert.id === newAlert.id)) {
              return currentAlerts;
            }

            return [newAlert, ...currentAlerts];
          });

          if (
            typeof window !== "undefined" &&
            "Notification" in window &&
            Notification.permission === "granted"
          ) {
            new Notification("🚨 ElderLink Fall Alert", {
              body: `Fall detected from ${newAlert.device_id}`,
            });
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "fall_events",
        },
        (payload) => {
          const updated = payload.new as FallEvent;

          setAlerts((currentAlerts) => {
            if (updated.status === "unresolved") {
              const exists = currentAlerts.some(
                (alert) => alert.id === updated.id,
              );

              if (exists) {
                return currentAlerts.map((alert) =>
                  alert.id === updated.id ? updated : alert,
                );
              }

              return [updated, ...currentAlerts];
            }

            return currentAlerts.filter((alert) => alert.id !== updated.id);
          });
        },
      )
      .subscribe((status) => {
        console.log("Fall alert realtime status:", status);

        if (!mounted) {
          return;
        }

        if (status === "SUBSCRIBED") {
          setConnectionStatus("🟢 Live monitoring connected");
        } else if (status === "CHANNEL_ERROR") {
          setConnectionStatus("🔴 Live monitoring connection error");
        } else if (status === "TIMED_OUT") {
          setConnectionStatus("🟠 Live monitoring timed out");
        } else {
          setConnectionStatus(status);
        }
      });

    return () => {
      mounted = false;
      void supabase.removeChannel(channel);
    };
  }, []);

  async function handleAcknowledge(id: string) {
    setAlerts((currentAlerts) =>
      currentAlerts.filter((alert) => alert.id !== id),
    );

    const { error } = await supabase
      .from("fall_events")
      .update({
        status: "acknowledged",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      console.error("Failed to acknowledge alert:", error);
    }
  }

  async function enableNotifications() {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return;
    }

    const permission = await Notification.requestPermission();

    if (permission === "granted") {
      setConnectionStatus(
        "🟢 Live monitoring connected • Notifications enabled",
      );
    }
  }

  const notificationsAvailable =
    typeof window !== "undefined" && "Notification" in window;

  const notificationsEnabled =
    notificationsAvailable && Notification.permission === "granted";

  return (
    <div className="p-6 bg-red-50 rounded-xl border border-red-200">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-2xl font-bold text-red-700 animate-pulse">
            Live Emergency Dashboard
          </h2>

          <p className="text-xs text-gray-600 mt-1">{connectionStatus}</p>
        </div>

        {notificationsAvailable && !notificationsEnabled && (
          <button
            onClick={enableNotifications}
            className="text-xs px-3 py-2 rounded-lg bg-white border border-red-200 text-red-700 font-semibold hover:bg-red-100"
          >
            Enable notifications
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading alerts...</p>
      ) : alerts.length === 0 ? (
        <div className="bg-white rounded-lg p-4 border border-green-200">
          <p className="text-green-700 font-medium">
            All clear. Monitoring rooms...
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {alerts.map((alert) => (
            <li
              key={alert.id}
              className="p-4 bg-white border-2 border-red-300 rounded-lg shadow-md"
            >
              <div className="flex justify-between items-center gap-3">
                <span className="font-bold text-lg text-gray-900">
                  🚨 Fall Detected
                </span>

                <span className="text-sm font-medium text-red-600 bg-red-100 px-3 py-1 rounded-full">
                  Action Required
                </span>
              </div>

              <div className="mt-3 space-y-1">
                <p className="text-sm text-gray-700">
                  <strong>Device:</strong> {alert.device_id}
                </p>

                <p className="text-sm text-gray-500">
                  <strong>Time:</strong>{" "}
                  {new Date(alert.triggered_at).toLocaleString()}
                </p>

                <p className="text-sm text-red-600 font-semibold">
                  Status: Unresolved
                </p>
              </div>

              <button
                onClick={() => handleAcknowledge(alert.id)}
                className="mt-4 w-full py-2.5 rounded-lg bg-[#357366] text-white text-sm font-semibold hover:bg-[#2c5f54] transition-all active:scale-95"
              >
                Acknowledge Fall
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
