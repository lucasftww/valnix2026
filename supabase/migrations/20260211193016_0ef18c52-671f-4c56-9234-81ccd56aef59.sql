CREATE INDEX IF NOT EXISTS idx_utmify_log_created_status 
ON utmify_event_log (created_at, status);