// ============================================================
//  STATriggers.js — installazione e rimozione trigger GAS
//
//  Funzioni di libreria per gestire i trigger time-based di
//  Google Apps Script e sincronizzarli con il registro Supabase.
//
//  Dipendenze (stesso progetto GAS):
//    STASupabase.js  → supGetConfig(), supRegisterTrigger(),
//                       supUnregisterTrigger(), SUP_TRIGGER_TYPE,
//                       SUP_TRIGGER_INTERVAL_UNIT
// ============================================================

/**
 * Rimuove tutti i trigger del progetto associati al nome funzione indicato.
 *
 * @param {string} fnName  Nome della funzione handler GAS
 * @returns {number}       Numero di trigger rimossi
 */
function staRemoveTriggersByName(fnName) {
  var count = 0;
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === fnName) {
      ScriptApp.deleteTrigger(trigger);
      count++;
    }
  });
  return count;
}

/**
 * Installa un trigger orario per la funzione indicata.
 * Idempotente: rimuove eventuali trigger esistenti con lo stesso nome
 * prima di crearne uno nuovo.
 *
 * @param {Object} opts
 * @param {string} opts.fnName       Nome della funzione handler GAS (es. 'runReminders')
 * @param {string} opts.projectName  Nome progetto per il registro Supabase (es. 'SUP_Reminder')
 * @param {number} [opts.hours=1]    Intervallo in ore
 */
function staInstallHourlyTrigger(opts) {
  var fnName      = opts.fnName;
  var projectName = opts.projectName;
  var hours       = (typeof opts.hours === 'number') ? opts.hours : 1;

  staRemoveTriggersByName(fnName);

  ScriptApp.newTrigger(fnName)
    .timeBased()
    .everyHours(hours)
    .create();

  var cfg = supGetConfig();
  supRegisterTrigger(cfg, {
    triggerName:   fnName,
    projectName:   projectName,
    triggerType:   SUP_TRIGGER_TYPE.TIME_BASED,
    intervalValue: hours,
    intervalUnit:  SUP_TRIGGER_INTERVAL_UNIT.HOURS,
  });

  Logger.log('Trigger installato: ' + fnName + ' ogni ' + hours + ' ora/e.');
}

/**
 * Installa un trigger a frequenza in minuti per la funzione indicata.
 * Valori validi per GAS: 1, 5, 10, 15, 30.
 * Idempotente.
 *
 * @param {Object} opts
 * @param {string} opts.fnName       Nome della funzione handler GAS
 * @param {string} opts.projectName  Nome progetto per il registro Supabase
 * @param {number} [opts.minutes=15] Intervallo in minuti (1, 5, 10, 15 o 30)
 */
function staInstallMinutesTrigger(opts) {
  var fnName      = opts.fnName;
  var projectName = opts.projectName;
  var minutes     = (typeof opts.minutes === 'number') ? opts.minutes : 15;

  staRemoveTriggersByName(fnName);

  ScriptApp.newTrigger(fnName)
    .timeBased()
    .everyMinutes(minutes)
    .create();

  var cfg = supGetConfig();
  supRegisterTrigger(cfg, {
    triggerName:   fnName,
    projectName:   projectName,
    triggerType:   SUP_TRIGGER_TYPE.TIME_BASED,
    intervalValue: minutes,
    intervalUnit:  SUP_TRIGGER_INTERVAL_UNIT.MINUTES,
  });

  Logger.log('Trigger installato: ' + fnName + ' ogni ' + minutes + ' minuto/i.');
}

/**
 * Installa un trigger settimanale per la funzione indicata.
 * Idempotente: rimuove solo i trigger con lo stesso nome handler
 * (non tutti i trigger del progetto).
 *
 * @param {Object} opts
 * @param {string} opts.fnName                    Nome della funzione handler GAS
 * @param {string} opts.projectName               Nome progetto per il registro Supabase
 * @param {ScriptApp.WeekDay} [opts.weekDay]      Giorno della settimana (default: MONDAY)
 * @param {number}            [opts.hour=8]       Ora del giorno 0-23
 */
function staInstallWeeklyTrigger(opts) {
  var fnName      = opts.fnName;
  var projectName = opts.projectName;
  var weekDay     = opts.weekDay || ScriptApp.WeekDay.MONDAY;
  var hour        = (typeof opts.hour === 'number') ? opts.hour : 8;

  staRemoveTriggersByName(fnName);

  ScriptApp.newTrigger(fnName)
    .timeBased()
    .onWeekDay(weekDay)
    .atHour(hour)
    .create();

  var cfg = supGetConfig();
  supRegisterTrigger(cfg, {
    triggerName:   fnName,
    projectName:   projectName,
    triggerType:   SUP_TRIGGER_TYPE.TIME_BASED,
    intervalValue: 1,
    intervalUnit:  SUP_TRIGGER_INTERVAL_UNIT.WEEKS,
  });

  Logger.log('Trigger settimanale installato: ' + fnName + ' alle ' + hour + ':00.');
}

/**
 * Rimuove i trigger GAS e deregistra dal registro Supabase per i
 * nomi funzione indicati.
 *
 * @param {string|string[]} fnNames     Nome/i della funzione handler GAS
 * @param {Object}          cfg         Configurazione Supabase da supGetConfig()
 * @param {string}          projectName Nome progetto per il registro Supabase
 * @returns {number}                    Numero totale di trigger GAS rimossi
 */
function staRemoveProjectTriggers(fnNames, cfg, projectName) {
  var names = Array.isArray(fnNames) ? fnNames : [fnNames];
  var totalRemoved = 0;

  names.forEach(function(fnName) {
    totalRemoved += staRemoveTriggersByName(fnName);

    try {
      supUnregisterTrigger(cfg, fnName, projectName);
    } catch (e) {
      Logger.log('ATTENZIONE: impossibile rimuovere dal registro trigger — ' + e.message);
    }
  });

  Logger.log('Rimossi ' + totalRemoved + ' trigger/s per: ' + names.join(', '));
  return totalRemoved;
}

/**
 * Mostra i trigger attualmente installati nel progetto corrente.
 */
function staListProjectTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  if (triggers.length === 0) {
    Logger.log('Nessun trigger installato.');
    return;
  }
  triggers.forEach(function(t) {
    Logger.log(
      'Trigger: ' + t.getHandlerFunction() +
      ' | Tipo: ' + t.getEventType() +
      ' | ID: ' + t.getUniqueId()
    );
  });
}
