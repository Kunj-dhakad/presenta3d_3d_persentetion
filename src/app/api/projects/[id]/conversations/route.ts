import { db } from "@/server/db/client";
import { api } from "@/server/http/api";
import { getOwnedProject } from "@/server/services/projects";

export const GET = api<{ id: string }>(async ({ user, params }) => {
  await getOwnedProject(user.id, params.id);
  const conversations = await db.conversation.findMany({
    where: { userId: user.id, projectId: params.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, createdAt: true, updatedAt: true, _count: { select: { messages: true } } },
  });
  return { conversations };
});
