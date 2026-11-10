CREATE TABLE "lesson_grades" (
  "id" UUID NOT NULL,
  "lesson_key" VARCHAR(100) NOT NULL,
  "session_date" DATE NOT NULL,
  "group_id" UUID NOT NULL,
  "student_id" UUID NOT NULL,
  "value" INTEGER NOT NULL,
  "set_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "lesson_grades_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lesson_grades_value_check" CHECK ("value" BETWEEN 2 AND 5)
);
CREATE UNIQUE INDEX "lesson_grades_lesson_key_session_date_student_id_key" ON "lesson_grades"("lesson_key", "session_date", "student_id");
CREATE INDEX "lesson_grades_group_id_session_date_idx" ON "lesson_grades"("group_id", "session_date");
ALTER TABLE "lesson_grades" ADD CONSTRAINT "lesson_grades_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lesson_grades" ADD CONSTRAINT "lesson_grades_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lesson_grades" ADD CONSTRAINT "lesson_grades_set_by_fkey" FOREIGN KEY ("set_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
