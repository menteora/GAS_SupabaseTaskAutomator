-- Migration: create_triggers
-- Crea la tabella triggers per il registro centralizzato dei trigger GAS.
-- Permette di rilevare trigger "silenziosi" confrontando:
--   last_run_at + (interval_value * interval_unit) < now()

CREATE TABLE IF NOT EXISTS public.triggers (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identità del trigger
  trigger_name   TEXT        NOT NULL,            -- nome funzione handler (es. 'runReminders')
  project_name   TEXT        NOT NULL,            -- nome progetto GAS (es. 'SUP_Reminder')

  -- Piattaforma e tipo
  platform       TEXT        NOT NULL DEFAULT 'google_apps_script'
                 CHECK (platform IN ('google_apps_script')),
                 -- Estendere il CHECK quando si aggiungono nuovi runtime

  trigger_type   TEXT        NOT NULL
                 CHECK (trigger_type IN (
                   'time_based',
                   'on_edit',
                   'on_form_submit',
                   'on_open',
                   'on_change'
                 )),

  -- Frequenza (solo per trigger time_based)
  -- Esempio: interval_value=1, interval_unit='hours'  → ogni ora
  --          interval_value=15, interval_unit='minutes' → ogni 15 min
  --          interval_value=1, interval_unit='weeks'  → ogni settimana
  interval_value INTEGER     CHECK (interval_value > 0),
  interval_unit  TEXT        CHECK (interval_unit IN ('minutes', 'hours', 'days', 'weeks')),

  -- Esecuzione
  last_run_at    TIMESTAMPTZ,                     -- aggiornato ad ogni fire del trigger

  -- Riferimento al progetto
  project_url    TEXT,                            -- es. https://script.google.com/d/<id>/edit

  -- Audit
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Unicità: un trigger_name per progetto
  CONSTRAINT uq_triggers_name_project UNIQUE (trigger_name, project_name)
);

-- Aggiorna updated_at automaticamente ad ogni modifica
CREATE OR REPLACE FUNCTION public.trg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_updated_at_triggers
  BEFORE UPDATE ON public.triggers
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_updated_at();

-- Indici
CREATE INDEX IF NOT EXISTS idx_triggers_project
  ON public.triggers (project_name);

CREATE INDEX IF NOT EXISTS idx_triggers_last_run
  ON public.triggers (last_run_at DESC NULLS LAST);

-- RLS (abilita ma lascia accesso al service_role)
ALTER TABLE public.triggers ENABLE ROW LEVEL SECURITY;
