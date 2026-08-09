UPDATE public.meetgeek_guest_invite_jobs
SET status = 'pending', error_code = NULL, error_message = NULL
WHERE status = 'processing' AND error_code = 'no_email_sender';