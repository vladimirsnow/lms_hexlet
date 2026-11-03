import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/http/api-error";
import {
  assertCanAssignRole,
  assertCanCreateUser,
  assertCanManageUser,
  canCreateUser,
  canManageUser,
  canViewAudit,
  isUserRole,
  userRoles,
  type UserRole,
} from "./users";

describe("user role policy", () => {
  it.each(userRoles)("allows SUPER_ADMIN to create and manage %s accounts", (targetRole) => {
    expect(canCreateUser("SUPER_ADMIN", targetRole)).toBe(true);
    expect(canManageUser("SUPER_ADMIN", targetRole)).toBe(true);
    expect(() => assertCanCreateUser("SUPER_ADMIN", targetRole)).not.toThrow();
    expect(() => assertCanManageUser("SUPER_ADMIN", targetRole)).not.toThrow();
  });

  it.each(["TEACHER", "STUDENT"] as const)(
    "lets ADMIN create and manage %s accounts",
    (targetRole) => {
      expect(canCreateUser("ADMIN", targetRole)).toBe(true);
      expect(canManageUser("ADMIN", targetRole)).toBe(true);
      expect(() => assertCanCreateUser("ADMIN", targetRole)).not.toThrow();
      expect(() => assertCanManageUser("ADMIN", targetRole)).not.toThrow();
    },
  );

  it.each(["SUPER_ADMIN", "ADMIN"] as const)(
    "prevents ADMIN from creating or managing %s accounts",
    (targetRole) => {
      expect(canCreateUser("ADMIN", targetRole)).toBe(false);
      expect(canManageUser("ADMIN", targetRole)).toBe(false);
      expect(() => assertCanCreateUser("ADMIN", targetRole)).toThrow(ApiError);
      expect(() => assertCanManageUser("ADMIN", targetRole)).toThrow(ApiError);
    },
  );

  it.each(["TEACHER", "STUDENT"] as const)(
    "denies %s all user creation and management",
    (actorRole) => {
      for (const targetRole of userRoles) {
        expect(canCreateUser(actorRole, targetRole)).toBe(false);
        expect(canManageUser(actorRole, targetRole)).toBe(false);
      }
    },
  );

  it("only lets administrators view the audit log", () => {
    expect(canViewAudit("SUPER_ADMIN")).toBe(true);
    expect(canViewAudit("ADMIN")).toBe(true);
    expect(canViewAudit("TEACHER")).toBe(false);
    expect(canViewAudit("STUDENT")).toBe(false);
  });

  it("allows only SUPER_ADMIN to assign the SUPER_ADMIN role", () => {
    expect(() => assertCanAssignRole("SUPER_ADMIN", "SUPER_ADMIN")).not.toThrow();
    for (const actorRole of ["ADMIN", "TEACHER", "STUDENT"] as const satisfies readonly UserRole[]) {
      expect(() => assertCanAssignRole(actorRole, "SUPER_ADMIN")).toThrow(ApiError);
    }
  });

  it("recognizes only the four canonical role codes", () => {
    for (const role of userRoles) expect(isUserRole(role)).toBe(true);
    expect(isUserRole("OWNER")).toBe(false);
    expect(isUserRole("student")).toBe(false);
  });
});
