"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

type FallEvent = {
  id: string;
  device_id: string;
  triggered_at: string;
  status: string;
  resident_id: string | null;
  resident_name?: string;
  room_number?: string | null;
};

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export default function LiveAlerts() {
  const [alerts, setAlerts] = useState<FallEvent[]>([]);
  const [loading, setLoading] = useState(true);

  function formatDevice(deviceId: string) {
    if (!deviceId) return "Phone";

    if (
      deviceId.toLowerCase().includes("phone") ||
      deviceId.toLowerCase().includes("sim")
    ) {
      return "Phone";
    }

    return deviceId;
  }

  useEffect(() => {
    async function loadAlerts() {
      const { data, error } = await supabase
        .from("fall_events")
        .select(
          `
          id,
          device_id,
          triggered_at,
          status,
          resident_id,
          residents (
            full_name,
            room_number
          )
        `,
        )
        .eq("status", "unresolved")
        .order("triggered_at", { ascending: false });

      if (error) {
        console.error("Failed to load fall alerts:", error);
        setLoading(false);
        return;
      }

      const formattedAlerts = (data || []).map((event: any) => ({
        id: event.id,
        device_id: event.device_id,
        triggered_at: event.triggered_at,
        status: event.status,
        resident_id: event.resident_id,
        resident_name: event.residents?.full_name || "Unknown resident",
        room_number: event.residents?.room_number || null,
      }));

      setAlerts(formattedAlerts);
      setLoading(false);
    }

    loadAlerts();
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("live-fall-alerts")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "fall_events",
        },
        async (payload) => {
          const event = payload.new as FallEvent;

          let residentName = "Unknown resident";
          let roomNumber: string | null = null;

          if (event.resident_id) {
            const { data: resident, error } = await supabase
              .from("residents")
              .select("full_name, room_number")
              .eq("id", event.resident_id)
              .single();

            if (!error && resident) {
              residentName = resident.full_name;
              roomNumber = resident.room_number;
            }
          }

          const newAlert: FallEvent = {
            id: event.id,
            device_id: event.device_id,
            triggered_at: event.triggered_at,
            status: event.status,
            resident_id: event.resident_id,
            resident_name: residentName,
            room_number: roomNumber,
          };

          setAlerts((current) => {
            if (current.some((alert) => alert.id === newAlert.id)) {
              return current;
            }

            return [newAlert, ...current];
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "fall_events",
        },
        async (payload) => {
          const event = payload.new as FallEvent;

          if (event.status !== "unresolved") {
            setAlerts((current) =>
              current.filter((alert) => alert.id !== event.id),
            );

            return;
          }

          let residentName = "Unknown resident";
          let roomNumber: string | null = null;

          if (event.resident_id) {
            const { data: resident, error } = await supabase
              .from("residents")
              .select("full_name, room_number")
              .eq("id", event.resident_id)
              .single();

            if (!error && resident) {
              residentName = resident.full_name;
              roomNumber = resident.room_number;
            }
          }

          const updatedAlert: FallEvent = {
            id: event.id,
            device_id: event.device_id,
            triggered_at: event.triggered_at,
            status: event.status,
            resident_id: event.resident_id,
            resident_name: residentName,
            room_number: roomNumber,
          };

          setAlerts((current) =>
            current.map((alert) =>
              alert.id === updatedAlert.id ? updatedAlert : alert,
            ),
          );
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function acknowledgeAlert(id: string) {
    const { error } = await supabase
      .from("fall_events")
      .update({
        status: "acknowledged",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      console.error("Failed to acknowledge alert:", error);
      return;
    }

    setAlerts((current) => current.filter((alert) => alert.id !== id));
  }

  return (
    <div className="rounded-2xl border border-red-200 bg-white p-5 shadow-sm">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-red-700">
            🚨 Emergency Dashboard
          </h2>

          <p className="mt-1 text-sm text-gray-500">
            Live fall detection alerts
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`h-3 w-3 rounded-full ${
              alerts.length > 0 ? "bg-red-500" : "bg-green-500"
            }`}
          />

          <span className="text-sm font-bold">
            {alerts.length > 0 ? `${alerts.length} Active` : "All Clear"}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl bg-gray-50 py-10 text-center text-sm text-gray-500">
          Loading alerts...
        </div>
      ) : alerts.length === 0 ? (
        <div className="rounded-xl border border-green-200 bg-green-50 p-8 text-center">
          <div className="text-4xl">✅</div>

          <p className="mt-3 font-bold text-green-700">All Clear</p>

          <p className="mt-1 text-sm text-green-600">
            Monitoring rooms for fall alerts...
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className="overflow-hidden rounded-2xl border-2 border-red-300 bg-red-50"
            >
              <div className="border-b border-red-200 bg-red-100 px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-red-700">
                      🚨 Fall Detected
                    </h3>

                    <p className="mt-1 text-sm font-semibold text-red-600">
                      Action Required
                    </p>
                  </div>

                  <span className="rounded-full bg-red-200 px-3 py-1 text-xs font-bold uppercase text-red-800">
                    {alert.status}
                  </span>
                </div>
              </div>

              <div className="p-5">
                <div className="rounded-xl border border-red-100 bg-white p-4 shadow-sm">
                  <p className="text-xs font-bold uppercase tracking-wider text-gray-400">
                    Resident
                  </p>

                  <p className="mt-1 text-2xl font-bold text-gray-900">
                    {alert.resident_name || "Unknown resident"}
                  </p>

                  {alert.room_number && (
                    <p className="mt-1 text-sm font-medium text-gray-500">
                      🛏️ Room {alert.room_number}
                    </p>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-white p-4">
                    <p className="text-xs font-bold uppercase tracking-wider text-gray-400">
                      Device
                    </p>

                    <p className="mt-1 font-bold text-gray-900">
                      📱 {formatDevice(alert.device_id)}
                    </p>
                  </div>

                  <div className="rounded-xl bg-white p-4">
                    <p className="text-xs font-bold uppercase tracking-wider text-gray-400">
                      Time
                    </p>

                    <p className="mt-1 font-bold text-gray-900">
                      {new Date(alert.triggered_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>

                    <p className="mt-1 text-xs text-gray-500">
                      {new Date(alert.triggered_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => acknowledgeAlert(alert.id)}
                  className="mt-5 w-full rounded-xl bg-green-600 px-4 py-4 font-bold text-white transition hover:bg-green-700"
                >
                  ✓ Acknowledge Alert
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
