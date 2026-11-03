CREATE TABLE "schedule_import_attendance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "import_id" UUID NOT NULL,
    "entry_index" INTEGER NOT NULL,
    "session_date" DATE NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "note" VARCHAR(1000),
    "marked_by" UUID NOT NULL,
    "marked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "schedule_import_attendance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "schedule_import_attendance_import_entry_date_student_key"
    ON "schedule_import_attendance"("import_id", "entry_index", "session_date", "student_id");

CREATE INDEX "schedule_import_attendance_student_date_idx"
    ON "schedule_import_attendance"("student_id", "session_date");

CREATE INDEX "schedule_import_attendance_import_entry_date_idx"
    ON "schedule_import_attendance"("import_id", "entry_index", "session_date");

ALTER TABLE "schedule_import_attendance"
    ADD CONSTRAINT "schedule_import_attendance_import_id_fkey"
    FOREIGN KEY ("import_id") REFERENCES "schedule_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "schedule_import_attendance"
    ADD CONSTRAINT "schedule_import_attendance_student_id_fkey"
    FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "schedule_import_attendance"
    ADD CONSTRAINT "schedule_import_attendance_marked_by_fkey"
    FOREIGN KEY ("marked_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
