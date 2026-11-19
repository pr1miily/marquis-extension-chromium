// Marquis media store (IndexedDB), shared by background.js (importScripts), preview.html and recorder.html.
// Binary Blobs stay out of chrome.storage (base64 + JSON) entirely.
//   captures          { id, type: 'visible'|'full'|'region', createdAt, title, url, width, height, blob: PNG, thumb: JPEG }  newest 20 kept
//   recordings        { id, createdAt, source: 'screen'|'camera', durationMs, mimeType, size, blob, recovered? }          newest 10 kept
//   recording_chunks  { session, seq, blob, mimeType, startedAt, source }  1 s MediaRecorder slices, key [session, seq].
//                     Chunks are deleted once their recording is saved, so a session still here was interrupted.
const MarquisDB = (() => {
    const DB_NAME = 'marquis-captures';
    let dbPromise = null;
    const done = req => new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    function open() {
        if (!dbPromise) {
            const req = indexedDB.open(DB_NAME, 2);
            req.onupgradeneeded = (e) => { // additive only: existing captures are kept
                const db = req.result;
                if (e.oldVersion < 1) db.createObjectStore('captures', { keyPath: 'id', autoIncrement: true });
                if (e.oldVersion < 2) {
                    db.createObjectStore('recordings', { keyPath: 'id', autoIncrement: true });
                    db.createObjectStore('recording_chunks', { keyPath: ['session', 'seq'] });
                }
            };
            dbPromise = done(req).then((db) => {
                db.onversionchange = () => { db.close(); dbPromise = null; }; // let a newer page upgrade
                return db;
            }).catch((err) => { dbPromise = null; throw err; });
        }
        return dbPromise;
    }

    async function store(name, mode) {
        return (await open()).transaction(name, mode).objectStore(name);
    }

    // add / get / latest / list (newest first) / remove, keeping only the newest `keep` records.
    function collection(name, keep) {
        return {
            async add(record) {
                const id = await done((await store(name, 'readwrite')).add(record));
                const s = await store(name, 'readwrite');
                const keys = await done(s.getAllKeys()); // ascending = oldest first
                keys.slice(0, Math.max(0, keys.length - keep)).forEach(k => s.delete(k));
                return id;
            },
            async get(id) {
                return done((await store(name, 'readonly')).get(id));
            },
            async latest() {
                const cursor = await done((await store(name, 'readonly')).openCursor(null, 'prev'));
                return cursor ? cursor.value : undefined;
            },
            async list() {
                return (await done((await store(name, 'readonly')).getAll())).reverse();
            },
            async remove(id) {
                return done((await store(name, 'readwrite')).delete(id));
            }
        };
    }

    return { done, store, collection };
})();

const CaptureStore = MarquisDB.collection('captures', 20);

const RecordingStore = Object.assign(MarquisDB.collection('recordings', 10), {
    async putChunk(chunk) {
        return MarquisDB.done((await MarquisDB.store('recording_chunks', 'readwrite')).put(chunk));
    },
    async chunks(session) { // in seq order (key order)
        const range = IDBKeyRange.bound([session, -Infinity], [session, Infinity]);
        return MarquisDB.done((await MarquisDB.store('recording_chunks', 'readonly')).getAll(range));
    },
    async dropChunks(session) {
        const range = IDBKeyRange.bound([session, -Infinity], [session, Infinity]);
        return MarquisDB.done((await MarquisDB.store('recording_chunks', 'readwrite')).delete(range));
    },
    async interruptedSessions() { // [{ session, count, startedAt, source }]
        const keys = await MarquisDB.done((await MarquisDB.store('recording_chunks', 'readonly')).getAllKeys());
        const sessions = new Map(); // session -> { count, firstKey }
        keys.forEach((key) => {
            const s = sessions.get(key[0]) || { count: 0, firstKey: key };
            s.count++;
            sessions.set(key[0], s);
        });
        const out = [];
        for (const [session, { count, firstKey }] of sessions) {
            const first = await MarquisDB.done((await MarquisDB.store('recording_chunks', 'readonly')).get(firstKey));
            out.push({ session, count, startedAt: first?.startedAt, source: first?.source });
        }
        return out;
    }
});
