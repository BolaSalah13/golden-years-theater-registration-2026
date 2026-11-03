"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  Loader2,
  RefreshCw,
  ScanLine,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { db } from "@/lib/firebase";
import AdminGate, { dashboardCode } from "@/components/AdminGate";
import { THEATER_ATTENDEES_COLLECTION, type Attendee } from "@/lib/types";
import { csvEscape, formatTimestamp } from "@/lib/utils";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | "checked-in" | "pending";

function toCsv(rows: Attendee[]): string {
  const header = ["Name", "Phone Number", "Seat Number"];
  const lines = rows.map((a) =>
    [
      a.name,
      a.phone,
      a.seatNumber,
    ]
      .map(csvEscape)
      .join(",")
  );
  return [header.map(csvEscape).join(","), ...lines].join("\n");
}

export default function DashboardPage() {
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError("");
    const q = query(collection(db, THEATER_ATTENDEES_COLLECTION), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setAttendees(snap.docs.map((d) => ({ ...(d.data() as Attendee), id: d.id })));
        setLoading(false);
      },
      (err) => {
        console.error(err);
        // orderBy fails on docs missing createdAt or without index in rare cases — fall back to unordered.
        if (/order|index/i.test(err.message)) {
          const fallback = onSnapshot(
            collection(db, THEATER_ATTENDEES_COLLECTION),
            (snap) => {
              setAttendees(snap.docs.map((d) => ({ ...(d.data() as Attendee), id: d.id })));
              setLoading(false);
            },
            (e2) => {
              setError(e2.message);
              setLoading(false);
            }
          );
          return fallback;
        }
        setError(
          /permission-denied/i.test(err.message)
            ? "Firestore denied reads. Update firestore.rules to allow admin reads, or sign in with an authorized account."
            : err.message
        );
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  const stats = useMemo(() => {
    const total = attendees.length;
    const checkedIn = attendees.filter((a) => a.checkedIn).length;
    return { total, checkedIn, remaining: total - checkedIn };
  }, [attendees]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return attendees.filter((a) => {
      if (filter === "checked-in" && !a.checkedIn) return false;
      if (filter === "pending" && a.checkedIn) return false;
      if (!s) return true;
      return (
        a.name.toLowerCase().includes(s) ||
        a.email.toLowerCase().includes(s) ||
        a.seatNumber.toLowerCase().includes(s) ||
        a.id.toLowerCase().includes(s)
      );
    });
  }, [attendees, search, filter]);

  function exportCsv() {
    const csv = toCsv(filtered);
    // UTF-8 BOM so Arabic text opens correctly in Excel.
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `theater_attendees-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function toggleCheckIn(a: Attendee) {
    setBusyId(a.id);
    try {
      await updateDoc(doc(db, THEATER_ATTENDEES_COLLECTION, a.id), {
        checkedIn: !a.checkedIn,
        checkedInAt: !a.checkedIn ? serverTimestamp() : null,
      });
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function removeAttendee(a: Attendee) {
    if (!confirm(`Delete registration for ${a.name} (${a.email})? This cannot be undone.`)) return;
    setBusyId(a.id);
    try {
      await deleteDoc(doc(db, THEATER_ATTENDEES_COLLECTION, a.id));
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AdminGate
      code={dashboardCode()}
      storageKey="event-dashboard-auth"
      title="Dashboard access"
      description="Enter the manager passcode to view attendance data. Scanner staff cannot open this page."
      unlockLabel="Unlock dashboard"
    >
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Attendance dashboard</h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
              <span className="relative flex h-2 w-2">
                <span className="absolute h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Live from Firestore
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/admin/scan"
              className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
            >
              <ScanLine className="h-4 w-4" /> Open scanner
            </Link>
            <button
              onClick={exportCsv}
              disabled={filtered.length === 0}
              className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50"
            >
              <Download className="h-4 w-4" /> CSV ({filtered.length})
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-slate-400">
              <Users className="h-3.5 w-3.5" /> Registered
            </p>
            <p className="mt-1 text-3xl font-bold">{loading ? "—" : stats.total}</p>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-card">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" /> Checked in
            </p>
            <p className="mt-1 text-3xl font-bold text-emerald-900">
              {loading ? "—" : stats.checkedIn}
            </p>
            {!loading && stats.total > 0 && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-emerald-200">
                <div
                  className="h-full rounded-full bg-emerald-600 transition-all"
                  style={{ width: `${(stats.checkedIn / stats.total) * 100}%` }}
                />
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-card">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-amber-600">
              <Clock className="h-3.5 w-3.5" /> Remaining
            </p>
            <p className="mt-1 text-3xl font-bold text-amber-900">
              {loading ? "—" : stats.remaining}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="mt-6 flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, seat, or ID…"
              className="w-full rounded-xl border border-slate-300 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
            />
          </div>
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-sm">
            {(["all", "checked-in", "pending"] as StatusFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-lg px-3 py-1.5 font-medium capitalize",
                  filter === f ? "bg-white shadow" : "text-slate-500 hover:text-slate-900"
                )}
              >
                {f === "all" ? "All" : f === "checked-in" ? "Checked in" : "Pending"}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading attendees…
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 p-6 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <Users className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-2 font-medium">No attendees found</p>
              <p className="mt-1 text-sm text-slate-500">
                {attendees.length === 0
                  ? "Nobody has registered yet. Share the registration link."
                  : "Try a different search or filter."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3 font-semibold">Attendee</th>
                    <th className="px-4 py-3 font-semibold">Contact</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Checked in at</th>
                    <th className="px-4 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-semibold">{a.name}</p>
                        <p className="text-xs text-slate-500">{a.seatNumber}</p>
                        <p className="font-mono text-[11px] text-slate-400">{a.id}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="break-all">{a.email || "—"}</p>
                        <p className="text-xs text-slate-500">{a.phone}</p>
                      </td>
                      <td className="px-4 py-3">
                        {a.checkedIn ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                            <CheckCircle2 className="h-3 w-3" /> Checked in
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                            <Clock className="h-3 w-3" /> Pending
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {a.checkedIn ? formatTimestamp(a.checkedInAt) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <button
                          onClick={() => toggleCheckIn(a)}
                          disabled={busyId === a.id}
                          title={a.checkedIn ? "Undo check-in" : "Check in manually"}
                          className={cn(
                            "mr-1 inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold",
                            a.checkedIn
                              ? "bg-amber-100 text-amber-800 hover:bg-amber-200"
                              : "bg-emerald-600 text-white hover:bg-emerald-500"
                          )}
                        >
                          {busyId === a.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3 w-3" />
                          )}
                          {a.checkedIn ? "Undo" : "Check in"}
                        </button>
                        <button
                          onClick={() => removeAttendee(a)}
                          disabled={busyId === a.id}
                          title="Delete registration"
                          className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && !error && filtered.length > 0 && (
            <p className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500">
              Showing {filtered.length} of {attendees.length} attendees
            </p>
          )}
        </div>
      </div>
    </AdminGate>
  );
}
