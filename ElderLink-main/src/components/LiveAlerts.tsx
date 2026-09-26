"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Resident = {
  full_name: string;
  room_number: string | null;
};

type FallEvent = {
  id: string;
  resident_id: string | null;
  device_id: string | null;
  z_drop: number | null;
  doppler_spike: number | null;
  status: string | null;
  created_at: string;
  residents?: Resident | Resident[] | null;
};

export default function LiveAlerts() {
  const [alerts, setAlerts] = useState<FallEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState("Connecting");

  useEffect(() => {
    loadAlerts();

    const channel = supabase
      .channel("elderlink-live-emergency")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "fall_events",
        },
        async (payload) => {
          console.log("New fall event:", payload.new);

          const event = await loadSingleAlert(payload.new as FallEvent);

          if (!event) {
            return;
          }

          setAlerts((current) => {
            const alreadyExists = current.some(
              (alert) => alert.id === event.id,
            );

            if (alreadyExists) {
              return current;
            }

            return [event, ...current];
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
        (payload) => {
          const updated = payload.new as FallEvent;

          if (
            updated.status === "resolved" ||
            updated.status === "acknowledged"
          ) {
            setAlerts((current) =>
              current.filter((alert) => alert.id !== updated.id),
            );

            return;
          }

          setAlerts((current) =>
            current.map((alert) =>
              alert.id === updated.id
                ? {
                    ...alert,
                    ...updated,
                  }
                : alert,
            ),
          );
        },
      )
      .subscribe((status) => {
        console.log("Emergency realtime status:", status);

        if (status === "SUBSCRIBED") {
          setConnectionStatus("Connected");
        } else if (status === "CHANNEL_ERROR") {
          setConnectionStatus("Connection Error");
        } else if (status === "TIMED_OUT") {
          setConnectionStatus("Timed Out");
        } else {
          setConnectionStatus("Connecting");
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function loadAlerts() {
    setLoading(true);

    try {
      const { data, error } = await supabase
        .from("fall_events")
        .select(
          `
          id,
          resident_id,
          device_id,
          z_drop,
          doppler_spike,
          status,
          created_at,
          residents (
            full_name,
            room_number
          )
        `,
        )
        .in("status", ["unresolved", "active"])
        .order("created_at", {
          ascending: false,
        });

      if (error) {
        console.error("Failed to load emergency alerts:", error);

        setAlerts([]);
        return;
      }

      setAlerts((data || []) as FallEvent[]);
    } catch (error) {
      console.error(error);
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadSingleAlert(alert: FallEvent) {
    try {
      const { data, error } = await supabase
        .from("fall_events")
        .select(
          `
            id,
            resident_id,
            device_id,
            z_drop,
            doppler_spike,
            status,
            created_at,
            residents (
              full_name,
              room_number
            )
          `,
        )
        .eq("id", alert.id)
        .single();

      if (error) {
        console.error("Failed to load emergency details:", error);

        return alert;
      }

      return data as FallEvent;
    } catch (error) {
      console.error(error);
      return alert;
    }
  }

  async function resolveAlert(alertId: string) {
    if (resolvingId) {
      return;
    }

    setResolvingId(alertId);

    try {
      const { error } = await supabase
        .from("fall_events")
        .update({
          status: "resolved",
        })
        .eq("id", alertId);

      if (error) {
        console.error("Failed to resolve alert:", error);

        return;
      }

      setAlerts((current) => current.filter((alert) => alert.id !== alertId));
    } catch (error) {
      console.error(error);
    } finally {
      setResolvingId(null);
    }
  }

  function getResident(alert: FallEvent) {
    if (!alert.residents) {
      return null;
    }

    if (Array.isArray(alert.residents)) {
      return alert.residents[0] || null;
    }

    return alert.residents;
  }

  function formatTime(timestamp: string) {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function formatDate(timestamp: string) {
    return new Date(timestamp).toLocaleDateString([], {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  return (
    <section className="w-full">
      {/* Header */}
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">
                Emergency Monitoring
              </h1>

              {alerts.length > 0 ? (
                <div className="flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-1.5">
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />

                  <span className="text-xs font-bold uppercase tracking-wide text-red-700">
                    Live Emergency
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-full border border-green-200 bg-green-50 px-3 py-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-green-500" />

                  <span className="text-xs font-bold uppercase tracking-wide text-green-700">
                    System Clear
                  </span>
                </div>
              )}
            </div>

            <p className="mt-2 text-sm text-slate-500">
              Real-time fall detection and emergency response
            </p>

            <div className="mt-3 flex items-center gap-2 text-xs">
              <span
                className={`h-2 w-2 rounded-full ${
                  connectionStatus === "Connected"
                    ? "bg-green-500"
                    : connectionStatus === "Connection Error"
                      ? "bg-red-500"
                      : "bg-amber-500"
                }`}
              />

              <span className="text-slate-500">
                Realtime:{" "}
                <span className="font-medium text-slate-700">
                  {connectionStatus}
                </span>
              </span>
            </div>
          </div>

          <div className="min-w-[140px] rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Active Alerts
            </p>

            <p
              className={`mt-1 text-3xl font-bold ${
                alerts.length > 0 ? "text-red-600" : "text-slate-900"
              }`}
            >
              {alerts.length}
            </p>
          </div>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-700" />

          <p className="mt-4 text-sm text-slate-500">
            Loading emergency monitoring...
          </p>
        </div>
      )}

      {/* No alerts */}
      {!loading && alerts.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-green-200 bg-green-50">
            <span className="h-4 w-4 rounded-full bg-green-500" />
          </div>

          <h2 className="mt-5 text-lg font-bold text-slate-900">
            No Active Emergencies
          </h2>

          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">
            The emergency monitoring system is active. New fall events will
            appear here automatically.
          </p>

          <div className="mx-auto mt-5 flex w-fit items-center gap-2 rounded-full border border-green-200 bg-green-50 px-4 py-2">
            <span className="h-2 w-2 rounded-full bg-green-500" />

            <span className="text-sm font-medium text-green-700">
              Live monitoring active
            </span>
          </div>
        </div>
      )}

      {/* Active Alerts */}
      {!loading && alerts.length > 0 && (
        <div className="space-y-5">
          {alerts.map((alert) => {
            const resident = getResident(alert);

            return (
              <article
                key={alert.id}
                className="overflow-hidden rounded-2xl border border-red-200 bg-white shadow-md"
              >
                {/* Emergency Header */}
                <div className="border-b border-red-200 bg-red-50 px-5 py-5 sm:px-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-4">
                      <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-600">
                        <span className="h-3 w-3 rounded-full bg-white" />

                        <span className="absolute inset-0 animate-ping rounded-full bg-red-500 opacity-30" />
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="text-lg font-bold text-red-900">
                            Live Emergency
                          </h2>

                          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                        </div>

                        <p className="mt-1 text-sm text-red-700">
                          Fall detection event requires immediate attention
                        </p>
                      </div>
                    </div>

                    <div className="w-fit rounded-lg border border-red-200 bg-white px-4 py-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-red-500">
                        Status
                      </p>

                      <p className="mt-0.5 text-sm font-bold text-red-700">
                        ACTIVE
                      </p>
                    </div>
                  </div>
                </div>

                {/* Details */}
                <div className="p-5 sm:p-6">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {/* Resident */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Resident
                      </p>

                      <p className="mt-2 text-base font-bold text-slate-900">
                        {resident?.full_name || "Unknown Resident"}
                      </p>

                      {resident?.room_number && (
                        <p className="mt-1 text-sm text-slate-500">
                          Room {resident.room_number}
                        </p>
                      )}
                    </div>

                    {/* Detection Time */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Detected
                      </p>

                      <p className="mt-2 text-base font-bold text-slate-900">
                        {formatTime(alert.created_at)}
                      </p>

                      <p className="mt-1 text-sm text-slate-500">
                        {formatDate(alert.created_at)}
                      </p>
                    </div>

                    {/* Device */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Device
                      </p>

                      <p className="mt-2 text-base font-bold text-slate-900">
                        {alert.device_id || "PHONE"}
                      </p>

                      <p className="mt-1 text-sm text-slate-500">
                        Mobile detection
                      </p>
                    </div>

                    {/* Detection Type */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Detection
                      </p>

                      <p className="mt-2 text-base font-bold text-red-600">
                        Fall Event
                      </p>

                      <p className="mt-1 text-sm text-slate-500">Automatic</p>
                    </div>
                  </div>

                  {/* Technical Details */}
                  <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Event Details
                    </p>

                    <div className="mt-4 grid gap-4 sm:grid-cols-3">
                      <div>
                        <p className="text-xs text-slate-400">Event ID</p>

                        <p className="mt-1 break-all font-mono text-xs text-slate-600">
                          {alert.id}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs text-slate-400">Z-Drop</p>

                        <p className="mt-1 text-sm font-semibold text-slate-700">
                          {alert.z_drop ?? "Not available"}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs text-slate-400">Doppler Spike</p>

                        <p className="mt-1 text-sm font-semibold text-slate-700">
                          {alert.doppler_spike ?? "Not available"}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Action */}
                  <div className="mt-5 flex flex-col gap-4 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">
                        Immediate attention required
                      </p>

                      <p className="mt-1 text-xs text-slate-500">
                        Verify the resident before resolving this alert.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => resolveAlert(alert.id)}
                      disabled={resolvingId === alert.id}
                      className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {resolvingId === alert.id
                        ? "Resolving..."
                        : "Acknowledge and Resolve"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
