
-- Atomic upsert for UTMify event deduplication lock
-- Returns the row if lock was acquired, empty if someone else holds it
CREATE OR REPLACE FUNCTION public.acquire_utmify_lock(
  p_event_id TEXT,
  p_event_type TEXT,
  p_order_id TEXT DEFAULT NULL,
  p_lock_ttl_seconds INT DEFAULT 30
)
RETURNS TABLE (
  event_id TEXT,
  status TEXT,
  attempt_count INT,
  lock_acquired BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result RECORD;
BEGIN
  -- Atomic upsert: insert if new, or update if failed/lock expired
  INSERT INTO utmify_event_log (event_id, event_type, order_id, status, locked_at, attempt_count)
  VALUES (p_event_id, p_event_type, p_order_id, 'pending', now(), 1)
  ON CONFLICT (event_id) DO UPDATE
  SET locked_at = now(),
      attempt_count = utmify_event_log.attempt_count + 1
  WHERE utmify_event_log.status = 'failed'
     OR utmify_event_log.status = 'pending' AND (
       utmify_event_log.locked_at IS NULL 
       OR utmify_event_log.locked_at < now() - (p_lock_ttl_seconds || ' seconds')::interval
     )
  RETURNING utmify_event_log.event_id, utmify_event_log.status, utmify_event_log.attempt_count
  INTO v_result;

  IF v_result IS NOT NULL THEN
    RETURN QUERY SELECT v_result.event_id, v_result.status, v_result.attempt_count, TRUE;
  ELSE
    -- Row exists but lock not acquired (already sent or locked by another process)
    RETURN QUERY 
      SELECT el.event_id, el.status, el.attempt_count, FALSE
      FROM utmify_event_log el
      WHERE el.event_id = p_event_id;
  END IF;
END;
$$;
