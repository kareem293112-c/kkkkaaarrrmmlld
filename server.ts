import cors from 'cors';
import express from "express";
import path from "path";
import http from "http";
import 'dotenv/config';
import agoraToken from 'agora-access-token';
const { RtcTokenBuilder, RtcRole } = agoraToken as any;
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import { getDb, saveDb, initDb } from "./server/db";
import { VoiceRoom, PrivateMessage } from "./src/types";
import { initializeApp, getApps, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { GoogleAuth } from "google-auth-library";

// Initialize local database
initDb();

// Dynamic PORT assignment for Render or any platform
const PORT = process.env.PORT || 3000;

// Initialize Firebase Admin SDK lazily with fallback
let firestoreDbInstance: any = null;
let firebaseInitialized = false;
let firestoreDisabled = false;

async function checkFirestoreAccess() {
  if (firestoreDisabled) return;
  try {
    try {
      const auth = new GoogleAuth();
      await auth.getApplicationDefault();
    } catch (credentialError: any) {
      console.warn("⚠️ Google Application Default Credentials are not available. Local DB active.");
      firestoreDbInstance = null;
      firebaseInitialized = true;
      firestoreDisabled = true;
      return;
    }

    const apps = getApps();
    const customDbId = "ai-studio-sadaalarabvoiceb-5f452604-580f-4265-ab18-da9c404b3698";
    const projectId = "gen-lang-client-0348881645";
    
    let app;
    if (apps.length === 0) {
      app = initializeApp({
        credential: applicationDefault(),
        projectId: projectId
      });
    } else {
      app = apps[0];
    }

    const tempDb = getFirestore(app, customDbId);
    await tempDb.collection("users").limit(1).get();
    
    firestoreDbInstance = tempDb;
    firebaseInitialized = true;
    console.log("Firestore connection verified. Operating in Cloud Database mode.");
  } catch (error: any) {
    console.log("Firestore is offline or unauthorized. Operating in secure Local JSON storage mode.");
    firestoreDbInstance = null;
    firebaseInitialized = true;
    firestoreDisabled = true;
  }
}

function getFirestoreDb() {
  if (firestoreDisabled || !firebaseInitialized) return null;
  return firestoreDbInstance;
}

const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

interface CustomWebSocket extends WebSocket {
  roomId?: string;
  userId?: string;
  userName?: string;
}

const roomClients = new Map<string, Set<CustomWebSocket>>();

// Broadcast to room helper
function broadcastToRoom(roomId: string, message: any, excludeClient?: CustomWebSocket) {
  const clients = roomClients.get(roomId);
  if (!clients) return;
  const msgString = JSON.stringify(message);
  for (const client of clients) {
    if (client !== excludeClient && client.readyState === WebSocket.OPEN) {
      client.send(msgString);
    }
  }
}

// Broadcast active room users list to everyone in that room
function broadcastRoomUsers(roomId: string) {
  const clients = roomClients.get(roomId);
  if (!clients) return;
  const db = getDb();
  const activeUsers: Array<{ id: string; name: string; avatar: string }> = [];
  for (const client of clients) {
    if (client.userId && client.readyState === WebSocket.OPEN) {
      const u = db.users.find(user => user.id === client.userId);
      activeUsers.push({
        id: client.userId,
        name: client.userName || u?.name || 'مستشار صدى',
        avatar: u?.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${client.userId}`
      });
    }
  }
  const uniqueUsers = Array.from(new Map(activeUsers.map(item => [item.id, item])).values());
  broadcastToRoom(roomId, {
    type: "room_users_changed",
    users: uniqueUsers
  });
}

// Helper to stand up when leaving or disconnecting
async function handleUserStandUpFromSeat(roomId: string, userId: string) {
  if (!roomId || !userId) return;
  const db = getDb();
  const rIdx = db.rooms.findIndex(r => r.id === roomId);
  if (rIdx !== -1) {
    const room = db.rooms[rIdx];
    let changed = false;
    const updatedSeats = room.seats.map(seat => {
      if (seat.userId === userId) {
        changed = true;
        return { ...seat, userId: null };
      }
      return seat;
    });

    if (changed) {
      db.rooms[rIdx].seats = updatedSeats;
      saveDb(db);

      const fDb = getFirestoreDb();
      if (fDb) {
        try {
          const roomRef = fDb.collection("voice_rooms").doc(roomId);
          const batch = fDb.batch();
          for (const seat of updatedSeats) {
            const seatRef = roomRef.collection("mic_seats").doc(seat.index.toString());
            batch.set(seatRef, {
              seat_number: seat.index,
              current_user_id: seat.userId || null,
              is_locked: seat.isLocked || false,
              is_muted: seat.isMuted || false
            }, { merge: true });
          }
          await batch.commit();
        } catch (e) {
          console.error("Firestore batch standup seat update error:", e);
        }
      }

      broadcastToRoom(roomId, {
        type: "seats_changed",
        seats: updatedSeats
      });
    }
  }
}

// WebSocket Connection Handler
wss.on("connection", (ws: CustomWebSocket) => {
  console.log("جديد: متصل بالـ WebSocket");

  ws.on("message", async (messageBuffer) => {
    try {
      const data = JSON.parse(messageBuffer.toString());
      const { action, roomId, userId, userName } = data;

      if (action === "join") {
        ws.roomId = roomId;
        ws.userId = userId;
        ws.userName = userName;

        if (!roomClients.has(roomId)) {
          roomClients.set(roomId, new Set());
        }
        roomClients.get(roomId)!.add(ws);

        console.log(`المستخدم ${userName} (${userId}) دخل الغرفة ${roomId}`);

        broadcastToRoom(roomId, {
          type: "system_message",
          text: `دخل ${userName} إلى المجلس`,
          userId,
          userName,
          timestamp: new Date().toISOString()
        }, ws);

        ws.send(JSON.stringify({
          type: "join_success",
          roomId,
          message: "تم الاتصال بالغرفة بنجاح وبث الصوت وتزامن المقاعد نشط!"
        }));

        broadcastRoomUsers(roomId);
      }

      else if (action === "leave") {
        if (ws.roomId && ws.userId) {
          await handleUserStandUpFromSeat(ws.roomId, ws.userId);
        }
        const savedRoomId = ws.roomId;
        if (ws.roomId && roomClients.has(ws.roomId)) {
          roomClients.get(ws.roomId)!.delete(ws);
        }
        if (savedRoomId) {
          broadcastRoomUsers(savedRoomId);
        }
      }

      else if (action === "register") {
        ws.userId = userId;
        ws.userName = userName;
        console.log(`المستخدم ${userName} (${userId}) سجل اتصاله العام بالـ WebSocket`);
      }

      else if (action === "seats_update") {
        const { seats } = data;
        const db = getDb();
        const rIdx = db.rooms.findIndex(r => r.id === roomId);
        if (rIdx !== -1) {
          db.rooms[rIdx].seats = seats;
          saveDb(db);
        }

        const fDb = getFirestoreDb();
        if (fDb) {
          try {
            const roomRef = fDb.collection("voice_rooms").doc(roomId);
            const batch = fDb.batch();
            for (const seat of seats) {
              const seatRef = roomRef.collection("mic_seats").doc(seat.index.toString());
              batch.set(seatRef, {
                seat_number: seat.index,
                current_user_id: seat.userId || null,
                is_locked: seat.isLocked || false,
                is_muted: seat.isMuted || false
              }, { merge: true });
            }
            await batch.commit();
          } catch (e) {
            console.error("Firestore batch seat update error:", e);
          }
        }
        
        broadcastToRoom(roomId, {
          type: "seats_changed",
          seats
        }, ws);
      }

      else if (action === "chat_message") {
        const { text, avatar, senderLevel } = data;
        broadcastToRoom(roomId, {
          type: "new_chat_message",
          id: Math.random().toString(36).substring(7),
          senderId: userId,
          senderName: userName,
          senderAvatar: avatar,
          senderLevel,
          text,
          timestamp: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
        });
      }

      else if (action === "send_gift") {
        const { gift, senderId, receiverId, receiverSeatIndex } = data;
        const db = getDb();
        const sender = db.users.find(u => u.id === senderId);
        const receiver = db.users.find(u => u.id === receiverId);

        if (sender && sender.coins >= gift.cost) {
          sender.coins -= gift.cost;
          sender.xp += gift.xpReward;
          sender.level = Math.floor(1 + Math.sqrt(sender.xp / 100));

          if (receiver) {
            receiver.coins += gift.cost * 0.5;
            receiver.xp += gift.xpReward * 0.8;
            receiver.level = Math.floor(1 + Math.sqrt(receiver.xp / 100));
          }

          const room = db.rooms.find(r => r.id === roomId);
          if (room) {
            room.xp += gift.xpReward;
            room.level = Math.floor(1 + Math.sqrt(room.xp / 300));
          }

          saveDb(db);

          broadcastToRoom(roomId, {
            type: "gift_received",
            gift,
            senderId,
            senderName: sender.name,
            senderCoins: sender.coins,
            senderLevel: sender.level,
            receiverId,
            receiverName: receiver ? receiver.name : "المقعد " + receiverSeatIndex,
            receiverSeatIndex,
            roomXp: room ? room.xp : 0,
            roomLevel: room ? room.level : 1,
            floatingId: Math.random()
          });
        } else {
          ws.send(JSON.stringify({
            type: "error",
            message: "رصيدك غير كافي لشراء وإرسال هذه الهدية!"
          }));
        }
      }
    } catch (e) {
      console.error("Error processing websocket message:", e);
    }
  });

  ws.on("close", async () => {
    if (ws.roomId && ws.userId) {
      await handleUserStandUpFromSeat(ws.roomId, ws.userId);
    }
    const savedRoomId = ws.roomId;
    if (ws.roomId && roomClients.has(ws.roomId)) {
      roomClients.get(ws.roomId)!.delete(ws);
    }
    if (savedRoomId) {
      broadcastRoomUsers(savedRoomId);
    }
  });
});

// ==================== REST API ENDPOINTS ====================

// Get whole DB for diagnosis
app.get("/api/db", (req, res) => {
  res.json(getDb());
});

// Get users list
app.get("/api/users", async (req, res) => {
  const fDb = getFirestoreDb();
  if (fDb) {
    try {
      const snap = await fDb.collection("users").get();
      const list: any[] = [];
      snap.forEach((doc: any) => {
        const d = doc.data();
        list.push({
          id: doc.id,
          name: d.username || d.name,
          avatar: d.avatar_url || d.avatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=120",
          level: d.vip_level || d.level || 1,
          coins: d.coins_balance !== undefined ? d.coins_balance : (d.coins || 0),
          xp: d.sender_xp || d.xp || 0,
          role: d.role || "user",
          bio: d.bio || "عضو مميز في صدى العرب ☕",
          followers: d.followers || [],
          following: d.following || [],
          clanId: d.clan_id || d.clanId || undefined,
          senderXp: d.sender_xp || 0,
          charmXp: d.charm_xp || 0,
          badges: d.badges || [],
          vipLevel: d.vip_level || d.level || 1
        });
      });
      return res.json(list);
    } catch (e) {
      console.warn("Firestore list users error, fallback to local:", e);
    }
  }
  res.json(getDb().users);
});

// Get user profile by ID
app.get("/api/users/:id", async (req, res) => {
  const fDb = getFirestoreDb();
  if (fDb) {
    try {
      const doc = await fDb.collection("users").doc(req.params.id).get();
      if (doc.exists) {
        const d = doc.data()!;
        return res.json({
          id: doc.id,
          name: d.username || d.name,
          avatar: d.avatar_url || d.avatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=120",
          level: d.vip_level || d.level || 1,
          coins: d.coins_balance !== undefined ? d.coins_balance : (d.coins || 0),
          xp: d.sender_xp || d.xp || 0,
          role: d.role || "user",
          bio: d.bio || "عضو مميز في صدى العرب ☕",
          followers: d.followers || [],
          following: d.following || [],
          clanId: d.clan_id || d.clanId || undefined,
          senderXp: d.sender_xp || 0,
          charmXp: d.charm_xp || 0,
          badges: d.badges || [],
          vipLevel: d.vip_level || d.level || 1
        });
      }
    } catch (e) {
      console.warn("Firestore fetch user error, fallback to local:", e);
    }
  }

  const user = getDb().users.find(u => u.id === req.params.id);
  if (user) {
    res.json(user);
  } else {
    res.status(404).json({ error: "المستخدم غير موجود" });
  }
});

// Create/Sync user state
app.post("/api/users", async (req, res) => {
  const { id, name, avatar, level, coins, xp } = req.body;
  if (!id || !name) {
    return res.status(400).json({ error: "معرف المستخدم والاسم مطلوبين" });
  }

  const fDb = getFirestoreDb();
  let user: any;

  if (fDb) {
    try {
      const userRef = fDb.collection("users").doc(id);
      const userDoc = await userRef.get();
      if (userDoc.exists) {
        const d = userDoc.data();
        await userRef.update({
          username: name,
          avatar_url: avatar || d?.avatar_url || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=120"
        });
        user = {
          id,
          name,
          avatar: avatar || d?.avatar_url || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=120",
          level: d?.vip_level || d?.level || 1,
          coins: d?.coins_balance !== undefined ? d?.coins_balance : (d?.coins || 10),
          xp: d?.sender_xp || d?.xp || 0
        };
      } else {
        const newUserObj = {
          user_id: id,
          username: name,
          avatar_url: avatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=120",
          coins_balance: coins !== undefined ? coins : 1000,
          vip_level: level || 1,
          sender_xp: xp || 0,
          charm_xp: 0,
          badges: []
        };
        await userRef.set(newUserObj);
        user = {
          id,
          name: newUserObj.username,
          avatar: newUserObj.avatar_url,
          level: newUserObj.vip_level,
          coins: newUserObj.coins_balance,
          xp: newUserObj.sender_xp
        };
      }
    } catch (e) {
      console.warn("Firestore save user error, fallback to local:", e);
    }
  }

  const db = getDb();
  let localUser = db.users.find(u => u.id === id);

  if (localUser) {
    localUser.name = name;
    if (avatar) localUser.avatar = avatar;
    if (user) {
      localUser.level = user.level;
      localUser.coins = user.coins;
      localUser.xp = user.xp;
    }
  } else {
    localUser = {
      id,
      name,
      avatar: avatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=120",
      level: user?.level || level || 1,
      coins: user?.coins !== undefined ? user?.coins : (coins !== undefined ? coins : 1000),
      xp: user?.xp || xp || 0
    };
    db.users.push(localUser);
  }

  saveDb(db);
  res.json(user || localUser);
});

// Server-side active rooms array
const globalRooms: VoiceRoom[] = [
    { id: "room_1", name: "مجلس صدى العرب الرئيسي", hostName: "System", hostAvatar: "", isPrivate: false, level: 1, xp: 0, activeUsersCount: 0, seats: [] }
];

// Get shared voice rooms list
app.get('/api/rooms', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res.json(globalRooms);
});

// Create new room
app.post('/api/rooms', async (req, res) => {
    const { roomName, owner_id, isPrivate, password, hostName, hostAvatar } = req.body;
    if (!roomName) return res.status(400).json({ error: 'اسم المجلس مطلوب' });

    if (owner_id) {
        const hasExisting = globalRooms.some(r => r.owner_id === owner_id);
        if (hasExisting) {
            return res.status(400).json({ success: false, error: 'لديك غرفة بالفعل! لا يمكنك إنشاء أكثر من غرفة واحدة لكل حساب.' });
        }
    }

    const newRoom: VoiceRoom = {
        id: `room_${Date.now()}`,
        name: roomName,
        hostName: hostName || 'مالك المجلس',
        hostAvatar: hostAvatar || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=120',
        isPrivate: !!isPrivate,
        password: password || "",
        level: 1,
        xp: 0,
        activeUsersCount: 0,
        owner_id: owner_id || null,
        seats: Array.from({ length: 10 }, (_, i) => ({
            index: i + 1,
            userId: null,
            isLocked: false,
            isMuted: false
        }))
    };

    const fDb = getFirestoreDb();
    if (fDb && owner_id) {
        try {
            const existingRoom = await fDb.collection("voice_rooms").where("owner_id", "==", owner_id).get();
            if (!existingRoom.empty) {
                return res.status(400).json({ success: false, error: 'لديك غرفة بالفعل! لا يمكنك إنشاء أكثر من غرفة واحدة لكل حساب.' });
            }
            
            await fDb.collection("voice_rooms").doc(newRoom.id).set({
                room_name: roomName,
                owner_id: owner_id,
                is_private: !!isPrivate,
                room_password: password || "",
                max_seats: 10,
                host_name: hostName || 'مالك المجلس',
                host_avatar: hostAvatar || '',
                created_at: FieldValue.serverTimestamp()
            });

            for (let i = 1; i <= 10; i++) {
                await fDb.collection("voice_rooms").doc(newRoom.id).collection("mic_seats").doc(i.toString()).set({
                    seat_number: i,
                    current_user_id: null,
                    is_locked: false,
                    is_muted: false
                });
            }
        } catch (dbErr) {
            console.error("[FIRESTORE-ROOM-CREATE] Failed to mirror room creation:", dbErr);
        }
    }

    globalRooms.push(newRoom);
    console.log(`[ROOM-SERVER] Room created successfully: ${roomName} by owner ${owner_id}`);
    return res.json({ success: true, rooms: globalRooms });
});

// Update room info
app.post("/api/rooms/update", async (req, res) => {
  const { room_id, room_name, host_avatar } = req.body;
  
  const localDb = getDb();
  const room = localDb.rooms.find(r => r.id === room_id);
  if (room) {
    room.name = room_name;
    room.hostAvatar = host_avatar;
    saveDb(localDb);
  }

  const fDb = getFirestoreDb();
  if (fDb) {
    try {
      const roomRef = fDb.collection("voice_rooms").doc(room_id);
      await roomRef.update({
        room_name: room_name,
        host_avatar: host_avatar,
        hostAvatar: host_avatar,
      });
    } catch (error) {
      console.error("Firestore error updating room settings:", error);
    }
  }

  wss.clients.forEach((client: any) => {
    if (client.readyState === WebSocket.OPEN && client.roomId === room_id) {
      client.send(JSON.stringify({
        type: "room_details_changed",
        roomId: room_id,
        name: room_name,
        hostAvatar: host_avatar
      }));
    }
  });

  res.json({ success: true });
});

// Get transfer logs
app.get("/api/transactions", (req, res) => {
  res.json(getDb().transactions);
});

// Get agent balance
app.get("/api/agent/balance", (req, res) => {
  const agent = getDb().users.find(u => u.id === "1004" || u.role === "agent");
  res.json({ balance: agent ? agent.coins : 250000 });
});

// Get active agents list
app.get("/api/agents/hub", async (req, res) => {
  const fDb = getFirestoreDb();
  if (fDb) {
    try {
      const agentsSnap = await fDb.collection("agents_hub").where("is_active", "==", true).get();
      if (!agentsSnap.empty) {
        const agents: any[] = [];
        agentsSnap.forEach((doc: any) => {
          agents.push({ id: doc.id, ...doc.data() });
        });
        return res.json(agents);
      }
    } catch (e) {
      console.warn("Error fetching agents_hub from Firestore, falling back:", e);
    }
  }
  res.json(getDb().agentsHub || []);
});

// Secure Agent to User Transfer API
app.post("/api/agents/transfer", async (req, res) => {
  const { agent_id, receiver_id, coins_amount } = req.body;
  const transferAmount = Number(coins_amount);

  if (!agent_id || !receiver_id || isNaN(transferAmount) || transferAmount <= 0) {
    return res.status(400).json({ error: "بيانات التحويل غير مكتملة أو القيمة غير صالحة" });
  }

  const fDb = getFirestoreDb();
  let agentName = "وكيل معتمد";
  let receiverName = "عضو صدى العرب";

  if (fDb) {
    try {
      const agentRef = fDb.collection("users").doc(agent_id);
      const receiverRef = fDb.collection("users").doc(receiver_id);

      const result = await fDb.runTransaction(async (transaction: any) => {
        const agentDoc = await transaction.get(agentRef);
        const receiverDoc = await transaction.get(receiverRef);

        if (!agentDoc.exists) throw new Error("حساب الوكيل غير موجود في صدى العرب");

        const agentData = agentDoc.data();
        agentName = agentData.username || agentData.name || "وكيل شحن";
        const agentRole = agentData.role || "user";
        const agentBalance = agentData.coins_balance !== undefined ? agentData.coins_balance : (agentData.coins || 0);

        if (agentRole !== "agent" && agentRole !== "admin") {
          throw new Error("المستخدم ليس لديه صلاحية وكيل شحن معتمد");
        }
        if (agentBalance < transferAmount) {
          throw new Error("رصيد الوكيل غير كافي لإتمام هذه العملية");
        }
        if (!receiverDoc.exists) {
          throw new Error("معرف حساب العميل المستهدف غير موجود");
        }

        const receiverData = receiverDoc.data();
        receiverName = receiverData.username || receiverData.name || "عميل";
        const receiverBalance = receiverData.coins_balance !== undefined ? receiverData.coins_balance : (receiverData.coins || 0);

        transaction.update(agentRef, {
          coins_balance: agentBalance - transferAmount,
          coins: agentBalance - transferAmount
        });
        transaction.update(receiverRef, {
          coins_balance: receiverBalance + transferAmount,
          coins: receiverBalance + transferAmount
        });

        const logRef = fDb.collection("agent_transfer_logs").doc();
        transaction.set(logRef, {
          id: logRef.id,
          agent_id,
          agent_name: agentName,
          receiver_id,
          receiver_name: receiverName,
          coins_amount: transferAmount,
          timestamp: FieldValue.serverTimestamp()
        });

        return {
          agentBalance: agentBalance - transferAmount,
          receiverBalance: receiverBalance + transferAmount,
          agentName,
          receiverName
        };
      });

      const localDb = getDb();
      const localAgent = localDb.users.find(u => u.id === agent_id);
      const localReceiver = localDb.users.find(u => u.id === receiver_id);

      if (localAgent) localAgent.coins = result.agentBalance;
      if (localReceiver) localReceiver.coins = result.receiverBalance;

      const localLog = {
        id: `atl_${Date.now()}`,
        agent_id,
        agent_name: result.agentName,
        receiver_id,
        receiver_name: result.receiverName,
        coins_amount: transferAmount,
        timestamp: new Date().toISOString()
      };

      if (!localDb.agentTransferLogs) localDb.agentTransferLogs = [];
      localDb.agentTransferLogs.unshift(localLog);

      localDb.transactions.unshift({
        id: localLog.id,
        senderId: agent_id,
        senderName: result.agentName,
        receiverId: receiver_id,
        receiverName: result.receiverName,
        amount: transferAmount,
        timestamp: localLog.timestamp
      });

      saveDb(localDb);

      const broadcastMsg = {
        type: "agent_transfer_update",
        agentId: agent_id,
        agentBalance: result.agentBalance,
        receiverId: receiver_id,
        receiverBalance: result.receiverBalance,
        log: localLog
      };
      broadcastToRoom("room_1", broadcastMsg);

      return res.json({
        success: true,
        message: `تم شحن ${transferAmount} كوينز بنجاح إلى ${result.receiverName}`,
        agent_balance: result.agentBalance,
        receiver_balance: result.receiverBalance
      });

    } catch (error: any) {
      console.error("Firestore agent transfer failed:", error);
      return res.status(400).json({ error: error.message || "فشلت عملية التحويل عبر السيرفر" });
    }
  }

  // Fallback purely local
  const localDb = getDb();
  const localAgent = localDb.users.find(u => u.id === agent_id);
  const localReceiver = localDb.users.find(u => u.id === receiver_id);

  if (!localAgent) return res.status(404).json({ error: "حساب الوكيل غير موجود محلياً" });

  const agentRole = localAgent.role || "user";
  if (agentRole !== "agent" && agentRole !== "admin") {
    return res.status(403).json({ error: "المستخدم ليس لديه صلاحية وكيل شحن معتمد" });
  }
  if (localAgent.coins < transferAmount) {
    return res.status(400).json({ error: "رصيد الوكيل غير كافي لإتمام هذه العملية" });
  }
  if (!localReceiver) return res.status(404).json({ error: "معرف حساب العميل غير موجود" });

  localAgent.coins -= transferAmount;
  localReceiver.coins += transferAmount;

  const localLog = {
    id: `atl_${Date.now()}`,
    agent_id,
    agent_name: localAgent.name,
    receiver_id,
    receiver_name: localReceiver.name,
    coins_amount: transferAmount,
    timestamp: new Date().toISOString()
  };

  if (!localDb.agentTransferLogs) localDb.agentTransferLogs = [];
  localDb.agentTransferLogs.unshift(localLog);

  localDb.transactions.unshift({
    id: localLog.id,
    senderId: agent_id,
    senderName: localAgent.name,
    receiverId: receiver_id,
    receiverName: localReceiver.name,
    amount: transferAmount,
    timestamp: localLog.timestamp
  });

  saveDb(localDb);

  const broadcastMsg = {
    type: "agent_transfer_update",
    agentId: agent_id,
    agentBalance: localAgent.coins,
    receiverId: receiver_id,
    receiverBalance: localReceiver.coins,
    log: localLog
  };
  broadcastToRoom("room_1", broadcastMsg);

  return res.json({
    success: true,
    message: `تم شحن ${transferAmount} كوينز بنجاح إلى ${localReceiver.name}`,
    agent_balance: localAgent.coins,
    receiver_balance: localReceiver.coins
  });
});

// Leaderboards for Senders, Receivers, and Clans
app.get("/api/leaderboard", async (req, res) => {
  const fDb = getFirestoreDb();
  if (fDb) {
    try {
      const topSendersSnap = await fDb.collection("users").orderBy("sender_xp", "desc").limit(10).get();
      const topReceiversSnap = await fDb.collection("users").orderBy("charm_xp", "desc").limit(10).get();
      const topClansSnap = await fDb.collection("clans").orderBy("total_xp", "desc").limit(10).get();

      const senders = topSendersSnap.docs.map((doc: any) => ({
        id: doc.id,
        name: doc.data().username,
        avatar: doc.data().avatar_url || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=120",
        xp: doc.data().sender_xp || 0,
        vipLevel: doc.data().vip_level || 1,
        badges: doc.data().badges || []
      }));

      const receivers = topReceiversSnap.docs.map((doc: any) => ({
        id: doc.id,
        name: doc.data().username,
        avatar: doc.data().avatar_url || "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=120",
        xp: doc.data().charm_xp || 0,
        vipLevel: doc.data().vip_level || 1,
        badges: doc.data().badges || []
      }));

      const clans = topClansSnap.docs.map((doc: any) => ({
        clanId: doc.id,
        clanName: doc.data().clan_name,
        clanLogo: doc.data().clan_logo || "🛡️",
        ownerId: doc.data().owner_id,
        totalXp: doc.data().total_xp || 0
      }));

      return res.json({ senders, receivers, clans });
    } catch (e) {
      console.warn("Firestore leaderboard fetch failed, falling back to local:", e);
    }
  }

  const localDb = getDb();
  const senders = [...localDb.users]
    .sort((a, b) => (b.senderXp || 0) - (a.senderXp || 0))
    .slice(0, 10)
    .map(u => ({
      id: u.id,
      name: u.name,
      avatar: u.avatar,
      xp: u.senderXp || 0,
      vipLevel: u.vipLevel || 1,
      badges: u.badges || []
    }));

  const receivers = [...localDb.users]
    .sort((a, b) => (b.charmXp || 0) - (a.charmXp || 0))
    .slice(0, 10)
    .map(u => ({
      id: u.id,
      name: u.name,
      avatar: u.avatar,
      xp: u.charmXp || 0,
      vipLevel: u.vipLevel || 1,
      badges: u.badges || []
    }));

  const clans = [...(localDb.clans || [])]
    .sort((a, b) => (b.totalXp || 0) - (a.totalXp || 0))
    .slice(0, 10);

  res.json({ senders, receivers, clans });
});

// Create clan
app.post("/api/clans/create", async (req, res) => {
  const { clan_name, clan_logo, owner_id } = req.body;
  if (!clan_name || !owner_id) {
    return res.status(400).json({ error: "اسم العائلة ومعرف المالك مطلوبان" });
  }

  const clan_id = "clan_" + Math.floor(Math.random() * 1000000);
  const clan_logo_url = clan_logo || "🛡️";

  const fDb = getFirestoreDb();
  if (fDb) {
    try {
      const userRef = fDb.collection("users").doc(owner_id);
      await fDb.runTransaction(async (transaction: any) => {
        const userDoc = await transaction.get(userRef);
        let balance = userDoc.exists ? (userDoc.data().coins_balance || 0) : 10000;
        let badges = userDoc.exists ? (userDoc.data().badges || []) : [];

        if (balance < 1000) throw new Error("Insufficient Balance for Clan creation");

        const updatedBadges = [...badges];
        if (!updatedBadges.includes("loyal_member")) updatedBadges.push("loyal_member");

        transaction.update(userRef, { 
          coins_balance: balance - 1000, 
          clan_id: clan_id,
          badges: updatedBadges
        });

        const clanRef = fDb.collection("clans").doc(clan_id);
        transaction.set(clanRef, {
          clan_id,
          clan_name,
          clan_logo: clan_logo_url,
          owner_id,
          total_xp: 0,
          created_at: FieldValue.serverTimestamp()
        });
      });

      return res.json({ success: true, clan_id, message: "تم إنشاء العائلة بنجاح!" });
    } catch (error: any) {
      console.error("Firestore clan creation failed:", error);
      if (error.message.includes("Insufficient Balance")) {
        return res.status(400).json({ error: "عذراً، رصيدك غير كافي لإنشاء عائلة (تحتاج 1000 كوين)" });
      }
    }
  }

  const localDb = getDb();
  const owner = localDb.users.find(u => u.id === owner_id);
  if (!owner) return res.status(404).json({ error: "المستخدم غير موجود" });

  if (owner.coins < 1000) {
    return res.status(400).json({ error: "عذراً، رصيدك غير كافي لإنشاء عائلة (تحتاج 1000 كوين)" });
  }

  owner.coins -= 1000;
  owner.clanId = clan_id;
  if (!owner.badges) owner.badges = [];
  if (!owner.badges.includes("loyal_member")) owner.badges.push("loyal_member");

  if (!localDb.clans) localDb.clans = [];
  localDb.clans.push({
    clanId: clan_id,
    clanName: clan_name,
    clanLogo: clan_logo_url,
    ownerId: owner_id,
    totalXp: 0
  });

  saveDb(localDb);
  res.json({ success: true, clan_id, message: "تم إنشاء العائلة بنجاح!" });
});

// Join clan
app.post("/api/clans/join", async (req, res) => {
  const { clan_id, user_id } = req.body;
  if (!clan_id || !user_id) return res.status(400).json({ error: "معرف العائلة والملقن مطلوبان" });

  const fDb = getFirestoreDb();
  if (fDb) {
    try {
      const userRef = fDb.collection("users").doc(user_id);
      await fDb.runTransaction(async (transaction: any) => {
        const userDoc = await transaction.get(userRef);
        let badges = userDoc.exists ? (userDoc.data().badges || []) : [];
        const updatedBadges = [...badges];
        if (!updatedBadges.includes("loyal_member")) updatedBadges.push("loyal_member");

        transaction.update(userRef, { 
          clan_id: clan_id,
          badges: updatedBadges
        });
      });
      return res.json({ success: true, message: "تم الانضمام للعائلة بنجاح!" });
    } catch (error) {
      console.error("Firestore clan join failed:", error);
    }
  }

  const localDb = getDb();
  const user = localDb.users.find(u => u.id === user_id);
  if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });

  user.clanId = clan_id;
  if (!user.badges) user.badges = [];
  if (!user.badges.includes("loyal_member")) user.badges.push("loyal_member");

  saveDb(localDb);
  res.json({ success: true, message: "تم الانضمام للعائلة بنجاح!" });
});

// Follow/Unfollow
app.post("/api/users/follow", (req, res) => {
  const { followerId, followingId } = req.body;
  if (!followerId || !followingId) return res.status(400).json({ error: "معرف المتابع والمعتمَد مطلوبان" });
  if (followerId === followingId) return res.status(400).json({ error: "لا يمكنك متابعة نفسك!" });

  const db = getDb();
  const follower = db.users.find(u => u.id === followerId);
  const following = db.users.find(u => u.id === followingId);

  if (!follower || !following) return res.status(404).json({ error: "المستخدم غير موجود" });

  if (!follower.following) follower.following = [];
  if (!following.followers) following.followers = [];

  const followIndex = follower.following.indexOf(followingId);
  let isFollowing = false;

  if (followIndex !== -1) {
    follower.following.splice(followIndex, 1);
    const followerIndex = following.followers.indexOf(followerId);
    if (followerIndex !== -1) following.followers.splice(followerIndex, 1);
    isFollowing = false;
  } else {
    follower.following.push(followingId);
    following.followers.push(followerId);
    isFollowing = true;
  }

  saveDb(db);
  res.json({ success: true, isFollowing, follower, following });
});

// Update Profile Biography
app.post("/api/users/update-profile", (req, res) => {
  const { id, name, avatar, bio } = req.body;
  if (!id) return res.status(400).json({ error: "معرف المستخدم مطلوب" });

  const db = getDb();
  const user = db.users.find(u => u.id === id);
  if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });

  if (name) user.name = name;
  if (avatar) user.avatar = avatar;
  if (bio !== undefined) user.bio = bio;

  saveDb(db);
  res.json({ success: true, user });
});

// Get Private Messages
app.get("/api/messages/:userId", (req, res) => {
  const { userId } = req.params;
  const db = getDb();
  if (!db.privateMessages) db.privateMessages = [];
  const userMsgs = db.privateMessages.filter(m => m.senderId === userId || m.receiverId === userId);
  res.json(userMsgs);
});

// Send Private Message
app.post("/api/messages", (req, res) => {
  const { senderId, receiverId, text, isEncrypted, rawCiphertext, iv } = req.body;
  if (!senderId || !receiverId || !text) return res.status(400).json({ error: "المرسل والمستقبل ونص الرسالة مطلوبين" });

  const db = getDb();
  const sender = db.users.find(u => u.id === senderId);
  const receiver = db.users.find(u => u.id === receiverId);

  if (!sender || !receiver) return res.status(404).json({ error: "المستخدم غير موجود" });

  const newMessage: PrivateMessage = {
    id: `pm_${Date.now()}_${Math.random().toString(36).substring(4)}`,
    senderId,
    senderName: sender.name,
    senderAvatar: sender.avatar,
    receiverId,
    receiverName: receiver.name,
    text,
    timestamp: new Date().toISOString(),
    isEncrypted,
    rawCiphertext,
    iv
  };

  if (!db.privateMessages) db.privateMessages = [];
  db.privateMessages.push(newMessage);
  saveDb(db);

  const wsMessage = { type: "new_private_message", message: newMessage };
  const msgStr = JSON.stringify(wsMessage);
  
  if (wss && wss.clients) {
    wss.clients.forEach((client: any) => {
      if (client.readyState === WebSocket.OPEN && (client.userId === receiverId || client.userId === senderId)) {
        client.send(msgStr);
      }
    });
  }

  res.json({ success: true, message: newMessage });
});

// Mark messages as read
app.post("/api/messages/read", (req, res) => {
  const { userId, otherUserId } = req.body;
  if (!userId || !otherUserId) return res.status(400).json({ error: "المستخدم والطرف الآخر مطلوبان" });

  const db = getDb();
  if (db.privateMessages) {
    db.privateMessages = db.privateMessages.map(m => {
      if (m.receiverId === userId && m.senderId === otherUserId) {
        return { ...m, isRead: true };
      }
      return m;
    });
    saveDb(db);
  }
  res.json({ success: true });
});

// Agora Token Generator
app.get('/api/agora-token', (req, res) => {
    const channelName = req.query.channelName as string;
    const uidStr = req.query.uid as string;

    if (!channelName) return res.status(400).json({ error: 'channelName is required' });

    const appId = process.env.VITE_AGORA_APP_ID || "c7dfa22636da4b40980825480e3c090c";
    const appCertificate = process.env.VITE_AGORA_APP_CERTIFICATE || "037e1422e2f644dfb7d57a7bc04bd25f";
    
    const uid = uidStr ? parseInt(uidStr, 10) : Math.floor(Math.random() * 1000000);
    const role = RtcRole.PUBLISHER;
    const expirationTimeInSeconds = 3600;
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    try {
        const token = RtcTokenBuilder.buildTokenWithUid(appId, appCertificate, channelName, uid, role, privilegeExpiredTs);
        console.log(`[SERVER] Token generated successfully for channel: ${channelName}, UID: ${uid}`);
        return res.json({ token, uid });
    } catch (error) {
        console.error("[SERVER] Failed to generate Agora Token:", error);
        return res.status(500).json({ error: 'Internal Server Error during token generation' });
    }
});

// ==================== FRONTEND & STATIC SERVING ====================

async function startApp() {
  checkFirestoreAccess().catch((err) => {
    console.error("Firestore connection check failed in background:", err);
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server successfully running on http://0.0.0.0:${PORT}`);
  });
}

startApp().catch((err) => {
  console.error("Failed to start server:", err);
});
