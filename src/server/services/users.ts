import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "@/lib/auth/password";
import { getPrisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/http/api-error";
import type { Prisma } from "../../../generated/prisma/client";
import {
  assertCanAssignRole,
  assertCanCreateUser,
  assertCanManageUser,
  type UserRole,
  type UserStatus,
} from "@/server/policies/users";
import type { Actor } from "@/server/auth/session";

const prisma = getPrisma();

export interface CreateUserInput {
  email: string;
  username: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  middleName?: string;
  phone?: string;
  locale: "ru" | "kk" | "en";
}

export interface UpdateUserInput {
  email?: string;
  firstName?: string;
  lastName?: string;
  middleName?: string | null;
  phone?: string | null;
  locale?: "ru" | "kk" | "en";
  role?: UserRole;
  status?: UserStatus;
  curatedGroupIds?: string[];
  studentGroupId?: string | null;
  isGroupLeader?: boolean;
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  username: string | null;
  role: UserRole;
  status: UserStatus;
  firstName: string;
  lastName: string;
  middleName: string | null;
  phone: string | null;
  locale: string;
  mustChangePassword: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
}

function makeName(user: Pick<CreateUserInput, "firstName" | "lastName" | "middleName">): string {
  return [user.firstName, user.middleName, user.lastName].filter(Boolean).join(" ");
}

function safeUser(user: UserSummary): UserSummary {
  return user;
}

function auditSnapshot(user: UserSummary) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username,
    role: user.role,
    status: user.status,
    locale: user.locale,
  };
}

function userAgent(request: Request): string | undefined {
  return request.headers.get("user-agent")?.slice(0, 1000) || undefined;
}

function temporaryPassword(): string {
  return randomBytes(24).toString("base64url");
}

export async function createUser(
  actor: Actor,
  input: CreateUserInput,
  request: Request,
): Promise<{ user: UserSummary; temporaryPassword: string }> {
  assertCanCreateUser(actor.role, input.role);
  const email = input.email.trim().toLowerCase();
  const username = input.username.trim().toLowerCase();
  const password = temporaryPassword();
  const passwordHash = await hashPassword(password);
  const userId = randomUUID();

  try {
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          id: userId,
          name: makeName(input),
          email,
          normalizedEmail: email,
          emailVerified: false,
          username,
          displayUsername: input.username.trim(),
          role: input.role,
          status: "ACTIVE",
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          middleName: input.middleName?.trim() || null,
          phone: input.phone?.trim() || null,
          locale: input.locale,
          mustChangePassword: true,
          accounts: {
            create: {
              accountId: userId,
              providerId: "credential",
              password: passwordHash,
            },
          },
        },
      });

      const summary = safeUser(created);
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "user.created",
          entityType: "user",
          entityId: created.id,
          afterJson: auditSnapshot(summary),
          userAgent: userAgent(request),
        },
      });
      return summary;
    });

    return { user, temporaryPassword: password };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      throw new ApiError(
        409,
        "USER_ALREADY_EXISTS",
        "Пользователь с таким email или логином уже существует.",
      );
    }
    throw error;
  }
}

async function lockActiveSuperAdmins(tx: Prisma.TransactionClient) {
  return tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "users"
    WHERE "role" = 'SUPER_ADMIN'::"UserRole"
      AND "status" = 'ACTIVE'::"UserStatus"
      AND "deleted_at" IS NULL
    ORDER BY "id"
    FOR UPDATE
  `;
}

export async function updateUser(
  actor: Actor,
  userId: string,
  input: UpdateUserInput,
  request: Request,
): Promise<UserSummary> {
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { id: userId } });
      if (!existing || (existing.deletedAt && existing.status !== "ARCHIVED")) {
        throw new ApiError(404, "USER_NOT_FOUND", "Пользователь не найден.");
      }
      assertCanManageUser(actor.role, existing.role);

      const nextStatus = input.status ?? existing.status;
      const nextRole = input.role ?? existing.role;
      const requestedCuratorIds = input.curatedGroupIds;
      if (requestedCuratorIds && new Set(requestedCuratorIds).size !== requestedCuratorIds.length) {
        throw new ApiError(422, "DUPLICATE_CURATOR_GROUP", "Одна группа указана несколько раз.");
      }
      if (requestedCuratorIds?.length && nextRole !== "TEACHER") {
        throw new ApiError(
          422,
          "INVALID_CURATOR_ROLE",
          "Куратором можно назначить только преподавателя.",
        );
      }
      if (requestedCuratorIds?.length && nextStatus !== "ACTIVE") {
        throw new ApiError(
          422,
          "INACTIVE_CURATOR",
          "Для назначения куратором аккаунт должен быть активным.",
        );
      }

      if (input.role !== undefined && input.role !== existing.role) {
        assertCanAssignRole(actor.role, input.role);
        if (existing.role === "TEACHER" && input.role !== "TEACHER") {
          const [curatedGroups, teacherAssignments] = await Promise.all([
            requestedCuratorIds === undefined
              ? tx.studyGroup.count({ where: { curatorId: existing.id } })
              : Promise.resolve(requestedCuratorIds.length),
            tx.courseTeacher.count({ where: { teacherId: existing.id } }),
          ]);
          if (curatedGroups || teacherAssignments) {
            throw new ApiError(
              409,
              "TEACHER_ASSIGNMENTS_EXIST",
              "Сначала снимите назначения преподавателя с групп и курсов, затем измените роль.",
            );
          }
        }
        if (existing.role === "STUDENT" && input.role !== "STUDENT") {
          const [memberships, enrollments] = await Promise.all([
            tx.groupMember.count({ where: { studentId: existing.id, leftAt: null } }),
            tx.enrollment.count({ where: { studentId: existing.id, status: "ACTIVE" } }),
          ]);
          if ((memberships && input.studentGroupId !== null) || enrollments) {
            throw new ApiError(
              409,
              "STUDENT_ENROLLMENTS_EXIST",
              "Сначала снимите студента с группы и завершите активные зачисления, затем измените роль.",
            );
          }
        }
        if (actor.role !== "SUPER_ADMIN" && input.role !== "STUDENT" && input.role !== "TEACHER") {
          throw new ApiError(
            403,
            "FORBIDDEN",
            "Администратор может назначать роли студента и преподавателя; системные роли доступны главному администратору.",
          );
        }
      }

      let curatorGroupsBefore: string[] | undefined;
      if (requestedCuratorIds !== undefined) {
        curatorGroupsBefore = (
          await tx.studyGroup.findMany({
            where: { curatorId: existing.id },
            select: { id: true },
            orderBy: { id: "asc" },
          })
        ).map((group) => group.id);
        const groups = requestedCuratorIds.length
          ? await tx.studyGroup.findMany({
              where: { id: { in: requestedCuratorIds }, isActive: true },
              select: { id: true, curatorId: true },
            })
          : [];
        if (groups.length !== requestedCuratorIds.length) {
          throw new ApiError(
            422,
            "INVALID_CURATOR_GROUP",
            "Выбрана неактивная или несуществующая группа.",
          );
        }
        if (groups.some((group) => group.curatorId && group.curatorId !== existing.id)) {
          throw new ApiError(
            409,
            "GROUP_ALREADY_HAS_CURATOR",
            "В одной из выбранных групп уже назначен другой куратор. Сначала снимите его назначение.",
          );
        }
        await tx.studyGroup.updateMany({
          where: {
            curatorId: existing.id,
            ...(requestedCuratorIds.length ? { id: { notIn: requestedCuratorIds } } : {}),
          },
          data: { curatorId: null },
        });
        if (requestedCuratorIds.length) {
          await tx.studyGroup.updateMany({
            where: { id: { in: requestedCuratorIds } },
            data: { curatorId: existing.id },
          });
        }
        const nextIds = [...requestedCuratorIds].sort();
        const previousIds = [...curatorGroupsBefore].sort();
        if (nextIds.join("|") !== previousIds.join("|")) {
          await tx.auditLog.create({
            data: {
              actorId: actor.id,
              action: "user.curator_groups_updated",
              entityType: "user",
              entityId: existing.id,
              beforeJson: { groupIds: previousIds },
              afterJson: { groupIds: nextIds },
              userAgent: userAgent(request),
            },
          });
        }
      }

      if (input.studentGroupId !== undefined || input.isGroupLeader !== undefined) {
        if (nextRole !== "STUDENT" && (input.studentGroupId || input.isGroupLeader)) {
          throw new ApiError(
            422,
            "INVALID_STUDENT_GROUP_ROLE",
            "Группу и старосту можно назначить только студенту.",
          );
        }
        if (input.isGroupLeader && nextStatus !== "ACTIVE") {
          throw new ApiError(
            422,
            "INACTIVE_GROUP_LEADER",
            "Для назначения старостой аккаунт должен быть активным.",
          );
        }
        const membership = await tx.groupMember.findFirst({
          where: { studentId: existing.id, leftAt: null },
          select: {
            id: true,
            groupId: true,
            isGroupLeader: true,
            group: { select: { name: true } },
          },
        });
        const targetGroupId =
          input.studentGroupId === undefined ? (membership?.groupId ?? null) : input.studentGroupId;
        if (targetGroupId && nextRole !== "STUDENT") {
          throw new ApiError(
            422,
            "INVALID_STUDENT_GROUP_ROLE",
            "Группу можно назначить только студенту.",
          );
        }
        const targetGroup = targetGroupId
          ? await tx.studyGroup.findFirst({
              where: { id: targetGroupId, isActive: true },
              select: { id: true, name: true },
            })
          : null;
        if (targetGroupId && !targetGroup) {
          throw new ApiError(
            422,
            "INVALID_STUDENT_GROUP",
            "Выбрана неактивная или несуществующая группа.",
          );
        }
        if (!targetGroupId && input.isGroupLeader) {
          throw new ApiError(409, "STUDENT_HAS_NO_GROUP", "Сначала зачислите студента в группу.");
        }
        const groupChanged = (membership?.groupId ?? null) !== targetGroupId;
        const nextIsGroupLeader =
          nextRole === "STUDENT" && nextStatus === "ACTIVE"
            ? (input.isGroupLeader ?? (groupChanged ? false : (membership?.isGroupLeader ?? false)))
            : false;
        if (membership && groupChanged) {
          await tx.groupMember.update({
            where: { id: membership.id },
            data: { leftAt: new Date(), isGroupLeader: false },
          });
        }
        let nextMembershipId = groupChanged ? null : (membership?.id ?? null);
        if (groupChanged && targetGroup) {
          const createdMembership = await tx.groupMember.create({
            data: {
              studentId: existing.id,
              groupId: targetGroup.id,
              isGroupLeader: nextIsGroupLeader,
            },
            select: { id: true },
          });
          nextMembershipId = createdMembership.id;
        }
        if (nextIsGroupLeader && targetGroupId) {
          await tx.groupMember.updateMany({
            where: {
              groupId: targetGroupId,
              leftAt: null,
              isGroupLeader: true,
              ...(nextMembershipId ? { id: { not: nextMembershipId } } : {}),
            },
            data: { isGroupLeader: false },
          });
        }
        if (nextMembershipId && !groupChanged && membership?.isGroupLeader !== nextIsGroupLeader) {
          await tx.groupMember.update({
            where: { id: nextMembershipId },
            data: { isGroupLeader: nextIsGroupLeader },
          });
        }
        if (groupChanged || (membership?.isGroupLeader ?? false) !== nextIsGroupLeader) {
          await tx.auditLog.create({
            data: {
              actorId: actor.id,
              action: groupChanged ? "user.student_group_updated" : "user.group_leader_updated",
              entityType: "user",
              entityId: existing.id,
              beforeJson: {
                groupId: membership?.groupId ?? null,
                groupName: membership?.group.name ?? null,
                isGroupLeader: membership?.isGroupLeader ?? false,
              },
              afterJson: {
                groupId: targetGroupId,
                groupName: targetGroup?.name ?? null,
                isGroupLeader: nextIsGroupLeader,
              },
              userAgent: userAgent(request),
            },
          });
        }
      }

      const removesActiveSuperAdmin =
        existing.role === "SUPER_ADMIN" &&
        existing.status === "ACTIVE" &&
        (nextRole !== "SUPER_ADMIN" || nextStatus !== "ACTIVE");

      if (removesActiveSuperAdmin) {
        const activeAdmins = await lockActiveSuperAdmins(tx);
        if (activeAdmins.length <= 1) {
          throw new ApiError(
            409,
            "LAST_SUPER_ADMIN",
            "Нельзя заблокировать или понизить последнего главного администратора.",
          );
        }
      }

      const nextEmail = input.email?.trim().toLowerCase();
      const updated = await tx.user.update({
        where: { id: existing.id },
        data: {
          ...(nextEmail
            ? { email: nextEmail, normalizedEmail: nextEmail, emailVerified: false }
            : {}),
          ...(input.firstName !== undefined ? { firstName: input.firstName.trim() } : {}),
          ...(input.lastName !== undefined ? { lastName: input.lastName.trim() } : {}),
          ...(input.middleName !== undefined
            ? { middleName: input.middleName?.trim() || null }
            : {}),
          ...(input.phone !== undefined ? { phone: input.phone?.trim() || null } : {}),
          ...(input.locale !== undefined ? { locale: input.locale } : {}),
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.status === "ARCHIVED" ? { deletedAt: new Date() } : {}),
          ...(input.status !== undefined && input.status !== "ARCHIVED" ? { deletedAt: null } : {}),
          ...(input.firstName !== undefined ||
          input.lastName !== undefined ||
          input.middleName !== undefined
            ? {
                name: makeName({
                  firstName: input.firstName ?? existing.firstName,
                  lastName: input.lastName ?? existing.lastName,
                  middleName:
                    input.middleName === undefined
                      ? (existing.middleName ?? undefined)
                      : (input.middleName ?? undefined),
                }),
              }
            : {}),
        },
      });

      if (updated.status !== "ACTIVE" || updated.role !== existing.role) {
        await tx.session.deleteMany({ where: { userId: updated.id } });
      }

      const before = safeUser(existing);
      const after = safeUser(updated);
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "user.updated",
          entityType: "user",
          entityId: updated.id,
          beforeJson: auditSnapshot(before),
          afterJson: auditSnapshot(after),
          userAgent: userAgent(request),
        },
      });
      return after;
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      throw new ApiError(409, "USER_ALREADY_EXISTS", "Пользователь с таким email уже существует.");
    }
    throw error;
  }
}

export async function archiveUser(
  actor: Actor,
  userId: string,
  request: Request,
): Promise<UserSummary> {
  return updateUser(actor, userId, { status: "ARCHIVED" }, request);
}

export async function resetUserPassword(
  actor: Actor,
  userId: string,
  request: Request,
): Promise<{ user: UserSummary; temporaryPassword: string }> {
  const password = temporaryPassword();
  const passwordHash = await hashPassword(password);

  const user = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { id: userId } });
    if (!existing) throw new ApiError(404, "USER_NOT_FOUND", "Пользователь не найден.");
    assertCanManageUser(actor.role, existing.role);
    if (existing.status === "ARCHIVED") {
      throw new ApiError(
        409,
        "USER_ARCHIVED",
        "Сначала восстановите архивированного пользователя.",
      );
    }

    const account = await tx.account.findFirst({
      where: { userId: existing.id, providerId: "credential", accountId: existing.id },
      select: { id: true },
    });
    if (!account)
      throw new ApiError(
        409,
        "CREDENTIAL_ACCOUNT_NOT_FOUND",
        "Для пользователя не настроен пароль.",
      );

    await tx.account.update({ where: { id: account.id }, data: { password: passwordHash } });
    await tx.session.deleteMany({ where: { userId: existing.id } });
    const updated = await tx.user.update({
      where: { id: existing.id },
      data: { mustChangePassword: true, passwordChangedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: "user.password_reset",
        entityType: "user",
        entityId: updated.id,
        beforeJson: { mustChangePassword: existing.mustChangePassword },
        afterJson: { mustChangePassword: true, sessionsRevoked: true },
        userAgent: userAgent(request),
      },
    });
    return safeUser(updated);
  });

  return { user, temporaryPassword: password };
}
