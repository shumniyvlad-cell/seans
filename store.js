/* ============================================================
   СЕАНС — слой данных.
   config.js = исходник (сид). Правки из админки живут в localStorage
   ПОВЕРХ него: STORE.data — то, что реально рендерит сайт.
   «Сбросить правки» в админке удаляет надстройку и возвращает config.
   ============================================================ */
(() => {
  "use strict";
  const LS = "seans_admin_v1";
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const data = clone(window.CONFIG);

  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS) || "null"); } catch (e) { saved = null; }
  if (saved && typeof saved === "object") {
    // пустой массив — тоже валидная правка (админ убрал все фильмы), не отбрасываем
    if (Array.isArray(saved.votingOptions)) data.voting.options = saved.votingOptions;
    if (Array.isArray(saved.menu)) data.menu = saved.menu;
    if (Array.isArray(saved.schedule)) data.schedule = saved.schedule;
    // раунд голосования: { closesAt: ISO, done: bool } — задаётся в админке
    if (saved.votingRound && typeof saved.votingRound === "object") data.votingRound = saved.votingRound;
    if (saved.donation && typeof saved.donation === "object") data.donation = Object.assign({}, data.donation, saved.donation);
    // votingMeta/hero НЕ восстанавливаем: у админки нет UI под них,
    // пусть правятся только через config.js (иначе правки конфига «не доходят»)
  }

  // стабильные id строк расписания (к ним привязаны брони).
  // Без индекса массива: перестановка строк в config.js не должна менять id
  (data.schedule || []).forEach((s) => {
    if (!s.id) s.id = (s.day + "-" + s.date + "-" + s.time + "-" + (s.title || "")).replace(/\s+/g, "_");
  });

  const listeners = [];
  function persist() {
    // сохраняем только то, что реально редактируется в админке
    localStorage.setItem(LS, JSON.stringify({
      votingOptions: data.voting.options,
      menu: data.menu,
      schedule: data.schedule,
      votingRound: data.votingRound || null,
      donation: data.donation || null,
    }));
  }

  window.STORE = {
    data,
    save() {
      persist();
      listeners.forEach((f) => { try { f(); } catch (e) { /* один слушатель не роняет остальных */ } });
    },
    onChange(f) { listeners.push(f); },
    reset() { localStorage.removeItem(LS); },
    // бэкап всего состояния сайта (правки + голоса + брони + корзина)
    exportAll() {
      const dump = {};
      Object.keys(localStorage).filter((k) => k.startsWith("seans_")).forEach((k) => { dump[k] = localStorage.getItem(k); });
      return dump;
    },
    importAll(dump) {
      if (!dump || typeof dump !== "object") throw new Error("bad dump");
      const entries = Object.entries(dump).filter(([k, v]) => k.startsWith("seans_") && typeof v === "string");
      if (!entries.length) throw new Error("bad dump");            // мусорный файл — не трогаем текущее
      // восстановление, а не слияние: сначала чистим все свои ключи
      Object.keys(localStorage).filter((k) => k.startsWith("seans_")).forEach((k) => localStorage.removeItem(k));
      entries.forEach(([k, v]) => localStorage.setItem(k, v));
    },
  };
})();
