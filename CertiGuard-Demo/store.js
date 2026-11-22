/* CertiGuard v3 - Data service (persistence + hash-chained audit log + encryption at rest).
   Persistence: browser localStorage, every store encrypted with AES-GCM-256 (NFR-04, Assignment 5).
   The key is generated in the browser as a NON-EXTRACTABLE CryptoKey and kept in IndexedDB, so page scripts can use it
   but cannot read it out; localStorage only ever holds ciphertext. Reads come from a decrypted in-memory copy loaded once by init().
   If IndexedDB or Web Crypto is unavailable the data service falls back to plaintext and reports it (Store.encrypted = false).
   A store whose ciphertext was altered fails AES-GCM authentication on load: it is set aside under "<key>.corrupt" and reported. */
(function (G) {
  "use strict";
  const K = { users: "cg.users", records: "cg.records", requests: "cg.requests", audit: "cg.audit" };
  const ENC = "cgenc1:";
  const mem = {}, chains = {};
  let key = null;
  const b64 = u8 => btoa(String.fromCharCode(...u8)), unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  function idbKey() {
    return new Promise((res, rej) => {
      const rq = indexedDB.open("certiguard", 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore("keys");
      rq.onerror = () => rej(rq.error);
      rq.onsuccess = () => {
        const db = rq.result, get = db.transaction("keys").objectStore("keys").get("storage");
        get.onerror = () => rej(get.error);
        get.onsuccess = async () => {
          if (get.result) return res(get.result);
          try {
            const k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
            const put = db.transaction("keys", "readwrite").objectStore("keys").put(k, "storage");
            put.onsuccess = () => res(k); put.onerror = () => rej(put.error);
          } catch (e) { rej(e); }
        };
      };
    });
  }
  async function encrypt(text) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text)));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return ENC + b64(out);
  }
  async function decrypt(raw) {
    const all = unb64(raw.slice(ENC.length));
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, key, all.slice(12)));
  }
  function persist(k) {   // writes are queued per store so they reach localStorage in order
    chains[k] = (chains[k] || Promise.resolve()).then(async () => {
      try { if (mem[k] === undefined) localStorage.removeItem(k); else localStorage.setItem(k, key ? await encrypt(mem[k]) : mem[k]); } catch (e) { /* storage full or blocked: memory copy kept */ }
    });
    return chains[k];
  }
  function rd(k) { return mem[k] !== undefined ? JSON.parse(mem[k]) : null; }
  function wr(k, v) { mem[k] = JSON.stringify(v); persist(k); }
  const hex = buf => [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, "0")).join("");
  async function sha256(text) {
    return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  }

  // Seed data. Passwords are stored only as salted PBKDF2-SHA256 hashes (100 000 iterations).
  const SEED_USERS = [
    { email: "administrator@certiguard.demo", name: "Admin Demo", role: "Administrator",
      salt: "e5381e53e867cde7a5a332e0b08f8f88", hash: "6eb08b183d168e5e075b7321e6c4f676671f76f2fdf5a31fe558815423b8fd06" },
    { email: "officer@certiguard.demo", name: "Officer Demo", role: "Verification Officer",
      salt: "b1f8fdb400dc767be90d96ba68a679f0", hash: "c622f792c76bbf336df151bb2329ef3151374db65c832b5ce9bb25daaa9eae02" }
  ];
  const SRC = "Fictional sample record (not an authoritative institution source)";
  const SEED_RECORDS = [
    { number: "TUT-2026-10482", name: "Lerato Mokoena", qualification: "Diploma in Information Technology", institution: "Tshwane University of Technology", date: "2026-05-15", status: "Active", source: SRC },
    { number: "UL-2025-77821", name: "Thando Ndlovu", qualification: "Bachelor of Information Science", institution: "University of Limpopo", date: "2025-12-10", status: "Active", source: SRC },
    { number: "UJ-2024-33105", name: "Sipho Dlamini", qualification: "BSc Computer Science", institution: "University of Johannesburg", date: "2024-12-12", status: "Active", source: SRC },
    { number: "WITS-2023-55012", name: "Naledi Khumalo", qualification: "BCom Accounting", institution: "University of the Witwatersrand", date: "2023-12-08", status: "Active", source: SRC },
    { number: "UP-2025-90417", name: "Pieter van Wyk", qualification: "Bachelor of Engineering Electrical", institution: "University of Pretoria", date: "2025-12-11", status: "Active", source: SRC }
  ];

  const Store = {
    encrypted: false, loadErrors: [],
    async init() {
      try { key = await idbKey(); Store.encrypted = true; } catch (e) { key = null; Store.encrypted = false; }
      for (const k of Object.values(K)) {
        let raw = null; try { raw = localStorage.getItem(k); } catch (e) { }
        if (raw === null) continue;
        if (raw.startsWith(ENC)) {
          try { if (!key) throw new Error("no key"); mem[k] = await decrypt(raw); }
          catch (e) { Store.loadErrors.push(k); try { localStorage.setItem(k + ".corrupt", raw); } catch (x) { } }
        } else { try { JSON.parse(raw); mem[k] = raw; if (key) persist(k); } catch (e) { Store.loadErrors.push(k); } }   // plaintext from an older version: migrated
      }
      Store.seed();
    },
    flush: () => Promise.all(Object.values(chains)),   // resolves when every queued write has reached localStorage
    seed() {
      if (!rd(K.users)) wr(K.users, SEED_USERS);
      if (!rd(K.records)) wr(K.records, SEED_RECORDS);
      if (!rd(K.requests)) wr(K.requests, []);
      if (!rd(K.audit)) wr(K.audit, []);
    },
    sha256,
    users: () => rd(K.users) || [],
    records: () => rd(K.records) || [],
    findRecord: n => (rd(K.records) || []).find(r => r.number.toUpperCase() === String(n).toUpperCase()),
    addRecord(rec) {
      const all = Store.records();
      if (all.some(r => r.number.toUpperCase() === rec.number.toUpperCase())) throw new Error("DUPLICATE");
      all.push(rec); wr(K.records, all);
    },
    // FR-11 update: replaces the record identified by oldNumber; the (possibly new) number must stay unique
    updateRecord(oldNumber, rec) {
      const all = Store.records(); const i = all.findIndex(r => r.number === oldNumber);
      if (i < 0) throw new Error("NOT_FOUND");
      if (all.some((r, j) => j !== i && r.number.toUpperCase() === rec.number.toUpperCase())) throw new Error("DUPLICATE");
      all[i] = { ...all[i], ...rec }; wr(K.records, all); return all[i];
    },
    setRecordStatus(number, status) {
      const all = Store.records(); const r = all.find(x => x.number === number);
      if (r) { r.status = status; wr(K.records, all); }
    },
    requests: () => rd(K.requests) || [],
    saveRequest(req) { const all = Store.requests(); all.unshift(req); wr(K.requests, all.slice(0, 200)); },
    updateRequest(id, patch) {
      const all = Store.requests(); const r = all.find(x => x.id === id);
      if (r) { Object.assign(r, patch); wr(K.requests, all); }
    },
    audit: () => rd(K.audit) || [],
    // Each entry stores SHA-256(prevHash | fields): editing or deleting an old entry breaks the chain.
    async appendAudit(user, action, certId, outcome, details) {
      const all = Store.audit();
      const prev = all.length ? all[0].hash : "GENESIS";
      const ts = new Date().toISOString();
      const entry = { ts, user, action, certId: certId || "-", outcome: outcome || "-", details: details || "-", prev };
      entry.hash = await sha256([prev, ts, user, action, entry.certId, entry.outcome, entry.details].join("|"));
      all.unshift(entry);
      wr(K.audit, all.slice(0, 500));
      return entry;
    },
    async verifyAuditChain() {
      const all = Store.audit().slice().reverse(); // oldest first
      let prev = "GENESIS";
      for (let i = 0; i < all.length; i++) {
        const e = all[i];
        const h = await sha256([e.prev, e.ts, e.user, e.action, e.certId, e.outcome, e.details].join("|"));
        if (e.prev !== prev || h !== e.hash) return { ok: false, badIndex: i, total: all.length };
        prev = e.hash;
      }
      return { ok: true, total: all.length };
    },
    resetAll() { Object.values(K).forEach(k => { delete mem[k]; persist(k); }); Store.loadErrors = []; Store.seed(); },
    // test hook (used only by tests/run-tests.js): replace a decrypted store as if it had been edited, then persist it
    _debugReplace(name, value) { wr(K[name], value); return Store.flush(); }
  };
  G.CG = G.CG || {}; G.CG.Store = Store;
})(window);
