import fs from 'fs';
import path from 'path';
import { AppUser, VoiceRoom, AgentTransferLog, PrivateMessage } from '../src/types';

const DB_FILE = path.join(process.cwd(), 'db.json');

export interface DatabaseSchema {
  users: AppUser[];
  rooms: VoiceRoom[];
  transactions: AgentTransferLog[];
  agentBalance: number;
  privateMessages: PrivateMessage[];
  giftLogs?: any[];
  clans?: any[];
  badges?: any[];
  agentsHub?: {
    agent_id: string;
    agent_name: string;
    contact_whatsapp: string;
    is_active: boolean;
  }[];
  agentTransferLogs?: {
    id: string;
    agent_id: string;
    agent_name: string;
    receiver_id: string;
    receiver_name: string;
    coins_amount: number;
    timestamp: string;
  }[];
}

const DEFAULT_USERS: AppUser[] = [];

const DEFAULT_ROOMS: VoiceRoom[] = [];

const DEFAULT_TRANSACTIONS: AgentTransferLog[] = [];

export function initDb(): DatabaseSchema {
  if (!fs.existsSync(DB_FILE)) {
    const defaultDb: DatabaseSchema = {
      users: DEFAULT_USERS,
      rooms: DEFAULT_ROOMS,
      transactions: DEFAULT_TRANSACTIONS,
      agentBalance: 250000,
      privateMessages: []
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb, null, 2), 'utf-8');
    return defaultDb;
  }
  try {
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(data) as DatabaseSchema;
    
    // Backfill missing fields
    if (!parsed.privateMessages) {
      parsed.privateMessages = [];
    }
    if (!parsed.users) {
      parsed.users = [];
    }
    if (!parsed.clans) {
      parsed.clans = [];
    }
    if (!parsed.agentsHub) {
      parsed.agentsHub = [
        {
          agent_id: "1004",
          agent_name: "خالد الحربي (الوكيل المعتمد)",
          contact_whatsapp: "https://wa.me/966500000000",
          is_active: true
        },
        {
          agent_id: "1001",
          agent_name: "أحمد العتيبي (الوكيل الذهبي)",
          contact_whatsapp: "https://wa.me/966511111111",
          is_active: true
        }
      ];
    }
    if (!parsed.agentTransferLogs) {
      parsed.agentTransferLogs = [];
    }
    if (!parsed.badges) {
      parsed.badges = [
        { badgeId: 'diamond_supporter', badgeName: 'الشاحن الماسي', badgeIcon: '💎', unlockCriteria: 'إرسال هدايا بقيمة 50,000 كوينز' },
        { badgeId: 'elite_host', badgeName: 'المضيف النجم', badgeIcon: '⭐', unlockCriteria: 'تلقي هدايا بقيمة 10,000 كوينز' },
        { badgeId: 'loyal_member', badgeName: 'عضو القبيلة', badgeIcon: '🛡️', unlockCriteria: 'الانضمام إلى عائلة نشطة' }
      ];
    }
    parsed.users = parsed.users.map(u => {
      let r = u.role;
      if (!r) {
        if (u.id === '1001') r = 'admin';
        else if (u.id === '1004' || u.isAgent) r = 'agent';
        else r = 'user';
      }
      return {
        ...u,
        role: r,
        bio: u.bio !== undefined ? u.bio : 'عضو مميز في صدى العرب ☕',
        followers: Array.isArray(u.followers) ? u.followers : [],
        following: Array.isArray(u.following) ? u.following : [],
        clanId: u.clanId || undefined,
        senderXp: u.senderXp !== undefined ? u.senderXp : 0,
        charmXp: u.charmXp !== undefined ? u.charmXp : 0,
        badges: Array.isArray(u.badges) ? u.badges : [],
        vipLevel: u.vipLevel !== undefined ? u.vipLevel : 1
      };
    });

    return parsed;
  } catch (error) {
    console.error('Error reading db.json, recreating...', error);
    const defaultDb: DatabaseSchema = {
      users: DEFAULT_USERS,
      rooms: DEFAULT_ROOMS,
      transactions: DEFAULT_TRANSACTIONS,
      agentBalance: 250000,
      privateMessages: []
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb, null, 2), 'utf-8');
    return defaultDb;
  }
}

export function getDb(): DatabaseSchema {
  // Always trigger initDb which reads and backfills
  const db = initDb();
  return db;
}

export function saveDb(data: DatabaseSchema) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}
