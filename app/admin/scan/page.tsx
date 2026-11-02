"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  AlertTriangle,
  Camera,
  CameraOff,
  CheckCircle2,
  History,
  Loader2,
  ScanLine,
  Search,
  XCircle,
} from "lucide-react";
import { db } from "@/lib/firebase";
import AdminGate, { scannerCode } from "@/components/AdminGate";
import { THEATER_ATTENDEES_COLLECTION, type Attendee } from "@/lib/types";
import { extractAttendeeId, formatTimestamp } from "@/lib/utils";
import { cn } from "@/lib/utils";

type ScanResult =
  | { kind: "success"; attendee: Attendee }
  | { kind: "warning"; attendee: Attendee }
  | { kind: "error"; message: string };

interface RecentEntry {
  at: Date;
  attendee: Attendee | null;
  rawId: string;
  outcome: "checked-in" | "duplicate" | "invalid";
}

function playChime(ok: boolean) {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = ok ? 880 : 220;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => void ctx.close();
  } catch {
    // Audio not available — ignore.
  }
}

export default function ScanPage() {
  const [scannerState, setScannerState] = useState<
    "idle" | "starting" | "scanning" | "stopped" | "failed"
  >("idle");
  const [cameraError, setCameraError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>([]);

  // Manual fallback
  const [manual, setManual] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [manualHits, setManualHits] = useState<Attendee[]>([]);
  const [manualMsg, setManualMsg] = useState("");

  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const cooldownRef = useRef(false);
  const resultTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopScanner = useCallback(async () => {
    try {
      if (scannerRef.current) {
        await scannerRef.current.stop();
        scannerRef.current.clear();
        scannerRef.current = null;
      }
    } catch {
      // already stopped
    } finally {
      setScannerState("stopped");
    }
  }, []);

  useEffect(() => {
    return () => {
      if (resultTimer.current) clearTimeout(resultTimer.current);
      // Best-effort cleanup of the camera on unmount.
      scannerRef.current?.stop().catch(() => {});
    };
  }, []);

  const handleDecoded = useCallback(async (decodedText: string) => {
    if (cooldownRef.current || processing) return;
    cooldownRef.current = true;
    setProcessing(true);
    const id = extractAttendeeId(decodedText);
    await checkInById(id);
    setProcessing(false);
    // 2.5s cooldown so one QR doesn't fire repeatedly.
    setTimeout(() => {
      cooldownRef.current = false;
    }, 2500);
  }, [processing]);

  async function checkInById(rawId: string) {
    const id = extractAttendeeId(rawId);
    if (!id) {
      setResult({ kind: "error", message: "Empty QR code — no attendee ID found." });
      playChime(false);
      return;
    }
    if (!navigator.onLine) {
      setResult({
        kind: "error",
        message: "You are offline. Reconnect before checking in (offline check-in is not queued in this version).",
      });
      playChime(false);
      return;
    }
    try {
      const ref = doc(db, THEATER_ATTENDEES_COLLECTION, id);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        setResult({ kind: "error", message: `Invalid QR Code — no attendee found for ID “${id}”.` });
        setRecent((r) => [{ at: new Date(), attendee: null, rawId: id, outcome: "invalid" } as RecentEntry, ...r].slice(0, 8));
        playChime(false);
        try { navigator.vibrate?.(100); } catch {}
        return;
      }
      const attendee = { ...(snap.data() as Attendee), id: snap.id };
      if (attendee.checkedIn) {
        setResult({ kind: "warning", attendee });
        setRecent((r) => [{ at: new Date(), attendee, rawId: id, outcome: "duplicate" } as RecentEntry, ...r].slice(0, 8));
        playChime(false);
        try { navigator.vibrate?.([80, 60, 80]); } catch {}
        return;
      }
      await updateDoc(ref, { checkedIn: true, checkedInAt: serverTimestamp() });
      const updated: Attendee = { ...attendee, checkedIn: true, checkedInAt: null };
      // Re-read to get the server timestamp for display.
      try {
        const fresh = await getDoc(ref);
        if (fresh.exists()) Object.assign(updated, fresh.data(), { id: fresh.id });
      } catch {}
      setResult({ kind: "success", attendee: updated });
      setRecent((r) => [{ at: new Date(), attendee: updated, rawId: id, outcome: "checked-in" } as RecentEntry, ...r].slice(0, 8));
      playChime(true);
      try { navigator.vibrate?.(200); } catch {}
    } catch (e) {
      console.error(e);
      setResult({
        kind: "error",
        message: e instanceof Error ? `Check-in failed: ${e.message}` : "Check-in failed.",
      });
      playChime(false);
    }
  }

  async function startScanner() {
    setCameraError("");
    setScannerState("starting");
    try {
      // Dynamic import: html5-qrcode touches `window`/`navigator` at load time.
      const { Html5Qrcode } = await import("html5-qrcode");
      const elementId = "qr-reader";
      // Ensure the container exists and is empty.
      const el = document.getElementById(elementId);
      if (el) el.innerHTML = "";

      const qr = new Html5Qrcode(elementId, { verbose: false });
      // Keep a stop/clear handle for cleanup + manual stop button.
      scannerRef.current = {
        stop: () => qr.stop(),
        clear: () => {
          try { qr.clear(); } catch {}
        },
      };

      await qr.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
        (decodedText) => void handleDecoded(decodedText),
        () => {
          // per-frame decode failures are normal — ignore.
        }
      );
      setScannerState("scanning");
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : String(e);
      let friendly = `Could not start the camera: ${msg}`;
      if (/NotAllowedError|Permission denied|denied/i.test(msg)) {
        friendly =
          "Camera permission denied. Allow camera access in your browser (lock icon in the address bar), then press Retry. You can still use manual search below.";
      } else if (/NotFoundError|no camera|NotFound/i.test(msg)) {
        friendly =
          "No camera found on this device/browser. Use the manual search below, or open this page on a phone.";
      } else if (/NotReadableError|in use|TrackStart/i.test(msg)) {
        friendly =
          "Camera is in use by another app or tab. Close other camera apps and press Retry.";
      } else if (/Secure context|https/i.test(msg)) {
        friendly =
          "Camera requires HTTPS or localhost. Deploy to Vercel (HTTPS) or run on localhost, then retry.";
      }
      setCameraError(friendly);
      setScannerState("failed");
    }
  }

  async function manualSearch(e?: React.FormEvent) {
    e?.preventDefault();
    const q = manual.trim();
    setManualMsg("");
    setManualHits([]);
    if (!q) {
      setManualMsg("Type a name, email, phone number, or QR Code ID.");
      return;
    }
    setManualBusy(true);
    try {
      const col = collection(db, THEATER_ATTENDEES_COLLECTION);
      // 1) Direct ID lookup.
      if (!q.includes("@") && !q.includes(" ") && q.length >= 6) {
        const byId = await getDoc(doc(db, THEATER_ATTENDEES_COLLECTION, q));
        if (byId.exists()) {
          setManualHits([{ ...(byId.data() as Attendee), id: byId.id }]);
          setManualBusy(false);
          return;
        }
      }
      // 2) Exact email match.
      if (q.includes("@")) {
        const snap = await getDocs(query(col, where("email", "==", q.toLowerCase()), limit(5)));
        if (!snap.empty) {
          setManualHits(snap.docs.map((d) => ({ ...(d.data() as Attendee), id: d.id })));
          setManualBusy(false);
          return;
        }
        setManualMsg(`No attendee found for email “${q}”.`);
        setManualBusy(false);
        return;
      }
      // 3) Phone lookup: match digits ignoring formatting (+, spaces, dashes).
      const qDigits = q.replace(/\D/g, "");
      if (qDigits.length >= 7) {
        // Try exact text match first (cheap), then digit-normalized client filter.
        const exact = await getDocs(query(col, where("phone", "==", q), limit(5)));
        if (!exact.empty) {
          setManualHits(exact.docs.map((d) => ({ ...(d.data() as Attendee), id: d.id })));
          setManualBusy(false);
          return;
        }
        const snap = await getDocs(query(col, orderBy("name"), limit(100)));
        const phoneHits = snap.docs
          .map((d) => ({ ...(d.data() as Attendee), id: d.id }))
          .filter((a) => (a.phone || "").replace(/\D/g, "").includes(qDigits))
          .slice(0, 10);
        if (phoneHits.length > 0) {
          setManualHits(phoneHits);
          setManualBusy(false);
          return;
        }
        // No phone hit — fall through to name search in case it's a mixed query.
      }
      // 4) Name prefix search (case-sensitive prefix in Firestore + case-insensitive client fallback).
      let hits: Attendee[] = [];
      try {
        const snap = await getDocs(
          query(col, orderBy("name"), where("name", ">=", q), where("name", "<=", q + "\uf8ff"), limit(10))
        );
        hits = snap.docs.map((d) => ({ ...(d.data() as Attendee), id: d.id }));
      } catch {
        // orderBy+range may fail without data/index — fall back to client filter below.
      }
      if (hits.length === 0) {
        const snap = await getDocs(query(col, orderBy("name"), limit(50)));
        const lower = q.toLowerCase();
        const lowerDigits = q.replace(/\D/g, "");
        hits = snap.docs
          .map((d) => ({ ...(d.data() as Attendee), id: d.id }))
          .filter(
            (a) =>
              a.name.toLowerCase().includes(lower) ||
              a.email.toLowerCase().includes(lower) ||
              a.phone.includes(q) ||
              (lowerDigits.length >= 3 &&
                (a.phone || "").replace(/\D/g, "").includes(lowerDigits)) ||
              a.id.toLowerCase() === lower
          )
          .slice(0, 10);
      }
      setManualHits(hits);
      if (hits.length === 0) setManualMsg(`No attendees matching “${q}”.`);
    } catch (err) {
      console.error(err);
      setManualMsg(err instanceof Error ? `Search failed: ${err.message}` : "Search failed.");
    } finally {
      setManualBusy(false);
    }
  }

  async function manualCheckIn(a: Attendee) {
    if (a.checkedIn) {
      setResult({ kind: "warning", attendee: a });
      return;
    }
    await checkInById(a.id);
    // Refresh the manual hit to show updated status.
    setManualHits((hits) =>
      hits.map((h) => (h.id === a.id ? { ...h, checkedIn: true } : h))
    );
  }

  return (
    <AdminGate
      code={scannerCode()}
      storageKey="event-scanner-auth"
      title="Scanner access"
      description="Enter the scanner passcode to start checking in attendees."
      unlockLabel="Unlock scanner"
    >
      <div className="mx-auto max-w-3xl">
        <div>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <ScanLine className="h-6 w-6" /> Check-in scanner
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Point the camera at an attendee QR. Each QR holds the attendee ID.
            </p>
          </div>
        </div>

        {/* Scanner card */}
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-6">
          {scannerState !== "scanning" && (
            <div className="grid place-items-center rounded-xl bg-slate-950 px-4 py-10 text-center text-white">
              <Camera className="h-8 w-8 text-white/60" />
              <p className="mt-2 text-sm text-white/80">
                {scannerState === "starting"
                  ? "Requesting camera…"
                  : "Camera is off. Start the scanner when you're at the door."}
              </p>
              <button
                onClick={startScanner}
                disabled={scannerState === "starting"}
                className="mt-4 flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-200 disabled:opacity-60"
              >
                {scannerState === "starting" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Camera className="h-4 w-4" />
                )}
                {scannerState === "starting" ? "Starting…" : "Start scanner"}
              </button>
            </div>
          )}

          {/* html5-qrcode mounts here. Keep mounted container always rendered. */}
          <div className={cn(scannerState === "scanning" ? "block" : "hidden")}>
            <div id="qr-reader" className="overflow-hidden rounded-xl bg-slate-950" />
            <div className="mt-3 flex items-center justify-between">
              <p className="flex items-center gap-2 text-sm text-slate-500">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                </span>
                Scanning… hold QR steady in the frame
                {processing && <Loader2 className="h-4 w-4 animate-spin" />}
              </p>
              <button
                onClick={stopScanner}
                className="flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100"
              >
                <CameraOff className="h-4 w-4" /> Stop
              </button>
            </div>
          </div>

          {cameraError && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p>{cameraError}</p>
                <button
                  onClick={startScanner}
                  className="mt-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500"
                >
                  Retry camera
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Result card */}
        {result && (
          <div
            className={cn(
              "mt-4 rounded-2xl border p-4 sm:p-5",
              result.kind === "success" &&
                "border-emerald-300 bg-emerald-50 text-emerald-950",
              result.kind === "warning" &&
                "border-amber-300 bg-amber-50 text-amber-950",
              result.kind === "error" && "border-red-300 bg-red-50 text-red-950"
            )}
            role="status"
          >
            {result.kind === "success" && (
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-emerald-600">
                    Checked in ✓
                  </p>
                  <p className="mt-1 text-xl font-bold">{result.attendee.name}</p>
                  <p className="text-sm opacity-80">
                    {[result.attendee.seatNumber, result.attendee.email]
                      .filter(Boolean)
                      .join(" • ")}
                  </p>
                  <p className="mt-1 font-mono text-xs opacity-60">
                    {result.attendee.id}
                  </p>
                </div>
              </div>
            )}
            {result.kind === "warning" && (
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-amber-600" />
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-amber-600">
                    Already checked in
                  </p>
                  <p className="mt-1 text-xl font-bold">{result.attendee.name}</p>
                  <p className="text-sm opacity-80">
                    First checked in at {formatTimestamp(result.attendee.checkedInAt)}.
                    Do not admit twice without verifying.
                  </p>
                  <p className="mt-1 font-mono text-xs opacity-60">
                    {result.attendee.id}
                  </p>
                </div>
              </div>
            )}
            {result.kind === "error" && (
              <div className="flex items-start gap-3">
                <XCircle className="mt-0.5 h-6 w-6 shrink-0 text-red-600" />
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-red-600">
                    Invalid QR Code
                  </p>
                  <p className="mt-1 text-sm font-medium">{result.message}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Manual fallback */}
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-6">
          <h2 className="flex items-center gap-2 font-semibold">
            <Search className="h-4 w-4" /> Manual search fallback
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Camera failing? Search by name, email, phone number, or paste the QR Code ID.
          </p>
          <form onSubmit={manualSearch} className="mt-3 flex gap-2">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="e.g. بولا صلاح فتحي or 01*********"
              inputMode="search"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
            />
            <button
              type="submit"
              disabled={manualBusy}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
            >
              {manualBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Search
            </button>
          </form>
          {manualMsg && <p className="mt-2 text-sm text-slate-500">{manualMsg}</p>}
          {manualHits.length > 0 && (
            <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
              {manualHits.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{a.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {[a.email, a.seatNumber].filter(Boolean).join(" • ")}
                    </p>
                    <p className="truncate text-xs text-slate-500" dir="ltr">
                      {a.phone}
                    </p>
                    <p className="font-mono text-[11px] text-slate-400">{a.id}</p>
                  </div>
                  <button
                    onClick={() => manualCheckIn(a)}
                    className={cn(
                      "shrink-0 rounded-xl px-3 py-2 text-xs font-semibold",
                      a.checkedIn
                        ? "bg-amber-100 text-amber-800 hover:bg-amber-200"
                        : "bg-emerald-600 text-white hover:bg-emerald-500"
                    )}
                  >
                    {a.checkedIn ? "Verify / re-check" : "Check in"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Recent scans */}
        {recent.length > 0 && (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-6">
            <h2 className="flex items-center gap-2 font-semibold">
              <History className="h-4 w-4" /> This session
            </h2>
            <ul className="mt-3 space-y-2">
              {recent.map((r, i) => (
                <li
                  key={`${r.rawId}-${i}`}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm",
                    r.outcome === "checked-in" && "border-emerald-200 bg-emerald-50",
                    r.outcome === "duplicate" && "border-amber-200 bg-amber-50",
                    r.outcome === "invalid" && "border-red-200 bg-red-50"
                  )}
                >
                  <span className="min-w-0">
                    <span className="font-semibold">
                      {r.attendee ? r.attendee.name : "Unknown QR Code"}
                    </span>{" "}
                    <span className="font-mono text-xs opacity-60">{r.rawId}</span>
                  </span>
                  <span className="shrink-0 text-xs opacity-70">
                    {r.outcome === "checked-in" && "✓ checked in"}
                    {r.outcome === "duplicate" && "⚠ duplicate"}
                    {r.outcome === "invalid" && "✕ invalid"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </AdminGate>
  );
}
