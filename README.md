# Event Registration & QR Check-in

Public registration → instant QR ticket → webcam scanner check-in → live dashboard.
Stack: **Next.js 14 (App Router) + Tailwind + Firebase Firestore**. Free-tier deployable on Vercel + Firebase.

## Pages

| Route | Purpose |
|---|---|
| `/` | Public registration form (Arabic-name + Egyptian-phone validation, seat dropdown hiding booked seats, duplicate-phone guard → `/ticket/[id]`) |
| `/ticket/[id]` | QR ticket (QR = raw `attendeeId`), QR PNG / full-ticket PNG / print |
| `/admin/scan` | Live webcam scanner (`html5-qrcode`) + manual search fallback |
| `/admin/dashboard` | Real-time counts, attendee table, CSV export, undo/delete |
| `/admin` | Index linking scanner + dashboard |

## Quick start

1. **Firebase setup**
   - Console → Create project (no billing needed) → Build → Firestore Database → Create database (production mode, any region).
   - Project Settings → General → Your apps → Web `</>` → Register app → copy the config values.
   - Firestore → Rules tab → paste `firestore.rules` → Publish.

2. **Local run**
   ```bash
   cd event-registration
   cp .env.local.example .env.local
   # fill in NEXT_PUBLIC_FIREBASE_* in .env.local
   npm install
   npm run dev
   # open http://localhost:3000
   ```
   Camera scanning needs `https://` or `localhost` — `npm run dev` on localhost is fine.

3. **Deploy to Vercel (free)**
   - Push this folder to GitHub, import in Vercel, set the same `NEXT_PUBLIC_*` env vars in Project Settings → Environment Variables.
   - `vercel --prod` or merge to main. No server config needed (all Firestore access is client-side).

## Firestore schema

Collection `theater_attendees`, document ID = `attendeeId`:

```json
{
  "id": "attendeeId",
  "name": "بولا صلاح فتحي",
  "email": "",
  "phone": "010xxxxxxxx",
  "seat": "A1",
  "checkedIn": false,
  "checkedInAt": null,
  "createdAt": "Timestamp"
}
```

> `email` is kept as `""` for backward compatibility with older records.
> `phone` is stored normalized (digits only, `01xxxxxxxxx`) and is unique.
> `seat` is the booked theater seat (e.g. `"A1"`). Booked seats are hidden from
> the registration dropdown once they exist in this collection.

## Event info

- Event: مسرحية "عملت ايه فينا السنين؟"
- Date: الخميس 19 نوفمبر 2026
- Time: 6:00 مساءً
- Venue: مسرح سان جورج للأقباط الكاثوليك - مصر الجديدة | St. Georges Coptic Catholic Theater - Heliopolis

## Optional: admin passcodes (separate roles)

- `NEXT_PUBLIC_SCANNER_CODE` — give to the door team; unlocks `/scan` and `/admin/scan` only.
- `NEXT_PUBLIC_DASHBOARD_CODE` — managers only; unlocks `/admin/dashboard`. Scanner staff are blocked even via direct URL.
- Legacy `NEXT_PUBLIC_ADMIN_CODE` still works as a fallback for both if set.
- Leave all empty to disable the gates. For hard security, add Firebase Auth and tighten `firestore.rules`.

## Edge cases handled

- Duplicate phone → error card with link to existing ticket.
- Invalid / already-checked-in / not-found scan states with distinct colors + chime + vibration.
- Camera denied / no camera / HTTPS-required / in-use errors with actionable messages + manual search fallback.
- Offline registration/scan shows an explicit message.
- Dashboard live `onSnapshot` with unordered fallback if `orderBy` fails; CSV export of the filtered view.
