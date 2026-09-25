"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

// Define the shape of our data
interface FallEvent {
  id: string;
  device_id: string;
  triggered_at: string;
  status: string;
}

export default function LiveAlerts() {
  const [alerts, setAlerts] = useState<FallEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Initialize the browser client (safe to use public keys here)
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  useEffect(() => {
    // 1. Load any alerts that are already unresolved (e.g. staff just opened the tab)
    async function loadExisting() {
      const { data, error } = await supabase
        .from("fall_events")
        .select("id, device_id, triggered_at, status")
        .eq("status", "unresolved")
        .order("triggered_at", { ascending: false });

      if (!error && data) setAlerts(data as FallEvent[]);
      setLoading(false);
    }
    loadExisting();

    // 2. Listen for new falls in real time
    const channel = supabase
      .channel("live-radar-alerts")
      .on(
        "postgres_changes",
        {
          event: "INSERT", // Only listen when a new fall is added
          schema: "public",
          table: "fall_events",
        },
        (payload) => {
          console.log("🚨 NEW FALL DETECTED:", payload.new);
          // Add the new alert to the top of the list instantly
          setAlerts((currentAlerts) => [
            payload.new as FallEvent,
            ...currentAlerts,
          ]);
        },
      )
      // 3. Listen for updates too, so acknowledged alerts drop off live for everyone
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "fall_events",
        },
        (payload) => {
          const updated = payload.new as FallEvent;
          setAlerts((currentAlerts) =>
            updated.status === "unresolved"
              ? currentAlerts.map((a) => (a.id === updated.id ? updated : a))
              : currentAlerts.filter((a) => a.id !== updated.id),
          );
        },
      )
      .subscribe();

    // Cleanup the subscription when the component unmounts
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  async function handleAcknowledge(id: string) {
    // Optimistic UI update — remove immediately, don't wait for server round trip
    setAlerts((currentAlerts) => currentAlerts.filter((a) => a.id !== id));

    const { error } = await supabase
      .from("fall_events")
      .update({ status: "acknowledged", resolved_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      console.error("Failed to acknowledge alert:", error);
    }
  }

  return (
    <div className="p-6 bg-red-50 rounded-xl border border-red-200">
      <h2 className="text-2xl font-bold text-red-700 mb-4 animate-pulse">
        Live Emergency Dashboard
      </h2>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading alerts...</p>
      ) : alerts.length === 0 ? (
        <p className="text-gray-600 font-medium">
          All clear. Monitoring rooms...
        </p>
      ) : (
        <ul className="space-y-4">
          {alerts.map((alert) => (
            <li
              key={alert.id}
              className="p-4 bg-white border border-red-300 rounded-lg shadow-md"
            >
              <div className="flex justify-between items-center">
                <span className="font-bold text-lg text-gray-900">
                  Room: {alert.device_id}
                </span>
                <span className="text-sm font-medium text-red-600 bg-red-100 px-3 py-1 rounded-full">
                  Action Required
                </span>
              </div>
              <p className="text-sm text-gray-500 mt-2">
                Time: {new Date(alert.triggered_at).toLocaleTimeString()}
              </p>
              <button
                onClick={() => handleAcknowledge(alert.id)}
                className="mt-3 w-full py-2 rounded-lg bg-[#357366] text-white text-sm font-semibold hover:bg-[#2c5f54] transition-all active:scale-95"
              >
                Acknowledge
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
