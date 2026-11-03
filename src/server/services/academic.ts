import { z } from "zod";
import { Prisma } from "../../../generated/prisma/client";
import { getPrisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/http/api-error";
import type { Actor } from "@/server/auth/session";

export const academicResources = [
  "academic-years",
  "terms",
  "specialties",
  "groups",
  "subjects",
  "courses",
] as const;
export type AcademicResource = (typeof academicResources)[number];

const id = z.uuid();
const isoDate = z.iso.date();
const dateRange = (startsOn: string, endsOn: string) => startsOn <= endsOn;
const yearSchema = z
  .object({
    name: z.string().trim().min(4).max(80),
    startsOn: isoDate,
    endsOn: isoDate,
    isActive: z.boolean().default(false),
  })
  .refine((value) => dateRange(value.startsOn, value.endsOn), {
    path: ["endsOn"],
    message: "Дата окончания должна быть не раньше даты начала.",
  });
const termSchema = z
  .object({
    academicYearId: id,
    name: z.string().trim().min(1).max(80),
    startsOn: isoDate,
    endsOn: isoDate,
    isActive: z.boolean().default(false),
  })
  .refine((value) => dateRange(value.startsOn, value.endsOn), {
    path: ["endsOn"],
    message: "Дата окончания должна быть не раньше даты начала.",
  });
const specialtySchema = z.object({
  code: z.string().trim().toUpperCase().min(2).max(32).regex(/^[A-Z0-9._-]+$/),
  nameRu: z.string().trim().min(1).max(160),
  nameKk: z.string().trim().max(160).nullable().optional(),
  nameEn: z.string().trim().max(160).nullable().optional(),
  qualification: z.string().trim().max(200).nullable().optional(),
  isActive: z.boolean().default(true),
});
const groupSchema = z.object({
  academicYearId: id,
  specialtyId: id,
  name: z.string().trim().min(1).max(80),
  courseYear: z.coerce.number().int().min(1).max(6),
  curatorId: id.nullable().optional(),
  capacity: z.preprocess((value) => value === "" || value === undefined ? null : value, z.coerce.number().int().positive().nullable()).optional(),
  isActive: z.boolean().default(true),
});
const subjectSchema = z.object({
  code: z.string().trim().toUpperCase().min(2).max(32).regex(/^[A-Z0-9._-]+$/),
  nameRu: z.string().trim().min(1).max(160),
  nameKk: z.string().trim().max(160).nullable().optional(),
  nameEn: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  credits: z.preprocess((value) => value === "" || value === undefined ? null : value, z.coerce.number().min(0).max(999.99).nullable()).optional(),
  totalHours: z.preprocess((value) => value === "" || value === undefined ? null : value, z.coerce.number().int().min(0).max(100000).nullable()).optional(),
  isActive: z.boolean().default(true),
});
const courseSchema = z.object({
  subjectId: id,
  termId: id,
  academicYearId: id,
  specialtyId: id,
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().toLowerCase().min(3).max(220).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  category: z.enum(["OOD", "OOM", "PM", "SPECIALTY", "COHORT"]),
  summary: z.string().trim().max(1000).nullable().optional(),
  description: z.record(z.string(), z.unknown()).nullable().optional(),
  language: z.enum(["ru", "kk", "en"]).default("ru"),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).default("DRAFT"),
});

const createSchemas = {
  "academic-years": yearSchema,
  terms: termSchema,
  specialties: specialtySchema,
  groups: groupSchema,
  subjects: subjectSchema,
  courses: courseSchema,
} satisfies Record<AcademicResource, z.ZodObject<z.ZodRawShape>>;

export function parseAcademicResource(value: string): AcademicResource {
  if (academicResources.includes(value as AcademicResource)) return value as AcademicResource;
  throw new ApiError(404, "RESOURCE_NOT_FOUND", "Раздел учебной структуры не найден.");
}

function date(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function auditJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function audit(
  tx: Prisma.TransactionClient,
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
  request: Request,
) {
  await tx.auditLog.create({
    data: {
      actorId: actor.id,
      action,
      entityType,
      entityId,
      beforeJson: before === undefined ? Prisma.JsonNull : auditJson(before),
      afterJson: after === undefined ? Prisma.JsonNull : auditJson(after),
      userAgent: request.headers.get("user-agent")?.slice(0, 1000) || null,
    },
  });
}

function entityType(resource: AcademicResource): string {
  if (resource === "academic-years") return "academic_year";
  if (resource === "specialties") return "specialty";
  if (resource === "terms") return "term";
  return resource.replace(/s$/, "");
}

export async function listAcademicRecords(
  resource: AcademicResource,
  options: {
    page: number;
    perPage: number;
    q?: string;
    academicYearId?: string;
    specialtyId?: string;
    category?: "OOD" | "OOM" | "PM" | "SPECIALTY" | "COHORT";
    status?: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  },
) {
  const prisma = getPrisma();
  const { page, perPage, q, academicYearId, specialtyId, category, status } = options;
  const skip = (page - 1) * perPage;
  switch (resource) {
    case "academic-years": {
      const where = q ? { name: { contains: q, mode: "insensitive" as const } } : {};
      const [items, total] = await Promise.all([
        prisma.academicYear.findMany({ where, orderBy: { startsOn: "desc" }, skip, take: perPage }),
        prisma.academicYear.count({ where }),
      ]);
      return { items, total };
    }
    case "terms": {
      const where = {
        ...(academicYearId ? { academicYearId } : {}),
        ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
      };
      const [items, total] = await Promise.all([
        prisma.term.findMany({ where, include: { academicYear: { select: { id: true, name: true } } }, orderBy: { startsOn: "desc" }, skip, take: perPage }),
        prisma.term.count({ where }),
      ]);
      return { items, total };
    }
    case "specialties": {
      const where = q
        ? { OR: [{ code: { contains: q, mode: "insensitive" as const } }, { nameRu: { contains: q, mode: "insensitive" as const } }] }
        : {};
      const [items, total] = await Promise.all([
        prisma.specialty.findMany({ where, orderBy: { nameRu: "asc" }, skip, take: perPage }),
        prisma.specialty.count({ where }),
      ]);
      return { items, total };
    }
    case "groups": {
      const where = {
        ...(academicYearId ? { academicYearId } : {}),
        ...(specialtyId ? { specialtyId } : {}),
        ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
      };
      const [items, total] = await Promise.all([
        prisma.studyGroup.findMany({
          where,
          include: {
            academicYear: { select: { id: true, name: true } },
            specialty: { select: { id: true, code: true, nameRu: true } },
            curator: { select: { id: true, name: true } },
            _count: { select: { memberships: true } },
          },
          orderBy: [{ academicYear: { startsOn: "desc" } }, { name: "asc" }],
          skip,
          take: perPage,
        }),
        prisma.studyGroup.count({ where }),
      ]);
      return { items, total };
    }
    case "subjects": {
      const where = q
        ? { OR: [{ code: { contains: q, mode: "insensitive" as const } }, { nameRu: { contains: q, mode: "insensitive" as const } }] }
        : {};
      const [items, total] = await Promise.all([
        prisma.subject.findMany({ where, orderBy: { nameRu: "asc" }, skip, take: perPage }),
        prisma.subject.count({ where }),
      ]);
      return { items, total };
    }
    case "courses": {
      const where = {
        deletedAt: null,
        ...(academicYearId ? { academicYearId } : {}),
        ...(specialtyId ? { specialtyId } : {}),
        ...(category ? { category } : {}),
        ...(status ? { status } : {}),
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: "insensitive" as const } },
                { slug: { contains: q, mode: "insensitive" as const } },
                { subject: { nameRu: { contains: q, mode: "insensitive" as const } } },
              ],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        prisma.course.findMany({
          where,
          include: {
            subject: { select: { id: true, code: true, nameRu: true } },
            term: { select: { id: true, name: true } },
            academicYear: { select: { id: true, name: true } },
            specialty: { select: { id: true, code: true, nameRu: true } },
            teacherAssignments: { include: { teacher: { select: { id: true, name: true, email: true } } } },
            _count: { select: { enrollments: true } },
          },
          orderBy: [{ academicYear: { startsOn: "desc" } }, { title: "asc" }],
          skip,
          take: perPage,
        }),
        prisma.course.count({ where }),
      ]);
      return { items, total };
    }
  }
}

export async function createAcademicRecord(
  actor: Actor,
  resource: AcademicResource,
  body: unknown,
  request: Request,
) {
  const parsed = createSchemas[resource].safeParse(body);
  if (!parsed.success) {
    throw new ApiError(422, "VALIDATION_ERROR", "Проверьте данные учебной структуры.", parsed.error.flatten().fieldErrors);
  }
  const prisma = getPrisma();

  try {
    return await prisma.$transaction(async (tx) => {
      let created: { id: string } & Record<string, unknown>;
      switch (resource) {
        case "academic-years": {
          const value = parsed.data as z.infer<typeof yearSchema>;
          if (value.isActive) await tx.academicYear.updateMany({ where: { isActive: true }, data: { isActive: false } });
          created = await tx.academicYear.create({ data: { ...value, startsOn: date(value.startsOn), endsOn: date(value.endsOn) } });
          break;
        }
        case "terms": {
          const value = parsed.data as z.infer<typeof termSchema>;
          const year = await tx.academicYear.findUnique({ where: { id: value.academicYearId } });
          if (!year) throw new ApiError(422, "ACADEMIC_YEAR_NOT_FOUND", "Учебный год не найден.");
          if (date(value.startsOn) < year.startsOn || date(value.endsOn) > year.endsOn) {
            throw new ApiError(422, "TERM_OUTSIDE_ACADEMIC_YEAR", "Даты семестра должны входить в выбранный учебный год.");
          }
          if (value.isActive) await tx.term.updateMany({ where: { academicYearId: value.academicYearId, isActive: true }, data: { isActive: false } });
          created = await tx.term.create({ data: { ...value, startsOn: date(value.startsOn), endsOn: date(value.endsOn) } });
          break;
        }
        case "specialties": {
          const value = parsed.data as z.infer<typeof specialtySchema>;
          created = await tx.specialty.create({ data: value });
          break;
        }
        case "groups": {
          const value = parsed.data as z.infer<typeof groupSchema>;
          const [year, specialty, curator] = await Promise.all([
            tx.academicYear.findUnique({ where: { id: value.academicYearId }, select: { id: true } }),
            tx.specialty.findUnique({ where: { id: value.specialtyId }, select: { id: true } }),
            value.curatorId ? tx.user.findUnique({ where: { id: value.curatorId }, select: { role: true, status: true } }) : null,
          ]);
          if (!year || !specialty) throw new ApiError(422, "GROUP_REFERENCE_NOT_FOUND", "Учебный год или специальность не найдены.");
          if (value.curatorId && (!curator || curator.role !== "TEACHER" || curator.status !== "ACTIVE")) {
            throw new ApiError(422, "INVALID_GROUP_CURATOR", "Куратором можно назначить только активного преподавателя.");
          }
          created = await tx.studyGroup.create({ data: value });
          break;
        }
        case "subjects": {
          const value = parsed.data as z.infer<typeof subjectSchema>;
          created = await tx.subject.create({ data: { ...value, credits: value.credits == null ? null : new Prisma.Decimal(value.credits) } });
          break;
        }
        case "courses": {
          const value = parsed.data as z.infer<typeof courseSchema>;
          const [year, term, specialty, subject] = await Promise.all([
            tx.academicYear.findUnique({ where: { id: value.academicYearId }, select: { id: true } }),
            tx.term.findUnique({ where: { id: value.termId }, select: { id: true, academicYearId: true } }),
            tx.specialty.findUnique({ where: { id: value.specialtyId }, select: { id: true, isActive: true } }),
            tx.subject.findUnique({ where: { id: value.subjectId }, select: { id: true, isActive: true } }),
          ]);
          if (!year || !term || term.academicYearId !== value.academicYearId) {
            throw new ApiError(422, "INVALID_COURSE_TERM", "Семестр должен относиться к выбранному учебному году.");
          }
          if (!specialty?.isActive || !subject?.isActive) {
            throw new ApiError(422, "INACTIVE_COURSE_REFERENCE", "Для курса выберите активные специальность и предмет.");
          }
          const { description, ...courseData } = value;
          created = await tx.course.create({
            data: {
              ...courseData,
              ...(description === undefined ? {} : { description: description === null ? Prisma.DbNull : description as Prisma.InputJsonValue }),
              createdById: actor.id,
            },
          });
          break;
        }
      }
      await audit(tx, actor, `${entityType(resource)}.created`, entityType(resource), created.id, undefined, created, request);
      return created;
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") throw new ApiError(409, "DUPLICATE_RECORD", "Запись с такими уникальными данными уже существует.");
      if (error.code === "P2003") throw new ApiError(422, "INVALID_REFERENCE", "Выбрана связанная запись, которая не найдена.");
    }
    throw error;
  }
}

export async function updateAcademicRecord(
  actor: Actor,
  resource: AcademicResource,
  recordId: string,
  body: unknown,
  request: Request,
) {
  const parsed = createSchemas[resource].partial().safeParse(body);
  if (!parsed.success || !Object.keys((parsed.success ? parsed.data : {}) as object).length) {
    throw new ApiError(422, "VALIDATION_ERROR", "Проверьте данные учебной структуры.", parsed.success ? undefined : parsed.error.flatten().fieldErrors);
  }
  const prisma = getPrisma();
  try {
    return await prisma.$transaction(async (tx) => {
      let existing: { id: string } & Record<string, unknown>;
      let updated: { id: string } & Record<string, unknown>;
      switch (resource) {
        case "academic-years": {
          const value = parsed.data as Partial<z.infer<typeof yearSchema>>;
          const row = await tx.academicYear.findUnique({ where: { id: recordId } });
          if (!row) throw new ApiError(404, "RECORD_NOT_FOUND", "Учебный год не найден.");
          existing = row;
          const startsOn = value.startsOn ? date(value.startsOn) : row.startsOn;
          const endsOn = value.endsOn ? date(value.endsOn) : row.endsOn;
          if (startsOn > endsOn) throw new ApiError(422, "INVALID_DATE_RANGE", "Дата окончания должна быть не раньше даты начала.");
          if (value.isActive) await tx.academicYear.updateMany({ where: { isActive: true, id: { not: recordId } }, data: { isActive: false } });
          updated = await tx.academicYear.update({ where: { id: recordId }, data: { ...value, ...(value.startsOn ? { startsOn } : {}), ...(value.endsOn ? { endsOn } : {}) } });
          break;
        }
        case "terms": {
          const value = parsed.data as Partial<z.infer<typeof termSchema>>;
          const row = await tx.term.findUnique({ where: { id: recordId }, include: { academicYear: true } });
          if (!row) throw new ApiError(404, "RECORD_NOT_FOUND", "Семестр не найден.");
          existing = row;
          const yearId = value.academicYearId ?? row.academicYearId;
          const year = await tx.academicYear.findUnique({ where: { id: yearId } });
          const startsOn = value.startsOn ? date(value.startsOn) : row.startsOn;
          const endsOn = value.endsOn ? date(value.endsOn) : row.endsOn;
          if (!year || startsOn > endsOn || startsOn < year.startsOn || endsOn > year.endsOn) {
            throw new ApiError(422, "TERM_OUTSIDE_ACADEMIC_YEAR", "Даты семестра должны входить в выбранный учебный год.");
          }
          if (value.isActive) await tx.term.updateMany({ where: { academicYearId: yearId, isActive: true, id: { not: recordId } }, data: { isActive: false } });
          updated = await tx.term.update({ where: { id: recordId }, data: { ...value, ...(value.startsOn ? { startsOn } : {}), ...(value.endsOn ? { endsOn } : {}) } });
          break;
        }
        case "specialties": {
          const row = await tx.specialty.findUnique({ where: { id: recordId } });
          if (!row) throw new ApiError(404, "RECORD_NOT_FOUND", "Специальность не найдена.");
          existing = row;
          updated = await tx.specialty.update({ where: { id: recordId }, data: parsed.data as Partial<z.infer<typeof specialtySchema>> });
          break;
        }
        case "groups": {
          const value = parsed.data as Partial<z.infer<typeof groupSchema>>;
          const row = await tx.studyGroup.findUnique({ where: { id: recordId } });
          if (!row) throw new ApiError(404, "RECORD_NOT_FOUND", "Группа не найдена.");
          existing = row;
          if (value.curatorId) {
            const curator = await tx.user.findUnique({ where: { id: value.curatorId }, select: { role: true, status: true } });
            if (!curator || curator.role !== "TEACHER" || curator.status !== "ACTIVE") throw new ApiError(422, "INVALID_GROUP_CURATOR", "Куратором можно назначить только активного преподавателя.");
          }
          updated = await tx.studyGroup.update({ where: { id: recordId }, data: value });
          break;
        }
        case "subjects": {
          const value = parsed.data as Partial<z.infer<typeof subjectSchema>>;
          const row = await tx.subject.findUnique({ where: { id: recordId } });
          if (!row) throw new ApiError(404, "RECORD_NOT_FOUND", "Предмет не найден.");
          existing = row;
          updated = await tx.subject.update({ where: { id: recordId }, data: { ...value, ...(value.credits === undefined ? {} : { credits: value.credits === null ? null : new Prisma.Decimal(value.credits) }) } });
          break;
        }
        case "courses": {
          const value = parsed.data as Partial<z.infer<typeof courseSchema>>;
          const row = await tx.course.findUnique({ where: { id: recordId } });
          if (!row || row.deletedAt) throw new ApiError(404, "RECORD_NOT_FOUND", "Курс не найден.");
          existing = row;
          const yearId = value.academicYearId ?? row.academicYearId;
          const termId = value.termId ?? row.termId;
          if (value.academicYearId || value.termId) {
            const term = await tx.term.findUnique({ where: { id: termId }, select: { academicYearId: true } });
            if (!term || term.academicYearId !== yearId) throw new ApiError(422, "INVALID_COURSE_TERM", "Семестр должен относиться к выбранному учебному году.");
          }
          if (value.subjectId) {
            const subject = await tx.subject.findUnique({ where: { id: value.subjectId }, select: { isActive: true } });
            if (!subject?.isActive) throw new ApiError(422, "INACTIVE_COURSE_REFERENCE", "Для курса выберите активный предмет.");
          }
          if (value.specialtyId) {
            const specialty = await tx.specialty.findUnique({ where: { id: value.specialtyId }, select: { isActive: true } });
            if (!specialty?.isActive) throw new ApiError(422, "INACTIVE_COURSE_REFERENCE", "Для курса выберите активную специальность.");
          }
          const { description, ...courseData } = value;
          updated = await tx.course.update({
            where: { id: recordId },
            data: {
              ...courseData,
              ...(description === undefined ? {} : { description: description === null ? Prisma.DbNull : description as Prisma.InputJsonValue }),
              updatedById: actor.id,
            },
          });
          break;
        }
      }
      await audit(tx, actor, `${entityType(resource)}.updated`, entityType(resource), recordId, existing, updated, request);
      return updated;
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") throw new ApiError(409, "DUPLICATE_RECORD", "Запись с такими уникальными данными уже существует.");
      if (error.code === "P2003") throw new ApiError(422, "INVALID_REFERENCE", "Выбрана связанная запись, которая не найдена.");
    }
    throw error;
  }
}

export async function deactivateAcademicRecord(
  actor: Actor,
  resource: AcademicResource,
  recordId: string,
  request: Request,
) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    let before: { id: string } & Record<string, unknown>;
    let after: { id: string } & Record<string, unknown>;
    switch (resource) {
      case "academic-years": {
        const row = await tx.academicYear.findUnique({ where: { id: recordId } });
        if (!row) throw new ApiError(404, "RECORD_NOT_FOUND", "Учебный год не найден.");
        before = row;
        after = await tx.academicYear.update({ where: { id: recordId }, data: { isActive: false } });
        break;
      }
      case "terms": {
        const row = await tx.term.findUnique({ where: { id: recordId } });
        if (!row) throw new ApiError(404, "RECORD_NOT_FOUND", "Семестр не найден.");
        before = row;
        after = await tx.term.update({ where: { id: recordId }, data: { isActive: false } });
        break;
      }
      case "specialties": {
        const row = await tx.specialty.findUnique({ where: { id: recordId } });
        if (!row) throw new ApiError(404, "RECORD_NOT_FOUND", "Специальность не найдена.");
        before = row;
        after = await tx.specialty.update({ where: { id: recordId }, data: { isActive: false } });
        break;
      }
      case "groups": {
        const row = await tx.studyGroup.findUnique({ where: { id: recordId } });
        if (!row) throw new ApiError(404, "RECORD_NOT_FOUND", "Группа не найдена.");
        before = row;
        after = await tx.studyGroup.update({ where: { id: recordId }, data: { isActive: false } });
        break;
      }
      case "subjects": {
        const row = await tx.subject.findUnique({ where: { id: recordId } });
        if (!row) throw new ApiError(404, "RECORD_NOT_FOUND", "Предмет не найден.");
        before = row;
        after = await tx.subject.update({ where: { id: recordId }, data: { isActive: false } });
        break;
      }
      case "courses": {
        const row = await tx.course.findUnique({ where: { id: recordId } });
        if (!row || row.deletedAt) throw new ApiError(404, "RECORD_NOT_FOUND", "Курс не найден.");
        before = row;
        after = await tx.course.update({ where: { id: recordId }, data: { status: "ARCHIVED", deletedAt: new Date(), updatedById: actor.id } });
        break;
      }
    }
    await audit(tx, actor, `${entityType(resource)}.archived`, entityType(resource), recordId, before, after, request);
    return after;
  });
}
