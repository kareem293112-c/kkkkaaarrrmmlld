import { Gift } from '../types';

export const INITIAL_GIFT_BALANCE = 10; // Welcome Bonus

export const GIFTS: Gift[] = [
  {
    id: 'g1',
    name: 'Arabic Coffee',
    arabicName: 'قهوة شيوخ',
    icon: '☕',
    cost: 1,
    xpReward: 10,
    isPremium: false,
  },
  {
    id: 'g2',
    name: 'Oud Incense',
    arabicName: 'بخور عود',
    icon: '🪵',
    cost: 5,
    xpReward: 60,
    isPremium: false,
  },
  {
    id: 'g3',
    name: 'Arabian Falcon',
    arabicName: 'صقر شاهين',
    icon: '🦅',
    cost: 20,
    xpReward: 250,
    isPremium: true,
  },
  {
    id: 'g4',
    name: 'Luxury Sports Car',
    arabicName: 'سيارة فاخرة',
    icon: '🏎️',
    cost: 100,
    xpReward: 1500,
    isPremium: true,
  },
  {
    id: 'g5',
    name: 'Golden Dagger',
    arabicName: 'خنجر ذهبي',
    icon: '🗡️',
    cost: 500,
    xpReward: 8000,
    isPremium: true,
  },
];
