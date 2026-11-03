import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Course, type Term } from "../generated/prisma/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Укажите DATABASE_URL в .env.");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

const specialties = [
  { code: "DEMO-IT", nameRu: "Информационные технологии (демо)", qualification: "Техник-программист" },
  { code: "DEMO-DESIGN", nameRu: "Цифровой дизайн (демо)", qualification: "Дизайнер цифровых продуктов" },
] as const;

const subjects = [
  { code: "DEMO-ALG", nameRu: "Алгоритмы и программирование", totalHours: 96, credits: 4 },
  { code: "DEMO-WEB", nameRu: "Веб-разработка", totalHours: 80, credits: 3 },
  { code: "DEMO-DB", nameRu: "Базы данных", totalHours: 72, credits: 3 },
  { code: "DEMO-UX", nameRu: "Основы UX-дизайна", totalHours: 64, credits: 2 },
  { code: "DEMO-GRAPH", nameRu: "Графический дизайн", totalHours: 80, credits: 3 },
  { code: "DEMO-MEDIA", nameRu: "Цифровые медиа", totalHours: 64, credits: 2 },
] as const;

const courseDefinitions = [
  { subjectIndex: 0, specialtyIndex: 0, category: "PM", slug: "demo-algorithms-2026", title: "Алгоритмы и программирование" },
  { subjectIndex: 1, specialtyIndex: 0, category: "SPECIALTY", slug: "demo-web-development-2026", title: "Веб-разработка" },
  { subjectIndex: 2, specialtyIndex: 0, category: "OOD", slug: "demo-databases-2026", title: "Базы данных" },
  { subjectIndex: 3, specialtyIndex: 0, category: "OOM", slug: "demo-ux-it-2026", title: "UX для цифровых сервисов" },
  { subjectIndex: 3, specialtyIndex: 1, category: "PM", slug: "demo-ux-design-2026", title: "Основы UX-дизайна" },
  { subjectIndex: 4, specialtyIndex: 1, category: "SPECIALTY", slug: "demo-graphic-design-2026", title: "Графический дизайн" },
  { subjectIndex: 5, specialtyIndex: 1, category: "OOD", slug: "demo-digital-media-2026", title: "Цифровые медиа" },
  { subjectIndex: 1, specialtyIndex: 1, category: "COHORT", slug: "demo-web-design-2026", title: "Интерактивные веб-проекты" },
] as const;

try {
  const counts = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ locked: string }>>`
      SELECT pg_advisory_xact_lock(2026103102)::text AS locked
    `;
    if (await tx.academicYear.count()) {
      throw new Error("Демо-структура не создана: учебные годы уже есть. Скрипт не изменил данные.");
    }

    const [admin, teachers, students] = await Promise.all([
      tx.user.findFirst({ where: { username: "superadmin", role: "SUPER_ADMIN", status: "ACTIVE" } }),
      tx.user.findMany({ where: { username: { in: ["teacher01", "teacher02"] }, role: "TEACHER", status: "ACTIVE" } }),
      tx.user.findMany({ where: { username: { in: ["student01", "student02", "student03", "student04", "student05"] }, role: "STUDENT", status: "ACTIVE" } }),
    ]);
    if (!admin || teachers.length !== 2 || students.length !== 5) {
      throw new Error("Для демо-структуры нужны начальные аккаунты superadmin, teacher01–02 и student01–05.");
    }
    const teacherByUsername = new Map(teachers.map((teacher) => [teacher.username, teacher]));
    const studentByUsername = new Map(students.map((student) => [student.username, student]));

    const year = await tx.academicYear.create({
      data: { name: "2026-2027 (демо)", startsOn: day("2026-09-01"), endsOn: day("2027-06-30"), isActive: true },
    });
    const terms = await Promise.all([
      tx.term.create({ data: { academicYearId: year.id, name: "Осенний семестр", startsOn: day("2026-09-01"), endsOn: day("2027-01-31"), isActive: true } }),
      tx.term.create({ data: { academicYearId: year.id, name: "Весенний семестр", startsOn: day("2027-02-01"), endsOn: day("2027-06-30"), isActive: false } }),
    ]);
    const specialtyRows = await Promise.all(specialties.map((specialty) => tx.specialty.create({ data: specialty })));
    const groupDefinitions = [
      { name: "ДЕМО-ИТ-1А", specialtyIndex: 0, courseYear: 1, curatorUsername: "teacher01" },
      { name: "ДЕМО-ИТ-1Б", specialtyIndex: 0, courseYear: 2, curatorUsername: "teacher01" },
      { name: "ДЕМО-ДИЗ-1А", specialtyIndex: 1, courseYear: 1, curatorUsername: "teacher02" },
      { name: "ДЕМО-ДИЗ-1Б", specialtyIndex: 1, courseYear: 2, curatorUsername: "teacher02" },
    ] as const;
    const groups = await Promise.all(groupDefinitions.map((group) => tx.studyGroup.create({
      data: {
        academicYearId: year.id,
        specialtyId: specialtyRows[group.specialtyIndex].id,
        name: group.name,
        courseYear: group.courseYear,
        curatorId: teacherByUsername.get(group.curatorUsername)!.id,
        capacity: 30,
      },
    })));
    const memberships = [
      { username: "student01", groupIndex: 0 },
      { username: "student02", groupIndex: 0 },
      { username: "student03", groupIndex: 1 },
      { username: "student04", groupIndex: 2 },
      { username: "student05", groupIndex: 3 },
    ] as const;
    for (const member of memberships) {
      await tx.groupMember.create({ data: { groupId: groups[member.groupIndex].id, studentId: studentByUsername.get(member.username)!.id } });
    }
    const subjectRows = await Promise.all(subjects.map((subject) => tx.subject.create({ data: subject })));
    const courses: Course[] = [];
    for (const definition of courseDefinitions) {
      const term: Term = terms[courses.length % terms.length];
      const created: Course = await tx.course.create({
        data: {
          subjectId: subjectRows[definition.subjectIndex].id,
          termId: term.id,
          academicYearId: year.id,
          specialtyId: specialtyRows[definition.specialtyIndex].id,
          title: definition.title,
          slug: definition.slug,
          category: definition.category,
          summary: "Демо-курс для настройки каталога и проверки ролей доступа.",
          status: "PUBLISHED",
          createdById: admin.id,
        },
      });
      courses.push(created);
      const teacher = teacherByUsername.get(definition.specialtyIndex === 0 ? "teacher01" : "teacher02")!;
      await tx.courseTeacher.create({ data: { courseId: created.id, teacherId: teacher.id, assignedById: admin.id } });
      if (courses.length % 3 === 0) {
        const secondTeacher = teacherByUsername.get(definition.specialtyIndex === 0 ? "teacher02" : "teacher01")!;
        await tx.courseTeacher.create({ data: { courseId: created.id, teacherId: secondTeacher.id, assignedById: admin.id } });
      }
      for (const membership of memberships) {
        if (groupDefinitions[membership.groupIndex].specialtyIndex !== definition.specialtyIndex) continue;
        const student = studentByUsername.get(membership.username)!;
        await tx.enrollment.create({ data: { courseId: created.id, studentId: student.id, groupId: groups[membership.groupIndex].id } });
      }
    }
    await tx.auditLog.create({
      data: {
        actorId: admin.id,
        action: "system.academic_demo_seeded",
        entityType: "academic_year",
        entityId: year.id,
        afterJson: { years: 1, terms: terms.length, specialties: specialtyRows.length, groups: groups.length, subjects: subjectRows.length, courses: courses.length, studentMemberships: memberships.length },
      },
    });
    return { academicYears: 1, terms: terms.length, specialties: specialtyRows.length, groups: groups.length, subjects: subjectRows.length, courses: courses.length, groupMembers: memberships.length };
  });

  console.info("Создана демо-структура учебного процесса:");
  console.info(counts);
  console.info("Созданы только данные структуры; новые аккаунты не добавлялись.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Не удалось создать демо-структуру.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
