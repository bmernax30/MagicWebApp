import { z } from 'zod';
const name = z.string().trim().min(1).max(120);
export const settingsSchema = z.strictObject({ number_of_players: z.number().int().min(2).max(6), starting_life_total: z.number().int().min(1).max(999), game_type: z.enum(['Commander', 'Standard']), planechase_enabled: z.boolean() });
export const createGameSchema = z.strictObject({ settings: settingsSchema });
const base = { id: z.uuid(), round: z.number().int().min(1), revision: z.number().int().min(0) };
const player = z.number().int().min(1).max(6);
export const actionSchema = z.discriminatedUnion('type', [
    z.strictObject({ ...base, type: z.literal('counter'), player, counter: z.enum(['life', 'poison', 'commander']), source: player.optional(), delta: z.union([z.literal(-5), z.literal(-1), z.literal(1), z.literal(5)]) }),
    z.strictObject({ ...base, type: z.literal('visibility'), player }),
    z.strictObject({ ...base, type: z.literal('finish') }),
    z.strictObject({ ...base, type: z.literal('exit') }),
    z.strictObject({ ...base, type: z.literal('join'), player, name, commander: z.string().trim().max(120) }),
    z.strictObject({ ...base, type: z.literal('restart') }),
    z.strictObject({ ...base, type: z.literal('plane'), direction: z.enum(['next', 'previous']) }),
]);
const mana = z.enum(['white', 'blue', 'black', 'red', 'green', 'colorless']);
const costs = z.record(mana, z.number().int().min(0).max(999));
const image = z.string().max(300).refine(v => v === '' || (v.startsWith('res/commanders/') && !v.includes('..') && /\.(png|webp|jpg|jpeg)$/i.test(v)), 'Use a bundled commander image path.');
const stats = { name: z.string().max(120), image_path: image, text_path: z.string().max(300).optional(), attack_power: z.number().int().min(0).max(999), defense_power: z.number().int().min(0).max(999), colors: z.array(mana).max(6), color_cost: costs };
export const catalogWriteSchema = z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('settings'), settings: settingsSchema }),
    z.strictObject({ type: z.literal('profile'), name, commanders: z.array(name).max(200) }),
    z.strictObject({ type: z.literal('commander'), name, rules: z.string().max(30000), metadata: z.strictObject({ primary_name: name, image_path: image, text_path: z.string().max(300).optional(), attack_power: stats.attack_power, defense_power: stats.defense_power, colors: stats.colors, color_cost: costs, second_commander: z.strictObject({ ...stats, enabled: z.boolean() }) }) }),
    z.strictObject({ type: z.literal('deleteProfile'), name }),
    z.strictObject({ type: z.literal('deleteCommander'), name }),
]);
export type GameAction = z.infer<typeof actionSchema>;
