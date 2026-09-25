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
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Dashboard Header */}
      <div className="border-b border-slate-200 bg-slate-50 px-6 py-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900">
              Emergency Monitoring
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Real-time fall detection and response monitoring
            </p>
          </div>

          <div
            className={`flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold ${
              alerts.length > 0
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
          >
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                alerts.length > 0 ? "bg-red-500" : "bg-emerald-500"
              }`}
            />

            {alerts.length > 0
              ? `${alerts.length} Active Alert${alerts.length === 1 ? "" : "s"}`
              : "System Clear"}
          </div>
        </div>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="px-6 py-12 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />

          <p className="mt-4 text-sm text-slate-500">
            Loading emergency alerts...
          </p>
        </div>
      ) : alerts.length === 0 ? (
        /* No Alerts */
        <div className="px-6 py-12">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border-2 border-emerald-500 text-emerald-600">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>

            <h3 className="mt-4 text-lg font-bold text-emerald-800">
              No Active Emergencies
            </h3>

            <p className="mx-auto mt-1 max-w-md text-sm text-emerald-700">
              The monitoring system is active and currently has no unresolved
              fall detection alerts.
            </p>
          </div>
        </div>
      ) : (
        /* Active Alerts */
        <div className="space-y-5 p-6">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className="overflow-hidden rounded-2xl border border-red-200 bg-white shadow-sm"
            >
              {/* Alert Header */}
              <div className="border-b border-red-200 bg-red-50 px-5 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-600 text-sm font-bold text-white">
                        !
                      </span>

                      <div>
                        <h3 className="text-lg font-bold text-red-800">
                          Fall Detected
                        </h3>

                        <p className="text-sm text-red-600">
                          Immediate attention required
                        </p>
                      </div>
                    </div>
                  </div>

                  <span className="rounded-full border border-red-300 bg-white px-3 py-1 text-xs font-bold uppercase tracking-wide text-red-700">
                    Unresolved
                  </span>
                </div>
              </div>

              {/* Alert Information */}
              <div className="p-5">
                <div className="grid gap-4 md:grid-cols-3">
                  {/* Resident */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Resident
                    </p>

                    <p className="mt-2 text-lg font-bold text-slate-900">
                      {alert.resident_name || "Unknown resident"}
                    </p>

                    {alert.room_number && (
                      <p className="mt-1 text-sm text-slate-500">
                        Room {alert.room_number}
                      </p>
                    )}
                  </div>

                  {/* Device */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Detection Source
                    </p>

                    <p className="mt-2 text-lg font-bold text-slate-900">
                      {formatDevice(alert.device_id)}
                    </p>

                    <p className="mt-1 text-sm text-slate-500">
                      Fall detection device
                    </p>
                  </div>

                  {/* Time */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Detected
                    </p>

                    <p className="mt-2 text-lg font-bold text-slate-900">
                      {new Date(alert.triggered_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>

                    <p className="mt-1 text-sm text-slate-500">
                      {new Date(alert.triggered_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                {/* Alert ID */}
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Alert Reference
                    </p>

                    <p className="mt-1 font-mono text-xs text-slate-500">
                      {alert.id}
                    </p>
                  </div>

                  <span className="text-xs font-medium text-red-600">
                    Awaiting staff acknowledgement
                  </span>
                </div>

                {/* Acknowledge */}
                <button
                  onClick={() => acknowledgeAlert(alert.id)}
                  className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-3.5 text-sm font-bold text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
                >
                  Acknowledge and Resolve Alert
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
