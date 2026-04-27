#!/usr/bin/env bash
# =============================================================================
#  sync-supabase-lib.sh
#
#  Gestisce la sincronizzazione della libreria Supabase.js e dei secrets
#  verso tutti i progetti GAS configurati in secrets/*.env
#
#  Uso interattivo:
#    ./sync-supabase-lib.sh
#
#  Uso non-interattivo (retrocompatibilità):
#    ./sync-supabase-lib.sh --apply    # copia file
#    ./sync-supabase-lib.sh --push     # copia + clasp push
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(dirname "$SCRIPT_DIR")"
SECRETS_DIR="$SCRIPT_DIR/secrets"
GLOBAL_ENV="$SECRETS_DIR/global.env"

# Campi riservati nei file secrets/<PROGETTO>.env (non diventano Script Properties)
RESERVED_KEYS=("SCRIPT_ID" "COPY_FILES")

# ─── Caricamento secrets globali ─────────────────────────────
if [[ -f "$GLOBAL_ENV" ]]; then
  # shellcheck source=/dev/null
  source "$GLOBAL_ENV"
else
  echo "AVVISO: $GLOBAL_ENV non trovato."
  echo "        Copia secrets/global.env.example → secrets/global.env e compila i valori."
  echo "        Le opzioni 4 e 5 (secrets.gs) non saranno disponibili."
  echo ""
fi

# ─── Utility: lista file .env dei progetti ───────────────────
# Restituisce i path di tutti i secrets/<PROGETTO>.env (esclude global.env e *.example)
fn_list_project_envs() {
  local f
  for f in "$SECRETS_DIR"/*.env; do
    [[ "$(basename "$f")" == "global.env" ]] && continue
    [[ "$f" == *.example ]] && continue
    [[ -f "$f" ]] && echo "$f"
  done
}

# ─── Utility: legge un campo da un file .env ─────────────────
# Uso: fn_read_field <file> <KEY>
fn_read_field() {
  local file="$1" key="$2"
  grep -E "^${key}=" "$file" 2>/dev/null | head -1 | cut -d'=' -f2-
}

# ─── Utility: verifica se una key è riservata ────────────────
fn_is_reserved() {
  local key="$1" r
  for r in "${RESERVED_KEYS[@]}"; do
    [[ "$key" == "$r" ]] && return 0
  done
  return 1
}

# ─── Funzione: copia file ────────────────────────────────────
fn_copy_files() {
  local mode="${1:-dry}"   # dry | apply | push
  local changed=0 skipped=0 errors=0

  echo "============================================="
  echo " Copia file"
  echo " Modalità: $([ "$mode" = dry ] && echo 'DRY-RUN' || ([ "$mode" = push ] && echo 'APPLY + CLASP PUSH' || echo 'APPLY'))"
  echo "============================================="
  echo ""

  local env_file
  while IFS= read -r env_file; do
    local project
    project="$(basename "$env_file" .env)"
    local project_dir="$WORKSPACE_DIR/$project"
    local copy_files_raw
    copy_files_raw="$(fn_read_field "$env_file" COPY_FILES)"

    if [[ -z "$copy_files_raw" ]]; then
      echo "  [SKIP]  $project — COPY_FILES non configurato"
      continue
    fi

    if [[ ! -d "$project_dir" ]]; then
      echo "  [SKIP]  $project/ — cartella non trovata (usa opzione 6 per clonare)"
      ((errors++)) || true
      continue
    fi

    # Itera i file da copiare (separati da virgola)
    local project_changed=0
    IFS=',' read -ra files <<< "$copy_files_raw"
    for rel_file in "${files[@]}"; do
      rel_file="${rel_file// /}"   # trim spazi
      local src="$SCRIPT_DIR/$rel_file"
      local dest="$project_dir/$rel_file"

      if [[ ! -f "$src" ]]; then
        echo "  [ERR]   $project/$rel_file — sorgente non trovata: $src"
        ((errors++)) || true
        continue
      fi

      local src_hash
      src_hash=$(md5sum "$src" | cut -d' ' -f1)

      if [[ -f "$dest" ]]; then
        local dest_hash
        dest_hash=$(md5sum "$dest" | cut -d' ' -f1)
        if [[ "$dest_hash" == "$src_hash" ]]; then
          echo "  [OK]    $project/$rel_file — già aggiornato"
          ((skipped++)) || true
          continue
        fi
        local status="aggiorna"
      else
        local status="crea"
      fi

      echo "  [COPY]  $project/$rel_file — $status"
      ((changed++)) || true
      ((project_changed++)) || true

      if [[ "$mode" != "dry" ]]; then
        cp "$src" "$dest"
      fi
    done

    if [[ "$mode" == "push" && $project_changed -gt 0 ]]; then
      if [[ -f "$project_dir/.clasp.json" ]]; then
        echo "          → clasp push ($project)..."
        (cd "$project_dir" && clasp push --force 2>&1 | sed 's/^/             /')
      else
        echo "          → clasp push saltato: .clasp.json non trovato"
      fi
    fi
  done < <(fn_list_project_envs)

  echo ""
  echo "─────────────────────────────────────────────"
  if [[ "$mode" == "dry" ]]; then
    echo " Dry-run: $changed da aggiornare, $skipped già ok, $errors errori"
    [[ $changed -gt 0 ]] && echo " Riesegui con opzione 2 o 3 per applicare."
  else
    echo " Completato: $changed aggiornati, $skipped già ok, $errors errori"
  fi
  echo "─────────────────────────────────────────────"
}

# ─── Funzione: genera secrets.gs ─────────────────────────────
fn_generate_secrets() {
  local mode="${1:-apply}"   # dry | apply

  if [[ ! -f "$GLOBAL_ENV" ]]; then
    echo "ERRORE: $GLOBAL_ENV non trovato — impossibile generare secrets.gs" >&2
    return 1
  fi

  echo "============================================="
  echo " Genera secrets.gs"
  echo " Modalità: $([ "$mode" = dry ] && echo 'DRY-RUN' || echo 'APPLY')"
  echo "============================================="
  echo ""

  local env_file
  while IFS= read -r env_file; do
    local project
    project="$(basename "$env_file" .env)"
    local project_dir="$WORKSPACE_DIR/$project"

    if [[ ! -d "$project_dir" ]]; then
      echo "  [SKIP]  $project/ — cartella non trovata (usa opzione 6 per clonare)"
      continue
    fi

    # Raccoglie i mapping property=valore
    local props=()
    local line key var_name value
    while IFS= read -r line; do
      # Salta commenti e righe vuote
      [[ "$line" =~ ^[[:space:]]*# ]] && continue
      [[ -z "${line// }" ]] && continue
      # Salta se non è KEY=VAL
      [[ "$line" != *=* ]] && continue

      key="${line%%=*}"
      var_name="${line#*=}"

      # Salta campi riservati
      fn_is_reserved "$key" && continue

      # Prova espansione indiretta: se var_name è il nome di una variabile in global.env, usa il suo valore.
      # Altrimenti usa var_name come valore letterale (per valori non segreti diretti nel file progetto).
      value="${!var_name:-}"
      if [[ -z "$value" ]]; then
        value="$var_name"
      fi

      props+=("$key=$value")
    done < "$env_file"

    if [[ ${#props[@]} -eq 0 ]]; then
      echo "  [SKIP]  $project — nessuna Script Property da impostare"
      continue
    fi

    local dest="$project_dir/secrets.gs"

    if [[ "$mode" == "dry" ]]; then
      echo "  [DRY]   $project/secrets.gs — genererebbe ${#props[@]} Script Properties:"
      local p
      for p in "${props[@]}"; do
        echo "            '${p%%=*}'"
      done
      continue
    fi

    # Genera il file secrets.gs dinamicamente
    {
      echo "// ============================================================================="
      echo "//  secrets.gs — GENERATO AUTOMATICAMENTE da sync-supabase-lib.sh"
      echo "//  NON modificare manualmente. NON committare (vedi .gitignore)."
      echo "//"
      echo "//  Eseguire initScriptProperties() UNA SOLA VOLTA dall'editor GAS"
      echo "//  dopo ogni sync per impostare le Script Properties."
      echo "// ============================================================================="
      echo ""
      echo "function initScriptProperties() {"
      echo "  PropertiesService.getScriptProperties().setProperties({"
      local p
      for p in "${props[@]}"; do
        local prop_key="${p%%=*}"
        local prop_val="${p#*=}"
        # Escape delle virgolette singole nel valore
        prop_val="${prop_val//\'/\'}"
        echo "    '${prop_key}': '${prop_val}',"
      done
      echo "  });"
      echo "  Logger.log('Script Properties impostate: $(IFS=', '; echo "${props[*]%%=*}").');"
      echo "}"
    } > "$dest"

    # Aggiorna .gitignore del progetto target
    local gitignore="$project_dir/.gitignore"
    if [[ ! -f "$gitignore" ]]; then
      printf 'secrets.gs\n' > "$gitignore"
      echo "  [OK]    $project/secrets.gs generato (${#props[@]} properties) — creato .gitignore"
    elif ! grep -qxF 'secrets.gs' "$gitignore"; then
      printf '\nsecrets.gs\n' >> "$gitignore"
      echo "  [OK]    $project/secrets.gs generato (${#props[@]} properties) — aggiornato .gitignore"
    else
      echo "  [OK]    $project/secrets.gs generato (${#props[@]} properties)"
    fi

  done < <(fn_list_project_envs)

  echo ""
  echo "─────────────────────────────────────────────"
  echo " secrets.gs generati. Aprire l'editor GAS di"
  echo " ogni progetto ed eseguire initScriptProperties()"
  echo "─────────────────────────────────────────────"
}

# ─── Funzione: pull totale ────────────────────────────────────
fn_pull_all() {
  echo "============================================="
  echo " Pull totale"
  echo "============================================="
  echo ""

  local env_file
  while IFS= read -r env_file; do
    local project
    project="$(basename "$env_file" .env)"
    local project_dir="$WORKSPACE_DIR/$project"
    local script_id
    script_id="$(fn_read_field "$env_file" SCRIPT_ID)"

    if [[ -z "$script_id" ]]; then
      echo "  [SKIP]  $project — SCRIPT_ID non configurato in $(basename "$env_file")"
      continue
    fi

    if [[ -d "$project_dir" ]]; then
      echo "  [PULL]  $project → clasp pull --force"
      (cd "$project_dir" && clasp pull --force 2>&1 | sed 's/^/             /') || \
        echo "  [ERR]   $project — clasp pull fallito"
    else
      echo "  [CLONE] $project — cartella non trovata, clono da script ID: $script_id"
      mkdir -p "$project_dir"
      (cd "$project_dir" && clasp clone "$script_id" 2>&1 | sed 's/^/             /') || {
        echo "  [ERR]   $project — clasp clone fallito"
        rmdir "$project_dir" 2>/dev/null || true
      }
    fi
  done < <(fn_list_project_envs)

  echo ""
  echo "─────────────────────────────────────────────"
  echo " Pull completato."
  echo "─────────────────────────────────────────────"
}

# ─── Funzione: git commit & push ─────────────────────────────
fn_git_commit() {
  read -r -p "Messaggio di commit: " commit_msg
  if [[ -z "$commit_msg" ]]; then
    echo "Messaggio vuoto — git saltato."
    return
  fi

  # Tutti i progetti target + il repo della libreria stessa
  local all_projects=()
  local env_file
  while IFS= read -r env_file; do
    all_projects+=("$(basename "$env_file" .env)")
  done < <(fn_list_project_envs)
  all_projects+=("GAS_SupabaseTaskAutomator")

  local project project_dir
  for project in "${all_projects[@]}"; do
    if [[ "$project" == "GAS_SupabaseTaskAutomator" ]]; then
      project_dir="$SCRIPT_DIR"
    else
      project_dir="$WORKSPACE_DIR/$project"
    fi

    if [[ ! -d "$project_dir/.git" ]]; then
      echo "  [SKIP git]  $project — non è un repository git"
      continue
    fi

    if git -C "$project_dir" diff --quiet && \
       git -C "$project_dir" diff --cached --quiet && \
       [[ -z "$(git -C "$project_dir" ls-files --others --exclude-standard)" ]]; then
      echo "  [SKIP git]  $project — nessuna modifica da committare"
      continue
    fi

    echo ""
    echo "  ── $project ──────────────────────────────"
    (
      cd "$project_dir"
      git add -A
      git commit -m "$commit_msg"
      git push origin master
      echo "  [GIT OK]  $project — commit e push completati"
    )
  done
}

# ─── Menu interattivo ─────────────────────────────────────────
fn_show_menu() {
  echo ""
  echo "╔══════════════════════════════════════════╗"
  echo "║         sync-supabase-lib                ║"
  echo "╠══════════════════════════════════════════╣"
  echo "║  1) Dry-run: mostra differenze           ║"
  echo "║  2) Copia file (Supabase.js, ecc.)       ║"
  echo "║  3) Copia file + clasp push              ║"
  echo "║  4) Genera secrets.gs nei target         ║"
  echo "║  5) Tutto: secrets + copia + push        ║"
  echo "║  6) Pull totale (ricrea ambiente)        ║"
  echo "║  7) Git commit & push                    ║"
  echo "║  q) Esci                                 ║"
  echo "╚══════════════════════════════════════════╝"
}

# ─── Dispatch non-interattivo (retrocompatibilità) ───────────
if [[ $# -gt 0 ]]; then
  case "${1:-}" in
    --apply) fn_copy_files apply; exit $? ;;
    --push)  fn_copy_files push;  exit $? ;;
    --help)
      echo "Uso: $0 [--apply | --push | --help]"
      echo "  (nessun flag)  Menu interattivo"
      echo "  --apply        Copia file nei progetti target"
      echo "  --push         Copia + clasp push su ogni progetto"
      exit 0
      ;;
    *)
      echo "Flag non riconosciuto: $1 — usa --help per l'elenco opzioni" >&2
      exit 1
      ;;
  esac
fi

# ─── Loop menu ────────────────────────────────────────────────
while true; do
  fn_show_menu
  read -r -p "Scelta: " choice
  echo ""
  case "$choice" in
    1) fn_copy_files dry ;;
    2) fn_copy_files apply ;;
    3) fn_copy_files push ;;
    4) fn_generate_secrets apply ;;
    5) fn_generate_secrets apply && fn_copy_files push ;;
    6) fn_pull_all ;;
    7) fn_git_commit ;;
    q|Q) echo "Uscita."; exit 0 ;;
    *) echo "Scelta non valida. Riprova." ;;
  esac
done
