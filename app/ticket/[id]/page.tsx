"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import QRCode from "qrcode";
import { doc, getDoc } from "firebase/firestore";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  Loader2,
  QrCode,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { THEATER_ATTENDEES_COLLECTION, type Attendee } from "@/lib/types";
import { LogoMark } from "@/components/Logo";
import { formatTimestamp } from "@/lib/utils";

const EVENT_NAME =
  process.env.NEXT_PUBLIC_EVENT_NAME ?? "مسرحية: عملت ايه فينا السنين؟";
const EVENT_DATE =
  process.env.NEXT_PUBLIC_EVENT_DATE ?? "الخميس 19 نوفمبر 2026";
const EVENT_TIME = process.env.NEXT_PUBLIC_EVENT_TIME ?? "6:00 مساءً";
const EVENT_VENUE =
  process.env.NEXT_PUBLIC_EVENT_VENUE ??
  "مسرح سان جورج للأقباط الكاثوليك - مصر الجديدة | St. Georges Coptic Catholic Theater - Heliopolis";

export default function TicketPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [attendee, setAttendee] = useState<Attendee | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "not-found" | "error">(
    "loading"
  );
  const [errorMsg, setErrorMsg] = useState("");
  const qrRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setState("not-found");
      return;
    }
    setState("loading");
    try {
      const snap = await getDoc(doc(db, THEATER_ATTENDEES_COLLECTION, id));
      if (!snap.exists()) {
        setState("not-found");
        return;
      }
      const data = snap.data() as Attendee;
      setAttendee(data);
      // QR payload is the raw attendeeId (per spec).
      const url = await QRCode.toDataURL(data.id, {
        width: 512,
        margin: 2,
        errorCorrectionLevel: "M",
      });
      qrRef.current = url;
      setQrDataUrl(url);
      setState("ready");
    } catch (e) {
      console.error(e);
      setErrorMsg(
        e instanceof Error ? e.message : "Could not load QR Code."
      );
      setState("error");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  /** Compose a full ticket PNG on canvas (no extra dependency). */
  async function downloadFullTicketPng() {
    if (!qrRef.current || !attendee) return;
    const W = 1200;
    const H = 560;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Background
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, "#0f172a");
    grad.addColorStop(1, "#4c1d95");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Card
    const pad = 40;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(pad, pad, W - pad * 2, H - pad * 2, 28);
    } else {
      ctx.rect(pad, pad, W - pad * 2, H - pad * 2);
    }
    ctx.fill();

    // Left: event + attendee text
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 20px system-ui, sans-serif";
    ctx.fillText(EVENT_NAME.toUpperCase(), 90, 130);
    ctx.font = "bold 52px system-ui, sans-serif";
    ctx.fillText(attendee.name.slice(0, 26), 90, 195);
    ctx.font = "bold 16px system-ui, sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText("SEAT NUMBER", 90, 236);
    ctx.font = "24px system-ui, sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(attendee.seatNumber.slice(0, 10), 90, 266);
    ctx.fillText(attendee.phone.slice(0, 60), 90, 290);
    ctx.font = "22px system-ui, sans-serif";
    ctx.fillStyle = "#334155";
    ctx.fillText(`${EVENT_DATE}`, 90, 330);
    ctx.fillText(`${EVENT_VENUE}`, 90, 362);
    ctx.fillText(`${EVENT_TIME}`, 90, 384);
    ctx.font = "bold 20px monospace";
    ctx.fillStyle = "#111827";
    ctx.fillText(`ID: ${attendee.id}`, 90, 430);
    ctx.font = "18px system-ui, sans-serif";
    ctx.fillStyle = attendee.checkedIn ? "#15803d" : "#b45309";
    ctx.fillText(
      attendee.checkedIn
        ? `● CHECKED IN ${formatTimestamp(attendee.checkedInAt)}`
        : "● SHOW THIS QR AT THE DOOR",
      90,
      465
    );

    // Right: QR
    const img = new Image();
    img.src = qrRef.current;
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
    });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(W - 420, 110, 300, 300);
    ctx.drawImage(img, W - 420, 110, 300, 300);

    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `ticket-${attendee.id}.png`;
    a.click();
  }

  if (state === "loading") {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-20 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        <p className="text-sm text-slate-500">Loading your QR Code…</p>
      </div>
    );
  }

  if (state === "not-found") {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
        <h1 className="mt-3 text-lg font-semibold">QR Code not found</h1>
        <p className="mt-1 text-sm text-slate-600">
          No attendee exists with ID <code className="font-mono">{id}</code>.
          The link may be incomplete.
        </p>
        <button
          onClick={() => router.push("/")}
          className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
        >
          Register instead
        </button>
      </div>
    );
  }

  if (state === "error" || !attendee) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-red-500" />
        <h1 className="mt-3 text-lg font-semibold">Couldn&apos;t load QR Code</h1>
        <p className="mt-1 break-words text-sm text-slate-600">{errorMsg}</p>
        <div className="mt-4 flex justify-center gap-2">
          <button
            onClick={load}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          >
            Retry
          </button>
          <Link
            href="/"
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100"
          >
            Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <button
        onClick={() => router.push("/")}
        className="no-print mb-4 flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" /> Back to registration
      </button>

      <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
        You&apos;re registered! Screenshot this page or download your QR Code
        below.
      </div>

      {/* Printable ticket */}
      <div
        id="printable-ticket"
        className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card"
      >
        <div className="bg-[#0d5c63] px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            <LogoMark className="h-12 w-12 shrink-0 border border-white/20" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-white/70">
                Admit one • {EVENT_DATE}
              </p>
              <h1 className="mt-0.5 text-2xl font-bold">{EVENT_NAME}</h1>
              <p className="mt-0.5 text-sm text-white/70">{EVENT_VENUE}</p>
              <p className="mt-0.5 text-sm text-white/70">{EVENT_TIME}</p>
            </div>
          </div>
        </div>
        <div className="grid gap-6 p-6 sm:grid-cols-[1fr_220px]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Attendee
            </p>
            <p className="mt-1 text-2xl font-bold">{attendee.name}</p>
            <dl className="mt-4 space-y-1.5 text-sm">
              {/* صندوق رقم المقعد المنظم */}
              <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700/50 rounded-2xl p-4 text-center my-4 shadow-sm">
                <p className="text-xs uppercase tracking-wider text-white font-medium mb-1">
                  Seat Number
                </p>
                <p className="text-2xl font-bold text-white tracking-wide">
                  {attendee.seatNumber}
                </p>
              </div>
              <div className="flex gap-2">
                <dt className="w-14 shrink-0 text-slate-400">Phone</dt>
                <dd>{attendee.phone}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-14 shrink-0 text-slate-400">ID</dt>
                <dd className="font-mono text-xs leading-5">{attendee.id}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-14 shrink-0 text-slate-400">Status</dt>
                <dd>
                  {attendee.checkedIn ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                      Checked in • {formatTimestamp(attendee.checkedInAt)}
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                      Pending check-in
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          </div>
          <div className="flex flex-col items-center">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrDataUrl}
                alt={`QR code for attendee ${attendee.id}`}
                className="h-52 w-52 rounded-xl border border-slate-200"
              />
            ) : (
              <div className="grid h-52 w-52 place-items-center rounded-xl border border-slate-200 bg-slate-50">
                <QrCode className="h-8 w-8 text-slate-300" />
              </div>
            )}
            <p className="mt-2 text-center font-mono text-[11px] leading-4 text-slate-500">
              Scan contains
              <br />
              attendee ID
            </p>
          </div>
        </div>
      </div>

      <div className="no-print mt-4">
        <button
          onClick={downloadFullTicketPng}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700"
        >
          <Download className="h-4 w-4" /> QR Code
        </button>
      </div>
      <p className="no-print mt-3 text-center text-xs text-slate-400">
        Tip: on mobile, screenshot the QR — scanners work from the photo too.
      </p>
    </div>
  );
}
