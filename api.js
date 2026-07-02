/* ============================================================
   СЕАНС — клиент общего счёта (window.SEANS_API).
   Сервер задаётся в config.js → api. Если сервер недоступен,
   сайт молча живёт на localStorage (как раньше).
   ============================================================ */
(() => {
  "use strict";
  const C = (window.STORE && window.STORE.data) || window.CONFIG;
  const BASE = (localStorage.getItem("seans_api_override") || (C && C.api) || "").replace(/\/+$/, "");

  const LS_DEV = "seans_device_v1";
  let device = localStorage.getItem(LS_DEV);
  if (!device) {
    device = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(LS_DEV, device);
  }

  async function post(path, body, pin) {
    const headers = { "Content-Type": "application/json" };
    if (pin) headers["X-Pin"] = pin;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);   // сервер молчит — быстро падаем в локальный режим
    try {
      const r = await fetch(BASE + path, { method: "POST", headers, body: JSON.stringify(body || {}), signal: ctrl.signal });
      if (!r.ok) throw new Error("api " + r.status);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  const S = {
    enabled: !!BASE,
    ready: false,
    state: null,
    device,
    async refresh() {
      if (!BASE) return null;
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6000);
        const r = await fetch(`${BASE}/api/state?device=${encodeURIComponent(device)}`, { signal: ctrl.signal });
        clearTimeout(t);
        if (!r.ok) throw new Error("http " + r.status);
        S.state = await r.json();
        S.ready = true;
      } catch (e) {
        S.ready = false;   // сервер лёг — работаем локально, не шумим
      }
      return S.ready ? S.state : null;
    },
    vote: (optionId) => post("/api/vote", { device, optionId }),
    suggest: (title, name) => post("/api/suggest", { title, name }),
    book: (p) => post("/api/booking", Object.assign({ device }, p)),
    cancelBooking: (id) => post("/api/booking/cancel", { device, id }),
    order: (p) => post("/api/order", Object.assign({ device }, p)),
    publish: (content, pin) => post("/api/content", { content }, pin),
    finish: (pin) => post("/api/finish", {}, pin),
    async adminData(pin) {
      const r = await fetch(BASE + "/api/admin", { headers: { "X-Pin": pin } });
      if (!r.ok) throw new Error("api " + r.status);
      return r.json();
    },
    adminRemove: (what, id, pin) => post("/api/admin/remove", { what, id }, pin),
    adminClear: (what, pin) => post("/api/admin/clear", { what }, pin),
  };

  window.SEANS_API = S;
})();
