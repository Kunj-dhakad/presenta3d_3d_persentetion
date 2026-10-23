import { db } from "../src/server/db/client";

const { MYSQL_HOST, MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD } = process.env;
if (!MYSQL_HOST || !MYSQL_DATABASE || !MYSQL_USER || !MYSQL_PASSWORD) {
  throw new Error("RDS connection check requires MYSQL_HOST, MYSQL_DATABASE, MYSQL_USER, and MYSQL_PASSWORD.");
}

async function main() {
  try {
    await db.$queryRaw`SELECT 1`;
    await db.user.findUnique({ where: { email: "__deck3d_rds_connection_check__@invalid.local" }, select: { id: true } });
    const userCount = await db.user.count();
    console.log(`RDS app connection check passed (read-only SELECT 1); users=${userCount}.`);
  } finally {
    await db.$disconnect();
  }
}

void main();
