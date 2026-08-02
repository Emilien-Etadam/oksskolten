#!/bin/bash
# Backup the SQLite database using the online backup API — safe under WAL
# while the server is running — with gzip compression and rotation.
#
# Usage: backup-db.sh [--data-dir DIR] [--backup-dir DIR] [--keep N]
# Env fallbacks: DATA_DIR, BACKUP_DIR, KEEP
#
# Example cron (daily at 04:00, keep two weeks):
#   0 4 * * * /opt/oksskolten/scripts/backup-db.sh >> /var/log/oksskolten-backup.log 2>&1
set -euo pipefail

DATA_DIR="${DATA_DIR:-/opt/oksskolten/data}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/oksskolten}"
KEEP="${KEEP:-14}"

while [ $# -gt 0 ]; do
  case "$1" in
    --data-dir)   DATA_DIR="$2"; shift 2 ;;
    --backup-dir) BACKUP_DIR="$2"; shift 2 ;;
    --keep)       KEEP="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

DB="$DATA_DIR/rss.db"
if [ ! -f "$DB" ]; then
  echo "database not found: $DB" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$BACKUP_DIR/rss-$STAMP.db"

sqlite3 "$DB" ".backup '$DEST'"
gzip "$DEST"

# Rotate: keep the most recent $KEEP backups
ls -1t "$BACKUP_DIR"/rss-*.db.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --

echo "backup written: $DEST.gz"
