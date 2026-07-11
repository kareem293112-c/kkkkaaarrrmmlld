import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = "gen-lang-client-0348881645";
const customDbId = "ai-studio-sadaalarabvoiceb-5f452604-580f-4265-ab18-da9c404b3698";

const app = initializeApp({
  credential: applicationDefault(),
  projectId: projectId
});

const db = getFirestore(app, customDbId);

async function cleanup() {
  const roomsSnap = await db.collection("voice_rooms").get();
  
  const dummyNames = ["حليبي", "ليبي", "سهرة الطرب الأصيل"];
  
  for (const doc of roomsSnap.docs) {
    const data = doc.data();
    const roomName = data.room_name || data.name || "";
    
    if (dummyNames.includes(roomName)) {
      console.log(`Deleting room: ${roomName} (ID: ${doc.id})`);
      await doc.ref.delete();
    }
  }
  
  console.log("Cleanup complete.");
}

cleanup().catch(console.error);
