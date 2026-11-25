import { z } from 'zod';
import { EMOTES } from './emotes';
const name = z.string().trim().min(1).max(120);
export const settingsSchema = z.strictObject({ number_of_players: z.number().int().min(2).max(6), starting_life_total: z.number().int().min(1).max(999), game_type: z.enum(['Commander', 'Standard']), planechase_enabled: z.boolean() });
export const createGameSchema = z.strictObject({ settings: settingsSchema });
const base = { seatVersion: z.number().int().min(0).optional(), id: z.uuid(), round: z.number().int().min(1), revision: z.number().int().min(0) };
const player = z.number().int().min(1).max(6);
export const actionSchema = z.discriminatedUnion('type', [
    z.strictObject({ ...base, type: z.literal('counter'), player, counter: z.enum(['life', 'poison', 'commander']), source: player.optional(), sourceVersion: z.number().int().min(0).optional(), delta: z.number().int().min(-999999).max(999999).refine(n => n !== 0, 'Change must be nonzero') }),
    z.strictObject({ ...base, type: z.literal('visibility'), player }),
    z.strictObject({ ...base, type: z.literal('reveal'), player }),
    z.strictObject({ ...base, type: z.enum(['kick', 'leave']), player }),
    z.strictObject({ ...base, type: z.literal('emote'), player, target: player, emote: z.enum(EMOTES.map(e => e.id)) }),
    z.strictObject({ ...base, type: z.literal('change-commander'), player, commander: z.string().trim().max(600), hidden: z.boolean().optional() }),
    z.strictObject({ ...base, type: z.literal('undo'), eventId: z.uuid() }),
    z.strictObject({ ...base, type: z.literal('finish') }),
    z.strictObject({ ...base, type: z.literal('exit') }),
    z.strictObject({ ...base, type: z.literal('join'), player, name, commander: z.string().trim().max(600), hidden: z.boolean().optional() }),
    z.strictObject({ ...base, type: z.literal('restart') }),
    z.strictObject({ ...base, type: z.literal('plane'), direction: z.enum(['next', 'previous']) }),
]);
export const catalogWriteSchema = z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('settings'), settings: settingsSchema }),
    z.strictObject({ type: z.literal('profile'), name }),
    z.strictObject({ type: z.literal('deleteProfile'), name }),
]);
export type GameAction = z.infer<typeof actionSchema>;
