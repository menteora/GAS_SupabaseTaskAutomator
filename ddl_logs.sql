-- ============================================================
--  DDL — tabella logs
--
--  Eseguire UNA SOLA VOLTA nel SQL Editor di Supabase.
--  Raccoglie i log di esecuzione prodotti da supFlushLogs().
--  I log vengono scritti in batch al termine di ogni run GAS.
--
--  Pattern di utilizzo:
--    supBufferLog(buffer, runId, configuredLevel, level, msg, ctx)
--    → accumula in memoria
--    supFlushLogs(cfg, buffer, runner)
--    → batch INSERT alla fine del run (nel blocco finally)
-- ============================================================

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

-- ============================================================
--  PULIZIA (opzionale — eseguire periodicamente)
-- ============================================================

-- Elimina log più vecchi di 90 giorni:
/*
DELETE FROM public.logs
WHERE logged_at < now() - INTERVAL '90 days';
*/

-- ============================================================
--  QUERY DI UTILITÀ
-- ============================================================

-- Log di un run specifico:
/*
SELECT logged_at, level, message, context
FROM public.logs
WHERE run_id = '<uuid>'
ORDER BY logged_at ASC;
*/

-- Ultimi errori per progetto:
/*
SELECT executor_name, run_id, logged_at, message, context
FROM public.logs
WHERE level = 'error'
ORDER BY logged_at DESC
LIMIT 50;
*/

-- Riepilogo run per progetto (quanti log per run):
/*
SELECT executor_name, run_id, min(logged_at) AS started_at, count(*) AS n_entries,
       max(CASE WHEN level = 'error' THEN 1 ELSE 0 END) AS had_errors
FROM public.logs
GROUP BY executor_name, run_id
ORDER BY started_at DESC
LIMIT 20;
*/
