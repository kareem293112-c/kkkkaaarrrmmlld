/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface AppUser {
  id: string;
  name: string;
  avatar: string;
  level: number;
  coins: number;
  xp: number;
  isAgent?: boolean;
  role?: 'user' | 'agent' | 'admin';
  bio?: string;
  followers?: string[];
  following?: string[];
  clanId?: string;
  senderXp?: number;
  charmXp?: number;
  badges?: string[];
  vipLevel?: number;
}

export interface Clan {
  clanId: string;
  clanName: string;
  clanLogo: string;
  ownerId: string;
  totalXp: number;
}

export interface Badge {
  badgeId: string;
  badgeName: string;
  badgeIcon: string;
  unlockCriteria: string;
}

export interface PrivateMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  receiverId: string;
  receiverName: string;
  text: string;
  timestamp: string;
  isEncrypted?: boolean;
  rawCiphertext?: string;
  iv?: string;
  isRead?: boolean;
}

export interface VoiceSeat {
  index: number; // 0 = Host, 1 to 8 = Guests
  userId: string | null; // null if seat is empty
  isMuted: boolean;
  isLocked: boolean;
}

export interface VoiceRoom {
  id: string;
  name: string;
  hostName: string;
  hostAvatar: string;
  isPrivate: boolean;
  password?: string;
  level: number;
  xp: number;
  activeUsersCount: number;
  seats: VoiceSeat[];
  owner_id?: string;
}

export interface AgentTransferLog {
  id: string;
  senderId: string;
  senderName: string;
  receiverId: string;
  receiverName: string;
  amount: number;
  timestamp: string;
}

export interface Gift {
  id: string;
  name: string;
  arabicName: string;
  icon: string;
  cost: number;
  xpReward: number;
  isPremium: boolean;
}

export interface BlueprintFile {
  name: string;
  path: string;
  language: string;
  content: string;
}

export interface FolderNode {
  name: string;
  type: 'folder' | 'file';
  path: string;
  children?: FolderNode[];
  contentKey?: string;
}
