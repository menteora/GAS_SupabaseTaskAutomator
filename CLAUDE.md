# GAS_SupabaseTaskAutomator — CLAUDE.md

## Scopo

Libreria condivisa Google Apps Script per l'interfacciamento con Supabase.
Centralizza connessione, reminder, log e registro trigger.
Va aggiunta come **Library** GAS ai progetti che la usano (tramite script ID).

---

## Struttura file

| File | Responsabilità |
|---|---|
| `Supabase.js` | Tutte le funzioni pubbliche: config, reminder, log, trigger registry |
| `ddl_reminders.sql` | Schema attuale completo della tabella `reminders` |
| `ddl_logs.sql` | Schema attuale completo della tabella `logs` |
| `ddl_triggers.sql` | Schema attuale completo della tabella `triggers` |
| `migrations/` | Storico delle modifiche DB in ordine cronologico (formato Supabase CLI) |
| `appsscript.json` | Manifest GAS |

---

## Funzioni esposte

### Connessione
| Funzione | Descrizione |
|---|---|
| `supGetConfig()` | Legge SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY dalle Script Properties |
| `supHeaders(cfg, minimal?)` | Genera gli header HTTP per PostgREST |
| `supAssertOk(res, context)` | Lancia errore se la risposta HTTP non è 2xx |
| `supSetupVerify()` | Verifica connettività e tabelle (eseguire manualmente) |

### Reminder (tabella `reminders`)
| Funzione | Descrizione |
|---|---|
| `supInsertReminder(cfg, htmlBody, recipient, subject, notes?, scheduledAt?, cc?, bcc?)` | Insert reminder (cc e bcc opzionali) |
| `supFetchPendingReminders(cfg)` | Legge reminder pending con scheduled_at <= now() |
| `supMarkReminderSent(cfg, id)` | Imposta status='sent' |
| `supMarkReminderError(cfg, id, errMsg)` | Imposta status='error' |

### Log (tabella `logs`)
| Funzione | Descrizione |
|---|---|
| `supGenerateUUID()` | UUID v4 pseudo-casuale |
| `supGetLogLevel()` | Legge LOG_LEVEL dalle Script Properties (default 'info') |
| `supGetRunner()` | Metadati del runner corrente (script_id, user, project_name, …) |
| `supBufferLog(buffer, runId, configuredLevel, level, message, context)` | Aggiunge al buffer in-memory |
| `supFlushLogs(cfg, rows, runner)` | Batch insert su `logs`; non lancia mai eccezioni |

### Trigger Registry (tabella `triggers`)
| Funzione | Descrizione |
|---|---|
| `supRegisterTrigger(cfg, opts)` | UPSERT trigger nel registro |
| `supUpdateTriggerLastRun(cfg, triggerName, projectName)` | Aggiorna last_run_at a now() |
| `supUnregisterTrigger(cfg, triggerName, projectName)` | Rimuove trigger dal registro |
| `supGetRegisteredTriggers(cfg, projectName?)` | Legge il registro (opz. filtro per progetto) |

### Costanti
| Costante | Valori |
|---|---|
| `SUP_TRIGGER_PLATFORM` | `GOOGLE_APPS_SCRIPT = 'google_apps_script'` |
| `SUP_TRIGGER_TYPE` | `TIME_BASED`, `ON_EDIT`, `ON_FORM_SUBMIT`, `ON_OPEN`, `ON_CHANGE` |
| `SUP_TRIGGER_INTERVAL_UNIT` | `MINUTES`, `HOURS`, `DAYS`, `WEEKS` |

---

## Requisito obbligatorio per ogni progetto che usa la libreria: Trigger Registry

Ogni progetto GAS che installa un trigger time-based **deve** integrare il Trigger Registry.
Questo permette di monitorare centralmente tutti i trigger attivi e rilevare trigger "silenziosi"
(che hanno smesso di girare) tramite la query su `last_run_at`.

### 1. Eseguire il DDL (una volta sola)

Prima del primo deploy, eseguire `ddl_triggers.sql` nel SQL Editor di Supabase.

### 2. All'installazione del trigger

Dopo `ScriptApp.newTrigger(...).create()`, chiamare `supRegisterTrigger()`:

```javascript
var cfg = supGetConfig(); // o getSupabaseConfig_() se si usa Supabase.js locale
supRegisterTrigger(cfg, {
  triggerName:   'nomeHandlerFunction',   // es. 'runReminders'
  projectName:   'NOME_PROGETTO_GAS',     // es. 'SUP_Reminder'
  triggerType:   'time_based',
  intervalValue: 15,                      // valore numerico: 1, 5, 10, 15, 30, 60, ...
  intervalUnit:  'minutes',               // 'minutes' | 'hours' | 'days' | 'weeks'
});
```

L'operazione è un UPSERT: rieseguire `installCronTrigger()` non crea duplicati.

### 3. Ad ogni esecuzione del trigger

**Prima riga** del blocco `try` nella funzione handler, chiamare `supUpdateTriggerLastRun()`:

```javascript
function nomeHandlerFunction() {
  var cfg = supGetConfig();
  // ...
  try {
    supUpdateTriggerLastRun(cfg, 'nomeHandlerFunction', 'NOME_PROGETTO_GAS');
    // ... resto della logica
  } finally {
    // flush logs, ecc.
  }
}
```

Questo aggiorna `last_run_at` ad ogni fire, anche quando non c'è nulla da elaborare,
consentendo il monitoraggio dei trigger "silenziosi".

### 4. Alla rimozione del trigger

Dopo `ScriptApp.deleteTrigger(...)`, chiamare `supUnregisterTrigger()`:

```javascript
supUnregisterTrigger(cfg, 'nomeHandlerFunction', 'NOME_PROGETTO_GAS');
```

### Riferimento: progetto SUP_Reminder

`SUP_Reminder` è l'implementazione di riferimento. Vedere:
- `Triggers.js` → `installCronTrigger()`, `installCronTriggerMinutes()`, `removeCronTrigger()`
- `Codice.js` → `runReminders()` (prima riga del `try`)

---

## Gestione delle modifiche al database

### Regola fondamentale

**Ogni modifica allo schema DB richiede due aggiornamenti contestuali:**

1. **Nuova migration** in `migrations/` con nome `YYYYMMDDHHMMSS_descrizione.sql`
2. **Aggiornamento** del file `ddl_*.sql` corrispondente nella root per riflettere lo stato attuale

### Formato migration (compatibile con Supabase CLI + GitHub integration)

```
migrations/
  20240101000000_create_logs.sql
  20240101000001_create_reminders.sql
  20240101000002_create_triggers.sql
  YYYYMMDDHHMMSS_<cosa_fa>.sql   ← nuova migration
```

Il timestamp è `YYYYMMDDHHMMSS` (14 cifre, UTC). La descrizione usa `_` come separatore, in minuscolo.

### Contenuto di una migration

```sql
-- Migration: <descrizione>
-- Breve spiegazione della modifica e del perché.

-- Solo le istruzioni ALTER/CREATE/DROP incrementali
-- (non l'intero DDL della tabella)

ALTER TABLE public.<tabella> ADD COLUMN ...;
CREATE INDEX IF NOT EXISTS ...;
```

### Aggiornamento del DDL nella root

Dopo aver creato la migration, aggiornare il file `ddl_<tabella>.sql` nella root
in modo che rispecchi lo schema completo e attuale (come se si ricreasse da zero).
I file DDL nella root sono la "verità corrente" — le migration sono lo storico.

### Esempi di descrizioni

| Modifica | Nome migration |
|---|---|
| Aggiunta colonna `retry_count` a `reminders` | `20260416120000_reminders_add_retry_count.sql` |
| Nuovo indice su `logs.executor_name` | `20260416130000_logs_add_index_executor.sql` |
| Nuova tabella `schedules` | `20260416140000_create_schedules.sql` |
| Rinomina colonna `notes` → `description` | `20260416150000_reminders_rename_notes_to_description.sql` |

---

## Tabelle Supabase gestite

### `reminders` — schema attuale: `ddl_reminders.sql` — storia: `migrations/`
### `logs` — schema attuale: `ddl_logs.sql` — storia: `migrations/`

### `triggers` — schema attuale: `ddl_triggers.sql` — storia: `migrations/`

```
id             UUID PRIMARY KEY DEFAULT gen_random_uuid()
trigger_name   TEXT NOT NULL              -- nome funzione handler
project_name   TEXT NOT NULL              -- nome progetto GAS
platform       TEXT NOT NULL DEFAULT 'google_apps_script'
trigger_type   TEXT NOT NULL              -- time_based | on_edit | on_form_submit | on_open | on_change
interval_value INTEGER                    -- es. 1, 15, 60
interval_unit  TEXT                       -- minutes | hours | days | weeks
last_run_at    TIMESTAMPTZ                -- aggiornato ad ogni fire
project_url    TEXT                       -- link al progetto GAS
created_at     TIMESTAMPTZ DEFAULT now()
updated_at     TIMESTAMPTZ DEFAULT now()  -- aggiornato da trigger DB

UNIQUE (trigger_name, project_name)
```

### Logica di monitoraggio trigger "silenziosi"

```
stato = 'SILENZIOSO'  se:  last_run_at + (interval_value || ' ' || interval_unit)::INTERVAL < now()
```

Query di esempio inclusa (commentata) nel file `ddl_triggers.sql`.

---

## Come aggiungere la libreria a un progetto GAS

1. Aprire l'editor Apps Script del progetto target
2. **Librerie** (icona a sinistra) → `+` → incolla lo script ID di GAS_SupabaseTaskAutomator
3. Scegli la versione e un identificatore (es. `SupLib`)
4. Nelle funzioni del progetto usa: `SupLib.supGetConfig()`, `SupLib.supInsertReminder(...)`, ecc.

In alternativa, se i file sono copiati direttamente nel progetto (no library),
le funzioni sono disponibili direttamente nel namespace globale.

---

## Script Properties richieste nel progetto che usa la libreria

| Property | Obbligatoria | Descrizione |
|---|---|---|
| `SUPABASE_URL` | Sì | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Sì | Service role key |
| `LOG_LEVEL` | Auto-creata | `debug`\|`info`\|`warn`\|`error` |
