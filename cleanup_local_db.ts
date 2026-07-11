import { getDb, saveDb } from './server/db';

const db = getDb();
const dummyNames = ["حليبي", "ليبي", "سهرة الطرب الأصيل"];
const initialLen = db.rooms.length;
db.rooms = db.rooms.filter(r => !dummyNames.includes(r.name));
saveDb(db);
console.log(`Cleanup complete. Removed ${initialLen - db.rooms.length} rooms.`);
