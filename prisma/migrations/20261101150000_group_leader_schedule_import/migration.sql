ALTER TABLE "group_members"
ADD COLUMN "is_group_leader" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "group_members_one_leader_per_group"
ON "group_members" ("group_id")
WHERE "is_group_leader" = true AND "left_at" IS NULL;

CREATE TABLE "schedule_imports" (
    "id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "entries" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "imported_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "schedule_imports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "schedule_imports_created_at_idx" ON "schedule_imports"("created_at");

ALTER TABLE "schedule_imports"
ADD CONSTRAINT "schedule_imports_imported_by_id_fkey"
FOREIGN KEY ("imported_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
