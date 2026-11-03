#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "Usage: scripts/restore-check.sh <encrypted-backup.tar.gz.age>" >&2
  exit 2
fi
if [[ ! -f .env ]]; then
  echo "Missing .env; MINIO_BUCKET is read from the local environment file." >&2
  exit 1
fi
if [[ -z "${BACKUP_AGE_IDENTITY:-}" ]]; then
  echo "Set BACKUP_AGE_IDENTITY to the local age private identity file." >&2
  exit 1
fi

set -a
source ./.env
set +a
command -v age >/dev/null || { echo "Install age on the host first." >&2; exit 1; }

temp_dir="$(mktemp -d)"
suffix="$$"
network="lms-restore-$suffix"
pg_container="lms-restore-pg-$suffix"
minio_container="lms-restore-minio-$suffix"
client_image="minio/mc:RELEASE.2025-08-13T08-35-41Z"
trap 'docker rm -f "$pg_container" "$minio_container" >/dev/null 2>&1 || true; docker network rm "$network" >/dev/null 2>&1 || true; rm -rf "$temp_dir"' EXIT

age --decrypt --identity "$BACKUP_AGE_IDENTITY" "$1" > "$temp_dir/archive.tar.gz"
tar -xzf "$temp_dir/archive.tar.gz" -C "$temp_dir"
test -s "$temp_dir/database.dump"
test -d "$temp_dir/minio"

docker network create "$network" >/dev/null
docker run --detach --rm --name "$pg_container" --network "$network" \
  --env POSTGRES_PASSWORD=restore-check postgres:16-alpine >/dev/null
docker run --detach --rm --name "$minio_container" --network "$network" \
  --env MINIO_ROOT_USER=restorecheck --env MINIO_ROOT_PASSWORD=restorecheck-password \
  minio/minio:latest server /data >/dev/null

ready=false
for _ in $(seq 1 40); do
  if docker exec "$pg_container" pg_isready -U postgres -q; then
    ready=true
    break
  fi
  sleep 2
done
if [[ "$ready" != true ]]; then
  echo "Temporary PostgreSQL did not become ready." >&2
  exit 1
fi
docker exec -i "$pg_container" pg_restore --exit-on-error --no-owner --no-privileges \
  -U postgres -d postgres < "$temp_dir/database.dump"

docker run --rm --network "$network" --entrypoint /bin/sh \
  --volume "$temp_dir:/backup:ro" --env MINIO_BUCKET="$MINIO_BUCKET" "$client_image" -ec '
  until mc alias set restore http://lms-restore-minio-'"$suffix"':9000 restorecheck restorecheck-password; do sleep 2; done
  mc mb --ignore-existing "restore/$MINIO_BUCKET"
  mc mirror --overwrite /backup/minio "restore/$MINIO_BUCKET"
  mc ls "restore/$MINIO_BUCKET" >/dev/null
'

echo "Restore check passed: PostgreSQL restored and MinIO bucket recreated in temporary containers."
