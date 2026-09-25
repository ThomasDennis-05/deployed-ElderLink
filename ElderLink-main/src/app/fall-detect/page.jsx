"use client";
import { useState, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

export default function FallDetectionPage() {
  const [monitoring, setMonitoring] = useState(false);
  const [magnitude, setMagnitude] = useState(null);
  const [motionState, setMotionState] = useState("—");
  const [alertActive, setAlertActive] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const [log, setLog] = useState([]);

  const spikeDetectedAt = useRef(null);
  const countdownTimer = useRef(null);
  const motionHandlerRef = useRef(null);

  function addLog(msg) {
    setLog((prev) =>
      [{ time: new Date().toLocaleTimeString(), msg }, ...prev].slice(0, 20),
    );
  }

  async function sendFallEvent(status) {
    try {
      const { error } = await supabase.from("fall_events").insert({
        device_id: "PHONE-SIM-01",
        z_drop: 1.8,
        doppler_spike: 0,
        status,
      });
      if (error) {
        addLog(`Failed to send event: ${error.message}`);
        return false;
      }
      addLog(`Event sent to database (status: ${status})`);
      return true;
    } catch (err) {
      addLog(`Failed to send event: ${err.message}`);
      return false;
    }
  }

  const triggerFallSequence = useCallback((source) => {
    setAlertActive((current) => {
      if (current) return current; // already in alert state
      addLog(`Fall pattern detected (${source})`);
      setCountdown(30);

      countdownTimer.current = setInterval(() => {
        setCountdown((c) => {
          if (c <= 1) {
            clearInterval(countdownTimer.current);
            addLog("No response — auto-escalating to family");
            sendFallEvent("escalated");
            setAlertActive(false);
            return 30;
          }
          return c - 1;
        });
      }, 1000);

      return true;
    });
  }, []);

  const handleMotion = useCallback(
    (event) => {
      const acc = event.accelerationIncludingGravity;
      if (!acc || acc.x === null) return;

      const mag =
        Math.sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z) / 9.81;
      setMagnitude(mag);

      if (mag > 2.5) {
        setMotionState("Impact spike");
        spikeDetectedAt.current = Date.now();
      } else if (
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

  async function startMonitoring() {
    if (
      typeof DeviceMotionEvent !== "undefined" &&
      typeof DeviceMotionEvent.requestPermission === "function"
    ) {
      try {
        const perm = await DeviceMotionEvent.requestPermission();
        if (perm !== "granted") {
          addLog("Motion permission denied");
          return;
        }
      } catch (err) {
        addLog("Permission request failed: " + err.message);
        return;
      }
    }

    motionHandlerRef.current = handleMotion;
    window.addEventListener("devicemotion", motionHandlerRef.current);
    setMonitoring(true);
    addLog("Monitoring started");
  }

  function stopMonitoring() {
    if (motionHandlerRef.current) {
      window.removeEventListener("devicemotion", motionHandlerRef.current);
    }
    setMonitoring(false);
    setMagnitude(null);
    setMotionState("—");
    addLog("Monitoring stopped");
  }

  function handleImOk() {
    clearInterval(countdownTimer.current);
    addLog("Marked as 'I'm OK' — no alert sent");
    setAlertActive(false);
  }

  async function handleSendAlert() {
    clearInterval(countdownTimer.current);
    await sendFallEvent("confirmed");
    addLog("Alert manually confirmed and sent");
    setAlertActive(false);
  }

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
      <p style={{ color: "#666", fontSize: 13, marginBottom: 20 }}>
        Phone accelerometer acting as an in-room sensor
      </p>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 18,
          marginBottom: 16,
        }}
      >
        <div style={{ marginBottom: 12, fontWeight: 600 }}>
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
            {magnitude !== null ? magnitude.toFixed(2) + " g" : "—"}
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
          style={{
            width: "100%",
            padding: 12,
            marginTop: 14,
            borderRadius: 8,
            border: "none",
            background: "#2F5496",
            color: "white",
            fontWeight: 600,
          }}
        >
          {monitoring ? "Stop Monitoring" : "Start Monitoring"}
        </button>
        <button
          onClick={() => triggerFallSequence("test button")}
          disabled={!monitoring}
          style={{
            width: "100%",
            padding: 12,
            marginTop: 8,
            borderRadius: 8,
            border: "1px solid #ccc",
            background: "white",
            opacity: monitoring ? 1 : 0.5,
          }}
        >
          Simulate Fall (Test)
        </button>
      </div>

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
          <h2 style={{ color: "#dc2626", margin: "0 0 6px", fontSize: 16 }}>
            Potential Fall Detected
          </h2>
          <p style={{ margin: 0, fontSize: 13 }}>Are you okay?</p>
          <div style={{ fontSize: 32, fontWeight: 700, margin: "8px 0" }}>
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

      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
          Activity Log
        </div>
        <div style={{ maxHeight: 160, overflowY: "auto" }}>
          {log.length === 0 && (
            <div style={{ fontSize: 12, color: "#888" }}>
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
