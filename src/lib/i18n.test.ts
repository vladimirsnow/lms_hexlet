import { describe, expect, it } from "vitest";
import { getMessages } from "@/lib/i18n";

describe("mobile navigation labels", () => {
  it("provides a native-menu label in all supported locales", () => {
    expect(getMessages("ru").mobileMenu).toBe("Меню");
    expect(getMessages("kk").mobileMenu).toBe("Мәзір");
    expect(getMessages("en").mobileMenu).toBe("Menu");
  });
});

describe("global search labels", () => {
  it("provides localized names for the search results list", () => {
    expect(getMessages("ru").searchResults).toBe("Результаты поиска");
    expect(getMessages("kk").searchResults).toBe("Іздеу нәтижелері");
    expect(getMessages("en").searchResults).toBe("Search results");
  });
});

describe("authentication screen translations", () => {
  it("provides sign-in and password-change copy in all supported locales", () => {
    for (const locale of ["ru", "kk", "en"] as const) {
      const messages = getMessages(locale).auth;
      expect(messages.login.title).toBeTruthy();
      expect(messages.login.identifier).toBeTruthy();
      expect(messages.login.loginError).toBeTruthy();
      expect(messages.changePassword.newPassword).toBeTruthy();
      expect(messages.changePassword.currentPasswordInvalid).toBeTruthy();
    }
  });
});

describe("announcement and notification translations", () => {
  it("provides page actions and empty states in every supported locale", () => {
    for (const locale of ["ru", "kk", "en"] as const) {
      const messages = getMessages(locale);
      expect(messages.announcements.createAction).toBeTruthy();
      expect(messages.announcements.archiveConfirm).toBeTruthy();
      expect(messages.notifications.markAllRead).toBeTruthy();
      expect(messages.notifications.empty).toBeTruthy();
    }
  });
});

describe("course and assignment translations", () => {
  it("provides core learning and assignment labels in every supported locale", () => {
    for (const locale of ["ru", "kk", "en"] as const) {
      const messages = getMessages(locale);
      expect(messages.course.materials).toBeTruthy();
      expect(messages.course.noMaterials).toBeTruthy();
      expect(messages.course.uploaded).toBeTruthy();
      expect(messages.assignments.newAssignment).toBeTruthy();
      expect(messages.assignments.resubmission).toBeTruthy();
      expect(messages.assignments.statusSubmitted).toBeTruthy();
      expect(messages.submission.notStarted).toBeTruthy();
      expect(messages.submission.status.GRADED).toBeTruthy();
      expect(messages.submission.return).toBeTruthy();
    }
  });
});

describe("account administration translations", () => {
  it("provides user management actions and status labels in every supported locale", () => {
    for (const locale of ["ru", "kk", "en"] as const) {
      const messages = getMessages(locale);
      expect(messages.users.createAccount).toBeTruthy();
      expect(messages.users.exportCsv).toBeTruthy();
      expect(messages.users.importHelp).toContain("username");
      expect(messages.users.downloadCredentials).toBeTruthy();
      expect(messages.users.statuses.BLOCKED).toBeTruthy();
      expect(messages.users.archiveConfirm("Sample")).toBeTruthy();
      expect(messages.users.errors.reset).toBeTruthy();
    }
  });
});

describe("schedule and attendance translations", () => {
  it("provides weekday, attendance, and schedule labels in every supported locale", () => {
    for (const locale of ["ru", "kk", "en"] as const) {
      const messages = getMessages(locale).schedule;
      expect(messages.weekdays).toHaveLength(7);
      expect(messages.attendanceLabels.PRESENT).toBeTruthy();
      expect(messages.form.addLesson).toBeTruthy();
      expect(messages.report.downloadCsv).toBeTruthy();
      expect(messages.report.downloadXlsx).toBeTruthy();
      expect(messages.page.studentTitle).toBeTruthy();
    }
  });
});

describe("gradebook translations", () => {
  it("provides grade calculation and teacher override labels in every supported locale", () => {
    for (const locale of ["ru", "kk", "en"] as const) {
      const messages = getMessages(locale).gradebook;
      expect(messages.pageDescription).toBeTruthy();
      expect(messages.downloadCsv).toBeTruthy();
      expect(messages.downloadXlsx).toBeTruthy();
      expect(messages.calculated).toBeTruthy();
      expect(messages.teacherFinal).toBeTruthy();
      expect(messages.settingsError).toBeTruthy();
    }
  });
});

describe("quiz translations", () => {
  it("provides localized student, authoring, and review labels in every supported locale", () => {
    for (const locale of ["ru", "kk", "en"] as const) {
      const messages = getMessages(locale).quiz;
      expect(messages.start).toBeTruthy();
      expect(messages.questionTypes.ESSAY).toBeTruthy();
      expect(messages.attemptStatuses.NEEDS_REVIEW).toBeTruthy();
      expect(messages.saveEssayGrade).toBeTruthy();
      expect(messages.lockedQuestions).toBeTruthy();
      expect(messages.attempt).toBe(
        locale === "ru" ? "Попытка" : locale === "kk" ? "Әрекет" : "Attempt",
      );
    }
  });
});

describe("system state translations", () => {
  it("provides localized loading, error, and not-found copy", () => {
    for (const locale of ["ru", "kk", "en"] as const) {
      const messages = getMessages(locale).auth.systemError;
      expect(messages.loading).toBeTruthy();
      expect(messages.title).toBeTruthy();
      expect(messages.retry).toBeTruthy();
      expect(messages.notFoundTitle).toBeTruthy();
      expect(messages.notFoundDescription).toBeTruthy();
    }
  });
});

describe("academic administration translations", () => {
  it("provides localized structure, enrollment, and import labels in every locale", () => {
    for (const locale of ["ru", "kk", "en"] as const) {
      const messages = getMessages(locale).academic;
      expect(messages.tabs.years).toBeTruthy();
      expect(messages.headings.newCourse).toBeTruthy();
      expect(messages.help.csvLimit).toBeTruthy();
      expect(messages.success.enrollGroup(2, 1)).toContain("2");
      expect(messages.importErrors.row(3, "student@example.test", "Invalid email")).toContain("3");
    }
  });
});

describe("audit and personal grade translations", () => {
  it("provides localized event, pagination, and grade labels in every locale", () => {
    for (const locale of ["ru", "kk", "en"] as const) {
      const messages = getMessages(locale);
      expect(messages.audit.actions["submission.graded"]).toBeTruthy();
      expect(messages.audit.entities.assignment).toBeTruthy();
      expect(messages.audit.page(1, 2, 30)).toContain("30");
      expect(messages.studentGrades.empty).toBeTruthy();
      expect(messages.studentGrades.date).toBeTruthy();
    }
  });
});

describe("public landing page translations", () => {
  it("provides complete hero, feature, navigation, and language labels in every locale", () => {
    for (const locale of ["ru", "kk", "en"] as const) {
      const messages = getMessages(locale);
      expect(messages.landing.heroTitle).toHaveLength(3);
      expect(messages.landing.features).toHaveLength(3);
      expect(messages.landing.sections).toHaveLength(3);
      expect(messages.landing.signIn).toBeTruthy();
      expect(messages.language).toBeTruthy();
    }
  });
});
