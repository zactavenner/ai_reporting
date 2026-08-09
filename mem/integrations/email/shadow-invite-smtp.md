---
name: Shadow-invite SMTP sender
description: Gmail SMTP config for MeetGeek shadow invites — port 465 implicit TLS, port 25 blocked on edge runtime
type: feature
---
Shadow-invite emails to theainotetaker@gmail.com send via Gmail SMTP with an app password.

- Sender chain: Resend (if RESEND_API_KEY + SHADOW_INVITE_FROM) → plain SMTP → Gmail OAuth (non-production, 7-day token expiry).
- Working config: SMTP_HOST=smtp.gmail.com, port **465 (implicit TLS)** via `SMTP_PORT_OVERRIDE` (existing secrets are immutable, so the override wins over SMTP_PORT), SMTP_USER/SHADOW_INVITE_FROM=theainotetaker@gmail.com.
- Verified from the edge runtime: 465 and 587 egress work; **port 25 is blocked** (connect timeout).
- `_shared/shadowInviteSender.ts` uses a custom SMTP client with a *persistent buffered reader*. Never read a fresh buffer per line — multiline EHLO/AUTH replies arrive in one chunk and dropping the leftover stalls the handshake.
- Pending jobs with error_code `no_meeting_link` are appointments with no meeting URL — expected, not a sender failure.
