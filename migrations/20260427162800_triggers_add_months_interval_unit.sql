-- Migration: aggiunge 'months' ai valori ammessi per interval_unit
-- Necessario per supportare il trigger semestrale (staInstallSemestralTrigger).

ALTER TABLE public.triggers
  DROP CONSTRAINT IF EXISTS triggers_interval_unit_check;

ALTER TABLE public.triggers
  ADD CONSTRAINT triggers_interval_unit_check
  CHECK (interval_unit IN ('minutes', 'hours', 'days', 'weeks', 'months'));
