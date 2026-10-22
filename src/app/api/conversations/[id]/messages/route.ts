import { db } from "@/server/db/client";
import { api, notFound } from "@/server/http/api";

export const GET = api<{ id: string }>(async ({ user, params }) => {
  const c = await db.conversation.findFirst({ where: { id: params.id, userId: user.id } });
  if (!c) throw notFound("Conversation");
  const messages = await db.chatMessage.findMany({ where: { conversationId: c.id }, orderBy: { createdAt: "asc" }, take: 300 });
  return { conversation: { id: c.id, title: c.title, projectId: c.projectId }, messages };
});
