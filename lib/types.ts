import type { Timestamp } from "firebase/firestore";

export interface Attendee {
  id: string;
  name: string;
  email: string;
  phone: string;
  seat: string;
  checkedIn: boolean;
  checkedInAt: Timestamp | null;
  createdAt: Timestamp | null;
}

/** Firestore collection for theater seat bookings (renamed from `attendees`). */
export const THEATER_ATTENDEES_COLLECTION = "theater_attendees";
