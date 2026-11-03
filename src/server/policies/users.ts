import { ApiError } from "@/lib/http/api-error";

export const userRoles = ["SUPER_ADMIN", "ADMIN", "TEACHER", "STUDENT"] as const;
export type UserRole = (typeof userRoles)[number];
export type ManageableUserRole = Exclude<UserRole, "SUPER_ADMIN">;
export type UserStatus = "ACTIVE" | "BLOCKED" | "ARCHIVED";

export function isUserRole(value: string): value is UserRole {
  return userRoles.includes(value as UserRole);
}

export function canCreateUser(actorRole: UserRole, targetRole: UserRole): boolean {
  if (actorRole === "SUPER_ADMIN") return true;
  return actorRole === "ADMIN" && (targetRole === "TEACHER" || targetRole === "STUDENT");
}

export function canManageUser(actorRole: UserRole, targetRole: UserRole): boolean {
  if (actorRole === "SUPER_ADMIN") return true;
  return actorRole === "ADMIN" && (targetRole === "TEACHER" || targetRole === "STUDENT");
}

export function canViewAudit(actorRole: UserRole): boolean {
  return actorRole === "SUPER_ADMIN" || actorRole === "ADMIN";
}

export function assertCanCreateUser(actorRole: UserRole, targetRole: UserRole): void {
  if (!canCreateUser(actorRole, targetRole)) {
    throw new ApiError(403, "FORBIDDEN", "Недостаточно прав для создания пользователя с этой ролью.");
  }
}

export function assertCanManageUser(actorRole: UserRole, targetRole: UserRole): void {
  if (!canManageUser(actorRole, targetRole)) {
    throw new ApiError(403, "FORBIDDEN", "Управлять этим пользователем может только главный администратор.");
  }
}

export function assertCanAssignRole(actorRole: UserRole, targetRole: UserRole): void {
  if (targetRole === "SUPER_ADMIN" && actorRole !== "SUPER_ADMIN") {
    throw new ApiError(403, "FORBIDDEN", "Создавать главных администраторов может только главный администратор.");
  }
  assertCanCreateUser(actorRole, targetRole);
}
