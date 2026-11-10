ALTER TABLE "lesson_grades" DROP CONSTRAINT "lesson_grades_value_check";

-- Preserve existing five-point marks as their equivalent on the 100-point scale.
UPDATE "lesson_grades" SET "value" = "value" * 20 WHERE "value" BETWEEN 2 AND 5;

ALTER TABLE "lesson_grades"
  ADD CONSTRAINT "lesson_grades_value_check" CHECK ("value" BETWEEN 0 AND 100);
