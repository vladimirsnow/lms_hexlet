import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { syncImportedCourses } from "../src/server/services/schedule-planner";

if (!process.argv.includes("--apply")) {
  throw new Error("Для переноса курсов укажите --apply. Скрипт меняет базу данных.");
}
dotenv.config({ path: process.env.SCHEDULE_SYNC_ENV ?? ".env" });
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});
try {
  const [admin, term] = await Promise.all([
    prisma.user.findFirst({ where: { role: "SUPER_ADMIN", status: "ACTIVE", deletedAt: null } }),
    prisma.term.findFirst({ where: { isActive: true }, orderBy: { startsOn: "desc" } }),
  ]);
  if (!admin || !term) throw new Error("Не найдены активный суперадминистратор и семестр.");
  const result = await syncImportedCourses(
    {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      status: "ACTIVE",
      mustChangePassword: false,
    },
    term.id,
    new Request("http://localhost/api/v1/schedule/planner", { method: "POST" }),
  );
  console.log(JSON.stringify(result));
} finally {
  await prisma.$disconnect();
}
