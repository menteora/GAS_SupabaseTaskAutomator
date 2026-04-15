#!/usr/bin/env bash
# =============================================================================
#  sync-supabase-lib.sh
#
#  Propaga GAS_SupabaseTaskAutomator/Supabase.js in tutti i progetti GAS della workspace.
#  Eseguire dalla cartella GAS_SupabaseTaskAutomator/ oppure da qualsiasi path:
#
#    ./GAS_SupabaseTaskAutomator/sync-supabase-lib.sh           # dry-run: mostra cosa farebbe
#    ./GAS_SupabaseTaskAutomator/sync-supabase-lib.sh --apply   # applica la copia
#    ./GAS_SupabaseTaskAutomator/sync-supabase-lib.sh --push    # applica + clasp push su ogni progetto
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(dirname "$SCRIPT_DIR")"
LIB_SRC="$SCRIPT_DIR/Supabase.js"

# Progetti destinatari (aggiungere nuovi progetti qui)
TARGETS=(
  "SUP_Reminder"
  "SUP_ISO_DocsWithSuggestions"
)

# Progetti da includere nel git commit ma non destinatari della copia
# (la libreria stessa è qui)
GIT_EXTRA=(
  "GAS_SupabaseTaskAutomator"
)

# ─── Argomenti ───────────────────────────────────────────────
DRY_RUN=true
PUSH=false

for arg in "$@"; do
  case "$arg" in
    --apply) DRY_RUN=false ;;
    --push)  DRY_RUN=false; PUSH=true ;;
    --help)
      echo "Uso: $0 [--apply | --push | --help]"
      echo "  (nessun flag)  Dry-run: mostra cosa verrebbe copiato"
      echo "  --apply        Copia Supabase.js nei progetti destinatari"
      echo "  --push         Copia + clasp push su ogni progetto"
      exit 0
      ;;
  esac
done

# ─── Controllo sorgente ───────────────────────────────────────
if [[ ! -f "$LIB_SRC" ]]; then
  echo "ERRORE: sorgente non trovata: $LIB_SRC" >&2
  exit 1
fi

LIB_HASH=$(md5sum "$LIB_SRC" | cut -d' ' -f1)
LIB_LINES=$(wc -l < "$LIB_SRC")

echo "============================================="
echo " sync-supabase-lib"
echo " Sorgente : GAS_SupabaseTaskAutomator/Supabase.js"
echo " MD5      : $LIB_HASH  ($LIB_LINES righe)"
echo " Modalità : $([ "$DRY_RUN" = true ] && echo 'DRY-RUN (usa --apply per applicare)' || ([ "$PUSH" = true ] && echo 'APPLY + CLASP PUSH' || echo 'APPLY'))"
echo "============================================="
echo ""

CHANGED=0
SKIPPED=0
ERRORS=0

# Raccoglie i progetti effettivamente aggiornati (per il git commit finale)
UPDATED_PROJECTS=()

for project in "${TARGETS[@]}"; do
  dest="$WORKSPACE_DIR/$project/Supabase.js"

  if [[ ! -d "$WORKSPACE_DIR/$project" ]]; then
    echo "  [SKIP]  $project/ — cartella non trovata"
    ((ERRORS++)) || true
    continue
  fi

  if [[ -f "$dest" ]]; then
    dest_hash=$(md5sum "$dest" | cut -d' ' -f1)
    if [[ "$dest_hash" == "$LIB_HASH" ]]; then
      echo "  [OK]    $project/Supabase.js — già aggiornato"
      ((SKIPPED++)) || true
      continue
    fi
    status="aggiorna"
  else
    status="crea"
    dest_hash="(assente)"
  fi

  echo "  [COPY]  $project/Supabase.js — $status (MD5 attuale: $dest_hash)"
  ((CHANGED++)) || true

  if [[ "$DRY_RUN" = false ]]; then
    cp "$LIB_SRC" "$dest"
    UPDATED_PROJECTS+=("$project")

    if [[ "$PUSH" = true ]]; then
      if [[ -f "$WORKSPACE_DIR/$project/.clasp.json" ]]; then
        echo "          → clasp push ($project)..."
        (cd "$WORKSPACE_DIR/$project" && clasp push --force 2>&1 | sed 's/^/             /')
      else
        echo "          → clasp push saltato: .clasp.json non trovato"
      fi
    fi
  fi
done

echo ""
echo "─────────────────────────────────────────────"
if [[ "$DRY_RUN" = true ]]; then
  echo " Dry-run completato: $CHANGED da aggiornare, $SKIPPED già ok, $ERRORS errori"
  [[ $CHANGED -gt 0 ]] && echo " Riesegui con --apply per applicare le modifiche."
else
  echo " Sync completato: $CHANGED aggiornati, $SKIPPED già ok, $ERRORS errori"
fi
echo "─────────────────────────────────────────────"

# ─── Git: add + commit + push per tutti i progetti ───────────
if [[ "$DRY_RUN" = false ]]; then
  echo ""
  read -r -p "Vuoi fare git add + commit + push per tutti i progetti? [s/N] " do_git
  if [[ "$do_git" =~ ^[sS]$ ]]; then
    read -r -p "Messaggio di commit: " commit_msg
    if [[ -z "$commit_msg" ]]; then
      echo "Messaggio vuoto — git saltato." >&2
    else
      ALL_GIT_PROJECTS=("${TARGETS[@]}" "${GIT_EXTRA[@]}")
      for project in "${ALL_GIT_PROJECTS[@]}"; do
        if [[ "$project" == "GAS_SupabaseTaskAutomator" ]]; then
          project_dir="$SCRIPT_DIR"
        else
          project_dir="$WORKSPACE_DIR/$project"
        fi
        if [[ ! -d "$project_dir/.git" ]]; then
          echo "  [SKIP git]  $project — non è un repository git"
          continue
        fi
        # Salta se non ci sono modifiche
        if git -C "$project_dir" diff --quiet && git -C "$project_dir" diff --cached --quiet && [[ -z "$(git -C "$project_dir" ls-files --others --exclude-standard)" ]]; then
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
    fi
  else
    echo "Git saltato."
  fi
fi

# Exit code non-zero se ci sono stati errori
[[ $ERRORS -eq 0 ]]
