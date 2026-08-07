UPDATE public.data_discrepancies
SET status = 'resolved',
    resolved_at = now(),
    resolution_notes = 'Resolved: client migrated to new Meta ad account act_594910293557670. Aug 1-6 spend backfilled from the new account.'
WHERE client_id = '53bce87a-ad8c-4bf7-bc4f-4b3a91c4c2f5'
  AND discrepancy_type = 'ad_spend_missing'
  AND status = 'open';