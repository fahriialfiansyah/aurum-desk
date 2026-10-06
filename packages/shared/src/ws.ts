import { z } from 'zod';
import { AgentEventSchema, AgentStateSchema } from './agent-event';
import { CandleSchema } from './candle';
import { ChatMessageSchema, ChatToolCallSchema } from './chat';
import { DrawingSchema } from './drawing';
import { FeedStatusSchema, ReplayStateSchema } from './feed';
import { MetricsSchema } from './metrics';
import { PlaybookIdSchema, SetupSchema, SetupStatusSchema } from './setup';
import { MarketStructureSchema } from './structure';
import { TimeframeSchema } from './timeframe';
import { ZoneSchema } from './zone';

/** Per-timeframe analysis overlay the chart renders (swings, BOS/CHoCH, zones). */
export const AnalysisSnapshotSchema = z.object({
  tf: TimeframeSchema,
  structure: MarketStructureSchema,
  zones: z.array(ZoneSchema),
  atr: z.number().nullable(),
  computedAt: z.iso.datetime(),
});
export type AnalysisSnapshot = z.infer<typeof AnalysisSnapshotSchema>;

export const WsServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    serverTime: z.iso.datetime(),
    symbol: z.string(),
    feed: FeedStatusSchema,
    activePlaybook: PlaybookIdSchema,
  }),
  z.object({
    type: z.literal('candle'),
    tf: TimeframeSchema,
    candle: CandleSchema,
    /** true when this bar is final; false while it is still forming. */
    closed: z.boolean(),
  }),
  z.object({
    type: z.literal('candles'),
    tf: TimeframeSchema,
    candles: z.array(CandleSchema),
  }),
  z.object({
    type: z.literal('setup'),
    setup: SetupSchema,
    transition: SetupStatusSchema.nullable(),
  }),
  z.object({ type: z.literal('setups'), setups: z.array(SetupSchema) }),
  z.object({ type: z.literal('agentEvent'), event: AgentEventSchema }),
  z.object({ type: z.literal('agentStates'), states: z.array(AgentStateSchema) }),
  z.object({
    type: z.literal('chatToken'),
    messageId: z.string().min(1),
    token: z.string().optional(),
    toolCall: ChatToolCallSchema.optional(),
    done: z.boolean().optional(),
    error: z.string().optional(),
  }),
  z.object({ type: z.literal('chatMessage'), message: ChatMessageSchema }),
  z.object({ type: z.literal('metrics'), metrics: MetricsSchema }),
  z.object({ type: z.literal('analysis'), snapshot: AnalysisSnapshotSchema }),
  z.object({
    type: z.literal('drawing'),
    action: z.enum(['add', 'remove', 'clear']),
    drawing: DrawingSchema.optional(),
    drawingId: z.string().optional(),
  }),
  z.object({ type: z.literal('replay'), state: ReplayStateSchema }),
  z.object({ type: z.literal('error'), message: z.string(), code: z.string().optional() }),
]);
export type WsServerMessage = z.infer<typeof WsServerMessageSchema>;
export type WsServerMessageType = WsServerMessage['type'];

/** Client → server over the socket is intentionally tiny; commands go through REST. */
export const WsClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping'), ts: z.number() }),
  z.object({ type: z.literal('subscribe'), tfs: z.array(TimeframeSchema) }),
]);
export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;

export function encodeWsMessage(message: WsServerMessage): string {
  return JSON.stringify(message);
}

export function decodeWsServerMessage(raw: string): WsServerMessage {
  return WsServerMessageSchema.parse(JSON.parse(raw));
}
