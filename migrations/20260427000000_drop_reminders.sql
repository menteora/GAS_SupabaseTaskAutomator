-- Migration: drop_reminders
-- La tabella reminders non è più necessaria: ogni progetto GAS invia
-- il reminder direttamente tramite staRunAndSendReminder() senza passare
-- per un dispatcher centralizzato. La traccia degli invii rimane in logs.

DROP TABLE IF EXISTS public.reminders;
