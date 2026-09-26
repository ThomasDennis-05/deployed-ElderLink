"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function FallDetectPage() {
  const supabase = createClient();

  const [residents, setResidents] = useState([]);
  const [selectedResidentId, setSelectedResidentId] = useState("");
  const [monitoring, setMonitoring] = useState(false);

  const [alertActive, setAlertActive] = useState(false);
  const [countdown, setCountdown] = useState(12);
  const [sendingAlert, setSendingAlert] = useState(false);
  const [alertSent, setAlertSent] = useState(false);

  const [activityLog, setActivityLog] = useState([]);

  // Live accelerometer values
  const [accelerometer, setAccelerometer] = useState({
    x: 0,
    y: 0,
    z: 0,
    magnitude: 0,
  });

  const [sensorStatus, setSensorStatus] = useState("Not active");

  const countdownTimer = useRef(null);
  const vibrationTimer = useRef(null);
  const fallConfirmationTimer = useRef(null);
  const activityLogTimer = useRef(null);

  const monitoringRef = useRef(false);
  const fallTriggeredRef = useRef(false);

  // Used for free-fall detection
  const freeFallDetectedRef = useRef(false);
  const freeFallTimerRef = useRef(null);

  // Prevent activity log from being flooded
  const lastSensorLogRef = useRef(0);

  useEffect(() => {
    loadResidents();

    return () => {
      window.removeEventListener("devicemotion", handleMotion);

      if (countdownTimer.current) {
        clearInterval(countdownTimer.current);
      }

      if (fallConfirmationTimer.current) {
        clearTimeout(fallConfirmationTimer.current);
      }

      if (freeFallTimerRef.current) {
        clearTimeout(freeFallTimerRef.current);
      }

      if (activityLogTimer.current) {
        clearInterval(activityLogTimer.current);
      }

      stopVibration();
    };
  }, []);

  async function loadResidents() {
    try {
      const { data, error } = await supabase
        .from("residents")
        .select("id, full_name, room_number")
        .order("full_name", { ascending: true });

      if (error) {
        console.error("Failed to load residents:", error);
        addLog("Unable to load residents");
        return;
      }

      setResidents(data || []);

      if (data && data.length > 0) {
        setSelectedResidentId(data[0].id);
      }
    } catch (error) {
      console.error(error);
      addLog("Unable to load residents");
    }
  }

  function addLog(message) {
    setActivityLog((previous) => [
      {
        message,
        time: new Date().toLocaleTimeString(),
      },
      ...previous,
    ]);
  }

  function stopVibration() {
    if (vibrationTimer.current) {
      clearInterval(vibrationTimer.current);
      vibrationTimer.current = null;
    }

    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(0);
    }
  }

  function startVibration() {
    stopVibration();

    if (typeof navigator === "undefined" || !("vibrate" in navigator)) {
      addLog("Vibration is not supported on this device");
      return;
    }

    const strongPattern = [900, 200, 900, 200, 900, 400];

    navigator.vibrate(strongPattern);

    vibrationTimer.current = setInterval(() => {
      if ("vibrate" in navigator) {
        navigator.vibrate(strongPattern);
      }
    }, 3600);
  }

  async function sendFallEvent() {
    if (!selectedResidentId) {
      addLog("No resident selected");
      return false;
    }

    try {
      const { error } = await supabase.from("fall_events").insert({
        resident_id: selectedResidentId,
        device_id: "PHONE",
        z_drop: 1.8,
        doppler_spike: 0,
        status: "unresolved",
      });

      if (error) {
        console.error("Fall event error:", error);
        addLog("Fall event could not be recorded");
        return false;
      }

      addLog("Fall event recorded successfully");

      return true;
    } catch (error) {
      console.error(error);
      addLog("Fall event could not be recorded");
      return false;
    }
  }

  async function sendAutomaticSOS() {
    if (!selectedResidentId) {
      addLog("No resident selected");
      return false;
    }

    try {
      addLog("Sending emergency notifications...");

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

      const data = await response.json();

      if (!response.ok) {
        console.error("Emergency notification error:", data);

        addLog("Emergency notification failed");

        return false;
      }

      if (data.sentChannels?.length) {
        addLog(`Sent: ${data.sentChannels.join(", ")}`);
      }

      if (data.failedChannels?.length) {
        addLog(`Failed: ${data.failedChannels.join(", ")}`);
      }

      return true;
    } catch (error) {
      console.error(error);

      addLog("Emergency notification failed");

      return false;
    }
  }

  async function sendCompleteEmergencyAlert() {
    if (sendingAlert) {
      return;
    }

    setSendingAlert(true);

    stopVibration();

    addLog("Starting emergency response");

    const fallRecorded = await sendFallEvent();

    if (fallRecorded) {
      await sendAutomaticSOS();
    }

    setSendingAlert(false);
    setAlertSent(true);
    setAlertActive(false);

    fallTriggeredRef.current = false;

    addLog("Emergency response completed");
  }

  function triggerFallSequence(source = "Fall detection") {
    if (fallTriggeredRef.current || sendingAlert || !selectedResidentId) {
      return;
    }

    fallTriggeredRef.current = true;

    setAlertActive(true);
    setAlertSent(false);
    setCountdown(12);

    addLog(`${source} detected`);
    addLog("12-second emergency countdown started");

    startVibration();

    if (countdownTimer.current) {
      clearInterval(countdownTimer.current);
    }

    countdownTimer.current = setInterval(() => {
      setCountdown((previous) => {
        if (previous <= 1) {
          clearInterval(countdownTimer.current);
          countdownTimer.current = null;

          stopVibration();

          setTimeout(() => {
            sendCompleteEmergencyAlert();
          }, 0);

          return 0;
        }

        return previous - 1;
      });
    }, 1000);
  }

  function handleMotion(event) {
    if (!monitoringRef.current || fallTriggeredRef.current) {
      return;
    }

    const acceleration = event.accelerationIncludingGravity;

    if (!acceleration) {
      return;
    }

    const x = acceleration.x || 0;
    const y = acceleration.y || 0;
    const z = acceleration.z || 0;

    const magnitude = Math.sqrt(x * x + y * y + z * z);

    // Update live accelerometer display
    setAccelerometer({
      x,
      y,
      z,
      magnitude,
    });

    /*
      FREE-FALL DETECTION

      When the phone is falling, the accelerometer
      can temporarily approach 0 because the phone
      and its sensor are falling together.
    */

    if (magnitude < 0.8) {
      if (!freeFallDetectedRef.current) {
        freeFallDetectedRef.current = true;

        addLog("Free-fall movement detected");

        setSensorStatus("Free-fall detected");

        if (freeFallTimerRef.current) {
          clearTimeout(freeFallTimerRef.current);
        }

        // Free-fall must be followed by impact
        // within 2 seconds.
        freeFallTimerRef.current = setTimeout(() => {
          freeFallDetectedRef.current = false;

          if (monitoringRef.current) {
            setSensorStatus("Monitoring");
          }
        }, 2000);
      }
    }

    /*
      STRONG IMPACT DETECTION

      A strong impact is usually a sudden spike
      in acceleration.
    */

    if (magnitude > 2.5) {
      setSensorStatus("Impact detected");

      const wasFreeFall = freeFallDetectedRef.current;

      if (wasFreeFall) {
        addLog("Free-fall followed by impact detected");

        freeFallDetectedRef.current = false;

        if (freeFallTimerRef.current) {
          clearTimeout(freeFallTimerRef.current);

          freeFallTimerRef.current = null;
        }

        /*
          Give the phone a short moment after impact
          before starting the emergency countdown.
        */

        if (fallConfirmationTimer.current) {
          clearTimeout(fallConfirmationTimer.current);
        }

        fallConfirmationTimer.current = setTimeout(() => {
          if (monitoringRef.current && !fallTriggeredRef.current) {
            triggerFallSequence("Phone drop / fall detected");
          }
        }, 500);

        return;
      }

      /*
        Also detect a strong impact even when
        free-fall was not captured by the browser.
      */

      addLog("Strong impact detected");

      if (fallConfirmationTimer.current) {
        clearTimeout(fallConfirmationTimer.current);
      }

      fallConfirmationTimer.current = setTimeout(() => {
        if (monitoringRef.current && !fallTriggeredRef.current) {
          triggerFallSequence("Automatic fall detection");
        }
      }, 800);
    } else {
      if (magnitude >= 0.8 && magnitude <= 2.5) {
        setSensorStatus("Monitoring");
      }
    }
  }

  async function startMonitoring() {
    if (!selectedResidentId) {
      addLog("Please select a resident first");

      return;
    }

    try {
      /*
        iPhone / iPad motion permission.
      */

      if (
        typeof DeviceMotionEvent !== "undefined" &&
        typeof DeviceMotionEvent.requestPermission === "function"
      ) {
        const permission = await DeviceMotionEvent.requestPermission();

        if (permission !== "granted") {
          addLog("Motion permission was not granted");

          return;
        }
      }

      window.addEventListener("devicemotion", handleMotion);

      monitoringRef.current = true;
      fallTriggeredRef.current = false;
      freeFallDetectedRef.current = false;

      setMonitoring(true);
      setAlertSent(false);
      setSensorStatus("Monitoring");

      addLog("Fall detection monitoring started");

      addLog("Accelerometer sensor connected");
    } catch (error) {
      console.error(error);

      addLog("Unable to start motion detection");
    }
  }

  function stopMonitoring() {
    window.removeEventListener("devicemotion", handleMotion);

    monitoringRef.current = false;

    if (fallConfirmationTimer.current) {
      clearTimeout(fallConfirmationTimer.current);

      fallConfirmationTimer.current = null;
    }

    if (freeFallTimerRef.current) {
      clearTimeout(freeFallTimerRef.current);

      freeFallTimerRef.current = null;
    }

    if (countdownTimer.current) {
      clearInterval(countdownTimer.current);

      countdownTimer.current = null;
    }

    stopVibration();

    setMonitoring(false);
    setSensorStatus("Not active");

    if (alertActive) {
      setAlertActive(false);
    }

    fallTriggeredRef.current = false;
    freeFallDetectedRef.current = false;

    addLog("Fall detection monitoring stopped");
  }

  function handleImOk() {
    if (countdownTimer.current) {
      clearInterval(countdownTimer.current);

      countdownTimer.current = null;
    }

    stopVibration();

    setAlertActive(false);
    setCountdown(12);

    fallTriggeredRef.current = false;

    addLog("Resident confirmed they are OK");
  }

  function handleSendAlert() {
    if (countdownTimer.current) {
      clearInterval(countdownTimer.current);

      countdownTimer.current = null;
    }

    stopVibration();

    sendCompleteEmergencyAlert();
  }

  function handleTestFall() {
    if (!selectedResidentId) {
      addLog("Please select a resident first");

      return;
    }

    triggerFallSequence("Test fall simulation");
  }

  const selectedResident = residents.find(
    (resident) => resident.id === selectedResidentId,
  );

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        {/* HEADER */}

        <div className="mb-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                Fall Detection
              </h1>

              <p className="mt-1 text-sm text-slate-500">
                Mobile emergency monitoring system
              </p>
            </div>

            <div
              className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold ${
                monitoring
                  ? "border-green-200 bg-green-50 text-green-700"
                  : "border-slate-200 bg-white text-slate-600"
              }`}
            >
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  monitoring ? "animate-pulse bg-green-500" : "bg-slate-400"
                }`}
              />

              {monitoring ? "Monitoring Active" : "Monitoring Off"}
            </div>
          </div>
        </div>

        {/* LIVE EMERGENCY */}

        {alertActive && (
          <section className="mb-6 overflow-hidden rounded-2xl border border-red-200 bg-white shadow-md">
            <div className="border-b border-red-200 bg-red-50 px-5 py-5 sm:px-6">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-xl font-bold text-white">
                  !
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-red-900">
                      LIVE EMERGENCY
                    </h2>

                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                  </div>

                  <p className="mt-1 text-sm text-red-700">
                    Possible fall detected
                  </p>
                </div>
              </div>
            </div>

            <div className="px-5 py-7 sm:px-6">
              <div className="text-center">
                <p className="text-sm font-semibold uppercase tracking-wider text-slate-500">
                  Emergency alert in
                </p>

                <div className="mt-2 text-7xl font-bold tabular-nums text-red-600">
                  {countdown}
                </div>

                <p className="mt-2 text-sm text-slate-500">seconds</p>
              </div>

              <div className="mx-auto mt-6 max-w-xl rounded-xl border border-red-100 bg-red-50 p-4 text-center">
                <p className="text-sm font-medium text-red-800">
                  The phone is vibrating.
                </p>

                <p className="mt-1 text-xs text-red-600">
                  Press "I'm OK" to cancel the emergency response or send the
                  alert immediately.
                </p>
              </div>

              <div className="mx-auto mt-6 grid max-w-xl gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={handleImOk}
                  disabled={sendingAlert}
                  className="rounded-xl border border-slate-300 bg-white px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  I'm OK
                </button>

                <button
                  type="button"
                  onClick={handleSendAlert}
                  disabled={sendingAlert}
                  className="rounded-xl bg-red-600 px-5 py-3 font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sendingAlert ? "Sending Alert..." : "Send Alert Now"}
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ALERT SENT */}

        {alertSent && !alertActive && (
          <section className="mb-6 rounded-2xl border border-green-200 bg-green-50 p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-600 font-bold text-white">
                ✓
              </div>

              <div>
                <h2 className="font-bold text-green-900">
                  Emergency Alert Sent
                </h2>

                <p className="mt-1 text-sm text-green-700">
                  Emergency notifications have been sent.
                </p>
              </div>
            </div>
          </section>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          {/* MONITORING SETUP */}

          <section className="lg:col-span-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <h2 className="text-lg font-bold text-slate-900">
                Monitoring Setup
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Select a resident and start fall detection.
              </p>

              {/* RESIDENT */}

              <div className="mt-6">
                <label
                  htmlFor="resident"
                  className="mb-2 block text-sm font-semibold text-slate-700"
                >
                  Resident
                </label>

                <select
                  id="resident"
                  value={selectedResidentId}
                  onChange={(event) =>
                    setSelectedResidentId(event.target.value)
                  }
                  disabled={monitoring || alertActive}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:bg-slate-100"
                >
                  <option value="">Select resident</option>

                  {residents.map((resident) => (
                    <option key={resident.id} value={resident.id}>
                      {resident.full_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* RESIDENT INFO */}

              {selectedResident && (
                <div className="mt-4 rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Selected Resident
                  </p>

                  <p className="mt-1 font-semibold text-slate-900">
                    {selectedResident.full_name}
                  </p>

                  {selectedResident.room_number && (
                    <p className="mt-1 text-sm text-slate-500">
                      Room {selectedResident.room_number}
                    </p>
                  )}
                </div>
              )}

              {/* BUTTONS */}

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {!monitoring ? (
                  <button
                    type="button"
                    onClick={startMonitoring}
                    disabled={!selectedResidentId}
                    className="rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Start Monitoring
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopMonitoring}
                    disabled={alertActive}
                    className="rounded-xl border border-slate-300 bg-white px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Stop Monitoring
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleTestFall}
                  disabled={!selectedResidentId || sendingAlert || alertActive}
                  className="rounded-xl border border-red-200 bg-red-50 px-5 py-3 font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Test Fall Alert
                </button>
              </div>

              {/* ACCELEROMETER */}

              <div className="mt-6 border-t border-slate-100 pt-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="font-semibold text-slate-900">
                      Accelerometer
                    </h3>

                    <p className="text-xs text-slate-500">
                      Live device motion data
                    </p>
                  </div>

                  <div className="flex items-center gap-2 text-sm">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        monitoring
                          ? "animate-pulse bg-green-500"
                          : "bg-slate-400"
                      }`}
                    />

                    <span className="font-medium text-slate-600">
                      {sensorStatus}
                    </span>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      X
                    </p>

                    <p className="mt-1 font-mono text-lg font-bold text-slate-900">
                      {accelerometer.x.toFixed(2)}
                    </p>

                    <p className="text-xs text-slate-400">m/s²</p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Y
                    </p>

                    <p className="mt-1 font-mono text-lg font-bold text-slate-900">
                      {accelerometer.y.toFixed(2)}
                    </p>

                    <p className="text-xs text-slate-400">m/s²</p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Z
                    </p>

                    <p className="mt-1 font-mono text-lg font-bold text-slate-900">
                      {accelerometer.z.toFixed(2)}
                    </p>

                    <p className="text-xs text-slate-400">m/s²</p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-900 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-300">
                      Magnitude
                    </p>

                    <p className="mt-1 font-mono text-lg font-bold text-white">
                      {accelerometer.magnitude.toFixed(2)}
                    </p>

                    <p className="text-xs text-slate-400">m/s²</p>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">
                      Impact threshold
                    </span>

                    <span className="font-mono text-sm font-semibold text-slate-900">
                      2.50 m/s²
                    </span>
                  </div>

                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition-all ${
                        accelerometer.magnitude > 2.5
                          ? "bg-red-500"
                          : "bg-green-500"
                      }`}
                      style={{
                        width: `${Math.min(
                          (accelerometer.magnitude / 5) * 100,
                          100,
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* DETECTION STATUS */}

              <div className="mt-6 border-t border-slate-100 pt-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-500">
                    Detection Status
                  </span>

                  <span
                    className={`font-semibold ${
                      monitoring ? "text-green-600" : "text-slate-500"
                    }`}
                  >
                    {monitoring ? "Active" : "Inactive"}
                  </span>
                </div>

                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full transition-all ${
                      monitoring ? "w-full bg-green-500" : "w-0"
                    }`}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* ACTIVITY */}

          <section>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Activity</h2>

                  <p className="mt-1 text-xs text-slate-500">
                    Real-time detection events
                  </p>
                </div>

                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    monitoring
                      ? "bg-green-50 text-green-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {monitoring ? "LIVE" : "OFFLINE"}
                </span>
              </div>

              {/* Current sensor summary */}

              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Sensor Status
                  </span>

                  <span className="text-xs font-semibold text-slate-700">
                    {sensorStatus}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-xs text-slate-400">X</p>

                    <p className="font-mono text-sm font-semibold text-slate-800">
                      {accelerometer.x.toFixed(2)}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-slate-400">Y</p>

                    <p className="font-mono text-sm font-semibold text-slate-800">
                      {accelerometer.y.toFixed(2)}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-slate-400">Z</p>

                    <p className="font-mono text-sm font-semibold text-slate-800">
                      {accelerometer.z.toFixed(2)}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-slate-400">Magnitude</p>

                    <p className="font-mono text-sm font-semibold text-slate-800">
                      {accelerometer.magnitude.toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Activity log */}

              <div className="mt-4 max-h-[420px] space-y-3 overflow-y-auto">
                {activityLog.length === 0 ? (
                  <div className="rounded-xl bg-slate-50 p-4 text-center">
                    <p className="text-sm text-slate-500">No activity yet</p>
                  </div>
                ) : (
                  activityLog.map((item, index) => (
                    <div
                      key={`${item.time}-${index}`}
                      className="border-b border-slate-100 pb-3 last:border-0"
                    >
                      <p className="text-sm text-slate-700">{item.message}</p>

                      <p className="mt-1 text-xs text-slate-400">{item.time}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        </div>

        {/* SYSTEM INFORMATION */}

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-bold text-slate-900">Emergency Response</h2>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Detection
              </p>

              <p className="mt-1 font-semibold text-slate-900">Motion Sensor</p>
            </div>

            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Countdown
              </p>

              <p className="mt-1 font-semibold text-slate-900">12 Seconds</p>
            </div>

            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Notifications
              </p>

              <p className="mt-1 font-semibold text-slate-900">
                SMS / WhatsApp / Voice
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
