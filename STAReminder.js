// ============================================================
//  STAReminder.js — dispatch e invio reminder via Gmail / Telegram
//
//  Funzioni di libreria per il dispatch dei reminder per canale
//  e l'invio via Gmail o Telegram Bot API.
//
//  Dipendenze (stesso progetto GAS):
//    STASupabase.js  → (nessuna dipendenza diretta, ma supGetConfig()
//                       è usato dai consumer che chiamano queste funzioni)
//
//  Script Properties richieste per Telegram:
//    TELEGRAM_BOT_TOKEN  → token del bot (es. 123456:ABC-...)
//    TELEGRAM_CHAT_ID    → chat/channel ID destinatario
// ============================================================

/**
 * Invia un reminder e logga l'esito. La traccia dell'invio rimane
 * esclusivamente nella tabella logs su Supabase.
 *
 * Uso tipico dal Codice.js di ogni progetto:
 *   staRunAndSendReminder(cfg, reminder, log_);
 *
 * @param {Object}   reminderPayload                Oggetto con channel e channel_config già pronti
 * @param {string}   reminderPayload.channel        'gmail' | 'telegram'
 * @param {Object}   reminderPayload.channel_config Config specifica del canale
 * @param {string}   [reminderPayload.notes]        Note libere (usate solo nel log)
 * @param {Function} [logFn]  Funzione log(level, message, context?) — fallback Logger.log
 */
function staRunAndSendReminder(reminderPayload, logFn) {
  var _log = logFn || function(level, msg) { Logger.log('[' + level.toUpperCase() + '] ' + msg); };

  var reminder = {
    channel:        reminderPayload.channel,
    channel_config: reminderPayload.channel_config,
  };

  try {
    staDispatchReminder(reminder, _log);
    _log('info', 'Reminder inviato', { channel: reminderPayload.channel, notes: reminderPayload.notes || null });
  } catch (e) {
    var errMsg = e.message || String(e);
    _log('error', 'Invio reminder fallito: ' + errMsg, { channel: reminderPayload.channel, error: errMsg });
    throw e;
  }
}

/**
 * Smista il reminder al canale corretto in base al campo `channel`.
 * Canali supportati: 'gmail' (default), 'telegram'.
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
    case 'telegram':
      staSendTelegramReminder(reminder.channel_config, reminder.id, logFn);
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

/**
 * Invia un reminder via Telegram Bot API (sendMessage).
 *
 * Struttura attesa di channel_config (JSONB su Supabase):
 * {
 *   "text":       "Testo del messaggio",   // obbligatorio
 *   "parse_mode": "HTML"                   // opzionale — "HTML" | "Markdown" | "MarkdownV2"
 * }
 *
 * Se channel_config.chat_id è presente sovrascrive la Script Property TELEGRAM_CHAT_ID,
 * consentendo reminder diretti a chat diverse per riga.
 *
 * Le credenziali vengono lette dalle Script Properties:
 *   TELEGRAM_BOT_TOKEN  — token del bot
 *   TELEGRAM_CHAT_ID    — chat/channel ID di default
 *
 * @param {Object}   config      Oggetto channel_config già parsato da Supabase
 * @param {string}   reminderId  UUID del reminder (usato solo nei log)
 * @param {Function} [logFn]     Funzione log(level, message, context?) — fallback Logger.log
 * @throws {Error} se i campi obbligatori mancano o la chiamata API fallisce
 */
function staSendTelegramReminder(config, reminderId, logFn) {
  var _log = logFn || function(level, msg) { Logger.log('[' + level.toUpperCase() + '] ' + msg); };

  if (!config || !config.text) {
    throw new Error('channel_config: campo "text" mancante o nullo');
  }

  var props     = PropertiesService.getScriptProperties();
  var botToken  = props.getProperty('TELEGRAM_BOT_TOKEN');
  var chatId    = config.chat_id || props.getProperty('TELEGRAM_CHAT_ID');

  if (!botToken) {
    throw new Error('Script Property "TELEGRAM_BOT_TOKEN" non impostata');
  }
  if (!chatId) {
    throw new Error('TELEGRAM_CHAT_ID non impostato (né in channel_config né nelle Script Properties)');
  }

  var payload = {
    chat_id:    chatId,
    text:       config.text,
    parse_mode: config.parse_mode || 'HTML',
  };

  var res = UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + botToken + '/sendMessage',
    {
      method:             'post',
      contentType:        'application/json',
      payload:            JSON.stringify(payload),
      muteHttpExceptions: true,
    }
  );

  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(
      'Telegram sendMessage HTTP ' + code + ': ' + res.getContentText()
    );
  }

}
