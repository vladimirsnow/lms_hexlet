import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { hashPassword } from "../src/lib/auth/password";

const databaseUrl = process.env.DATABASE_URL;
const testPassword = process.env.E2E_PASSWORD;

if (process.env.E2E_MODE !== "true" || !databaseUrl || !testPassword) {
  throw new Error("E2E fixtures may only be seeded by scripts/local-e2e.ps1.");
}
if (new URL(databaseUrl).pathname !== "/lms_e2e") {
  throw new Error("E2E fixtures require the isolated lms_e2e database.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const users = [
  { username: "superadmin", role: "SUPER_ADMIN", firstName: "Главный", lastName: "Администратор" },
  { username: "admin01", role: "ADMIN", firstName: "Администратор", lastName: "01" },
  { username: "teacher01", role: "TEACHER", firstName: "Преподаватель", lastName: "01" },
  { username: "teacher02", role: "TEACHER", firstName: "Преподаватель", lastName: "02" },
  { username: "student01", role: "STUDENT", firstName: "Студент", lastName: "01" },
  { username: "student02", role: "STUDENT", firstName: "Студент", lastName: "02" },
  { username: "student03", role: "STUDENT", firstName: "Студент", lastName: "03" },
  { username: "student04", role: "STUDENT", firstName: "Студент", lastName: "04" },
  { username: "student05", role: "STUDENT", firstName: "Студент", lastName: "05" },
] as const;

try {
  if ((await prisma.user.count()) !== 0) {
    throw new Error("The isolated E2E database must be empty before fixtures are seeded.");
  }

  for (const user of users) {
    const id = randomUUID();
    const email = `${user.username}@kzhexly.test`;
    await prisma.user.create({
      data: {
        id,
        name: `${user.firstName} ${user.lastName}`,
        email,
        normalizedEmail: email,
        emailVerified: true,
        username: user.username,
        displayUsername: user.username,
        role: user.role,
        status: "ACTIVE",
        firstName: user.firstName,
        lastName: user.lastName,
        locale: "ru",
        mustChangePassword: false,
        passwordChangedAt: new Date(),
        accounts: {
          create: {
            accountId: id,
            providerId: "credential",
            password: await hashPassword(testPassword),
          },
        },
      },
    });
  }

  console.info(`Created ${users.length} isolated E2E users.`);
} finally {
  await prisma.$disconnect();
}
