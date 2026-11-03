import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { hashPassword } from "../src/lib/auth/password";

const databaseUrl = process.env.DATABASE_URL;
if (
  !databaseUrl ||
  (!databaseUrl.startsWith("postgresql://") && !databaseUrl.startsWith("postgres://"))
) {
  throw new Error("Укажите корректный DATABASE_URL в .env перед созданием аккаунтов.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});
const credentialsPath = resolve(".local-services/postgres", "bootstrap-credentials.txt");
let credentialsFileWritten = false;

const initialUsers = [
  {
    username: "superadmin",
    email: "superadmin@kzhexly.test",
    role: "SUPER_ADMIN",
    firstName: "Главный",
    lastName: "Администратор",
  },
  {
    username: "teacher01",
    email: "teacher01@kzhexly.test",
    role: "TEACHER",
    firstName: "Преподаватель",
    lastName: "01",
  },
  {
    username: "teacher02",
    email: "teacher02@kzhexly.test",
    role: "TEACHER",
    firstName: "Преподаватель",
    lastName: "02",
  },
  {
    username: "student01",
    email: "student01@kzhexly.test",
    role: "STUDENT",
    firstName: "Студент",
    lastName: "01",
  },
  {
    username: "student02",
    email: "student02@kzhexly.test",
    role: "STUDENT",
    firstName: "Студент",
    lastName: "02",
  },
  {
    username: "student03",
    email: "student03@kzhexly.test",
    role: "STUDENT",
    firstName: "Студент",
    lastName: "03",
  },
  {
    username: "student04",
    email: "student04@kzhexly.test",
    role: "STUDENT",
    firstName: "Студент",
    lastName: "04",
  },
  {
    username: "student05",
    email: "student05@kzhexly.test",
    role: "STUDENT",
    firstName: "Студент",
    lastName: "05",
  },
] as const;

function makeTemporaryPassword(): string {
  return randomBytes(24).toString("base64url");
}

async function main() {
  await mkdir(resolve(".local-services/postgres"), { recursive: true });
  if (existsSync(credentialsPath)) {
    throw new Error(
      "Файл с одноразовыми паролями уже существует. Сначала сохраните его в менеджер паролей и удалите локальную копию.",
    );
  }

  const accountCount = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ locked: string }>>`
      SELECT pg_advisory_xact_lock(2026103101)::text AS locked
    `;

    const existingCount = await tx.user.count();
    if (existingCount > 0) {
      throw new Error(
        `Первичная настройка остановлена: в базе уже есть ${existingCount} пользователей. Ни один аккаунт не изменён.`,
      );
    }

    const createdCredentials: Array<{
      username: string;
      email: string;
      role: string;
      temporaryPassword: string;
    }> = [];

    for (const account of initialUsers) {
      const id = randomUUID();
      const temporaryPassword = makeTemporaryPassword();
      const password = await hashPassword(temporaryPassword);
      const name = `${account.firstName} ${account.lastName}`;

      await tx.user.create({
        data: {
          id,
          name,
          email: account.email,
          normalizedEmail: account.email,
          emailVerified: false,
          username: account.username,
          displayUsername: account.username,
          role: account.role,
          status: "ACTIVE",
          firstName: account.firstName,
          lastName: account.lastName,
          locale: "ru",
          mustChangePassword: true,
          accounts: {
            create: {
              accountId: id,
              providerId: "credential",
              password,
            },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          action: "system.bootstrap_user_created",
          entityType: "user",
          entityId: id,
          afterJson: { username: account.username, role: account.role, status: "ACTIVE" },
        },
      });

      createdCredentials.push({ ...account, temporaryPassword });
    }

    const credentialDocument = [
      "Начальные аккаунты Kzhexly LMS",
      "Смените каждый временный пароль при первом входе. После сохранения удалите этот файл.",
      "",
      ...createdCredentials.flatMap((credential) => [
        `Логин: ${credential.username}`,
        `Email: ${credential.email}`,
        `Роль: ${credential.role}`,
        `Временный пароль: ${credential.temporaryPassword}`,
        "",
      ]),
    ].join("\n");
    await writeFile(credentialsPath, credentialDocument, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    credentialsFileWritten = true;

    return createdCredentials.length;
  });

  console.info(`Создано начальных аккаунтов: ${accountCount}.`);
  console.info(
    "Одноразовые пароли записаны в .local-services/postgres/bootstrap-credentials.txt. Сохраните их в менеджере паролей, затем удалите локальный файл.",
  );
}

try {
  await main();
} catch (error) {
  if (credentialsFileWritten) {
    await unlink(credentialsPath).catch(() => undefined);
  }
  console.error(error instanceof Error ? error.message : "Не удалось создать начальные аккаунты.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
