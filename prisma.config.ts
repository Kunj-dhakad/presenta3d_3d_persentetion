import "dotenv/config";
import { defineConfig } from "prisma/config";

const runtimeUrl = process.env["DATABASE_URL"] ?? "file:./.data/strata.db";
const isTest = process.env["NODE_ENV"] === "test";
const hasMysqlConfig = Boolean(process.env["MYSQL_HOST"]);
const isMysql = !isTest && hasMysqlConfig;
const isPostgres = !isTest && !isMysql && (/^postgres(ql)?:\/\//.test(runtimeUrl) || /^postgres(ql)?:\/\//.test(process.env["DIRECT_URL"] ?? ""));
const encode = (value: string | undefined) => encodeURIComponent(value ?? "");
const mysqlUrl = isMysql
  ? `mysql://${encode(process.env["MYSQL_USER"])}:${encode(process.env["MYSQL_PASSWORD"])}@${process.env["MYSQL_HOST"]}:${process.env["MYSQL_PORT"] || "3306"}/${encode(process.env["MYSQL_DATABASE"])}?connect_timeout=10`
  : undefined;
// A direct connection URL can be used for Postgres migrations. RDS MySQL uses MYSQL_*.
const url = isTest ? runtimeUrl : mysqlUrl ?? process.env["DIRECT_URL"] ?? runtimeUrl;

export default defineConfig({
  schema: isMysql ? "prisma/mysql/schema.prisma" : isPostgres ? "prisma/postgres/schema.prisma" : "prisma/schema.prisma",
  migrations: {
    path: isMysql ? "prisma/mysql/migrations" : isPostgres ? "prisma/postgres/migrations" : "prisma/migrations",
    seed: "tsx --conditions=react-server prisma/seed.ts",
  },
  datasource: { url },
});
