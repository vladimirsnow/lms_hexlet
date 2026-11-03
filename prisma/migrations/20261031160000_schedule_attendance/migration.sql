CREATE TYPE "WeekPattern" AS ENUM ('EVERY', 'ODD', 'EVEN');
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');

CREATE TABLE "schedule_entries" (
    "id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "room" VARCHAR(100),
    "day_of_week" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "week_pattern" "WeekPattern" NOT NULL DEFAULT 'EVERY',
    "created_by" UUID NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "schedule_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "schedule_entries_day_of_week_check" CHECK ("day_of_week" BETWEEN 1 AND 7),
    CONSTRAINT "schedule_entries_start_minute_check" CHECK ("start_minute" BETWEEN 0 AND 1439),
    CONSTRAINT "schedule_entries_end_minute_check" CHECK ("end_minute" BETWEEN 1 AND 1440),
    CONSTRAINT "schedule_entries_time_order_check" CHECK ("end_minute" > "start_minute")
);

CREATE INDEX "schedule_entries_term_id_day_of_week_start_minute_deleted_at_idx" ON "schedule_entries"("term_id", "day_of_week", "start_minute", "deleted_at");
CREATE INDEX "schedule_entries_group_id_day_of_week_start_minute_deleted_at_idx" ON "schedule_entries"("group_id", "day_of_week", "start_minute", "deleted_at");
CREATE INDEX "schedule_entries_teacher_id_day_of_week_start_minute_deleted_at_idx" ON "schedule_entries"("teacher_id", "day_of_week", "start_minute", "deleted_at");

CREATE TABLE "attendance" (
    "id" UUID NOT NULL,
    "schedule_entry_id" UUID NOT NULL,
    "session_date" DATE NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "note" VARCHAR(1000),
    "marked_by" UUID NOT NULL,
    "marked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "attendance_schedule_entry_id_session_date_student_id_key" UNIQUE ("schedule_entry_id", "session_date", "student_id")
);

CREATE INDEX "attendance_student_id_session_date_status_idx" ON "attendance"("student_id", "session_date", "status");
CREATE INDEX "attendance_schedule_entry_id_session_date_idx" ON "attendance"("schedule_entry_id", "session_date");

ALTER TABLE "schedule_entries" ADD CONSTRAINT "schedule_entries_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "schedule_entries" ADD CONSTRAINT "schedule_entries_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "schedule_entries" ADD CONSTRAINT "schedule_entries_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "schedule_entries" ADD CONSTRAINT "schedule_entries_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "schedule_entries" ADD CONSTRAINT "schedule_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "schedule_entries" ADD CONSTRAINT "schedule_entries_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_schedule_entry_id_fkey" FOREIGN KEY ("schedule_entry_id") REFERENCES "schedule_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_marked_by_fkey" FOREIGN KEY ("marked_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
