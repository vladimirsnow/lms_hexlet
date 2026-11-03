CREATE TABLE "announcement_course_targets" (
    "announcement_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,

    CONSTRAINT "announcement_course_targets_pkey" PRIMARY KEY ("announcement_id", "course_id")
);

CREATE TABLE "announcement_group_targets" (
    "announcement_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,

    CONSTRAINT "announcement_group_targets_pkey" PRIMARY KEY ("announcement_id", "group_id")
);

CREATE INDEX "announcement_course_targets_course_id_announcement_id_idx"
ON "announcement_course_targets"("course_id", "announcement_id");

CREATE INDEX "announcement_group_targets_group_id_announcement_id_idx"
ON "announcement_group_targets"("group_id", "announcement_id");

ALTER TABLE "announcement_course_targets"
ADD CONSTRAINT "announcement_course_targets_announcement_id_fkey"
FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "announcement_course_targets"
ADD CONSTRAINT "announcement_course_targets_course_id_fkey"
FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "announcement_group_targets"
ADD CONSTRAINT "announcement_group_targets_announcement_id_fkey"
FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "announcement_group_targets"
ADD CONSTRAINT "announcement_group_targets_group_id_fkey"
FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "announcement_course_targets" ("announcement_id", "course_id")
SELECT "id", "course_id"
FROM "announcements"
WHERE "scope" = 'COURSE'::"AnnouncementScope" AND "course_id" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "announcement_group_targets" ("announcement_id", "group_id")
SELECT "id", "group_id"
FROM "announcements"
WHERE "scope" = 'GROUP'::"AnnouncementScope" AND "group_id" IS NOT NULL
ON CONFLICT DO NOTHING;
