import { AgentEventSchema, ChatMessageSchema, type AgentEvent, type ChatMessage } from '@aurum/shared';
import { asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../client';
import { agentEvents, chatMessages } from '../schema';

export async function saveAgentEvent(db: Db, event: AgentEvent): Promise<void> {
  await db
    .insert(agentEvents)
    .values({ id: event.id, ts: new Date(event.ts), agent: event.agent, level: event.level, summary: event.summary, data: event })
    .onConflictDoNothing();
}

export async function listRecentAgentEvents(db: Db, limit = 200): Promise<AgentEvent[]> {
  const rows = await db.select({ data: agentEvents.data }).from(agentEvents).orderBy(desc(agentEvents.ts)).limit(limit);
  return rows.map((r) => AgentEventSchema.parse(r.data)).reverse();
}

export async function saveChatMessage(db: Db, conversationId: string, message: ChatMessage): Promise<void> {
  await db
    .insert(chatMessages)
    .values({
      id: message.id,
      conversationId,
      role: message.role,
      content: message.content,
      ts: new Date(message.ts),
      data: message,
    })
    .onConflictDoUpdate({ target: chatMessages.id, set: { content: message.content, data: message } });
}

export async function listChatMessages(db: Db, conversationId: string, limit = 100): Promise<ChatMessage[]> {
  const rows = await db
    .select({ data: chatMessages.data })
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(asc(chatMessages.ts))
    .limit(limit);
  return rows.map((r) => ChatMessageSchema.parse(r.data));
}
