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

  // ---------------------------------------------------------
  // LOAD EXISTING UNRESOLVED ALERTS
  // ---------------------------------------------------------

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

  // ---------------------------------------------------------
  // REALTIME NEW ALERTS
  // ---------------------------------------------------------

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
          let roomNumber = null;

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

          setAlerts((current) => [newAlert, ...current]);
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
          let roomNumber = null;

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

  // ---------------------------------------------------------
  // ACKNOWLEDGE ALERT
  // ---------------------------------------------------------

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

  // ---------------------------------------------------------
  // FORMAT TIME
  // ---------------------------------------------------------

  function formatTime(timestamp: string) {
    return new Date(timestamp).toLocaleString();
  }

  // ---------------------------------------------------------
  // UI
  // ---------------------------------------------------------

  return (
    <div className="rounded-xl border border-red-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-red-700">
            🚨 Emergency Dashboard
          </h2>

          <p className="text-sm text-gray-500">Live fall detection alerts</p>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`h-3 w-3 rounded-full ${
              alerts.length > 0 ? "bg-red-500" : "bg-green-500"
            }`}
          />

          <span className="text-sm font-medium">
            {alerts.length > 0 ? `${alerts.length} Active` : "All Clear"}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-gray-500">
          Loading alerts...
        </div>
      ) : alerts.length === 0 ? (
        <div className="rounded-lg bg-green-50 p-6 text-center">
          <div className="text-3xl">✅</div>

          <p className="mt-2 font-semibold text-green-700">All clear</p>

          <p className="text-sm text-green-600">
            Monitoring rooms for fall alerts...
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className="rounded-xl border-2 border-red-300 bg-red-50 p-5"
            >
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-bold text-red-700">
                    🚨 Fall Detected
                  </h3>

                  <p className="text-sm font-semibold text-red-600">
                    Action Required
                  </p>
                </div>

                <span className="rounded-full bg-red-200 px-3 py-1 text-xs font-bold text-red-800">
                  {alert.status}
                </span>
              </div>

              {/* RESIDENT NAME */}
              <div className="mb-4 rounded-lg bg-white p-4 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Resident
                </p>

                <p className="mt-1 text-xl font-bold text-gray-900">
                  {alert.resident_name || "Unknown resident"}
                </p>

                {alert.room_number && (
                  <p className="mt-1 text-sm text-gray-600">
                    Room {alert.room_number}
                  </p>
                )}
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="font-medium text-gray-500">Device</span>

                  <span className="font-semibold text-gray-900">
                    {alert.device_id}
                  </span>
                </div>

                <div className="flex justify-between">
                  <span className="font-medium text-gray-500">Time</span>

                  <span className="font-semibold text-gray-900">
                    {formatTime(alert.triggered_at)}
                  </span>
                </div>
              </div>

              <button
                onClick={() => acknowledgeAlert(alert.id)}
                className="mt-5 w-full rounded-lg bg-green-600 px-4 py-3 font-semibold text-white hover:bg-green-700"
              >
                ✓ Acknowledge Alert
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
