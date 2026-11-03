-- CreateEnum
CREATE TYPE "CourseCategory" AS ENUM ('OOD', 'OOM', 'PM', 'SPECIALTY', 'COHORT');

-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "academic_years" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "academic_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terms" (
    "id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "specialties" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name_ru" VARCHAR(160) NOT NULL,
    "name_kk" VARCHAR(160),
    "name_en" VARCHAR(160),
    "qualification" VARCHAR(200),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "specialties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "specialty_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "course_year" INTEGER NOT NULL,
    "curator_id" UUID,
    "capacity" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_members" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name_ru" VARCHAR(160) NOT NULL,
    "name_kk" VARCHAR(160),
    "name_en" VARCHAR(160),
    "description" TEXT,
    "credits" DECIMAL(5,2),
    "total_hours" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "specialty_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(220) NOT NULL,
    "category" "CourseCategory" NOT NULL,
    "summary" VARCHAR(1000),
    "description" JSONB,
    "language" VARCHAR(8) NOT NULL DEFAULT 'ru',
    "status" "CourseStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by" UUID NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_teachers" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "assigned_by" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_teachers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "group_id" UUID,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "enrolled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "academic_years_name_key" ON "academic_years"("name");

-- CreateIndex
CREATE INDEX "academic_years_is_active_starts_on_idx" ON "academic_years"("is_active", "starts_on");

-- CreateIndex
CREATE INDEX "terms_academic_year_id_starts_on_idx" ON "terms"("academic_year_id", "starts_on");

-- CreateIndex
CREATE UNIQUE INDEX "terms_id_academic_year_id_key" ON "terms"("id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "terms_academic_year_id_name_key" ON "terms"("academic_year_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "specialties_code_key" ON "specialties"("code");

-- CreateIndex
CREATE INDEX "specialties_is_active_name_ru_idx" ON "specialties"("is_active", "name_ru");

-- CreateIndex
CREATE INDEX "groups_academic_year_id_specialty_id_is_active_idx" ON "groups"("academic_year_id", "specialty_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "groups_academic_year_id_specialty_id_name_key" ON "groups"("academic_year_id", "specialty_id", "name");

-- CreateIndex
CREATE INDEX "group_members_group_id_left_at_joined_at_idx" ON "group_members"("group_id", "left_at", "joined_at");

-- CreateIndex
CREATE INDEX "group_members_student_id_left_at_idx" ON "group_members"("student_id", "left_at");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_code_key" ON "subjects"("code");

-- CreateIndex
CREATE INDEX "subjects_is_active_name_ru_idx" ON "subjects"("is_active", "name_ru");

-- CreateIndex
CREATE UNIQUE INDEX "courses_slug_key" ON "courses"("slug");

-- CreateIndex
CREATE INDEX "courses_academic_year_id_specialty_id_category_status_idx" ON "courses"("academic_year_id", "specialty_id", "category", "status");

-- CreateIndex
CREATE INDEX "courses_term_id_status_idx" ON "courses"("term_id", "status");

-- CreateIndex
CREATE INDEX "courses_subject_id_idx" ON "courses"("subject_id");

-- CreateIndex
CREATE INDEX "course_teachers_teacher_id_course_id_idx" ON "course_teachers"("teacher_id", "course_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_teachers_course_id_teacher_id_key" ON "course_teachers"("course_id", "teacher_id");

-- CreateIndex
CREATE INDEX "enrollments_student_id_status_enrolled_at_idx" ON "enrollments"("student_id", "status", "enrolled_at");

-- CreateIndex
CREATE INDEX "enrollments_group_id_course_id_idx" ON "enrollments"("group_id", "course_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_course_id_student_id_key" ON "enrollments"("course_id", "student_id");

-- AddForeignKey
ALTER TABLE "terms" ADD CONSTRAINT "terms_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_specialty_id_fkey" FOREIGN KEY ("specialty_id") REFERENCES "specialties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_curator_id_fkey" FOREIGN KEY ("curator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_term_id_academic_year_id_fkey" FOREIGN KEY ("term_id", "academic_year_id") REFERENCES "terms"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_specialty_id_fkey" FOREIGN KEY ("specialty_id") REFERENCES "specialties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_teachers" ADD CONSTRAINT "course_teachers_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_teachers" ADD CONSTRAINT "course_teachers_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_teachers" ADD CONSTRAINT "course_teachers_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep date ranges and live memberships valid even for non-application writes.
ALTER TABLE "academic_years"
    ADD CONSTRAINT "academic_years_date_range_check" CHECK ("ends_on" >= "starts_on");
CREATE UNIQUE INDEX "academic_years_single_active_idx" ON "academic_years" ("is_active") WHERE "is_active" = true;

ALTER TABLE "terms"
    ADD CONSTRAINT "terms_date_range_check" CHECK ("ends_on" >= "starts_on");
CREATE UNIQUE INDEX "terms_single_active_per_year_idx" ON "terms" ("academic_year_id") WHERE "is_active" = true;

ALTER TABLE "groups"
    ADD CONSTRAINT "groups_course_year_check" CHECK ("course_year" BETWEEN 1 AND 6),
    ADD CONSTRAINT "groups_capacity_check" CHECK ("capacity" IS NULL OR "capacity" > 0);

ALTER TABLE "group_members"
    ADD CONSTRAINT "group_members_date_range_check" CHECK ("left_at" IS NULL OR "left_at" >= "joined_at");
CREATE UNIQUE INDEX "group_members_one_active_per_student_idx" ON "group_members" ("student_id") WHERE "left_at" IS NULL;

ALTER TABLE "subjects"
    ADD CONSTRAINT "subjects_credits_nonnegative_check" CHECK ("credits" IS NULL OR "credits" >= 0),
    ADD CONSTRAINT "subjects_total_hours_nonnegative_check" CHECK ("total_hours" IS NULL OR "total_hours" >= 0);
