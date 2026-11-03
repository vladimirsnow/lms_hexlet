CREATE TABLE "group_daily_attendance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "group_id" UUID NOT NULL,
    "session_date" DATE NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "marked_by" UUID NOT NULL,
    "marked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "group_daily_attendance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "group_daily_attendance_group_date_student_key"
    ON "group_daily_attendance"("group_id", "session_date", "student_id");

CREATE INDEX "group_daily_attendance_student_date_status_idx"
    ON "group_daily_attendance"("student_id", "session_date", "status");

CREATE INDEX "group_daily_attendance_group_date_idx"
    ON "group_daily_attendance"("group_id", "session_date");

ALTER TABLE "group_daily_attendance"
    ADD CONSTRAINT "group_daily_attendance_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "group_daily_attendance"
    ADD CONSTRAINT "group_daily_attendance_student_id_fkey"
    FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "group_daily_attendance"
    ADD CONSTRAINT "group_daily_attendance_marked_by_fkey"
    FOREIGN KEY ("marked_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
