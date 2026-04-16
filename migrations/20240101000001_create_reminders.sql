-- Migration: create_reminders
-- Crea la tabella reminders per archiviare i reminder in attesa di invio.
-- Flusso: INSERT (status='pending') → GAS legge pending con scheduled_at <= now()
--         → GAS invia e fa PATCH status='sent' | 'error'

CREATE TABLE IF NOT EXISTS public.reminders (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scheduling
  scheduled_at   TIMESTAMPTZ NOT NULL DEFAULT now(),  -- quando inviare
  status         TEXT        NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'sent', 'error')),

  -- Canale di invio
  -- Attualmente solo 'gmail'; estendere il CHECK per nuovi canali
  channel        TEXT        NOT NULL DEFAULT 'gmail'
                 CHECK (channel IN ('gmail')),

  -- Configurazione specifica del canale (JSONB flessibile)
  -- Per channel='gmail':
  --   { "to": "...", "subject": "...", "body": "...", "is_html": true }
  channel_config JSONB       NOT NULL DEFAULT '{}',

  -- Metadati opzionali
  notes          TEXT,                                -- note libere

  -- Audit
  sent_at        TIMESTAMPTZ,                         -- valorizzato da supMarkReminderSent()
  error_log      TEXT,                                -- valorizzato da supMarkReminderError() (max 1000 car.)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indice principale per la query dei pending
-- supFetchPendingReminders() filtra: status='pending' AND scheduled_at <= now()
CREATE INDEX IF NOT EXISTS idx_reminders_pending
  ON public.reminders (scheduled_at ASC)
  WHERE status = 'pending';

-- Indice per ispezionare lo storico per status
CREATE INDEX IF NOT EXISTS idx_reminders_status
  ON public.reminders (status, created_at DESC);

-- RLS (abilita ma lascia accesso al service_role)
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
