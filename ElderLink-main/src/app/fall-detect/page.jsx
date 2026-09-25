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
      [
        {
          time: new Date().toLocaleTimeString(),
          msg,
        },
        ...prev,
      ].slice(0, 20),
    );
  }

  async function sendFallEvent() {
    try {
      const { error } = await supabase.from("fall_events").insert({
        device_id: "PHONE-SIM-01",
        z_drop: 1.8,
        doppler_spike: 0,
        status: "unresolved",
      });

      if (error) {
        addLog(`Failed to send event: ${error.message}`);
        return false;
      }

      addLog("🚨 Fall alert sent to staff dashboard");
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";

      addLog(`Failed to send event: ${message}`);
      return false;
    }
  }

  const triggerFallSequence = useCallback((source) => {
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
  }, []);

  const handleMotion = useCallback(
    (event) => {
      const acc = event.accelerationIncludingGravity;

      if (!acc || acc.x === null || acc.y === null || acc.z === null) {
        return;
      }

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
    addLog("Monitoring started");
  }

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

  function handleImOk() {
    if (countdownTimer.current) {
      clearInterval(countdownTimer.current);
      countdownTimer.current = null;
    }

    setAlertActive(false);
    setCountdown(30);

    addLog("I'm OK — no alert sent");
  }

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
          <h2
            style={{
              color: "#dc2626",
              margin: "0 0 6px",
              fontSize: 16,
            }}
          >
            Potential Fall Detected
          </h2>

          <p
            style={{
              margin: 0,
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
