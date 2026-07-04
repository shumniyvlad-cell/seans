/* ============================================================
   СЕАНС — админка Влада.
   Вход: ⚙ в подвале или ?admin в адресе. PIN — config.js → admin.pin.
   Фильмы ищутся в iTunes (RU): название, год, жанр, режиссёр,
   описание и постер подтягиваются сами. Правки → localStorage
   поверх config.js (см. store.js), сайт перерисовывается сразу.
   ============================================================ */
(() => {
  "use strict";
  if (!window.STORE) return;
  const S = window.STORE, D = S.data;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const el = (t, c, h) => { const n = document.createElement(t); if (c) n.className = c; if (h != null) n.innerHTML = h; return n; };
  const money = (n) => (Number(n) || 0).toLocaleString("ru-RU") + " ₽";

  /* ---------- каркас панели ---------- */
  const panel = el("div", "adm");
  panel.innerHTML = `
    <div class="adm__scrim" data-close></div>
    <aside class="adm__panel" role="dialog" aria-modal="true" aria-label="Админ-панель">
      <div class="adm__head">
        <div><h3>Админка</h3><div class="adm__sub">правки сохраняются в этом браузере · «Данные» → бэкап</div></div>
        <button class="drawer__close" data-close aria-label="Закрыть">✕</button>
      </div>
      <div class="adm__tabs" id="admTabs"></div>
      <div class="adm__body" id="admBody"></div>
    </aside>`;
  document.body.appendChild(panel);

  const TABS = [["films", "Фильмы"], ["vote", "Голосование"], ["menu", "Меню"], ["sched", "Афиша"], ["books", "Брони"], ["orders", "Заказы"], ["data", "Данные"]];
  const tabsWrap = $("#admTabs", panel), body = $("#admBody", panel);
  let activeTab = "films";
  TABS.forEach(([id, label]) => {
    const b = el("button", "adm__tab", label);
    b.dataset.tab = id;
    b.addEventListener("click", () => { activeTab = id; renderTabs(); });
    tabsWrap.appendChild(b);
  });
  function renderTabs() {
    $$(".adm__tab", tabsWrap).forEach((b) => b.classList.toggle("on", b.dataset.tab === activeTab));
    ({ films: tabFilms, vote: tabVote, menu: tabMenu, sched: tabSched, books: tabBooks, orders: tabOrders, data: tabData })[activeTab]();
  }

  const open = () => { panel.classList.add("open"); renderTabs(); };
  const close = () => panel.classList.remove("open");
  $$("[data-close]", panel).forEach((n) => n.addEventListener("click", close));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  /* ---------- вход ----------
     PIN в коде сайта НЕ хранится — его знает только сервер (/opt/seans/.env).
     Введённый PIN проверяется запросом к серверу и живёт до закрытия вкладки.
     Без сервера (локальная разработка) — сверка с config.admin.pin, если задан. */
  let PIN = sessionStorage.getItem("seans_admin_pin") || "";
  const authed = () => !!PIN;
  async function checkPin(p) {
    const A = window.SEANS_API;
    if (A && A.enabled) {
      try { await A.adminData(p); return true; } catch (e) { return false; }
    }
    const local = String((D.admin && D.admin.pin) || "");
    return !local || p === local;
  }
  async function requestOpen() {
    if (authed()) return open();
    const p = prompt("PIN администратора:");
    if (p === null) return;
    if (await checkPin(p)) {
      PIN = p;
      sessionStorage.setItem("seans_admin_pin", p);
      open();
    } else {
      alert("Неверный PIN");
    }
  }
  const link = $("#adminLink");
  if (link) link.addEventListener("click", requestOpen);
  if (/[?#&]admin/.test(location.search + location.hash)) setTimeout(requestOpen, 400);

  // persist + сайт перерисуется сам (STORE.onChange) + публикация на сервер (соседи увидят)
  function contentSnapshot() {
    return {
      votingOptions: D.voting.options,
      menu: D.menu,
      schedule: D.schedule,
      votingRound: D.votingRound || null,
      donation: D.donation || null,
    };
  }
  let pubT = null;
  function publish() {
    const A = window.SEANS_API;
    if (!A || !A.enabled) return;
    clearTimeout(pubT);
    pubT = setTimeout(() => {
      A.publish(contentSnapshot(), PIN).catch(() => log("не удалось опубликовать на сервер — правки пока только в этом браузере"));
    }, 400);
  }
  function log(msg) { try { console.warn("СЕАНС админ:", msg); } catch (e) {} }
  const save = () => { S.save(); publish(); };

  /* ============================================================
     ФИЛЬМЫ — поиск по Википедии (RU): название, год, описание
     и постер из инфобокса подтягиваются сами. CORS открыт, ключей не надо.
     ============================================================ */
  async function searchMovies(q) {
    const term = /фильм/i.test(q) ? q : q + " фильм";
    const s = await fetch(`https://ru.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(term)}&format=json&origin=*&srlimit=10`);
    if (!s.ok) throw new Error("search http " + s.status);
    const hits = (await s.json())?.query?.search || [];
    const sums = await Promise.all(hits.map((h) =>
      fetch("https://ru.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(h.title))
        .then((r) => (r.ok ? r.json() : null)).catch(() => null)
    ));
    // оставляем только страницы, похожие на фильм
    return sums.filter(Boolean)
      .filter((j) => /фильм|мультфильм|аниме|кинокартина/i.test((j.description || "") + " " + (j.title || "")))
      .slice(0, 8);
  }
  // рейтинг из Wikidata (P444): IMDb приоритетно, иначе Rotten Tomatoes / Metacritic → шкала /10
  async function fetchRating(ruTitle) {
    try {
      const j = await fetch("https://www.wikidata.org/w/api.php?action=wbgetentities&sites=ruwiki&titles=" + encodeURIComponent(ruTitle) + "&props=claims&format=json&origin=*").then((r) => r.json());
      const claims = Object.values(j.entities || {})[0]?.claims?.P444 || [];
      const by = (id) => claims.find((c) => c.qualifiers?.P447?.[0]?.datavalue?.value?.id === id)?.mainsnak?.datavalue?.value;
      const imdb = by("Q37312");
      if (imdb) { const m = String(imdb).match(/^([\d.]+)/); if (m) return m[1]; }
      const rt = by("Q105584");
      if (rt) {
        const p = String(rt).match(/^(\d+)\s*%/); if (p) return (Number(p[1]) / 10).toFixed(1);
        const m = String(rt).match(/^([\d.]+)\/10/); if (m) return m[1];
      }
      const mc = by("Q150248");
      if (mc) { const m = String(mc).match(/^(\d+)\/100/); if (m) return (Number(m[1]) / 10).toFixed(1); }
    } catch (e) { /* нет сети/данных — оставим пустым, Влад впишет руками */ }
    return "";
  }

  function movieFromWiki(j) {
    const rawTitle = String(j.title || "");
    const extract = String(j.extract || "").replace(/\s+/g, " ").trim();
    const ym = rawTitle.match(/(\d{4})\s*\)/) || extract.match(/((?:19|20)\d{2})/);
    let synopsis = extract.slice(0, 260);
    const cut = synopsis.lastIndexOf(". ");
    if (cut > 80) synopsis = synopsis.slice(0, cut + 1);
    return {
      id: "f" + Date.now().toString(36),
      title: rawTitle.replace(/\s*\((?:фильм|мультфильм|аниме)[^)]*\)\s*$/i, "").trim() || "Без названия",
      year: ym ? ym[1] : "",
      runtime: "",                 // хронометраж/жанр/режиссёра Влад допишет в карточке
      genre: "",
      director: "",
      rating: "",
      poster: j.originalimage?.source || j.thumbnail?.source || "",
      synopsis,
      baseVotes: 0,
    };
  }

  function tabFilms() {
    body.innerHTML = `
      <div class="adm__block">
        <label class="adm__lbl">Добавить фильм — описание и постер подтянутся из Википедии</label>
        <div class="adm__search">
          <input id="admQ" placeholder="Название фильма… (напр. «Начало»)" />
          <button class="adm__btn primary" id="admFind">Найти</button>
        </div>
        <div id="admResults"></div>
        <p class="adm__note" style="margin-top:8px">Поиск не сработал? <button class="adm__btn" id="admManual" style="padding:4px 10px;font-size:12px">Добавить вручную</button></p>
      </div>
      <div class="adm__block">
        <label class="adm__lbl">Пожелания соседей — из них собирай следующее голосование</label>
        <div id="admSg"></div>
      </div>
      <div class="adm__block">
        <label class="adm__lbl">В голосовании сейчас (это же — ротация в шапке)</label>
        <div id="admFilms"></div>
      </div>`;
    const q = $("#admQ", body), res = $("#admResults", body);

    function renderSgAdmin() {
      const wrap = $("#admSg", body);
      if (!wrap) return;
      const A = window.SEANS_API;
      const sgs = (A && A.ready && A.state)
        ? (A.state.suggestions || [])
        : (window.__seans ? window.__seans.getSuggestions() : []).slice().reverse();
      wrap.innerHTML = sgs.length
        ? sgs.map((s) => `
          <div class="adm__row">
            <div class="grow"><b>${esc(s.title)}</b><small>${s.name ? esc(s.name) + " · " : ""}${new Date(s.ts).toLocaleString("ru-RU", { day: "numeric", month: "short" })}</small></div>
            <button class="adm__ico" data-sgfind="${esc(s.id)}" title="Найти и добавить в голосование">🔍</button>
            <button class="adm__ico danger" data-delsg="${esc(s.id)}" title="Убрать">✕</button>
          </div>`).join("")
        : `<p class="adm__note">Пока никто ничего не предложил — блок «Предложи свой фильм» на сайте, под голосованием.</p>`;
      $$("[data-sgfind]", wrap).forEach((b) => b.addEventListener("click", () => {
        const s = sgs.find((x) => x.id === b.dataset.sgfind);
        if (!s) return;
        q.value = s.title;
        doSearch();
        q.scrollIntoView({ block: "center" });
      }));
      $$("[data-delsg]", wrap).forEach((b) => b.addEventListener("click", () => {
        const A2 = window.SEANS_API;
        if (A2 && A2.ready) A2.adminRemove("suggestion", b.dataset.delsg, PIN).then(() => window.__seans?.sync()).then(renderSgAdmin).catch(() => alert("Сервер недоступен"));
        else { window.__seans?.removeSuggestion(b.dataset.delsg); renderSgAdmin(); }
      }));
    }

    async function doSearch() {
      const term = q.value.trim();
      if (!term) return;
      res.innerHTML = `<p class="adm__note">Ищу «${esc(term)}»…</p>`;
      try {
        const hits = await searchMovies(term);
        if (!hits.length) { res.innerHTML = `<p class="adm__note">Ничего не нашлось — попробуй с годом («Начало 2010») или добавь вручную.</p>`; return; }
        res.innerHTML = `<div class="adm__results">` + hits.map((h, i) => `
          <button class="adm__hit" data-hit="${i}">
            <img src="${esc(h.thumbnail?.source || "")}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
            <span>${esc(h.title)}</span>
          </button>`).join("") + `</div>`;
        $$("[data-hit]", res).forEach((b) => b.addEventListener("click", async () => {
          const hit = hits[+b.dataset.hit];
          res.innerHTML = `<p class="adm__note">Добавляю «${esc(hit.title)}», тяну рейтинг…</p>`;
          const f = movieFromWiki(hit);
          f.rating = await fetchRating(hit.title);   // IMDb/RT/MC с Wikidata
          addFilm(f);
          res.innerHTML = ""; q.value = "";
        }));
      } catch (e) {
        res.innerHTML = `<p class="adm__note">Поиск недоступен (сеть) — добавь вручную ниже.</p>`;
      }
    }
    $("#admFind", body).addEventListener("click", doSearch);
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });

    $("#admManual", body).addEventListener("click", () => {
      addFilm({ id: "f" + Date.now(), title: "Новый фильм", year: new Date().getFullYear(), runtime: "", genre: "", director: "", rating: "", poster: "", synopsis: "", baseVotes: 0 });
    });

    renderSgAdmin();
    renderFilmsList();
  }

  function addFilm(f) {
    D.voting.options.push(f);
    save();
    renderFilmsList();
    // сразу раскрываем карточку нового фильма на редактирование
    const w = $(`[data-editwrap="${CSS.escape(f.id)}"]`, body);
    if (w) w.hidden = false;
  }

  function renderFilmsList() {
    const wrap = $("#admFilms", body);
    if (!wrap) return;
    const opts = D.voting.options;
    wrap.innerHTML = opts.map((o, i) => `
      <div class="adm__row" data-film-row="${esc(o.id)}">
        <img src="${esc(o.poster)}" alt="" onerror="this.style.visibility='hidden'">
        <div class="grow"><b>${esc(o.title)}</b><small>${esc(o.year)}${o.genre ? " · " + esc(o.genre) : ""} · ${Number(o.baseVotes) || 0} голосов</small></div>
        <button class="adm__ico" data-up="${i}" title="Выше" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="adm__ico" data-down="${i}" title="Ниже" ${i === opts.length - 1 ? "disabled" : ""}>↓</button>
        <button class="adm__ico" data-edit="${esc(o.id)}" title="Редактировать">✎</button>
        <button class="adm__ico danger" data-delfilm="${i}" title="Убрать">✕</button>
      </div>
      <div class="adm__editwrap" data-editwrap="${esc(o.id)}" hidden>
        <div class="adm__grid">
          <input class="full" data-f="${i}:title" value="${esc(o.title)}" placeholder="Название" />
          <input data-f="${i}:year" value="${esc(o.year)}" placeholder="Год" />
          <input data-f="${i}:runtime" value="${esc(o.runtime)}" placeholder="2ч 06м" />
          <input data-f="${i}:genre" value="${esc(o.genre)}" placeholder="Жанр" />
          <input data-f="${i}:director" value="${esc(o.director)}" placeholder="Режиссёр" />
          <input data-f="${i}:rating" value="${esc(o.rating)}" placeholder="Рейтинг (напр. 8.1)" />
          <input data-f="${i}:baseVotes" type="number" min="0" value="${Number(o.baseVotes) || 0}" placeholder="Стартовые голоса" />
          <input class="full" data-f="${i}:poster" value="${esc(o.poster)}" placeholder="Постер: assets/… или https://…" />
          <div class="full adm__search">
            <input data-f="${i}:trailer" value="${esc(o.trailer || "")}" placeholder="Трейлер: ссылка на YouTube — заиграет в шапке" />
            <button class="adm__btn" data-yt="${i}" title="Открыть поиск трейлера на YouTube">Найти ↗</button>
          </div>
          <textarea class="full" data-f="${i}:synopsis" placeholder="Пара фраз о фильме">${esc(o.synopsis)}</textarea>
        </div>
      </div>`).join("");

    $$("[data-yt]", wrap).forEach((b) => b.addEventListener("click", () => {
      const o = D.voting.options[+b.dataset.yt];
      if (!o) return;
      window.open("https://www.youtube.com/results?search_query=" + encodeURIComponent(`${o.title} ${o.year || ""} трейлер`), "_blank");
    }));

    $$("[data-edit]", wrap).forEach((b) => b.addEventListener("click", () => {
      const w = $(`[data-editwrap="${CSS.escape(b.dataset.edit)}"]`, wrap);
      if (w) w.hidden = !w.hidden;
    }));
    $$("[data-delfilm]", wrap).forEach((b) => b.addEventListener("click", () => {
      const i = +b.dataset.delfilm;
      if (!confirm(`Убрать «${D.voting.options[i].title}» из голосования?`)) return;
      D.voting.options.splice(i, 1);
      save(); renderFilmsList();
    }));
    const move = (i, d) => {
      const o = D.voting.options.splice(i, 1)[0];
      D.voting.options.splice(i + d, 0, o);
      save(); renderFilmsList();
    };
    $$("[data-up]", wrap).forEach((b) => b.addEventListener("click", () => move(+b.dataset.up, -1)));
    $$("[data-down]", wrap).forEach((b) => b.addEventListener("click", () => move(+b.dataset.down, 1)));
    $$("[data-f]", wrap).forEach((inp) => inp.addEventListener("change", () => {
      const [i, field] = inp.dataset.f.split(":");
      const o = D.voting.options[+i];
      if (!o) return;
      o[field] = field === "baseVotes" ? Math.max(0, Number(inp.value) || 0) : inp.value.trim();
      save();
    }));
  }

  /* ============================================================
     ГОЛОСОВАНИЕ — день показа, запуск раунда, финал в афишу
     ============================================================ */
  function tabVote() {
    const r = D.votingRound;
    const ruDT = (iso) => new Date(iso).toLocaleString("ru-RU", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const stateLine = r && r.closesAt
      ? (r.done
        ? "Раунд закрыт — победитель уже в афише."
        : "Идёт: «" + (window.__seans ? window.__seans.votingTitle() : "") + "» · голосуем до " + ruDT(r.closesAt)
          + (r.showAt ? " · показ " + ruDT(r.showAt) : ""))
      : "Раунд не запущен — на сайте заголовок из config.js, дедлайн по умолчанию (ближайшая пятница 20:00).";

    body.innerHTML = `
      <div class="adm__block">
        <label class="adm__lbl">Сейчас</label>
        <p class="adm__note">${esc(stateLine)}</p>
      </div>
      <div class="adm__block">
        <label class="adm__lbl">Новый раунд · в какой день смотрим</label>
        <div class="adm__days" id="admDays">
          ${[1, 2, 3, 4, 5, 6, 0].map((d, i) => `<button class="adm__day" data-day="${d}">${["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"][i]}</button>`).join("")}
        </div>
        <div class="adm__search" style="margin-top:10px">
          <select id="admWeek">
            <option value="this">Ближайший такой день</option>
            <option value="next">Через неделю</option>
          </select>
          <input id="admTime" value="20:00" placeholder="20:00" style="max-width:110px" />
        </div>
        <button class="adm__btn primary" id="admLaunch" style="margin-top:12px">Запустить голосование</button>
        <p class="adm__note" style="margin-top:8px">Счётчики обнулятся, заголовок и дата подставятся сами. Голосование закроется <b>в 12:00 дня показа</b> — соседи заранее узнают фильм и успеют забронировать места. Победитель встанет в расписание автоматически.</p>
      </div>
      <div class="adm__block">
        <label class="adm__lbl">Завершение</label>
        <button class="adm__btn" id="admFinish">Завершить сейчас — победителя в афишу</button>
      </div>`;

    let selDay = 5;
    if (r && r.closesAt) { const d = new Date(r.closesAt); if (!isNaN(d)) selDay = d.getDay(); }
    const paint = () => $$(".adm__day", body).forEach((b) => b.classList.toggle("on", +b.dataset.day === selDay));
    paint();
    $$(".adm__day", body).forEach((b) => b.addEventListener("click", () => { selDay = +b.dataset.day; paint(); }));

    $("#admLaunch", body).addEventListener("click", () => {
      if (!confirm("Запустить новое голосование? Счётчики голосов обнулятся.")) return;
      const now = new Date();
      const t = new Date(now);
      let add = (selDay - now.getDay() + 7) % 7;
      if ($("#admWeek", body).value === "next") add += 7;
      t.setDate(now.getDate() + add);
      const m = ($("#admTime", body).value || "20:00").match(/^(\d{1,2})[:.](\d{2})$/);
      t.setHours(m ? Math.min(23, +m[1]) : 20, m ? Math.min(59, +m[2]) : 0, 0, 0);
      if (t <= now) t.setDate(t.getDate() + 7);      // сегодняшний день, но время уже прошло → через неделю
      // голосование закрывается в 12:00 дня показа (люди должны знать фильм заранее);
      // запускаем позже полудня — тогда за час до сеанса
      const dl = new Date(t);
      dl.setHours(12, 0, 0, 0);
      if (dl <= now) dl.setTime(t.getTime() - 3600e3);
      if (dl <= now) dl.setTime(t.getTime());
      D.votingRound = { closesAt: dl.toISOString(), showAt: t.toISOString(), done: false };
      D.voting.options.forEach((o) => { o.baseVotes = 0; });
      window.__seans?.resetMyVote();
      const A = window.SEANS_API;
      if (A && A.enabled) A.adminClear("votes", PIN).then(() => window.__seans?.sync()).catch(() => {});
      save();
      tabVote();
    });

    $("#admFinish", body).addEventListener("click", () => {
      if (!D.votingRound || !D.votingRound.closesAt) { alert("Сначала запусти голосование."); return; }
      if (D.votingRound.done) { alert("Раунд уже завершён."); return; }
      if (!confirm("Завершить голосование и поставить победителя в афишу?")) return;
      const A = window.SEANS_API;
      if (A && A.enabled) {
        // финализирует сервер (общий счёт), потом подтягиваем результат
        A.finish(PIN).then(() => window.__seans?.sync()).then(() => tabVote())
          .catch(() => { window.__seans?.finishVoting(); tabVote(); });
      } else {
        window.__seans?.finishVoting();
        tabVote();
      }
    });
  }

  /* ============================================================
     МЕНЮ БАРА (+ поиск фото: Openverse, фолбэк — Wikimedia Commons)
     ============================================================ */
  // Openverse ищет только по-английски. Сначала свой словарь снек-слов
  // (детерминированный — переводчик иногда теряет главное слово), потом MyMemory.
  const FOOD_RU_EN = {
    "попкорн": "popcorn", "начос": "nachos", "кола": "cola", "лимонад": "lemonade",
    "хот-дог": "hot dog", "хотдог": "hot dog", "сосиск": "sausage", "бургер": "burger",
    "пицц": "pizza", "чипс": "chips", "сыр": "cheese", "шоколад": "hot chocolate",
    "какао": "cocoa", "кофе": "coffee", "чай": "tea", "сок": "juice", "вода": "water",
    "пиво": "beer", "вино": "wine", "мороженое": "ice cream", "маршмеллоу": "marshmallow",
    "карамел": "caramel", "трюфел": "truffle", "пармезан": "parmesan",
    "солен": "salted", "сладк": "sweet", "остр": "spicy", "мят": "mint", "лайм": "lime",
  };
  function dictEnglish(q) {
    const words = q.toLowerCase().replace(/ё/g, "е").split(/[^a-zа-я-]+/).filter(Boolean);
    const keys = Object.keys(FOOD_RU_EN).sort((a, b) => b.length - a.length);
    const out = [];
    words.forEach((w) => {
      const k = keys.find((key) => w.startsWith(key));
      if (k && !out.includes(FOOD_RU_EN[k])) out.push(FOOD_RU_EN[k]);
      else if (!/[а-я]/.test(w)) out.push(w);       // английские слова оставляем как есть
    });
    return out.join(" ");
  }
  async function toEnglish(q) {
    if (!/[а-яё]/i.test(q)) return q;
    const byDict = dictEnglish(q);
    if (byDict) return byDict;                       // словарь знает главное слово — ему верим
    try {
      const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=ru|en`);
      const t = ((await r.json())?.responseData?.translatedText || "").trim();
      if (t && !/[а-яё]/i.test(t)) return t;         // перевод без кириллицы — ок
    } catch (e) { /* сеть упала — ищем как есть */ }
    return q;
  }
  async function searchPhotos(q) {
    const qEn = await toEnglish(q);
    try {
      const r = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(qEn)}&page_size=8&categories=photograph`);
      if (r.ok) {
        const res = ((await r.json()).results || [])
          .filter((x) => x.thumbnail)
          .map((x) => ({ thumb: x.thumbnail, url: x.thumbnail }));
        if (res.length) return res;
      }
      throw new Error("openverse empty");
    } catch (e) {
      const u = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent("filetype:bitmap " + qEn)}&gsrnamespace=6&gsrlimit=8&prop=imageinfo&iiprop=url&iiurlwidth=400&format=json&origin=*`;
      const r2 = await fetch(u);
      const pages = Object.values((await r2.json()).query?.pages || {});
      return pages.map((p) => ({ thumb: p.imageinfo?.[0]?.thumburl, url: p.imageinfo?.[0]?.thumburl }))
        .filter((x) => x.thumb);
    }
  }
  function tabMenu() {
    body.innerHTML = `<div id="admMenu"></div>
      <button class="adm__btn" id="admAddCat">+ Категория</button>
      <p class="adm__note" style="margin-top:10px">Изменения применяются сразу — открой раздел «Бар» и проверь.</p>`;
    renderMenuList();
    $("#admAddCat", body).addEventListener("click", () => {
      D.menu.push({ category: "Новая категория", items: [] });
      save(); renderMenuList();
    });
  }
  function renderMenuList() {
    const wrap = $("#admMenu", body);
    wrap.innerHTML = D.menu.map((g, gi) => `
      <div class="adm__block adm__cat">
        <div class="adm__search">
          <input data-cat="${gi}" value="${esc(g.category)}" />
          <button class="adm__ico danger" data-delcat="${gi}" title="Удалить категорию">✕</button>
        </div>
        ${(g.items || []).map((it, ii) => `
          <div class="adm__row">
            <div class="grow">
              <div class="adm__grid adm__grid--menu">
                <input data-mi="${gi}:${ii}:name" value="${esc(it.name)}" placeholder="Название" />
                <input data-mi="${gi}:${ii}:price" type="number" min="0" value="${Number(it.price) || 0}" placeholder="₽" />
                <input class="full" data-mi="${gi}:${ii}:desc" value="${esc(it.desc)}" placeholder="Описание" />
              </div>
              <details><summary>метка · фото</summary>
                <div class="adm__grid" style="margin-top:8px">
                  <input data-mi="${gi}:${ii}:tag" value="${esc(it.tag || "")}" placeholder="Метка (Хит, Новинка…)" />
                  <div class="adm__search">
                    <input data-mi="${gi}:${ii}:img" value="${esc(it.img || "")}" placeholder="Фото: assets/… или URL" />
                    <button class="adm__btn" data-findimg="${gi}:${ii}">Найти фото</button>
                  </div>
                </div>
                <div data-imgres="${gi}:${ii}"></div>
              </details>
            </div>
            <button class="adm__ico danger" data-delitem="${gi}:${ii}" title="Удалить">✕</button>
          </div>`).join("")}
        <button class="adm__btn" data-additem="${gi}" style="margin-top:10px">+ позиция</button>
      </div>`).join("");

    $$("[data-cat]", wrap).forEach((inp) => inp.addEventListener("change", () => {
      D.menu[+inp.dataset.cat].category = inp.value.trim() || "Без названия";
      save();
    }));
    $$("[data-delcat]", wrap).forEach((b) => b.addEventListener("click", () => {
      const gi = +b.dataset.delcat;
      if (!confirm(`Удалить категорию «${D.menu[gi].category}» со всеми позициями?`)) return;
      D.menu.splice(gi, 1); save(); renderMenuList();
    }));
    $$("[data-additem]", wrap).forEach((b) => b.addEventListener("click", () => {
      const gi = +b.dataset.additem;
      D.menu[gi].items.push({ id: "m" + Date.now(), name: "Новая позиция", desc: "", price: 0 });
      save(); renderMenuList();
    }));
    $$("[data-delitem]", wrap).forEach((b) => b.addEventListener("click", () => {
      const [gi, ii] = b.dataset.delitem.split(":").map(Number);
      if (!confirm(`Удалить «${D.menu[gi].items[ii].name}»?`)) return;
      D.menu[gi].items.splice(ii, 1); save(); renderMenuList();
    }));
    $$("[data-mi]", wrap).forEach((inp) => inp.addEventListener("change", () => {
      const [gi, ii, field] = inp.dataset.mi.split(":");
      const it = D.menu[+gi]?.items[+ii];
      if (!it) return;
      it[field] = field === "price" ? Math.max(0, Number(inp.value) || 0) : inp.value.trim();
      save();
    }));
    $$("[data-findimg]", wrap).forEach((b) => b.addEventListener("click", async () => {
      const key = b.dataset.findimg;
      const [gi, ii] = key.split(":").map(Number);
      const it = D.menu[gi]?.items[ii];
      const res = wrap.querySelector(`[data-imgres="${CSS.escape(key)}"]`);
      if (!it || !res) return;
      // категория + название: «Попкорн» + «Классический солёный» → нормальный запрос,
      // одно название без главного слова даёт мусор
      const q = `${D.menu[gi].category} ${it.name}`;
      res.innerHTML = `<p class="adm__note" style="margin-top:8px">Ищу фото «${esc(q)}»…</p>`;
      try {
        const photos = await searchPhotos(q);
        if (!photos.length) { res.innerHTML = `<p class="adm__note" style="margin-top:8px">Не нашлось — вставь ссылку руками.</p>`; return; }
        res.innerHTML = `<div class="adm__results adm__results--sq">` + photos.map((p, i) => `
          <button class="adm__hit" data-pick="${i}"><img src="${esc(p.thumb)}" alt="" loading="lazy" onerror="this.closest('button').remove()"></button>`).join("") + `</div>`;
        $$("[data-pick]", res).forEach((pb) => pb.addEventListener("click", () => {
          it.img = photos[+pb.dataset.pick].url;
          const inp = wrap.querySelector(`[data-mi="${CSS.escape(gi + ":" + ii + ":img")}"]`);
          if (inp) inp.value = it.img;
          save();                                     // сайт обновится, панель не перерисовываем
          res.innerHTML = `<p class="adm__note" style="margin-top:8px">✓ Фото выбрано — проверь в «Баре».</p>`;
        }));
      } catch (e) {
        res.innerHTML = `<p class="adm__note" style="margin-top:8px">Поиск фото недоступен (сеть) — вставь ссылку руками.</p>`;
      }
    }));
  }

  /* ============================================================
     АФИША (расписание)
     ============================================================ */
  function tabSched() {
    body.innerHTML = `<div id="admSched"></div>
      <button class="adm__btn" id="admAddSess">+ Сеанс</button>
      <p class="adm__note" style="margin-top:10px">«Мест» — сколько свободно изначально; брони соседей вычитаются сами. Если в статусе есть слово «голосование» — строка ведёт на голосование, а не на запись.</p>`;
    renderSchedList();
    $("#admAddSess", body).addEventListener("click", () => {
      D.schedule.push({ id: "s" + Date.now(), day: "ПТ", date: "", time: "20:00", title: "Фильм", tag: "Сеанс", seatsLeft: (D.hall && D.hall.seats) || 24, status: "Открыта запись" });
      save(); renderSchedList();
    });
  }
  function renderSchedList() {
    const wrap = $("#admSched", body);
    wrap.innerHTML = D.schedule.map((s, i) => `
      <div class="adm__row">
        <div class="grow">
          <div class="adm__grid adm__grid--sched">
            <input data-s="${i}:day" value="${esc(s.day)}" placeholder="ПТ" />
            <input data-s="${i}:date" value="${esc(s.date)}" placeholder="4 июля" />
            <input data-s="${i}:time" value="${esc(s.time)}" placeholder="20:00" />
            <input data-s="${i}:seatsLeft" type="number" min="0" value="${Number(s.seatsLeft) || 0}" placeholder="Мест" />
            <input class="full" data-s="${i}:title" value="${esc(s.title)}" placeholder="Фильм" />
            <input data-s="${i}:tag" value="${esc(s.tag)}" placeholder="Метка" />
            <input data-s="${i}:status" value="${esc(s.status)}" placeholder="Статус" />
          </div>
        </div>
        <button class="adm__ico danger" data-delsess="${i}" title="Удалить">✕</button>
      </div>`).join("");

    $$("[data-s]", wrap).forEach((inp) => inp.addEventListener("change", () => {
      const [i, field] = inp.dataset.s.split(":");
      const s = D.schedule[+i];
      if (!s) return;
      s[field] = field === "seatsLeft" ? Math.max(0, Number(inp.value) || 0) : inp.value.trim();
      save();
    }));
    $$("[data-delsess]", wrap).forEach((b) => b.addEventListener("click", () => {
      const i = +b.dataset.delsess;
      if (!confirm(`Удалить сеанс «${D.schedule[i].title}»?`)) return;
      D.schedule.splice(i, 1); save(); renderSchedList();
    }));
  }

  /* ============================================================
     БРОНИ и ЗАКАЗЫ
     ============================================================ */
  const sessName = (sid) => {
    const s = D.schedule.find((x) => x.id === sid);
    return s ? `${s.title} · ${s.day}, ${s.date} · ${s.time}` : "сеанс удалён из афиши";
  };
  const ruWhen = (ts) => new Date(ts).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  async function tabBooks() {
    const A = window.SEANS_API;
    let bookings = null, srv = false;
    if (A && A.enabled) {
      body.innerHTML = `<p class="adm__note">Загружаю брони с сервера…</p>`;
      try { const d = await A.adminData(PIN); bookings = d.bookings || []; srv = true; }
      catch (e) { /* сервер недоступен — показываем локальные */ }
    }
    if (!srv) bookings = (window.__seans ? window.__seans.getBookings() : []);
    if (activeTab !== "books") return;   // пока грузили — переключили вкладку
    bookings = bookings.slice().sort((a, b) => b.ts - a.ts);
    const bySession = {};
    bookings.forEach((b) => { (bySession[b.sid] = bySession[b.sid] || []).push(b); });
    const sessionName = sessName;
    body.innerHTML = !bookings.length
      ? `<p class="adm__note">Броней пока нет. Как только сосед запишется — появится тут.</p>`
      : Object.entries(bySession).map(([sid, list]) => {
        const donSum = list.reduce((a, b) => a + (Number(b.don) || 0), 0);
        return `
        <div class="adm__block">
          <label class="adm__lbl">${esc(sessionName(sid))} — ${list.reduce((a, b) => a + b.seats, 0)} мест${donSum ? " · взносы ~" + money(donSum) : ""}</label>
          ${list.map((b) => `
            <div class="adm__row">
              <div class="grow"><b>${esc(b.name)}${b.apt ? " · кв. " + esc(b.apt) : ""}</b>
                <small>${b.seats} ${b.seats === 1 ? "место" : b.seats < 5 ? "места" : "мест"}${Number(b.don) ? " · взнос ~" + money(b.don) : ""} · код ${esc(b.id.slice(-4).toUpperCase())} · ${ruWhen(b.ts)}</small>
              </div>
              <button class="adm__ico danger" data-delbook="${esc(b.id)}" title="Снять бронь">✕</button>
            </div>`).join("")}
        </div>`;
      }).join("") +
        `<button class="adm__btn danger" id="admClearBooks">Очистить все брони</button>`;

    $$("[data-delbook]", body).forEach((b) => b.addEventListener("click", () => {
      if (srv) A.adminRemove("booking", b.dataset.delbook, PIN).then(() => { window.__seans?.sync(); tabBooks(); }).catch(() => alert("Сервер недоступен"));
      else { window.__seans?.removeBooking(b.dataset.delbook); tabBooks(); }
    }));
    const clr = $("#admClearBooks", body);
    if (clr) clr.addEventListener("click", () => {
      if (!confirm("Точно снести все брони?")) return;
      if (srv) A.adminClear("bookings", PIN).then(() => { window.__seans?.sync(); tabBooks(); }).catch(() => alert("Сервер недоступен"));
      else { window.__seans?.clearBookings(); tabBooks(); }
    });
  }

  async function tabOrders() {
    const A = window.SEANS_API;
    let orders = null, srv = false;
    if (A && A.enabled) {
      body.innerHTML = `<p class="adm__note">Загружаю заказы с сервера…</p>`;
      try { const d = await A.adminData(PIN); orders = d.orders || []; srv = true; }
      catch (e) { /* сервер недоступен — локальные */ }
    }
    if (!srv) orders = (window.__seans ? window.__seans.getOrders() : []);
    if (activeTab !== "orders") return;
    orders = orders.slice().sort((a, b) => b.ts - a.ts);
    const totalSum = orders.reduce((a, o) => a + (Number(o.total) || 0), 0);
    body.innerHTML = !orders.length
      ? `<p class="adm__note">Заказов пока нет. Сосед соберёт корзину в «Баре», впишет имя — и заказ появится тут.</p>`
      : `<label class="adm__lbl">${orders.length} ${orders.length === 1 ? "заказ" : orders.length < 5 ? "заказа" : "заказов"} · на ${money(totalSum)}</label>` +
        orders.map((o) => `
        <div class="adm__row">
          <div class="grow">
            <b>${esc(o.name)}${o.apt ? " · кв. " + esc(o.apt) : ""} — ${money(o.total)}</b>
            <small>${(o.items || []).map((i) => `${i.qty}× ${esc(i.name)}`).join(", ")}</small><br>
            <small>${o.sid ? esc(sessName(o.sid)) : "заберёт в баре без сеанса"} · код ${esc(String(o.id).slice(-4).toUpperCase())} · ${ruWhen(o.ts)}</small>
          </div>
          <button class="adm__ico danger" data-delorder="${esc(o.id)}" title="Удалить заказ">✕</button>
        </div>`).join("") +
        `<button class="adm__btn danger" id="admClearOrders" style="margin-top:14px">Очистить все заказы</button>`;

    $$("[data-delorder]", body).forEach((b) => b.addEventListener("click", () => {
      if (srv) A.adminRemove("order", b.dataset.delorder, PIN).then(tabOrders).catch(() => alert("Сервер недоступен"));
      else { window.__seans?.removeOrder(b.dataset.delorder); tabOrders(); }
    }));
    const clr2 = $("#admClearOrders", body);
    if (clr2) clr2.addEventListener("click", () => {
      if (!confirm("Точно снести все заказы?")) return;
      if (srv) A.adminClear("orders", PIN).then(tabOrders).catch(() => alert("Сервер недоступен"));
      else { window.__seans?.clearOrders(); tabOrders(); }
    });
  }

  /* ============================================================
     ДАННЫЕ — бэкап / сбросы
     ============================================================ */
  function tabData() {
    const don = D.donation || (D.donation = { enabled: false, perSeat: 100, title: "Взнос на уют зала", note: "", payHint: "" });
    body.innerHTML = `
      <div class="adm__block">
        <label class="adm__lbl">Взнос на зал (показывается при брони)</label>
        <div class="adm__search" style="margin-bottom:8px">
          <label class="adm__note" style="display:flex;align-items:center;gap:8px;cursor:pointer;white-space:nowrap">
            <input type="checkbox" id="admDonOn" style="width:auto" ${don.enabled ? "checked" : ""}/> включён
          </label>
          <input id="admDonSum" type="number" min="0" value="${Number(don.perSeat) || 0}" style="max-width:100px" />
          <span class="adm__note" style="white-space:nowrap">₽ с места</span>
        </div>
        <input id="admDonNote" value="${esc(don.note || "")}" placeholder="На что идёт (видно соседям)" style="margin-bottom:8px" />
        <input id="admDonHint" value="${esc(don.payHint || "")}" placeholder="Как платить (наличкой в баре / перевод…)" />
      </div>
      <div class="adm__block">
        <label class="adm__lbl">Сервер (общий счёт для всего дома)</label>
        <p class="adm__note" id="admSrvState" style="margin-bottom:10px">Проверяю связь…</p>
        <button class="adm__btn primary" id="admPublish">Опубликовать все правки на сервер</button>
        <p class="adm__note" style="margin-top:8px">Фильмы, меню, афиша и раунд голосования из ЭТОГО браузера станут видны всем соседям на сайте.</p>
      </div>
      <div class="adm__block">
        <label class="adm__lbl">Бэкап</label>
        <p class="adm__note" style="margin-bottom:10px">Правки живут в этом браузере. Скачай бэкап, чтобы не потерять или перенести на другой комп.</p>
        <div class="adm__search">
          <button class="adm__btn primary" id="admExport">Скачать бэкап (JSON)</button>
          <label class="adm__btn" style="cursor:pointer">Загрузить бэкап<input type="file" id="admImport" accept=".json" hidden></label>
        </div>
      </div>
      <div class="adm__block">
        <label class="adm__lbl">Сбросы</label>
        <div class="adm__search" style="flex-wrap:wrap">
          <button class="adm__btn" id="admZeroVotes">Обнулить голоса</button>
          <button class="adm__btn danger" id="admReset">Сбросить правки → как в config.js</button>
        </div>
        <p class="adm__note" style="margin-top:10px">«Обнулить голоса» ставит счётчики всех фильмов на 0 (голосование с чистого листа). «Сбросить правки» вернёт фильмы, меню и афишу к исходным из config.js — брони не тронет.</p>
      </div>`;

    // связь с сервером + явная публикация всех правок
    (async () => {
      const st = $("#admSrvState", body);
      const A = window.SEANS_API;
      if (!A || !A.enabled) { if (st) st.textContent = "Сервер не настроен (config.js → api) — правки живут только в этом браузере."; return; }
      const ok = await A.refresh();
      if (st) st.textContent = ok
        ? "Сервер на связи ✓ — правки публикуются автоматически при каждом изменении."
        : "Сервер сейчас недоступен — правки сохраняются в этом браузере, опубликуешь позже.";
    })();
    $("#admPublish", body).addEventListener("click", async () => {
      const A = window.SEANS_API;
      const st = $("#admSrvState", body);
      if (!A || !A.enabled) { alert("Сервер не настроен."); return; }
      try {
        await A.publish(contentSnapshot(), PIN);
        await window.__seans?.sync();
        if (st) st.textContent = "Опубликовано ✓ — соседи увидят твои фильмы, меню и афишу.";
      } catch (e) {
        if (st) st.textContent = "Не получилось: сервер недоступен. Попробуй позже.";
      }
    });

    $("#admDonOn", body).addEventListener("change", (e) => { don.enabled = e.target.checked; save(); });
    $("#admDonSum", body).addEventListener("change", (e) => { don.perSeat = Math.max(0, Number(e.target.value) || 0); save(); });
    $("#admDonNote", body).addEventListener("change", (e) => { don.note = e.target.value.trim(); save(); });
    $("#admDonHint", body).addEventListener("change", (e) => { don.payHint = e.target.value.trim(); save(); });

    $("#admExport", body).addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(S.exportAll(), null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "seans-backup.json";
      a.click();
      URL.revokeObjectURL(a.href);
    });
    $("#admImport", body).addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try { S.importAll(JSON.parse(rd.result)); location.reload(); }
        catch (err) { alert("Не получилось прочитать файл — это точно бэкап СЕАНСА?"); }
      };
      rd.readAsText(f);
    });
    $("#admZeroVotes", body).addEventListener("click", () => {
      if (!confirm("Обнулить голоса всех фильмов?")) return;
      D.voting.options.forEach((o) => { o.baseVotes = 0; });
      window.__seans?.resetMyVote();
      const A = window.SEANS_API;
      if (A && A.enabled) A.adminClear("votes", PIN).then(() => window.__seans?.sync()).catch(() => {});
      save();
    });
    $("#admReset", body).addEventListener("click", () => {
      if (!confirm("Вернуть фильмы, меню и афишу к исходным из config.js?")) return;
      S.reset();
      location.reload();
    });
  }
})();
