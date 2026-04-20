// Gamification Service - XP, Levels, Quests, Leaderboard

import { log } from '../lib/logger.js';

// XP rewards for different actions
export const XP_REWARDS: Record<string, number> = {
  first_deposit: 100,
  deposit: 25,
  goal_created: 50,
  goal_completed: 500,
  den_joined: 75,
  den_created: 100,
  daily_login: 10,
  streak_bonus: 20,
  quest_completed: 50,
  level_up: 100,
};

// Level progression constants
const BASE_XP_PER_LEVEL = 100;
const LEVEL_MULTIPLIER = 1.5;

// Level calculation result
export interface LevelInfo {
  level: number;
  xpInLevel: number;
  xpForNext: number;
  totalXp: number;
}

// Calculate level from total XP
export function calculateLevelFromXp(xp: number): LevelInfo {
  if (xp < 0) xp = 0;
  
  let level = 1;
  let totalNeeded = BASE_XP_PER_LEVEL;
  
  // Calculate which level the user is at
  while (xp >= totalNeeded && level < 100) {
    level++;
    totalNeeded = Math.floor(totalNeeded * LEVEL_MULTIPLIER);
  }
  
  // Calculate XP in current level
  const prevTotal = level > 1 
    ? Math.floor(BASE_XP_PER_LEVEL * Math.pow(LEVEL_MULTIPLIER, level - 2)) 
    : 0;
  const xpInLevel = xp - prevTotal;
  const xpForNext = totalNeeded - xp;
  
  return {
    level,
    xpInLevel,
    xpForNext,
    totalXp: xp,
  };
}

// Get XP needed for a specific level
export function getXpNeededForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.floor(BASE_XP_PER_LEVEL * Math.pow(LEVEL_MULTIPLIER, level - 2));
}

// Get XP reward for an action
export function calculateXp(action: string): number {
  return XP_REWARDS[action] || 0;
}

// Quest definitions with progression requirements
export const QUEST_DEFINITIONS = [
  {
    key: 'first_deposit',
    title: 'First Steps',
    hint: 'Make your first deposit to start your savings journey',
    reward: 100,
    type: 'single',
  },
  {
    key: 'create_goal',
    title: 'Dream Builder',
    hint: 'Create your first savings goal',
    reward: 50,
    type: 'single',
  },
  {
    key: 'join_den',
    title: 'Community Saver',
    hint: 'Join your first Money Den',
    reward: 75,
    type: 'single',
  },
  {
    key: 'streak_3',
    title: 'Getting Consistent',
    hint: 'Save for 3 days in a row',
    reward: 50,
    type: 'progress',
    target: 3,
  },
  {
    key: 'streak_7',
    title: 'Weekly Warrior',
    hint: 'Save for 7 days in a row',
    reward: 150,
    type: 'progress',
    target: 7,
  },
  {
    key: 'streak_30',
    title: 'Monthly Master',
    hint: 'Save for 30 days in a row',
    reward: 500,
    type: 'progress',
    target: 30,
  },
  {
    key: 'three_dens',
    title: 'Diversified',
    hint: 'Join 3 different Money Dens',
    reward: 200,
    type: 'progress',
    target: 3,
  },
  {
    key: 'goal_completed',
    title: 'Goal Getter',
    hint: 'Complete a savings goal',
    reward: 500,
    type: 'single',
  },
  {
    key: 'level_5',
    title: 'Rising Star',
    hint: 'Reach level 5',
    reward: 100,
    type: 'milestone',
    target: 5,
  },
  {
    key: 'level_10',
    title: 'Savings Expert',
    hint: 'Reach level 10',
    reward: 300,
    type: 'milestone',
    target: 10,
  },
  {
    key: 'level_25',
    title: 'DeFi Master',
    hint: 'Reach level 25',
    reward: 1000,
    type: 'milestone',
    target: 25,
  },
  {
    key: 'deposit_100',
    title: 'Century Club',
    hint: 'Deposit 100 TON total',
    reward: 250,
    type: 'progress',
    target: 100,
  },
];

// Process activity and award XP
export async function processActivity(
  userId: string,
  action: string,
  data: Record<string, any>,
  updateFn: (userId: string, xpToAdd: number) => Promise<void>
): Promise<{ xpEarned: number; levelUp: boolean }> {
  const xpEarned = calculateXp(action);
  
  if (xpEarned > 0) {
    await updateFn(userId, xpEarned);
    log.info('GAMIFICATION', 'XP awarded', { userId, action, xpEarned });
  }
  
  return { xpEarned, levelUp: false };
}

export const gamificationService = {
  XP_REWARDS,
  calculateLevelFromXp,
  getXpNeededForLevel,
  calculateXp,
  QUEST_DEFINITIONS,
  processActivity,
};
