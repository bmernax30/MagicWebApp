import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
export const settings = sqliteTable('settings', { key: text('key').primaryKey(), value: text('value').notNull() });
export const profiles = sqliteTable('profiles', { name: text('name').primaryKey(), wins: integer('wins').notNull().default(0) });
export const commanders = sqliteTable('commanders', { name: text('name').primaryKey(), wins: integer('wins').notNull().default(0), metadata: text('metadata').notNull(), rules: text('rules').notNull().default('') });
export const profileCommanders = sqliteTable('profile_commanders', { profile: text('profile').notNull().references(() => profiles.name), commander: text('commander').notNull().references(() => commanders.name) }, t => [primaryKey({ columns: [t.profile, t.commander] })]);
export const planes = sqliteTable('planes', { name: text('name').primaryKey(), image: text('image').notNull(), rules: text('rules').notNull() });
export const games = sqliteTable('games', { code: text('code').primaryKey(), state: text('state').notNull(), revision: integer('revision').notNull().default(0), createdAt: text('created_at').notNull() });
export const actions = sqliteTable('actions', { game: text('game').notNull().references(() => games.code), id: text('id').notNull(), payload: text('payload').notNull(), revision: integer('revision').notNull() }, t => [primaryKey({ columns: [t.game, t.id] })]);
