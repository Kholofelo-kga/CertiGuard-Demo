/* CertiGuard v2 - Data service (persistence + hash-chained audit log).
   Persistence: browser localStorage (falls back to memory if blocked). */
(function (G) {
  "use strict";
  const K = { users: "cg.users", records: "cg.records", requests: "cg.requests", audit: "cg.audit" };
  const mem = {};
  function rd(k) {
    try { const v = localStorage.getItem(k); if (v !== null) return JSON.parse(v); } catch (e) { /* blocked */ }
    return mem[k] !== undefined ? JSON.parse(mem[k]) : null;
  }
  function wr(k, v) {
    const s = JSON.stringify(v);
    mem[k] = s;
    try { localStorage.setItem(k, s); } catch (e) { /* storage full or blocked: memory copy kept */ }
  }
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
    init() {
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
    resetAll() { Object.values(K).forEach(k => { delete mem[k]; try { localStorage.removeItem(k); } catch (e) { } }); Store.init(); }
  };
  G.CG = G.CG || {}; G.CG.Store = Store;
})(window);
