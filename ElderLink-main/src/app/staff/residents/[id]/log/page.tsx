"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  Utensils,
  GlassWater,
  Smile,
  Footprints,
  Pill,
  NotebookPen,
  Mic,
  MicOff,
  Camera,
  X,
  ChevronDown,
  Gauge,
  HeartPulse,
  Thermometer,
  CheckCircle2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const OPTIONS = {
  meals: {
    label: "Meals",
    icon: Utensils,
    choices: ["Ate Fully", "Partially", "Refused"],
  },
  fluids: {
    label: "Fluids",
    icon: GlassWater,
    choices: ["Good", "Low", "None"],
  },
  mood: {
    label: "Mood",
    icon: Smile,
    choices: ["Happy", "Calm", "Agitated", "Confused"],
  },
 
  medication: {
    label: "Medication",
    icon: Pill,
    choices: ["Given", "Refused", "Missed"],
  },
} as const;

type Category = keyof typeof OPTIONS;
type LogState = Record<Category, string> & { notes: string };

type SpeechRecognitionResultLike = {
  resultIndex: number;
  results: {
    [i: number]: { [j: number]: { transcript: string }; isFinal: boolean };
    length: number;
  };
};

// Minimal shape of the Web Speech API's SpeechRecognition instance —
// not part of default TS lib.dom types, so we declare just what we use.
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionResultLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export default function CareLogPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [residentName, setResidentName] = useState("");
  const [log, setLog] = useState<LogState>({
    meals: "",
    fluids: "",
    mood: "",
    medication: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  // Voice dictation
  const [listening, setListening] = useState(false);
  // Computed once at mount via lazy initializer — not set inside an effect,
  // so it can't trigger a cascading render.
  const [speechSupported] = useState(() => getSpeechRecognitionCtor() !== null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // Skin / wound photo (optional)
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Vitals (optional, collapsible)
  const [showVitals, setShowVitals] = useState(false);
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [heartRate, setHeartRate] = useState("");
  const [temperature, setTemperature] = useState("");

  // Pain scale (optional, note required at 6+)
  const [painScale, setPainScale] = useState(0);
  const [painNote, setPainNote] = useState("");
  const painRequired = painScale >= 6;

  const categories = Object.keys(OPTIONS) as Category[];
  const completed = categories.filter((c) => log[c]).length;
  const allDone = completed === categories.length;

  useEffect(() => {
    async function fetchResident() {
      const supabase = createClient();
      const { data } = await supabase
        .from("residents")
        .select("full_name")
        .eq("id", id)
        .single();
      if (data) setResidentName(data.full_name);
    }
    fetchResident();
  }, [id]);

  // Voice dictation setup — only runs when the browser actually supports it.
  useEffect(() => {
    const SpeechRecognitionCtor = getSpeechRecognitionCtor();
    if (!SpeechRecognitionCtor) return;

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionResultLike) => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript + " ";
      }
      if (finalText) {
        setLog((prev) => ({
          ...prev,
          notes: (prev.notes ? prev.notes.trim() + " " : "") + finalText.trim(),
        }));
      }
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;

    return () => recognition.stop();
  }, []);

  function toggleListening() {
    if (!recognitionRef.current) return;
    if (listening) {
      recognitionRef.current.stop();
      setListening(false);
    } else {
      recognitionRef.current.start();
      setListening(true);
    }
  }

  function pick(category: Category, choice: string) {
    setLog((prev) => ({ ...prev, [category]: choice }));
  }

  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  function clearPhoto() {
    setPhotoFile(null);
    setPhotoPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSave() {
    if (!allDone) return;

    if (painRequired && !painNote.trim()) {
      setError(
        "Pain is rated 6 or above — please add a brief note on location or nature of the pain.",
      );
      return;
    }

    setSaving(true);
    setError("");

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let photoUrl: string | null = null;
    if (photoFile) {
      const ext = photoFile.name.split(".").pop();
      const path = `${id}-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("care-log-photos")
        .upload(path, photoFile);
      if (uploadError) {
        setSaving(false);
        setError(`Photo upload failed: ${uploadError.message}`);
        return;
      }
      const { data: publicUrlData } = supabase.storage
        .from("care-log-photos")
        .getPublicUrl(path);
      photoUrl = publicUrlData.publicUrl;
    }

    const { error: insertError } = await supabase.from("care_logs").insert({
      resident_id: id,
      staff_id: user?.id ?? null,
      meals: log.meals,
      fluids: log.fluids,
      mood: log.mood,
      medication: log.medication,
      notes: log.notes || null,
      photo_url: photoUrl,
      systolic: systolic ? Number(systolic) : null,
      diastolic: diastolic ? Number(diastolic) : null,
      heart_rate: heartRate ? Number(heartRate) : null,
      temperature: temperature ? Number(temperature) : null,
      pain_scale: painScale > 0 ? painScale : null,
      pain_note: painNote.trim() || null,
    });

    if (insertError) {
      console.error("Care log insert failed:", insertError);
      setError(`Failed to save: ${insertError.message}`);
      setSaving(false);
      return;
    }

    setSaved(true);
    setTimeout(() => router.push("/staff/dashboard"), 1500);
  }

  if (saved) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAF8] px-4">
        <div className="text-center animate-[fadeUp_0.35s_ease-out]">
          <div className="w-16 h-16 rounded-full bg-[#EAF4F1] flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8 text-[#357366]" />
          </div>
          <p className="text-xl font-bold text-gray-900">Care log saved</p>
          <p className="text-gray-400 text-sm mt-2">
            Taking you back to the dashboard...
          </p>
        </div>
        <style jsx global>{`
          @keyframes fadeUp {
            from {
              opacity: 0;
              transform: translateY(8px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAF8]">
      <header className="bg-gradient-to-r from-[#357366] to-[#4F9C8B] sticky top-0 z-20 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/staff"
              className="text-white/80 hover:text-white transition-colors p-1"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <p className="text-green-100 text-xs font-medium">
                Daily care log
              </p>
              <p className="font-bold text-white text-lg leading-tight">
                {residentName || "Loading..."}
              </p>
            </div>
          </div>
          <span className="text-sm text-white/80 font-medium">
            {completed}/{categories.length} done
          </span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-5">
        {/* Progress bar */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
          <div className="flex justify-between text-xs text-gray-500 mb-2">
            <span>Progress</span>
            <span>{Math.round((completed / categories.length) * 100)}%</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div
              className="bg-[#4F9C8B] h-2 rounded-full transition-all duration-300"
              style={{ width: `${(completed / categories.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Category cards — required */}
        {categories.map((category) => {
          const { label, icon: Icon, choices } = OPTIONS[category];
          return (
            <div
              key={category}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center gap-2 mb-3.5">
                <div className="w-8 h-8 rounded-lg bg-[#EAF4F1] flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-[#357366]" />
                </div>
                <span className="font-semibold text-gray-800 text-sm">
                  {label}
                  <span className="text-red-500 ml-0.5">*</span>
                </span>
                {log[category] && (
                  <span className="ml-auto text-[#357366] text-sm font-semibold">
                    {log[category]}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {choices.map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    onClick={() => pick(category, choice)}
                    className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                      log[category] === choice
                        ? "bg-[#357366] text-white shadow-sm"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {choice}
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        {/* Notes + voice dictation */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3.5">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[#EAF4F1] flex items-center justify-center flex-shrink-0">
                <NotebookPen className="w-4 h-4 text-[#357366]" />
              </div>
              <span className="font-semibold text-gray-800 text-sm">
                Notes
                <span className="text-[10px] font-medium text-gray-400 ml-1.5">
                  optional
                </span>
              </span>
            </div>
            {speechSupported && (
              <button
                type="button"
                onClick={toggleListening}
                className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full transition-all ${
                  listening
                    ? "bg-red-100 text-red-600 animate-pulse"
                    : "bg-[#EAF4F1] text-[#357366] hover:bg-[#DCEEE8]"
                }`}
              >
                {listening ? (
                  <MicOff className="w-3.5 h-3.5" />
                ) : (
                  <Mic className="w-3.5 h-3.5" />
                )}
                {listening ? "Stop" : "Dictate"}
              </button>
            )}
          </div>
          <textarea
            value={log.notes}
            onChange={(e) =>
              setLog((prev) => ({ ...prev, notes: e.target.value }))
            }
            placeholder="Any additional observations about this resident..."
            rows={3}
            className="w-full border border-gray-200 rounded-xl p-3 text-sm text-gray-900 placeholder:text-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-[#4F9C8B] focus:border-transparent"
          />
          {listening && (
            <p className="text-xs text-gray-400 mt-1.5">
              Listening — speak naturally, punctuation isn&apos;t needed.
            </p>
          )}
        </div>

        {/* Skin / wound photo — optional */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-[#EAF4F1] flex items-center justify-center flex-shrink-0">
              <Camera className="w-4 h-4 text-[#357366]" />
            </div>
            <span className="font-semibold text-gray-800 text-sm">
              Skin / wound photo
              <span className="text-[10px] font-medium text-gray-400 ml-1.5">
                optional
              </span>
            </span>
          </div>
          <p className="text-xs text-gray-400 mb-3 ml-10">
            For skin tears, bruising, rashes, or pressure sores.
          </p>
          {photoPreview ? (
            <div className="relative w-full max-w-[200px] aspect-square ml-0.5">
              <Image
                src={photoPreview}
                alt="Attached"
                fill
                unoptimized
                className="rounded-xl border border-gray-100 object-cover"
              />
              <button
                type="button"
                onClick={clearPhoto}
                className="absolute -top-2 -right-2 bg-white border border-gray-200 rounded-full p-1 text-gray-500 hover:text-red-500 shadow-sm"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="ml-0.5 flex items-center gap-2 text-sm font-semibold text-[#357366] bg-[#EAF4F1] hover:bg-[#DCEEE8] px-4 py-2.5 rounded-xl transition-all"
            >
              <Camera className="w-4 h-4" />
              Add photo
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoSelect}
            className="hidden"
          />
        </div>

        {/* Vitals — optional, collapsible, units + icons */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow">
          <button
            type="button"
            onClick={() => setShowVitals((v) => !v)}
            className="w-full flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[#EAF4F1] flex items-center justify-center flex-shrink-0">
                <HeartPulse className="w-4 h-4 text-[#357366]" />
              </div>
              <span className="font-semibold text-gray-800 text-sm">
                Vitals
                <span className="text-[10px] font-medium text-gray-400 ml-1.5">
                  optional
                </span>
              </span>
            </div>
            <ChevronDown
              className={`w-4 h-4 text-gray-400 transition-transform ${
                showVitals ? "rotate-180" : ""
              }`}
            />
          </button>
          {showVitals && (
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                <label className="text-xs font-medium text-gray-500 flex items-center gap-1">
                  <Gauge className="w-3.5 h-3.5 text-gray-400" />
                  BP — systolic
                  <span className="text-gray-400 font-normal">(mmHg)</span>
                </label>
                <input
                  type="number"
                  value={systolic}
                  onChange={(e) => setSystolic(e.target.value)}
                  placeholder="120"
                  className="mt-1.5 w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-[#4F9C8B] focus:ring-2 focus:ring-[#4F9C8B]/20 transition-all"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 flex items-center gap-1">
                  <Gauge className="w-3.5 h-3.5 text-gray-400" />
                  BP — diastolic
                  <span className="text-gray-400 font-normal">(mmHg)</span>
                </label>
                <input
                  type="number"
                  value={diastolic}
                  onChange={(e) => setDiastolic(e.target.value)}
                  placeholder="80"
                  className="mt-1.5 w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-[#4F9C8B] focus:ring-2 focus:ring-[#4F9C8B]/20 transition-all"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 flex items-center gap-1">
                  <HeartPulse className="w-3.5 h-3.5 text-gray-400" />
                  Heart rate
                  <span className="text-gray-400 font-normal">(bpm)</span>
                </label>
                <input
                  type="number"
                  value={heartRate}
                  onChange={(e) => setHeartRate(e.target.value)}
                  placeholder="72"
                  className="mt-1.5 w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-[#4F9C8B] focus:ring-2 focus:ring-[#4F9C8B]/20 transition-all"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 flex items-center gap-1">
                  <Thermometer className="w-3.5 h-3.5 text-gray-400" />
                  Temperature
                  <span className="text-gray-400 font-normal">(°F)</span>
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                  placeholder="98.6"
                  className="mt-1.5 w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-[#4F9C8B] focus:ring-2 focus:ring-[#4F9C8B]/20 transition-all"
                />
              </div>
            </div>
          )}
        </div>

        {/* Pain scale — optional, note required at 6+ */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[#EAF4F1] flex items-center justify-center flex-shrink-0">
                <Gauge className="w-4 h-4 text-[#357366]" />
              </div>
              <span className="font-semibold text-gray-800 text-sm">
                Pain scale
                <span className="text-[10px] font-medium text-gray-400 ml-1.5">
                  optional
                </span>
              </span>
            </div>
            <span
              className={`text-2xl font-extrabold ${
                painScale >= 6
                  ? "text-red-600"
                  : painScale >= 3
                    ? "text-amber-600"
                    : "text-gray-300"
              }`}
            >
              {painScale}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={10}
            step={1}
            value={painScale}
            onChange={(e) => setPainScale(Number(e.target.value))}
            className="w-full accent-[#357366]"
          />
          <div className="flex justify-between text-[10px] text-gray-400 mt-1 px-0.5">
            <span>No pain</span>
            <span>Worst pain</span>
          </div>
          {painRequired && (
            <div className="mt-4">
              <label className="text-xs font-semibold text-red-600">
                Location / nature of pain
                <span className="text-red-500">*</span> — required at this
                level
              </label>
              <textarea
                value={painNote}
                onChange={(e) => setPainNote(e.target.value)}
                rows={2}
                placeholder="e.g. Left hip, sharp, worsens on movement"
                className="mt-1.5 w-full rounded-xl border border-red-200 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-400/20 transition-all resize-none"
              />
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={!allDone || saving}
          className={`w-full py-4 rounded-2xl text-base font-bold transition-all ${
            allDone && !saving
              ? "bg-[#4F9C8B] hover:bg-[#438a7a] text-white shadow-sm hover:shadow-md"
              : "bg-gray-200 text-gray-400 cursor-not-allowed"
          }`}
        >
          {saving ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Saving...
            </span>
          ) : (
            "Save Care Log"
          )}
        </button>

        {!allDone && (
          <p className="text-center text-gray-400 text-sm pb-4">
            Select one option in every required category to save
          </p>
        )}
      </main>
    </div>
  );
}