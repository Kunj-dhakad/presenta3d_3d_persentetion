import { api } from "@/server/http/api";

export const GET = api(async ({ user }) => ({ user }), { auth: false });
