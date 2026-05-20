import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/utils/password";

const prisma = new PrismaClient();

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required to seed the admin user`);
  }
  return value;
}

async function main() {
  const email = requireEnv("ADMIN_EMAIL").toLowerCase();
  const phone = requireEnv("ADMIN_PHONE");
  const password = requireEnv("ADMIN_PASSWORD");
  const passwordHash = hashPassword(password);

  const admin = await prisma.user.upsert({
    where: { phone },
    update: {
      email,
      role: "super_admin",
      isActive: true,
      isBanned: false,
      passwordHash,
      passwordUpdatedAt: new Date(),
    },
    create: {
      phone,
      email,
      role: "super_admin",
      isActive: true,
      phoneVerifiedAt: new Date(),
      passwordHash,
      passwordUpdatedAt: new Date(),
    },
    select: {
      id: true,
      email: true,
      phone: true,
      role: true,
    },
  });

  const portalAdmin = await prisma.admin.upsert({
    where: { email },
    update: {
      passwordHash,
      role: "super_admin",
      isActive: true,
    },
    create: {
      email,
      passwordHash,
      role: "super_admin",
      isActive: true,
    },
    select: {
      id: true,
      email: true,
      role: true,
    },
  });

  console.log(
    JSON.stringify({
      seeded: true,
      admin: {
        ...admin,
          id: admin.id.toString(),
      },
      portalAdmin: {
        ...portalAdmin,
        id: portalAdmin.id.toString(),
      },
    }),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
