import { relations } from 'drizzle-orm';
import { pgTable, uuid, varchar, bigint, integer, decimal, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  walletAddr: varchar('wallet_addr', { length: 48 }).unique().notNull(),
  username: varchar('username', { length: 64 }),
  tonHandle: varchar('ton_handle', { length: 128 }),
  xp: bigint('xp', { mode: 'number' }).default(0).notNull(),
  level: integer('level').default(1).notNull(),
  streakDays: integer('streak_days').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const goals = pgTable('goals', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  title: varchar('title', { length: 256 }).notNull(),
  description: varchar('description', { length: 512 }),
  emoji: varchar('emoji', { length: 8 }),
  visibility: varchar('visibility', { length: 16 }).default('private').notNull(),
  strategy: varchar('strategy', { length: 32 }).default('tonstakers').notNull(),
  contractAddress: varchar('contract_address', { length: 80 }),
  targetTon: decimal('target_ton', { precision: 18, scale: 8 }).default('0').notNull(),
  currentTon: decimal('current_ton', { precision: 18, scale: 8 }).default('0').notNull(),
  targetUsd: decimal('target_usd', { precision: 12, scale: 2 }).notNull(),
  currentUsd: decimal('current_usd', { precision: 12, scale: 2 }).default('0').notNull(),
  dueDate: timestamp('due_date', { withTimezone: true }),
  isArchived: boolean('is_archived').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const dens = pgTable('dens', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').references(() => users.id).notNull(),
  name: varchar('name', { length: 128 }).notNull(),
  emoji: varchar('emoji', { length: 8 }),
  isPublic: boolean('is_public').default(true).notNull(),
  strategy: varchar('strategy', { length: 32 }).notNull(), // 'steady' | 'adventurous'
  contractAddress: varchar('contract_address', { length: 80 }),
  apr: decimal('apr', { precision: 5, scale: 2 }),
  totalDeposited: decimal('total_deposited', { precision: 18, scale: 8 }).default('0').notNull(),
  memberCount: integer('member_count').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const denDeposits = pgTable('den_deposits', {
  id: uuid('id').primaryKey().defaultRandom(),
  denId: uuid('den_id').references(() => dens.id).notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  amountTon: decimal('amount_ton', { precision: 18, scale: 8 }).notNull(),
  txHash: varchar('tx_hash', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const quests = pgTable('quests', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  questKey: varchar('quest_key', { length: 64 }).notNull(),
  progress: integer('progress').default(0).notNull(),
  completed: boolean('completed').default(false).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const activityLog = pgTable('activity_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  type: varchar('type', { length: 32 }).notNull(),
  data: jsonb('data'),
  xpEarned: bigint('xp_earned', { mode: 'number' }).default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const leaderboard = pgTable('leaderboard', {
  userId: uuid('user_id').references(() => users.id).primaryKey().notNull(),
  xp: bigint('xp', { mode: 'number' }).notNull(),
  rank: integer('rank').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Goal = typeof goals.$inferSelect;
export type NewGoal = typeof goals.$inferInsert;
export type Den = typeof dens.$inferSelect;
export type NewDen = typeof dens.$inferInsert;
export type DenDeposit = typeof denDeposits.$inferSelect;
export type NewDenDeposit = typeof denDeposits.$inferInsert;
export type Quest = typeof quests.$inferSelect;
export type NewQuest = typeof quests.$inferInsert;
export type ActivityLog = typeof activityLog.$inferSelect;
export type LeaderboardEntry = typeof leaderboard.$inferSelect;

export const denDepositsRelations = relations(denDeposits, ({ one }) => ({
  den: one(dens, {
    fields: [denDeposits.denId],
    references: [dens.id],
  }),
  user: one(users, {
    fields: [denDeposits.userId],
    references: [users.id],
  }),
}));
