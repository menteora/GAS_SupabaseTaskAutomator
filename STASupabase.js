// ============================================================
//  GAS_SupabaseTaskAutomator — STASupabase.js
//
//  Libreria condivisa per l'interfacciamento con Supabase.
//  Espone funzioni per: log, triggers.
//
//  Script Properties richieste (nel progetto che usa la lib):
//    SUPABASE_URL              → Project URL (es. https://xxxx.supabase.co)
//    SUPABASE_SERVICE_ROLE_KEY → service_role secret key
//
//  Tabelle Supabase gestite:
//    logs     → log di esecuzione (batch insert)
//    triggers → registro dei trigger GAS attivi
// ============================================================

var SUP_TABLE_LOGS     = 'logs';
var SUP_TABLE_TRIGGERS = 'triggers';

// ============================================================
//  CONNESSIONE
// ============================================================

/**
 * Legge le credenziali Supabase dalle Script Properties.
 * Lancia un errore descrittivo se mancano.
 *
 * @returns {{url: string, key: string}}
 */
function supGetConfig() {
  var props = PropertiesService.getScriptProperties();
  var url   = props.getProperty('SUPABASE_URL');
  var key   = props.getProperty('SUPABASE_SERVICE_ROLE_KEY');

  if (!url || !key) {
    throw new Error(
      'Script Properties mancanti: SUPABASE_URL e/o SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Vai su: Apps Script → Impostazioni progetto → Proprietà script.'
    );
  }

  return {
    url: url.replace(/\/$/, ''),
    key: key,
  };
}

/**
 * Header HTTP standard per le chiamate PostgREST.
 *
 * @param {{url: string, key: string}} cfg
 * @param {boolean} [minimal=false]  Se true usa Prefer: return=minimal
 * @returns {Object}
 */
function supHeaders(cfg, minimal) {
  return {
    'apikey':        cfg.key,
    'Authorization': 'Bearer ' + cfg.key,
    'Content-Type':  'application/json',
    'Prefer':        minimal ? 'return=minimal' : 'return=representation',
  };
}

/**
 * Verifica che la risposta HTTP sia 2xx.
 * Lancia un errore descrittivo in caso contrario.
 *
 * @param {HTTPResponse} res
 * @param {string}       context  Etichetta per il messaggio di errore
 */
function supAssertOk(res, context) {
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(
      '[' + context + '] Supabase HTTP ' + code + ': ' + res.getContentText()
    );
  }
}

// ============================================================
//  LOG
// ============================================================

/**
 * Genera un UUID v4 pseudo-casuale.
 * GAS V8 non espone crypto.randomUUID(); usa Math.random(),
 * sufficiente per correlation ID interni.
 *
 * @returns {string}
 */
function supGenerateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0;
    var v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Legge LOG_LEVEL dalle Script Properties.
 * Se assente o non valido, lo imposta automaticamente a 'info'.
 *
 * @returns {string}  'debug' | 'info' | 'warn' | 'error'
 */
function supGetLogLevel() {
  var props = PropertiesService.getScriptProperties();
  var level = props.getProperty('LOG_LEVEL');
  var valid = ['debug', 'info', 'warn', 'error'];
  if (!level || valid.indexOf(level.toLowerCase()) === -1) {
    props.setProperty('LOG_LEVEL', 'info');
    return 'info';
  }
  return level.toLowerCase();
}

/**
 * Raccoglie le informazioni sul runner corrente.
 * Popola la colonna `runner` di ogni riga di log.
 *
 * @returns {{script_id: string, project_url: string, user: string, project_name?: string}}
 */
function supGetRunner() {
  var scriptId = ScriptApp.getScriptId();
  var runner = {
    script_id:   scriptId,
    project_url: 'https://script.google.com/d/' + scriptId + '/edit',
    user:        Session.getEffectiveUser().getEmail(),
  };
  try {
    runner.project_name = DriveApp.getFileById(scriptId).getName();
  } catch (e) {
    // DriveApp non autorizzato o file non trovato: runner incompleto ma non bloccante
  }
  return runner;
}

/**
 * Aggiunge una riga al buffer di log in memoria (nessuna I/O).
 * La riga viene ignorata se il suo livello è inferiore a configuredLevel.
 *
 * Ordine priorità: debug(0) < info(1) < warn(2) < error(3)
 *
 * @param {Array}       buffer
 * @param {string}      runId
 * @param {string}      configuredLevel
 * @param {string}      level            'debug'|'info'|'warn'|'error'
 * @param {string}      message
 * @param {Object|null} context
 */
function supBufferLog(buffer, runId, configuredLevel, level, message, context) {
  var ORDER = { debug: 0, info: 1, warn: 2, error: 3 };
  if (ORDER[level] < ORDER[configuredLevel]) return;

  buffer.push({
    run_id:    runId,
    logged_at: new Date().toISOString(),
    level:     level,
    message:   message,
    context:   context || {},
  });

  Logger.log('[' + level.toUpperCase() + '] ' + message);
}

/**
 * Scrive in batch tutte le righe del buffer su Supabase (tabella logs).
 * Non lancia mai eccezioni: un errore di logging non deve bloccare il flusso principale.
 * In caso di fallimento Supabase invia un'email di fallback con i log e l'errore.
 *
 * @param {{url: string, key: string}} cfg
 * @param {Array<Object>}              rows    Array costruito da supBufferLog()
 * @param {Object}                     runner  Oggetto da supGetRunner()
 */
function supFlushLogs(cfg, rows, runner) {
  if (!rows || rows.length === 0) return;

  var supabaseError = null;

  try {
    var payload = rows.map(function(row) {
      return Object.assign({}, row, {
        runner:        runner || {},
        executor_name: (runner && runner.project_name) || null,
      });
    });

    var res = UrlFetchApp.fetch(cfg.url + '/rest/v1/' + SUP_TABLE_LOGS, {
      method:             'post',
      headers:            supHeaders(cfg, true),
      payload:            JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    var code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      supabaseError = 'HTTP ' + code + ': ' + res.getContentText();
    }
  } catch (e) {
    supabaseError = e.message || String(e);
  }

  if (supabaseError) {
    Logger.log('ATTENZIONE: supFlushLogs fallita — ' + supabaseError);
    supSendFallbackEmail_(rows, runner, supabaseError);
  }
}

/**
 * Invia un'email di fallback quando Supabase non è raggiungibile.
 * Indirizzo destinatario: utente corrente dello script (Session.getEffectiveUser()).
 * Non lancia mai eccezioni.
 *
 * @param {Array<Object>} rows          Buffer di log
 * @param {Object}        runner        Info runner
 * @param {string}        supabaseError Messaggio di errore Supabase
 */
function supSendFallbackEmail_(rows, runner, supabaseError) {
  try {
    var recipient = Session.getEffectiveUser().getEmail();
    if (!recipient) return;

    var project   = (runner && runner.project_name) || 'GAS Script';
    var subject   = '[' + project + '] Fallback log — Supabase non raggiungibile';

    var logLines = rows.map(function(r) {
      return '[' + r.level.toUpperCase() + '] ' + r.logged_at + ' — ' + r.message +
        (r.context && Object.keys(r.context).length ? ' ' + JSON.stringify(r.context) : '');
    }).join('\n');

    var body =
      'Supabase non ha accettato il log per il progetto "' + project + '".\n\n' +
      'Errore Supabase:\n' + supabaseError + '\n\n' +
      'Log dell\'esecuzione:\n' + logLines + '\n\n' +
      'Runner: ' + JSON.stringify(runner || {});

    GmailApp.sendEmail(recipient, subject, body);
  } catch (e) {
    Logger.log('ATTENZIONE: supSendFallbackEmail_ fallita — ' + (e.message || String(e)));
  }
}

// ============================================================
//  TRIGGER REGISTRY
// ============================================================

/**
 * Tipi di trigger supportati nella tabella triggers.
 * Estendibile in futuro con altri runtime (es. 'make', 'n8n', ...).
 */
var SUP_TRIGGER_PLATFORM = {
  GOOGLE_APPS_SCRIPT: 'google_apps_script',
};

/**
 * Tipologie di trigger GAS (event type).
 * Mappano i valori restituiti da trigger.getEventType().toString().
 */
var SUP_TRIGGER_TYPE = {
  TIME_BASED:      'time_based',
  ON_EDIT:         'on_edit',
  ON_FORM_SUBMIT:  'on_form_submit',
  ON_OPEN:         'on_open',
  ON_CHANGE:       'on_change',
};

/**
 * Unità di misura per l'intervallo temporale.
 * Usate nel campo interval_unit della tabella triggers.
 * Un'unica enum copre tutti i trigger temporali GAS.
 */
var SUP_TRIGGER_INTERVAL_UNIT = {
  MINUTES: 'minutes',
  HOURS:   'hours',
  DAYS:    'days',
  WEEKS:   'weeks',
};

/**
 * Registra (INSERT o UPSERT) un trigger nella tabella triggers.
 *
 * Se esiste già una riga con lo stesso trigger_name + project_name,
 * aggiorna i campi invece di inserire un duplicato (UPSERT via onConflict).
 *
 * @param {{url: string, key: string}} cfg
 * @param {Object} opts
 * @param {string}      opts.triggerName      Nome della funzione handler (es. 'runReminders')
 * @param {string}      opts.projectName      Nome del progetto GAS (es. 'SUP_Reminder')
 * @param {string}      opts.platform         Valore da SUP_TRIGGER_PLATFORM (default: 'google_apps_script')
 * @param {string}      opts.triggerType      Valore da SUP_TRIGGER_TYPE (es. 'time_based')
 * @param {number|null} [opts.intervalValue]  Valore numerico dell'intervallo (es. 1, 15, 60)
 * @param {string|null} [opts.intervalUnit]   Unità da SUP_TRIGGER_INTERVAL_UNIT (es. 'hours')
 * @param {string|null} [opts.projectUrl]     URL del progetto GAS su script.google.com
 * @returns {string|null}  UUID della riga inserita/aggiornata, o null se non disponibile
 * @throws {Error} se Supabase risponde con HTTP non-2xx
 */
function supRegisterTrigger(cfg, opts) {
  var runner    = supGetRunner();
  var scriptId  = ScriptApp.getScriptId();
  var projectUrl = opts.projectUrl ||
    ('https://script.google.com/d/' + scriptId + '/edit');

  var payload = {
    trigger_name:   opts.triggerName,
    project_name:   opts.projectName || (runner.project_name || null),
    platform:       opts.platform    || SUP_TRIGGER_PLATFORM.GOOGLE_APPS_SCRIPT,
    trigger_type:   opts.triggerType,
    interval_value: opts.intervalValue || null,
    interval_unit:  opts.intervalUnit  || null,
    project_url:    projectUrl,
    last_run_at:    null,
  };

  // UPSERT: se (trigger_name, project_name) già esiste, aggiorna tutto tranne last_run_at
  var headers = supHeaders(cfg);
  headers['Prefer'] = 'return=representation,resolution=merge-duplicates';

  var res = UrlFetchApp.fetch(
    cfg.url + '/rest/v1/' + SUP_TABLE_TRIGGERS,
    {
      method:             'post',
      headers:            headers,
      payload:            JSON.stringify(payload),
      muteHttpExceptions: true,
    }
  );

  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    Logger.log(
      'ATTENZIONE: supRegisterTrigger fallita — HTTP ' + code + ': ' + res.getContentText()
    );
    return null;
  }

  var inserted = JSON.parse(res.getContentText());
  return Array.isArray(inserted) && inserted[0] ? inserted[0].id : null;
}

/**
 * Aggiorna last_run_at del trigger a now().
 * Da chiamare all'inizio di ogni esecuzione del trigger.
 *
 * @param {{url: string, key: string}} cfg
 * @param {string} triggerName   Nome della funzione handler
 * @param {string} projectName   Nome del progetto GAS
 */
function supUpdateTriggerLastRun(cfg, triggerName, projectName) {
  try {
    var url = cfg.url + '/rest/v1/' + SUP_TABLE_TRIGGERS
      + '?trigger_name=eq.' + encodeURIComponent(triggerName)
      + '&project_name=eq.'  + encodeURIComponent(projectName);

    var res = UrlFetchApp.fetch(url, {
      method:             'patch',
      headers:            supHeaders(cfg, true),
      payload:            JSON.stringify({ last_run_at: new Date().toISOString() }),
      muteHttpExceptions: true,
    });

    var code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      Logger.log(
        'ATTENZIONE: supUpdateTriggerLastRun fallita per ' + triggerName +
        ' — HTTP ' + code + ': ' + res.getContentText()
      );
    }
  } catch (e) {
    Logger.log('ATTENZIONE: supUpdateTriggerLastRun eccezione — ' + (e.message || String(e)));
  }
}

/**
 * Rimuove un trigger dal registro.
 * Da chiamare quando il trigger viene disinstallato dal progetto.
 *
 * @param {{url: string, key: string}} cfg
 * @param {string} triggerName   Nome della funzione handler
 * @param {string} projectName   Nome del progetto GAS
 */
function supUnregisterTrigger(cfg, triggerName, projectName) {
  var url = cfg.url + '/rest/v1/' + SUP_TABLE_TRIGGERS
    + '?trigger_name=eq.' + encodeURIComponent(triggerName)
    + '&project_name=eq.'  + encodeURIComponent(projectName);

  var res = UrlFetchApp.fetch(url, {
    method:             'delete',
    headers:            supHeaders(cfg, true),
    muteHttpExceptions: true,
  });

  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    Logger.log(
      'ATTENZIONE: supUnregisterTrigger fallita per ' + triggerName +
      ' — HTTP ' + code + ': ' + res.getContentText()
    );
  }
}

/**
 * Recupera tutti i trigger registrati nel registry.
 * Utile per un pannello di controllo o per verificare trigger "mancanti".
 *
 * @param {{url: string, key: string}} cfg
 * @param {string} [projectName]  Se fornito, filtra per progetto
 * @returns {Array<Object>}
 */
function supGetRegisteredTriggers(cfg, projectName) {
  var url = cfg.url + '/rest/v1/' + SUP_TABLE_TRIGGERS
    + '?select=*&order=project_name.asc,trigger_name.asc';

  if (projectName) {
    url += '&project_name=eq.' + encodeURIComponent(projectName);
  }

  var res = UrlFetchApp.fetch(url, {
    method:             'get',
    headers:            supHeaders(cfg),
    muteHttpExceptions: true,
  });

  supAssertOk(res, 'supGetRegisteredTriggers');
  return JSON.parse(res.getContentText());
}

// ============================================================
//  SETUP / VERIFICA CONNESSIONE
// ============================================================

/**
 * Verifica la connettività a Supabase e l'esistenza delle tabelle principali.
 * Eseguire manualmente dall'editor per validare il setup.
 * Sicuro da rieseguire: effettua solo letture.
 */
function supSetupVerify() {
  var cfg = supGetConfig();
  var tables = [SUP_TABLE_LOGS, SUP_TABLE_TRIGGERS];

  tables.forEach(function(table) {
    var res = UrlFetchApp.fetch(
      cfg.url + '/rest/v1/' + table + '?limit=1',
      { method: 'get', headers: supHeaders(cfg), muteHttpExceptions: true }
    );
    if (res.getResponseCode() === 200) {
      Logger.log('OK — tabella "' + table + '" raggiungibile.');
    } else {
      Logger.log(
        'ATTENZIONE — tabella "' + table + '" HTTP ' +
        res.getResponseCode() + ': ' + res.getContentText()
      );
    }
  });

  Logger.log('LOG_LEVEL attivo: ' + supGetLogLevel());
}
