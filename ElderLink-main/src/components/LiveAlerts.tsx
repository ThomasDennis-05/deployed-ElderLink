"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type FallEvent = {
  id: string;
  resident_id: string | null;
  device_id: string | null;
  z_drop: number | null;
  doppler_spike: number | null;
  status: string | null;
  created_at: string;
  residents?: {
    full_name: string;
    room_number?: string | null;
  } | null;
};

export default function LiveAlerts() {
  const [alerts, setAlerts] = useState<FallEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);

  useEffect(() => {
    loadAlerts();

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
          console.log("New emergency alert:", payload);

          const newAlert = await getAlertWithResident(payload.new as FallEvent);

          if (newAlert) {
            setAlerts((current) => {
              const exists = current.some((alert) => alert.id === newAlert.id);

              if (exists) {
                return current;
              }

              return [newAlert, ...current];
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

          setAlerts((current) => {
            if (
              updated.status === "resolved" ||
              updated.status === "acknowledged"
            ) {
              return current.filter((alert) => alert.id !== updated.id);
            }

            return current.map((alert) =>
              alert.id === updated.id
                ? {
                    ...alert,
                    ...updated,
                  }
                : alert,
            );
          });
        },
      )
      .subscribe((status) => {
        console.log("Live emergency connection:", status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function loadAlerts() {
    setLoading(true);

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
      console.error("Failed to load alerts:", error);
      setAlerts([]);
      setLoading(false);
      return;
    }

    setAlerts((data || []) as FallEvent[]);
    setLoading(false);
  }

  async function getAlertWithResident(alert: FallEvent) {
    if (!alert.resident_id) {
      return alert;
    }

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
      console.error("Unable to load resident for alert:", error);

      return alert;
    }

    return data as FallEvent;
  }

  async function acknowledgeAlert(id: string) {
    setResolving(id);

    const { error } = await supabase
      .from("fall_events")
      .update({
        status: "resolved",
      })
      .eq("id", id);

    if (error) {
      console.error("Failed to resolve emergency:", error);

      setResolving(null);
      return;
    }

    setAlerts((current) => current.filter((alert) => alert.id !== id));

    setResolving(null);
  }

  function formatTime(date: string) {
    return new Date(date).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function formatDate(date: string) {
    return new Date(date).toLocaleDateString([], {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  return (
    <section className="w-full">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-slate-900">
              Emergency Monitoring
            </h2>

            <div className="flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-1.5">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  alerts.length > 0
                    ? "animate-pulse bg-red-500"
                    : "bg-green-500"
                }`}
              />

              <span
                className={`text-xs font-bold uppercase tracking-wide ${
                  alerts.length > 0 ? "text-red-700" : "text-green-700"
                }`}
              >
                {alerts.length > 0 ? "LIVE EMERGENCY" : "SYSTEM CLEAR"}
              </span>
            </div>
          </div>

          <p className="mt-1 text-sm text-slate-500">
            Real-time fall detection and emergency response
          </p>
        </div>

        <div className="rounded-xl bg-slate-50 px-4 py-3 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Active Alerts
          </p>

          <p
            className={`mt-1 text-2xl font-bold ${
              alerts.length > 0 ? "text-red-600" : "text-slate-900"
            }`}
          >
            {alerts.length}
          </p>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-700" />

          <p className="mt-4 text-sm text-slate-500">
            Connecting to emergency monitoring...
          </p>
        </div>
      )}

      {/* Empty */}
      {!loading && alerts.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-50">
            <span className="text-xl font-bold text-green-600">✓</span>
          </div>

          <h3 className="mt-4 text-lg font-bold text-slate-900">
            No Active Emergencies
          </h3>

          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            The emergency monitoring system is active and waiting for fall
            detection events.
          </p>

          <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-green-50 px-4 py-2 text-sm font-medium text-green-700">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            Live monitoring active
          </div>
        </div>
      )}

      {/* Alerts */}
      {!loading && alerts.length > 0 && (
        <div className="space-y-5">
          {alerts.map((alert) => (
            <article
              key={alert.id}
              className="overflow-hidden rounded-2xl border border-red-200 bg-white shadow-md"
            >
              {/* Emergency Banner */}
              <div className="border-b border-red-200 bg-red-50 px-5 py-4 sm:px-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-xl font-bold text-white">
                      !
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-red-900">
                          Fall Detected
                        </h3>

                        <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                      </div>

                      <p className="text-sm text-red-700">
                        Immediate attention required
                      </p>
                    </div>
                  </div>

                  <div className="rounded-lg bg-red-100 px-3 py-2 text-center">
                    <p className="text-xs font-medium uppercase tracking-wide text-red-600">
                      Alert Status
                    </p>

                    <p className="mt-0.5 text-sm font-bold text-red-800">
                      ACTIVE
                    </p>
                  </div>
                </div>
              </div>

              {/* Alert Details */}
              <div className="p-5 sm:p-6">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {/* Resident */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Resident
                    </p>

                    <p className="mt-2 font-bold text-slate-900">
                      {alert.residents?.full_name || "Unknown Resident"}
                    </p>

                    {alert.residents?.room_number && (
                      <p className="mt-1 text-sm text-slate-500">
                        Room {alert.residents.room_number}
                      </p>
                    )}
                  </div>

                  {/* Device */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Device
                    </p>

                    <p className="mt-2 font-bold text-slate-900">
                      {alert.device_id || "PHONE"}
                    </p>

                    <p className="mt-1 text-sm text-slate-500">
                      Fall detection sensor
                    </p>
                  </div>

                  {/* Time */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Detected
                    </p>

                    <p className="mt-2 font-bold text-slate-900">
                      {formatTime(alert.created_at)}
                    </p>

                    <p className="mt-1 text-sm text-slate-500">
                      {formatDate(alert.created_at)}
                    </p>
                  </div>

                  {/* Detection */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Detection
                    </p>

                    <p className="mt-2 font-bold text-red-600">Fall Event</p>

                    <p className="mt-1 text-sm text-slate-500">
                      Automatic detection
                    </p>
                  </div>
                </div>

                {/* Technical Information */}
                <div className="mt-5 rounded-xl border border-slate-200 p-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                        Event ID
                      </p>

                      <p className="mt-1 break-all font-mono text-xs text-slate-600">
                        {alert.id}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                        Z-Drop
                      </p>

                      <p className="mt-1 text-sm font-semibold text-slate-700">
                        {alert.z_drop ?? "—"}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                        Doppler
                      </p>

                      <p className="mt-1 text-sm font-semibold text-slate-700">
                        {alert.doppler_spike ?? "—"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Action */}
                <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      Emergency response required
                    </p>

                    <p className="mt-1 text-xs text-slate-500">
                      Confirm after the resident has been checked.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => acknowledgeAlert(alert.id)}
                    disabled={resolving === alert.id}
                    className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {resolving === alert.id
                      ? "Resolving..."
                      : "Acknowledge and Resolve Alert"}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
