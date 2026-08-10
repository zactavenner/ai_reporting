---
name: AI Meetings attendance + date filter
description: Show/no-show attendance for booked appointments comes from GHL appointmentStatus, stored on invite jobs; AI Meetings tab has a client + date-range filter.
type: feature
---
- The CRM (GHL) owns meeting attendance. `appointmentStatus` is normalized to `showed | noshow | cancelled | confirmed | booked | unknown` and stored on `meetgeek_guest_invite_jobs.attendance_status` (raw kept in `ghl_appointment_status`, timestamp in `attendance_checked_at`).
- Written on every poll (`_shared/guestPoller.ts`) and on demand via `meetgeek-guest-admin` action `ai_meetings_attendance_sync` (helper: `_shared/ghlAttendance.ts`).
- `ai_meetings_overview` accepts `start_date` / `end_date` (YYYY-MM-DD inclusive) and returns an `attendance` rollup with `show_rate` overall and per client.
- Show rate = showed / (showed + noshow); cancelled and pending outcomes are excluded from the rate.
