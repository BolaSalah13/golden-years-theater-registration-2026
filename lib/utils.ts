import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTimestamp(ts: unknown): string {
  try {
    // Firestore Timestamp has toDate(); plain Date / ISO string also handled.
    if (ts && typeof (ts as { toDate?: unknown }).toDate === "function") {
      return (ts as { toDate: () => Date }).toDate().toLocaleString();
    }
    if (ts instanceof Date) return ts.toLocaleString();
    if (typeof ts === "string" && ts) return new Date(ts).toLocaleString();
    return "—";
  } catch {
    return "—";
  }
}

/** Extract a bare attendeeId from raw QR text (handles plain IDs and /ticket/<id> URLs). */
export function extractAttendeeId(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  // If QR contains a URL like https://site.com/ticket/abc123, take the last segment.
  const ticketMatch = text.match(/\/ticket\/([A-Za-z0-9_-]+)/);
  if (ticketMatch) return ticketMatch[1];
  // Generic URL: last non-empty path segment.
  if (/^https?:\/\//i.test(text)) {
    try {
      const u = new URL(text);
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length > 0) return parts[parts.length - 1];
    } catch {
      // fall through
    }
  }
  return text;
}

export function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * All bookable seat labels for the theater.
 * Rows A–L hold seats 1–14 each, rows M–R hold seats 1–5 each.
 * Example labels: A1 … A14, B1 … B14, … L1 … L14, M1 … M5, … R1 … R5.
 */
export function getAllSeats(): string[] {
  const seats: string[] = [];
  // Rows A -> L (12 rows) with 14 seats per row.
  for (let i = 0; i < 12; i++) {
    const row = String.fromCharCode(65 + i);
    for (let n = 1; n <= 14; n++) seats.push(`${row}${n}`);
  }
  // Rows M -> R (6 rows) with 5 seats per row.
  for (let i = 0; i < 6; i++) {
    const row = String.fromCharCode(77 + i);
    for (let n = 1; n <= 5; n++) seats.push(`${row}${n}`);
  }
  return seats;
}
