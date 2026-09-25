"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import SOSModal from "@/components/SOSModal";
import ResidentQuickView from "@/components/ResidentQuickView";
import EndOfShiftModal from "@/components/EndOfShiftModal";
import LiveAlerts from "@/components/LiveAlerts";

type Resident = {
  id: string;
  full_name: string;
  room_number: string | null;
  photo_url: string | null;
  status: string;
};

type StaffUser = {
  id: string;
  email: string | undefined;
  full_name: string | null;
};

type HandoverNote = {
  id: string;
  note: string;
  shift: string | null;
  created_at: string;
};

function startOfTodayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function StaffDashboard() {
  const router = useRouter();
  const [residents, setResidents] = useState<Resident[]>([]);
  const [loggedIds, setLoggedIds] = useState<Set<string>>(new Set());
  const [sosCountToday, setSosCountToday] = useState(0);
  const [handoverNotes, setHandoverNotes] = useState<HandoverNote[]>([]);
  const [newNote, setNewNote] = useState("");
  const [postingNote, setPostingNote] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sosResident, setSosResident] = useState<Resident | null>(null);
  const [quickViewResident, setQuickViewResident] = useState<Resident | null>(
    null,
  );
  const [assistResident, setAssistResident] = useState<Resident | null>(null);
  const [assistMessage, setAssistMessage] = useState("");
  const [sendingAssist, setSendingAssist] = useState(false);
  const [showEndShift, setShowEndShift] = useState(false);
  const [user, setUser] = useState<StaffUser | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function load() {
      const supabase = createClient();

      const {
        data: { user: u },
      } = await supabase.auth.getUser();
      if (!u) {
        router.push("/login");
        return;
      }

      const todayStart = startOfTodayISO();

      // Staff profile (full name). ASSUMPTION: a `profiles` table keyed by
      // auth user id with a `full_name` column. Adjust to your schema —
      // wrapped so a missing/renamed table just falls back to email.
      const profilePromise = supabase
        .from("profiles")
        .select("full_name")
        .eq("id", u.id)
        .single();

      const residentsPromise = supabase
        .from("residents")
        .select("id, full_name, room_number, photo_url, status")
        .eq("status", "active")
        .order("full_name");

      const careLogsPromise = supabase
        .from("care_logs")
        .select("resident_id")
        .gte("created_at", todayStart);

      const sosPromise = supabase
        .from("emergency_alerts")
        .select("id", { count: "exact", head: true })
        .gte("created_at", todayStart);

      const handoverPromise = supabase
        .from("handover_notes")
        .select("id, note, shift, created_at")
        .order("created_at", { ascending: false })
        .limit(5);

      const [
        profileResult,
        { data: residentData, error: residentError },
        { data: logData },
        { count: sosCount },
        handoverResult,
      ] = await Promise.all([
        profilePromise.then(
          (r) => r,
          () => ({ data: null, error: true }),
        ),
        residentsPromise,
        careLogsPromise,
        sosPromise,
        handoverPromise.then(
          (r) => r,
          () => ({ data: null, error: true }),
        ),
      ]);

      setUser({
        id: u.id,
        email: u.email,
        full_name:
          profileResult && "data" in profileResult && profileResult.data
            ? (profileResult.data as { full_name: string | null }).full_name
            : null,
      });

      if (!residentError && residentData) setResidents(residentData);
      if (logData) {
        setLoggedIds(new Set(logData.map((l) => l.resident_id as string)));
      }
      setSosCountToday(sosCount ?? 0);
      if (handoverResult && "data" in handoverResult && handoverResult.data) {
        setHandoverNotes(handoverResult.data as HandoverNote[]);
      }

      setLoading(false);
    }
    load();
  }, [router]);

  async function refreshHandoverNotes() {
    const supabase = createClient();
    const { data } = await supabase
      .from("handover_notes")
      .select("id, note, shift, created_at")
      .order("created_at", { ascending: false })
      .limit(5);
    if (data) setHandoverNotes(data as HandoverNote[]);
  }

  async function handlePostNote() {
    if (!newNote.trim()) return;
    setPostingNote(true);
    const supabase = createClient();
    const { error } = await supabase.from("handover_notes").insert({
      note: newNote.trim(),
    });
    setPostingNote(false);
    if (!error) {
      setNewNote("");
      await refreshHandoverNotes();
    }
  }

  async function handleSendAssistance() {
    if (!assistResident) return;
    setSendingAssist(true);
    const supabase = createClient();
    await supabase.from("assistance_requests").insert({
      resident_id: assistResident.id,
      message: assistMessage.trim() || "Assistance requested",
      status: "open",
    });
    setSendingAssist(false);
    setAssistResident(null);
    setAssistMessage("");
  }

  async function handleSignOutRequest() {
    // Route sign-out through the end-of-shift summary first.
    setShowEndShift(true);
  }

  async function handleConfirmSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  const filtered = residents.filter((r) =>
    r.full_name.toLowerCase().includes(search.toLowerCase()),
  );

  const pending = filtered.filter((r) => !loggedIds.has(r.id));
  const logged = filtered.filter((r) => loggedIds.has(r.id));

  const initials = (name: string) =>
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

  const displayName = user?.full_name || user?.email || "Staff";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAF8]">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-[#4F9C8B] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-400 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAF8]">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-[#EAF4F1] flex items-center justify-center">
              <span className="text-[#357366] font-bold text-sm">EL</span>
            </div>
            <span className="font-bold text-gray-900">ElderLink</span>
            <span className="text-gray-300 mx-1">|</span>
            <span className="text-sm text-gray-500">Staff</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowEndShift(true)}
              className="text-xs text-gray-500 hover:text-[#357366] border border-gray-200 hover:border-[#4F9C8B] px-3 py-1.5 rounded-lg transition-all hidden sm:block"
            >
              End of shift summary
            </button>
            <div className="flex items-center gap-2 border-l border-gray-100 pl-3">
              <div className="w-7 h-7 rounded-full bg-[#EAF4F1] flex items-center justify-center flex-shrink-0">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className="w-4 h-4 text-[#357366]"
                >
                  <path
                    d="M12 12a4 4 0 100-8 4 4 0 000 8zM4 20a8 8 0 0116 0"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <span className="text-xs text-gray-600 hidden sm:block max-w-[140px] truncate">
                {displayName}
              </span>
            </div>
            <button
              onClick={handleSignOutRequest}
              className="text-xs text-gray-500 hover:text-red-500 border border-gray-200 hover:border-red-200 px-3 py-1.5 rounded-lg transition-all"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* ── LIVE ALERTS (real-time fall/SOS feed from Supabase) ── */}
        <LiveAlerts />

        {/* ── SHIFT SUMMARY ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-1 bg-gradient-to-r from-[#357366] to-[#4F9C8B] rounded-2xl p-5 text-white flex flex-col justify-between">
            <div>
              <p className="text-green-200 text-xs font-medium mb-1">
                This shift
              </p>
              <h1 className="text-xl font-bold">
                {loggedIds.size}/{residents.length} logged
              </h1>
            </div>
            <div className="mt-3 w-full bg-white/20 rounded-full h-1.5">
              <div
                className="bg-white h-1.5 rounded-full transition-all duration-300"
                style={{
                  width: `${
                    residents.length
                      ? (loggedIds.size / residents.length) * 100
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-5 flex flex-col justify-between">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Pending logs
            </p>
            <p
              className={`text-4xl font-extrabold mt-2 ${
                pending.length > 0 ? "text-amber-600" : "text-[#357366]"
              }`}
            >
              {pending.length}
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-5 flex flex-col justify-between">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              SOS alerts today
            </p>
            <p
              className={`text-4xl font-extrabold mt-2 ${
                sosCountToday > 0 ? "text-red-600" : "text-gray-300"
              }`}
            >
              {sosCountToday}
            </p>
          </div>
        </div>

        {/* ── SHIFT HANDOFF WHITEBOARD ── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="font-semibold text-gray-900">Shift handoff notes</h2>
          </div>

          <div className="flex gap-2 mb-4">
            <input
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Leave a note for the next shift..."
              className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-[#4F9C8B] transition-all"
              onKeyDown={(e) => {
                if (e.key === "Enter") handlePostNote();
              }}
            />
            <button
              onClick={handlePostNote}
              disabled={postingNote || !newNote.trim()}
              className="px-4 py-2 bg-[#357366] text-white text-sm font-semibold rounded-lg disabled:opacity-40 transition-all"
            >
              {postingNote ? "Posting..." : "Post"}
            </button>
          </div>

          {handoverNotes.length === 0 ? (
            <p className="text-sm text-gray-400">No notes yet.</p>
          ) : (
            <div className="space-y-3">
              {handoverNotes.map((n) => (
                <div
                  key={n.id}
                  className="text-sm text-gray-700 border-l-2 border-[#4F9C8B] pl-3"
                >
                  <p>{n.note}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {n.shift ? `${n.shift} · ` : ""}
                    {new Date(n.created_at).toLocaleString("en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                      day: "2-digit",
                      month: "short",
                    })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
          >
            <circle
              cx="11"
              cy="11"
              r="7"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="M21 21l-4.3-4.3"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search residents..."
            className="w-full pl-9 pr-4 py-3 rounded-xl border border-gray-200 text-sm outline-none focus:border-[#4F9C8B] focus:shadow-[0_0_0_3px_rgba(79,156,139,0.12)] transition-all bg-white"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-400">
              {search
                ? "No residents match your search."
                : "No active residents found."}
            </p>
          </div>
        ) : (
          <>
            {pending.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  <h2 className="font-semibold text-gray-900">
                    Needs logging ({pending.length})
                  </h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {pending.map((r) => (
                    <ResidentCard
                      key={r.id}
                      resident={r}
                      initials={initials(r.full_name)}
                      pending
                      onSos={() => setSosResident(r)}
                      onQuickView={() => setQuickViewResident(r)}
                      onAssist={() => setAssistResident(r)}
                    />
                  ))}
                </div>
              </div>
            )}

            {logged.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3 mt-2">
                  <span className="w-2 h-2 rounded-full bg-[#4F9C8B]" />
                  <h2 className="font-semibold text-gray-500">
                    Logged ({logged.length})
                  </h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {logged.map((r) => (
                    <ResidentCard
                      key={r.id}
                      resident={r}
                      initials={initials(r.full_name)}
                      pending={false}
                      onSos={() => setSosResident(r)}
                      onQuickView={() => setQuickViewResident(r)}
                      onAssist={() => setAssistResident(r)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {sosResident && (
        <SOSModal
          key={sosResident.id}
          resident={sosResident}
          isOpen={!!sosResident}
          onClose={() => setSosResident(null)}
        />
      )}

      {quickViewResident && (
        <ResidentQuickView
          resident={quickViewResident}
          onClose={() => setQuickViewResident(null)}
        />
      )}

      {/* Request Assistance modal */}
      {assistResident && (
        <div className="fixed inset-0 z-30 flex items-end sm:items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5">
            <h3 className="font-semibold text-gray-900 mb-1">
              Request assistance
            </h3>
            <p className="text-sm text-gray-400 mb-4">
              For {assistResident.full_name} — pings a nearby staff member or
              supervisor. Not an emergency alert.
            </p>
            <textarea
              value={assistMessage}
              onChange={(e) => setAssistMessage(e.target.value)}
              placeholder="e.g. Need a hand with a two-person lift"
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-[#4F9C8B] transition-all mb-4"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setAssistResident(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={handleSendAssistance}
                disabled={sendingAssist}
                className="flex-1 py-2.5 rounded-xl bg-[#357366] text-white text-sm font-semibold disabled:opacity-40"
              >
                {sendingAssist ? "Sending..." : "Send request"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showEndShift && user && (
        <EndOfShiftModal
          staffId={user.id}
          staffName={displayName}
          totalResidents={residents.length}
          loggedCount={loggedIds.size}
          sosCountToday={sosCountToday}
          onClose={() => setShowEndShift(false)}
          onConfirmSignOut={handleConfirmSignOut}
        />
      )}
    </div>
  );
}

function ResidentCard({
  resident: r,
  initials,
  pending,
  onSos,
  onQuickView,
  onAssist,
}: {
  resident: Resident;
  initials: string;
  pending: boolean;
  onSos: () => void;
  onQuickView: () => void;
  onAssist: () => void;
}) {
  return (
    <div
      className={`bg-white rounded-2xl border shadow-sm p-5 flex flex-col gap-4 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 ${
        pending ? "border-amber-200" : "border-gray-100 opacity-90"
      }`}
    >
      <div className="flex items-center gap-3">
        {r.photo_url ? (
          <Image
            src={r.photo_url}
            alt={r.full_name}
            width={56}
            height={56}
            className="w-14 h-14 rounded-full object-cover border border-gray-100 flex-shrink-0"
          />
        ) : (
          <div className="w-14 h-14 rounded-full bg-[#EAF4F1] text-[#357366] font-bold text-lg flex items-center justify-center flex-shrink-0">
            {initials}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <button
            onClick={onQuickView}
            className="font-semibold text-gray-900 truncate text-left hover:text-[#357366] hover:underline underline-offset-2"
          >
            {r.full_name}
          </button>
          <p className="text-sm text-gray-400">
            {r.room_number ? `Room ${r.room_number}` : "No room assigned"}
          </p>
        </div>
        {pending && (
          <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-1 rounded-full flex-shrink-0">
            PENDING
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2 mt-auto">
        <Link
          href={`/staff/residents/${r.id}/log`}
          className="w-full text-center bg-[#4F9C8B] hover:bg-[#438a7a] text-white font-semibold py-3 rounded-xl text-sm transition-all active:scale-95"
        >
          Log Care
        </Link>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onAssist}
            className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 rounded-xl text-sm transition-all active:scale-95"
          >
            Request Help
          </button>
          <button
            onClick={onSos}
            className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-2.5 rounded-xl text-sm transition-all active:scale-95"
          >
            SOS Alert
          </button>
        </div>
      </div>
    </div>
  );
}
