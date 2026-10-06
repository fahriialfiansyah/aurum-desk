import { z } from 'zod';

export const ChatRoleSchema = z.enum(['user', 'assistant']);

export const ChatToolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  status: z.enum(['running', 'done', 'error']),
  resultSummary: z.string().optional(),
});
export type ChatToolCall = z.infer<typeof ChatToolCallSchema>;

export const ChatMessageSchema = z.object({
  id: z.string().min(1),
  role: ChatRoleSchema,
  content: z.string(),
  ts: z.iso.datetime(),
  toolCalls: z.array(ChatToolCallSchema).optional(),
  source: z.enum(['llm', 'rules']).optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const CHAT_MESSAGE_MAX_CHARS = 2000;

export const ChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(CHAT_MESSAGE_MAX_CHARS),
  conversationId: z.string().min(1).optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
