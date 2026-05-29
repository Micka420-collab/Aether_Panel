import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { DEFAULT_PLANS } from "../src/lib/plans";

const db = new PrismaClient();

async function main() {
  // ── Pricing plans ──────────────────────────────────────────
  for (const p of DEFAULT_PLANS) {
    await db.plan.upsert({
      where: { slug: p.slug },
      update: {
        name: p.name,
        priceMonthly: p.priceMonthly,
        priceAnnual: p.priceAnnual,
        memoryMb: p.memoryMb,
        cpuPercent: p.cpuPercent,
        diskMb: p.diskMb,
        backupSlots: p.backupSlots,
        databases: p.databases,
        popular: p.popular,
        sort: p.sort,
        features: [...p.features],
      },
      create: {
        slug: p.slug,
        name: p.name,
        priceMonthly: p.priceMonthly,
        priceAnnual: p.priceAnnual,
        memoryMb: p.memoryMb,
        cpuPercent: p.cpuPercent,
        diskMb: p.diskMb,
        backupSlots: p.backupSlots,
        databases: p.databases,
        popular: p.popular,
        sort: p.sort,
        features: [...p.features],
      },
    });
  }
  console.log(`✓ ${DEFAULT_PLANS.length} plans seeded`);

  // ── Default game node ──────────────────────────────────────
  const fqdn = process.env.DEFAULT_NODE_FQDN || "localhost";
  const existing = await db.node.findFirst({ where: { fqdn } });
  if (!existing) {
    await db.node.create({
      data: {
        name: "Local Node",
        fqdn,
        scheme: "http",
        daemonPort: Number(process.env.DAEMON_PORT || 8080),
        publicIp: process.env.NODE_PUBLIC_IP || "127.0.0.1",
        tokenId: `node_${crypto.randomBytes(6).toString("hex")}`,
        tokenSecret: process.env.DAEMON_TOKEN || "dev-daemon-token-change-me",
      },
    });
    console.log(`✓ default node created (${fqdn})`);
  } else {
    console.log("• node already exists, skipping");
  }

  // ── Optional bootstrap admin ───────────────────────────────
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const exists = await db.user.findUnique({ where: { email: adminEmail.toLowerCase() } });
    if (!exists) {
      await db.user.create({
        data: {
          email: adminEmail.toLowerCase(),
          username: (process.env.ADMIN_USERNAME || "admin").toLowerCase(),
          passwordHash: await bcrypt.hash(adminPassword, 12),
          role: "ADMIN",
        },
      });
      console.log(`✓ admin user created (${adminEmail})`);
    }
  } else {
    console.log("• no ADMIN_EMAIL/ADMIN_PASSWORD set — first registered account becomes admin");
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
