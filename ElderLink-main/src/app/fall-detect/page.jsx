"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

export default function FallDetectionPage() {
  const [residents, setResidents] = useState([]);
  const [selectedResidentId, setSelectedResidentId] = useState("");
  const [residentsLoading, setResidentsLoading] = useState(true);

  const [monitoring, setMonitoring] = useState(false);
  const [magnitude, setMagnitude] = useState(null);
  const [motionState, setMotionState] = useState("—");

  const [alertActive, setAlertActive] = useState(false);
  const [countdown, setCountdown] = useState(30);

  const [log, setLog] = useState([]);

  const spikeDetectedAt = useRef(null);
  const countdownTimer = useRef(null);
  const motionHandlerRef = useRef(null);

  // ---------------------------------------------------------
  // LOAD RESIDENTS
  // ---------------------------------------------------------

  useEffect(() => {
    async function loadResidents() {
      setResidentsLoading(true);

      const { data, error } = await supabase
        .from("residents")
        .select("id, full_name, room_number, status")
        .eq("status", "active")
        .order("full_name");

      if (error) {
        console.error("Failed to load residents:", error);
        addLog(`Failed to load residents: ${error.message}`);
      } else {
        setResidents(data || []);

        if (data && data.length > 0) {
          setSelectedResidentId(data[0].id);
        }
      }

      setResidentsLoading(false);
    }

    loadResidents();
  }, []);

  // ---------------------------------------------------------
  // HELPER
  // ---------------------------------------------------------

  function addLog(msg) {
    setLog((prev) =>
      [
        {
          time: new Date().toLocaleTimeString(),
          msg,
        },
        ...prev,
      ].slice(0, 20),
    );
  }

  const selectedResident = residents.find(
    (resident) => resident.id === selectedResidentId,
  );

  // ---------------------------------------------------------
  // SEND FALL EVENT
  // ---------------------------------------------------------

  async function sendFallEvent() {
    if (!selectedResidentId) {
      addLog("Please select a resident first");
      return false;
    }

    try {
      const { error } = await supabase.from("fall_events").insert({
        resident_id: selectedResidentId,
        device_id: "PHONE-SIM-01",
        z_drop: 1.8,
        doppler_spike: 0,
        status: "unresolved",
      });

      if (error) {
        addLog(`Failed to send event: ${error.message}`);
        console.error("Fall event error:", error);
        return false;
      }

      addLog(
        `🚨 Fall alert sent for ${selectedResident?.full_name || "resident"}`,
      );

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";

      addLog(`Failed to send event: ${message}`);

      return false;
    }
  }

  // ---------------------------------------------------------
  // FALL DETECTION
  // ---------------------------------------------------------

  const triggerFallSequence = useCallback(
    (source) => {
      setAlertActive((current) => {
        if (current) {
          return current;
        }

        addLog(`🚨 Fall pattern detected (${source})`);
        setCountdown(30);

        if (countdownTimer.current) {
          clearInterval(countdownTimer.current);
        }

        countdownTimer.current = setInterval(() => {
          setCountdown((currentCountdown) => {
            if (currentCountdown <= 1) {
              if (countdownTimer.current) {
                clearInterval(countdownTimer.current);
                countdownTimer.current = null;
              }

              addLog("No response — sending alert to staff");

              void sendFallEvent();

              setAlertActive(false);

              return 30;
            }

            return currentCountdown - 1;
          });
        }, 1000);

        return true;
      });
    },
    [selectedResidentId, selectedResident],
  );

  // ---------------------------------------------------------
  // PHONE ACCELEROMETER
  // ---------------------------------------------------------

  const handleMotion = useCallback(
    (event) => {
      const acc = event.accelerationIncludingGravity;

      if (!acc || acc.x === null || acc.y === null || acc.z === null) {
        return;
      }

      const mag =
        Math.sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z) / 9.81;

      setMagnitude(mag);

      // Strong movement / impact
      if (mag > 2.5) {
        setMotionState("Impact spike");
        spikeDetectedAt.current = Date.now();
      }

      // Sudden stillness after impact
      else if (
        mag < 1.3 &&
        spikeDetectedAt.current &&
        Date.now() - spikeDetectedAt.current < 2000
      ) {
        setMotionState("Stillness after spike");

        triggerFallSequence("accelerometer");

        spikeDetectedAt.current = null;
      } else {
        setMotionState("Normal");
      }
    },
    [triggerFallSequence],
  );

  // ---------------------------------------------------------
  // START MONITORING
  // ---------------------------------------------------------

  async function startMonitoring() {
    if (!selectedResidentId) {
      addLog("Please select a resident before starting monitoring");
      return;
    }

    if (
      typeof DeviceMotionEvent !== "undefined" &&
      typeof DeviceMotionEvent.requestPermission === "function"
    ) {
      try {
        const permission = await DeviceMotionEvent.requestPermission();

        if (permission !== "granted") {
          addLog("Motion permission denied");
          return;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";

        addLog(`Permission request failed: ${message}`);
        return;
      }
    }

    motionHandlerRef.current = handleMotion;

    window.addEventListener("devicemotion", motionHandlerRef.current);

    setMonitoring(true);

    addLog(
      `Monitoring started for ${
        selectedResident?.full_name || "selected resident"
      }`,
    );
  }

  // ---------------------------------------------------------
  // STOP MONITORING
  // ---------------------------------------------------------

  function stopMonitoring() {
    if (motionHandlerRef.current) {
      window.removeEventListener("devicemotion", motionHandlerRef.current);

      motionHandlerRef.current = null;
    }

    if (countdownTimer.current) {
      clearInterval(countdownTimer.current);
      countdownTimer.current = null;
    }

    setMonitoring(false);
    setMagnitude(null);
    setMotionState("—");
    setAlertActive(false);
    setCountdown(30);

    addLog("Monitoring stopped");
  }

  // ---------------------------------------------------------
  // I'M OK
  // ---------------------------------------------------------

  function handleImOk() {
    if (countdownTimer.current) {
      clearInterval(countdownTimer.current);
      countdownTimer.current = null;
    }

    setAlertActive(false);
    setCountdown(30);

    addLog("I'm OK — no alert sent");
  }

  // ---------------------------------------------------------
  // SEND ALERT NOW
  // ---------------------------------------------------------

  async function handleSendAlert() {
    if (countdownTimer.current) {
      clearInterval(countdownTimer.current);
      countdownTimer.current = null;
    }

    const success = await sendFallEvent();

    if (success) {
      addLog("Alert confirmed and sent to staff");
    }

    setAlertActive(false);
    setCountdown(30);
  }

  // ---------------------------------------------------------
  // CLEANUP
  // ---------------------------------------------------------

  useEffect(() => {
    return () => {
      if (motionHandlerRef.current) {
        window.removeEventListener("devicemotion", motionHandlerRef.current);
      }

      if (countdownTimer.current) {
        clearInterval(countdownTimer.current);
      }
    };
  }, []);

  // ---------------------------------------------------------
  // UI
  // ---------------------------------------------------------

  return (
    <div
      style={{
        maxWidth: 420,
        margin: "0 auto",
        padding: 20,
        fontFamily: "sans-serif",
      }}
    >
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>
        ElderLink Fall Detection
      </h1>

      <p
        style={{
          color: "#666",
          fontSize: 13,
          marginBottom: 20,
        }}
      >
        Phone accelerometer acting as an in-room sensor
      </p>

      {/* ---------------------------------------------------
          RESIDENT SELECTION
      --------------------------------------------------- */}

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 18,
          marginBottom: 16,
        }}
      >
        <label
          style={{
            display: "block",
            fontSize: 13,
            fontWeight: 700,
            marginBottom: 7,
          }}
        >
          Select Resident
        </label>

        <select
          value={selectedResidentId}
          onChange={(e) => {
            if (monitoring) {
              addLog("Stop monitoring before changing resident");
              return;
            }

            setSelectedResidentId(e.target.value);
          }}
          disabled={monitoring || residentsLoading}
          style={{
            width: "100%",
            padding: 12,
            borderRadius: 8,
            border: "1px solid #ccc",
            background: "white",
            fontSize: 14,
          }}
        >
          <option value="">
            {residentsLoading ? "Loading residents..." : "Choose resident"}
          </option>

          {residents.map((resident) => (
            <option key={resident.id} value={resident.id}>
              {resident.full_name}
              {resident.room_number ? ` — Room ${resident.room_number}` : ""}
            </option>
          ))}
        </select>

        {selectedResident && (
          <div
            style={{
              marginTop: 10,
              padding: 10,
              background: "#f0fdf4",
              borderRadius: 8,
              fontSize: 13,
              color: "#166534",
            }}
          >
            Monitoring device assigned to{" "}
            <strong>{selectedResident.full_name}</strong>
            {selectedResident.room_number
              ? ` — Room ${selectedResident.room_number}`
              : ""}
          </div>
        )}
      </div>

      {/* ---------------------------------------------------
          MONITORING
      --------------------------------------------------- */}

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 18,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            marginBottom: 12,
            fontWeight: 600,
          }}
        >
          {monitoring ? "🟢 Monitoring" : "⚪ Not monitoring"}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "6px 0",
            borderBottom: "1px solid #eee",
            fontSize: 14,
          }}
        >
          <span style={{ color: "#666" }}>Acceleration magnitude</span>

          <span style={{ fontWeight: 600 }}>
            {magnitude !== null ? `${magnitude.toFixed(2)} g` : "—"}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "6px 0",
            fontSize: 14,
          }}
        >
          <span style={{ color: "#666" }}>Motion state</span>

          <span style={{ fontWeight: 600 }}>{motionState}</span>
        </div>

        <button
          onClick={monitoring ? stopMonitoring : startMonitoring}
          disabled={!selectedResidentId && !monitoring}
          style={{
            width: "100%",
            padding: 12,
            marginTop: 14,
            borderRadius: 8,
            border: "none",
            background: "#2F5496",
            color: "white",
            fontWeight: 600,
            opacity: !selectedResidentId && !monitoring ? 0.5 : 1,
          }}
        >
          {monitoring ? "Stop Monitoring" : "Start Monitoring"}
        </button>

        <button
          onClick={() => triggerFallSequence("test simulation")}
          disabled={!monitoring || !selectedResidentId}
          style={{
            width: "100%",
            padding: 12,
            marginTop: 8,
            borderRadius: 8,
            border: "1px solid #dc2626",
            background: "white",
            color: "#dc2626",
            fontWeight: 700,
            opacity: monitoring && selectedResidentId ? 1 : 0.5,
          }}
        >
          🚨 Simulate Fall
        </button>
      </div>

      {/* ---------------------------------------------------
          FALL ALERT
      --------------------------------------------------- */}

      {alertActive && (
        <div
          style={{
            border: "1px solid #dc2626",
            background: "#fee2e2",
            borderRadius: 12,
            padding: 18,
            marginBottom: 16,
            textAlign: "center",
          }}
        >
          <h2
            style={{
              color: "#dc2626",
              margin: "0 0 6px",
              fontSize: 16,
            }}
          >
            🚨 Potential Fall Detected
          </h2>

          <p
            style={{
              margin: 0,
              fontSize: 13,
            }}
          >
            Resident:
          </p>

          <strong
            style={{
              display: "block",
              fontSize: 16,
              marginTop: 4,
            }}
          >
            {selectedResident?.full_name || "Unknown resident"}
          </strong>

          {selectedResident?.room_number && (
            <div
              style={{
                fontSize: 13,
                color: "#666",
                marginTop: 3,
              }}
            >
              Room {selectedResident.room_number}
            </div>
          )}

          <p
            style={{
              margin: "12px 0 0",
              fontSize: 13,
            }}
          >
            Are you okay?
          </p>

          <div
            style={{
              fontSize: 32,
              fontWeight: 700,
              margin: "8px 0",
            }}
          >
            {countdown}
          </div>

          <button
            onClick={handleImOk}
            style={{
              width: "100%",
              padding: 12,
              marginTop: 6,
              borderRadius: 8,
              border: "none",
              background: "#16a34a",
              color: "white",
              fontWeight: 600,
            }}
          >
            I&apos;m OK
          </button>

          <button
            onClick={handleSendAlert}
            style={{
              width: "100%",
              padding: 12,
              marginTop: 8,
              borderRadius: 8,
              border: "none",
              background: "#dc2626",
              color: "white",
              fontWeight: 600,
            }}
          >
            Send Alert Now
          </button>
        </div>
      )}

      {/* ---------------------------------------------------
          ACTIVITY LOG
      --------------------------------------------------- */}

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 14,
        }}
      >
        <div
          style={{
            fontWeight: 600,
            fontSize: 13,
            marginBottom: 8,
          }}
        >
          Activity Log
        </div>

        <div
          style={{
            maxHeight: 160,
            overflowY: "auto",
          }}
        >
          {log.length === 0 && (
            <div
              style={{
                fontSize: 12,
                color: "#888",
              }}
            >
              Waiting to start...
            </div>
          )}

          {log.map((entry, i) => (
            <div
              key={i}
              style={{
                fontSize: 12,
                color: "#666",
                padding: "3px 0",
                borderBottom: "1px dashed #eee",
              }}
            >
              {entry.time} — {entry.msg}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
