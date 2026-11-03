#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f .env ]]; then
  echo "Missing .env. Copy .env.example and configure local secrets first." >&2
  exit 1
fi

# .env is a local, owner-controlled file; it is excluded from git and Docker build context.
set -a
source ./.env
set +a
: "${BACKUP_AGE_RECIPIENT:?Set BACKUP_AGE_RECIPIENT in .env to an age public recipient}"

command -v age >/dev/null || { echo "Install age on the host first." >&2; exit 1; }
docker compose exec -T postgres pg_isready -q || {
  echo "PostgreSQL is not healthy. Start the local stack first." >&2
  exit 1
}

backup_dir="${BACKUP_DIR:-./backups}"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

archive_name="platform-$(date -u +%Y%m%dT%H%M%SZ).tar.gz.age"
docker compose exec -T postgres pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB" \
  > "$temp_dir/database.dump"
mkdir -p "$temp_dir/minio"
docker compose run --rm --no-deps --volume "$temp_dir:/backup" minio-client \
  "mc alias set backup http://minio:9000 \"\$MINIO_ROOT_USER\" \"\$MINIO_ROOT_PASSWORD\" && mc mirror --overwrite backup/\"\$MINIO_BUCKET\" /backup/minio"
tar -C "$temp_dir" -czf "$temp_dir/archive.tar.gz" database.dump minio
age --recipient "$BACKUP_AGE_RECIPIENT" --output "$backup_dir/$archive_name.tmp" "$temp_dir/archive.tar.gz"
mv "$backup_dir/$archive_name.tmp" "$backup_dir/$archive_name"
chmod 600 "$backup_dir/$archive_name"
echo "Encrypted backup created: $backup_dir/$archive_name"
