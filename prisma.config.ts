import nextEnv from "@next/env";
import { defineConfig } from "prisma/config";

nextEnv.loadEnvConfig(process.cwd());

const encode = (value: string | undefined) => encodeURIComponent(value ?? "");
const url = `mysql://${encode(process.env["MYSQL_USER"] ?? "root")}:${encode(process.env["MYSQL_PASSWORD"] ?? "")}@${process.env["MYSQL_HOST"] ?? "127.0.0.1"}:${process.env["MYSQL_PORT"] || "3306"}/${encode(process.env["MYSQL_DATABASE"] ?? "deck3d")}?connect_timeout=10`;

export default defineConfig({
  schema: "prisma/mysql/schema.prisma",
  migrations: {
    path: "prisma/mysql/migrations",
    seed: "tsx --conditions=react-server prisma/seed.ts",
  },
  datasource: { url },
});
