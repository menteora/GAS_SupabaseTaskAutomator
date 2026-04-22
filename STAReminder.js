// ============================================================
//  STAReminder.js — dispatch e invio reminder via Gmail
//
//  Funzioni di libreria per il dispatch dei reminder per canale
//  e l'invio email tramite Gmail.
//
//  Dipendenze (stesso progetto GAS):
//    STASupabase.js  → (nessuna dipendenza diretta, ma supGetConfig()
//                       è usato dai consumer che chiamano queste funzioni)
// ============================================================

/**
 * Smista il reminder al canale corretto in base al campo `channel`.
 * Attualmente supportato: 'gmail' (default).
 *
 * @param {Object}   reminder  Riga Supabase con id, channel, channel_config
 * @param {Function} [logFn]   Funzione log(level, message, context?) — fallback Logger.log
 * @throws {Error} se il canale non è riconosciuto o l'invio fallisce
 */
function staDispatchReminder(reminder, logFn) {
  var channel = ((reminder.channel || 'gmail') + '').toLowerCase();

  switch (channel) {
    case 'gmail':
      staSendGmailReminder(reminder.channel_config, reminder.id, logFn);
      break;
    default:
      throw new Error('Canale non supportato: "' + channel + '"');
  }
}

/**
 * Invia un reminder via GmailApp.
 *
 * Struttura attesa di channel_config (JSONB su Supabase):
 * {
 *   "to":                  "dest@example.com",         // obbligatorio
 *   "cc":                  "copia@example.com",        // opzionale
 *   "bcc":                 "ccn@example.com",          // opzionale
 *   "subject":             "Oggetto email",            // obbligatorio
 *   "body":                "Testo del messaggio",      // obbligatorio
 *   "is_html":             true,                       // opzionale, default false
 *   "attachment_drive_id": "ID_Google_Drive"           // opzionale
 * }
 *
 * Note:
 * - "to", "cc" e "bcc" accettano liste separate da virgola.
 * - Se attachment_drive_id non è accessibile, l'email viene inviata
 *   comunque senza allegato (warning nel log).
 *
 * @param {Object}   config      Oggetto channel_config già parsato da Supabase
 * @param {string}   reminderId  UUID del reminder (usato solo nei log)
 * @param {Function} [logFn]     Funzione log(level, message, context?) — fallback Logger.log
 * @throws {Error} se i campi obbligatori mancano o GmailApp.sendEmail fallisce
 */
function staSendGmailReminder(config, reminderId, logFn) {
  var _log = logFn || function(level, msg) { Logger.log('[' + level.toUpperCase() + '] ' + msg); };

  // ── Validazione campi obbligatori ──────────────────────────
  if (!config || !config.to) {
    throw new Error('channel_config: campo "to" mancante o nullo');
  }
  if (!config.subject) {
    throw new Error('channel_config: campo "subject" mancante o nullo');
  }
  if (config.body === undefined || config.body === null) {
    throw new Error('channel_config: campo "body" mancante o nullo');
  }

  var options = {};

  if (config.cc)  options.cc  = config.cc;
  if (config.bcc) options.bcc = config.bcc;

  // Corpo HTML
  if (config.is_html) {
    options.htmlBody = config.body;
  }

  // Allegato da Google Drive (opzionale, non bloccante)
  if (config.attachment_drive_id) {
    try {
      var file = DriveApp.getFileById(config.attachment_drive_id);
      options.attachments = [file.getAs(file.getMimeType())];
    } catch (driveErr) {
      _log('warn',
        'Allegato Drive non trovato o non accessibile (ID: ' +
        config.attachment_drive_id + '). Email inviata senza allegato.',
        { reminder_id: reminderId, attachment_drive_id: config.attachment_drive_id, error: driveErr.message }
      );
    }
  }

  // GmailApp richiede sempre il corpo plain-text come terzo argomento
  var plainBody = config.is_html
    ? 'Apri questa email con un client che supporta HTML per visualizzare il contenuto.'
    : config.body;

  GmailApp.sendEmail(config.to, config.subject, plainBody, options);
}
