CREATE OR REPLACE FUNCTION public.acquire_utmify_lock(p_event_id text, p_event_type text, p_order_id text DEFAULT NULL::text, p_lock_ttl_seconds integer DEFAULT 30)
 RETURNS TABLE(event_id text, status text, attempt_count integer, lock_acquired boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event_id text;
  v_status text;
  v_attempt_count integer;
BEGIN
  -- Atomic upsert: insert if new, or update if failed/lock expired
  INSERT INTO utmify_event_log (event_id, event_type, order_id, status, locked_at, attempt_count)
  VALUES (p_event_id, p_event_type, p_order_id, 'pending', now(), 1)
  ON CONFLICT (event_id) DO UPDATE
  SET locked_at = now(),
      attempt_count = utmify_event_log.attempt_count + 1
  WHERE utmify_event_log.status = 'failed'
     OR (utmify_event_log.status = 'pending' AND (
       utmify_event_log.locked_at IS NULL 
       OR utmify_event_log.locked_at < now() - (p_lock_ttl_seconds || ' seconds')::interval
     ))
  RETURNING utmify_event_log.event_id, utmify_event_log.status, utmify_event_log.attempt_count
  INTO v_event_id, v_status, v_attempt_count;

  IF v_event_id IS NOT NULL THEN
    RETURN QUERY SELECT v_event_id, v_status, v_attempt_count, TRUE;
  ELSE
    -- Row exists but lock not acquired (already sent or locked by another process)
    RETURN QUERY 
      SELECT el.event_id, el.status, el.attempt_count, FALSE
      FROM utmify_event_log el
      WHERE el.event_id = p_event_id;
  END IF;
END;
$function$;