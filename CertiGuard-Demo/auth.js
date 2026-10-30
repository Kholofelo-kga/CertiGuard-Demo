/* CertiGuard v2 - Authentication and role-based access control (client-side demonstration). */
(function (G) {
  "use strict";
  const { Store } = G.CG;
  const ITER = 100000, MAX_FAILS = 3, LOCK_MS = 30000, IDLE_MS = 15 * 60 * 1000;
  const PERMS = {
    "Verification Officer": ["verify", "records.read", "history"],
    "Administrator": ["verify", "records.read", "records.write", "override", "audit", "history"]
  };
  const unhex = h => new Uint8Array(h.match(/../g).map(b => parseInt(b, 16)));
  const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
  async function pbkdf2(pw, saltHex) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
    return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unhex(saltHex), iterations: ITER }, key, 256));
  }
  function ctEq(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
  let fails = 0, lockedUntil = 0;
  const Auth = {
    session() {
      try {
        const s = JSON.parse(sessionStorage.getItem("cg.session") || "null");
        if (!s) return null;
        if (Date.now() - s.last > IDLE_MS) { sessionStorage.removeItem("cg.session"); return null; }
        s.last = Date.now(); sessionStorage.setItem("cg.session", JSON.stringify(s)); return s;
      } catch (e) { return null; }
    },
    can(p) { const s = Auth.session(); return !!s && PERMS[s.role].includes(p); },
    async login(email, pw) {
      email = String(email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, msg: "Enter a valid email address." };
      if (!pw) return { ok: false, msg: "Enter your password." };
      if (Date.now() < lockedUntil) return { ok: false, msg: "Too many failed attempts. Try again in " + Math.ceil((lockedUntil - Date.now()) / 1000) + " s." };
      const u = Store.users().find(x => x.email === email);
      // Always run the key derivation, so response time does not reveal whether the account exists.
      const h = await pbkdf2(pw, u ? u.salt : "00000000000000000000000000000000");
      if (u && ctEq(h, u.hash)) {
        fails = 0;
        sessionStorage.setItem("cg.session", JSON.stringify({ email: u.email, name: u.name, role: u.role, last: Date.now() }));
        await Store.appendAudit(u.email, "Login", "-", "Success", "Role: " + u.role);
        return { ok: true };
      }
      fails++;
      await Store.appendAudit(email.slice(0, 80), "Login failed", "-", "Rejected", "Attempt " + fails + " of " + MAX_FAILS);
      if (fails >= MAX_FAILS) { lockedUntil = Date.now() + LOCK_MS; fails = 0; return { ok: false, msg: "Too many failed attempts. Locked for 30 seconds." }; }
      return { ok: false, msg: "Invalid email or password." }; // same message for unknown account and wrong password
    },
    async logout() { const s = Auth.session(); if (s) await Store.appendAudit(s.email, "Logout", "-", "Success", "-"); sessionStorage.removeItem("cg.session"); }
  };
  G.CG.Auth = Auth;
})(window);
