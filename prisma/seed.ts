import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { getServerEnv } from "../src/lib/env";

const env = getServerEnv();
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
});

try {
  await prisma.systemSetting.upsert({
    where: { key: "platform.locale.default" },
    update: {},
    create: { key: "platform.locale.default", valueJson: "ru" },
  });
  console.info("Seed completed. No user accounts were created.");
} finally {
  await prisma.$disconnect();
}
