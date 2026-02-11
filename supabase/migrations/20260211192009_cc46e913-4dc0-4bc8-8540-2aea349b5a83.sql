DROP FUNCTION IF EXISTS public.acquire_utmify_lock(text, text, text, integer);

CREATE FUNCTION public.acquire_utmify_lock(p_event_id text, p_event_type text, p_order_id text DEFAULT NULL::text, p_lock_ttl_seconds integer DEFAULT 30)
 RETURNS TABLE(out_event_id text, out_status text, out_attempt_count integer, out_lock_acquired boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_eid text;
  v_st text;
  v_ac integer;
BEGIN
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
  INTO v_eid, v_st, v_ac;

  IF v_eid IS NOT NULL THEN
    out_event_id := v_eid;
    out_status := v_st;
    out_attempt_count := v_ac;
    out_lock_acquired := TRUE;
    RETURN NEXT;
  ELSE
    FOR out_event_id, out_status, out_attempt_count IN
      SELECT el.event_id, el.status, el.attempt_count
      FROM utmify_event_log el
      WHERE el.event_id = p_event_id
    LOOP
      out_lock_acquired := FALSE;
      RETURN NEXT;
    END LOOP;
  END IF;
END;
$function$;