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

  const [sendingAlert, setSendingAlert] = useState(false);
  const [alertSent, setAlertSent] = useState(false);

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
  // SEND FALL EVENT TO STAFF DASHBOARD
  // ---------------------------------------------------------

  async function sendFallEvent() {
    if (!selectedResidentId) {
      addLog("Please select a resident first");
      return false;
    }

    try {
      const { error } = await supabase.from("fall_events").insert({
        resident_id: selectedResidentId,

        // Store a simple device name instead of PHONE-SIM-01
        device_id: "PHONE",

        z_drop: 1.8,
        doppler_spike: 0,
        status: "unresolved",
      });

      if (error) {
        console.error("Fall event error:", error);
        addLog(`Failed to send staff alert: ${error.message}`);
        return false;
      }

      addLog(
        `🚨 Staff alert sent for ${selectedResident?.full_name || "resident"}`,
      );

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";

      addLog(`Failed to send staff alert: ${message}`);

      return false;
    }
  }

  // ---------------------------------------------------------
  // SEND AUTOMATIC SOS
  // ---------------------------------------------------------

  async function sendAutomaticSOS() {
    if (!selectedResidentId) {
      addLog("Cannot send SOS — no resident selected");
      return false;
    }

    setSendingAlert(true);

    try {
      addLog(
        `📢 Sending SOS to ${
          selectedResident?.full_name || "family contact"
        }...`,
      );

      const response = await fetch("/api/emergency-alert", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          residentId: selectedResidentId,
          alertType: "Fall",
          channels: ["sms", "whatsapp", "voice"],
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "SOS request failed");
      }

      const sentChannels = result.sentChannels || [];
      const failedChannels = result.failedChannels || [];

      if (sentChannels.includes("sms")) {
        addLog("✅ SMS SOS sent");
      }

      if (sentChannels.includes("whatsapp")) {
        addLog("✅ WhatsApp SOS sent");
      }

      if (sentChannels.includes("voice")) {
        addLog("✅ SOS phone call started");
      }

      if (failedChannels.includes("sms")) {
        addLog("⚠️ SMS SOS failed");
      }

      if (failedChannels.includes("whatsapp")) {
        addLog("⚠️ WhatsApp SOS failed");
      }

      if (failedChannels.includes("voice")) {
        addLog("⚠️ SOS phone call failed");
      }

      if (sentChannels.length === 0) {
        addLog("❌ No SOS channels were successfully sent");
        return false;
      }

      addLog(
        `🚨 SOS completed: ${sentChannels
          .map((channel) => {
            if (channel === "sms") return "SMS";
            if (channel === "whatsapp") return "WhatsApp";
            if (channel === "voice") return "Call";
            return channel;
          })
          .join(", ")}`,
      );

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";

      console.error("Automatic SOS error:", err);

      addLog(`❌ Automatic SOS failed: ${message}`);

      return false;
    } finally {
      setSendingAlert(false);
    }
  }

  // ---------------------------------------------------------
  // SEND EVERYTHING
  // ---------------------------------------------------------

  async function sendCompleteEmergencyAlert() {
    if (!selectedResidentId) {
      addLog("Please select a resident first");
      return {
        staffAlertSent: false,
        sosSent: false,
      };
    }

    const staffAlertSent = await sendFallEvent();

    const sosSent = await sendAutomaticSOS();

    if (staffAlertSent && sosSent) {
      addLog("🚨 Complete emergency alert sent");
    } else if (staffAlertSent) {
      addLog("⚠️ Staff alerted, but SOS delivery had a problem");
    } else if (sosSent) {
      addLog("⚠️ SOS sent, but staff dashboard alert had a problem");
    }

    return {
      staffAlertSent,
      sosSent,
    };
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

        setAlertSent(false);

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

              addLog("⏰ No response — sending emergency SOS");

              // Keep alert visible while automatic SOS is being sent.
              setSendingAlert(true);

              void sendCompleteEmergencyAlert().then(() => {
                setAlertActive(false);
                setAlertSent(true);
                setSendingAlert(false);
                setCountdown(30);
              });

              return 0;
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
    setAlertSent(false);

    addLog(
      `🟢 Monitoring started for ${
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
    setAlertSent(false);
    setSendingAlert(false);
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
    setAlertSent(false);
    setCountdown(30);

    addLog("I'm OK — no alert sent");
  }

  // ---------------------------------------------------------
  // SEND ALERT NOW
  // ---------------------------------------------------------

  async function handleSendAlert() {
    if (sendingAlert) {
      return;
    }

    if (!selectedResidentId) {
      addLog("Please select a resident first");
      return;
    }

    if (countdownTimer.current) {
      clearInterval(countdownTimer.current);
      countdownTimer.current = null;
    }

    // Immediately hide the countdown/buttons.
    setAlertActive(false);
    setSendingAlert(true);

    const result = await sendCompleteEmergencyAlert();

    setSendingAlert(false);
    setCountdown(30);

    // Show a clean success/failure result instead of the old countdown.
    if (result.staffAlertSent || result.sosSent) {
      setAlertSent(true);
    }
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
        minHeight: "100vh",
        background: "#f5f7fb",
        padding: "24px 16px 40px",
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        color: "#172033",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          margin: "0 auto",
        }}
      >
        {/* HEADER */}

        <div
          style={{
            background: "white",
            borderRadius: 18,
            padding: "22px 20px",
            marginBottom: 16,
            boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 800,
              color: "#2F5496",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 6,
            }}
          >
            ElderLink
          </div>

          <h1
            style={{
              fontSize: 25,
              margin: 0,
              fontWeight: 800,
              lineHeight: 1.2,
            }}
          >
            Fall Detection
          </h1>

          <p
            style={{
              color: "#667085",
              fontSize: 14,
              lineHeight: 1.5,
              margin: "8px 0 0",
            }}
          >
            Your phone acts as an in-room fall detection sensor.
          </p>
        </div>

        {/* RESIDENT */}

        <div
          style={{
            background: "white",
            borderRadius: 18,
            padding: 20,
            marginBottom: 16,
            boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 800,
              marginBottom: 10,
            }}
          >
            Resident
          </div>

          <select
            value={selectedResidentId}
            onChange={(e) => {
              if (monitoring) {
                addLog("Stop monitoring before changing resident");
                return;
              }

              setSelectedResidentId(e.target.value);
              setAlertSent(false);
            }}
            disabled={monitoring || residentsLoading}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "14px 12px",
              borderRadius: 12,
              border: "1px solid #d0d5dd",
              background: "white",
              fontSize: 15,
              outline: "none",
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
                marginTop: 12,
                padding: 14,
                background: "#eff6ff",
                borderRadius: 12,
                border: "1px solid #bfdbfe",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  color: "#475467",
                  marginBottom: 3,
                }}
              >
                Monitoring resident
              </div>

              <div
                style={{
                  fontSize: 16,
                  fontWeight: 800,
                  color: "#1e3a8a",
                }}
              >
                {selectedResident.full_name}
              </div>

              {selectedResident.room_number && (
                <div
                  style={{
                    fontSize: 13,
                    color: "#475467",
                    marginTop: 3,
                  }}
                >
                  Room {selectedResident.room_number}
                </div>
              )}
            </div>
          )}
        </div>

        {/* MONITORING */}

        <div
          style={{
            background: "white",
            borderRadius: 18,
            padding: 20,
            marginBottom: 16,
            boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 18,
            }}
          >
            <div
              style={{
                fontSize: 15,
                fontWeight: 800,
              }}
            >
              Monitoring
            </div>

            <div
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                background: monitoring ? "#dcfce7" : "#f2f4f7",
                color: monitoring ? "#166534" : "#667085",
                fontSize: 12,
                fontWeight: 800,
              }}
            >
              {monitoring ? "● ACTIVE" : "● OFF"}
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              marginBottom: 14,
            }}
          >
            <div
              style={{
                background: "#f8fafc",
                borderRadius: 12,
                padding: 14,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "#667085",
                  marginBottom: 5,
                }}
              >
                Acceleration
              </div>

              <div
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                }}
              >
                {magnitude !== null ? `${magnitude.toFixed(2)} g` : "—"}
              </div>
            </div>

            <div
              style={{
                background: "#f8fafc",
                borderRadius: 12,
                padding: 14,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "#667085",
                  marginBottom: 5,
                }}
              >
                Motion
              </div>

              <div
                style={{
                  fontSize: 14,
                  fontWeight: 800,
                }}
              >
                {motionState}
              </div>
            </div>
          </div>

          <button
            onClick={monitoring ? stopMonitoring : startMonitoring}
            disabled={!selectedResidentId && !monitoring}
            style={{
              width: "100%",
              padding: 14,
              borderRadius: 12,
              border: "none",
              background: monitoring ? "#344054" : "#2F5496",
              color: "white",
              fontWeight: 800,
              fontSize: 15,
              cursor: "pointer",
              opacity: !selectedResidentId && !monitoring ? 0.5 : 1,
            }}
          >
            {monitoring ? "Stop Monitoring" : "Start Monitoring"}
          </button>

          <button
            onClick={() => triggerFallSequence("test simulation")}
            disabled={!monitoring || !selectedResidentId || sendingAlert}
            style={{
              width: "100%",
              padding: 14,
              marginTop: 10,
              borderRadius: 12,
              border: "2px solid #dc2626",
              background: "white",
              color: "#dc2626",
              fontWeight: 800,
              fontSize: 15,
              cursor: "pointer",
              opacity:
                monitoring && selectedResidentId && !sendingAlert ? 1 : 0.45,
            }}
          >
            🚨 Simulate Fall
          </button>
        </div>

        {/* FALL ALERT */}

        {alertActive && (
          <div
            style={{
              background: "#fff1f2",
              border: "2px solid #ef4444",
              borderRadius: 20,
              padding: 22,
              marginBottom: 16,
              textAlign: "center",
              boxShadow: "0 4px 18px rgba(220,38,38,0.12)",
            }}
          >
            <div
              style={{
                fontSize: 34,
                marginBottom: 5,
              }}
            >
              🚨
            </div>

            <h2
              style={{
                color: "#b91c1c",
                margin: 0,
                fontSize: 21,
                fontWeight: 900,
              }}
            >
              FALL DETECTED
            </h2>

            <div
              style={{
                marginTop: 12,
                fontSize: 15,
                fontWeight: 800,
              }}
            >
              {selectedResident?.full_name || "Unknown resident"}
            </div>

            {selectedResident?.room_number && (
              <div
                style={{
                  color: "#667085",
                  fontSize: 13,
                  marginTop: 3,
                }}
              >
                Room {selectedResident.room_number}
              </div>
            )}

            <div
              style={{
                marginTop: 18,
                color: "#475467",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Are you okay?
            </div>

            {/* BIG COUNTDOWN */}

            <div
              style={{
                width: 130,
                height: 130,
                margin: "16px auto",
                borderRadius: "50%",
                background: "white",
                border: "7px solid #ef4444",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "column",
                boxSizing: "border-box",
              }}
            >
              <div
                style={{
                  fontSize: 48,
                  lineHeight: 1,
                  fontWeight: 900,
                  color: "#b91c1c",
                }}
              >
                {countdown}
              </div>

              <div
                style={{
                  fontSize: 11,
                  color: "#667085",
                  fontWeight: 700,
                  marginTop: 5,
                }}
              >
                SECONDS
              </div>
            </div>

            <button
              onClick={handleImOk}
              disabled={sendingAlert}
              style={{
                width: "100%",
                padding: 15,
                borderRadius: 12,
                border: "none",
                background: "#16a34a",
                color: "white",
                fontWeight: 900,
                fontSize: 15,
                cursor: "pointer",
                opacity: sendingAlert ? 0.5 : 1,
              }}
            >
              ✓ I&apos;M OK
            </button>

            <button
              onClick={handleSendAlert}
              disabled={sendingAlert}
              style={{
                width: "100%",
                padding: 15,
                marginTop: 10,
                borderRadius: 12,
                border: "none",
                background: "#dc2626",
                color: "white",
                fontWeight: 900,
                fontSize: 15,
                cursor: "pointer",
                opacity: sendingAlert ? 0.65 : 1,
              }}
            >
              {sendingAlert
                ? "Sending Emergency Alert..."
                : "🚨 SEND ALERT NOW"}
            </button>
          </div>
        )}

        {/* SENDING STATUS */}

        {sendingAlert && !alertActive && (
          <div
            style={{
              background: "#fff7ed",
              border: "2px solid #fb923c",
              borderRadius: 18,
              padding: 22,
              marginBottom: 16,
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 30,
                marginBottom: 8,
              }}
            >
              📢
            </div>

            <div
              style={{
                fontSize: 18,
                fontWeight: 900,
                color: "#c2410c",
              }}
            >
              Sending Emergency Alert
            </div>

            <div
              style={{
                marginTop: 7,
                fontSize: 13,
                color: "#667085",
              }}
            >
              Notifying staff and family...
            </div>
          </div>
        )}

        {/* ALERT SENT */}

        {alertSent && !alertActive && !sendingAlert && (
          <div
            style={{
              background: "#ecfdf3",
              border: "2px solid #22c55e",
              borderRadius: 18,
              padding: 22,
              marginBottom: 16,
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 38,
                marginBottom: 8,
              }}
            >
              ✅
            </div>

            <div
              style={{
                fontSize: 20,
                fontWeight: 900,
                color: "#166534",
              }}
            >
              Emergency Alert Sent
            </div>

            <div
              style={{
                marginTop: 8,
                fontSize: 14,
                color: "#475467",
              }}
            >
              {selectedResident?.full_name || "Resident"} has been reported to
              the care team.
            </div>

            <div
              style={{
                marginTop: 14,
                padding: 12,
                background: "white",
                borderRadius: 12,
                fontSize: 13,
                color: "#166534",
                fontWeight: 700,
              }}
            >
              ✓ Staff notified
              <br />
              ✓ Family emergency process started
              <br />✓ SMS / WhatsApp / Voice attempted
            </div>

            <button
              onClick={() => setAlertSent(false)}
              style={{
                width: "100%",
                padding: 12,
                marginTop: 14,
                borderRadius: 10,
                border: "1px solid #bbf7d0",
                background: "white",
                color: "#166534",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Continue Monitoring
            </button>
          </div>
        )}

        {/* ACTIVITY LOG */}

        <div
          style={{
            background: "white",
            borderRadius: 18,
            padding: 18,
            boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
          }}
        >
          <div
            style={{
              fontWeight: 800,
              fontSize: 14,
              marginBottom: 10,
            }}
          >
            Activity Log
          </div>

          <div
            style={{
              maxHeight: 220,
              overflowY: "auto",
            }}
          >
            {log.length === 0 && (
              <div
                style={{
                  fontSize: 12,
                  color: "#98a2b3",
                  padding: "8px 0",
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
                  color: "#667085",
                  padding: "7px 0",
                  borderBottom: "1px solid #f2f4f7",
                  lineHeight: 1.4,
                }}
              >
                <span
                  style={{
                    color: "#98a2b3",
                    marginRight: 5,
                  }}
                >
                  {entry.time}
                </span>
                {entry.msg}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
