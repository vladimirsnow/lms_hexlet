-- CreateEnum
CREATE TYPE "LessonType" AS ENUM ('TEXT', 'FILE', 'LINK', 'VIDEO');

-- CreateEnum
CREATE TYPE "FileVisibility" AS ENUM ('PRIVATE', 'COURSE');

-- CreateEnum
CREATE TYPE "FileUploadStatus" AS ENUM ('PENDING', 'READY', 'REJECTED');

-- CreateEnum
CREATE TYPE "VirusScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'NOT_SCANNED');

-- CreateTable
CREATE TABLE "course_sections" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "summary" VARCHAR(1000),
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "available_from" TIMESTAMPTZ(3),
    "available_until" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "course_sections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "course_sections_position_nonnegative" CHECK ("position" >= 0),
    CONSTRAINT "course_sections_availability_range" CHECK ("available_from" IS NULL OR "available_until" IS NULL OR "available_until" >= "available_from")
);

-- CreateTable
CREATE TABLE "lessons" (
    "id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "type" "LessonType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content" JSONB,
    "external_url" VARCHAR(2000),
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "available_from" TIMESTAMPTZ(3),
    "available_until" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lessons_position_nonnegative" CHECK ("position" >= 0),
    CONSTRAINT "lessons_availability_range" CHECK ("available_from" IS NULL OR "available_until" IS NULL OR "available_until" >= "available_from"),
    CONSTRAINT "lessons_external_url_required" CHECK (("type" IN ('LINK', 'VIDEO') AND "external_url" IS NOT NULL) OR ("type" IN ('TEXT', 'FILE') AND "external_url" IS NULL))
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "storage_key" VARCHAR(512) NOT NULL,
    "bucket" VARCHAR(63) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(160) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum_sha256" CHAR(64),
    "uploaded_by" UUID NOT NULL,
    "visibility" "FileVisibility" NOT NULL DEFAULT 'COURSE',
    "upload_status" "FileUploadStatus" NOT NULL DEFAULT 'PENDING',
    "virus_scan_status" "VirusScanStatus" NOT NULL DEFAULT 'NOT_SCANNED',
    "scanned_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "files_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "files_size_positive" CHECK ("size_bytes" > 0)
);

-- CreateTable
CREATE TABLE "lesson_attachments" (
    "id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesson_attachments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lesson_attachments_position_nonnegative" CHECK ("position" >= 0)
);

-- CreateTable
CREATE TABLE "lesson_progress" (
    "id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "viewed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "lesson_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "course_sections_course_id_deleted_at_position_idx" ON "course_sections"("course_id", "deleted_at", "position");

-- CreateIndex
CREATE INDEX "lessons_section_id_deleted_at_position_idx" ON "lessons"("section_id", "deleted_at", "position");

-- CreateIndex
CREATE INDEX "lessons_is_published_available_from_available_until_idx" ON "lessons"("is_published", "available_from", "available_until");

-- CreateIndex
CREATE UNIQUE INDEX "files_storage_key_key" ON "files"("storage_key");

-- CreateIndex
CREATE INDEX "files_uploaded_by_created_at_idx" ON "files"("uploaded_by", "created_at");

-- CreateIndex
CREATE INDEX "files_upload_status_deleted_at_idx" ON "files"("upload_status", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_attachments_lesson_id_file_id_key" ON "lesson_attachments"("lesson_id", "file_id");

-- CreateIndex
CREATE INDEX "lesson_attachments_file_id_idx" ON "lesson_attachments"("file_id");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_progress_lesson_id_student_id_key" ON "lesson_progress"("lesson_id", "student_id");

-- CreateIndex
CREATE INDEX "lesson_progress_student_id_completed_at_idx" ON "lesson_progress"("student_id", "completed_at");

-- AddForeignKey
ALTER TABLE "course_sections" ADD CONSTRAINT "course_sections_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_sections" ADD CONSTRAINT "course_sections_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_sections" ADD CONSTRAINT "course_sections_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "course_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_attachments" ADD CONSTRAINT "lesson_attachments_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_attachments" ADD CONSTRAINT "lesson_attachments_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
