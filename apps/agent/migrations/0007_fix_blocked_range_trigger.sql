-- Fix compute_blocked_range trigger: the previous version referenced
-- buffer_before_minutes / buffer_after_minutes columns that do not exist on
-- the bookings table, causing every insert/update to fail.
-- Use zero buffer for now; reintroduce per-booking buffers if/when those
-- columns are added to the schema.

CREATE OR REPLACE FUNCTION public.compute_blocked_range()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.scheduled_at IS NOT NULL AND NEW.duration_minutes IS NOT NULL THEN
    NEW.appointment_end := NEW.scheduled_at + make_interval(mins => NEW.duration_minutes);
    NEW.blocked_range := tstzrange(NEW.scheduled_at, NEW.appointment_end, '[)');
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;
