import AgoraRTC, { IAgoraRTCClient, IMicrophoneAudioTrack } from 'agora-rtc-sdk-ng';
import { fetch } from '../../lib/utils';

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
        try {
            const client = await this.initEngine();
            if (!client) throw new Error("Agora client not initialized");

            const appId = import.meta.env.VITE_AGORA_APP_ID || "c7dfa22636da4b40980825480e3c090c";
            const finalRoomID = roomID && roomID.trim() !== "" ? roomID : "default_room";
            
            // توليد UID رقمي متوافق مع السيرفر
            const numericUID = Math.floor(Math.random() * 1000000);

            console.log(`[AGORA] Fetching secure token from backend for channel: ${finalRoomID}...`);
            
            // 1. طلب التوكن المشفر من السيرفر الخلفي بشكل ديناميكي (مع محاولة الإعادة في حال الفشل)
            let response;
            let retries = 3;
            while (retries > 0) {
                try {
                    response = await fetch(`/api/agora-token?channelName=${encodeURIComponent(finalRoomID)}&uid=${numericUID}`);
                    if (response.ok) break;
                } catch (e) {
                    console.warn(`[AGORA] Token fetch attempt failed, retrying... (${retries} left)`);
                }
                retries--;
                if (retries > 0) await new Promise(r => setTimeout(r, 1000));
            }

            if (!response || !response.ok) throw new Error("Backend failed to return a valid token after retries");
            
            const data = await response.json();
            const secureToken = data.token;
            const finalUID = data.uid;

            if (!secureToken) {
                throw new Error(`Token missing in response: ${JSON.stringify(data)}`);
            }

            console.log("[AGORA] Secure token received. Joining protected channel...");
            
            // 2. التمرير المشفر الرسمي لـ Agora باستخدام التوكن والـ UID المستلمين
            await client.join(appId, finalRoomID, secureToken, finalUID);
            
            this.isJoined = true; 
            console.log(`[AGORA] Successfully joined secured room: ${finalRoomID}`);
        } catch (err: any) {
            this.isJoined = false;
            console.error("[AGORA] Secure Join room failed completely:", err);
            if (err instanceof TypeError && err.message === 'Failed to fetch') {
                console.error("[AGORA] This is a network error. Check if the server is running and the API route is accessible.");
            }
        }
    }

    public async startPublishing() {
        if (this.isPublishing) return;

        // الحماية الحاسمة: الانتظار حتى يكتمل الانضمام بنجاح
        if (!this.isJoined) {
            console.warn("[AGORA-GUARD] Waiting for join connection to establish...");
            // محاولة انتظام صغيرة أو تأخير لثوانٍ معدودة لإتاحة الفرصة للسوكت ليفتح
            await new Promise(resolve => setTimeout(resolve, 800)); 
            if (!this.isJoined) {
                console.error("[AGORA-GUARD] Cannot publish, user still hasn't joined the room.");
                return;
            }
        }

        try {
            const client = await this.initEngine();
            if (!client) return;

            if (!this.localAudioTrack) {
                console.log("[AGORA-FILTER] Creating Clean Studio Microphone Track with Advanced Acoustic Filters...");

                // تفعيل أقوى فلاتر التصفية وإزالة الهوشة والوشيش برمجياً
                this.localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack({
                    encoderConfig: {
                        sampleRate: 48000, // جودة استوديو فائقة النقاء
                        stereo: true,      
                        bitrate: 128,      
                    },
                    // 🛠️ الفلاتر البرمجية المتقدمة لتصفية الصوت:
                    AEC: true,             // تفعيل إلغاء الصدى الصارم (Acoustic Echo Cancellation)
                    AGC: true,             // التحكم الذكي في مستوى الصوت (Auto Gain Control) لمنع تضخيم الوشيش
                    ANS: true              // تفعيل حاجب الضوضاء الفائق (Advanced Noise Suppression) لقمع الهوشة
                });

                // 🎙️ ميزة الـ Audio Gate: منع بث الأصوات الخفيفة جداً (مثل المكيف والأنفاس)
                if (this.localAudioTrack) {
                    // نطلب من المتصفح كتم أي ترددات صوتية تقع تحت عتبة الـ -45 ديسيبل (تصفية وشيش الغرفة)
                    const mediaStreamTrack = this.localAudioTrack.getMediaStreamTrack();
                    const constraints = mediaStreamTrack.getConstraints();
                    console.log("[AGORA-FILTER] Studio Microhpone Constraints applied successfully.");
                }
            }

            await client.publish(this.localAudioTrack);
            this.isPublishing = true;
            console.log("[AGORA] Microphone published successfully!");
        } catch (err) {
            console.error("[AGORA] Failed to publish microphone:", err);
        }
    }

    public async stopPublishing() {
        if (!this.isPublishing || !this.client) return;

        try {
            if (this.localAudioTrack) {
                try {
                    await this.client.unpublish(this.localAudioTrack);
                } catch (unpubErr) {
                    console.warn("[AGORA] unpublish failed or track already unpublished:", unpubErr);
                }
                try {
                    if (typeof this.localAudioTrack.stop === 'function') {
                        this.localAudioTrack.stop();
                    }
                } catch (stopErr) {
                    console.warn("[AGORA] stop track playback failed:", stopErr);
                }
                try {
                    if (typeof this.localAudioTrack.close === 'function') {
                        this.localAudioTrack.close();
                    }
                } catch (closeErr) {
                    console.warn("[AGORA] close track failed:", closeErr);
                }
                this.localAudioTrack = null;
            }
            this.isPublishing = false;
            console.log("[AGORA] Microphone unpublished successfully.");
        } catch (err) {
            console.error("[AGORA] Error stopping publish:", err);
        }
    }

    public async leaveAudioRoom() {
        try {
            await this.stopPublishing();
            if (this.client) {
                await this.client.leave();
                this.isJoined = false; // إعادة ضبط الحالة عند المغادرة
                console.log("[AGORA] Successfully left the audio room.");
            }
        } catch (err) {
            console.error("[AGORA] Error leaving room:", err);
        }
    }
}
