CREATE TYPE "TestStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');
CREATE TYPE "QuestionType" AS ENUM ('SINGLE', 'MULTIPLE', 'SHORT_ANSWER', 'ESSAY');
CREATE TYPE "TestAttemptStatus" AS ENUM ('IN_PROGRESS', 'NEEDS_REVIEW', 'GRADED', 'TIMED_OUT');
CREATE TYPE "AnnouncementScope" AS ENUM ('GLOBAL', 'COURSE', 'GROUP');

CREATE TABLE "tests" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "lesson_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "time_limit_minutes" INTEGER,
    "attempts_allowed" INTEGER NOT NULL DEFAULT 1,
    "shuffle_questions" BOOLEAN NOT NULL DEFAULT true,
    "passing_percent" DECIMAL(5,2) NOT NULL DEFAULT 50,
    "status" "TestStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by" UUID NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    CONSTRAINT "tests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tests_time_limit_check" CHECK ("time_limit_minutes" IS NULL OR "time_limit_minutes" BETWEEN 1 AND 600),
    CONSTRAINT "tests_attempts_allowed_check" CHECK ("attempts_allowed" BETWEEN 1 AND 20),
    CONSTRAINT "tests_passing_percent_check" CHECK ("passing_percent" BETWEEN 0 AND 100)
);
CREATE UNIQUE INDEX "tests_lesson_id_key" ON "tests"("lesson_id");
CREATE INDEX "tests_course_id_status_deleted_at_idx" ON "tests"("course_id", "status", "deleted_at");

CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "test_id" UUID NOT NULL,
    "type" "QuestionType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "points" DECIMAL(6,2) NOT NULL DEFAULT 1,
    "position" INTEGER NOT NULL DEFAULT 0,
    "accepted_answers" JSONB,
    "case_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "questions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "questions_points_check" CHECK ("points" > 0)
);
CREATE INDEX "questions_test_id_position_idx" ON "questions"("test_id", "position");

CREATE TABLE "question_options" (
    "id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "is_correct" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "question_options_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "question_options_question_id_position_key" UNIQUE ("question_id", "position")
);
CREATE INDEX "question_options_question_id_idx" ON "question_options"("question_id");

CREATE TABLE "test_attempts" (
    "id" UUID NOT NULL,
    "test_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "question_order" JSONB NOT NULL,
    "status" "TestAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "score" DECIMAL(8,2),
    "max_score" DECIMAL(8,2) NOT NULL,
    "is_timed_out" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),
    "submitted_at" TIMESTAMPTZ(3),
    "graded_at" TIMESTAMPTZ(3),
    CONSTRAINT "test_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "test_attempts_test_id_student_id_attempt_no_key" UNIQUE ("test_id", "student_id", "attempt_no"),
    CONSTRAINT "test_attempts_attempt_no_check" CHECK ("attempt_no" > 0),
    CONSTRAINT "test_attempts_max_score_check" CHECK ("max_score" >= 0)
);
CREATE INDEX "test_attempts_student_id_status_started_at_idx" ON "test_attempts"("student_id", "status", "started_at");
CREATE INDEX "test_attempts_test_id_status_submitted_at_idx" ON "test_attempts"("test_id", "status", "submitted_at");

CREATE TABLE "test_answers" (
    "id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "answer_json" JSONB,
    "points_awarded" DECIMAL(6,2),
    "feedback" TEXT,
    CONSTRAINT "test_answers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "test_answers_attempt_id_question_id_key" UNIQUE ("attempt_id", "question_id")
);

CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "scope" "AnnouncementScope" NOT NULL,
    "course_id" UUID,
    "group_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "announcements_audience_check" CHECK (
        ("scope" = 'GLOBAL' AND "course_id" IS NULL AND "group_id" IS NULL) OR
        ("scope" = 'COURSE' AND "course_id" IS NOT NULL AND "group_id" IS NULL) OR
        ("scope" = 'GROUP' AND "group_id" IS NOT NULL)
    ),
    CONSTRAINT "announcements_expiry_check" CHECK ("expires_at" IS NULL OR "published_at" IS NULL OR "expires_at" > "published_at")
);
CREATE INDEX "announcements_scope_published_at_expires_at_deleted_at_idx" ON "announcements"("scope", "published_at", "expires_at", "deleted_at");
CREATE INDEX "announcements_course_id_published_at_idx" ON "announcements"("course_id", "published_at");
CREATE INDEX "announcements_group_id_published_at_idx" ON "announcements"("group_id", "published_at");

CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(80) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT,
    "link" VARCHAR(500),
    "data_json" JSONB,
    "dedupe_key" VARCHAR(200),
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notifications_user_id_dedupe_key_key" UNIQUE ("user_id", "dedupe_key")
);
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

ALTER TABLE "tests" ADD CONSTRAINT "tests_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tests" ADD CONSTRAINT "tests_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tests" ADD CONSTRAINT "tests_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tests" ADD CONSTRAINT "tests_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "questions" ADD CONSTRAINT "questions_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "test_attempts" ADD CONSTRAINT "test_attempts_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "test_attempts" ADD CONSTRAINT "test_attempts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "test_answers" ADD CONSTRAINT "test_answers_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "test_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "test_answers" ADD CONSTRAINT "test_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
