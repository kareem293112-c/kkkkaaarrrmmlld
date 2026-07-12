/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';

import {
  Smartphone,
  Search,
  Lock,
  Unlock,
  Volume2,
  VolumeX,
  Plus,
  Send,
  Coins,
  Award,
  ShieldAlert,
  Check,
  Copy,
  FileText,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  User,
  MessageSquare,
  Music,
  Settings,
  LogOut,
  Key,
  RefreshCw,
  Play,
  Flame,
  Zap,
  Sparkles,
  Clock,
  ShieldCheck,
  Shield,
  Info,
  Phone,
  Mail,
  UserCheck,
  Wifi,
  Mic,
  MicOff
} from 'lucide-react';
import {
  deriveRoomKey,
  encryptMessage,
  decryptMessage,
  generateRSAKeyPair,
  exportPublicKey
} from './lib/crypto';
import { AgoraEngineManager } from './services/agora/engine';
import { getXpForNextUserLevel, getXpForNextRoomLevel } from './lib/utils';
import { GIFTS, INITIAL_GIFT_BALANCE } from './data/gifts';
import { DART_BLUEPRINTS } from './data/dartBlueprints';
import { AppUser, VoiceRoom, Gift, AgentTransferLog, FolderNode, VoiceSeat, PrivateMessage } from './types';
import { auth, db } from './lib/firebase';
import { collection, onSnapshot, addDoc, query, updateDoc, doc, setDoc, deleteDoc, runTransaction, increment, serverTimestamp, where, getDoc, orderBy, arrayUnion, arrayRemove } from 'firebase/firestore';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged,
  signOut
} from 'firebase/auth';

// استخدام Firebase Firestore للبيانات المباشرة بدلاً من الـ API والـ WebSocket القديم

// Interactive React subcomponent to dynamically decrypt and display messages safely
const EncryptedMessageText = ({ 
  ciphertext, 
  iv, 
  derivedKey, 
  showCiphertext,
  fallbackText 
}: { 
  ciphertext: string; 
  iv: string; 
  derivedKey: CryptoKey | null; 
  showCiphertext: boolean;
  fallbackText: string;
}) => {
  const [decryptedText, setDecryptedText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!derivedKey) {
      setDecryptedText(null);
      setFailed(true);
      return;
    }
    
    let active = true;
    decryptMessage(ciphertext, iv, derivedKey)
      .then((decrypted) => {
        if (active) {
          setDecryptedText(decrypted);
          setFailed(false);
        }
      })
      .catch(() => {
        if (active) {
          setDecryptedText(null);
          setFailed(true);
        }
      });
      
    return () => {
      active = false;
    };
  }, [ciphertext, iv, derivedKey]);

  if (showCiphertext) {
    return (
      <span className="font-mono text-[7px] text-slate-400 break-all leading-tight tracking-wider select-all">
        {ciphertext.substring(0, 32)}...
      </span>
    );
  }

  if (failed) {
    return (
      <span className="text-red-400 font-extrabold text-[8px] flex items-center gap-1">
        <span>⚠️ [فك تشفير غير متاح]</span>
      </span>
    );
  }

  if (decryptedText === null) {
    return <span className="text-slate-400 italic text-[8px]">جاري فك التشفير...</span>;
  }

  return <span className="text-emerald-400 font-bold text-[9px]">{decryptedText}</span>;
};

const padSeats = (seats: VoiceSeat[] | undefined | null): VoiceSeat[] => {
  const s = seats || [];
  const hasIndexTen = s.some(item => item.index === 10);
  const hasIndexZero = s.some(item => item.index === 0);
  const isOneBased = hasIndexTen || !hasIndexZero;

  return Array.from({ length: 10 }, (_, idx) => {
    const targetIndex = isOneBased ? idx + 1 : idx;
    const matched = s.find(item => item.index === targetIndex);
    if (matched) {
      return {
        ...matched,
        index: idx + 1
      };
    }
    return {
      index: idx + 1,
      userId: null,
      isMuted: false,
      isLocked: false
    };
  });
};

export default function App() {
  // Global States representing Database
  const [users, setUsers] = useState<AppUser[]>([]);
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);

  // Architectural Explorer States
  const [selectedFileKey, setSelectedFileKey] = useState<string>('pubspec');
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    'lib': true,
    'lib/core': true,
    'lib/features': true,
    'lib/features/voice_room': true,
    'lib/features/agent_dashboard': true,
  });
  const [copiedNotification, setCopiedNotification] = useState(false);
  const [activeTab, setActiveTab] = useState<'architecture' | 'code' | 'specs'>('architecture');

  // Interactive Live & Premium State Additions
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentTime, setCurrentTime] = useState('');
  const [speakingSeatIndex, setSpeakingSeatIndex] = useState<number | null>(null);
  const [speakingVolume, setSpeakingVolume] = useState<number>(0);
  const [isAgoraJoined, setIsAgoraJoined] = useState<boolean>(false);
  const [isRoomAudioDeafened, setIsRoomAudioDeafened] = useState(false);

  // Real-time microphone level capture for currentUser when they are unmuted on a seat
  const [realUserMicSpeaking, setRealUserMicSpeaking] = useState(false);
  const [realUserMicVolume, setRealUserMicVolume] = useState(0);

  const checkIfOwner = (room: VoiceRoom | null) => {
    if (!room || !currentUser) return false;
    return !!(
      (room.owner_id && room.owner_id === currentUser.id)
    );
  };
  const [rooms, setRooms] = useState<VoiceRoom[]>([]);
  const [activeRoom, setActiveRoom] = useState<VoiceRoom | null>(null);
  const [transactions, setTransactions] = useState<AgentTransferLog[]>([]);
  const [agentBalance, setAgentBalance] = useState<number>(0);
  const [agentsHub, setAgentsHub] = useState<{agent_id: string; agent_name: string; contact_whatsapp: string; is_active: boolean}[]>([]);

  // Profile, Direct Messaging & Follower States
  const [selectedProfileUser, setSelectedProfileUser] = useState<AppUser | null>(null);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isPrivateInboxOpen, setIsPrivateInboxOpen] = useState(false);
  const [activePrivateChatUser, setActivePrivateChatUser] = useState<AppUser | null>(null);
  const [privateMessages, setPrivateMessages] = useState<PrivateMessage[]>([]);
  const [newPrivateMessageInput, setNewPrivateMessageInput] = useState('');
  const [isEditingBio, setIsEditingBio] = useState(false);
  const [bioEditValue, setBioEditValue] = useState('');
  const [isAgentsHubOpen, setIsAgentsHubOpen] = useState(false);

  // App Simulator Screen Navigation: 'login' | 'explore' | 'room' | 'agent_pin' | 'agent_dashboard'
  const [currentScreen, setCurrentScreen] = useState<'login' | 'explore' | 'room' | 'agent_pin' | 'agent_dashboard'>('login');
  
  // Login input fields
  const [loginMethod, setLoginMethod] = useState<'phone' | 'email' | 'google' | 'apple' | null>(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [smsOtp, setSmsOtp] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [customName, setCustomName] = useState('');
  const [showOtpField, setShowOtpField] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Create Room modal states
  const [isCreateRoomModalOpen, setIsCreateRoomModalOpen] = useState(false);
  const [newRoomNameInput, setNewRoomNameInput] = useState('');
  const [newRoomIsPrivate, setNewRoomIsPrivate] = useState(false);
  const [newRoomPassword, setNewRoomPassword] = useState('');
  const [newRoomError, setNewRoomError] = useState('');
  const [newRoomLoading, setNewRoomLoading] = useState(false);

  // Explore Room Lock PIN state
  const [selectedLockedRoom, setSelectedLockedRoom] = useState<VoiceRoom | null>(null);
  const [roomPasswordInput, setRoomPasswordInput] = useState('');
  const [roomPasswordError, setRoomPasswordError] = useState(false);

  // Voice Room interactive state
  const [selectedSeatIndex, setSelectedSeatIndex] = useState<number | null>(null);
  const [floatingGifts, setFloatingGifts] = useState<{ id: number; icon: string; x: number; y: number }[]>([]);
  const [vipEntrance, setVipEntrance] = useState<{ active: boolean; userName: string; level: number } | null>(null);
  const [activeRoomUsers, setActiveRoomUsers] = useState<Array<{ id: string; name: string; avatar: string }>>([]);
  const floatingIdCounter = useRef(0);

  // Agent Dashboard states
  const [agentPinInput, setAgentPinInput] = useState('');
  const [agentPinError, setAgentPinError] = useState(false);
  const [transferTargetId, setTransferTargetId] = useState('');
  const [transferTargetUser, setTransferTargetUser] = useState<AppUser | null>(null);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferPin, setTransferPin] = useState('');
  const [transferSuccess, setTransferSuccess] = useState(false);
  const [transferErrorMsg, setTransferErrorMsg] = useState('');
  
  // End-to-End Encryption (E2EE) States
  const [isE2EEEnabled, setIsE2EEEnabled] = useState(true);
  const [e2eePassphrase, setE2eePassphrase] = useState('SadaArabE2EESecureKey');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [derivedKey, setDerivedKey] = useState<CryptoKey | null>(null);
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [e2eeAuditLogs, setE2eeAuditLogs] = useState<string[]>([]);
  const [showCiphertextInFeed, setShowCiphertextInFeed] = useState(false);
  const [clientKeyPair, setClientKeyPair] = useState<CryptoKeyPair | null>(null);
  const [clientPublicKeyBase64, setClientPublicKeyBase64] = useState('');
  const [isE2EEDrawerOpen, setIsE2EEDrawerOpen] = useState(false);

  // Gamification & clans / leaderboard states
  const [exploreSubTab, setExploreSubTab] = useState<'planet' | 'clans' | 'leaderboard'>('planet');
  const [liveLeaderboard, setLiveLeaderboard] = useState<{
    senders: any[];
    receivers: any[];
    clans: any[];
  } | null>(null);
  const [newClanName, setNewClanName] = useState('');
  const [newClanLogo, setNewClanLogo] = useState('🛡️');
  const [isLeaderboardLoading, setIsLeaderboardLoading] = useState(false);

  const addE2eeLog = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setE2eeAuditLogs(prev => [`[${timestamp}] ${msg}`, ...prev.slice(0, 49)]);
  };








  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const handleCreateRoom = async (name: string) => {
    try {
      await addDoc(collection(db, "voice_rooms"), {
        name: name,
        room_name: name,
        owner_id: currentUser?.id,
        isPrivate: false,
        is_private: false,
        password: '',
        room_password: '',
        hostName: currentUser?.name,
        host_name: currentUser?.name,
        hostAvatar: currentUser?.avatar,
        host_avatar: currentUser?.avatar || '',
        seats: Array.from({ length: 10 }, (_, i) => ({
          index: i,
          userId: null,
          isLocked: false,
          isMuted: false
        })),
        level: 1,
        xp: 0,
        activeUsersCount: 0
      });
      setIsCreateRoomModalOpen(false); 
      setNewRoomNameInput("");
      return { success: true };
    } catch (e) {
      console.error("Error creating room in Firestore:", e);
      return { success: false, error: 'حدث خطأ في إنشاء الغرفة' };
    }
  };

  // Real-time synchronization of rooms using Firestore
  useEffect(() => {
    const q = query(collection(db, "voice_rooms"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const roomsData = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          name: data.name || data.room_name || 'مجلس غير مسمى',
          hostName: data.hostName || data.host_name || 'مالك المجلس',
          hostAvatar: data.hostAvatar || data.host_avatar || '',
          isPrivate: data.isPrivate !== undefined ? data.isPrivate : (data.is_private || false),
          password: data.password || data.room_password || '',
          seats: padSeats(data.seats),
          level: data.level || 1,
          xp: data.xp || 0,
          activeUsersCount: data.activeUsersCount || 0,
          ...data
        } as VoiceRoom;
      });
      setRooms(roomsData);
    });

    return () => unsubscribe();
  }, []);

  // Real-time synchronization of participants for the active room
  useEffect(() => {
    if (!activeRoom?.id) {
      setActiveRoomUsers([]);
      return;
    }

    console.log("[SYNC] Starting participants listener for room:", activeRoom.id);
    const participantsRef = collection(db, "voice_rooms", activeRoom.id, "participants");
    const q = query(participantsRef);
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const participants = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: data.id || doc.id,
          name: data.name || 'مشارك',
          avatar: data.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${doc.id}`
        };
      });
      console.log(`[SYNC] Participants updated: ${participants.length} users`);
      setActiveRoomUsers(participants);
    }, (error) => {
      console.error("Error syncing participants:", error);
    });

    return () => unsubscribe();
  }, [activeRoom?.id]);

  useEffect(() => {
    if (activeRoom && rooms.length > 0) {
      const updated = rooms.find(r => r.id === activeRoom.id);
      if (updated && JSON.stringify(updated.seats) !== JSON.stringify(activeRoom.seats)) {
        console.log("[SYNC] Syncing activeRoom seats from real-time rooms list");
        setActiveRoom(updated);
      }
    }
  }, [rooms, activeRoom?.id]);

  // Real-time synchronization of users using Firestore
  useEffect(() => {
    const q = query(collection(db, "users"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const usersData = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          name: data.name || data.username || 'مستشار صدى',
          avatar: data.avatar || data.avatar_url || `https://api.dicebear.com/7.x/adventurer/svg?seed=${doc.id}`,
          level: data.level || data.vip_level || 1,
          coins: data.coins !== undefined ? data.coins : (data.coins_balance !== undefined ? data.coins_balance : 0),
          xp: data.xp || data.sender_xp || 0,
          ...data
        };
      }) as AppUser[];
      setUsers(usersData);
    });

    return () => unsubscribe();
  }, []);

  // Listen for Firebase auth state changes
  useEffect(() => {
    let unsubscribeUser: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (unsubscribeUser) {
        unsubscribeUser();
        unsubscribeUser = null;
      }

      if (firebaseUser) {
        const userDocRef = doc(db, "users", firebaseUser.uid);
        
        // Setup real-time listener for current user document
        unsubscribeUser = onSnapshot(userDocRef, (docSnap) => {
          if (docSnap.exists()) {
            const userData = docSnap.data() as AppUser;
            setCurrentUser({ ...userData, id: docSnap.id });
          } else {
            // Create user document if it doesn't exist
            const defaultName = firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'مستشار صدى';
            const defaultAvatar = firebaseUser.photoURL || `https://api.dicebear.com/7.x/adventurer/svg?seed=${firebaseUser.uid}`;
            
            const newUser: AppUser = {
              id: firebaseUser.uid,
              name: defaultName,
              avatar: defaultAvatar,
              level: 1,
              coins: 1000,
              xp: 0,
              role: 'user',
              bio: 'عضو مميز في صدى العرب ☕',
              followers: [],
              following: [],
              badges: [],
              createdAt: new Date().toISOString()
            };
            setDoc(userDocRef, newUser).catch(e => console.error("Error creating user doc:", e));
          }
          setCurrentScreen('explore');
        }, (error) => {
          console.error("Error listening to current user doc:", error);
        });
      } else {
        // Logged out
        setCurrentUser(null);
        setCurrentScreen('login');
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeUser) unsubscribeUser();
    };
  }, []);

  // Real-time synchronization of private messages using Firestore
  useEffect(() => {
    if (!currentUser?.id) {
      setPrivateMessages([]);
      return;
    }

    console.log("[SYNC] Starting private messages listener for user:", currentUser.id);
    const messagesRef = collection(db, "messages");
    // We query for messages where current user is either sender or receiver
    // Firestore supports 'where' filters, but for OR we might need multiple listeners or a participants array
    // Here we use a participants array for simplicity in querying
    const q = query(
      messagesRef, 
      where("participants", "array-contains", currentUser.id),
      orderBy("timestamp", "asc")
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as PrivateMessage[];
      console.log(`[SYNC] Private messages updated: ${msgs.length} messages`);
      setPrivateMessages(msgs);
    }, (error) => {
      console.error("Error syncing private messages:", error);
    });

    return () => unsubscribe();
  }, [currentUser?.id]);

  // Mark messages as read when inbox opens or active chat user changes
  useEffect(() => {
    if (isPrivateInboxOpen && activePrivateChatUser && currentUser) {
      // Find unread messages from other user
      const unreadMsgs = privateMessages.filter(msg => 
        msg.senderId === activePrivateChatUser.id && 
        msg.receiverId === currentUser.id && 
        !msg.isRead
      );

      unreadMsgs.forEach(msg => {
        const msgRef = doc(db, "messages", msg.id);
        updateDoc(msgRef, { isRead: true }).catch(err => console.error("Error marking message as read:", err));
      });
    }
  }, [isPrivateInboxOpen, activePrivateChatUser?.id, currentUser?.id, privateMessages.length]);

  // Send Private Message Handler
  const handleSendPrivateMessage = async () => {
    if (!currentUser || !activePrivateChatUser || !newPrivateMessageInput.trim()) return;
    
    const textToSend = newPrivateMessageInput.trim();
    setNewPrivateMessageInput('');
    
    try {
      let isEncrypted = false;
      let rawCiphertext = '';
      let iv = '';
      
      if (isE2EEEnabled && privateKey) {
        const { ciphertext, iv: cryptoIv } = await encryptMessage(textToSend, privateKey);
        isEncrypted = true;
        rawCiphertext = ciphertext;
        iv = cryptoIv;
      }

      const messagePayload = {
        senderId: currentUser.id,
        senderName: currentUser.name,
        senderAvatar: currentUser.avatar,
        receiverId: activePrivateChatUser.id,
        receiverName: activePrivateChatUser.name,
        text: textToSend,
        isEncrypted,
        rawCiphertext,
        iv,
        isRead: false,
        timestamp: new Date().toISOString(),
        participants: [currentUser.id, activePrivateChatUser.id]
      };
      
      await addDoc(collection(db, "messages"), messagePayload);
    } catch (err) {
      console.error('Error sending private message to Firestore:', err);
    }
  };

  // Toggle Follow Handler
  const handleToggleFollow = async (targetUser: AppUser) => {
    if (!currentUser) {
      alert('يجب تسجيل الدخول أولاً للمتابعة!');
      return;
    }
    if (currentUser.id === targetUser.id) {
      alert('لا يمكنك متابعة نفسك!');
      return;
    }
    
    try {
      const isFollowing = currentUser.following?.includes(targetUser.id);
      const userRef = doc(db, "users", currentUser.id);
      const targetRef = doc(db, "users", targetUser.id);

      if (isFollowing) {
        await updateDoc(userRef, { following: arrayRemove(targetUser.id) });
        await updateDoc(targetRef, { followers: arrayRemove(currentUser.id) });
      } else {
        await updateDoc(userRef, { following: arrayUnion(targetUser.id) });
        await updateDoc(targetRef, { followers: arrayUnion(currentUser.id) });
      }
      // Real-time listeners will handle UI updates for setUsers and setCurrentUser
    } catch (err) {
      console.error('Error toggling follow in Firestore:', err);
    }
  };

  // Save Biography Handler
  const handleSaveBio = async () => {
    if (!currentUser) return;
    try {
      const userRef = doc(db, "users", currentUser.id);
      await updateDoc(userRef, { bio: bioEditValue });
      setIsEditingBio(false);
    } catch (err) {
      console.error('Error saving bio in Firestore:', err);
    }
  };

  const handleUpdateAvatar = async (avatarBase64: string) => {
    if (!currentUser) return;
    try {
      const userRef = doc(db, "users", currentUser.id);
      await updateDoc(userRef, { avatar: avatarBase64 });
    } catch (err) {
      console.error('Error updating avatar in Firestore:', err);
    }
  };

  const handleProfileAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('يرجى اختيار ملف صورة صالح.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 300;
        const MAX_HEIGHT = 300;
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
        } else {
          if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
        }
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressedBase64 = canvas.toDataURL('image/jpeg', 0.8);
          handleUpdateAvatar(compressedBase64);
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // End-to-End Cryptography Key Derivation & RSA Lifecycle
  useEffect(() => {
    if (!activeRoom) {
      setDerivedKey(null);
      return;
    }
    
    let isMounted = true;

    const initCryptoForRoom = async () => {
      try {
        addE2eeLog(`جاري تهيئة منظومة التشفير للغرفة [${activeRoom.name.replace(/☕|🎶|🔒/g, '').trim()}]...`);
        
        // Derive AES-GCM-256 Symmetric Key
        const key = await deriveRoomKey(e2eePassphrase, activeRoom.id);
        if (isMounted) {
          setDerivedKey(key);
          addE2eeLog(`تم اشتقاق مفتاح AES-GCM 256-bit باستخدام PBKDF2 (100K دورة) بنجاح!`);
        }
        
        // Generate RSA Keypair if not exists for peer identity
        if (!clientKeyPair && isMounted) {
          addE2eeLog(`جاري توليد زوج مفاتيح الهوية (RSA-OAEP 2048-bit) محلياً...`);
          const rsaPair = await generateRSAKeyPair();
          if (isMounted) {
            setClientKeyPair(rsaPair);
            const pubPEM = await exportPublicKey(rsaPair.publicKey);
            setClientPublicKeyBase64(pubPEM);
            addE2eeLog(`تم توليد مفتاح RSA العام للهوية وتصديره بنجاح!`);
          }
        }
      } catch (err: any) {
        if (isMounted) {
          addE2eeLog(`⚠️ خطأ في العمليات التشفيرية: ${err.message}`);
        }
      }
    };
    
    initCryptoForRoom();

    return () => {
      isMounted = false;
    };
  }, [activeRoom?.id, e2eePassphrase]);

  // Derive Private Message Key
  useEffect(() => {
    let isMounted = true;
    const initPrivateKey = async () => {
      try {
        const key = await deriveRoomKey(e2eePassphrase, "GlobalPrivateChat");
        if (isMounted) {
          setPrivateKey(key);
        }
      } catch (err) {
        console.error("Error deriving global private message key:", err);
      }
    };
    initPrivateKey();
    return () => {
      isMounted = false;
    };
  }, [e2eePassphrase]);

  // Agora RTC engine handles all high-fidelity real-time audio publishing and playback.

  // Microphone capture and streaming over Agora RTC Engine


  // Refs to avoid stale closures in WebSocket event handlers
  const activeRoomRef = useRef(activeRoom);
  const currentUserRef = useRef(currentUser);

  useEffect(() => {
    activeRoomRef.current = activeRoom;
  }, [activeRoom]);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);



  // Track current user's specific seat status to prevent unnecessary microphone restarts when other users move
  const myCurrentSeat = activeRoom?.seats?.find(s => s.userId === currentUser?.id);
  const myCurrentSeatIndex = myCurrentSeat ? myCurrentSeat.index : null;
  const myCurrentSeatMuted = myCurrentSeat ? myCurrentSeat.isMuted : true;

  // Automatically start or stop publishing audio based on seat occupancy and mute status
  useEffect(() => {
    if (!currentUser) return;
    const agoraManager = AgoraEngineManager.getInstance();
    if (isAgoraJoined && myCurrentSeatIndex !== null && !myCurrentSeatMuted) {
      console.log("[AGORA] Reactive Auto-Publishing microphone");
      agoraManager.startPublishing();
    } else {
      console.log("[AGORA] Reactive Auto-Stopping microphone");
      agoraManager.stopPublishing();
    }
  }, [myCurrentSeatIndex, myCurrentSeatMuted, currentUser?.id, isAgoraJoined]);

  // Voice capture effect
  useEffect(() => {
    let isMounted = true;
    const roomIdToJoin = activeRoom?.id;

    async function initAgora() {
      if (roomIdToJoin && currentUser) {
        try {
          console.log("[AGORA] Initializing Agora room:", roomIdToJoin);
          const agoraManager = AgoraEngineManager.getInstance();
          await agoraManager.joinAudioRoom(roomIdToJoin, currentUser.id);
          if (isMounted) {
            console.log("[AGORA] Agora room join success:", roomIdToJoin);
            setIsAgoraJoined(true);
          }
        } catch (e) {
          console.error("[AGORA] Agora initialization/join failed", e);
        }
      }
    }
    initAgora();

    return () => {
      isMounted = false;
      setIsAgoraJoined(false);
      if (roomIdToJoin) {
        console.log("[AGORA] Leaving Agora room:", roomIdToJoin);
        AgoraEngineManager.getInstance().leaveAudioRoom().catch(err => {
          console.error("[AGORA] Error leaving Agora room", err);
        });
      }
    };
  }, [activeRoom?.id, currentUser?.id]);

  // Subscribe to real Agora volume updates to trigger the speaking indicators dynamically
  useEffect(() => {
    const agoraManager = AgoraEngineManager.getInstance();
    agoraManager.onVolumeIndicator((volumes) => {
      volumes.forEach((v) => {
        const streamUserId = v.uid;
        const soundLevel = v.level;
        const currentActiveRoom = activeRoomRef.current;
        if (currentActiveRoom && currentActiveRoom.seats) {
          const seatIdx = currentActiveRoom.seats.findIndex(s => s.userId === streamUserId);
          if (seatIdx !== -1) {
            if (soundLevel > 5) {
              setSpeakingSeatIndex(seatIdx);
              setSpeakingVolume(Math.min(100, Math.round(soundLevel)));
              
              if (!(window as any).speakingTimers) (window as any).speakingTimers = {};
              if ((window as any).speakingTimers[streamUserId]) {
                clearTimeout((window as any).speakingTimers[streamUserId]);
              }
              (window as any).speakingTimers[streamUserId] = setTimeout(() => {
                setSpeakingSeatIndex(null);
                setSpeakingVolume(0);
              }, 600);
            }
          }
        }
      });
    });

    return () => {
      agoraManager.onVolumeIndicator(() => {});
    };
  }, []);


  // States relocated to the top of the App component to prevent block-scoped reference errors.

  useEffect(() => {
    // Check if current user is unmuted on a seat
    if (!activeRoom || !currentUser || currentScreen !== 'room') {
      setRealUserMicSpeaking(false);
      setRealUserMicVolume(0);
      return;
    }
    const userSeat = activeRoom.seats.find(s => s.userId === currentUser.id);
    const isUnmutedOnSeat = userSeat && !userSeat.isMuted;

    if (!isUnmutedOnSeat) {
      setRealUserMicSpeaking(false);
      setRealUserMicVolume(0);
      return;
    }

    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let microphone: MediaStreamAudioSourceNode | null = null;
    let javascriptNode: ScriptProcessorNode | null = null;
    let stream: MediaStream | null = null;
    let active = true;

    async function startMic() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (!active) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        audioContext = new AudioContextClass();
        analyser = audioContext.createAnalyser();
        microphone = audioContext.createMediaStreamSource(stream);
        javascriptNode = audioContext.createScriptProcessor(2048, 1, 1);

        analyser.smoothingTimeConstant = 0.8;
        analyser.fftSize = 1024;

        microphone.connect(analyser);
        analyser.connect(javascriptNode);
        javascriptNode.connect(audioContext.destination);

        javascriptNode.onaudioprocess = () => {
          if (!active) return;
          const array = new Uint8Array(analyser!.frequencyBinCount);
          analyser!.getByteFrequencyData(array);
          let values = 0;

          const length = array.length;
          for (let i = 0; i < length; i++) {
            values += array[i];
          }

          const average = values / length;
          // average ranges typically from 0 to 128. Threshold of 8 for speech.
          if (average > 8) {
            setRealUserMicSpeaking(true);
            setRealUserMicVolume(average);
          } else {
            setRealUserMicSpeaking(false);
            setRealUserMicVolume(0);
          }
        };
      } catch (err) {
        console.warn('Microphone permission denied or not supported:', err);
      }
    }

    startMic();

    return () => {
      active = false;
      if (javascriptNode) {
        try { javascriptNode.disconnect(); } catch (e) {}
      }
      if (microphone) {
        try { microphone.disconnect(); } catch (e) {}
      }
      if (analyser) {
        try { analyser.disconnect(); } catch (e) {}
      }
      if (audioContext && audioContext.state !== 'closed') {
        try { audioContext.close(); } catch (e) {}
      }
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [activeRoom, currentUser, currentScreen]);

  // Fluctuates speaking volume to simulate dynamic vocal pitch/volume changes
  useEffect(() => {
    const volInterval = setInterval(() => {
      setSpeakingVolume(Math.floor(Math.random() * 65) + 35); // volume fluctuates between 35 and 100
    }, 150);
    return () => clearInterval(volInterval);
  }, []);

  // Room Settings Drawer states
  const [isRoomSettingsDrawerOpen, setIsRoomSettingsDrawerOpen] = useState(false);
  const [roomSettingsName, setRoomSettingsName] = useState('');
  const [roomSettingsAvatar, setRoomSettingsAvatar] = useState('');
  const [isUpdatingRoomSettings, setIsUpdatingRoomSettings] = useState(false);
  const [roomSettingsError, setRoomSettingsError] = useState('');

  const handleRoomAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setRoomSettingsError('يرجى اختيار ملف صورة صالح.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 200;
        const MAX_HEIGHT = 200;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressedBase64 = canvas.toDataURL('image/jpeg', 0.8);
          setRoomSettingsAvatar(compressedBase64);
        } else {
          setRoomSettingsAvatar(event.target?.result as string);
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
    // Reset file input value to allow selecting same file/refreshing state
    e.target.value = '';
  };

  // Native Mobile UI States (Bottom sheet draw lists)
  const [isGiftDrawerOpen, setIsGiftDrawerOpen] = useState(false);

  const [isQueueDrawerOpen, setIsQueueDrawerOpen] = useState(false);
  const [isNoiseCancellation, setIsNoiseCancellation] = useState(true);
  const [isEchoCancellation, setIsEchoCancellation] = useState(true);
  const [isVoiceConnected, setIsVoiceConnected] = useState(true);
  const [isAdminDrawerOpen, setIsAdminDrawerOpen] = useState(false);
  const [selectedGift, setSelectedGift] = useState<Gift | null>(null);
  const [selectedRecipientSeatIndex, setSelectedRecipientSeatIndex] = useState<number | 'all'>('all');
  const [dashboardTab, setDashboardTab] = useState<'party' | 'games' | 'explore' | 'messages' | 'profile'>('party');

  const fetchLiveLeaderboard = async () => {
    // Firestore real-time listeners handle this now
  };

  // Real-time synchronization of leaderboard and clans using Firestore
  useEffect(() => {
    if (currentScreen !== 'explore' || dashboardTab !== 'explore') return;

    setIsLeaderboardLoading(true);
    
    // Top Senders
    const sendersQuery = query(collection(db, "users"), orderBy("xp", "desc"), where("xp", ">", 0));
    const unsubscribeSenders = onSnapshot(sendersQuery, (snapshot) => {
      const topSenders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setLiveLeaderboard(prev => ({ ...prev, senders: topSenders } as any));
      setIsLeaderboardLoading(false);
    });

    // Top Clans
    const clansQuery = query(collection(db, "clans"), orderBy("totalXp", "desc"));
    const unsubscribeClans = onSnapshot(clansQuery, (snapshot) => {
      const topClans = snapshot.docs.map(doc => ({ clan_id: doc.id, ...doc.data() }));
      setLiveLeaderboard(prev => ({ ...prev, clans: topClans } as any));
    });

    return () => {
      unsubscribeSenders();
      unsubscribeClans();
    };
  }, [currentScreen, dashboardTab]);

  // Real-time synchronization for Agents Hub
  useEffect(() => {
    const agentsQuery = query(collection(db, "agents_hub"), where("is_active", "==", true));
    const unsubscribe = onSnapshot(agentsQuery, (snapshot) => {
      const agents = snapshot.docs.map(doc => ({ agent_id: doc.id, ...doc.data() })) as any;
      setAgentsHub(agents);
    });
    return () => unsubscribe();
  }, []);

  // Fetch live leaderboard and clans when entering the Explore tab
  useEffect(() => {
    if (currentScreen === 'explore' && dashboardTab === 'explore') {
      fetchLiveLeaderboard();
    }
  }, [currentScreen, dashboardTab, exploreSubTab]);
  const [isDailyBonusOpen, setIsDailyBonusOpen] = useState(false);
  const [dailyBonusClaimed, setDailyBonusClaimed] = useState(false);
  const [driftingBottleMode, setDriftingBottleMode] = useState<'idle' | 'writing' | 'reading'>('idle');
  const [bottleMessage, setBottleMessage] = useState('');
  const [pickedBottle, setPickedBottle] = useState<string | null>(null);
  const [supportChatOpen, setSupportChatOpen] = useState(false);
  const [supportChatMessages, setSupportChatMessages] = useState<Array<{ sender: string; text: string; isUser: boolean }>>([
    { sender: 'دعم صدى الفني 🐱', text: 'مرحباً بك في صدى العرب يا بطل! نحن هنا لخدمتك على مدار الساعة 🌟', isUser: false }
  ]);
  const [supportInput, setSupportInput] = useState('');

  // Dynamic Device Type Detection
  const [deviceInfo, setDeviceInfo] = useState({ isMobile: false, platform: 'desktop', modelName: 'Desktop' });

  useEffect(() => {
    const ua = navigator.userAgent || navigator.vendor || (window as any).opera;
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
    const isAndroid = /Android/i.test(ua);
    const isMobile = isIOS || isAndroid || window.innerWidth < 768;
    
    let modelName = 'جهاز كمبيوتر (Desktop)';
    if (isIOS) {
      if (/iPhone/.test(ua)) {
        modelName = 'آيفون (iPhone)';
      } else if (/iPad/.test(ua)) {
        modelName = 'آيباد (iPad)';
      } else {
        modelName = 'جهاز Apple iOS';
      }
    } else if (isAndroid) {
      if (/Samsung|SM-|SAMSUNG/i.test(ua)) {
        modelName = 'سامسونج (Samsung)';
      } else if (/Huawei|HUAWEI/i.test(ua)) {
        modelName = 'هواوي (Huawei)';
      } else if (/Xiaomi|Redmi|MI/i.test(ua)) {
        modelName = 'شاومي (Xiaomi)';
      } else {
        modelName = 'أندرويد (Android)';
      }
    }

    setDeviceInfo({
      isMobile,
      platform: isIOS ? 'ios' : isAndroid ? 'android' : 'desktop',
      modelName
    });
  }, []);
  
  // Interactive Arabic Room Live Chat messages & Input State
  const [chatInputValue, setChatInputValue] = useState('');
  const [roomMessages, setRoomMessages] = useState<Array<{ sender: string; text: string; color?: string; type?: 'chat' | 'system' | 'vip' }>>([
    { sender: 'نظام المجلس', text: 'مرحباً بكم في صدى العرب! يرجى الالتزام بالاحترام المتبادل داخل مجالسنا الموقرة.', color: 'text-purple-400 font-bold', type: 'system' },
    { sender: 'خالد الحربي', text: 'السلام عليكم ورحمة الله، حياكم الله جميعاً بالمجلس الدافئ.', color: 'text-amber-400', type: 'chat' },
  ]);

  // Time Formatter Effect
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      let hours = now.getHours();
      const minutes = now.getMinutes().toString().padStart(2, '0');
      const ampm = hours >= 12 ? 'م' : 'ص';
      hours = hours % 12;
      hours = hours ? hours : 12; // 12 hour format
      setCurrentTime(`${hours}:${minutes} ${ampm}`);
    };
    updateTime();
    const timer = setInterval(updateTime, 15000);
    return () => clearInterval(timer);
  }, []);

  // WebRTC Speaking simulation effect
  useEffect(() => {
    if (currentScreen !== 'room' || !activeRoom || isRoomAudioDeafened) {
      setSpeakingSeatIndex(null);
      return;
    }

    const speakerInterval = setInterval(() => {
      // Find indexes of occupied seats that are not muted
      const occupiedSeatIndexes = activeRoom.seats
        .filter(seat => seat.userId !== null && !seat.isMuted)
        .map(seat => seat.index);

      if (occupiedSeatIndexes.length > 0) {
        // Randomly select one or have none speak (30% silence)
        if (Math.random() > 0.3) {
          const randomIndex = occupiedSeatIndexes[Math.floor(Math.random() * occupiedSeatIndexes.length)];
          setSpeakingSeatIndex(randomIndex);
        } else {
          setSpeakingSeatIndex(null);
        }
      } else {
        setSpeakingSeatIndex(null);
      }
    }, 2800);

    return () => clearInterval(speakerInterval);
  }, [currentScreen, activeRoom, isRoomAudioDeafened]);

  // Dynamic Room Interactive Live Streams simulation - DISABLED BY USER REQUEST FOR PURE REAL-TIME EXPERIENCE
  useEffect(() => {
    // Simulated background event triggers have been disabled to ensure 100% real interactions and real user accounts.
  }, []);

  // Trigger floating gift animation
  const spawnFloatingGift = (icon: string) => {
    const id = floatingIdCounter.current++;
    // Random position across the center of vertical mobile screen
    const x = 30 + Math.random() * 40; // percentage
    const y = 50 + Math.random() * 20; // percentage
    setFloatingGifts((prev) => [...prev, { id, icon, x, y }]);
    
    // Auto remove after animation completes
    setTimeout(() => {
      setFloatingGifts((prev) => prev.filter((item) => item.id !== id));
    }, 2000);
  };

  // Trigger VIP Entrance banner
  const triggerVipEntrance = (userName: string, level: number) => {
    setVipEntrance({ active: true, userName, level });
    // Append VIP Entrance announcement to live chat
    setRoomMessages((prev) => [
      ...prev,
      {
        sender: 'دخول VIP',
        text: `👑 دخل الـ VIP ${userName} (مستوى ${level}) إلى المجلس! حيو الفخم!`,
        color: 'text-amber-300 font-extrabold animate-pulse',
        type: 'vip',
      },
    ]);
    setTimeout(() => {
      setVipEntrance(null);
    }, 4500);
  };

  // Setup initial user levels or auto welcomes
  const handleSignUpAndLogin = async (nameToUse: string) => {
    const finalName = nameToUse.trim() || 'فارس الأصيل';
    // Generate simple stable numeric ID based on name or hash
    const userId = (Math.abs(finalName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % 900) + 1000;
    const finalId = userId.toString();

    try {
      const userRef = doc(db, "users", finalId);
      const newUser: AppUser = {
        id: finalId,
        name: finalName,
        avatar: `https://api.dicebear.com/7.x/adventurer/svg?seed=${finalId}`,
        level: 1,
        coins: 1000,
        xp: 0,
        role: 'user',
        bio: 'عضو جديد في صدى العرب ☕',
        followers: [],
        following: [],
        badges: [],
        createdAt: new Date().toISOString()
      };
      await setDoc(userRef, newUser);
      setCurrentUser(newUser);
      setCurrentScreen('explore');
    } catch (e) {
      console.error('Error during manual signup in Firestore:', e);
    }

    // Clean input fields
    setCustomName('');
    setPhoneNumber('');
    setSmsOtp('');
    setEmail('');
    setPassword('');
    setShowOtpField(false);
    setLoginMethod(null);
  };

  // Handle entering room
  const handleEnterRoom = (room: VoiceRoom) => {
    // Resume/init Agora inside user gesture
    AgoraEngineManager.getInstance().initEngine().catch(() => {});

    // Always enter directly as requested (make all rooms public)
    loadActiveRoom(room);
  };

  const loadActiveRoom = (room: VoiceRoom) => {
    const sanitizedRoom = {
      ...room,
      seats: padSeats(room.seats)
    };
    setActiveRoom(sanitizedRoom);
    if (currentUser) {
      // Add to participants sub-collection
      const participantRef = doc(db, "voice_rooms", room.id, "participants", currentUser.id);
      setDoc(participantRef, {
        id: currentUser.id,
        name: currentUser.name,
        avatar: currentUser.avatar,
        joinedAt: serverTimestamp()
      }).catch(err => console.error("Error adding participant:", err));

      // Increment activeUsersCount
      updateDoc(doc(db, "voice_rooms", room.id), {
        activeUsersCount: increment(1)
      }).catch(err => console.error("Error incrementing user count:", err));
    }
    setRoomMessages([
      { sender: 'نظام المجلس', text: 'مرحباً بكم في صدى العرب! يرجى الالتزام بالاحترام المتبادل داخل مجالسنا الموقرة.', color: 'text-purple-400 font-bold', type: 'system' }
    ]);
    setCurrentScreen('room');

    // Trigger entrance animation for high-level user
    if (currentUser && currentUser.level >= 10) {
      triggerVipEntrance(currentUser.name, currentUser.level);
    }
  };

  const handleVerifyRoomPassword = () => {
    if (selectedLockedRoom) {
      if (roomPasswordInput === selectedLockedRoom.password) {
        const roomToLoad = selectedLockedRoom;
        setSelectedLockedRoom(null);
        loadActiveRoom(roomToLoad);
      } else {
        setRoomPasswordError(true);
      }
    }
  };

  // Seat Management Actions
  const handleSeatClick = (seatIndex: number) => {
    if (!activeRoom || !currentUser) return;

    // Resume/init Agora inside user gesture
    AgoraEngineManager.getInstance().initEngine().catch(() => {});

    const seat = activeRoom.seats[seatIndex];
    const isAuthorizedHost = checkIfOwner(activeRoom) || (activeRoom.seats[0] && activeRoom.seats[0].userId === currentUser.id);

    // If seat is occupied, let host manage it, or let occupant manage their own seat
    if (seat.userId) {
      if (seat.userId === currentUser.id || isAuthorizedHost) {
        setSelectedSeatIndex(seatIndex);
      } else {
        // Show occupant's profile modal instead of showing host controls
        const occupant = users.find(u => u.id === seat.userId) || (currentUser && seat.userId === currentUser.id ? currentUser : null);
        if (occupant) {
          setSelectedProfileUser(occupant);
          setIsProfileModalOpen(true);
        }
      }
    } else {
      // Empty seat: If locked, only host can unlock. If open, current user can sit down!
      if (seat.isLocked) {
        if (isAuthorizedHost) {
          // Host clicks locked seat -> open sheet to unlock
          setSelectedSeatIndex(seatIndex);
        } else {
          alert('هذا المقعد مغلق ومحجوز من قبل صاحب المجلس!');
        }
      } else {
        // Sit down!
        // First, stand up from any other guest seat they might be on
        const updatedSeats = activeRoom.seats.map((s, idx) => {
          if (s.userId === currentUser.id) {
            return { ...s, userId: null }; // Stand up
          }
          if (idx === seatIndex) {
            return { ...s, userId: currentUser.id }; // Sit down
          }
          return s;
        });

        const updatedRoom = { ...activeRoom, seats: updatedSeats };
        setActiveRoom(updatedRoom);
        setRooms(rooms.map(r => r.id === activeRoom.id ? updatedRoom : r));
        
        // Persist seat change to Firestore
        updateDoc(doc(db, "voice_rooms", activeRoom.id), { seats: updatedSeats }).catch(err => {
          console.error("Failed to sync seat change to Firestore:", err);
        });
      }
    }
  };

  // Perform Host Seat Management operations
  const handleHostAction = async (action: 'mute' | 'lock' | 'kick' | 'leave') => {
    if (!activeRoom || selectedSeatIndex === null || !currentUser) return;

    const seat = activeRoom.seats[selectedSeatIndex];
    const isAuthorizedHost = checkIfOwner(activeRoom) || (activeRoom.seats[0] && activeRoom.seats[0].userId === currentUser.id);

    // Safeguard: only owner/host can mute, lock, or kick others
    if ((action === 'mute' || action === 'lock' || action === 'kick') && !isAuthorizedHost) {
      alert("عذراً، هذه الصلاحية مخصصة لصاحب المجلس فقط!");
      return;
    }

    let updatedSeats = [...activeRoom.seats];

    if (action === 'mute') {
      updatedSeats[selectedSeatIndex] = { ...seat, isMuted: !seat.isMuted };
    } else if (action === 'lock') {
      updatedSeats[selectedSeatIndex] = { ...seat, isLocked: !seat.isLocked, userId: null };
    } else if (action === 'kick') {
      updatedSeats[selectedSeatIndex] = { ...seat, userId: null };
    } else if (action === 'leave') {
      // Current user leaves seat
      if (seat.userId === currentUser.id) {
        updatedSeats[selectedSeatIndex] = { ...seat, userId: null };
      }
    }

    // Audio stream management
    if (seat.userId === currentUser.id && updatedSeats[selectedSeatIndex].userId === null) {
      const agoraManager = AgoraEngineManager.getInstance();
      agoraManager.stopPublishing();
    }

    const updatedRoom = { ...activeRoom, seats: updatedSeats };
    setActiveRoom(updatedRoom);
    setRooms(rooms.map(r => r.id === activeRoom.id ? updatedRoom : r));
    setSelectedSeatIndex(null);

    // Real-time synchronization broadcast
    await updateDoc(doc(db, "voice_rooms", activeRoom.id), { seats: updatedSeats });
  };

  // Sending virtual premium gifts
  const handleSendGift = (gift: Gift) => {
    if (!currentUser || !activeRoom) return;

    if (currentUser.coins < gift.cost) {
      alert('عذراً! ليس لديك رصيد كافي من الكوينزات لشراء هذه الهدية. يمكنك الشحن عبر الوكيل المعتمد!');
      return;
    }

    let receiverId: string | null = null;
    let receiverSeatIndex: number | null = null;

    if (selectedRecipientSeatIndex !== 'all') {
      const seat = activeRoom.seats.find(s => s.index === selectedRecipientSeatIndex);
      if (seat && seat.userId) {
        receiverId = seat.userId;
        receiverSeatIndex = seat.index;
      }
    }

    // Process via Firestore (TODO: implement message persistence)
    // Deduct locally and show message
    const updatedUser = { 
      ...currentUser, 
      coins: currentUser.coins - gift.cost,
      xp: currentUser.xp + gift.xpReward,
      level: Math.floor(1 + Math.sqrt((currentUser.xp + gift.xpReward) / 100))
    };
    setCurrentUser(updatedUser);
    setUsers(users.map(u => u.id === currentUser.id ? updatedUser : u));

    setRoomMessages(prev => [
      ...prev,
      {
        sender: currentUser.name,
        text: `أرسل هدية فاخرة: [ ${gift.arabicName} ${gift.icon} ] ! 🌟`,
        color: 'text-amber-400 font-extrabold animate-pulse',
        type: 'chat'
      }
    ]);


      let recName = 'المجلس';
      if (receiverId) {
        const recUser = users.find(u => u.id === receiverId);
        if (recUser) {
          recName = recUser.name;
          // Add 50% commission locally
          const updatedRec = {
            ...recUser,
            coins: recUser.coins + gift.cost * 0.5,
            xp: recUser.xp + gift.xpReward * 0.8,
            level: Math.floor(1 + Math.sqrt((recUser.xp + gift.xpReward * 0.8) / 100))
          };
          setUsers(users.map(u => u.id === receiverId ? updatedRec : u));
        }
      }

      setRoomMessages(prev => [
        ...prev,
        {
          sender: currentUser.name,
          text: `أرسل هدية فاخرة: [ ${gift.arabicName} ${gift.icon} ] إلى [ ${recName} ]! 🌟`,
          color: 'text-amber-400 font-extrabold animate-pulse',
          type: 'chat'
        }
      ]);
  };

  const handleSendChatMessage = async () => {
    const rawText = chatInputValue.trim();
    if (!rawText) return;
    
    let textToSend = rawText;
    let extraProps: any = {};
    
    if (isE2EEEnabled && derivedKey && activeRoom) {
      try {
        addE2eeLog(`جاري تشفير الرسالة الصادرة: "${rawText}"`);
        const { ciphertext, iv } = await encryptMessage(rawText, derivedKey);
        
        const payload = {
          e2ee: true,
          iv: iv,
          ciphertext: ciphertext,
          senderName: currentUser?.name || 'مجهول'
        };
        
        textToSend = `🔒__E2EE__:${JSON.stringify(payload)}`;
        extraProps = {
          isEncrypted: true,
          rawCiphertext: ciphertext,
          iv: iv
        };
        addE2eeLog(`تم تشفير الرسالة الصادرة بنجاح! النص المشفر: "${ciphertext.substring(0, 15)}..."`);
      } catch (err: any) {
        addE2eeLog(`⚠️ فشل التشفير: ${err.message}`);
        alert('فشل تشفير الرسالة تلقائياً!');
        return;
      }
    }
    
    // Send message via Firestore (TODO: implement message persistence)
    setRoomMessages(prev => [
      ...prev,
      {
        sender: currentUser?.name || 'مستخدم',
        text: textToSend,
        color: 'text-purple-300 font-medium',
        type: 'chat',
        ...extraProps
      }
    ]);
    setChatInputValue('');
  };

  // Agent Dashboard logic: User Search
  useEffect(() => {
    if (transferTargetId) {
      const found = users.find(u => u.id === transferTargetId);
      setTransferTargetUser(found || null);
    } else {
      setTransferTargetUser(null);
    }
  }, [transferTargetId, users]);

  // Execute Agent instant coin transfer
  const handleExecuteTransfer = () => {
    setTransferSuccess(false);
    setTransferErrorMsg('');

    if (!transferTargetUser) {
      setTransferErrorMsg('الرجاء إدخال رقم معرف صحيح للعميل والتحقق منه');
      return;
    }

    const amount = parseFloat(transferAmount);
    if (isNaN(amount) || amount <= 0) {
      setTransferErrorMsg('الرجاء إدخال مبلغ تحويل صحيح أكبر من صفر');
      return;
    }

    if (agentBalance < amount) {
      setTransferErrorMsg('عذراً! رصيدك المتاح كوكيل غير كافٍ لإتمام هذه العملية');
      return;
    }

    if (transferPin !== '9999') {
      setTransferErrorMsg('رمز الأمان PIN غير صحيح! الرجاء إدخال الرمز المعتمد 9999');
      return;
    }

    // Process Transfer using Firestore Transaction
    const performTransfer = async () => {
      try {
        const agentRef = doc(db, "users", currentUser?.id || "1004");
        const receiverRef = doc(db, "users", transferTargetUser.id);

        await runTransaction(db, async (transaction) => {
          const agentDoc = await transaction.get(agentRef);
          const receiverDoc = await transaction.get(receiverRef);

          if (!agentDoc.exists()) throw new Error("حساب الوكيل غير موجود");
          if (!receiverDoc.exists()) throw new Error("حساب المستلم غير موجود");

          const agentBalance = agentDoc.data().coins || 0;
          const receiverBalance = receiverDoc.data().coins || 0;

          if (agentBalance < amount) throw new Error("رصيد الوكيل غير كافي");

          transaction.update(agentRef, { coins: agentBalance - amount });
          transaction.update(receiverRef, { coins: receiverBalance + amount });

          // Log transaction
          const logRef = doc(collection(db, "agent_transfer_logs"));
          transaction.set(logRef, {
            id: logRef.id,
            agent_id: currentUser?.id,
            agent_name: currentUser?.name,
            receiver_id: transferTargetUser.id,
            receiver_name: transferTargetUser.name,
            coins_amount: amount,
            timestamp: new Date().toISOString()
          });
        });

        setTransferSuccess(true);
        setTransferAmount('');
        setTransferPin('');
        setTransferTargetId('');
      } catch (err: any) {
        setTransferErrorMsg(err.message || 'حدث خطأ أثناء التحويل');
      }
    };

    performTransfer();
  };

  // Folder tree toggle
  const toggleFolder = (path: string) => {
    setExpandedFolders(prev => ({
      ...prev,
      [path]: !prev[path]
    }));
  };

  // Copy code to clipboard
  const handleCopyCode = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedNotification(true);
    setTimeout(() => setCopiedNotification(false), 2000);
  };

  // Render directory tree recursively
  const renderFolderTree = (node: FolderNode) => {
    const isExpanded = expandedFolders[node.path];
    const isSelected = selectedFileKey === node.contentKey;

    if (node.type === 'file') {
      return (
        <button
          key={node.path}
          onClick={() => node.contentKey && setSelectedFileKey(node.contentKey)}
          className={`w-full text-left pl-6 pr-2 py-1.5 flex items-center space-x-2 text-sm rounded transition duration-150 ${
            isSelected
              ? 'bg-[#7C3AED]/20 border-l-2 border-[#7C3AED] text-white font-medium'
              : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
          }`}
          id={`file-node-${node.contentKey}`}
        >
          <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <span className="font-mono text-xs truncate">{node.name}</span>
        </button>
      );
    }

    return (
      <div key={node.path} className="mb-1">
        <button
          onClick={() => toggleFolder(node.path)}
          className="w-full text-left px-2 py-1.5 flex items-center space-x-1.5 text-sm font-semibold text-slate-300 hover:bg-slate-800/40 rounded transition"
          id={`folder-node-${node.path.replace(/\//g, '-')}`}
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0" />
          )}
          {isExpanded ? (
            <FolderOpen className="w-4 h-4 text-purple-400 flex-shrink-0" />
          ) : (
            <Folder className="w-4 h-4 text-purple-400 flex-shrink-0" />
          )}
          <span className="font-mono text-xs">{node.name}</span>
        </button>

        {isExpanded && node.children && (
          <div className="pl-4 border-l border-slate-800 ml-3 mt-1 space-y-1">
            {node.children.map(child => renderFolderTree(child))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-screen h-[100dvh] bg-[#03000a] text-slate-200 flex flex-col items-center justify-center p-0 relative overflow-hidden" id="root-container">
      {/* Ambient background glows */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-900/10 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[#7C3AED]/10 rounded-full blur-[150px] pointer-events-none"></div>

      {/* Main Workspace Layout */}
      <main className="flex flex-col items-center justify-center flex-grow w-full relative z-10" id="main-content">
        
        {/* LEFT COLUMN: Clean Flutter Architecture & Dart Blueprint Explorer (7 Cols) */}
        <div className="hidden" id="blueprint-explorer">
          
          {/* Header Tab Selector */}
          <div className="flex bg-slate-900/90 border-b border-purple-900/30 p-2 justify-between items-center" id="explorer-tabs">
            <div className="flex gap-1">
              <button
                onClick={() => setActiveTab('architecture')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
                  activeTab === 'architecture'
                    ? 'bg-[#7C3AED] text-white shadow-md'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
                id="tab-architecture"
              >
                <Info className="w-3.5 h-3.5" />
                هيكلية النظام (Architecture)
              </button>
              <button
                onClick={() => setActiveTab('code')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
                  activeTab === 'code'
                    ? 'bg-[#7C3AED] text-white shadow-md'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
                id="tab-code"
              >
                <FileText className="w-3.5 h-3.5" />
                ملفات كود Dart (Blueprints)
              </button>
              <button
                onClick={() => setActiveTab('specs')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
                  activeTab === 'specs'
                    ? 'bg-[#7C3AED] text-white shadow-md'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
                id="tab-specs"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                المواصفات والحلول الفنية
              </button>
            </div>

            {activeTab === 'code' && (
              <button
                onClick={() => handleCopyCode(DART_BLUEPRINTS[selectedFileKey])}
                className="bg-purple-900/50 hover:bg-purple-800 border border-purple-500/30 px-3 py-1.5 rounded-md text-xs font-bold flex items-center gap-1.5 text-purple-300 transition"
                id="copy-code-btn"
              >
                {copiedNotification ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedNotification ? 'تم النسخ!' : 'نسخ الكود'}
              </button>
            )}
          </div>

          {/* Tab Contents */}
          <div className="p-4 flex-grow overflow-y-auto" id="explorer-content">
            
            {/* TAB 1: Architecture Explanation */}
            {activeTab === 'architecture' && (
              <div className="space-y-6 text-slate-300" id="arch-tab-panel">
                <div className="bg-gradient-to-r from-purple-950/40 to-slate-900/60 p-4 rounded-xl border border-purple-500/20">
                  <h3 className="text-base font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-amber-300 mb-2">هيكلية Clean Architecture المعتمدة للهواتف الذكية</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    تم بناء هذا المخطط الهيكلي للهواتف الذكية (Android & iOS) باتباع نمط <strong className="text-slate-200">Clean Architecture</strong> بالتكامل مع إدارة الحالة <strong className="text-purple-300">BLoC (Business Logic Component)</strong> لضمان فصل منطق العمل عن واجهة المستخدم وقابلية كتابة الاختبارات البرمجية وتوسيع النظام لاحقاً.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                    <span className="text-xs font-bold text-[#C026D3] uppercase tracking-wider block mb-1">1. Presentation Layer</span>
                    <p className="text-[11px] text-slate-400 leading-relaxed">تضم واجهات المستخدم (UI Widgets) المكتوبة بـ Flutter ومتحكمات الحالة BLoC التي تستقبل الأحداث وتحدث الشاشة فورياً.</p>
                  </div>
                  <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                    <span className="text-xs font-bold text-[#7C3AED] uppercase tracking-wider block mb-1">2. Domain Layer</span>
                    <p className="text-[11px] text-slate-400 leading-relaxed">تحتوي على منطق التطبيق الأساسي (Business Logic)، وحالات الاستخدام (Use Cases) والكيانات الرياضية المطلقة الخالية من أي تبعيات خارجية.</p>
                  </div>
                  <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                    <span className="text-xs font-bold text-amber-500 uppercase tracking-wider block mb-1">3. Data Layer</span>
                    <p className="text-[11px] text-slate-400 leading-relaxed">مسؤولة عن جلب البيانات وتخزينها، وتضم النماذج (Models)، ومصادر البيانات (Data Sources) سواء عبر الإنترنت أو قواعد البيانات المحلية.</p>
                  </div>
                </div>

                {/* State Management Explanation */}
                <div className="border-t border-purple-900/30 pt-4">
                  <h4 className="text-sm font-bold text-white mb-2 flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-amber-500" />
                    إدارة الحالة باستخدام BLoC & Clean Economy Services
                  </h4>
                  <ul className="text-xs space-y-2.5 text-slate-400">
                    <li className="flex items-start gap-2">
                      <span className="text-amber-500 font-bold">●</span>
                      <span><strong className="text-slate-200">SeatManagementBloc</strong>: يدير حالة مقاعد الغرفة الصوتية الـ 9 بدقة (كتم، قفل، طرد، انضمام) ويقوم بإرسال الإشارات فورياً عبر البنية التحتية.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-purple-400 font-bold">●</span>
                      <span><strong className="text-slate-200">EconomyService</strong>: نظام الحسابات المغلق والوكلاء، يتعامل مع تحويلات الكوينزات الفورية وإدارتها عبر رمز الحماية الثنائي للوكلاء PIN.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan-400 font-bold">●</span>
                      <span><strong className="text-slate-200">WebRtcVoiceService</strong>: طبقة تجريد تتيح محرك الصوت اللاسلكي Agora.</span>
                    </li>
                  </ul>
                </div>

                {/* File Navigator Hint */}
                <div className="bg-purple-950/30 p-3.5 rounded-lg border border-purple-500/25 flex items-center gap-3">
                  <Info className="w-5 h-5 text-purple-400 flex-shrink-0" />
                  <span className="text-xs text-slate-300">
                    تصفح شجرة الملفات بالضغط على علامة <strong className="text-white">"ملفات كود Dart"</strong> بالأعلى لعرض الكود المصدري الكامل لكل ملف ومحتواه المعماري الجاهز للنقل لبيئة العمل الخاصة بك!
                  </span>
                </div>
              </div>
            )}

            {/* TAB 2: Explorable Tree & Source Code Blueprints */}
            {activeTab === 'code' && (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 h-full" id="code-tab-panel">
                
                {/* Left Side: Directory Tree Navigator (4 Cols) */}
                <div className="md:col-span-4 border-r border-slate-800/80 pr-2 max-h-[700px] overflow-y-auto">
                  <div className="pb-3 mb-3 border-b border-slate-800">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">شجرة ملفات فلاتر الهاتف</span>
                  </div>
                </div>

                {/* Right Side: Code Viewer (8 Cols) */}
                <div className="md:col-span-8 flex flex-col h-full bg-slate-900/40 rounded-xl overflow-hidden border border-slate-800">
                  <div className="bg-slate-900/80 px-4 py-2 border-b border-slate-800 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                      <span className="text-xs font-mono font-bold text-amber-300">
                        {selectedFileKey === 'pubspec' ? 'pubspec.yaml' : `lib/.../${selectedFileKey}.dart`}
                      </span>
                    </div>
                    <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">
                      {selectedFileKey === 'pubspec' ? 'yaml' : 'dart'}
                    </span>
                  </div>
                  <pre className="p-4 text-xs font-mono overflow-auto flex-grow max-h-[580px] text-slate-300 bg-[#06040c]">
                    <code>{DART_BLUEPRINTS[selectedFileKey]}</code>
                  </pre>
                </div>

              </div>
            )}

            {/* TAB 3: Tech Specs and Security Design */}
            {activeTab === 'specs' && (
              <div className="space-y-6 text-slate-300" id="specs-tab-panel">
                <div className="bg-slate-900/50 p-4 rounded-xl border border-purple-500/20">
                  <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                    <ShieldAlert className="w-5 h-5 text-amber-500" />
                    المواصفات الفنية لحماية وإدارة الغرف (9 مقاعد)
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed mb-3">
                    المقعد رقم 0 هو دائماً مقعد <strong className="text-slate-200">المستضيف أو صاحب الغرفة (Host)</strong>. المقاعد من 1 إلى 8 هي مقاعد الأعضاء والضيوف (Guests).
                  </p>
                  <div className="space-y-2">
                    <div className="p-2.5 bg-[#03000a] rounded border border-slate-800 text-xs">
                      <strong className="text-[#C026D3]">● نظام كتم الصوت (Muting Engine)</strong>: يرسل إشعاراً للمقعد المعين لتعطيل المايكرفون محلياً عبر SDK ويقفل حالة الإرسال.
                    </div>
                    <div className="p-2.5 bg-[#03000a] rounded border border-slate-800 text-xs">
                      <strong className="text-[#7C3AED]">● قفل المقاعد (Seat Locking)</strong>: يمكن للمستضيف إغلاق أي مقعد شاغر ليصبح غير متاح للانضمام. يظهر المقعد مغلقاً برمز القفل الأحمر.
                    </div>
                    <div className="p-2.5 bg-[#03000a] rounded border border-slate-800 text-xs">
                      <strong className="text-amber-500">● آلية الطرد الفوري (Kicking)</strong>: عند طرد مستخدم من مقعده يتم تحرير المقعد فورياً وإجبار المستمع المطرود على الرجوع لطبقة الجمهور (Audience).
                    </div>
                  </div>
                </div>

                <div className="bg-slate-900/50 p-4 rounded-xl border border-purple-500/20">
                  <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                    <Coins className="w-5 h-5 text-amber-500" />
                    حلول الاقتصاد المغلق ونظام الوكيل الفوري (Agent Dashboard)
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed mb-3">
                    لتجاوز تعقيدات وعمولات متاجر التطبيقات في المراحل الأولى، تم دمج نظام <strong className="text-slate-200">الوكيل المعتمد (Agent Dashboard)</strong> لتمكين عمليات شحن الكوينزات الفورية أوفلاين كاش وتحويلها فورياً عبر معرف المستلم:
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div className="p-3 bg-[#03000a] rounded border border-slate-800">
                      <strong className="text-emerald-400 block mb-1">مصادقة هوية المستلم بالمعرف ID</strong>
                      يقوم الوكيل بإدخال معرف العميل المكون من 4 أرقام لتظهر بطاقة العميل الشخصية (الاسم، الصورة، المستوى) للتحقق منها منعاً للأخطاء قبل التحويل.
                    </div>
                    <div className="p-3 bg-[#03000a] rounded border border-slate-800">
                      <strong className="text-amber-400 block mb-1">توثيق رمز الأمان الوكيل PIN</strong>
                      تتطلب العملية إدخال رمز التحقق الشخصي للوكيل المعتمد (PIN) لتوثيق التحويلات وخصمها من الرصيد السحابي الفوري للوكالة.
                    </div>
                  </div>
                </div>

                <div className="bg-purple-950/20 p-4 rounded-xl border border-[#7C3AED]/30">
                  <h3 className="text-xs font-bold text-white mb-1">تكامل WebRTC للاتصال الصوتي فائق السرعة</h3>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    تم تضمين واجهة Service المجردة <code className="text-amber-300 font-mono">WebRtcVoiceService</code> للربط مع محرك البث Agora. يتميز هذا التجريد بتمكين التطبيق من إدارة جودة البث الصوتي وتتبع المتحدثين النشطين (Active Speakers) وإدارة جودة الصوت ثلاثي الأبعاد الموجه للمجالس الخليجية والعربية الكبرى.
                  </p>
                </div>
              </div>
            )}

          </div>

          {/* Footer Info of the Blueprint column */}
          <div className="bg-slate-900 px-4 py-3 border-t border-purple-900/30 flex justify-between items-center text-xs text-slate-400">
            <span>مخطط فلاتر معتمد بواسطة: <strong className="text-slate-200">Senior Mobile App Architect</strong></span>
            <span>صدى العرب v1.0.0</span>
          </div>

        </div>

         {/* RIGHT COLUMN: Full-Screen Responsive App Container (No frames, adapts completely to screen width and native device edges) */}
        <div className="flex flex-col items-center justify-center w-full h-screen max-h-screen h-[100dvh] max-h-[100dvh] overflow-hidden" id="phone-simulator-container">

          {/* Device Shell - Fully responsive full-screen canvas */}
          <div className="relative w-full h-screen max-h-screen h-[100dvh] max-h-[100dvh] bg-[#03000a] flex flex-col font-sans overflow-hidden" id="smartphone-device">
            
            {/* Smartphone Live Screen Content Area */}
            <div className="flex-grow flex flex-col bg-[#03000a] text-slate-100 overflow-hidden relative" id="smartphone-screen">
              
              {/* SCREEN 1: USER AUTHENTICATION SCREEN */}
              {currentScreen === 'login' && (
                <div className="flex-grow flex flex-col p-5 justify-between items-center bg-[#FAF6EB] h-full relative" id="screen-login text-right">
                  {/* Top Bar */}
                  <div className="w-full flex justify-between items-center text-xs font-sans pt-2">
                    <button 
                      onClick={() => setIsAdminDrawerOpen(true)}
                      className="text-[#8B7E74] hover:text-[#4A3E3D] font-bold bg-[#FFF]/80 p-1.5 px-3 rounded-full border border-[#DCD7C9]/60 shadow-sm cursor-pointer"
                    >
                      ⚙️ الإعدادات
                    </button>
                    <button 
                      onClick={() => alert('مرحباً بك! يمكنك استرداد حسابك القديم عن طريق ربطه برقم الهاتف أو بريدك الإلكتروني بنجاح.')}
                      className="text-[#8B7E74] hover:text-[#4A3E3D] font-bold cursor-pointer"
                    >
                      استرداد الحساب (Account Recovery)
                    </button>
                  </div>

                  {/* Mascot and Brand Illustration */}
                  <div className="flex-grow flex flex-col justify-center items-center w-full my-auto">
                    {/* Floating elements & Cat Mascot */}
                    <div className="relative w-60 h-60 flex items-center justify-center bg-gradient-to-b from-[#FDFBF7] to-[#F1EAD9] rounded-full border border-[#DCD7C9]/50 shadow-inner">
                      {/* Balloons and decorations */}
                      <span className="absolute top-4 left-6 text-2xl animate-bounce" style={{ animationDelay: '0.2s' }}>🎈</span>
                      <span className="absolute top-10 right-4 text-2xl animate-bounce" style={{ animationDelay: '0.6s' }}>🎈</span>
                      <span className="absolute bottom-6 left-2 text-2xl animate-pulse">🎁</span>
                      <span className="absolute bottom-4 right-6 text-xl">🎉</span>
                      <span className="absolute top-1/2 -left-3 text-2xl">🎙️</span>
                      <span className="absolute top-1/3 -right-2 text-xl">✨</span>

                      {/* Main Cute Cat Mascot using CSS shapes and emoji */}
                      <div className="flex flex-col items-center justify-center animate-bounce duration-[3000ms]">
                        <div className="relative w-24 h-24 bg-[#FFF9E6] border-4 border-[#FFAE42] rounded-[36px] flex flex-col items-center justify-center shadow-md">
                          {/* Ears */}
                          <div className="absolute -top-2 left-1.5 w-6 h-6 bg-[#FFAE42] rounded-tl-[18px] rotate-12"></div>
                          <div className="absolute -top-2 right-1.5 w-6 h-6 bg-[#FFAE42] rounded-tr-[18px] -rotate-12"></div>
                          {/* Inner Ears */}
                          <div className="absolute -top-[1px] left-2 w-4 h-4 bg-[#FFD1A9] rounded-tl-[12px] rotate-12"></div>
                          <div className="absolute -top-[1px] right-2 w-4 h-4 bg-[#FFD1A9] rounded-tr-[12px] -rotate-12"></div>
                          
                          {/* Cute Cat Face */}
                          <div className="text-sm font-bold text-[#4A3E3D] mb-1">^ . ^</div>
                          <div className="w-2 h-1 bg-[#FF7F50] rounded-full"></div>
                          <div className="w-5 h-0.5 bg-[#4A3E3D]/20 rounded mt-1"></div>

                          {/* Heart/Cheeks */}
                          <div className="absolute top-[44px] left-2 w-2 h-1.5 bg-[#FFB7B2] rounded-full"></div>
                          <div className="absolute top-[44px] right-2 w-2 h-1.5 bg-[#FFB7B2] rounded-full"></div>
                          
                          {/* Cute Arab collar detail */}
                          <div className="absolute -bottom-0.5 w-12 h-3 bg-white rounded-t-full border-t-2 border-[#DCD7C9] flex justify-center">
                            <div className="w-1 h-1 bg-amber-500 rounded-full mt-0.5 animate-pulse"></div>
                          </div>
                        </div>

                        {/* Arab Cartoon Friends Emojis */}
                        <div className="flex justify-center items-center gap-1.5 mt-3">
                          <div className="w-8 h-8 rounded-full bg-[#FFF] border border-[#E8DCC4] flex items-center justify-center text-md shadow-sm">🧔</div>
                          <div className="w-9 h-9 rounded-full bg-amber-100 border-2 border-amber-400 flex items-center justify-center text-lg shadow-md animate-pulse">🐱</div>
                          <div className="w-8 h-8 rounded-full bg-[#FFF] border border-[#E8DCC4] flex items-center justify-center text-md shadow-sm">👳</div>
                          <div className="w-8 h-8 rounded-full bg-[#FFF] border border-[#E8DCC4] flex items-center justify-center text-md shadow-sm">😎</div>
                        </div>
                      </div>
                    </div>

                    <div className="text-center mt-5">
                      <h2 className="text-xl font-black text-[#4A3E3D] font-sans">صدى العرب 🎙️</h2>
                      <p className="text-[10px] text-[#8B7E74] font-bold mt-1">المجالس الصوتية والترفيهية بنكهة عربية متميزة</p>
                    </div>
                  </div>

                  {/* Auth Content */}
                  <div className="w-full space-y-4 max-w-sm px-2">
                    {/* Google Sign-in Button */}
                    <button
                      onClick={async () => {
                        setAuthLoading(true);
                        setAuthError('');
                        try {
                          const provider = new GoogleAuthProvider();
                          await signInWithPopup(auth, provider);
                        } catch (err: any) {
                          setAuthError(err.message || 'فشل تسجيل الدخول عبر Google');
                        } finally {
                          setAuthLoading(false);
                        }
                      }}
                      disabled={authLoading}
                      className="w-full bg-[#2D2D2D] hover:bg-[#1E1E1E] text-white py-3 rounded-full text-xs font-bold flex items-center justify-center gap-3 transition shadow-md active:scale-[0.98] cursor-pointer disabled:opacity-55"
                      id="login-btn-google"
                    >
                      <svg className="w-4 h-4 text-white fill-current" viewBox="0 0 24 24">
                        <path d="M12.24 10.285V14.4h6.887c-.648 2.41-2.519 4.114-5.136 4.114A5.69 5.69 0 0 1 8.24 12.8a5.69 5.69 0 0 1 5.751-5.714c1.47 0 2.825.534 3.882 1.411l3.14-3.142A9.9 9.9 0 0 0 13.991 3c-5.523 0-10 4.477-10 10s4.477 10 10 10c5.37 0 9.878-3.791 10.009-9.143H12.24Z" />
                      </svg>
                      <span>{authLoading ? 'جاري الاتصال...' : 'الدخول السريع بواسطة Google'}</span>
                    </button>

                    <div className="relative flex py-2 items-center">
                      <div className="flex-grow border-t border-[#DCD7C9]/60"></div>
                      <span className="flex-shrink mx-4 text-[#8B7E74] text-[10px] font-bold">أو عن طريق البريد الإلكتروني</span>
                      <div className="flex-grow border-t border-[#DCD7C9]/60"></div>
                    </div>

                    <div className="bg-white p-4 rounded-2xl border border-[#DCD7C9]/60 shadow-md space-y-4">
                      {/* Tabs */}
                      <div className="flex bg-[#FAF6EB] p-1 rounded-xl">
                        <button
                          type="button"
                          onClick={() => { setAuthMode('login'); setAuthError(''); }}
                          className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                            authMode === 'login'
                              ? 'bg-white text-[#7C3AED] shadow-sm'
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          تسجيل دخول
                        </button>
                        <button
                          type="button"
                          onClick={() => { setAuthMode('signup'); setAuthError(''); }}
                          className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                            authMode === 'signup'
                              ? 'bg-white text-[#7C3AED] shadow-sm'
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          إنشاء حساب جديد
                        </button>
                      </div>

                      {authError && (
                        <div className="bg-rose-50 text-rose-700 text-[10px] p-2.5 rounded-lg border border-rose-200 text-right leading-relaxed font-sans" dir="rtl">
                          ⚠️ {authError}
                        </div>
                      )}

                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (!email.trim() || !password.trim()) {
                            setAuthError('الرجاء تعبئة جميع الحقول المطلوبة');
                            return;
                          }
                          if (authMode === 'signup' && !customName.trim()) {
                            setAuthError('الرجاء إدخال اسمك المستعار');
                            return;
                          }

                          setAuthLoading(true);
                          setAuthError('');
                          try {
                            if (authMode === 'signup') {
                              // Create User
                              const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
                              const firebaseUser = userCredential.user;
                              const defaultAvatar = `https://api.dicebear.com/7.x/adventurer/svg?seed=${firebaseUser.uid}`;
                              
                              // Create Firestore record
                              await setDoc(doc(db, "users", firebaseUser.uid), {
                                id: firebaseUser.uid,
                                uid: firebaseUser.uid,
                                name: customName.trim(),
                                avatar: defaultAvatar,
                                coins: 500,
                                xp: 0,
                                senderXp: 0,
                                badges: [],
                                createdAt: new Date().toISOString()
                              });
                            } else {
                              // Login User
                              await signInWithEmailAndPassword(auth, email.trim(), password);
                            }
                          } catch (err: any) {
                            console.error(err);
                            let arabicMsg = err.message;
                            if (err.code === 'auth/email-already-in-use') {
                              arabicMsg = 'هذا البريد الإلكتروني مسجل بالفعل بحساب آخر!';
                            } else if (err.code === 'auth/weak-password') {
                              arabicMsg = 'كلمة المرور ضعيفة للغاية! يجب أن تكون 6 خانات على الأقل.';
                            } else if (err.code === 'auth/invalid-email') {
                              arabicMsg = 'صيغة البريد الإلكتروني غير صحيحة.';
                            } else if (err.code === 'auth/invalid-credential') {
                              arabicMsg = 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
                            }
                            setAuthError(arabicMsg);
                          } finally {
                            setAuthLoading(false);
                          }
                        }}
                        className="space-y-3.5 text-right font-sans"
                      >
                        {authMode === 'signup' && (
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-500 font-bold block">الاسم المستعار (Pseudonym)</label>
                            <input
                              type="text"
                              required
                              placeholder="أدخل اسمك المستعار (مثال: فارس نجد)"
                              value={customName}
                              onChange={(e) => setCustomName(e.target.value)}
                              className="w-full bg-[#FAF6EB] border border-[#DCD7C9] rounded-xl p-2.5 text-xs text-right text-[#4A3E3D] focus:outline-none focus:border-[#7C3AED]"
                            />
                          </div>
                        )}

                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-500 font-bold block">البريد الإلكتروني (Email)</label>
                          <input
                            type="email"
                            required
                            placeholder="yourname@domain.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full bg-[#FAF6EB] border border-[#DCD7C9] rounded-xl p-2.5 text-xs text-left text-[#4A3E3D] focus:outline-none focus:border-[#7C3AED]"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-500 font-bold block">كلمة المرور (Password)</label>
                          <input
                            type="password"
                            required
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full bg-[#FAF6EB] border border-[#DCD7C9] rounded-xl p-2.5 text-xs text-left text-[#4A3E3D] focus:outline-none focus:border-[#7C3AED]"
                          />
                        </div>

                        <button
                          type="submit"
                          disabled={authLoading}
                          className="w-full bg-[#7C3AED] hover:bg-[#6D28D9] text-white py-2.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          {authLoading ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              <span>جاري المعالجة...</span>
                            </>
                          ) : (
                            <span>{authMode === 'signup' ? 'إنشاء حساب حقيقي ودخول 🔒' : 'دخول المجلس الآمن 🔒'}</span>
                          )}
                        </button>
                      </form>
                    </div>
                  </div>

                  {/* Consent & Agreement */}
                  <div className="w-full max-w-xs flex flex-col items-center gap-2 pb-2">
                    <div className="flex items-center gap-1.5 text-[9px] text-[#8B7E74] font-medium justify-center text-right font-sans">
                      <span className="text-[#FFAE42] text-xs">✔</span>
                      <span>
                        الدخول يعني الموافقة على <span className="text-[#FFAE42] font-bold cursor-pointer underline">اتفاقية مستخدم صدى العرب</span> وسياسة الخصوصية.
                      </span>
                    </div>
                    <span className="text-[#8B7E74] text-[8px] font-mono bg-[#FFF]/60 px-2 py-0.5 rounded-full border border-[#DCD7C9]/40">
                      Auto-detected: {deviceInfo.modelName}
                    </span>
                  </div>
                </div>
              )}

              {/* SCREEN 2: ROOM EXPLORE LIST SCREEN (THE CORE TABBED DASHBOARD SYSTEM) */}
              {currentScreen === 'explore' && currentUser && (
                <div className="flex-grow flex flex-col h-full bg-[#FAF6EB] text-[#4A3E3D] relative overflow-hidden" id="screen-explore" dir="rtl">
                  
                  {/* Dashboard General Top Header (Pristine status layout matching Screenshots) */}
                  <div className="bg-white p-3.5 border-b border-[#E8DCC4]/60 flex justify-between items-center shadow-sm select-none">
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <div className="w-10 h-10 rounded-full border-2 border-[#FFAE42] p-0.5 shadow-sm bg-amber-50">
                          <img
                            src={currentUser.avatar || "https://api.dicebear.com/7.x/adventurer/svg?seed=placeholder"}
                            alt="avatar"
                            className="w-full h-full rounded-full object-cover"
                          />
                        </div>
                        <span className="absolute -bottom-1 -right-1 bg-[#FFAE42] text-white font-extrabold text-[8px] px-1.5 rounded-full border border-white">
                          Lv.{currentUser.level}
                        </span>
                      </div>
                      <div className="text-right">
                        <h4 className="text-xs font-black text-[#4A3E3D] max-w-[120px] truncate leading-tight">{currentUser.name}</h4>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[10px] text-[#FFAE42] font-black flex items-center gap-0.5">
                            🪙 {currentUser.coins.toFixed(0)}
                          </span>
                          <span className="text-[8px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-mono">
                            ID: {currentUser.id}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Quick navigation and administrative gates */}
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => setCurrentScreen('agent_pin')}
                        className="bg-[#FFAE42]/10 hover:bg-[#FFAE42]/20 text-[#D97706] border border-[#FFAE42]/30 px-2.5 py-1 rounded-full text-[9px] font-bold flex items-center gap-1 transition-all active:scale-95 cursor-pointer"
                        title="بوابة الشحن والوكيل المعتمد"
                        id="agent-dashboard-gate-btn"
                      >
                        ⚡ بوابة الوكيل
                      </button>

                      <button
                        onClick={() => setIsAdminDrawerOpen(true)}
                        className="bg-slate-100 hover:bg-slate-200 border border-slate-200/60 p-1.5 rounded-full text-[#8B7E74] transition-all active:scale-90 cursor-pointer"
                        title="لوحة المطورين والمخططات"
                      >
                        ⚙️
                      </button>

                      <button
                        onClick={() => { signOut(auth).catch(err => console.error(err)); }}
                        className="bg-red-50 hover:bg-red-100 p-1.5 rounded-full text-red-500 border border-red-100 transition-all active:scale-90 cursor-pointer"
                        title="تسجيل الخروج"
                        id="logout-btn"
                      >
                        🚪
                      </button>
                    </div>
                  </div>

                  {/* SUB-VIEW RENDERING AREA */}
                  <div className="flex-grow overflow-y-auto p-4 pb-20 space-y-4" id="dashboard-tab-content">

                    {/* ==================== 1. PARTY TAB (المجالس الصوتية) ==================== */}
                    {dashboardTab === 'party' && (
                      <div className="space-y-4 animate-fade-in" id="tab-panel-party">
                        {/* Search & Refresh row */}
                        <div className="flex gap-2">
                          <div className="relative flex-grow">
                            <input
                              type="text"
                              placeholder="البحث عن مجالس صوتية أو معرف ID..."
                              className="w-full bg-white border border-[#E8DCC4] rounded-full py-1.5 pl-3 pr-8 text-xs text-right text-[#4A3E3D] focus:outline-none focus:border-[#FFAE42]"
                            />
                            <Search className="w-3.5 h-3.5 text-slate-400 absolute top-2.5 right-3" />
                          </div>
                          <button
                            onClick={() => {
                              setIsRefreshing(true);
                              setTimeout(() => setIsRefreshing(false), 1000);
                            }}
                            disabled={isRefreshing}
                            className="bg-white hover:bg-slate-50 border border-[#E8DCC4] p-2 rounded-full transition active:scale-95 flex items-center justify-center cursor-pointer"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 text-[#FFAE42] ${isRefreshing ? 'animate-spin' : ''}`} />
                          </button>
                        </div>

                        {/* Top banner */}
                        <div className="bg-gradient-to-r from-amber-500 to-yellow-400 p-3 rounded-2xl text-white shadow-sm relative overflow-hidden">
                          <div className="absolute -left-4 -bottom-4 text-6xl opacity-20">🎙️</div>
                          <h4 className="text-[11px] font-black">مهرجان صدى العرب الصوتي 🌟</h4>
                          <p className="text-[9px] text-amber-50 mt-0.5">شارك في مجالس الصوت واحصل على 50% عمولة هدايا فورية!</p>
                        </div>

                        {/* Rooms List */}
                        <div className="space-y-2.5">
                          {isRefreshing ? (
                            <div className="space-y-2 animate-pulse">
                              {[1, 2, 3].map(n => (
                                <div key={n} className="h-16 bg-white rounded-xl border border-slate-100"></div>
                              ))}
                            </div>
                          ) : (
                            rooms.map((room) => (
                              <div
                                key={room.id}
                                onClick={() => handleEnterRoom(room)}
                                className="bg-white hover:bg-[#FDFBF7] border border-[#E8DCC4]/60 p-3 rounded-xl transition duration-150 cursor-pointer flex justify-between items-center shadow-sm hover:shadow active:scale-[0.99]"
                                id={`room-item-${room.id}`}
                              >
                                <div className="flex items-center gap-3">
                                  <div className="relative">
                                    <img
                                      src={room.hostAvatar || "https://api.dicebear.com/7.x/adventurer/svg?seed=placeholder"}
                                      alt="host"
                                      className="w-11 h-11 rounded-lg object-cover border border-[#FFAE42]/20 shadow-sm"
                                    />
                                  </div>
                                  <div className="text-right">
                                    <h4 className="text-xs font-extrabold text-[#4A3E3D] flex items-center gap-1">
                                      <span>{room.name}</span>
                                    </h4>
                                    <p className="text-[9px] text-slate-500 mt-0.5">المستضيف: {room.hostName}</p>
                                    <div className="flex gap-1.5 mt-1">
                                      <span className="bg-amber-50 text-[#FFAE42] text-[8px] px-1.5 py-0.5 rounded font-extrabold border border-[#FFAE42]/10">
                                        Lv.{room.level}
                                      </span>
                                      <span className="bg-emerald-50 text-emerald-600 text-[8px] px-1.5 py-0.5 rounded font-bold border border-emerald-100">
                                        مجلس عام 🔓
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                <div className="text-left flex items-center gap-1 bg-[#FFAE42]/10 px-2 py-0.5 rounded-full border border-[#FFAE42]/20">
                                  <span className="relative flex h-1.5 w-1.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500"></span>
                                  </span>
                                  <span className="text-[9px] font-mono text-[#D97706] font-extrabold">
                                    {room.activeUsersCount} متواجد
                                  </span>
                                </div>
                              </div>
                            ))
                          )}
                        </div>

                        {/* Floating Golden Microphone Create Room button */}
                        <div className="fixed bottom-20 left-4 z-40">
                          {(() => {
                            const myRoom = rooms.find(r => 
                              (r.owner_id && currentUser?.id && r.owner_id === currentUser.id)
                            );
                            if (myRoom) {
                              return (
                                <button
                                  onClick={() => handleEnterRoom(myRoom)}
                                  className="bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-600 hover:to-yellow-500 text-white font-black text-xs p-3.5 rounded-full shadow-lg flex items-center gap-2 hover:scale-105 active:scale-95 transition-all cursor-pointer border-2 border-white"
                                >
                                  <span>🎙️ الدخول للغرفة</span>
                                </button>
                              );
                            } else {
                              return (
                                <button
                                  onClick={() => {
                                    setNewRoomNameInput('');
                                    setNewRoomIsPrivate(false);
                                    setNewRoomPassword('');
                                    setNewRoomError('');
                                    setIsCreateRoomModalOpen(true);
                                  }}
                                  className="bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-600 hover:to-yellow-500 text-white font-black text-xs p-3.5 rounded-full shadow-lg flex items-center gap-2 hover:scale-105 active:scale-95 transition-all cursor-pointer border-2 border-white"
                                >
                                  <span>🎙️ إنشاء روم</span>
                                </button>
                              );
                            }
                          })()}
                        </div>
                      </div>
                    )}

                    {/* ==================== 2. GAME CENTER TAB (الألعاب الجماعية) ==================== */}
                    {dashboardTab === 'games' && (
                      <div className="space-y-4 animate-fade-in" id="tab-panel-games">
                        
                        {/* Daily active tasks bar showing wood/gold chests */}
                        <div className="bg-white p-3.5 rounded-2xl border border-[#E8DCC4]/60 shadow-sm text-right space-y-2.5">
                          <div className="flex justify-between items-center">
                            <span className="text-[11px] font-black text-[#4A3E3D] flex items-center gap-1">
                              🎁 المكافأة والصندوق اليومي
                            </span>
                            <span className="text-[9px] text-[#FFAE42] font-bold">نشاط اليوم: 60/100 XP</span>
                          </div>
                          
                          {/* Progress bar */}
                          <div className="w-full bg-slate-100 h-2.5 rounded-full relative overflow-hidden">
                            <div className="bg-gradient-to-l from-amber-500 to-yellow-400 h-full rounded-full w-3/5"></div>
                          </div>

                          {/* Chest icons matching progress */}
                          <div className="flex justify-between items-center pt-1 text-xs">
                            <div className="text-center">
                              <span className="block text-lg">📦</span>
                              <span className="text-[8px] text-slate-500">20 XP</span>
                            </div>
                            <div className="text-center">
                              <span className="block text-lg filter saturate-50">🪵</span>
                              <span className="text-[8px] text-slate-500">50 XP</span>
                            </div>
                            <div className="text-center animate-pulse">
                              <span className="block text-xl">👑</span>
                              <span className="text-[8px] text-amber-500 font-extrabold">100 XP</span>
                            </div>
                          </div>

                          {/* Claim button */}
                          <button
                            onClick={() => {
                              if (dailyBonusClaimed) {
                                alert('لقد استلمت جائزتك اليومية بالفعل! عد غداً للمزيد من الهدايا 🎁');
                              } else {
                                setIsDailyBonusOpen(true);
                              }
                            }}
                            className={`w-full py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer ${
                              dailyBonusClaimed 
                                ? 'bg-slate-100 text-slate-400 border border-slate-200' 
                                : 'bg-gradient-to-r from-amber-500 to-yellow-400 hover:scale-[1.01] text-white shadow-sm'
                            }`}
                          >
                            <span>{dailyBonusClaimed ? '✓ تم استلام الجائزة اليومية' : '🎁 افتح صندوق الكنز اليومي'}</span>
                          </button>
                        </div>

                        {/* Interactive Games Card Grid */}
                        <div className="space-y-2">
                          <h3 className="text-xs font-bold text-slate-500 tracking-wide pr-1">ألعاب المجالس والدردشة</h3>
                          <div className="grid grid-cols-2 gap-3">
                            {/* Game 1 */}
                            <div 
                              onClick={() => alert('جاري تحميل لعبة كيرم... يرجى الاتصال بالغرفة للعبها معاً!')}
                              className="bg-white p-3 rounded-2xl border border-[#E8DCC4]/60 shadow-sm text-right space-y-1.5 hover:scale-[1.02] active:scale-[0.98] transition cursor-pointer relative overflow-hidden"
                            >
                              <div className="absolute top-2 left-2 bg-red-100 text-red-600 text-[8px] px-1.5 py-0.5 rounded-full font-bold">HOT</div>
                              <span className="text-2xl block">🎱</span>
                              <h4 className="text-xs font-black text-[#4A3E3D]">لعبة كيرم (Carrom)</h4>
                              <p className="text-[9px] text-slate-400">🔥 3.4K لاعب متواجد</p>
                            </div>

                            {/* Game 2 */}
                            <div 
                              onClick={() => alert('جاري تحميل لعبة بلوت... تنافس مع أصدقائك في ديوانية صدى العرب!')}
                              className="bg-white p-3 rounded-2xl border border-[#E8DCC4]/60 shadow-sm text-right space-y-1.5 hover:scale-[1.02] active:scale-[0.98] transition cursor-pointer relative overflow-hidden"
                            >
                              <div className="absolute top-2 left-2 bg-amber-100 text-[#D97706] text-[8px] px-1.5 py-0.5 rounded-full font-bold">بطولة</div>
                              <span className="text-2xl block">🃏</span>
                              <h4 className="text-xs font-black text-[#4A3E3D]">لعبة بلوت (Baloot)</h4>
                              <p className="text-[9px] text-slate-400">🏆 تنافس فوري</p>
                            </div>

                            {/* Game 3 */}
                            <div 
                              onClick={() => alert('جاري تحميل لعبة قنبلة القط الكلاسيكية...')}
                              className="bg-white p-3 rounded-2xl border border-[#E8DCC4]/60 shadow-sm text-right space-y-1.5 hover:scale-[1.02] active:scale-[0.98] transition cursor-pointer"
                            >
                              <span className="text-2xl block">💣</span>
                              <h4 className="text-xs font-black text-[#4A3E3D]">قنبلة القط (No.Bomb)</h4>
                              <p className="text-[9px] text-slate-400">⚡ الإقصاء السريع</p>
                            </div>

                            {/* Game 4 */}
                            <div 
                              onClick={() => alert('جاري فتح طاولات OKEY الممتازة...')}
                              className="bg-white p-3 rounded-2xl border border-[#E8DCC4]/60 shadow-sm text-right space-y-1.5 hover:scale-[1.02] active:scale-[0.98] transition cursor-pointer"
                            >
                              <span className="text-2xl block">🎲</span>
                              <h4 className="text-xs font-black text-[#4A3E3D]">لعبة أوكي (OKEY)</h4>
                              <p className="text-[9px] text-slate-400">💎 طاولة SVIP الفخمة</p>
                            </div>

                            {/* Game 5 */}
                            <div 
                              onClick={() => alert('جاري تحميل أونو...')}
                              className="bg-white p-3 rounded-2xl border border-[#E8DCC4]/60 shadow-sm text-right space-y-1.5 hover:scale-[1.02] active:scale-[0.98] transition cursor-pointer"
                            >
                              <span className="text-2xl block">🎨</span>
                              <h4 className="text-xs font-black text-[#4A3E3D]">لعبة أونو (ONO)</h4>
                              <p className="text-[9px] text-slate-400">🔥 1.2K متواجد</p>
                            </div>

                            {/* Game 6 */}
                            <div 
                              onClick={() => alert('جاري تحميل لعبة دومينو...')}
                              className="bg-white p-3 rounded-2xl border border-[#E8DCC4]/60 shadow-sm text-right space-y-1.5 hover:scale-[1.02] active:scale-[0.98] transition cursor-pointer"
                            >
                              <span className="text-2xl block">🀄</span>
                              <h4 className="text-xs font-black text-[#4A3E3D]">الدومينو (Domino)</h4>
                              <p className="text-[9px] text-slate-400">✨ اللعب الكلاسيكي</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ==================== 3. DISCOVER TAB (اكتشف وكوكب الهدايا) ==================== */}
                    {dashboardTab === 'explore' && (
                      <div className="space-y-4 animate-fade-in" id="tab-panel-discover">
                        
                        {/* Elegant sub-tab selector inside Discover */}
                        <div className="bg-white p-1 rounded-full border border-[#E8DCC4]/60 flex shadow-sm">
                          <button
                            onClick={() => setExploreSubTab('planet')}
                            className={`w-1/3 py-1 text-[11px] rounded-full font-black transition-all cursor-pointer ${
                              exploreSubTab === 'planet' 
                                ? 'bg-amber-400 text-slate-900 shadow-sm' 
                                : 'text-slate-500 hover:text-slate-800'
                            }`}
                          >
                            🌊 كوكب الهدايا
                          </button>
                          <button
                            onClick={() => {
                              setExploreSubTab('clans');
                              fetchLiveLeaderboard();
                            }}
                            className={`w-1/3 py-1 text-[11px] rounded-full font-black transition-all cursor-pointer ${
                              exploreSubTab === 'clans' 
                                ? 'bg-amber-400 text-slate-900 shadow-sm' 
                                : 'text-slate-500 hover:text-slate-800'
                            }`}
                          >
                            🛡️ العائلات والقبائل
                          </button>
                          <button
                            onClick={() => {
                              setExploreSubTab('leaderboard');
                              fetchLiveLeaderboard();
                            }}
                            className={`w-1/3 py-1 text-[11px] rounded-full font-black transition-all cursor-pointer ${
                              exploreSubTab === 'leaderboard' 
                                ? 'bg-amber-400 text-slate-900 shadow-sm' 
                                : 'text-slate-500 hover:text-slate-800'
                            }`}
                          >
                            🏆 لوحة الصدارة
                          </button>
                        </div>

                        {/* SUB-PANEL 1: PLANET / DRIFTING BOTTLE */}
                        {exploreSubTab === 'planet' && (
                          <div className="space-y-4 animate-fade-in">
                            {/* Drifting Bottle and Ahlan Garden widgets */}
                            <div className="grid grid-cols-2 gap-3">
                              {/* Ocean Bottle */}
                              <div 
                                onClick={() => setDriftingBottleMode('writing')}
                                className="bg-gradient-to-br from-cyan-400 to-blue-500 p-3.5 rounded-2xl text-white text-right space-y-1 hover:scale-[1.02] active:scale-[0.98] transition cursor-pointer shadow-sm relative overflow-hidden"
                              >
                                <span className="absolute -left-3 -bottom-3 text-5xl opacity-20">🌊</span>
                                <span className="text-2xl block">🍾</span>
                                <h4 className="text-xs font-black">زجاجة الرسائل</h4>
                                <p className="text-[9px] text-cyan-50">ارمِ سرك في البحر أو التقط زجاجة عشوائية!</p>
                              </div>

                              {/* Ahlan Garden */}
                              <div 
                                onClick={() => alert('🌱 بستان صدى العرب: ميزة زراعة الزهور ومبادلة البذور قادمة قريباً!')}
                                className="bg-gradient-to-br from-emerald-400 to-teal-500 p-3.5 rounded-2xl text-white text-right space-y-1 hover:scale-[1.02] active:scale-[0.98] transition cursor-pointer shadow-sm relative overflow-hidden"
                              >
                                <span className="absolute -left-3 -bottom-3 text-5xl opacity-20">🌸</span>
                                <span className="text-2xl block">🌹</span>
                                <h4 className="text-xs font-black">بستان صدى العرب</h4>
                                <p className="text-[9px] text-emerald-50">اهتم بحديقتك واحصد كوينز مع الأصدقاء!</p>
                              </div>
                            </div>

                            {/* Gift Gifting Podium Column Rankings */}
                            <div className="bg-white p-4 rounded-2xl border border-[#E8DCC4]/60 shadow-sm text-center space-y-4">
                              <div>
                                <h3 className="text-xs font-black text-[#4A3E3D]">🏆 لوحة شرف وهدايا مجالس صدى</h3>
                                <p className="text-[9px] text-slate-500 mt-0.5">ترتيب الفرسان الأكثر جوداً وسخاءً هذا الشهر</p>
                              </div>

                              {/* 3D-Like Podium Columns */}
                              <div className="flex justify-center items-end gap-3 pt-6 pb-2 min-h-[140px]">
                                {/* Podium No.2 */}
                                <div className="flex flex-col items-center w-20">
                                  <div className="relative">
                                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-md">🥈</span>
                                    <div className="w-10 h-10 rounded-full border-2 border-slate-300 p-0.5 bg-slate-50">
                                      <img
                                        src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=120"
                                        className="w-full h-full rounded-full object-cover"
                                      />
                                    </div>
                                  </div>
                                  <span className="text-[9px] font-bold text-slate-700 mt-1 truncate w-16">سارة القحطاني</span>
                                  <span className="text-[8px] text-slate-500 font-bold leading-none mt-0.5">98K كوينز</span>
                                  <div className="w-full bg-slate-200 h-10 rounded-t-lg mt-2 flex items-center justify-center font-bold text-slate-500 text-xs shadow-inner">
                                    2
                                  </div>
                                </div>

                                {/* Podium No.1 */}
                                <div className="flex flex-col items-center w-22">
                                  <div className="relative -top-3 scale-110">
                                    <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-xl animate-bounce">👑</span>
                                    <div className="w-11 h-11 rounded-full border-2 border-[#FFAE42] p-0.5 bg-amber-50">
                                      <img
                                        src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=120"
                                        className="w-full h-full rounded-full object-cover"
                                      />
                                    </div>
                                  </div>
                                  <span className="text-[9px] font-black text-amber-600 mt-1 truncate w-18">أحمد العتيبي</span>
                                  <span className="text-[8px] text-amber-500 font-extrabold leading-none mt-0.5">125K كوينز</span>
                                  <div className="w-full bg-[#FFAE42] h-14 rounded-t-lg mt-2 flex items-center justify-center font-black text-white text-sm shadow">
                                    1
                                  </div>
                                </div>

                                {/* Podium No.3 */}
                                <div className="flex flex-col items-center w-20">
                                  <div className="relative">
                                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-md">🥉</span>
                                    <div className="w-10 h-10 rounded-full border-2 border-amber-700 p-0.5 bg-amber-50/20">
                                      <img
                                        src="https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=120"
                                        className="w-full h-full rounded-full object-cover"
                                      />
                                    </div>
                                  </div>
                                  <span className="text-[9px] font-bold text-[#8B7E74] mt-1 truncate w-16">ياسر الشمري</span>
                                  <span className="text-[8px] text-slate-500 font-bold leading-none mt-0.5">75K كوينز</span>
                                  <div className="w-full bg-orange-100 h-8 rounded-t-lg mt-2 flex items-center justify-center font-bold text-amber-800 text-xs shadow-inner">
                                    3
                                  </div>
                                </div>
                              </div>

                              <button
                                onClick={() => setExploreSubTab('leaderboard')}
                                className="text-[9px] text-[#FFAE42] font-black hover:underline"
                              >
                                عرض قائمة المتصدرين الكاملة لصدى العرب ←
                              </button>
                            </div>
                          </div>
                        )}

                        {/* SUB-PANEL 2: CLANS & FAMILIES */}
                        {exploreSubTab === 'clans' && (
                          <div className="space-y-4 animate-fade-in text-right">
                            
                            {/* Create Clan Form */}
                            <div className="bg-white p-4 rounded-2xl border border-[#E8DCC4]/60 shadow-sm space-y-3">
                              <h3 className="text-xs font-black text-[#4A3E3D] flex items-center gap-1.5 justify-end">
                                <span>تأسيس عائلة/قبيلة جديدة</span>
                                <span>🛡️</span>
                              </h3>
                              <p className="text-[9.5px] text-slate-500 leading-normal">
                                بتأسيسك للعائلة، ستجمع أعضاء مخلصين وتتنافسون مع باقي العائلات لرفع ترتيب القبيلة والحصول على أوسمة حصرية ومكافآت كوينز دورية. <span className="font-extrabold text-amber-600">(تكلفة التأسيس: 1000 كوين)</span>
                              </p>

                              <div className="grid grid-cols-4 gap-2 items-center">
                                <div className="col-span-3">
                                  <input
                                    type="text"
                                    placeholder="اكتب اسم القبيلة/العائلة..."
                                    value={newClanName}
                                    onChange={(e) => setNewClanName(e.target.value)}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs text-right focus:outline-none focus:border-amber-400"
                                  />
                                </div>
                                <div className="col-span-1">
                                  <select
                                    value={newClanLogo}
                                    onChange={(e) => setNewClanLogo(e.target.value)}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs text-center focus:outline-none"
                                  >
                                    <option value="🛡️">🛡️</option>
                                    <option value="👑">👑</option>
                                    <option value="🦁">🦁</option>
                                    <option value="🦅">🦅</option>
                                    <option value="⚔️">⚔️</option>
                                    <option value="💎">💎</option>
                                  </select>
                                </div>
                              </div>

                              <button
                                onClick={async () => {
                                  if (!newClanName.trim()) {
                                    alert('الرجاء كتابة اسم العائلة أولاً');
                                    return;
                                  }
                                  if (currentUser.coins < 1000) {
                                    alert('رصيدك من الكوينز غير كافٍ لتأسيس عائلة (تحتاج لـ 1000 كوين)');
                                    return;
                                  }

                                  try {
                                    const clanId = `clan_${Date.now()}`;
                                    await setDoc(doc(db, "clans", clanId), {
                                      clan_name: newClanName,
                                      clan_logo: newClanLogo,
                                      owner_id: currentUser.id,
                                      totalXp: 0,
                                      members: [currentUser.id]
                                    });

                                    await updateDoc(doc(db, "users", currentUser.id), {
                                      coins: increment(-1000),
                                      clanId: clanId,
                                      badges: arrayUnion('loyal_member')
                                    });

                                    alert(`🎉 مبارك! تم تأسيس عائلة [${newClanName}] بنجاح، وتم منحك وسام العضو الوفي!`);
                                    setNewClanName('');
                                  } catch (e: any) {
                                    alert(`خطأ في تأسيس العائلة: ${e.message}`);
                                  }
                                }}
                                className="w-full bg-gradient-to-r from-amber-500 to-amber-600 text-white font-black text-xs py-2 rounded-xl shadow-md active:scale-95 transition"
                              >
                                دفع 1000 كوين وتأسيس العائلة ⚡
                              </button>
                            </div>

                            {/* List of Clans */}
                            <div className="bg-white p-4 rounded-2xl border border-[#E8DCC4]/60 shadow-sm space-y-3">
                              <h3 className="text-xs font-black text-[#4A3E3D] flex justify-between items-center">
                                <span className="text-[10px] text-slate-400 font-medium">الترتيب حسب نقاط الخبرة (XP)</span>
                                <span className="flex items-center gap-1.5 font-black">
                                  <span>القبائل والعائلات النشطة</span>
                                  <span>🏰</span>
                                </span>
                              </h3>

                              {isLeaderboardLoading ? (
                                <p className="text-xs text-slate-400 text-center py-4">جاري تحميل القبائل النشطة...</p>
                              ) : !liveLeaderboard?.clans || liveLeaderboard.clans.length === 0 ? (
                                <p className="text-xs text-slate-400 text-center py-4 italic">لا توجد قبائل مؤسسة حالياً. كن أول من يؤسس قبيلته!</p>
                              ) : (
                                <div className="space-y-2">
                                  {liveLeaderboard.clans.map((clan, index) => {
                                    const isMyClan = currentUser.clanId === clan.clan_id;
                                    return (
                                      <div key={clan.clan_id} className={`flex justify-between items-center p-2.5 rounded-xl border ${isMyClan ? 'bg-amber-50/60 border-amber-400' : 'bg-slate-50/50 border-slate-100'} transition`}>
                                        <div className="flex gap-1.5">
                                          {isMyClan ? (
                                            <span className="bg-emerald-500/20 text-emerald-600 text-[8px] font-black px-2 py-1 rounded-md">عائلتك</span>
                                          ) : (
                                            <button
                                              onClick={async () => {
                                                if (currentUser.clanId) {
                                                  alert('أنت تنتمي لعائلة بالفعل! يجب مغادرة عائلتك الحالية قبل الانضمام لعائلة جديدة.');
                                                  return;
                                                }

                                                try {
                                                  await updateDoc(doc(db, "clans", clan.clan_id), {
                                                    members: arrayUnion(currentUser.id)
                                                  });
                                                  await updateDoc(doc(db, "users", currentUser.id), {
                                                    clanId: clan.clan_id,
                                                    badges: arrayUnion('loyal_member')
                                                  });
                                                  alert(`🤝 تم انضمامك بنجاح لعائلة [${clan.clan_name}]! وحصلت على لقب العضو الوفي!`);
                                                } catch (e: any) {
                                                  alert(`خطأ في الانضمام: ${e.message}`);
                                                }
                                              }}
                                              className="bg-amber-500 hover:bg-amber-600 text-white text-[9px] font-black px-3 py-1 rounded-full cursor-pointer transition shadow-sm"
                                            >
                                              انضمام 🤝
                                            </button>
                                          )}
                                        </div>

                                        <div className="flex items-center gap-2">
                                          <div className="text-right">
                                            <h5 className="text-xs font-black text-[#4A3E3D] flex items-center gap-1 justify-end">
                                              <span>{clan.clan_name}</span>
                                              <span className="text-md">{clan.clan_logo}</span>
                                            </h5>
                                            <p className="text-[8px] text-slate-400 mt-0.5">القائد: {clan.owner_id === currentUser.id ? 'أنت' : clan.owner_id} | نقاط الخبرة: ⭐ {clan.total_xp}</p>
                                          </div>
                                          <span className="text-xs font-black text-slate-400 w-4 text-center">#{index + 1}</span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* SUB-PANEL 3: LIVE LEADERBOARD */}
                        {exploreSubTab === 'leaderboard' && (
                          <div className="space-y-4 animate-fade-in text-right">
                            
                            {/* Senders and Receivers lists */}
                            <div className="bg-white p-4 rounded-2xl border border-[#E8DCC4]/60 shadow-sm space-y-4">
                              <div className="border-b border-slate-100 pb-2">
                                <h3 className="text-xs font-black text-[#4A3E3D] flex items-center gap-1.5 justify-end">
                                  <span>👑 فرسان السخاء والعطاء</span>
                                  <span>✨</span>
                                </h3>
                                <p className="text-[9px] text-slate-400 mt-0.5">ترتيب المستخدمين الداعمين الأكثر إرسالاً للهدايا</p>
                              </div>

                              {isLeaderboardLoading ? (
                                <p className="text-xs text-slate-400 text-center">جاري جلب لوحة الصدارة الحية...</p>
                              ) : !liveLeaderboard?.senders || liveLeaderboard.senders.length === 0 ? (
                                <p className="text-xs text-slate-400 text-center italic">لا يوجد داعمون نشطون في هذه الدورة</p>
                              ) : (
                                <div className="space-y-2">
                                  {liveLeaderboard.senders.map((user, idx) => (
                                    <div key={user.id} className="flex justify-between items-center p-2 rounded-xl bg-slate-50/50 hover:bg-slate-50 border border-slate-100/60">
                                      <span className="text-[10px] text-amber-600 font-extrabold font-mono">⭐ {user.sender_xp || 0} XP</span>
                                      
                                      <div className="flex items-center gap-2">
                                        <div className="text-right">
                                          <h4 className="text-xs font-black text-slate-800 flex items-center gap-1">
                                            <span className="bg-purple-600 text-white text-[7px] font-black px-1 rounded">VIP {user.vip_level || 1}</span>
                                            <span>{user.name}</span>
                                          </h4>
                                          <p className="text-[8px] text-slate-400">مستوى الحساب: {user.level} | معرف: {user.id}</p>
                                        </div>
                                        <span className="text-xs font-black text-slate-400 w-4 text-center">#{idx + 1}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Charm Receivers list */}
                            <div className="bg-white p-4 rounded-2xl border border-[#E8DCC4]/60 shadow-sm space-y-4">
                              <div className="border-b border-slate-100 pb-2">
                                <h3 className="text-xs font-black text-[#4A3E3D] flex items-center gap-1.5 justify-end">
                                  <span>💖 نجوم الجاذبية والكاريزما</span>
                                  <span>✨</span>
                                </h3>
                                <p className="text-[9px] text-slate-400 mt-0.5">ترتيب المستخدمين الأكثر استقبالاً للهدايا والجاذبية</p>
                              </div>

                              {isLeaderboardLoading ? (
                                <p className="text-xs text-slate-400 text-center">جاري جلب لوحة الصدارة الحية...</p>
                              ) : !liveLeaderboard?.receivers || liveLeaderboard.receivers.length === 0 ? (
                                <p className="text-xs text-slate-400 text-center italic">لا توجد نجوم جاذبية نشطة حالياً</p>
                              ) : (
                                <div className="space-y-2">
                                  {liveLeaderboard.receivers.map((user, idx) => (
                                    <div key={user.id} className="flex justify-between items-center p-2 rounded-xl bg-slate-50/50 hover:bg-slate-50 border border-slate-100/60">
                                      <span className="text-[10px] text-rose-500 font-extrabold font-mono">💖 {user.charm_xp || 0} XP</span>
                                      
                                      <div className="flex items-center gap-2">
                                        <div className="text-right">
                                          <h4 className="text-xs font-black text-slate-800 flex items-center gap-1">
                                            <span className="bg-pink-500 text-white text-[7px] font-black px-1 rounded">CHARM</span>
                                            <span>{user.name}</span>
                                          </h4>
                                          <p className="text-[8px] text-slate-400">مستوى الحساب: {user.level} | معرف: {user.id}</p>
                                        </div>
                                        <span className="text-xs font-black text-slate-400 w-4 text-center">#{idx + 1}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                          </div>
                        )}

                      </div>
                    )}

                    {/* ==================== 4. MESSAGES TAB (الرسائل والأصدقاء) ==================== */}
                    {dashboardTab === 'messages' && (
                      <div className="space-y-4 animate-fade-in" id="tab-panel-messages">
                        {/* Tab header toggles */}
                        <div className="bg-white p-1 rounded-full border border-[#E8DCC4]/60 flex shadow-sm">
                          <button className="w-1/2 bg-[#FFAE42] text-white py-1 rounded-full text-xs font-black">
                            الدردشات والمراسلة
                          </button>
                          <button 
                            onClick={() => alert('قائمة الأصدقاء والمتابعين تظهر مباشرة بمجرد متابعة أي مستخدم!')}
                            className="w-1/2 text-slate-500 py-1 rounded-full text-xs font-bold"
                          >
                            الأصدقاء (45)
                          </button>
                        </div>

                        {/* Channel Circles row */}
                        <div className="bg-white p-3 rounded-2xl border border-[#E8DCC4]/60 shadow-sm flex justify-around items-center text-center">
                          <div 
                            onClick={() => alert('لا توجد فعاليات نشطة في هذه اللحظة. تواصل مع الإدارة للأخبار!')}
                            className="flex flex-col items-center gap-1 cursor-pointer"
                          >
                            <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-lg shadow-sm">
                              📢
                            </div>
                            <span className="text-[9px] font-bold text-slate-600">أخبار الفعاليات</span>
                          </div>

                          <div 
                            onClick={() => alert('لا توجد متابعات جديدة في حسابك حتى الآن.')}
                            className="flex flex-col items-center gap-1 cursor-pointer"
                          >
                            <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-lg shadow-sm">
                              👤
                            </div>
                            <span className="text-[9px] font-bold text-slate-600">متابعون جدد</span>
                          </div>

                          <div 
                            onClick={() => setSupportChatOpen(true)}
                            className="flex flex-col items-center gap-1 cursor-pointer"
                          >
                            <div className="w-10 h-10 rounded-full bg-amber-100 text-[#FFAE42] flex items-center justify-center text-lg shadow-sm animate-pulse">
                              🐱
                            </div>
                            <span className="text-[9px] font-black text-amber-600">دعم صدى الفني</span>
                          </div>
                        </div>

                        {/* Chats list */}
                        <div className="space-y-2">
                          {/* System Support Chat */}
                          <div 
                            onClick={() => setSupportChatOpen(true)}
                            className="bg-white p-3 rounded-xl border border-[#E8DCC4]/60 shadow-sm flex justify-between items-center hover:bg-[#FDFBF7] cursor-pointer transition active:scale-[0.99]"
                          >
                            <div className="flex items-center gap-2.5">
                              <div className="w-10 h-10 rounded-full bg-amber-50 border border-[#FFAE42]/20 flex items-center justify-center text-xl relative shadow-inner">
                                🐱
                                <span className="absolute -top-0.5 -right-0.5 bg-red-500 w-2.5 h-2.5 rounded-full border border-white"></span>
                              </div>
                              <div className="text-right font-sans">
                                <h4 className="text-xs font-black text-[#4A3E3D]">الدعم الفني والخدمة لصدى 🛡️</h4>
                                <p className="text-[10px] text-slate-500 truncate w-48 mt-0.5">مرحباً بك في صدى العرب يا بطل! نحن هنا لمساعدتك...</p>
                              </div>
                            </div>
                            <span className="text-[8px] text-slate-400 font-mono">الآن</span>
                          </div>

                          {/* Dynamic Real Chat Threads */}
                          {(() => {
                            const threadsMap = new Map<string, PrivateMessage>();
                            privateMessages.forEach(msg => {
                              const otherUserId = msg.senderId === currentUser?.id ? msg.receiverId : msg.senderId;
                              const currentLatest = threadsMap.get(otherUserId);
                              if (!currentLatest || new Date(msg.timestamp) > new Date(currentLatest.timestamp)) {
                                threadsMap.set(otherUserId, msg);
                              }
                            });

                            return Array.from(threadsMap.values()).map(latestMsg => {
                              const otherUserId = latestMsg.senderId === currentUser?.id ? latestMsg.receiverId : latestMsg.senderId;
                              const otherUser = users.find(u => u.id === otherUserId) || {
                                id: otherUserId,
                                name: latestMsg.senderId === currentUser?.id ? latestMsg.receiverName : latestMsg.senderName,
                                avatar: latestMsg.senderId === currentUser?.id ? 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde' : latestMsg.senderAvatar,
                                level: 1
                              };

                              const isUnread = latestMsg.receiverId === currentUser?.id && !latestMsg.isRead;

                              return (
                                <div
                                  key={otherUserId}
                                  onClick={() => {
                                    setActivePrivateChatUser(otherUser as AppUser);
                                    setIsPrivateInboxOpen(true);
                                  }}
                                  className="bg-white p-3 rounded-xl border border-[#E8DCC4]/60 shadow-sm flex justify-between items-center hover:bg-[#FDFBF7] cursor-pointer transition active:scale-[0.99] text-right"
                                >
                                  <span className="text-[8px] text-slate-400 font-mono">
                                    {new Date(latestMsg.timestamp).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                                  </span>

                                  <div className="flex items-center gap-2.5">
                                    <div className="text-right font-sans">
                                      <h4 className={`text-xs font-black ${isUnread ? 'text-red-500' : 'text-[#4A3E3D]'}`}>{otherUser.name}</h4>
                                      <p className="text-[10px] text-slate-500 truncate w-48 mt-0.5">
                                        {latestMsg.isEncrypted ? (
                                          <span className="flex items-center justify-end gap-1">
                                            <span>🔐</span>
                                            <EncryptedMessageText
                                              ciphertext={latestMsg.rawCiphertext || latestMsg.text}
                                              iv={latestMsg.iv || ''}
                                              derivedKey={privateKey}
                                              showCiphertext={false}
                                              fallbackText="رسالة آمنة"
                                            />
                                          </span>
                                        ) : latestMsg.text}
                                      </p>
                                    </div>
                                    <div className="relative">
                                      <img
                                        src={otherUser.avatar || "https://api.dicebear.com/7.x/adventurer/svg?seed=placeholder"}
                                        alt=""
                                        className="w-10 h-10 rounded-full object-cover border border-purple-500/20"
                                      />
                                      {isUnread && (
                                        <span className="absolute -top-0.5 -right-0.5 bg-red-500 w-2.5 h-2.5 rounded-full border border-white animate-pulse"></span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      </div>
                    )}

                    {/* ==================== 5. ME / PROFILE TAB (الملف الشخصي الفاخر) ==================== */}
                    {dashboardTab === 'profile' && (
                      <div className="space-y-4 animate-fade-in" id="tab-panel-profile">
                        
                        {/* Premium Golden-bordered Arab Profile Card */}
                        <div className="bg-gradient-to-br from-[#4A3E3D] to-[#2B2322] p-4 rounded-3xl text-white shadow-md relative overflow-hidden">
                          <div className="absolute top-0 left-0 text-9xl text-white/5 pointer-events-none -translate-x-10 -translate-y-10">🕌</div>
                          
                          <div className="flex items-center gap-3 relative z-10">
                            {/* Avatar with beautiful gold crown frame */}
                            <div className="relative">
                              <div className="w-14 h-14 rounded-full border-2 border-amber-400 p-0.5 shadow-md bg-amber-50/10">
                                <img
                                  src={currentUser.avatar || "https://api.dicebear.com/7.x/adventurer/svg?seed=placeholder"}
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full rounded-full object-cover"
                                />
                              </div>
                              <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-md rotate-12">👑</span>
                            </div>

                            <div className="text-right">
                              <h3 className="text-sm font-black flex items-center gap-1.5 font-sans">
                                <span>{currentUser.name}</span>
                                <span className="bg-gradient-to-r from-purple-500 to-indigo-600 text-white text-[7px] font-black px-1.5 py-0.5 rounded-full shadow-sm border border-purple-400/20">
                                  VIP {currentUser.vipLevel || 1}
                                </span>
                              </h3>
                              <p className="text-[10px] text-amber-100 font-mono mt-0.5">معرف الحساب: {currentUser.id}</p>
                              
                              <div className="flex gap-1.5 mt-1.5 flex-wrap">
                                <span className="bg-amber-400/20 text-amber-300 text-[8px] px-2 py-0.5 rounded border border-amber-400/20 font-bold">
                                  مستوى الحساب: {currentUser.level}
                                </span>
                                {currentUser.clanId && (
                                  <span className="bg-blue-400/20 text-blue-300 text-[8px] px-2 py-0.5 rounded border border-blue-400/20 font-bold">
                                    🛡️ عائلة: {currentUser.clanId}
                                  </span>
                                )}
                              </div>

                              {currentUser.badges && currentUser.badges.length > 0 && (
                                <div className="flex gap-1 mt-1.5 flex-wrap">
                                  {currentUser.badges.map((badgeId) => {
                                    let icon = "🏅";
                                    let name = badgeId;
                                    if (badgeId === 'king') { icon = "👑"; name = "الملك"; }
                                    else if (badgeId === 'diamond_charger') { icon = "💎"; name = "الداعم الماسي"; }
                                    else if (badgeId === 'loyal_member') { icon = "🛡️"; name = "العضو الوفي"; }
                                    else if (badgeId === 'charm_prince') { icon = "✨"; name = "أمير الجاذبية"; }
                                    
                                    return (
                                      <span key={badgeId} className="bg-amber-400/25 border border-amber-400/40 px-1.5 py-0.5 rounded-full text-[7.5px] text-amber-200 font-extrabold flex items-center gap-0.5">
                                        <span>{icon}</span>
                                        <span>{name}</span>
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Stat Metric counts */}
                          <div className="grid grid-cols-4 gap-1 text-center pt-4 border-t border-white/10 mt-4 text-white relative z-10">
                            <div>
                              <strong className="text-xs block">{currentUser.following?.length || 0}</strong>
                              <span className="text-[8px] text-slate-300">المتابَعون</span>
                            </div>
                            <div>
                              <strong className="text-xs block">45</strong>
                              <span className="text-[8px] text-slate-300">الأصدقاء</span>
                            </div>
                            <div>
                              <strong className="text-xs block">{currentUser.followers?.length || 0}</strong>
                              <span className="text-[8px] text-slate-300">المتابعون</span>
                            </div>
                            <div>
                              <strong className="text-xs block">3.2K</strong>
                              <span className="text-[8px] text-slate-300">الزوار</span>
                            </div>
                          </div>
                        </div>

                        {/* Biography / User Status Card */}
                        <div className="bg-white p-3.5 rounded-2xl border border-[#E8DCC4]/60 shadow-sm text-right space-y-2">
                          <div className="flex justify-between items-center border-b border-slate-100 pb-1.5">
                            <span className="text-xs font-black text-[#4A3E3D]">السيرة الذاتية (Bio) ✍️</span>
                            <button
                              onClick={() => {
                                setSelectedProfileUser(currentUser);
                                setIsEditingBio(true);
                                setBioEditValue(currentUser.bio || '');
                                setIsProfileModalOpen(true);
                              }}
                              className="text-[9px] text-amber-500 font-bold hover:underline"
                            >
                              تعديل السيرة
                            </button>
                          </div>
                          <p className="text-[10px] text-slate-600 leading-relaxed italic">
                            {currentUser.bio || 'اكتب سيرة ذاتية مميزة لتعريف رواد صدى العرب بهويتك وبصمتك!'}
                          </p>
                        </div>

                        {/* Interactive Lottery Wheel mini game banner */}
                        <div 
                          onClick={async () => {
                            const bonus = Math.floor(Math.random() * 20) + 1;
                            try {
                              await updateDoc(doc(db, "users", currentUser.id), {
                                coins: increment(bonus)
                              });
                              alert(`🎡 تم تدوير عجلة الشحن الفوري! حصلت على +${bonus} كوينز مجانية! 🎉`);
                            } catch (e: any) {
                              console.error('Lottery error:', e);
                            }
                          }}
                          className="bg-gradient-to-r from-orange-500 to-amber-500 p-3.5 rounded-2xl text-white text-right shadow-sm hover:scale-[1.01] transition active:scale-95 cursor-pointer relative overflow-hidden"
                        >
                          <div className="absolute -left-3 -bottom-3 text-5xl opacity-25">🎡</div>
                          <h4 className="text-xs font-black">يانصيب السحب والجوائز 🎟️</h4>
                          <p className="text-[9px] text-amber-50 mt-0.5">انقر لتدوير العجلة مجاناً اليوم واكسب كوينز فورية سريعة!</p>
                        </div>

                        {/* Wallet Area with badges */}
                        <div className="bg-white p-3.5 rounded-2xl border border-[#E8DCC4]/60 shadow-sm text-right space-y-3">
                          <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                            <span className="text-xs font-black text-[#4A3E3D]">محفظة الكوينز والشحن 💰</span>
                            <span className="text-[10px] text-amber-500 font-bold">الرصيد الكلي: 🪙 {currentUser?.coins?.toFixed(0) || "0"}</span>
                          </div>

                          <div className="flex justify-between items-center bg-amber-50/50 p-2.5 rounded-xl border border-amber-400/20 relative">
                            {/* Speech bubble */}
                            <div className="absolute -top-3.5 left-2 bg-yellow-400 text-slate-950 text-[8px] font-black px-1.5 py-0.5 rounded-md shadow-sm">
                              شحن آمن يدوي ⚡
                            </div>
                            <div className="text-right">
                              <span className="text-[9px] text-slate-500">نظام الوكلاء المعتمدين للشحن</span>
                              <h5 className="text-xs font-black text-amber-600 leading-tight">شحن فوري عبر الواتساب</h5>
                            </div>
                            <button 
                              onClick={() => setIsAgentsHubOpen(true)}
                              className="bg-amber-500 text-slate-950 font-black text-[10px] px-3 py-1 rounded-full shadow-sm hover:bg-amber-600 transition cursor-pointer"
                            >
                              شحن الكوينز
                            </button>
                          </div>
                        </div>

                        {/* Quick Grid actions list (2x2 Mobile-First Grid) */}
                        <div className="grid grid-cols-2 gap-3 text-center text-xs">
                          <div 
                            onClick={() => alert('عشائر وقبائل صدى العرب: ميزة التحالف الصوتي قادمة في الإصدار v1.1')}
                            className="bg-white aspect-square flex flex-col justify-center items-center p-4 rounded-2xl border border-[#E8DCC4]/50 shadow-sm cursor-pointer hover:bg-slate-50 active:scale-95 transition-all duration-150"
                          >
                            <span className="text-3xl mb-2">🛡️</span>
                            <span className="text-xs font-black text-[#4A3E3D]">القبيلة</span>
                            <span className="text-[9px] text-slate-400 mt-1">التحالف والنسب</span>
                          </div>
                          
                          <div 
                            onClick={() => alert('متجر الأوسمة والإطارات والألقاب: قريباً!')}
                            className="bg-white aspect-square flex flex-col justify-center items-center p-4 rounded-2xl border border-[#E8DCC4]/50 shadow-sm cursor-pointer hover:bg-slate-50 active:scale-95 transition-all duration-150"
                          >
                            <span className="text-3xl mb-2">🏬</span>
                            <span className="text-xs font-black text-[#4A3E3D]">المتجر</span>
                            <span className="text-[9px] text-slate-400 mt-1">إطارات وألقاب</span>
                          </div>

                          <div 
                            onClick={() => alert('حقيبتك الشخصية فارغة من الإطارات والمقاعد الخاصة.')}
                            className="bg-white aspect-square flex flex-col justify-center items-center p-4 rounded-2xl border border-[#E8DCC4]/50 shadow-sm cursor-pointer hover:bg-slate-50 active:scale-95 transition-all duration-150"
                          >
                            <span className="text-3xl mb-2">💼</span>
                            <span className="text-xs font-black text-[#4A3E3D]">الحقيبة</span>
                            <span className="text-[9px] text-slate-400 mt-1">المقتنيات الخاصة</span>
                          </div>

                          <div 
                            onClick={() => alert('مستواك الحالي يخولك لدخول كافة مجالس صدى الصوتية.')}
                            className="bg-white aspect-square flex flex-col justify-center items-center p-4 rounded-2xl border border-[#E8DCC4]/50 shadow-sm cursor-pointer hover:bg-slate-50 active:scale-95 transition-all duration-150"
                          >
                            <span className="text-3xl mb-2">🎖️</span>
                            <span className="text-xs font-black text-[#4A3E3D]">الأوسمة</span>
                            <span className="text-[9px] text-slate-400 mt-1">شارات الشرف</span>
                          </div>
                        </div>

                      </div>
                    )}

                  </div>

                  {/* NATIVE PREMIUM BOTTOM NAVIGATION BAR */}
                  <div className="absolute bottom-0 left-0 right-0 h-16 bg-white border-t border-[#E8DCC4]/60 flex justify-around items-center px-2 shadow-[0_-2px_10px_rgba(0,0,0,0.03)] z-40 select-none">
                    
                    {/* Tab 1: Party */}
                    <button
                      onClick={() => setDashboardTab('party')}
                      className={`flex flex-col items-center justify-center w-14 h-full transition-all duration-150 ${
                        dashboardTab === 'party' ? 'text-[#FFAE42] scale-105 font-black' : 'text-slate-400 font-medium'
                      } cursor-pointer`}
                    >
                      <span className="text-xl leading-none">🎙️</span>
                      <span className="text-[9px] mt-1 leading-none">الحفلة</span>
                    </button>

                    {/* Tab 2: Games */}
                    <button
                      onClick={() => setDashboardTab('games')}
                      className={`flex flex-col items-center justify-center w-14 h-full transition-all duration-150 ${
                        dashboardTab === 'games' ? 'text-[#FFAE42] scale-105 font-black' : 'text-slate-400 font-medium'
                      } cursor-pointer`}
                    >
                      <span className="text-xl leading-none">🎮</span>
                      <span className="text-[9px] mt-1 leading-none">الألعاب</span>
                    </button>

                    {/* Tab 3: Discover */}
                    <button
                      onClick={() => setDashboardTab('explore')}
                      className={`flex flex-col items-center justify-center w-14 h-full transition-all duration-150 ${
                        dashboardTab === 'explore' ? 'text-[#FFAE42] scale-105 font-black' : 'text-slate-400 font-medium'
                      } cursor-pointer`}
                    >
                      <span className="text-xl leading-none">✨</span>
                      <span className="text-[9px] mt-1 leading-none">اكتشف</span>
                    </button>

                    {/* Tab 4: Messages */}
                    <button
                      onClick={() => setDashboardTab('messages')}
                      className={`flex flex-col items-center justify-center w-14 h-full transition-all duration-150 relative ${
                        dashboardTab === 'messages' ? 'text-[#FFAE42] scale-105 font-black' : 'text-slate-400 font-medium'
                      } cursor-pointer`}
                    >
                      {/* Red unread messages badge */}
                      {(() => {
                        const count = privateMessages.filter(msg => msg.receiverId === currentUser?.id && !msg.isRead).length;
                        if (count === 0) return null;
                        return (
                          <span className="absolute top-2 right-3 bg-red-500 text-white font-extrabold text-[7px] w-3.5 h-3.5 rounded-full flex items-center justify-center border border-white">
                            {count}
                          </span>
                        );
                      })()}
                      <span className="text-xl leading-none">✉️</span>
                      <span className="text-[9px] mt-1 leading-none">الرسائل</span>
                    </button>

                    {/* Tab 5: Me */}
                    <button
                      onClick={() => setDashboardTab('profile')}
                      className={`flex flex-col items-center justify-center w-14 h-full transition-all duration-150 ${
                        dashboardTab === 'profile' ? 'text-[#FFAE42] scale-105 font-black' : 'text-slate-400 font-medium'
                      } cursor-pointer`}
                    >
                      <span className="text-xl leading-none">👤</span>
                      <span className="text-[9px] mt-1 leading-none">أنا</span>
                    </button>
                  </div>

                  {/* ==================== MODAL OVERLAYS AND POPUPS ==================== */}

                  {/* Private Room PIN Modal prompt */}
                  {selectedLockedRoom && (
                    <div className="absolute inset-0 bg-black/70 flex items-center justify-center p-6 z-50 animate-fade-in" dir="rtl">
                      <div className="bg-white border border-[#E8DCC4] p-5 rounded-2xl w-full max-w-xs text-right space-y-4 shadow-xl">
                        <div className="text-center">
                          <span className="text-3xl block mb-2 animate-bounce">🔒</span>
                          <h4 className="text-sm font-black text-[#4A3E3D]">المجلس محمي بكلمة سر</h4>
                          <p className="text-[10px] text-slate-500 mt-1">يرجى إدخال رمز المرور للدخول لهذا المجلس الصوتي</p>
                          <span className="text-[9px] text-amber-600 font-mono bg-amber-50 px-2.5 py-0.5 rounded border border-amber-400/20 mt-2 inline-block">
                            💡 الرمز للتجربة والمحاكاة هو: 123
                          </span>
                        </div>

                        <div className="space-y-1">
                          <input
                            type="password"
                            placeholder="أدخل رمز الدخول PIN"
                            value={roomPasswordInput}
                            onChange={(e) => {
                              setRoomPasswordInput(e.target.value);
                              setRoomPasswordError(false);
                            }}
                            className="w-full bg-slate-50 border border-[#E8DCC4] rounded-xl p-2.5 text-center text-xs text-[#4A3E3D] font-mono tracking-widest focus:outline-none focus:border-[#FFAE42]"
                          />
                          {roomPasswordError && (
                            <span className="text-[9px] text-red-500 text-center block font-bold">رمز الدخول غير صحيح!</span>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <button
                            onClick={() => setSelectedLockedRoom(null)}
                            className="bg-slate-100 hover:bg-slate-200 py-2 rounded-xl text-xs font-bold text-[#8B7E74] transition"
                          >
                            إلغاء
                          </button>
                          <button
                            onClick={handleVerifyRoomPassword}
                            className="bg-[#FFAE42] text-white py-2 rounded-xl text-xs font-black transition shadow-sm"
                          >
                            تأكيد الدخول
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Create Custom Room Modal */}
                  {isCreateRoomModalOpen && (
                    <div className="absolute inset-0 bg-black/70 flex items-center justify-center p-6 z-50 animate-fade-in" dir="rtl">
                      <div className="bg-white border border-[#E8DCC4] p-5 rounded-3xl w-full max-w-xs text-right space-y-4 shadow-2xl animate-scale-up">
                        <div className="text-center border-b border-slate-100 pb-3">
                          <span className="text-3xl block mb-1 animate-pulse">🎙️</span>
                          <h4 className="text-sm font-black text-[#4A3E3D]">إنشاء روم صوتي جديد</h4>
                          <p className="text-[10px] text-slate-500 mt-1">ابدأ الروم الخاص بك الآن واستضيف أصدقائك للدردشة الصوتية</p>
                        </div>

                        {newRoomError && (
                          <div className="bg-rose-50 text-rose-700 text-[10px] p-2 rounded-lg border border-rose-200 text-center font-bold">
                            ⚠️ {newRoomError}
                          </div>
                        )}

                        <div className="space-y-3.5">
                          {/* Room Name Input */}
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-500 font-bold block">اسم الروم</label>
                            <input
                              type="text"
                              placeholder="مثال: مجلس ديوانية العرب ☕"
                              value={newRoomNameInput}
                              onChange={(e) => {
                                setNewRoomNameInput(e.target.value);
                                setNewRoomError('');
                              }}
                              className="w-full bg-[#FAF6EB] border border-[#DCD7C9] rounded-xl p-2.5 text-right text-xs text-[#4A3E3D] focus:outline-none focus:border-[#FFAE42]"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => setIsCreateRoomModalOpen(false)}
                            className="bg-slate-100 hover:bg-slate-200 py-2.5 rounded-xl text-xs font-bold text-[#8B7E74] transition"
                            disabled={newRoomLoading}
                          >
                            إلغاء
                          </button>
                          <button
                            type="button"
                            disabled={newRoomLoading}
                            onClick={async () => {
                                if (!newRoomNameInput.trim()) {
                                  setNewRoomError('يرجى كتابة اسم المجلس الصوتي أولاً');
                                  return;
                                }
                                if (newRoomIsPrivate && !newRoomPassword.trim()) {
                                  setNewRoomError('يرجى كتابة رمز الدخول السري للمجلس الخاص');
                                  return;
                                }

                                setNewRoomLoading(true);
                                setNewRoomError('');
                                const result = await handleCreateRoom(newRoomNameInput.trim()); if (result && !result.success) { setNewRoomError(result.error); }
                                setNewRoomLoading(false);
                              }}
                            className="bg-[#FFAE42] text-white py-2.5 rounded-xl text-xs font-black transition shadow-sm hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-1.5 disabled:opacity-50"
                          >
                            {newRoomLoading ? (
                              <>
                                <RefreshCw className="w-3 h-3 animate-spin" />
                                <span>جاري الإنشاء...</span>
                              </>
                            ) : (
                              <span>إنشاء الروم ✨</span>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Daily Bonus Chest Overlay Modal */}
                  {isDailyBonusOpen && (
                    <div className="absolute inset-0 bg-black/70 flex items-center justify-center p-6 z-50 animate-fade-in" dir="rtl">
                      <div className="bg-gradient-to-b from-white to-[#FAF6EB] p-5 rounded-3xl w-full max-w-xs text-center space-y-4 border border-[#E8DCC4] shadow-2xl relative">
                        <button 
                          onClick={() => setIsDailyBonusOpen(false)}
                          className="absolute top-3 right-3 text-slate-400 hover:text-[#4A3E3D] font-bold text-xs"
                        >
                          ✕
                        </button>
                        
                        <div className="space-y-1">
                          <span className="text-5xl block animate-bounce duration-[2000ms]">🎁</span>
                          <h4 className="text-sm font-black text-[#4A3E3D]">صندوق الهدايا اليومية لصدى</h4>
                          <p className="text-[10px] text-slate-500">افتح الصندوق لتحصل على مكافأة الكوينزات الترحيبية!</p>
                        </div>

                        <div className="bg-amber-50 rounded-2xl p-4 border border-[#FFAE42]/20 flex flex-col items-center justify-center">
                          <span className="text-3xl font-black text-[#FFAE42] animate-pulse">🪙 +50 كوينز</span>
                          <span className="text-[8px] text-slate-400 mt-1">تضاف فوراً لرصيد حسابك السحابي</span>
                        </div>

                        <button
                          onClick={async () => {
                            try {
                              await updateDoc(doc(db, "users", currentUser.id), {
                                coins: increment(50)
                              });
                              setDailyBonusClaimed(true);
                              setIsDailyBonusOpen(false);
                              alert('🎉 مبروك! تم إضافة 50 كوينز بنجاح لحسابك!');
                            } catch (e) {
                              console.error(e);
                            }
                          }}
                          className="w-full bg-[#FFAE42] text-white py-2.5 rounded-xl text-xs font-black transition shadow"
                        >
                          استلم المكافأة الآن ✨
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Drifting Bottle Overlay Game Modal */}
                  {driftingBottleMode !== 'idle' && (
                    <div className="absolute inset-0 bg-black/70 flex items-center justify-center p-6 z-50 animate-fade-in" dir="rtl">
                      <div className="bg-white p-5 rounded-3xl w-full max-w-xs text-right space-y-4 border border-[#E8DCC4] shadow-2xl relative">
                        <button 
                          onClick={() => { setDriftingBottleMode('idle'); setBottleMessage(''); setPickedBottle(null); }}
                          className="absolute top-3 right-3 text-slate-400 hover:text-[#4A3E3D] font-bold text-xs"
                        >
                          ✕
                        </button>

                        <div className="text-center">
                          <span className="text-4xl block mb-1 animate-bounce">🍾</span>
                          <h4 className="text-sm font-black text-[#4A3E3D]">زجاجة رسائل البحر لصدى</h4>
                          <p className="text-[10px] text-slate-500">اكتب سراً ليجده الأصدقاء، أو التقط زجاجة مجهولة!</p>
                        </div>

                        {/* Mode selectors */}
                        <div className="flex gap-2 bg-slate-100 p-1 rounded-full text-center">
                          <button 
                            onClick={() => { setDriftingBottleMode('writing'); setPickedBottle(null); }}
                            className={`w-1/2 py-1 rounded-full text-[10px] font-bold ${driftingBottleMode === 'writing' ? 'bg-[#FFAE42] text-white' : 'text-slate-500'}`}
                          >
                            اكتب وارمِ زجاجة ✍️
                          </button>
                          <button 
                            onClick={() => {
                              setDriftingBottleMode('reading');
                              const sampleMessages = [
                                'ريم الرياض: "أتمنى للجميع سهرة طرب ممتعة الليلة في مجالسنا!"',
                                'فارس نجد: "صوتك كنز يا منشد الغرفة، الله يحفظك!"',
                                'سلطان العرب: "من يتحدى كيرم الليلة؟ حياكم بغرفة الطرب!"',
                                'صوت الحرمين: "صباح الخير والمسرات لأجمل أخوة وأخوات!"'
                              ];
                              setPickedBottle(sampleMessages[Math.floor(Math.random() * sampleMessages.length)]);
                            }}
                            className={`w-1/2 py-1 rounded-full text-[10px] font-bold ${driftingBottleMode === 'reading' ? 'bg-[#FFAE42] text-white' : 'text-slate-500'}`}
                          >
                            التقط زجاجة 🌊
                          </button>
                        </div>

                        {driftingBottleMode === 'writing' ? (
                          <div className="space-y-2">
                            <textarea
                              rows={3}
                              placeholder="اكتب رسالتك السرية هنا... يرجى الالتزام بالود والاحترام."
                              value={bottleMessage}
                              onChange={(e) => setBottleMessage(e.target.value)}
                              className="w-full bg-slate-50 border border-[#E8DCC4] rounded-2xl p-2.5 text-xs text-[#4A3E3D] focus:outline-none focus:border-[#FFAE42] text-right"
                            />
                            <button
                              onClick={() => {
                                if (bottleMessage.trim()) {
                                  alert('🎉 قمت برمي زجاجتك في البحر بنجاح! سينتظر الأصدقاء التقاطها بقرب الشاطئ.');
                                  setBottleMessage('');
                                  setDriftingBottleMode('idle');
                                } else {
                                  alert('الرجاء كتابة رسالة قبل الرمي!');
                                }
                              }}
                              className="w-full bg-[#FFAE42] text-white py-2 rounded-xl text-xs font-black transition"
                            >
                              ارمِ الزجاجة في البحر 🌊
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-3 bg-cyan-50/50 p-3 rounded-2xl border border-cyan-100 text-right">
                            <span className="text-[9px] text-cyan-600 block font-bold">📜 عثرت على زجاجة مكتوب عليها:</span>
                            <p className="text-xs text-[#4A3E3D] leading-relaxed italic">{pickedBottle}</p>
                            <button
                              onClick={() => setDriftingBottleMode('idle')}
                              className="w-full bg-[#FFAE42] text-white py-2 rounded-xl text-xs font-black transition"
                            >
                              إرجاع الزجاجة للبحر
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Mascot Support Chat Drawer Modal */}
                  {supportChatOpen && (
                    <div className="absolute inset-0 bg-black/70 flex items-end justify-center z-50 animate-fade-in" dir="rtl">
                      <div className="bg-white w-full rounded-t-3xl max-w-sm h-3/4 flex flex-col justify-between overflow-hidden shadow-2xl">
                        
                        {/* Drawer Header */}
                        <div className="bg-gradient-to-r from-amber-500 to-yellow-400 p-4 text-white flex justify-between items-center shadow">
                          <div className="flex items-center gap-2">
                            <span className="text-2xl">🐱</span>
                            <div className="text-right">
                              <h4 className="text-xs font-black">دعم صدى العرب الفني والخدمة</h4>
                              <p className="text-[9px] text-amber-50">متصل الآن لمساعدتك</p>
                            </div>
                          </div>
                          <button 
                            onClick={() => setSupportChatOpen(false)}
                            className="text-white hover:text-amber-100 font-bold text-xs bg-black/15 p-1 px-2.5 rounded-full"
                          >
                            إغلاق
                          </button>
                        </div>

                        {/* Drawer Chat messages area */}
                        <div className="flex-grow p-4 overflow-y-auto space-y-3 bg-[#FAF6EB]">
                          {supportChatMessages.map((msg, idx) => (
                            <div 
                              key={idx} 
                              className={`flex ${msg.isUser ? 'justify-start' : 'justify-end'} text-right`}
                            >
                              <div className={`p-3 rounded-2xl text-xs max-w-[80%] shadow-sm ${
                                msg.isUser 
                                  ? 'bg-[#FFAE42] text-white rounded-tr-none' 
                                  : 'bg-white text-[#4A3E3D] rounded-tl-none border border-[#E8DCC4]/60'
                              }`}>
                                <span className="block font-bold text-[8px] opacity-75 mb-1">{msg.sender}</span>
                                <p className="leading-relaxed">{msg.text}</p>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Drawer Input send bar */}
                        <div className="p-3 bg-white border-t border-[#E8DCC4]/60 flex gap-2">
                          <input
                            type="text"
                            placeholder="اكتب رسالتك للدعم الفني هنا..."
                            value={supportInput}
                            onChange={(e) => setSupportInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                if (supportInput.trim()) {
                                  const uText = supportInput.trim();
                                  setSupportChatMessages(prev => [...prev, { sender: currentUser.name, text: uText, isUser: true }]);
                                  setSupportInput('');
                                  
                                  // Auto simulate supportive response
                                  setTimeout(() => {
                                    setSupportChatMessages(prev => [...prev, { 
                                      sender: 'دعم صدى الفني 🐱', 
                                      text: 'تسلم يا غالي! تم استلام رسالتك وتوجيهها للمستشارين والوكيل المعتمد لحلها فوراً. شكراً لتواصلك مع صدى العرب 💖', 
                                      isUser: false 
                                    }]);
                                  }, 1500);
                                }
                              }
                            }}
                            className="flex-grow bg-slate-50 border border-[#E8DCC4] rounded-full px-4 py-1.5 text-xs text-right focus:outline-none focus:border-[#FFAE42]"
                          />
                          <button
                            onClick={() => {
                              if (supportInput.trim()) {
                                const uText = supportInput.trim();
                                setSupportChatMessages(prev => [...prev, { sender: currentUser.name, text: uText, isUser: true }]);
                                setSupportInput('');
                                
                                // Auto simulate supportive response
                                setTimeout(() => {
                                  setSupportChatMessages(prev => [...prev, { 
                                    sender: 'دعم صدى الفني 🐱', 
                                    text: 'تسلم يا غالي! تم استلام رسالتك وتوجيهها للمستشارين والوكيل المعتمد لحلها فوراً. شكراً لتواصلك مع صدى العرب 💖', 
                                    isUser: false 
                                  }]);
                                }, 1500);
                               }
                            }}
                            className="bg-[#FFAE42] text-white p-2 rounded-full hover:bg-amber-500 active:scale-95 transition flex items-center justify-center cursor-pointer"
                          >
                            <Send className="w-3.5 h-3.5" />
                          </button>
                        </div>

                      </div>
                    </div>
                  )}

                </div>
              )}

              {/* SCREEN 3: ACTIVE 9-SEAT VOICE ROOM SCREEN */}
              {currentScreen === 'room' && currentUser && activeRoom && (
                <div className="flex-grow flex flex-col h-full bg-[#05030f] relative overflow-hidden" id="screen-room">
                  
                  {/* Floating Gift Animations rendering container */}
                  <div className="absolute inset-0 pointer-events-none z-30">
                    {floatingGifts.map((gift) => (
                      <div
                        key={gift.id}
                        className="absolute text-4xl animate-bounce"
                        style={{
                          left: `${gift.x}%`,
                          top: `${gift.y}%`,
                          transform: 'translate(-50%, -50%)',
                          animation: 'floatUp 2s ease-out forwards'
                        }}
                      >
                        {gift.icon}
                      </div>
                    ))}

                    <style>{`
                      @keyframes floatUp {
                        0% { transform: translate(-50%, 0) scale(0.6); opacity: 0; }
                        20% { opacity: 1; transform: translate(-50%, -20px) scale(1.2); }
                        100% { transform: translate(-50%, -160px) scale(0.8); opacity: 0; }
                      }
                      @keyframes chatSlideUp {
                        0% { transform: translateY(18px) scale(0.93); opacity: 0; filter: blur(2px); }
                        100% { transform: translateY(0) scale(1); opacity: 1; filter: blur(0); }
                      }
                      .animate-chat-slide-up {
                        animation: chatSlideUp 0.65s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                      }
                    `}</style>
                  </div>

                  {/* VIP Entrance banner element */}
                  {vipEntrance && (
                    <div className="absolute top-24 left-0 right-0 z-40 bg-gradient-to-r from-amber-500 via-amber-600 to-amber-800 p-2 border-y-2 border-amber-400 text-center text-slate-950 font-bold text-xs shadow-xl gold-glow animate-pulse">
                      👑 دخل الـ VIP <span className="underline font-black">{vipEntrance.userName}</span> (مستوى {vipEntrance.level}) المجلس الآن! 👑
                    </div>
                  )}

                  {/* Ambient Stage Spotlights, Lasers and Bokeh Light Spheres */}
                  <div className="absolute inset-0 pointer-events-none z-0">
                    <div className="absolute inset-0 bg-gradient-to-b from-[#180936] via-[#0b041a] to-[#020008]"></div>
                    
                    {/* Glowing color spots with soft blur */}
                    <div className="absolute top-[8%] left-[15%] w-[200px] h-[350px] bg-purple-600/15 rounded-full blur-[80px] transform -rotate-12 animate-pulse" style={{ animationDuration: '7s' }}></div>
                    <div className="absolute top-[12%] right-[8%] w-[210px] h-[360px] bg-indigo-500/15 rounded-full blur-[85px] transform rotate-12 animate-pulse" style={{ animationDuration: '9s' }}></div>
                    <div className="absolute bottom-[25%] left-[10%] w-[220px] h-[250px] bg-pink-600/15 rounded-full blur-[90px] animate-pulse" style={{ animationDuration: '8s' }}></div>
                    <div className="absolute top-[35%] left-[35%] w-[160px] h-[160px] bg-cyan-500/12 rounded-full blur-[70px]"></div>

                    {/* Slow floating luxurious background particles / Bokeh light dots */}
                    <div className="absolute top-[15%] left-[8%] w-3 h-3 bg-purple-400/40 rounded-full blur-[1px] animate-float-particle-1"></div>
                    <div className="absolute top-[45%] right-[12%] w-4 h-4 bg-indigo-400/35 rounded-full blur-[2px] animate-float-particle-2"></div>
                    <div className="absolute bottom-[35%] left-[22%] w-2.5 h-2.5 bg-pink-400/45 rounded-full blur-[1px] animate-float-particle-1" style={{ animationDelay: '2.5s' }}></div>
                    <div className="absolute top-[20%] right-[28%] w-4.5 h-4.5 bg-cyan-400/30 rounded-full blur-[3px] animate-float-particle-2" style={{ animationDelay: '4.5s' }}></div>
                    <div className="absolute bottom-[18%] right-[18%] w-3.5 h-3.5 bg-yellow-400/35 rounded-full blur-[1.5px] animate-float-particle-1" style={{ animationDelay: '1.2s' }}></div>
                    <div className="absolute top-[38%] left-[42%] w-3 h-3 bg-purple-500/40 rounded-full blur-[1px] animate-float-particle-2" style={{ animationDelay: '3.2s' }}></div>

                    {/* Subtle vertical spotlight beams */}
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[2px] h-[600px] bg-gradient-to-b from-purple-500/15 via-transparent to-transparent opacity-30 blur-[1px]"></div>
                    <div className="absolute top-0 left-[25%] w-[1.5px] h-[600px] bg-gradient-to-b from-cyan-500/10 via-transparent to-transparent opacity-25 blur-[1px]"></div>
                    <div className="absolute top-0 left-[75%] w-[1.5px] h-[600px] bg-gradient-to-b from-pink-500/10 via-transparent to-transparent opacity-25 blur-[1px]"></div>
                  </div>

                  {/* Room Top Header Nav Bar (Matching live mobile app style) */}
                  <div className="p-3 bg-transparent flex justify-between items-center select-none z-30" dir="rtl">
                    {/* Left side: Host Info Pill */}
                    {(() => {
                      const isOwner = activeRoom && (
                        (activeRoom.owner_id && currentUser?.id && activeRoom.owner_id === currentUser.id) ||
                        (activeRoom.owner_id && currentUser?.name && activeRoom.owner_id === currentUser.name) ||
                        (activeRoom.hostName && currentUser?.name && activeRoom.hostName === currentUser.name) ||
                        (currentUser?.name && (currentUser.name.includes("ABDULKERIM") || currentUser.name.includes("GAREZ")) && (activeRoom.owner_id === "KK030Z0nOTd6f4JGcpL0KbwR9Gi2" || activeRoom.hostName?.includes("ABDULKERIM") || activeRoom.name === "حلبي" || activeRoom.name === "ؤ"))
                      );
                      return (
                        <div
                          onClick={() => {
                            if (isOwner) {
                              setRoomSettingsName(activeRoom.name || '');
                              setRoomSettingsAvatar(activeRoom.hostAvatar || '');
                              setRoomSettingsError('');
                              setIsRoomSettingsDrawerOpen(true);
                            }
                          }}
                          className={`flex items-center gap-1.5 bg-black/40 backdrop-blur-md rounded-full pl-2.5 pr-1 py-1 border border-white/5 ${isOwner ? 'cursor-pointer hover:bg-black/60 active:scale-95 transition-all' : ''}`}
                          title={isOwner ? "إعدادات المجلس" : ""}
                        >
                          <div className="relative">
                            <img
                              src={activeRoom.hostAvatar || "https://api.dicebear.com/7.x/adventurer/svg?seed=placeholder"}
                              alt="host"
                              className="w-7 h-7 rounded-full border border-purple-500/30 object-cover select-none pointer-events-none"
                              style={{ WebkitTouchCallout: 'none' }}
                              draggable="false"
                              onContextMenu={(e) => e.preventDefault()}
                            />
                            {/* Active status indicator */}
                            <span className="absolute bottom-0 right-0 block h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-[#140b2e]" />
                          </div>
                          <div className="text-right">
                            <h4 className="text-[10px] font-bold text-white max-w-[80px] truncate leading-tight">
                              {activeRoom.name.replace(/☕|🎶|🔒/g, '').trim() || 'mason chat'}
                            </h4>
                            <span className="text-[8px] text-slate-300 block leading-none">مستوى {activeRoom.level}</span>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              alert('تمت متابعة منشئ المجلس بنجاح! 🔔');
                            }}
                            className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-[9px] px-2.5 py-0.5 rounded-full transition mr-1.5"
                          >
                            متابعة
                          </button>
                        </div>
                      );
                    })()}

                    {/* Right side: Viewers and Exit */}
                    <div className="flex items-center gap-2">
                      {/* Overlapping viewer avatars */}
                      <div className="flex -space-x-1.5 space-x-reverse items-center">
                        {activeRoomUsers.slice(0, 5).map((user, idx) => (
                          <img
                            key={user.id || idx}
                            src={user.avatar || "https://api.dicebear.com/7.x/adventurer/svg?seed=placeholder"}
                            alt={user.name}
                            className="w-5 h-5 rounded-full border border-[#140b2e] object-cover"
                            title={user.name}
                          />
                        ))}
                      </div>

                      {/* Viewer count */}
                      <div className="bg-black/30 backdrop-blur-md px-2 py-0.5 rounded-full text-[9px] text-slate-200 font-bold flex items-center gap-0.5">
                        <span>{activeRoomUsers.length}</span>
                        <span className="text-slate-400 text-[8px] font-bold">&gt;</span>
                      </div>

                      {/* Close X Button */}
                      <button
                        onClick={async () => {
                          const isOnSeat = activeRoom.seats.some(s => s.userId === currentUser.id);
                          if (isOnSeat) {
                            const agoraManager = AgoraEngineManager.getInstance();
                            agoraManager.stopPublishing();
                          }
                          const cleanedSeats = activeRoom.seats.map(s => s.userId === currentUser.id ? { ...s, userId: null } : s);
                          const updatedRoom = { ...activeRoom, seats: cleanedSeats };
                          setRooms(rooms.map(r => r.id === activeRoom.id ? updatedRoom : r));
                          
                          // Sync with Firestore before leaving
                          await updateDoc(doc(db, "voice_rooms", activeRoom.id), { seats: cleanedSeats });
                          
                          // Remove from participants
                          if (currentUser) {
                            const participantRef = doc(db, "voice_rooms", activeRoom.id, "participants", currentUser.id);
                            deleteDoc(participantRef).catch(err => console.error("Error removing participant:", err));
                            
                            // Decrement activeUsersCount
                            updateDoc(doc(db, "voice_rooms", activeRoom.id), {
                              activeUsersCount: increment(-1)
                            }).catch(err => console.error("Error decrementing user count:", err));
                          }
                          
                          setActiveRoom(null);
                          setIsGiftDrawerOpen(false);
                          setIsAdminDrawerOpen(false);
                          setIsQueueDrawerOpen(false);
                          setSelectedGift(null);
                          setCurrentScreen('explore');
                        }}
                        className="w-7 h-7 rounded-full bg-black/40 hover:bg-black/60 text-slate-300 hover:text-white flex items-center justify-center transition active:scale-90"
                        id="exit-room-btn"
                      >
                        <span className="text-xs font-bold">✕</span>
                      </button>
                    </div>
                  </div>

                  {/* Main Content Area */}
                  <div className="flex-grow p-4 flex flex-col justify-between relative pb-20 z-10 overflow-y-auto">
                    


                    {/* 10 SEATS STAGE: Two Parallel Rows of 5 Seats (As requested in the reference screenshot) */}
                    <div className="mt-1 mb-auto py-2">
                      <div className="grid grid-cols-5 gap-y-8 gap-x-1.5 text-center">
                        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => {
                          const seat = activeRoom.seats[index] || { index, userId: null, isMuted: false, isLocked: false };
                          const occupant = seat.userId ? (users.find(u => u.id === seat.userId) || (currentUser && seat.userId === currentUser.id ? currentUser : null)) : null;
                          const isCurrentUser = occupant && currentUser && occupant.id === currentUser.id;
                          const isSpeaking = !isRoomAudioDeafened && occupant && !seat.isMuted && (
                            isCurrentUser 
                              ? (realUserMicSpeaking || speakingSeatIndex === index)
                              : (speakingSeatIndex === index)
                          );

                          // Helper to render premium wings and halos
                          const renderSeatFrame = (childrenNode: React.ReactNode) => {
                            // Scale the radar wave rings dynamically to reflect live simulated or real voice vibration volume
                            const currentVolume = (isCurrentUser && realUserMicSpeaking && realUserMicVolume > 0)
                              ? Math.min(100, Math.max(30, Math.floor(realUserMicVolume * 3)))
                              : speakingVolume;

                            const scaleFactor1 = 1 + (currentVolume * 0.005);
                            const scaleFactor2 = 1 + (currentVolume * 0.012);
                            const scaleFactor3 = 1 + (currentVolume * 0.018);

                            let waveColorClass = "border-emerald-500 bg-emerald-500/10";
                            if (index === 0) waveColorClass = "border-amber-400 bg-amber-400/15";
                            else if (index === 1) waveColorClass = "border-fuchsia-500 bg-fuchsia-500/15";
                            else if (index === 2) waveColorClass = "border-cyan-400 bg-cyan-400/15";

                            return (
                              <div className="relative">
                                {/* Multi-layered Voice Radar Pulse Rings */}
                                {isSpeaking && (
                                  <div className="absolute inset-0 pointer-events-none select-none z-0">
                                    <div 
                                      className={`absolute inset-0 rounded-full border ${waveColorClass} animate-radar-1`}
                                      style={{ transform: `scale(${scaleFactor1})` }}
                                    />
                                    <div 
                                      className={`absolute inset-0 rounded-full border ${waveColorClass} animate-radar-2`}
                                      style={{ transform: `scale(${scaleFactor2})` }}
                                    />
                                    <div 
                                      className={`absolute inset-0 rounded-full border ${waveColorClass} animate-radar-3`}
                                      style={{ transform: `scale(${scaleFactor3})` }}
                                    />
                                  </div>
                                )}

                                {/* Card frame ring */}
                                <div className="relative z-10">
                                  {index === 0 ? (
                                    // Mason / Host / Ahmad Al-Otaibi (Luxury animated gold border + Gold Crown)
                                    <div className={`relative p-0.5 rounded-full select-none vip-golden-shine shadow-lg transition-transform duration-150 ${isSpeaking ? 'scale-105 shadow-amber-500/40' : 'shadow-black/40'}`}>
                                      <div className="relative p-0.5 rounded-full bg-[#1b1202] border border-yellow-500/30">
                                        <div className="absolute -top-4.5 left-1/2 -translate-x-1/2 text-[15px] drop-shadow-md z-30 animate-[bounce_1.8s_infinite] select-none pointer-events-none">👑</div>
                                        {childrenNode}
                                      </div>
                                    </div>
                                  ) : index === 1 ? ( // Sophia (Purple neon glow)
                                    <div className={`relative p-0.5 rounded-full bg-gradient-to-tr from-purple-600 via-fuchsia-500 to-pink-500 shadow-sm transition-transform duration-150 ${isSpeaking ? 'scale-105 shadow-purple-500/50' : ''}`}>
                                      {childrenNode}
                                    </div>
                                  ) : index === 2 ? ( // Charlotte (Cyan neon ring)
                                    <div className={`relative p-0.5 rounded-full bg-gradient-to-tr from-cyan-400 via-blue-500 to-indigo-500 shadow-sm transition-transform duration-150 ${isSpeaking ? 'scale-105 shadow-cyan-400/50' : ''}`}>
                                      {childrenNode}
                                    </div>
                                  ) : index === 3 ? ( // Ava (Glowing Blue Wings Frame)
                                    <div className={`relative p-0.5 rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 transition-transform duration-150 ${isSpeaking ? 'scale-105' : ''}`}>
                                      <div className="absolute -left-2.5 top-1.5 text-[10px] pointer-events-none select-none drop-shadow">🪶</div>
                                      <div className="absolute -right-2.5 top-1.5 text-[10px] pointer-events-none select-none drop-shadow">🪶</div>
                                      {childrenNode}
                                    </div>
                                  ) : index === 4 ? ( // Ryan (Silver Ring)
                                    <div className={`relative p-0.5 rounded-full bg-gradient-to-tr from-slate-400 to-slate-200 transition-transform duration-150 ${isSpeaking ? 'scale-105' : ''}`}>
                                      {childrenNode}
                                    </div>
                                  ) : index === 5 ? ( // Aby (Angel wings frame)
                                    <div className={`relative p-0.5 rounded-full bg-gradient-to-tr from-amber-400 via-yellow-300 to-orange-400 transition-transform duration-150 ${isSpeaking ? 'scale-105 shadow-amber-300/30' : ''}`}>
                                      <div className="absolute -left-3 top-0.5 text-xs pointer-events-none select-none drop-shadow">👼</div>
                                      <div className="absolute -right-3 top-0.5 text-xs pointer-events-none select-none drop-shadow">👼</div>
                                      {childrenNode}
                                    </div>
                                  ) : (
                                    // Default style for other seats
                                    <div className={`relative p-0.5 rounded-full border transition-all duration-150 ${isSpeaking ? 'border-emerald-400 bg-emerald-500/10 scale-105' : 'border-slate-800/40 hover:border-purple-500/30 bg-slate-950/40'}`}>
                                      {childrenNode}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          };

                          return (
                            <div
                              key={index}
                              onClick={() => handleSeatClick(index)}
                              className="flex flex-col items-center cursor-pointer transition transform active:scale-95 duration-100"
                              id={`seat-cell-${index}`}
                            >
                              {renderSeatFrame(
                                <div className="w-10 h-10 rounded-full overflow-hidden bg-slate-950/80 flex items-center justify-center relative">
                                  {occupant ? (
                                    <img
                                      src={occupant.avatar && (occupant.avatar.startsWith('http') || occupant.avatar.startsWith('data:')) ? occupant.avatar : `https://api.dicebear.com/7.x/adventurer/svg?seed=${occupant.id}`}
                                      alt="seat occupant"
                                      referrerPolicy="no-referrer"
                                      className="w-full h-full object-cover"
                                    />
                                  ) : seat.isLocked ? (
                                    // Luxurious 3D gold colored padlock icon with inner glow
                                    <div className="flex flex-col items-center justify-center bg-gradient-to-br from-amber-500/20 to-red-500/20 border border-amber-500/40 w-full h-full rounded-full shadow-inner shadow-amber-500/30">
                                      <Lock className="w-3.5 h-3.5 text-amber-400 drop-shadow-[0_0_8px_rgba(245,158,11,0.7)] animate-pulse" />
                                    </div>
                                  ) : (
                                    // Elegant minimalist linear microphone outline SVG inside empty seat
                                    <div className="flex items-center justify-center w-full h-full rounded-full bg-gradient-to-b from-[#140b2a] to-[#05020c] border border-purple-500/5 hover:border-purple-500/30 transition-colors group">
                                      <svg 
                                        viewBox="0 0 24 24" 
                                        fill="none" 
                                        stroke="currentColor" 
                                        strokeWidth="2.5" 
                                        strokeLinecap="round" 
                                        strokeLinejoin="round" 
                                        className="w-4 h-4 text-purple-400/35 group-hover:text-purple-400/80 transition-colors drop-shadow"
                                      >
                                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                        <line x1="12" x2="12" y1="19" y2="22" />
                                      </svg>
                                      <span className="absolute bottom-1 text-[5px] text-purple-400/25 font-bold group-hover:text-purple-400/60 transition-colors select-none">
                                        {index + 1}
                                      </span>
                                    </div>
                                  )}

                                  {/* Fast flashing neon speaking border */}
                                  {isSpeaking && (
                                    <div className="absolute inset-0 bg-emerald-500/5 border border-emerald-400 rounded-full animate-pulse pointer-events-none" />
                                  )}
                                </div>
                              )}

                              {/* Small details */}
                              <div className="mt-1 flex flex-col items-center">
                                {occupant ? (
                                  <>
                                    <span className="text-[8.5px] text-white font-bold max-w-[50px] truncate block leading-tight">
                                      {occupant.id === '1001' ? 'أحمد العتيبي' : occupant.name.replace(' 👑', '')}
                                    </span>
                                    {/* Small custom-styled level badge under the name */}
                                    <div className={`mt-0.5 px-1 py-0.2 rounded-md bg-gradient-to-r ${
                                      occupant.level >= 90 ? 'from-purple-600 via-pink-500 to-rose-500 text-pink-100 border border-purple-400/30' :
                                      occupant.level >= 50 ? 'from-yellow-500 to-amber-500 text-amber-950 font-black' :
                                      occupant.level >= 20 ? 'from-cyan-500 to-blue-500 text-white' :
                                      'from-slate-700 to-slate-800 text-slate-300'
                                    } shadow-[0_1px_2px_rgba(0,0,0,0.4)] scale-[0.85] flex items-center justify-center leading-none`}>
                                      <span className="text-[6px] font-black tracking-tight block">
                                        Lv.{occupant.level}
                                      </span>
                                    </div>
                                  </>
                                ) : (
                                  <span className="text-[8px] text-slate-500 font-mono">
                                    {seat.isLocked ? 'مغلق' : index + 1}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Live Arabic Council Chat Feed - Premium Floating Transparent Overlay (Exactly like the screenshot) */}
                    <div className="absolute bottom-2 right-3 left-3 h-[135px] pointer-events-auto z-20 bg-transparent flex flex-col justify-end overflow-hidden" dir="rtl">
                      <div 
                        ref={(el) => {
                          if (el) {
                            el.scrollTop = el.scrollHeight;
                          }
                        }}
                        className="overflow-y-auto space-y-1.5 scrollbar-none pr-1 flex flex-col justify-end"
                        style={{ 
                          direction: 'rtl', 
                          textAlign: 'right',
                          WebkitMaskImage: 'linear-gradient(to top, rgba(0,0,0,1) 75%, rgba(0,0,0,0) 100%)',
                          maskImage: 'linear-gradient(to top, rgba(0,0,0,1) 75%, rgba(0,0,0,0) 100%)',
                          height: '115px'
                        }}
                      >
                        {/* Screenshots accurate chat elements */}
                        {roomMessages.map((msg, idx) => {
                          // Assign colors and badges dynamically based on sender
                          let lvl = 16;
                          let lvlBg = 'bg-cyan-500/20 text-cyan-300 border-cyan-400/30';
                          let isAnchor = false;
                          let senderColorClass = 'text-sky-300';

                          if (msg.sender === 'Sophia') {
                            lvl = 99;
                            lvlBg = 'bg-pink-500/20 text-pink-300 border-pink-400/30';
                            senderColorClass = 'text-pink-400';
                          } else if (msg.sender === 'Mason 👑' || msg.sender === 'Mason') {
                            lvl = 65;
                            lvlBg = 'bg-purple-500/20 text-purple-300 border-purple-400/30';
                            isAnchor = true;
                            senderColorClass = 'text-yellow-400 font-extrabold drop-shadow-[0_0_6px_rgba(234,179,8,0.3)]';
                          } else if (msg.sender === 'Ryan') {
                            lvl = 32;
                            lvlBg = 'bg-blue-500/20 text-blue-300 border-blue-400/30';
                            senderColorClass = 'text-blue-300';
                          } else if (msg.sender === 'Charlotte') {
                            lvl = 18;
                            lvlBg = 'bg-indigo-500/20 text-indigo-300 border-indigo-400/30';
                            senderColorClass = 'text-fuchsia-400';
                          }

                          const isSystem = msg.type === 'system';

                          return (
                            <div key={idx} className="leading-relaxed animate-chat-slide-up flex">
                              <div className="px-1.5 py-0.5 inline-flex items-center gap-1.5 max-w-[98%] text-right flex-wrap">
                                {!isSystem && (
                                  <>
                                    {/* Level Badge */}
                                    <span className={`text-[6.5px] font-black px-1 rounded-md border ${lvlBg} leading-none py-[1px]`}>
                                      Lv.{lvl}
                                    </span>
                                    {/* Anchor Badge */}
                                    {isAnchor && (
                                      <span className="text-[6.5px] font-extrabold bg-blue-600/30 text-blue-200 px-1 rounded-md border border-blue-400/30 leading-none py-[1px]">
                                        HOST
                                      </span>
                                    )}
                                  </>
                                )}
                                
                                <span className={`${isSystem ? 'text-purple-300 font-bold' : senderColorClass} text-[9.5px] font-bold`}>
                                  {msg.sender}:
                                </span>{' '}
                                <span className="text-white text-[9.5px] font-semibold leading-relaxed inline-flex items-center gap-1 flex-wrap font-sans">
                                  {msg.isEncrypted ? (
                                    <>
                                      <span className="text-emerald-400 font-extrabold text-[10px]" title="مشفّر طرف-إلى-طرف (E2EE)">🔒</span>
                                      <EncryptedMessageText
                                        ciphertext={msg.rawCiphertext || ''}
                                        iv={msg.iv || ''}
                                        derivedKey={derivedKey}
                                        showCiphertext={showCiphertextInFeed}
                                        fallbackText={msg.text}
                                      />
                                    </>
                                  ) : (
                                    <span>{msg.text}</span>
                                  )}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                  </div>

                  {/* NATIVE PHONE NAVIGATION AND BOTTOM ACTION HUB (Overhauled perfectly matching screenshot) */}
                  <div className="p-3 bg-slate-950/95 border-t border-purple-950/30 flex justify-between items-center select-none z-30 gap-2" dir="rtl">
                    
                    {/* RIGHT-SIDE CLUSTER: Chat Input, Mic toggle, Speaker toggle, and Prominent Gift Button */}
                    <div className="flex-grow flex items-center gap-1.5 min-w-0">
                      {/* Input box "Let's talk" (أرسل رسالة للمجلس...) */}
                      <div className="flex-grow flex items-center bg-black/40 border border-white/5 rounded-full px-2.5 py-1.5 transition-all min-w-[120px]">
                        <input
                          type="text"
                          value={chatInputValue}
                          onChange={(e) => setChatInputValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleSendChatMessage();
                            }
                          }}
                          placeholder="أرسل رسالة للمجلس..."
                          className="flex-grow bg-transparent text-[10px] text-slate-100 placeholder-slate-500 text-right outline-none w-full"
                          dir="rtl"
                          id="chat-interactive-input"
                        />
                        {/* Smiley icon trigger */}
                        <button
                          onClick={() => alert('مجموعة الملصقات والرموز التعبيرية ستتوفر قريباً مع حزمة IM SDK!')}
                          className="text-slate-400 hover:text-white mx-1 text-xs shrink-0"
                        >
                          😊
                        </button>
                        <button
                          onClick={handleSendChatMessage}
                          className={`p-1 rounded-full text-white transition active:scale-90 cursor-pointer flex items-center justify-center shrink-0 ${
                            chatInputValue.trim() 
                              ? 'bg-purple-600' 
                              : 'text-slate-500'
                          }`}
                          title="إرسال"
                          id="chat-send-btn"
                        >
                          <Send className="w-3 h-3" />
                        </button>
                      </div>

                      {/* Mic Speak Controller Button (Right next to Input box) */}
                      <button
                        onClick={async () => {
                          const userSeatIndex = activeRoom.seats.findIndex(s => s.userId === currentUser.id);
                          
                          if (userSeatIndex === -1) {
                            // Automatically find first empty, unlocked seat to sit them down and open their mic!
                            const firstEmptySeatIndex = activeRoom.seats.findIndex(s => s.userId === null && !s.isLocked);
                            if (firstEmptySeatIndex !== -1) {
                              const updatedSeats = [...activeRoom.seats];
                              updatedSeats[firstEmptySeatIndex] = { 
                                ...updatedSeats[firstEmptySeatIndex], 
                                userId: currentUser.id, 
                                isMuted: false // Start unmuted (talking!)
                              };
                              const updatedRoom = { ...activeRoom, seats: updatedSeats };
                              setActiveRoom(updatedRoom);
                              setRooms(rooms.map(r => r.id === activeRoom.id ? updatedRoom : r));

                              // Broadcast via Firestore
                              await updateDoc(doc(db, "voice_rooms", activeRoom.id), { seats: updatedSeats });

                              // Start publishing
                              const agoraManager = AgoraEngineManager.getInstance(); agoraManager.startPublishing();
                            } else {
                              alert('عذراً، جميع المقاعد ممتلئة حالياً! يرجى الانتظار لحين مغادرة أحد المتحدثين لكي تتمكن من الصعود والتحدث.');
                            }
                          } else {
                            // User is already on a seat, toggle their mute state
                            const seat = activeRoom.seats[userSeatIndex];
                            const nextMuteStatus = !seat.isMuted;
                            const updatedSeats = [...activeRoom.seats];
                            updatedSeats[userSeatIndex] = { ...seat, isMuted: nextMuteStatus };
                            const updatedRoom = { ...activeRoom, seats: updatedSeats };
                            setActiveRoom(updatedRoom);
                            setRooms(rooms.map(r => r.id === activeRoom.id ? updatedRoom : r));

                            // Broadcast via Firestore
                            await updateDoc(doc(db, "voice_rooms", activeRoom.id), { seats: updatedSeats });
                            
                            // Handle publishing/stopping based on mute status
                            const agoraManager = AgoraEngineManager.getInstance();
                            if (nextMuteStatus) {
                                agoraManager.stopPublishing();
                            } else {
                                agoraManager.startPublishing();
                            }
                          }
                        }}
                        className={`w-8 h-8 rounded-full flex items-center justify-center cursor-pointer active:scale-90 transition-all shrink-0 ${
                          activeRoom.seats.some(s => s.userId === currentUser.id)
                            ? !activeRoom.seats.find(s => s.userId === currentUser.id)?.isMuted
                              ? 'bg-emerald-600 border border-emerald-400 text-white animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                              : 'bg-red-950/50 border border-red-500/30 text-red-300'
                            : 'bg-slate-900/80 text-slate-400 border border-white/5 hover:border-purple-500/30'
                        }`}
                        title="تشغيل/كتم المايك الخاص بك"
                        id="mic-speak-btn"
                      >
                        {activeRoom.seats.some(s => s.userId === currentUser.id) && !activeRoom.seats.find(s => s.userId === currentUser.id)?.isMuted ? (
                          <Mic className="w-3.5 h-3.5 text-white" />
                        ) : (
                          <MicOff className="w-3.5 h-3.5 text-red-400" />
                        )}
                      </button>

                      {/* Speaker Toggle Button (Right next to Mic Button) */}
                      <button
                        onClick={() => {
                          setIsRoomAudioDeafened(!isRoomAudioDeafened);
                        }}
                        className={`w-8 h-8 rounded-full flex items-center justify-center cursor-pointer active:scale-90 transition-all shrink-0 ${
                          isRoomAudioDeafened
                            ? 'bg-red-950/50 border border-red-500/30 text-red-300'
                            : 'bg-purple-600 border border-purple-400 text-white shadow-[0_0_10px_rgba(124,58,237,0.5)]'
                        }`}
                        title="كتم/تشغيل مكبر صوت المجلس"
                        id="speaker-toggle-btn"
                      >
                        {isRoomAudioDeafened ? (
                          <VolumeX className="w-3.5 h-3.5 text-red-400" />
                        ) : (
                          <Volume2 className="w-3.5 h-3.5 text-white" />
                        )}
                      </button>

                      {/* Prominent, colorful 2D virtual gift launcher button */}
                      <button
                        onClick={() => setIsGiftDrawerOpen(true)}
                        className="w-10 h-10 rounded-full bg-gradient-to-tr from-amber-500 via-orange-500 to-red-500 text-white cursor-pointer active:scale-95 hover:scale-105 transition-all shadow-[0_0_12px_rgba(245,158,11,0.6)] flex items-center justify-center shrink-0 border-2 border-yellow-300/60 animate-[pulse_2.2s_infinite]"
                        title="إرسال هدايا المجلس الفاخرة"
                        id="native-gift-trigger"
                      >
                        <span className="text-xl drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]">🎁</span>
                      </button>
                    </div>
                  </div>

                  {/* Seat Actions Modal sheet (when selectedSeatIndex is active) */}
                  {selectedSeatIndex !== null && (
                    <div className="absolute inset-0 bg-black/60 z-50 flex items-end justify-center animate-fade-in">
                      <div className="bg-[#120c24] border-t border-purple-500/30 p-4 rounded-t-3xl w-full text-right space-y-4 shadow-2xl">
                        
                        <div className="flex justify-between items-center border-b border-purple-950/50 pb-2">
                          <button
                            onClick={() => setSelectedSeatIndex(null)}
                            className="text-xs text-slate-400 hover:text-white"
                            id="close-host-modal-btn"
                          >
                            إغلاق
                          </button>
                          <h4 className="text-xs font-bold text-white">
                            إدارة المقعد رقم {selectedSeatIndex + 1}
                          </h4>
                        </div>
 
                        <div className="space-y-2">
                          {(() => {
                            const isAuthorizedHost = checkIfOwner(activeRoom) || (activeRoom.seats[0] && activeRoom.seats[0].userId === currentUser.id);
                            return (
                              <>
                                {isAuthorizedHost && (
                                  <>
                                    {/* Mute Seat */}
                                    <button
                                      onClick={() => handleHostAction('mute')}
                                      className="w-full bg-[#03000a] hover:bg-slate-900 border border-slate-800 py-2 px-4 rounded-xl text-xs font-bold text-slate-200 flex justify-between items-center transition"
                                      id="host-action-mute"
                                    >
                                      <span className="text-purple-400">
                                        {activeRoom.seats[selectedSeatIndex].isMuted ? 'تفعيل الصوت' : 'كتم الميكروفون'}
                                      </span>
                                      <Volume2 className="w-4 h-4 text-purple-400" />
                                    </button>
 
                                    {/* Lock/Unlock Seat */}
                                    <button
                                      onClick={() => handleHostAction('lock')}
                                      className="w-full bg-[#03000a] hover:bg-slate-900 border border-slate-800 py-2 px-4 rounded-xl text-xs font-bold text-slate-200 flex justify-between items-center transition"
                                      id="host-action-lock"
                                    >
                                      <span className="text-amber-400">
                                        {activeRoom.seats[selectedSeatIndex].isLocked ? 'إلغاء قفل المقعد' : 'قفل المقعد وحجبه'}
                                      </span>
                                      {activeRoom.seats[selectedSeatIndex].isLocked ? <Unlock className="w-4 h-4 text-amber-400" /> : <Lock className="w-4 h-4 text-amber-400" />}
                                    </button>
                                  </>
                                )}
 
                                {/* Kick Occupant (only visible if seat is occupied) */}
                                {activeRoom.seats[selectedSeatIndex].userId && (
                                  <button
                                    onClick={() => {
                                      if (activeRoom.seats[selectedSeatIndex].userId === currentUser.id) {
                                        handleHostAction('leave');
                                      } else {
                                        handleHostAction('kick');
                                      }
                                    }}
                                    className="w-full bg-red-950/40 hover:bg-red-900/40 border border-red-500/20 py-2 px-4 rounded-xl text-xs font-bold text-red-400 flex justify-between items-center transition"
                                    id="host-action-kick"
                                  >
                                    <span>
                                      {activeRoom.seats[selectedSeatIndex].userId === currentUser.id ? 'النزول من المقعد للجمهور' : 'طرد المستخدم للجمهور'}
                                    </span>
                                    <ShieldAlert className="w-4 h-4 text-red-400" />
                                  </button>
                                )}
                              </>
                            );
                          })()}
                        </div>
 
                      </div>
                    </div>
                  )}

                  {/* PURE NATIVE GIFTING BOTTOM SHEET (No Web Simulator Controls) */}
                  {isGiftDrawerOpen && (
                    <>
                      <div
                        className="absolute inset-0 bg-black/60 z-40 animate-fade-in cursor-pointer"
                        onClick={() => setIsGiftDrawerOpen(false)}
                      />
                      <div className="absolute inset-x-0 bottom-0 bg-[#0c071fa6] backdrop-blur-xl border-t border-purple-500/30 rounded-t-[32px] p-4 z-50 animate-fade-in shadow-2xl text-right">
                      <div className="flex justify-between items-center border-b border-purple-950/40 pb-2 mb-3">
                        <button
                          onClick={() => setIsGiftDrawerOpen(false)}
                          className="text-xs text-slate-400 hover:text-white bg-slate-900/60 px-3 py-1 rounded-full border border-slate-800 cursor-pointer"
                        >
                          إغلاق
                        </button>
                        <h4 className="text-xs font-bold text-white flex items-center gap-1.5 font-sans">
                          🎁 متجر الهدايا الفاخرة
                        </h4>
                      </div>

                      {/* Recipient Selection Bar (Moved to the very top) */}
                      {activeRoom && (
                        <div className="mb-3 text-right">
                          <span className="text-[10px] text-slate-400 font-bold block mb-1.5">مستلم الهدية 👤:</span>
                          <div className="flex gap-2 overflow-x-auto pb-1.5 scrollbar-thin flex-row-reverse">
                            {/* "All" candidate */}
                            <button
                              onClick={() => setSelectedRecipientSeatIndex('all')}
                              className={`flex flex-col items-center gap-1 p-1 px-2 rounded-xl border shrink-0 transition-all cursor-pointer ${
                                selectedRecipientSeatIndex === 'all'
                                  ? 'bg-purple-900/40 border-amber-400 text-amber-300'
                                  : 'bg-[#03000a]/60 border-purple-900/20 text-slate-400 hover:text-white'
                              }`}
                            >
                              <div className="w-6 h-6 rounded-full bg-purple-950/80 flex items-center justify-center text-xs border border-purple-500/20">
                                👥
                              </div>
                              <span className="text-[8px] font-bold font-sans">الجميع</span>
                            </button>

                            {/* Occupied seats candidates */}
                            {activeRoom.seats
                              .filter((seat) => seat.userId !== null)
                              .map((seat) => {
                                const occupant = users.find((u) => u.id === seat.userId) || (currentUser && seat.userId === currentUser.id ? currentUser : null);
                                if (!occupant) return null;
                                const isSelected = selectedRecipientSeatIndex === seat.index;
                                const isHost = seat.index === 0;

                                return (
                                  <button
                                    key={seat.index}
                                    onClick={() => setSelectedRecipientSeatIndex(seat.index)}
                                    className={`flex flex-col items-center gap-1 p-1 px-2 rounded-xl border shrink-0 transition-all cursor-pointer ${
                                      isSelected
                                        ? 'bg-purple-900/40 border-amber-400 text-amber-300'
                                        : 'bg-[#03000a]/60 border-purple-900/20 text-slate-400 hover:text-white'
                                    }`}
                                  >
                                    <div className="relative">
                                      <img
                                        src={occupant.avatar || "https://api.dicebear.com/7.x/adventurer/svg?seed=placeholder"}
                                        alt={occupant.name}
                                        className="w-6 h-6 rounded-full object-cover border border-purple-500/30"
                                      />
                                      {isHost && (
                                        <span className="absolute -top-1 -right-1 text-[7px]">👑</span>
                                      )}
                                    </div>
                                    <span className="text-[8px] font-bold max-w-[50px] truncate font-sans">
                                      {isHost ? 'المستضيف' : occupant.name}
                                    </span>
                                  </button>
                                );
                              })}
                          </div>
                        </div>
                      )}

                      <div className="flex justify-between items-center bg-[#03000a] p-2 rounded-xl border border-purple-500/10 mb-3">
                        <span className="text-[10px] text-slate-400 font-bold">الرصيد المتوفر:</span>
                        <div className="flex items-center gap-1">
                          <Coins className="w-3.5 h-3.5 text-amber-400" />
                          <span className="text-xs font-mono font-bold text-amber-300">🪙 {currentUser.coins.toFixed(0)} كوينز</span>
                        </div>
                      </div>

                      {/* Gifts Scrollable Grid */}
                      <div className="grid grid-cols-4 gap-2 max-h-[160px] overflow-y-auto mb-4 p-1 scrollbar-thin">
                        {GIFTS.map((gift) => {
                          const isSelected = selectedGift && selectedGift.id === gift.id;
                          return (
                            <button
                              key={gift.id}
                              onClick={() => setSelectedGift(gift)}
                              className={`p-2.5 rounded-2xl flex flex-col items-center justify-between transition-all duration-150 relative active:scale-95 cursor-pointer ${
                                isSelected
                                  ? 'bg-purple-900/40 border-2 border-amber-400 shadow-lg shadow-amber-500/10 ring-1 ring-amber-400/20'
                                  : 'bg-[#03000a]/80 border border-purple-900/20 hover:border-purple-500/30'
                              }`}
                            >
                              <span className="text-2xl filter drop-shadow animate-pulse">{gift.icon}</span>
                              <span className="text-[9px] text-slate-100 font-extrabold truncate w-full text-center mt-1.5">{gift.arabicName}</span>
                              <span className="text-[8px] text-amber-300 font-mono mt-0.5 font-bold">🪙 {gift.cost}</span>
                              {isSelected && (
                                <div className="absolute top-1 right-1 bg-amber-400 p-0.5 rounded-full">
                                  <Check className="w-2 h-2 text-slate-950 font-black" />
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {/* Buy Action Buttons */}
                      <div className="flex items-center justify-between gap-2.5 border-t border-purple-950/40 pt-3">
                        <div className="text-right">
                          <span className="text-[8px] text-slate-400 block">الهدايا تزيد من مستواك وتدعم المجلس</span>
                          {selectedGift && (
                            <span className="text-[10px] text-purple-300 font-bold block mt-0.5">
                              مكافأة: +{selectedGift.xpReward} نقطة خبرة XP
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            if (selectedGift) {
                              handleSendGift(selectedGift);
                              spawnFloatingGift(selectedGift.icon);
                            } else {
                              alert('الرجاء اختيار هدية لإرسالها!');
                            }
                          }}
                          className="bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-slate-950 text-xs font-black py-2.5 px-6 rounded-xl flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-lg cursor-pointer"
                        >
                          إرسال الهدية 🚀
                        </button>
                      </div>
                    </div>
                  </>
                )}

                  {/* SEATS REQUESTS QUEUE BOTTOM SHEET */}
                  {isQueueDrawerOpen && (
                    <>
                      <div
                        className="absolute inset-0 bg-black/60 z-40 animate-fade-in cursor-pointer"
                        onClick={() => setIsQueueDrawerOpen(false)}
                      />
                      <div className="absolute inset-x-0 bottom-0 bg-[#0c071fa6] backdrop-blur-xl border-t border-purple-500/30 rounded-t-[32px] p-4 z-50 animate-fade-in shadow-2xl text-right">
                      <div className="flex justify-between items-center border-b border-purple-950/40 pb-2 mb-3 font-sans">
                        <button
                          onClick={() => setIsQueueDrawerOpen(false)}
                          className="text-xs text-slate-400 hover:text-white bg-slate-900/60 px-3 py-1 rounded-full border border-slate-800 cursor-pointer"
                        >
                          إغلاق
                        </button>
                        <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                          🛋️ طلبات الصعود للمقاعد (23)
                        </h4>
                      </div>

                      <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                        {[
                          { id: 'q1', name: 'أبو فهد النجدي', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=60', level: 25 },
                          { id: 'q2', name: 'هنوف العتيبي', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=60', level: 14 },
                          { id: 'q3', name: 'فيصل الرياض', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=60', level: 31 },
                        ].map((req) => (
                          <div key={req.id} className="bg-slate-950/60 p-2 rounded-xl border border-white/5 flex justify-between items-center text-xs gap-3">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  // Find first empty seat index from index 6 to 9 (empty armchairs) or any
                                  const emptySeatIdx = activeRoom.seats.findIndex(s => s.userId === null && !s.isLocked);
                                  if (emptySeatIdx !== -1) {
                                    const updatedSeats = [...activeRoom.seats];
                                    updatedSeats[emptySeatIdx] = { ...updatedSeats[emptySeatIdx], userId: req.id };
                                    
                                    // ensure user in list
                                    if (!users.some(u => u.id === req.id)) {
                                      setUsers(prev => [...prev, { id: req.id, name: req.name, avatar: req.avatar, level: req.level, coins: 150, xp: 900 }]);
                                    }

                                    const updatedRoom = { ...activeRoom, seats: updatedSeats };
                                    setActiveRoom(updatedRoom);
                                    setRooms(rooms.map(r => r.id === activeRoom.id ? updatedRoom : r));
                                    
                                    setRoomMessages(prev => [
                                      ...prev,
                                      {
                                        sender: 'نظام المجلس',
                                        text: `صعد [ ${req.name} ] إلى المقعد رقم ${emptySeatIdx + 1} بنجاح! 🎉`,
                                        color: 'text-emerald-400 font-bold',
                                        type: 'system'
                                      }
                                    ]);
                                  } else {
                                    alert('جميع المقاعد ممتلئة حالياً!');
                                  }
                                  setIsQueueDrawerOpen(false);
                                }}
                                className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1 rounded-lg text-[10px] transition"
                              >
                                قبول
                              </button>
                              <button
                                onClick={() => {
                                  alert('تم رفض طلب الصعود');
                                  setIsQueueDrawerOpen(false);
                                }}
                                className="bg-red-950/40 hover:bg-red-900/40 text-red-300 px-3 py-1 rounded-lg text-[10px] transition"
                              >
                                رفض
                              </button>
                            </div>

                            <div className="flex items-center gap-2">
                              <div className="text-right">
                                <span className="text-white font-bold block">{req.name}</span>
                                <span className="text-[9px] text-slate-400">مستوى {req.level}</span>
                              </div>
                              <img src={req.avatar || "https://api.dicebear.com/7.x/adventurer/svg?seed=placeholder"} alt="" className="w-8 h-8 rounded-full border border-purple-500/20 object-cover" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                  {/* END-TO-END ENCRYPTION (E2EE) MANAGEMENT DRAWER */}
                  {isE2EEDrawerOpen && (
                    <>
                      <div
                        className="absolute inset-0 bg-black/60 z-40 animate-fade-in cursor-pointer"
                        onClick={() => setIsE2EEDrawerOpen(false)}
                      />
                      <div className="absolute inset-x-0 bottom-0 bg-[#04020b]/99 backdrop-blur-xl border-t border-emerald-500/40 rounded-t-[32px] p-4 z-50 animate-fade-in shadow-2xl text-right font-sans overflow-hidden" dir="rtl">
                      {/* Drawer Header */}
                      <div className="flex justify-between items-center border-b border-emerald-950/40 pb-2 mb-3">
                        <button
                          onClick={() => setIsE2EEDrawerOpen(false)}
                          className="text-xs text-slate-400 hover:text-white bg-slate-900/60 px-3 py-1 rounded-full border border-slate-800 cursor-pointer transition"
                        >
                          إغلاق
                        </button>
                        <h4 className="text-xs font-bold text-emerald-400 flex items-center gap-1.5 font-sans">
                          🔐 منظومة التشفير التام (E2EE Client-Side)
                        </h4>
                      </div>

                      {/* E2EE System Indicator */}
                      <div className="p-2.5 bg-[#020106] rounded-xl border border-emerald-500/20 mb-3 space-y-1.5 text-right">
                        <div className="flex justify-between items-center">
                          <span className="text-[9px] text-slate-400">حالة التشفير:</span>
                          <span className={`text-[10px] font-bold flex items-center gap-1 ${isE2EEEnabled ? 'text-emerald-400' : 'text-slate-400'}`}>
                            {isE2EEEnabled ? '🟢 مشفّر تزامني (AES-GCM-256)' : '🔴 غير مفعّل (قنوات مكشوفة)'}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[9px] text-slate-500 leading-relaxed">
                          <span>المعيار المستخدم:</span>
                          <span className="font-mono text-emerald-500/80">Web Crypto Subtle (PBKDF2 + AES-GCM)</span>
                        </div>
                      </div>

                      {/* Cryptographic Controls Grid */}
                      <div className="space-y-3 mb-3">
                        
                        {/* E2EE Main Toggle */}
                        <div className="flex justify-between items-center p-2 bg-[#020106]/40 rounded-lg border border-white/5">
                          <button
                            onClick={() => {
                              setIsE2EEEnabled(!isE2EEEnabled);
                              addE2eeLog(isE2EEEnabled ? 'تم إيقاف تشفير المحادثات الصادرة.' : 'تم تفعيل التشفير التام للمحادثات الصادرة.');
                            }}
                            className={`px-2.5 py-1 rounded-md text-[9px] font-bold transition-all cursor-pointer ${
                              isE2EEEnabled 
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                                : 'bg-slate-800 text-slate-400 border border-slate-700'
                            }`}
                          >
                            {isE2EEEnabled ? 'مفعّل (Active)' : 'ملغى (Disabled)'}
                          </button>
                          <span className="text-[10px] text-slate-200">تشفير الرسائل الصادرة والواردة تلقائياً</span>
                        </div>

                        {/* Passphrase Entry */}
                        <div className="space-y-1 bg-[#020106]/40 p-2.5 rounded-lg border border-white/5 text-right">
                          <div className="flex justify-between items-center">
                            <button
                              onClick={() => {
                                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                                let code = 'Sada-';
                                for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
                                setE2eePassphrase(code);
                                addE2eeLog(`تم توليد كلمة سر عشوائية جديدة: ${code}`);
                              }}
                              className="text-[8px] bg-emerald-950/40 text-emerald-300 border border-emerald-500/20 px-2 py-0.5 rounded hover:bg-emerald-900/40 transition"
                            >
                              🎲 كود عشوائي
                            </button>
                            <label className="text-[10px] text-slate-300 font-bold">مفتاح التشفير المشترك (Passphrase)</label>
                          </div>
                          
                          <div className="flex items-center gap-1 bg-black/50 border border-white/5 rounded-md px-2 py-1 mt-1 font-sans">
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(e2eePassphrase);
                                addE2eeLog(`تم نسخ كلمة سر التشفير المشتركة لغرفة الدردشة.`);
                                alert('تم نسخ كلمة سر التشفير المشتركة للمجلس بنجاح!');
                              }}
                              className="text-slate-400 hover:text-white p-1 text-[10px] transition"
                              title="نسخ كلمة السر"
                            >
                              📋
                            </button>
                            <input
                              type={showPassphrase ? 'text' : 'password'}
                              value={e2eePassphrase}
                              onChange={(e) => {
                                setE2eePassphrase(e.target.value);
                                addE2eeLog(`تم تعديل كلمة مرور التشفير المشتركة للغرفة.`);
                              }}
                              placeholder="أدخل رمز التشفير السري للمجلس..."
                              className="bg-transparent text-slate-200 text-[10px] font-mono text-left outline-none flex-grow w-full"
                            />
                            <button
                              onClick={() => setShowPassphrase(!showPassphrase)}
                              className="text-slate-400 hover:text-white px-1 text-[10px]"
                            >
                              {showPassphrase ? '👁️' : '🕶️'}
                            </button>
                          </div>
                          <span className="text-[8px] text-slate-500 block leading-tight mt-1 text-right">
                            * يجب أن يدخل جميع من في الغرفة نفس هذا الرمز السري ليتمكنوا من قراءة الرسائل بوضوح.
                          </span>
                        </div>

                        {/* Show Ciphertext Toggle */}
                        <div className="flex justify-between items-center p-2 bg-[#020106]/40 rounded-lg border border-white/5">
                          <button
                            onClick={() => setShowCiphertextInFeed(!showCiphertextInFeed)}
                            className={`px-2.5 py-1 rounded-md text-[9px] font-bold transition-all cursor-pointer ${
                              showCiphertextInFeed 
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' 
                                : 'bg-slate-800 text-slate-400 border border-slate-700'
                            }`}
                          >
                            {showCiphertextInFeed ? 'معروض (Ciphertext)' : 'مخفي (Decrypted)'}
                          </button>
                          <span className="text-[10px] text-slate-200">عرض الرموز المشفّرة عِوضاً عن النص العادي</span>
                        </div>

                        {/* Local Cryptographic Identity (RSA-OAEP) */}
                        <div className="bg-[#020106]/40 p-2.5 rounded-lg border border-white/5 space-y-1.5 text-right font-sans">
                          <div className="flex justify-between items-center">
                            <button
                              onClick={() => {
                                if (clientPublicKeyBase64) {
                                  navigator.clipboard.writeText(clientPublicKeyBase64);
                                  addE2eeLog(`تم نسخ مفتاح RSA العام لهويتك الفريدة.`);
                                  alert('تم نسخ مفتاح RSA-2048 العام لهويتك الرقمية للمجلس بنجاح!');
                                }
                              }}
                              className="text-[8px] bg-purple-950/40 text-purple-300 border border-purple-500/20 px-2 py-0.5 rounded hover:bg-purple-900/40 transition"
                            >
                              📋 نسخ مفتاح الهوية
                            </button>
                            <span className="text-[10px] text-slate-300 font-bold">هويتك الرقمية المشفرة (RSA Identity Key)</span>
                          </div>
                          <div className="p-1.5 bg-black/60 rounded border border-white/5 overflow-x-auto">
                            <code className="text-[6px] text-slate-500 font-mono block break-all leading-normal select-all">
                              {clientPublicKeyBase64 ? clientPublicKeyBase64.substring(0, 110) + '...' : 'جاري التوليد...'}
                            </code>
                          </div>
                          <span className="text-[8px] text-slate-500 block leading-tight">
                            * يتم توليد زوج مفاتيح RSA-OAEP 2048-bit في متصفحك محلياً بشكل منعزل لإثبات وتأكيد هويتك أمام أطراف الغرفة.
                          </span>
                        </div>

                      </div>

                      {/* Live SubtleCrypto Live Audit terminal */}
                      <div className="space-y-1.5 font-sans">
                        <div className="flex justify-between items-center">
                          <button
                            onClick={() => setE2eeAuditLogs([])}
                            className="text-[8px] text-slate-400 hover:text-red-400 transition cursor-pointer"
                          >
                            مسح السجل 🗑️
                          </button>
                          <span className="text-[9px] text-slate-400 font-bold">📺 سجل العمليات التشفيرية الفورية (SubtleCrypto Log):</span>
                        </div>
                        <div className="p-2 bg-black/90 border border-emerald-500/10 rounded-xl h-24 overflow-y-auto text-left font-mono space-y-1 scrollbar-thin">
                          {e2eeAuditLogs.length === 0 ? (
                            <div className="text-[8px] text-slate-600 italic">بانتظار حركة تشفيرية للمرسل...</div>
                          ) : (
                            e2eeAuditLogs.map((log, lidx) => (
                              <div key={lidx} className="text-[7px] leading-tight select-text text-emerald-400/90 break-words font-mono">
                                {log}
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                    </div>
                  </>
                )}


                  {/* ROOM SETTINGS DRAWER */}
                  {isRoomSettingsDrawerOpen && (
                    <>
                      <div
                        className="absolute inset-0 bg-black/60 z-40 animate-fade-in cursor-pointer"
                        onClick={() => setIsRoomSettingsDrawerOpen(false)}
                      />
                      <div className="absolute inset-x-0 bottom-0 bg-[#0f0a1c] backdrop-blur-2xl border-t border-purple-500/45 rounded-t-[32px] p-5 z-50 animate-fade-in shadow-2xl text-right font-sans max-h-[85%] overflow-y-auto" dir="rtl">
                      {/* Header */}
                      <div className="flex justify-between items-center border-b border-purple-950/40 pb-3 mb-4">
                        <button
                          onClick={() => setIsRoomSettingsDrawerOpen(false)}
                          className="text-xs text-slate-400 hover:text-white bg-slate-900/60 px-3 py-1 rounded-full border border-slate-800 cursor-pointer transition"
                        >
                          إغلاق
                        </button>
                        <h4 className="text-sm font-black text-white flex items-center gap-1.5 font-sans">
                          ⚙️ إعدادات المجلس الصوتي
                        </h4>
                      </div>

                      {roomSettingsError && (
                        <div className="bg-red-950/50 border border-red-500/30 text-red-300 p-2.5 rounded-xl text-xs mb-3 text-right">
                          ⚠️ {roomSettingsError}
                        </div>
                      )}

                      <div className="space-y-4">
                        {/* Room Name Input */}
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-slate-300 block">اسم المجلس الصوتي:</label>
                          <input
                            type="text"
                            value={roomSettingsName}
                            onChange={(e) => setRoomSettingsName(e.target.value)}
                            placeholder="اكتب اسم المجلس هنا..."
                            className="w-full bg-[#05030a] border border-purple-900/40 text-white rounded-xl p-3 text-xs outline-none focus:border-purple-500 transition font-bold"
                          />
                        </div>

                        {/* Mobile File Uploader */}
                        <div className="space-y-3">
                          <label className="text-xs font-bold text-slate-300 block">صورة واجهة المجلس 🖼️:</label>
                          
                          {/* Selected Image Preview */}
                          {roomSettingsAvatar && (
                            <div className="flex flex-col items-center justify-center p-3 bg-[#05030a]/40 rounded-2xl border border-purple-900/30 gap-2">
                              <span className="text-[10px] text-slate-400 font-bold">معاينة الصورة الحالية:</span>
                              <div className="relative w-24 h-24 rounded-2xl overflow-hidden border-2 border-amber-400/80 shadow-lg shadow-purple-950">
                                <img
                                  src={roomSettingsAvatar || "https://api.dicebear.com/7.x/adventurer/svg?seed=placeholder"}
                                  alt="Room Avatar Preview"
                                  className="w-full h-full object-cover select-none pointer-events-none"
                                  style={{ WebkitTouchCallout: 'none' }}
                                  draggable="false"
                                  onContextMenu={(e) => e.preventDefault()}
                                />
                              </div>
                            </div>
                          )}

                          <input
                            type="file"
                            id="room-avatar-upload"
                            accept="image/*"
                            onChange={handleRoomAvatarFileChange}
                            className="hidden"
                          />
                          
                          <label
                            htmlFor="room-avatar-upload"
                            className="flex flex-col items-center justify-center border-2 border-dashed border-purple-500/35 hover:border-amber-400 bg-purple-950/20 hover:bg-purple-950/40 text-slate-200 hover:text-white rounded-2xl p-6 text-center cursor-pointer transition active:scale-95 group"
                          >
                            <span className="text-3xl mb-2 group-hover:scale-110 transition-transform">📱</span>
                            <span className="text-xs font-black text-amber-300">رفع صورة من الاستوديو / الكاميرا</span>
                            <span className="text-[9px] text-slate-400 mt-1">اضغط هنا لتصفح ملفات هاتفك واختيار صورة مباشرة</span>
                          </label>
                        </div>

                        {/* Save Action Button */}
                        <button
                          type="button"
                          disabled={isUpdatingRoomSettings}
                          onClick={async () => {
                            if (!roomSettingsName.trim()) {
                              setRoomSettingsError('يرجى كتابة اسم المجلس أولاً');
                              return;
                            }

                            setIsUpdatingRoomSettings(true);
                            setRoomSettingsError('');

                            try {
                              const roomRef = doc(db, "voice_rooms", activeRoom.id);
                              await updateDoc(roomRef, {
                                name: roomSettingsName.trim(),
                                room_name: roomSettingsName.trim(),
                                hostAvatar: roomSettingsAvatar.trim(),
                                host_avatar: roomSettingsAvatar.trim()
                              });

                              setIsRoomSettingsDrawerOpen(false);
                              alert('🎉 تم تحديث بيانات مجلسك الصوتي بنجاح!');
                            } catch (err) {
                              console.error(err);
                              setRoomSettingsError('حدث خطأ في تحديث الإعدادات عبر Firestore.');
                            } finally {
                              setIsUpdatingRoomSettings(false);
                            }
                          }}
                          className="w-full bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-600 hover:to-yellow-500 text-slate-950 py-3 rounded-xl text-xs font-black transition shadow-lg hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                        >
                          {isUpdatingRoomSettings ? (
                            <span>جاري الحفظ والتحديث...</span>
                          ) : (
                            <span>حفظ التعديلات ✨</span>
                          )}
                        </button>
                      </div>
                    </div>
                  </>
                )}

                  {/* ADMIN SIMULATION & CONTROL WHEEL DRAWER */}
                  {isAdminDrawerOpen && (
                    <>
                      <div
                        className="absolute inset-0 bg-black/60 z-40 animate-fade-in cursor-pointer"
                        onClick={() => setIsAdminDrawerOpen(false)}
                      />
                      <div className="absolute inset-x-0 bottom-0 bg-[#120722]/98 backdrop-blur-xl border-t border-amber-500/30 rounded-t-[32px] p-4 z-50 animate-fade-in shadow-2xl text-right font-sans">
                      <div className="flex justify-between items-center border-b border-purple-950/50 pb-2 mb-3">
                        <button
                          onClick={() => setIsAdminDrawerOpen(false)}
                          className="text-xs text-slate-400 hover:text-white bg-slate-900/60 px-3 py-1 rounded-full border border-slate-800 cursor-pointer"
                        >
                          إغلاق
                        </button>
                        <h4 className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                          👑 أدوات التحكم ومفاتيح المحاكاة
                        </h4>
                      </div>

                      <p className="text-[9px] text-slate-400 mb-3 leading-relaxed">
                        استخدم هذه الأدوات لمحاكاة أحداث البث المباشر الفورية والتحقق من الاستجابة اللحظية (Zero Latency) ومؤشرات التحدث الفعالة.
                      </p>

                      <div className="space-y-2.5">
                        {/* 1. Simulate VIP Entrance */}
                        <button
                          onClick={() => {
                            const vips = ['خالد الحربي', 'الشيخ فيصل الرياض', 'بندر الشمري', 'سعود العتيبي'];
                            const randomVip = vips[Math.floor(Math.random() * vips.length)];
                            triggerVipEntrance(randomVip, 38);
                            setIsAdminDrawerOpen(false);
                          }}
                          className="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 py-2 px-4 rounded-xl text-xs font-bold flex justify-between items-center transition cursor-pointer active:scale-95"
                        >
                          <span>تشغيل الآن</span>
                          <span className="flex items-center gap-1">
                            <Award className="w-4 h-4 text-slate-950" />
                            محاكاة دخول VIP (مستوى ٣٨) 👑
                          </span>
                        </button>

                        {/* 2. Toggle Speaker voice impulse */}
                        <button
                          onClick={() => {
                            const validIndexes = activeRoom.seats.filter(s => s.userId !== null).map(s => s.index);
                            if (validIndexes.length > 0) {
                              const randomIdx = validIndexes[Math.floor(Math.random() * validIndexes.length)];
                              setSpeakingSeatIndex(randomIdx);
                              setTimeout(() => setSpeakingSeatIndex(null), 2500);
                            }
                            setIsAdminDrawerOpen(false);
                          }}
                          className="w-full bg-[#7C3AED] hover:bg-[#6d28d9] text-white py-2 px-4 rounded-xl text-xs font-bold flex justify-between items-center transition cursor-pointer active:scale-95"
                        >
                          <span>إرسال نبضة صوتية</span>
                          <span className="flex items-center gap-1">
                            <Music className="w-4 h-4 text-white" />
                            محاكاة تحدث المتحدثين (RTC Wave) 🎙️
                          </span>
                        </button>

                        {/* 3. Gift Coin Credit Welcome bonus */}
                        <button
                          onClick={() => {
                            const updatedUser = { ...currentUser, coins: currentUser.coins + 500 };
                            setCurrentUser(updatedUser);
                            setUsers(users.map(u => u.id === currentUser.id ? updatedUser : u));
                            setIsAdminDrawerOpen(false);
                            alert('تم شحن حسابك بـ 500 كوينز مجانية 🪙 لغرض تجربة إرسال جميع الهدايا الفاخرة!');
                          }}
                          className="w-full bg-[#03000a] hover:bg-slate-900 border border-slate-800 text-amber-300 py-2 px-4 rounded-xl text-xs font-bold flex justify-between items-center transition cursor-pointer active:scale-95"
                        >
                          <span>شحن +500 كوينز</span>
                          <span className="flex items-center gap-1">
                            <Coins className="w-4 h-4 text-amber-400" />
                            شحن كوينزات تجريبية فورية
                          </span>
                        </button>

                        {/* 4. Disconnect simulation removed as Agora is disabled */}
                      </div>
                    </div>
                  </>
                )}

                  {/* SYSTEM OF APPROVED CHARGING AGENTS DRAWER */}
                  {isAgentsHubOpen && (
                    <>
                      <div
                        className="absolute inset-0 bg-black/60 z-40 animate-fade-in cursor-pointer"
                        onClick={() => setIsAgentsHubOpen(false)}
                      />
                      <div className="absolute inset-x-0 bottom-0 bg-[#0c0a15]/98 backdrop-blur-xl border-t border-amber-500/40 rounded-t-[32px] p-4.5 z-50 animate-fade-in shadow-2xl text-right font-sans max-h-[85%] overflow-y-auto">
                      <div className="flex justify-between items-center border-b border-slate-800 pb-2.5 mb-3.5">
                        <button
                          onClick={() => setIsAgentsHubOpen(false)}
                          className="text-xs text-slate-400 hover:text-white bg-slate-900/60 px-3.5 py-1 rounded-full border border-slate-800 cursor-pointer font-black"
                        >
                          إغلاق
                        </button>
                        <h4 className="text-sm font-black text-white flex items-center gap-1.5 font-sans">
                          💎 شبكة الوكلاء المعتمدين (Charging Agents)
                        </h4>
                      </div>

                      <div className="text-xs text-slate-300 leading-relaxed mb-4 text-right space-y-1">
                        <p>لتعبئة وشحن حسابك بالكوينزات، يرجى التواصل مع أحد وكلائنا المعتمدين المدرجين أدناه عبر تطبيق <strong className="text-emerald-400">واتساب</strong>.</p>
                        <p className="text-[10px] text-slate-400">الدفع آمن ومباشر كاش (فودافون كاش، زين كاش، أو تحويل بنكي محلي) وسيتم إرسال الكوينزات لحسابك فورياً.</p>
                      </div>

                      {/* Display direct enter for agent itself */}
                      {(currentUser?.role === 'agent' || currentUser?.role === 'admin' || currentUser?.isAgent) && (
                        <div className="bg-gradient-to-r from-amber-600/20 to-purple-600/20 border border-amber-500/30 p-3 rounded-xl mb-4 flex justify-between items-center">
                          <button
                            onClick={() => {
                              setIsAgentsHubOpen(false);
                              setCurrentScreen('agent_pin');
                            }}
                            className="bg-amber-500 text-slate-950 text-[10px] font-black px-3 py-1.5 rounded-lg transition hover:scale-105"
                          >
                            لوحة تحكم الوكيل
                          </button>
                          <div className="text-right">
                            <span className="text-[10px] font-black text-amber-300 block">لقد تعرّف النظام على حسابك كوكيل معتمد 🛡️</span>
                            <span className="text-[9px] text-slate-400">اضغط للدخول إلى لوحة الشحن المخصصة للوكلاء</span>
                          </div>
                        </div>
                      )}

                      {/* Agents List Grid */}
                      <div className="space-y-2.5">
                        {agentsHub.length === 0 ? (
                          <div className="bg-slate-900/40 p-6 rounded-xl text-center text-slate-400 text-xs border border-dashed border-slate-800">
                            لا يوجد وكلاء متاحين حالياً في منطقتك.
                          </div>
                        ) : (
                          agentsHub.map((agent) => (
                            <div key={agent.agent_id} className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 flex justify-between items-center hover:border-amber-500/20 transition-all duration-200">
                              <a
                                href={agent.contact_whatsapp}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[10px] px-3.5 py-1.5 rounded-lg transition-all duration-200 flex items-center gap-1.5 cursor-pointer shadow-sm shadow-emerald-950/40 animate-pulse"
                              >
                                <span className="text-xs">💬</span>
                                شحن واتساب
                              </a>
                              <div className="flex items-center gap-3">
                                <div className="text-right">
                                  <h5 className="text-xs font-black text-white">{agent.agent_name}</h5>
                                  <div className="flex items-center gap-1.5 justify-end mt-0.5">
                                    <span className="text-[9px] text-slate-400 font-mono">ID: {agent.agent_id}</span>
                                    <span className="text-[8px] bg-emerald-950/60 text-emerald-400 border border-emerald-500/20 px-1 py-0.2 rounded font-black">
                                      🟢 موثق ونشط
                                    </span>
                                  </div>
                                </div>
                                <div className="w-9 h-9 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-lg select-none shadow-inner">
                                  👤
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-900 flex justify-between items-center">
                        <span className="text-[8px] text-slate-500">نظام حماية صدى العرب المالي المعتمد</span>
                        <span className="text-[9px] text-amber-500 flex items-center gap-1">🛡️ حماية كوينز بنسبة 100%</span>
                      </div>
                    </div>
                  </>
                )}

                </div>
              )}

              {/* SCREEN 4: AGENT DASHBOARD SECURITY PIN ENTRY */}
              {currentScreen === 'agent_pin' && (
                <div className="flex-grow flex flex-col p-5 justify-between items-center bg-gradient-to-b from-[#1c120a] to-[#03000a] h-full" id="screen-agent-pin">
                  
                  <div className="text-center mt-12 space-y-2">
                    <ShieldAlert className="w-12 h-12 text-amber-500 mx-auto animate-pulse" />
                    <h3 className="text-base font-bold text-white">بوابة الوكلاء المعتمدين</h3>
                    <p className="text-[10px] text-slate-400">الوصول لهذه اللوحة يتطلب صلاحيات وكيل معتمد ورمز أمان</p>
                  </div>

                  <div className="w-full space-y-4">
                    <div className="bg-slate-900/90 p-4 rounded-xl border border-amber-500/20 text-right space-y-3">
                      <label className="text-[10px] text-slate-300 block">أدخل رمز أمان الوكيل المعتمد (PIN)</label>
                      <input
                        type="password"
                        maxLength={4}
                        placeholder="••••"
                        value={agentPinInput}
                        onChange={(e) => {
                          setAgentPinInput(e.target.value);
                          setAgentPinError(false);
                        }}
                        className="w-full bg-[#03000a] border border-slate-800 rounded-lg p-2.5 text-center text-xs text-white font-mono tracking-widest"
                      />
                      {agentPinError && (
                        <span className="text-[9px] text-red-400 font-bold block text-center">الرمز غير صحيح! رمز المحاكاة هو: 9999</span>
                      )}
                      <span className="text-[9px] text-amber-400 block text-center">💡 كود المحاكاة المعتمد للوكيل: 9999</span>
                    </div>

                    <button
                      onClick={() => {
                        if (agentPinInput === '9999') {
                          setAgentPinInput('');
                          setCurrentScreen('agent_dashboard');
                        } else {
                          setAgentPinError(true);
                        }
                      }}
                      className="w-full bg-amber-500 text-slate-950 py-2.5 rounded-xl text-xs font-bold transition"
                      id="agent-pin-submit"
                    >
                      توثيق وفتح لوحة الوكالة 🔒
                    </button>
                  </div>

                  <button
                    onClick={() => setCurrentScreen('explore')}
                    className="text-xs text-slate-400 hover:text-white"
                    id="back-to-explore-from-pin"
                  >
                    إلغاء والعودة للاستكشاف
                  </button>

                </div>
              )}

              {/* SCREEN 5: REAL-TIME AGENT IN-APP DASHBOARD */}
              {currentScreen === 'agent_dashboard' && (
                <div className="flex-grow flex flex-col h-full bg-[#0d0905]" id="screen-agent-dashboard">
                  
                  {/* Agent Header */}
                  <div className="bg-gradient-to-r from-amber-500 to-amber-700 p-3 flex justify-between items-center text-slate-950 select-none">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-5 h-5 text-slate-950" />
                      <div className="text-right">
                        <h4 className="text-xs font-black">الوكيل الذهبي للاتصالات</h4>
                        <p className="text-[8px] opacity-80">صلاحية وكيل رقم #9999</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setCurrentScreen('explore')}
                      className="bg-slate-950/25 hover:bg-slate-950/40 text-slate-950 px-2.5 py-1 rounded-lg text-[9px] font-bold transition"
                      id="exit-agent-dashboard-btn"
                    >
                      خروج للغرف
                    </button>
                  </div>

                  {/* Agent Content */}
                  <div className="p-4 flex-grow overflow-y-auto space-y-4">
                    
                    {/* Agent Balance Card */}
                    <div className="bg-gradient-to-br from-purple-950 via-slate-950 to-amber-950/60 p-4 rounded-xl border border-amber-500/30 text-center space-y-1 shadow-md">
                      <span className="text-[10px] text-slate-400">رصيد كوينزات الوكالة الفوري الشاغر:</span>
                      <h3 className="text-2xl font-black text-amber-300 font-mono">
                        🪙 {agentBalance.toLocaleString()}
                      </h3>
                      <span className="text-[9px] text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/20 inline-block">
                        رصيد نشط وموثق للتحويل
                      </span>
                    </div>

                    {/* Transfer Module Section */}
                    <div className="bg-slate-900/90 p-3 rounded-xl border border-purple-500/10 space-y-3">
                      <span className="text-[10px] text-amber-400 font-bold block text-right">عملية شحن وتحويل فوري:</span>
                      
                      {/* Search Recipient ID */}
                      <div className="space-y-1.5">
                        <label className="text-[9px] text-slate-400 block text-right">رقم معرف المستلم (ID)</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="مثال: 1001، 1002، 1004"
                            value={transferTargetId}
                            onChange={(e) => setTransferTargetId(e.target.value)}
                            className="flex-grow bg-[#03000a] border border-slate-800 rounded-lg p-2 text-xs text-center text-white font-mono"
                          />
                        </div>
                      </div>

                      {/* User recipient verification Card */}
                      {transferTargetUser ? (
                        <div className="bg-emerald-950/20 p-2.5 rounded-lg border border-emerald-500/20 flex justify-between items-center animate-fade-in">
                          <div className="flex items-center gap-2">
                            <img
                              src={transferTargetUser.avatar || "https://api.dicebear.com/7.x/adventurer/svg?seed=placeholder"}
                              alt="recipient avatar"
                              className="w-8 h-8 rounded-full border border-emerald-500/30 object-cover"
                            />
                            <div className="text-right">
                              <h5 className="text-[11px] font-bold text-white">{transferTargetUser.name}</h5>
                              <span className="text-[9px] text-amber-300">مستوى {transferTargetUser.level} | 🪙 رصيده الحالي: {transferTargetUser.coins}</span>
                            </div>
                          </div>
                          <span className="text-[9px] bg-emerald-900/60 text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-500/30">
                            مؤكد للهوية ✓
                          </span>
                        </div>
                      ) : (
                        transferTargetId && (
                          <div className="bg-red-950/20 p-2 rounded-lg border border-red-500/20 text-center text-[9px] text-red-400 font-bold">
                            ⚠️ رقم المعرف غير مسجل بقاعدة البيانات!
                          </div>
                        )
                      )}

                      {/* Amount and PIN secure fields */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-[9px] text-slate-400 block text-right">عدد الكوينزات</label>
                          <input
                            type="number"
                            placeholder="أدخل عدد الكوينز"
                            value={transferAmount}
                            onChange={(e) => setTransferAmount(e.target.value)}
                            className="w-full bg-[#03000a] border border-slate-800 rounded-lg p-2 text-xs text-center text-white font-mono"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] text-slate-400 block text-right">رمز أمان الوكيل PIN</label>
                          <input
                            type="password"
                            placeholder="أدخل PIN الوكيل"
                            value={transferPin}
                            onChange={(e) => setTransferPin(e.target.value)}
                            className="w-full bg-[#03000a] border border-slate-800 rounded-lg p-2 text-xs text-center text-white font-mono"
                          />
                        </div>
                      </div>

                      {transferSuccess && (
                        <div className="bg-emerald-950/40 text-emerald-300 text-[10px] p-2.5 rounded-lg border border-emerald-500/20 text-center font-bold">
                          🎉 تم شحن رصيد العميل بنجاح فورياً!
                        </div>
                      )}

                      {transferErrorMsg && (
                        <div className="bg-red-950/40 text-red-400 text-[10px] p-2 rounded-lg border border-red-500/20 text-center font-bold">
                          ⚠️ {transferErrorMsg}
                        </div>
                      )}

                      <button
                        onClick={handleExecuteTransfer}
                        className="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2"
                        id="execute-transfer-btn"
                      >
                        <Send className="w-3.5 h-3.5" />
                        إتمام عملية التحويل الفوري
                      </button>

                    </div>

                    {/* Agent Transaction log list */}
                    <div className="space-y-2">
                      <span className="text-[10px] text-slate-400 block text-right">سجل التحويلات والفواتير الأخيرة للوكالة:</span>
                      <div className="space-y-1.5 max-h-[160px] overflow-y-auto">
                        {transactions.map((tx) => (
                          <div
                            key={tx.id}
                            className="bg-slate-950 p-2.5 rounded-lg border border-slate-900 flex justify-between items-center text-right text-[10px]"
                          >
                            <div className="text-left">
                              <span className="text-emerald-400 font-mono block">+{tx.amount} 🪙</span>
                              <span className="text-[8px] text-slate-500 block">{new Date(tx.timestamp).toLocaleTimeString('ar-AE')}</span>
                            </div>
                            <div>
                              <strong className="text-white block">{tx.receiverName}</strong>
                              <span className="text-[8px] text-slate-400 block">ID: {tx.receiverId}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                  </div>

                </div>
              )}

              {/* 👤 PREMIUM USER PROFILE MODAL & BIO DRAWER */}
              {isProfileModalOpen && selectedProfileUser && (
                <div className="absolute inset-0 bg-black/75 backdrop-blur-xs z-50 flex items-end justify-center animate-fade-in text-right">
                  <div className="bg-[#0c081d] border-t border-purple-500/30 p-5 rounded-t-[32px] w-full max-h-[85%] overflow-y-auto space-y-5 shadow-2xl relative font-sans">
                    
                    {/* Decorative golden dome accent */}
                    <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-amber-500 via-purple-500 to-amber-500" />

                    {/* Header */}
                    <div className="flex justify-between items-center border-b border-purple-950/40 pb-2.5">
                      <button
                        onClick={() => {
                          setIsProfileModalOpen(false);
                          setIsEditingBio(false);
                        }}
                        className="text-xs text-slate-400 hover:text-white bg-slate-900/60 px-3 py-1 rounded-full border border-slate-800/80 cursor-pointer"
                      >
                        إغلاق
                      </button>
                      <h4 className="text-xs font-black text-amber-400 font-sans">
                        👤 البطاقة التعريفية والملف الشخصي
                      </h4>
                    </div>

                    {/* Main Identity Info */}
                    <div className="flex flex-col items-center text-center space-y-2">
                      <div className="relative">
                        {/* Gold ring for high levels, purple for guest */}
                        <div className={`w-20 h-20 rounded-full p-1 shadow-xl bg-slate-950 ${selectedProfileUser.level >= 10 ? 'bg-gradient-to-tr from-amber-500 via-yellow-300 to-orange-400' : 'bg-gradient-to-tr from-purple-600 to-slate-800'}`}>
                          <img
                            src={selectedProfileUser.avatar || "https://api.dicebear.com/7.x/adventurer/svg?seed=placeholder"}
                            alt=""
                            className="w-full h-full rounded-full object-cover border-2 border-[#0c081d]"
                          />
                        </div>
                        {selectedProfileUser.level >= 10 && (
                          <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-xl drop-shadow animate-bounce">👑</span>
                        )}
                        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-amber-500 text-slate-950 text-[8px] font-black px-2 py-0.5 rounded-full border border-[#0c081d] font-mono">
                          LV.{selectedProfileUser.level}
                        </span>
                      </div>

                      <div className="space-y-0.5">
                        <h3 className="text-sm font-black text-white flex items-center justify-center gap-1.5">
                          <span>{selectedProfileUser.name}</span>
                          {selectedProfileUser.level >= 10 && (
                            <span className="bg-gradient-to-r from-amber-500 to-amber-300 text-slate-950 text-[7px] font-black px-1.5 py-0.5 rounded-full">SVIP</span>
                          )}
                        </h3>
                        <p className="text-[10px] text-slate-400 font-mono">ID: {selectedProfileUser.id}</p>
                      </div>

                      {/* Follow/Unfollow Button */}
                      {currentUser && currentUser.id !== selectedProfileUser.id && (
                        <button
                          onClick={() => handleToggleFollow(selectedProfileUser)}
                          className={`mt-1 text-[11px] font-bold px-5 py-1.5 rounded-full shadow-md transition-all active:scale-95 flex items-center gap-1.5 mx-auto cursor-pointer ${
                            selectedProfileUser.followers?.includes(currentUser.id)
                              ? 'bg-slate-800 text-slate-300 border border-slate-700'
                              : 'bg-gradient-to-r from-purple-600 to-purple-500 text-white hover:opacity-90 font-black'
                          }`}
                        >
                          {selectedProfileUser.followers?.includes(currentUser.id) ? (
                            <span>إلغاء المتابعة</span>
                          ) : (
                            <span>➕ متابعة المستخدم</span>
                          )}
                        </button>
                      )}
                    </div>

                    {/* Followers & Following Stats Grid */}
                    <div className="grid grid-cols-3 gap-2 bg-[#03000a]/50 p-3 rounded-2xl border border-purple-950/40 text-center font-sans">
                      <div>
                        <strong className="text-xs text-white block font-mono">{selectedProfileUser.following?.length || 0}</strong>
                        <span className="text-[9px] text-slate-400">يتابع</span>
                      </div>
                      <div className="border-x border-purple-950/40">
                        <strong className="text-xs text-white block font-mono">{selectedProfileUser.followers?.length || 0}</strong>
                        <span className="text-[9px] text-slate-400">المتابعون</span>
                      </div>
                      <div>
                        <strong className="text-xs text-white block font-mono">3.4K</strong>
                        <span className="text-[9px] text-slate-400">الزوار</span>
                      </div>
                    </div>

                    {/* Biography (Bio) Component */}
                    <div className="bg-[#03000a]/30 p-3.5 rounded-2xl border border-purple-950/20 text-right space-y-2">
                      <span className="text-[10px] text-slate-400 font-bold block">📝 السيرة الذاتية (Bio):</span>
                      
                      {isEditingBio && currentUser?.id === selectedProfileUser.id ? (
                        <div className="space-y-2">
                          <textarea
                            value={bioEditValue}
                            onChange={(e) => setBioEditValue(e.target.value)}
                            className="w-full bg-slate-950 border border-purple-500/30 rounded-xl p-2.5 text-xs text-slate-200 outline-none focus:border-purple-500 text-right h-16 resize-none font-sans"
                            placeholder="اكتب شيئاً جميلاً يعبر عنك..."
                            maxLength={120}
                          />
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => setIsEditingBio(false)}
                              className="bg-slate-800 text-slate-400 text-[10px] font-bold px-3 py-1 rounded-lg cursor-pointer"
                            >
                              إلغاء
                            </button>
                            <button
                              onClick={handleSaveBio}
                              className="bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-black px-4 py-1 rounded-lg cursor-pointer shadow-md"
                            >
                              حفظ التغييرات
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex justify-between items-start gap-2">
                          {currentUser?.id === selectedProfileUser.id && (
                            <button
                              onClick={() => {
                                setIsEditingBio(true);
                                setBioEditValue(selectedProfileUser.bio || '');
                              }}
                              className="text-[9px] text-purple-400 hover:underline cursor-pointer"
                            >
                              تعديل ✍️
                            </button>
                          )}
                          <p className="text-[11px] text-slate-300 italic leading-relaxed text-right flex-grow">
                            {selectedProfileUser.bio || 'لا توجد سيرة ذاتية مكتوبة حالياً.'}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Send Message Option */}
                    {currentUser && selectedProfileUser.id !== currentUser.id && (
                      <button
                        onClick={() => {
                          setIsProfileModalOpen(false);
                          setActivePrivateChatUser(selectedProfileUser);
                          setIsPrivateInboxOpen(true);
                        }}
                        className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white py-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer"
                      >
                        <MessageSquare className="w-4 h-4 text-white" />
                        إرسال رسالة خاصة مشفرة (E2EE Chat) 🔒
                      </button>
                    )}

                    {/* Integrated Host Controls for the seat if seated in Room */}
                    {(() => {
                      if (!activeRoom || !currentUser) return null;
                      const seatedSeat = activeRoom.seats.find(s => s.userId === selectedProfileUser.id);
                      if (!seatedSeat) return null;

                      const isHost = activeRoom.seats[0].userId === currentUser.id;
                      const isSelf = selectedProfileUser.id === currentUser.id;

                      if (!isHost && !isSelf) return null;

                      return (
                        <div className="border-t border-purple-950/40 pt-4 space-y-2">
                          <span className="text-[9px] text-purple-400 font-bold block text-right">⚙️ خيارات المقعد رقم {seatedSeat.index + 1}:</span>
                          <div className="flex gap-2">
                            {isHost && (
                              <>
                                <button
                                  onClick={() => {
                                    setSelectedSeatIndex(seatedSeat.index);
                                    handleHostAction('mute');
                                    setIsProfileModalOpen(false);
                                  }}
                                  className="w-1/2 bg-[#03000a] border border-slate-800 text-[10px] py-1.5 rounded-lg text-slate-300 font-bold cursor-pointer hover:bg-slate-900 transition text-center"
                                >
                                  {seatedSeat.isMuted ? '🔊 تفعيل الصوت' : '🔇 كتم الصوت'}
                                </button>
                                <button
                                  onClick={() => {
                                    setSelectedSeatIndex(seatedSeat.index);
                                    handleHostAction('lock');
                                    setIsProfileModalOpen(false);
                                  }}
                                  className="w-1/2 bg-[#03000a] border border-slate-800 text-[10px] py-1.5 rounded-lg text-amber-400 font-bold cursor-pointer hover:bg-slate-900 transition text-center"
                                >
                                  {seatedSeat.isLocked ? '🔓 إلغاء القفل' : '🔒 قفل المقعد'}
                                </button>
                              </>
                            )}
                            {isSelf && (
                              <button
                                onClick={() => {
                                  setSelectedSeatIndex(seatedSeat.index);
                                  handleHostAction('leave');
                                  setIsProfileModalOpen(false);
                                }}
                                className="w-full bg-red-950/40 border border-red-500/25 text-[10px] py-1.5 rounded-lg text-red-400 font-bold cursor-pointer hover:bg-red-900/40 transition text-center"
                              >
                                🚪 النزول من المقعد للجمهور
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                  </div>
                </div>
              )}

              {/* 💬 PREMIUM PRIVATE MESSAGING CHAT DRAWER */}
              {isPrivateInboxOpen && activePrivateChatUser && currentUser && (
                <div className="absolute inset-0 bg-black/75 backdrop-blur-xs z-50 flex items-end justify-center animate-fade-in text-right">
                  <div className="bg-[#0c081d] border-t border-purple-500/30 p-5 rounded-t-[32px] w-full max-h-[85%] flex flex-col font-sans space-y-4 shadow-2xl relative">
                    
                    {/* Decorative golden accent bar */}
                    <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-purple-500 via-amber-500 to-purple-500" />

                    {/* Header info */}
                    <div className="flex justify-between items-center border-b border-purple-950/40 pb-2.5">
                      <button
                        onClick={() => {
                          setIsPrivateInboxOpen(false);
                          setActivePrivateChatUser(null);
                          setNewPrivateMessageInput('');
                        }}
                        className="text-xs text-slate-400 hover:text-white bg-slate-900/60 px-3 py-1 rounded-full border border-slate-800/80 cursor-pointer"
                      >
                        إغلاق
                      </button>

                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <h4 className="text-xs font-black text-white">{activePrivateChatUser.name}</h4>
                          <span className="text-[7.5px] bg-purple-900/50 text-purple-300 font-bold px-1.5 py-0.5 rounded border border-purple-800/30">
                            LV.{activePrivateChatUser.level}
                          </span>
                        </div>
                        <img
                          src={activePrivateChatUser.avatar || "https://api.dicebear.com/7.x/adventurer/svg?seed=placeholder"}
                          alt=""
                          className="w-8 h-8 rounded-full object-cover border border-purple-500/20 shadow"
                        />
                      </div>
                    </div>

                    {/* E2EE Info Callout */}
                    <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-xl p-2.5 flex justify-between items-center text-[10px] text-emerald-400">
                      <div className="flex items-center gap-1 font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                        <span>نشط</span>
                      </div>
                      <span className="font-sans font-bold">🔒 المحادثة مشفرة بالكامل بطرفية آمنة (E2EE)</span>
                    </div>

                    {/* Messages Feed */}
                    <div className="flex-grow overflow-y-auto space-y-3 p-1 max-h-[380px] min-h-[250px] scrollbar-thin">
                      {(() => {
                        const filteredPrivateMessages = privateMessages.filter(msg => 
                          (msg.senderId === currentUser.id && msg.receiverId === activePrivateChatUser.id) ||
                          (msg.senderId === activePrivateChatUser.id && msg.receiverId === currentUser.id)
                        );

                        if (filteredPrivateMessages.length === 0) {
                          return (
                            <div className="text-center text-slate-500 py-16 text-xs font-sans">
                              💬 لا توجد رسائل سابقة مع هذا المستخدم. أرسل رسالة لبدء الدردشة الفورية المشفرة!
                            </div>
                          );
                        }

                        return filteredPrivateMessages.map((msg) => {
                          const isSelf = msg.senderId === currentUser.id;
                          return (
                            <div
                              key={msg.id || msg.timestamp}
                              className={`flex flex-col ${isSelf ? 'items-start text-left' : 'items-end text-right'} space-y-1`}
                            >
                              <div className="flex items-center gap-1">
                                <span className="text-[7px] text-slate-500 font-mono">
                                  {new Date(msg.timestamp).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                                <span className="text-[8px] font-bold text-slate-400">
                                  {isSelf ? 'أنت' : msg.senderName}
                                </span>
                              </div>

                              <div
                                className={`p-2.5 px-3.5 rounded-2xl max-w-[85%] text-xs shadow-sm font-sans ${
                                  isSelf
                                    ? 'bg-purple-600 text-white rounded-tl-none text-left'
                                    : 'bg-[#16102c] text-slate-100 rounded-tr-none text-right border border-purple-900/30'
                                }`}
                              >
                                {msg.isEncrypted ? (
                                  <div className="flex flex-col space-y-1">
                                    <div className="flex items-center gap-1 text-[8px] text-amber-300 font-black mb-1 justify-end">
                                      <span>🔐 مشفرة E2EE</span>
                                    </div>
                                    <EncryptedMessageText
                                      ciphertext={msg.rawCiphertext || msg.text}
                                      iv={msg.iv || ''}
                                      derivedKey={privateKey}
                                      showCiphertext={false}
                                      fallbackText="🔒 رسالة آمنة"
                                    />
                                  </div>
                                ) : (
                                  <span>{msg.text}</span>
                                )}
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>

                    {/* Input area */}
                    <div className="flex gap-2 items-center bg-[#03000a] p-2 rounded-xl border border-purple-950/40">
                      <button
                        onClick={() => {
                          if (newPrivateMessageInput.trim()) {
                            handleSendPrivateMessage();
                          }
                        }}
                        className="bg-purple-600 hover:bg-purple-500 text-white font-black text-xs px-4 py-2 rounded-lg cursor-pointer transition shadow-md shrink-0"
                      >
                        إرسال
                      </button>
                      
                      <input
                        type="text"
                        value={newPrivateMessageInput}
                        onChange={(e) => setNewPrivateMessageInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newPrivateMessageInput.trim()) {
                            handleSendPrivateMessage();
                          }
                        }}
                        className="flex-grow bg-transparent text-slate-200 text-xs text-right outline-none px-2 font-sans"
                        placeholder="اكتب رسالة خاصة مشفرة..."
                      />

                      <div className="flex items-center gap-1 text-[9px] text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-md border border-emerald-500/15 font-bold shrink-0">
                        <span>E2EE نشط</span>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      </div>
                    </div>

                  </div>
                </div>
              )}

            </div>

            {/* Smart Canvas End */}

          </div>

        </div>

      </main>

    </div>
  );
}
