-- CreateEnum
CREATE TYPE "AssignmentType" AS ENUM ('FILE', 'TEXT', 'FILE_OR_TEXT');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'GRADED', 'RETURNED', 'RESUBMISSION_REQUIRED');

-- CreateEnum
CREATE TYPE "GradeScale" AS ENUM ('SCORE_100', 'SCORE_5', 'PASS_FAIL');

-- CreateTable
CREATE TABLE "assignments" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "section_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "instructions" TEXT,
    "type" "AssignmentType" NOT NULL,
    "max_score" DECIMAL(6,2) NOT NULL,
    "weight" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "due_at" TIMESTAMPTZ(3),
    "allow_late" BOOLEAN NOT NULL DEFAULT false,
    "late_penalty_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 1,
    "allow_resubmission" BOOLEAN NOT NULL DEFAULT false,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by" UUID NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "assignments_max_score_positive" CHECK ("max_score" > 0),
    CONSTRAINT "assignments_weight_nonnegative" CHECK ("weight" >= 0),
    CONSTRAINT "assignments_late_penalty_range" CHECK ("late_penalty_percent" >= 0 AND "late_penalty_percent" <= 100),
    CONSTRAINT "assignments_max_attempts_positive" CHECK ("max_attempts" >= 1)
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "text_content" TEXT,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMPTZ(3),
    "is_late" BOOLEAN NOT NULL DEFAULT false,
    "score" DECIMAL(6,2),
    "feedback" TEXT,
    "graded_by" UUID,
    "graded_at" TIMESTAMPTZ(3),
    "returned_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "submissions_attempt_no_positive" CHECK ("attempt_no" >= 1),
    CONSTRAINT "submissions_score_nonnegative" CHECK ("score" IS NULL OR "score" >= 0)
);

-- CreateTable
CREATE TABLE "submission_files" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gradebook_settings" (
    "course_id" UUID NOT NULL,
    "scale" "GradeScale" NOT NULL DEFAULT 'SCORE_100',
    "passing_score" DECIMAL(6,2),
    "rounding" INTEGER NOT NULL DEFAULT 0,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "gradebook_settings_pkey" PRIMARY KEY ("course_id"),
    CONSTRAINT "gradebook_settings_rounding_range" CHECK ("rounding" >= 0 AND "rounding" <= 4)
);

-- CreateTable
CREATE TABLE "final_grades" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "score" DECIMAL(6,2),
    "grade_label" VARCHAR(40),
    "comment" TEXT,
    "set_by" UUID NOT NULL,
    "set_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "final_grades_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "final_grades_score_nonnegative" CHECK ("score" IS NULL OR "score" >= 0)
);

-- CreateIndex
CREATE INDEX "assignments_course_id_status_due_at_idx" ON "assignments"("course_id", "status", "due_at");
CREATE INDEX "assignments_section_id_status_idx" ON "assignments"("section_id", "status");
CREATE UNIQUE INDEX "submissions_assignment_id_student_id_attempt_no_key" ON "submissions"("assignment_id", "student_id", "attempt_no");
CREATE INDEX "submissions_assignment_id_status_submitted_at_idx" ON "submissions"("assignment_id", "status", "submitted_at");
CREATE INDEX "submissions_student_id_status_submitted_at_idx" ON "submissions"("student_id", "status", "submitted_at");
CREATE UNIQUE INDEX "submission_files_submission_id_file_id_key" ON "submission_files"("submission_id", "file_id");
CREATE INDEX "submission_files_file_id_idx" ON "submission_files"("file_id");
CREATE INDEX "final_grades_student_id_set_at_idx" ON "final_grades"("student_id", "set_at");
CREATE UNIQUE INDEX "final_grades_course_id_student_id_key" ON "final_grades"("course_id", "student_id");

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "course_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_graded_by_fkey" FOREIGN KEY ("graded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gradebook_settings" ADD CONSTRAINT "gradebook_settings_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gradebook_settings" ADD CONSTRAINT "gradebook_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "final_grades" ADD CONSTRAINT "final_grades_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "final_grades" ADD CONSTRAINT "final_grades_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "final_grades" ADD CONSTRAINT "final_grades_set_by_fkey" FOREIGN KEY ("set_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
