import type { GameConfig } from "@/lib/types";

export const DEFAULT_CONFIG: GameConfig = {
  tuning: {
low: { entry: 500, failPct: 5, roundWin: 10, roundLoss: 5, passReward: 125 },
mid: { entry: 1000, failPct: 10, roundWin: 20, roundLoss: 10, passReward: 250 },
high: { entry: 2000, failPct: 20, roundWin: 40, roundLoss: 20, passReward: 500 },
  },
  rewardMultiplier: 1,
  welfare: {
    startBonus: 10000,
    dailyGrantActive: true,
    dailyGrantAmount: 10000,
    checkinMultiplier: 1,
    inviterBonus: 2000,
    inviteeBonus: 5000,
    inviteMonthlyCap: 10,
    firstClearMultiplier: 1.5,
    replayMultiplier: 0.3,
    endingBonus: 1000,
  },
  caps: {
    daily: 12000,
    weekly: 60000,
    dailyMult: 1,
    weeklyMult: 1,
    overflowRate: 0.2,
  },
  social: { dailyGiftLimit: 3 },
  shop: {
    weapon: { price: 800, buyback: 400, active: true },
    energy: { price: 500, buyback: 250, active: true },
    wisdom: { price: 1200, buyback: 600, active: true },
    help: { price: 1500, buyback: 750, active: true },
    chance: { price: 3000, buyback: 1500, active: true },
  },
  games: {
    xiangyu: { enabled: true },
    normandy: { enabled: true },
    gladiator: { enabled: true },
  },
  piExchange: {
    pointsPerPi: 10000,
    pointsPerToken: 100,
    walletAddress: "",
    memoHint: "",
  },
  leaderboardRewards: [
    { from: 1, to: 1, points: 5000, tokens: 10 },
    { from: 2, to: 3, points: 3000, tokens: 0 },
    { from: 4, to: 10, points: 1500, tokens: 0 },
    { from: 11, to: 50, points: 500, tokens: 0 },
  ],
  events: [],
};
