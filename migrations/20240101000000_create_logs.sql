-- Migration: create_logs
-- Crea la tabella logs per raccogliere i log di esecuzione
-- prodotti da supFlushLogs() in batch al termine di ogni run GAS.

CREATE TABLE IF NOT EXISTS public.logs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Correlazione: tutte le righe di uno stesso run condividono run_id
  run_id         UUID        NOT NULL,

  -- Timing
  logged_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Livello di log
  level          TEXT        NOT NULL
                 CHECK (level IN ('debug', 'info', 'warn', 'error')),

  -- Messaggio leggibile
  message        TEXT        NOT NULL,

  -- Contesto strutturato (dati aggiuntivi liberi, es. { reminder_id: '...' })
  context        JSONB       NOT NULL DEFAULT '{}',

  -- Metadati del runner (popolati da supGetRunner())
  -- Struttura: { script_id, project_url, user, project_name }
  runner         JSONB       NOT NULL DEFAULT '{}',

  -- Nome del progetto GAS (denormalizzato per query semplici senza JSONB)
  executor_name  TEXT                                -- = runner->>'project_name'
);

-- Indice principale: tutti i log di un run (JOIN/GROUP BY run_id)
CREATE INDEX IF NOT EXISTS idx_logs_run_id
  ON public.logs (run_id, logged_at ASC);

-- Indice per filtrare per progetto + livello + data
CREATE INDEX IF NOT EXISTS idx_logs_executor_level
  ON public.logs (executor_name, level, logged_at DESC);

-- Indice per ricerche per data (pulizia, audit, dashboard)
CREATE INDEX IF NOT EXISTS idx_logs_logged_at
  ON public.logs (logged_at DESC);

-- RLS (abilita ma lascia accesso al service_role)
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;
