import { Prisma } from "../../../generated/prisma/client";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { getServerEnv } from "@/lib/env";
import { ApiError } from "@/lib/http/api-error";
import type { Actor } from "@/server/auth/session";
import { assertCourseManageable } from "@/server/services/course-content";

const idSchema = z.uuid();
const createSchema = z.object({
  scope: z.enum(["GLOBAL", "COURSE", "GROUP"]),
  courseId: z.uuid().nullable().optional(),
  groupId: z.uuid().nullable().optional(),
  courseIds: z.array(z.uuid()).max(100).optional(),
  groupIds: z.array(z.uuid()).max(100).optional(),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20000),
  publish: z.boolean().default(true),
  expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
const updateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(20000).optional(),
  publish: z.boolean().optional(),
  expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
});

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Проверьте поля формы.",
      result.error.flatten().fieldErrors,
    );
  return result.data;
}

function requireAdmin(actor: Actor) {
  if (actor.role !== "SUPER_ADMIN" && actor.role !== "ADMIN")
    throw new ApiError(403, "FORBIDDEN", "Это действие доступно администраторам.");
}

export function parseAnnouncementId(value: string) {
  const result = idSchema.safeParse(value);
  if (!result.success) throw new ApiError(404, "ANNOUNCEMENT_NOT_FOUND", "Объявление не найдено.");
  return result.data;
}

function auditJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function audit(
  tx: Prisma.TransactionClient,
  actor: Actor,
  action: string,
  entityId: string,
  before: unknown,
  after: unknown,
  request: Request,
) {
  await tx.auditLog.create({
    data: {
      actorId: actor.id,
      action,
      entityType: "Announcement",
      entityId,
      beforeJson: before === undefined ? Prisma.JsonNull : auditJson(before),
      afterJson: after === undefined ? Prisma.JsonNull : auditJson(after),
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent"),
    },
  });
}

export async function getAnnouncementOptions(actor: Actor) {
  if (
    actor.role !== "ADMIN" &&
    actor.role !== "SUPER_ADMIN" &&
    actor.role !== "TEACHER" &&
    actor.role !== "STUDENT"
  )
    throw new ApiError(403, "FORBIDDEN", "Недостаточно прав.");
  const isStudent = actor.role === "STUDENT";
  const [courses, groups] = await Promise.all([
    isStudent
      ? Promise.resolve([])
      : getPrisma().course.findMany({
          where: {
            deletedAt: null,
            status: { not: "ARCHIVED" },
            ...(actor.role === "TEACHER"
              ? {
                  OR: [
                    { teacherAssignments: { some: { teacherId: actor.id } } },
                    { enrollments: { some: { status: "ACTIVE", group: { curatorId: actor.id } } } },
                  ],
                }
              : {}),
          },
          orderBy: { title: "asc" },
          select: { id: true, title: true },
        }),
    getPrisma().studyGroup.findMany({
      where: {
        isActive: true,
        ...(actor.role === "TEACHER"
          ? {
              OR: [
                { curatorId: actor.id },
                {
                  enrollments: {
                    some: {
                      status: "ACTIVE",
                      course: { teacherAssignments: { some: { teacherId: actor.id } } },
                    },
                  },
                },
              ],
            }
          : {}),
        ...(isStudent
          ? {
              memberships: {
                some: { studentId: actor.id, leftAt: null, isGroupLeader: true },
              },
            }
          : {}),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  return {
    courses,
    groups,
    canPublishGlobal: actor.role === "ADMIN" || actor.role === "SUPER_ADMIN",
  };
}

async function assertTeacherCanAddressGroup(
  actor: Actor,
  groupId: string,
  courseId: string | null,
) {
  if (actor.role !== "TEACHER")
    throw new ApiError(403, "FORBIDDEN", "Недостаточно прав для объявления группы.");
  const group = await getPrisma().studyGroup.findFirst({
    where: { id: groupId, isActive: true },
    select: { id: true, academicYearId: true, curatorId: true },
  });
  if (!group) throw new ApiError(422, "INVALID_ANNOUNCEMENT_AUDIENCE", "Выберите активную группу.");
  const isCurator = group.curatorId === actor.id;
  const teacherHasGroup =
    isCurator ||
    (await getPrisma()
      .enrollment.findFirst({
        where: {
          groupId,
          status: "ACTIVE",
          ...(courseId ? { courseId } : {}),
          course: { teacherAssignments: { some: { teacherId: actor.id } } },
        },
        select: { id: true },
      })
      .then(Boolean));
  if (!teacherHasGroup) {
    throw new ApiError(
      403,
      "GROUP_ANNOUNCEMENT_FORBIDDEN",
      "Можно публиковать объявления только для группы, где вы преподаёте или являетесь куратором.",
    );
  }
  if (courseId) {
    const course = await getPrisma().course.findFirst({
      where: {
        id: courseId,
        deletedAt: null,
        enrollments: { some: { groupId, status: "ACTIVE" } },
      },
      select: {
        id: true,
        academicYearId: true,
        teacherAssignments: { where: { teacherId: actor.id }, select: { id: true } },
      },
    });
    if (
      !course ||
      course.academicYearId !== group.academicYearId ||
      (!isCurator && !course.teacherAssignments.length)
    ) {
      throw new ApiError(
        422,
        "INVALID_ANNOUNCEMENT_AUDIENCE",
        "Выберите предмет этой группы, доступный вам.",
      );
    }
  }
  return group;
}

async function assertStudentLeaderCanAddressGroup(
  actor: Actor,
  groupId: string,
  courseId: string | null,
) {
  if (actor.role !== "STUDENT" || courseId) {
    throw new ApiError(
      403,
      "GROUP_ANNOUNCEMENT_FORBIDDEN",
      "Староста может публиковать объявления для своей группы целиком.",
    );
  }
  const membership = await getPrisma().groupMember.findFirst({
    where: {
      groupId,
      studentId: actor.id,
      leftAt: null,
      isGroupLeader: true,
      group: { isActive: true },
    },
    select: { group: { select: { id: true, name: true, academicYearId: true } } },
  });
  if (!membership) {
    throw new ApiError(
      403,
      "GROUP_ANNOUNCEMENT_FORBIDDEN",
      "Объявления для группы может публиковать только её староста.",
    );
  }
  return membership.group;
}

async function recipientIds(
  tx: Prisma.TransactionClient,
  announcement: {
    scope: "GLOBAL" | "COURSE" | "GROUP";
    courseId: string | null;
    groupId: string | null;
    courseTargets: Array<{ courseId: string }>;
    groupTargets: Array<{ groupId: string }>;
  },
  actorId: string,
) {
  const courseIds = [
    ...new Set([
      ...announcement.courseTargets.map((target) => target.courseId),
      ...(announcement.courseId ? [announcement.courseId] : []),
    ]),
  ];
  const groupIds = [
    ...new Set([
      ...announcement.groupTargets.map((target) => target.groupId),
      ...(announcement.groupId ? [announcement.groupId] : []),
    ]),
  ];
  let ids: string[] = [];
  if (announcement.scope === "GLOBAL") {
    const users = await tx.user.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      select: { id: true },
    });
    ids = users.map((user) => user.id);
  } else if (announcement.scope === "COURSE" && courseIds.length) {
    const [enrollments, teachers] = await Promise.all([
      tx.enrollment.findMany({
        where: {
          courseId: { in: courseIds },
          status: "ACTIVE",
          student: { status: "ACTIVE", deletedAt: null },
        },
        select: { studentId: true },
      }),
      tx.courseTeacher.findMany({
        where: {
          courseId: { in: courseIds },
          teacher: { status: "ACTIVE", deletedAt: null },
        },
        select: { teacherId: true },
      }),
    ]);
    ids = [...enrollments.map((item) => item.studentId), ...teachers.map((item) => item.teacherId)];
  } else if (announcement.scope === "GROUP" && groupIds.length) {
    const members = await tx.groupMember.findMany({
      where: {
        groupId: { in: groupIds },
        leftAt: null,
        student: {
          status: "ACTIVE",
          deletedAt: null,
          ...(announcement.courseId
            ? {
                enrollments: {
                  some: {
                    courseId: announcement.courseId,
                    groupId: { in: groupIds },
                    status: "ACTIVE",
                  },
                },
              }
            : {}),
        },
      },
      select: { studentId: true },
    });
    ids = members.map((item) => item.studentId);
  }
  return [...new Set(ids)].filter((id) => id !== actorId);
}

async function notifyAudience(
  tx: Prisma.TransactionClient,
  actor: Actor,
  announcement: {
    id: string;
    scope: "GLOBAL" | "COURSE" | "GROUP";
    courseId: string | null;
    groupId: string | null;
    courseTargets: Array<{ courseId: string }>;
    groupTargets: Array<{ groupId: string }>;
    title: string;
    body: string;
  },
) {
  const recipients = await recipientIds(tx, announcement, actor.id);
  if (!recipients.length) return;
  await tx.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      type: "ANNOUNCEMENT",
      title: announcement.title,
      body: announcement.body.slice(0, 500),
      link: "/announcements",
      dataJson: { announcementId: announcement.id },
      dedupeKey: `announcement:${announcement.id}`,
    })),
    skipDuplicates: true,
  });

  const env = getServerEnv();
  if (!env.SMTP_HOST || !env.SMTP_FROM) return;

  const users = await tx.user.findMany({
    where: { id: { in: recipients }, status: "ACTIVE", deletedAt: null },
    select: { id: true, email: true },
  });
  const subjectTitle = announcement.title.replace(/[\r\n]+/g, " ").slice(0, 200);
  const emailBody = [
    subjectTitle,
    "",
    announcement.body.slice(0, 20_000),
    "",
    `Открыть объявление: ${env.APP_URL}/announcements`,
  ].join("\n");

  await tx.emailOutbox.createMany({
    data: users.map((user) => ({
      toEmail: user.email,
      subject: `Хекслет Колледжі: ${subjectTitle}`.slice(0, 998),
      body: emailBody,
      dedupeKey: `announcement:${announcement.id}:user:${user.id}`,
    })),
    skipDuplicates: true,
  });
}

export async function listAnnouncements(actor: Actor) {
  const now = new Date();
  const admin = actor.role === "SUPER_ADMIN" || actor.role === "ADMIN";
  const audience: Prisma.AnnouncementWhereInput =
    actor.role === "SUPER_ADMIN" || actor.role === "ADMIN"
      ? {}
      : actor.role === "STUDENT"
        ? {
            OR: [
              { scope: "GLOBAL" },
              {
                scope: "COURSE",
                OR: [
                  {
                    course: {
                      enrollments: { some: { studentId: actor.id, status: "ACTIVE" } },
                    },
                  },
                  {
                    courseTargets: {
                      some: {
                        course: {
                          enrollments: { some: { studentId: actor.id, status: "ACTIVE" } },
                        },
                      },
                    },
                  },
                ],
              },
              {
                scope: "GROUP",
                AND: [
                  {
                    OR: [
                      {
                        group: {
                          memberships: { some: { studentId: actor.id, leftAt: null } },
                        },
                      },
                      {
                        groupTargets: {
                          some: {
                            group: {
                              memberships: { some: { studentId: actor.id, leftAt: null } },
                            },
                          },
                        },
                      },
                    ],
                  },
                  {
                    OR: [
                      { courseId: null },
                      { course: { enrollments: { some: { studentId: actor.id, status: "ACTIVE" } } } },
                    ],
                  },
                ],
              },
            ],
          }
        : {
            OR: [
              { scope: "GLOBAL" },
              {
                scope: "COURSE",
                OR: [
                  { course: { teacherAssignments: { some: { teacherId: actor.id } } } },
                  {
                    courseTargets: {
                      some: { course: { teacherAssignments: { some: { teacherId: actor.id } } } },
                    },
                  },
                ],
              },
              {
                scope: "GROUP",
                OR: [
                  {
                    group: {
                      OR: [
                        { curatorId: actor.id },
                        {
                          enrollments: {
                            some: {
                              status: "ACTIVE",
                              course: { teacherAssignments: { some: { teacherId: actor.id } } },
                            },
                          },
                        },
                      ],
                    },
                  },
                  {
                    groupTargets: {
                      some: {
                        group: {
                          OR: [
                            { curatorId: actor.id },
                            {
                              enrollments: {
                                some: {
                                  status: "ACTIVE",
                                  course: { teacherAssignments: { some: { teacherId: actor.id } } },
                                },
                              },
                            },
                          ],
                        },
                      },
                    },
                  },
                ],
              },
            ],
          };
  return getPrisma().announcement.findMany({
    where: {
      deletedAt: null,
      ...(admin
        ? {}
        : {
            OR: [
              {
                AND: [
                  { publishedAt: { not: null, lte: now } },
                  { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
                  audience,
                ],
              },
              { publishedAt: null, createdById: actor.id },
            ],
          }),
    },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: 100,
    include: {
      createdBy: { select: { id: true, name: true } },
      course: { select: { id: true, title: true, slug: true } },
      group: { select: { id: true, name: true } },
      courseTargets: { include: { course: { select: { id: true, title: true, slug: true } } } },
      groupTargets: { include: { group: { select: { id: true, name: true } } } },
    },
  });
}

export async function createAnnouncement(actor: Actor, body: unknown, request: Request) {
  const value = parse(createSchema, body);
  const courseIds = [
    ...new Set([...(value.courseIds ?? []), ...(value.courseId ? [value.courseId] : [])]),
  ];
  const groupIds = [
    ...new Set([...(value.groupIds ?? []), ...(value.groupId ? [value.groupId] : [])]),
  ];
  let courseId: string | null = null;
  let groupId: string | null = null;
  let courseTargetIds: string[] = [];
  let groupTargetIds: string[] = [];
  if (value.scope === "GLOBAL") {
    requireAdmin(actor);
    if (courseIds.length || groupIds.length)
      throw new ApiError(
        422,
        "INVALID_ANNOUNCEMENT_AUDIENCE",
        "Общее объявление не должно ссылаться на курс или группу.",
      );
  } else if (value.scope === "COURSE") {
    if (!courseIds.length || groupIds.length)
      throw new ApiError(
        422,
        "INVALID_ANNOUNCEMENT_AUDIENCE",
        "Для объявления выберите хотя бы один курс.",
      );
    await Promise.all(courseIds.map((targetCourseId) => assertCourseManageable(actor, targetCourseId)));
    courseTargetIds = courseIds;
    courseId = courseIds.length === 1 ? courseIds[0] : null;
  } else {
    if (!groupIds.length || (value.courseIds?.length ?? 0) > 0)
      throw new ApiError(
        422,
        "INVALID_ANNOUNCEMENT_AUDIENCE",
        "Для объявления выберите хотя бы одну группу.",
      );
    const groups = await getPrisma().studyGroup.findMany({
      where: { id: { in: groupIds }, isActive: true },
      select: { id: true, academicYearId: true },
    });
    if (groups.length !== groupIds.length)
      throw new ApiError(422, "INVALID_ANNOUNCEMENT_AUDIENCE", "Выберите активную группу.");
    if (actor.role === "TEACHER") {
      await Promise.all(groupIds.map((targetGroupId) => assertTeacherCanAddressGroup(actor, targetGroupId, value.courseId ?? null)));
    } else if (actor.role === "STUDENT") {
      await Promise.all(groupIds.map((targetGroupId) => assertStudentLeaderCanAddressGroup(actor, targetGroupId, value.courseId ?? null)));
    } else if (actor.role !== "ADMIN" && actor.role !== "SUPER_ADMIN") {
      throw new ApiError(
        403,
        "GROUP_ANNOUNCEMENT_FORBIDDEN",
        "Недостаточно прав для объявления группы.",
      );
    }
    if (value.courseId) {
      const course = await getPrisma().course.findFirst({
        where: { id: value.courseId, deletedAt: null },
        select: { academicYearId: true },
      });
      if (!course || groups.some((group) => course.academicYearId !== group.academicYearId))
        throw new ApiError(
          422,
          "INVALID_ANNOUNCEMENT_AUDIENCE",
          "Курс должен относиться к учебному году выбранных групп.",
        );
    }
    courseId = value.courseId ?? null;
    groupTargetIds = groupIds;
    groupId = groupIds.length === 1 ? groupIds[0] : null;
  }
  const expiresAt = value.expiresAt ? new Date(value.expiresAt) : null;
  const publishedAt = value.publish ? new Date() : null;
  if (expiresAt && publishedAt && expiresAt <= publishedAt)
    throw new ApiError(422, "INVALID_EXPIRY", "Дата окончания показа должна быть в будущем.");
  return getPrisma().$transaction(async (tx) => {
    const announcement = await tx.announcement.create({
      data: {
        scope: value.scope,
        courseId,
        groupId,
        title: value.title,
        body: value.body,
        publishedAt,
        expiresAt,
        createdById: actor.id,
        ...(courseTargetIds.length
          ? {
              courseTargets: {
                create: courseTargetIds.map((targetCourseId) => ({
                  course: { connect: { id: targetCourseId } },
                })),
              },
            }
          : {}),
        ...(groupTargetIds.length
          ? {
              groupTargets: {
                create: groupTargetIds.map((targetGroupId) => ({
                  group: { connect: { id: targetGroupId } },
                })),
              },
            }
          : {}),
      },
      include: {
        courseTargets: { select: { courseId: true } },
        groupTargets: { select: { groupId: true } },
      },
    });
    if (publishedAt) await notifyAudience(tx, actor, announcement);
    await audit(
      tx,
      actor,
      "announcement.created",
      announcement.id,
      undefined,
      {
        scope: announcement.scope,
        title: announcement.title,
        publishedAt: announcement.publishedAt?.toISOString() ?? null,
        courseIds: courseTargetIds,
        groupIds: groupTargetIds,
      },
      request,
    );
    return announcement;
  });
}

async function getManageableAnnouncement(actor: Actor, id: string) {
  const announcement = await getPrisma().announcement.findFirst({
    where: { id, deletedAt: null },
    include: {
      courseTargets: { select: { courseId: true } },
      groupTargets: { select: { groupId: true } },
    },
  });
  if (!announcement) throw new ApiError(404, "ANNOUNCEMENT_NOT_FOUND", "Объявление не найдено.");
  if (announcement.scope === "GLOBAL") requireAdmin(actor);
  if (announcement.scope === "GROUP") {
    if (actor.role === "ADMIN" || actor.role === "SUPER_ADMIN") return announcement;
    const groupIds = [
      ...new Set([
        ...announcement.groupTargets.map((target) => target.groupId),
        ...(announcement.groupId ? [announcement.groupId] : []),
      ]),
    ];
    if (announcement.createdById !== actor.id || !groupIds.length) {
      throw new ApiError(
        403,
        "FORBIDDEN",
        "Можно изменять только свои объявления доступной группы.",
      );
    }
    if (actor.role === "TEACHER") {
      await Promise.all(
        groupIds.map((groupId) =>
          assertTeacherCanAddressGroup(actor, groupId, announcement.courseId),
        ),
      );
    } else if (actor.role === "STUDENT") {
      await Promise.all(
        groupIds.map((groupId) =>
          assertStudentLeaderCanAddressGroup(actor, groupId, announcement.courseId),
        ),
      );
    } else {
      throw new ApiError(403, "FORBIDDEN", "Недостаточно прав для изменения объявления группы.");
    }
  }
  if (announcement.scope === "COURSE") {
    const courseIds = [
      ...new Set([
        ...announcement.courseTargets.map((target) => target.courseId),
        ...(announcement.courseId ? [announcement.courseId] : []),
      ]),
    ];
    if (actor.role !== "ADMIN" && actor.role !== "SUPER_ADMIN") {
      if (!courseIds.length)
        throw new ApiError(403, "FORBIDDEN", "У объявления не найдены доступные курсы.");
      await Promise.all(courseIds.map((courseId) => assertCourseManageable(actor, courseId)));
    }
  }
  return announcement;
}

export async function updateAnnouncement(
  actor: Actor,
  id: string,
  body: unknown,
  request: Request,
) {
  const existing = await getManageableAnnouncement(actor, id);
  const value = parse(updateSchema, body);
  if (!Object.keys(value).length)
    throw new ApiError(422, "EMPTY_UPDATE", "Укажите поля для изменения.");
  const publishedAt =
    value.publish === undefined
      ? existing.publishedAt
      : value.publish
        ? (existing.publishedAt ?? new Date())
        : null;
  const expiresAt =
    value.expiresAt === undefined
      ? existing.expiresAt
      : value.expiresAt
        ? new Date(value.expiresAt)
        : null;
  if (publishedAt && expiresAt && expiresAt <= publishedAt)
    throw new ApiError(
      422,
      "INVALID_EXPIRY",
      "Дата окончания показа должна быть позже даты публикации.",
    );
  return getPrisma().$transaction(async (tx) => {
    const updated = await tx.announcement.update({
      where: { id },
      data: {
        ...(value.title !== undefined ? { title: value.title } : {}),
        ...(value.body !== undefined ? { body: value.body } : {}),
        publishedAt,
        expiresAt,
      },
      include: {
        courseTargets: { select: { courseId: true } },
        groupTargets: { select: { groupId: true } },
      },
    });
    if (!existing.publishedAt && updated.publishedAt) await notifyAudience(tx, actor, updated);
    await audit(
      tx,
      actor,
      "announcement.updated",
      id,
      { title: existing.title, publishedAt: existing.publishedAt?.toISOString() ?? null },
      { title: updated.title, publishedAt: updated.publishedAt?.toISOString() ?? null },
      request,
    );
    return updated;
  });
}

export async function archiveAnnouncement(actor: Actor, id: string, request: Request) {
  const existing = await getManageableAnnouncement(actor, id);
  return getPrisma().$transaction(async (tx) => {
    const updated = await tx.announcement.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await audit(
      tx,
      actor,
      "announcement.archived",
      id,
      { title: existing.title },
      { deletedAt: updated.deletedAt?.toISOString() },
      request,
    );
    return { id, archived: true };
  });
}

export async function listMyNotifications(actor: Actor) {
  const prisma = getPrisma();
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: actor.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.notification.count({ where: { userId: actor.id, readAt: null } }),
  ]);
  return { items, unread };
}

export async function markNotificationRead(actor: Actor, id: string) {
  const result = await getPrisma().notification.updateMany({
    where: { id, userId: actor.id, readAt: null },
    data: { readAt: new Date() },
  });
  if (!result.count) {
    const exists = await getPrisma().notification.findFirst({
      where: { id, userId: actor.id },
      select: { id: true },
    });
    if (!exists) throw new ApiError(404, "NOTIFICATION_NOT_FOUND", "Уведомление не найдено.");
  }
  return { id, read: true };
}

export async function markAllNotificationsRead(actor: Actor) {
  const result = await getPrisma().notification.updateMany({
    where: { userId: actor.id, readAt: null },
    data: { readAt: new Date() },
  });
  return { updated: result.count };
}
