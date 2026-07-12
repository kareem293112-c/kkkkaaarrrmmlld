import AgoraRTC, { IAgoraRTCClient, IMicrophoneAudioTrack } from 'agora-rtc-sdk-ng';
import { fetch } from '../../lib/utils';
import { RtcTokenBuilder, RtcRole } from 'agora-access-token';

export class AgoraEngineManager {
    private static instance: AgoraEngineManager | null = null;
    private client: IAgoraRTCClient | null = null;
    private localAudioTrack: IMicrophoneAudioTrack | null = null;
    public isPublishing = false;
    private volumeCallback: ((volumes: { uid: string; level: number }[]) => void) | null = null;
    // 1. إضافة متغير لمتابعة حالة الانضمام الفعلية
    private isJoined = false;
    private audioCtx?: AudioContext;

    private constructor() {}
    
    // إجبار محرك الصوت على العمل في الخلفية وعند قفل الشاشة
    public setupBackgroundAudio() {
        if (typeof document === 'undefined') return;

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log("[AGORA-BACKGROUND] Page hidden. Preventing audio freeze...");
                // منع المتصفح من عمل suspend لـ AudioContext
                if (this.audioCtx && this.audioCtx.state === 'suspended') {
                    this.audioCtx.resume();
                }
            } else {
                console.log("[AGORA-BACKGROUND] Page visible. Ensuring audio track is active.");
                if (this.audioCtx && this.audioCtx.state === 'suspended') {
                    this.audioCtx.resume();
                }
            }
        });
    }

    public static getInstance(): AgoraEngineManager {
        if (!AgoraEngineManager.instance) {
            AgoraEngineManager.instance = new AgoraEngineManager();
        }
        return AgoraEngineManager.instance;
    }

    public onVolumeIndicator(callback: (volumes: { uid: string; level: number }[]) => void) {
        this.volumeCallback = callback;
    }

    public async initEngine(): Promise<IAgoraRTCClient | null> {
        if (this.client) return this.client;
        
        this.setupBackgroundAudio();

        try {
            // إنشاء كائن الاتصال الجماعي لغرف الصوت
            this.client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
            console.log("[AGORA] Engine initialized successfully.");

            // تفعيل مؤشرات الصوت وتتبع المتحدث النشط
            this.client.enableAudioVolumeIndicator();
            this.client.on('volume-indicator', (volumes) => {
                if (this.volumeCallback) {
                    this.volumeCallback(volumes.map(v => ({ uid: String(v.uid), level: v.level })));
                }
            });
            
            // الاستماع التلقائي لأصوات الأعضاء الآخرين وتشغيلها فوراً وبأعلى جودة
            this.client.on('user-published', async (user, mediaType) => {
                if (mediaType === 'audio') {
                    console.log("[AGORA] New remote audio stream detected from user:", user.uid);
                    await this.client!.subscribe(user, mediaType);
                    if (user.audioTrack) {
                        user.audioTrack.play(); // تشغيل الصوت تلقائياً
                    }
                }
            });

            this.client.on('user-unpublished', async (user, mediaType) => {
                if (mediaType === 'audio') {
                    console.log("[AGORA] Remote user stopped audio:", user.uid);
                }
            });

            return this.client;
        } catch (err) {
            console.error("[AGORA] Failed to init Agora:", err);
            return null;
        }
    }

    public async joinAudioRoom(roomID: string, userID: string) {
        if (this.isJoined) return;
        try {
            const client = await this.initEngine();
            if (!client) throw new Error("Agora client not initialized");

            const appId = import.meta.env.VITE_AGORA_APP_ID || "c7dfa22636da4b40980825480e3c090c";
            const appCertificate = import.meta.env.VITE_AGORA_APP_CERTIFICATE || "";
            const finalRoomID = roomID.trim() || "default_room";
            
            let token = null;
            if (appCertificate) {
                const role = RtcRole.PUBLISHER;
                const privilegeExpiredTs = Math.floor(Date.now() / 1000) + 3600;
                // Pass userID as string (account) for consistent matching
                token = RtcTokenBuilder.buildTokenWithAccount(appId, appCertificate, finalRoomID, userID, role, privilegeExpiredTs);
                console.log(`[AGORA] Local token generated for channel: ${finalRoomID}`);
            } else {
                console.log(`[AGORA] Joining ${finalRoomID} (Testing Mode - Null Token)...`);
            }
            
            await client.join(appId, finalRoomID, token, userID);
            this.isJoined = true;
            console.log(`[AGORA] Successfully joined room: ${finalRoomID} with UID: ${userID}`);

            // إنشاء وبث الميكروفون فوراً لضمان سماع الآخرين للصوت
            await this.startPublishing();
        } catch (err) {
            this.isJoined = false;
            console.error("[AGORA] Join failed:", err);
        }
    }

    public async startPublishing() {
        if (this.isPublishing || !this.isJoined || !this.client) return;
        this.isPublishing = true; // Mark as publishing to prevent concurrent calls
        try {
            if (!this.localAudioTrack) {
                this.localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack({ AEC: true, ANS: true, AGC: true });
            }
            const localTracks = this.client.localTracks || [];
            const isAlreadyPublished = this.localAudioTrack && localTracks.some(t => t.getTrackId() === this.localAudioTrack!.getTrackId());
            if (!isAlreadyPublished) {
                await this.client.publish([this.localAudioTrack]);
                console.log("[AGORA] Audio publishing started.");
            } else {
                console.log("[AGORA] Track is already published, skipping.");
            }
        } catch (e) {
            this.isPublishing = false;
            console.error("[AGORA] Publishing failed:", e);
        }
    }

    public async stopPublishing() {
        if (!this.isPublishing || !this.client || !this.localAudioTrack) return;
        this.isPublishing = false; // Mark as not publishing immediately
        try {
            const localTracks = this.client.localTracks || [];
            const isAlreadyPublished = localTracks.some(t => t.getTrackId() === this.localAudioTrack!.getTrackId());
            if (isAlreadyPublished) {
                await this.client.unpublish([this.localAudioTrack]);
            }
            this.localAudioTrack.stop();
            this.localAudioTrack.close();
            this.localAudioTrack = null;
        } catch (e) {
            console.error("[AGORA] Stop failed:", e);
        }
    }

    public async leaveAudioRoom() {
        try {
            await this.stopPublishing();
            if (this.client) {
                this.client.removeAllListeners(); // Clean up all listeners to avoid memory leaks
                await this.client.leave();
                this.client = null;
                this.isJoined = false;
                console.log("[AGORA] Successfully left the audio room.");
            }
        } catch (err) {
            console.error("[AGORA] Error leaving room:", err);
        }
    }
}
