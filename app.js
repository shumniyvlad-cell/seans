/* ============================================================
   СЕАНС — вся интерактивность.
   Данные: window.STORE.data (config.js + правки из админки).
   Соседям: голосование, брони с билетом, заказ в баре.
   Владу: админка в admin.js (⚙ в подвале или ?admin).
   ============================================================ */
(() => {
  "use strict";
  const C = (window.STORE && window.STORE.data) || window.CONFIG;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const LS_VOTE = "seans_vote_v1";
  const LS_CART = "seans_cart_v1";
  const LS_BOOK = "seans_bookings_v1";
  const LS_MINE = "seans_my_bookings_v1";
  const LS_ORDERS = "seans_orders_v1";
  const LS_SG = "seans_suggest_v1";

  const money = (n) => (Number(n) || 0).toLocaleString("ru-RU").replace(/\s/g, " ") + " ₽";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  function safeParse(k, fb) { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch (e) { return fb; } }

  const state = {
    vote: localStorage.getItem(LS_VOTE) || null,
    cart: safeParse(LS_CART, {}),
    bookings: safeParse(LS_BOOK, []),
    mine: safeParse(LS_MINE, []),
    orders: safeParse(LS_ORDERS, []),
    suggestions: safeParse(LS_SG, []),
  };
  const saveVote = () => state.vote ? localStorage.setItem(LS_VOTE, state.vote) : localStorage.removeItem(LS_VOTE);
  const saveCart = () => localStorage.setItem(LS_CART, JSON.stringify(state.cart));
  const saveOrders = () => localStorage.setItem(LS_ORDERS, JSON.stringify(state.orders));
  const saveSg = () => localStorage.setItem(LS_SG, JSON.stringify(state.suggestions));
  const saveBookings = () => {
    localStorage.setItem(LS_BOOK, JSON.stringify(state.bookings));
    localStorage.setItem(LS_MINE, JSON.stringify(state.mine));
  };

  /* ---------- toast ---------- */
  let toastT;
  const toast = (msg) => {
    const t = $("#toast");
    t.innerHTML = msg;
    t.classList.add("show");
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove("show"), 2600);
  };

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  /* ---------- reveal on scroll ---------- */
  let io;
  function observeReveal(scope) {
    if (!io) {
      io = new IntersectionObserver((entries) => {
        entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
      }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    }
    $$(".reveal:not(.in)", scope || document).forEach((n) => io.observe(n));
  }

  /* ============================================================
     СТАТИКА (бренд, футер)
     ============================================================ */
  $("#brandSub").textContent = C.brand.tagline;
  $("#footerPlace").textContent = C.brand.place;
  $("#footerReady").innerHTML = esc(C.ready).replace(/попкорн/i, "<b>попкорн</b>");
  $("#navChat").href = C.brand.chatUrl;
  const mnavChat = $("#mnavChat");
  if (mnavChat) mnavChat.href = C.brand.chatUrl;
  // настоящий QR на чат дома (генерится по chatUrl)
  const qrImg = $("#qrImg"), qrLink = $("#qrLink");
  if (qrImg && C.brand.chatUrl) {
    qrImg.src = "https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=8&data=" + encodeURIComponent(C.brand.chatUrl);
    if (qrLink) qrLink.href = C.brand.chatUrl;
  }

  /* ============================================================
     ГЕРОЙ — ротация фильмов, каждому свой трейлер (или постер)
     ============================================================ */
  let heroStop = null;
  let currentHeroId = null;

  // достаём id ролика из любой YouTube-ссылки (watch / youtu.be / shorts / embed / голый id)
  function ytId(s) {
    s = String(s || "").trim();
    if (!s) return null;
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
    const m = s.match(/(?:youtu\.be\/|v=|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  function initHero() {
    if (heroStop) { heroStop(); heroStop = null; }
    const bg = $("#heroBg"), v = $("#heroVideo"), yt = $("#heroYt");
    const elTitle = $("#heroTitle"), elMeta = $("#heroMeta"), elDir = $("#heroDirector"),
          elEye = $("#heroEyebrow"), dotsWrap = $("#heroDots"), copyEl = $(".hero__copy");

    const order = (C.voting.options || []).slice();
    const intervalMs = Math.max(3, (C.hero && C.hero.intervalSec) || 8) * 1000;
    if (C.hero && C.hero.eyebrow) elEye.textContent = C.hero.eyebrow;
    document.documentElement.style.setProperty("--slide-ms", intervalMs + "ms");

    bg.classList.remove("poster-mode");
    bg.style.backgroundImage = 'url("assets/ambient-room.webp")';
    if (!order.length) {
      elTitle.textContent = C.brand.name; elMeta.textContent = ""; elDir.textContent = "";
      dotsWrap.innerHTML = ""; v.removeAttribute("src"); v.classList.remove("on");
      return;
    }

    // подгон заголовка: всегда одна строка, старт от CSS-clamp, ужимаем при переполнении
    function fitTitle() {
      elTitle.style.fontSize = "";
      const avail = (copyEl && copyEl.clientWidth) || 0;
      if (avail < 80) return;                       // не отрисовано — оставляем clamp
      let size = parseFloat(getComputedStyle(elTitle).fontSize) || 88;
      let g = 0;
      while (elTitle.scrollWidth > avail && size > 22 && g < 120) { size -= 1.5; elTitle.style.fontSize = size + "px"; g++; }
    }

    dotsWrap.innerHTML = "";
    order.forEach((o, i) => {
      const d = el("button", "hero__dot");
      d.setAttribute("aria-label", o.title);
      d.addEventListener("click", () => go(i));
      dotsWrap.appendChild(d);
    });
    const dots = [...dotsWrap.children];

    let idx = -1, timer = null, rz = null;
    v.loop = order.length === 1;

    function clearYt() { yt.classList.remove("on"); yt.innerHTML = ""; }
    function mountYt(o) {
      const id = ytId(o.trailer);            // id валидирован регэкспом — в src безопасно
      if (!id) return;
      yt.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&controls=0&loop=1&playlist=${id}&rel=0&playsinline=1&modestbranding=1&iv_load_policy=3&disablekb=1&fs=0&enablejsapi=1&origin=${encodeURIComponent(location.origin)}&widgetid=1" allow="autoplay; encrypted-media" title="Трейлер"></iframe>`;
      // подписка на события плеера (см. message-листенер ниже): слой включится,
      // только когда трейлер реально играет — на паузе YouTube рисует свои кнопки.
      // Без origin+widgetid и channel:'widget' плеер на postMessage не отвечает.
      const f = yt.firstElementChild;
      f.addEventListener("load", () => {
        const hail = () => { try { f.contentWindow.postMessage(JSON.stringify({ event: "listening", id: "1", channel: "widget" }), "*"); } catch (e) {} };
        hail(); setTimeout(hail, 800); setTimeout(hail, 2000);
      });
    }
    // трейлер по ступенькам: локальный mp4 → YouTube-ссылка из карточки → размытый постер
    function playVideo(o) {
      v.classList.remove("on");
      clearYt();
      bg.classList.add("poster-mode");
      bg.style.backgroundImage = `url("${o.poster}")`;
      v.oncanplay = () => { clearYt(); v.classList.add("on"); v.play().catch(() => {}); };
      v.onerror = () => { v.classList.remove("on"); mountYt(o); };
      v.src = `assets/trailer-${o.id}.mp4`;
      v.load();
    }
    function render(o) {
      currentHeroId = o.id;
      elTitle.textContent = o.title;
      elMeta.textContent = [o.rating ? "★ " + o.rating : "", o.year, o.runtime, o.genre]
        .filter(Boolean).join(" · ");
      elDir.innerHTML = o.director ? `Режиссёр — <b>${esc(o.director)}</b>` : "";
      fitTitle();
      dots.forEach((d, i) => d.classList.toggle("active", i === idx));
      const ad = dots[idx];
      if (ad) { ad.classList.remove("run"); void ad.offsetWidth; ad.classList.add("run"); }
    }
    function go(n) {
      const next = ((n % order.length) + order.length) % order.length;
      if (next === idx && idx !== -1) return;
      clearTimeout(timer);
      const first = idx === -1, o = order[next];
      if (!first) copyEl.classList.add("swapping");
      setTimeout(() => { idx = next; render(o); copyEl.classList.remove("swapping"); }, first ? 0 : 300);
      playVideo(o);
      timer = setTimeout(() => go(next + 1), intervalMs);
    }

    const onResize = () => { clearTimeout(rz); rz = setTimeout(fitTitle, 150); };
    const onVis = () => {
      if (document.hidden) { clearTimeout(timer); v.pause(); }
      else { v.play().catch(() => {}); clearTimeout(timer); timer = setTimeout(() => go(idx + 1), intervalMs); }
    };
    v.onended = () => { if (order.length > 1) go(idx + 1); };
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVis);
    heroStop = () => {
      clearTimeout(timer); clearTimeout(rz);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
      v.oncanplay = v.onerror = v.onended = null;
      clearYt();
    };

    go(0);
  }

  // Состояние YouTube-плеера в герое: 1 = играет → показываем слой;
  // пауза/конец → прячем (остаётся постер, серые кнопки плеера не видны) и мягко пинаем play
  window.addEventListener("message", (e) => {
    let host = "";
    try { host = new URL(e.origin).hostname; } catch (err) { return; }
    if (!/(^|\.)youtube(-nocookie)?\.com$/.test(host)) return;
    let d;
    try { d = JSON.parse(e.data); } catch (err) { return; }
    const yt = $("#heroYt");
    const f = yt && yt.querySelector("iframe");
    if (!f || e.source !== f.contentWindow) return;
    const st = d && d.info ? d.info.playerState : null;
    if (st == null) return;
    if (st === 1) {
      // небольшая задержка: даём плееру дорисовать кадр, чтобы не мигнул его интерфейс
      clearTimeout(yt.__showT);
      yt.__showT = setTimeout(() => yt.classList.add("on"), 350);
    } else {
      clearTimeout(yt.__showT);
      yt.classList.remove("on");
      // -1 не начат / 0 конец / 2 пауза / 5 в очереди → пинаем play (3 = буфер, не трогаем)
      if (st === -1 || st === 0 || st === 2 || st === 5) {
        try { f.contentWindow.postMessage(JSON.stringify({ event: "command", func: "playVideo", args: [] }), "*"); } catch (err) {}
      }
    }
  });

  // «Голосовать за фильм» из героя — подсветить карточку этого фильма
  const heroVote = $("#heroVote");
  if (heroVote) heroVote.addEventListener("click", () => {
    setTimeout(() => {
      const card = document.querySelector(`.pcard[data-film="${CSS.escape(currentHeroId || "")}"]`);
      if (!card) return;
      card.classList.remove("pulse"); void card.offsetWidth; card.classList.add("pulse");
      setTimeout(() => card.classList.remove("pulse"), 1700);
    }, 550);
  });

  /* ---------- бегущая строка ---------- */
  function renderMarquee() {
    const titles = (C.voting.options || []).map((o) => esc(String(o.title).toUpperCase()));
    if (!titles.length) { $("#marqueeTrack").innerHTML = ""; return; }
    // мало фильмов — повторяем список, чтобы лента шла плотно без пустого хвоста
    let seg = titles.slice();
    while (seg.length < 12) seg = seg.concat(titles);
    const mk = seg.map((t) => `<span class="marquee__item">${t}</span>`).join("");
    $("#marqueeTrack").innerHTML = mk + mk;   // ×2 — для бесшовного цикла (-50%)
  }

  /* ============================================================
     ГОЛОСОВАНИЕ
     ============================================================ */
  const votingWrap = $("#posters");
  const star = `<svg viewBox="0 0 24 24" width="13" height="13"><path d="M12 3l2.5 5.6 6.1.6-4.6 4 1.4 6-5.4-3.2L6.6 19l1.4-6-4.6-4 6.1-.6z" fill="currentColor"/></svg>`;

  function tally() {
    // общий счёт: если сервер на связи — голоса оттуда (все соседи), иначе локально
    const A = window.SEANS_API;
    const sv = A && A.ready && A.state ? (A.state.votes || {}) : null;
    const rows = (C.voting.options || []).map((o) => ({
      ...o,
      votes: sv ? (Number(sv[o.id]) || 0) : (Number(o.baseVotes) || 0) + (state.vote === o.id ? 1 : 0),
    }));
    const total = rows.reduce((s, r) => s + r.votes, 0);
    const max = rows.length ? Math.max(...rows.map((r) => r.votes)) : 0;
    rows.forEach((r) => { r.pct = total ? Math.round(r.votes / total * 100) : 0; r.leader = total > 0 && r.votes === max; });
    return { rows, total };
  }

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  function bindTilt(card) {
    if (reduceMotion) return;
    card.addEventListener("mousemove", (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = `translateY(-6px) rotateX(${(-y * 4).toFixed(2)}deg) rotateY(${(x * 5).toFixed(2)}deg)`;
    });
    card.addEventListener("mouseleave", () => { card.style.transform = ""; });
  }

  function renderVoting() {
    $("#votingTitle").textContent = votingTitle();
    $("#votingSub").textContent = C.voting.subtitle;
    const closed = votingClosed();
    const { rows, total } = tally();
    $("#voteTotal").innerHTML = `Проголосовало <b>${total}</b> ${plural(total, "сосед", "соседа", "соседей")}`;
    votingWrap.innerHTML = "";
    rows.forEach((r, i) => {
      const voted = state.vote === r.id;
      const card = el("div", "pcard reveal" + (r.leader ? " leader" : ""));
      card.dataset.film = r.id;
      card.style.transitionDelay = (i * 60) + "ms";
      card.innerHTML = `
        <div class="pcard__poster">
          <img src="${esc(r.poster)}" alt="${esc(r.title)}" loading="lazy" onerror="this.style.opacity=0;this.parentElement.style.background='linear-gradient(160deg,#1d1d25,#101014)'" />
          <div class="pcard__grad"></div>
          ${r.rating ? `<div class="pcard__rating">${star} ${esc(r.rating)}</div>` : ""}
          <div class="pcard__badge">Лидер</div>
          <div class="pcard__info">
            <div class="pcard__title">${esc(r.title)}</div>
            <div class="pcard__sub">${esc(r.year)}${r.runtime ? " · " + esc(r.runtime) : ""}${r.genre ? " · " + esc(r.genre) : ""}</div>
            <div class="pcard__synopsis">${esc(r.synopsis)}</div>
          </div>
        </div>
        <div class="pcard__vote">
          <div class="pbar"><div class="pbar__fill" style="width:0"></div></div>
          <div class="pcard__stats">
            <span class="pcard__pct">${r.pct}%</span>
            <span class="pcard__count">${r.votes} ${plural(r.votes, "голос", "голоса", "голосов")}</span>
          </div>
          <button class="votebtn ${voted ? "voted" : ""}" data-id="${esc(r.id)}" ${closed ? "disabled" : ""}>
            ${closed ? (voted ? "✓ Ваш голос · закрыто" : "Голосование закрыто") : (voted ? "✓ Ваш голос" : "Голосовать")}
          </button>
        </div>`;
      votingWrap.appendChild(card);
      bindTilt(card);
      card.querySelector(".pcard__poster").addEventListener("click", () => openFilm(r.id));
      requestAnimationFrame(() => requestAnimationFrame(() => {
        card.querySelector(".pbar__fill").style.width = r.pct + "%";
      }));
    });
    $$(".votebtn", votingWrap).forEach((b) => b.addEventListener("click", () => castVote(b.dataset.id)));
    observeReveal(votingWrap);
  }

  function castVote(id) {
    if (votingClosed()) { toast("Голосование уже закрыто"); return; }
    const opt = (C.voting.options || []).find((o) => o.id === id);
    if (!opt) return;
    const un = state.vote === id;
    state.vote = un ? null : id;
    saveVote();
    toast(un ? "Голос отозван" : `Голос учтён за <b>«${esc(opt.title)}»</b>`);
    const A = window.SEANS_API;
    if (A && A.enabled) {
      A.vote(un ? null : id).then((r) => {
        if (A.state) { A.state.votes = r.votes; A.state.myVote = r.myVote; }
        renderVoting();
      }).catch(() => {});   // сервер лёг — голос остался локально
    }
    renderVoting();
  }

  /* ---------- карточка фильма: описание + трейлер ---------- */
  const filmModal = $("#filmModal"), filmBody = $("#filmBody");
  const closeFilm = () => {
    filmModal.classList.remove("open");
    filmModal.setAttribute("aria-hidden", "true");
    filmBody.innerHTML = "";                      // глушим трейлер
  };
  $$("#filmModal [data-close]").forEach((n) => n.addEventListener("click", closeFilm));

  function openFilm(id) {
    const o = (C.voting.options || []).find((x) => x.id === id);
    if (!o) return;
    const closed = votingClosed();
    const voted = state.vote === id;
    filmBody.innerHTML = `
      <div class="film">
        <img class="film__poster" src="${esc(o.poster)}" alt="" onerror="this.style.visibility='hidden'">
        <div class="film__info">
          <h3 class="bmodal__title">${esc(o.title)}</h3>
          <p class="bmodal__meta" style="margin-bottom:10px">${[o.rating ? "★ " + esc(o.rating) : "", esc(o.year || ""), esc(o.runtime || ""), esc(o.genre || "")].filter(Boolean).join(" · ")}</p>
          ${o.director ? `<p class="hero__director" style="margin:0">Режиссёр — <b>${esc(o.director)}</b></p>` : ""}
        </div>
      </div>
      ${o.synopsis ? `<p class="film__syn">${esc(o.synopsis)}</p>` : ""}
      <div class="film__trailer" id="filmTrailer"></div>
      <button class="btn ${voted ? "btn--ghost" : "btn--primary"} btn--block" id="filmVote" ${closed ? "disabled style='opacity:.5'" : ""}>
        ${closed ? "Голосование закрыто" : voted ? "✓ Ваш голос — отозвать" : "Голосовать за этот фильм"}
      </button>`;
    // трейлер по ступенькам: локальный клип → YouTube с контролами → без блока
    const tr = $("#filmTrailer");
    const vid = document.createElement("video");
    vid.controls = true; vid.preload = "metadata"; vid.playsInline = true;
    vid.src = `assets/trailer-${o.id}.mp4`;
    vid.onerror = () => {
      vid.remove();
      const yid = ytId(o.trailer);
      if (yid) tr.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${yid}?rel=0&playsinline=1" allow="autoplay; encrypted-media; fullscreen" allowfullscreen title="Трейлер"></iframe>`;
      else tr.remove();
    };
    tr.appendChild(vid);
    $("#filmVote").onclick = () => { if (!votingClosed()) { castVote(id); openFilm(id); } };
    filmModal.classList.add("open");
    filmModal.setAttribute("aria-hidden", "false");
  }

  /* ---------- пожелания: из них соберётся следующее голосование ---------- */
  function renderSuggest() {
    const list = $("#sgList");
    if (!list) return;
    const A = window.SEANS_API;
    const items = (A && A.ready && A.state)
      ? (A.state.suggestions || [])                       // общий список с сервера (уже свежие сверху)
      : state.suggestions.slice(-14).reverse();
    list.innerHTML = items.length
      ? items.map((s) => `<span class="sg-chip"><b>${esc(s.title)}</b>${s.name ? `<span>${esc(s.name)}</span>` : ""}</span>`).join("")
      : `<span class="sg-chip sg-chip--empty">Пока пусто — предложи первым</span>`;
  }
  const sgBtn = $("#sgAdd");
  if (sgBtn) {
    const submitSg = async () => {
      const t = $("#sgTitle");
      const title = t.value.trim();
      if (!title) { t.classList.remove("err"); void t.offsetWidth; t.classList.add("err"); t.focus(); return; }
      const name = $("#sgName").value.trim();
      const A = window.SEANS_API;
      let viaApi = false;
      if (A && A.enabled) {
        try { await A.suggest(title, name); await A.refresh(); viaApi = true; } catch (e) {}
      }
      if (!viaApi) {
        state.suggestions.push({ id: "g" + Date.now().toString(36), title, name, ts: Date.now() });
        saveSg();
      }
      renderSuggest();
      t.value = "";
      toast(`Записал: <b>«${esc(title)}»</b> — учтём в следующем голосовании`);
    };
    sgBtn.addEventListener("click", submitSg);
    $("#sgTitle").addEventListener("keydown", (e) => { if (e.key === "Enter") submitSg(); });
  }

  /* ---------- раунд голосования: дата показа, заголовок, дедлайн ---------- */
  const MONTHS_RU = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const DAYS_SHORT = ["ВС", "ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ"];
  const DAY_ACC = ["воскресенье", "понедельник", "вторник", "среду", "четверг", "пятницу", "субботу"];
  const THIS_NEXT = [["это", "следующее"], ["этот", "следующий"], ["этот", "следующий"], ["эту", "следующую"], ["этот", "следующий"], ["эту", "следующую"], ["эту", "следующую"]];
  const fmtDateRu = (d) => `${d.getDate()} ${MONTHS_RU[d.getMonth()]}`;
  const weekStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };

  function nextFriday20() {
    const n = new Date();
    const t = new Date(n);
    t.setHours(20, 0, 0, 0);
    let add = (5 - n.getDay() + 7) % 7;
    if (add === 0 && n.getTime() >= t.getTime()) add = 7;
    t.setDate(n.getDate() + add);
    return t;
  }
  function voteTarget() {
    const r = C.votingRound;
    if (r && r.closesAt) { const d = new Date(r.closesAt); if (!isNaN(d)) return d; }
    if (C.voting.closesAt) { const d = new Date(C.voting.closesAt); if (!isNaN(d)) return d; }
    return nextFriday20();
  }
  function votingClosed() {
    const r = C.votingRound;
    if (r && r.done) return true;
    return !(voteTarget() - new Date() > 0);
  }
  // дата ПОКАЗА раунда (showAt; старые раунды хранили только closesAt)
  function roundShowDate() {
    const r = C.votingRound;
    if (!r) return null;
    const d = new Date(r.showAt || r.closesAt);
    return isNaN(d) ? null : d;
  }
  // «Что смотрим в эту среду, 8 июля?» — из даты показа; без раунда — заголовок из config
  function votingTitle() {
    const r = C.votingRound;
    if (!r || !r.closesAt) return C.voting.title;
    const d = roundShowDate();
    if (!d) return C.voting.title;
    const wd = d.getDay();
    const wdiff = Math.round((weekStart(d) - weekStart(new Date())) / 6048e5);
    const mod = wdiff <= 0 ? THIS_NEXT[wd][0] : wdiff === 1 ? THIS_NEXT[wd][1] : "";
    return `Что смотрим в ${mod ? mod + " " : ""}${DAY_ACC[wd]}, ${fmtDateRu(d)}?`;
  }

  // финал: победитель автоматически встаёт в расписание на дату раунда
  function finishVoting() {
    const r = C.votingRound;
    if (!r || r.done) return;
    const { rows } = tally();
    if (rows.length) {
      const w = rows.reduce((a, b) => (b.votes > a.votes ? b : a));
      const d = roundShowDate() || new Date(r.closesAt);   // строка афиши — на дату/время ПОКАЗА
      const id = "s-vote-" + String(r.showAt || r.closesAt).slice(0, 10);
      if (!isNaN(d) && !C.schedule.some((s) => s.id === id)) {
        C.schedule.push({
          id,
          day: DAYS_SHORT[d.getDay()],
          date: fmtDateRu(d),
          time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
          title: w.title,
          tag: "Выбор соседей",                 // в статусе НЕ пишем «голосование» — иначе строка станет ссылкой на голосование
          seatsLeft: (C.hall && C.hall.seats) || 24,
          status: "Открыта запись",
        });
        toast(`Соседи выбрали <b>«${esc(w.title)}»</b> — сеанс уже в афише`);
      }
    }
    r.done = true;
    if (window.STORE) window.STORE.save();      // save() сам перерисует сайт
  }

  let finishing = false;
  function tickCountdown() {
    const v = $("#countdownValue");
    const r = C.votingRound;
    if (r && r.done) { v.textContent = "Закрыто"; return; }
    const ms = voteTarget() - new Date();
    if (!(ms > 0)) {                             // и прошедшие, и кривые даты (NaN)
      v.textContent = "Закрыто";
      const A = window.SEANS_API;
      if (A && A.ready) return;   // общий режим: раунд финализирует сервер, результат придёт с синком
      if (r && !r.done && !finishing) { finishing = true; try { finishVoting(); } finally { finishing = false; } }
      return;
    }
    const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5),
          m = Math.floor(ms % 36e5 / 6e4), s = Math.floor(ms % 6e4 / 1e3);
    v.textContent = d > 0 ? `${d}д ${h}ч ${m}м` : `${h}ч ${m}м ${String(s).padStart(2, "0")}с`;
  }

  /* ============================================================
     РАСПИСАНИЕ + БРОНИ
     ============================================================ */
  const bookedFor = (sid) => {
    const A = window.SEANS_API;
    if (A && A.ready && A.state && A.state.booked) return Number(A.state.booked[sid]) || 0;
    return state.bookings.filter((b) => b.sid === sid).reduce((a, b) => a + (Number(b.seats) || 0), 0);
  };
  const myBookingFor = (sid) => {
    const A = window.SEANS_API;
    if (A && A.ready && A.state) return (A.state.myBookings || []).find((b) => b.sid === sid);
    return state.bookings.find((b) => b.sid === sid && state.mine.includes(b.id));
  };
  const seatsLeftFor = (s) => Math.max(0, (Number(s.seatsLeft) || 0) - bookedFor(s.id));

  const schedWrap = $("#scheduleList");
  function renderSchedule() {
    schedWrap.innerHTML = "";
    // афиша пуста: пока идёт голосование — говорим об этом прямо
    if (!(C.schedule || []).length) {
      const r = C.votingRound;
      const waiting = r && r.closesAt && !r.done && !isNaN(new Date(r.closesAt));
      let when = "";
      if (waiting) {
        const d = roundShowDate() || new Date(r.closesAt);
        when = ` Сеанс планируется в ${DAY_ACC[d.getDay()]}, ${fmtDateRu(d)} в ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}.`;
      }
      schedWrap.innerHTML = `
        <div class="sched-empty reveal">
          <span class="dot"></span>
          <b>${waiting ? "Ждём решения голосования" : "Сеансов пока нет"}</b>
          <span>${waiting
            ? "Фильм-победитель встанет сюда автоматически, как только соседи доголосуют." + esc(when)
            : "Загляни позже — или предложи фильм в голосовании выше."}</span>
        </div>`;
      observeReveal(schedWrap);
      return;
    }
    (C.schedule || []).forEach((s, i) => {
      const isVote = /голосован/i.test(s.status || "") || /голосован/i.test(s.title || "");
      const left = seatsLeftFor(s);
      const my = myBookingFor(s.id);
      const low = left <= 4;
      const chipCls = /семей/i.test(s.tag || "") ? "chip chip--gold" : "chip";
      const row = el("div", "srow reveal");
      row.style.transitionDelay = (i * 50) + "ms";

      let right;
      if (isVote) {
        right = `<div class="sseats">${esc(s.seatsLeft)} мест</div><a class="btn btn--ghost btn--sm" href="#voting">К голосованию</a>`;
      } else if (my) {
        right = `<div class="sseats booked">✓ Вы записаны · <b>${my.seats}</b> ${plural(my.seats, "место", "места", "мест")}</div>
                 <button class="btn btn--ghost btn--sm" data-cancel="${esc(my.id)}">Отменить</button>`;
      } else if (left > 0) {
        right = `<div class="sseats ${low ? "low" : ""}">Осталось <b>${left}</b> ${plural(left, "место", "места", "мест")}</div>
                 <button class="btn btn--primary btn--sm" data-book="${esc(s.id)}">Записаться</button>`;
      } else {
        right = `<div class="sseats low">Мест нет</div>`;
      }

      row.innerHTML = `
        <div class="sdate"><div class="sdate__day">${esc(s.day)}</div><div class="sdate__d">${esc(s.date)}</div></div>
        <div class="sinfo">
          <div class="sinfo__time">${esc(s.time)}</div>
          <div class="sinfo__title">${esc(s.title)}</div>
          <div class="stags"><span class="${chipCls}">${esc(s.tag)}</span>
            <span class="chip ${isVote ? "chip--live" : ""}">${esc(s.status)}</span></div>
        </div>
        <div class="sright">${right}</div>`;
      schedWrap.appendChild(row);
    });
    $$("[data-book]", schedWrap).forEach((b) => b.addEventListener("click", () => openBooking(b.dataset.book)));
    $$("[data-cancel]", schedWrap).forEach((b) => b.addEventListener("click", () => cancelBooking(b.dataset.cancel)));
    observeReveal(schedWrap);
  }

  function cancelBooking(id) {
    const A = window.SEANS_API;
    if (A && A.ready && (A.state.myBookings || []).some((b) => b.id === id)) {
      A.cancelBooking(id)
        .then(() => A.refresh())
        .then(() => { renderSchedule(); toast("Бронь отменена"); })
        .catch(() => toast("Не получилось связаться с сервером — попробуй ещё раз"));
      return;
    }
    const b = state.bookings.find((x) => x.id === id);
    if (!b || !state.mine.includes(id)) return;
    state.bookings = state.bookings.filter((x) => x.id !== id);
    state.mine = state.mine.filter((x) => x !== id);
    saveBookings();
    renderSchedule();
    toast("Бронь отменена");
  }

  /* ---------- модалка брони ---------- */
  const modal = $("#bookModal"), mBody = $("#bookBody");
  const openModal = () => { modal.classList.add("open"); modal.setAttribute("aria-hidden", "false"); };
  const closeModal = () => { modal.classList.remove("open"); modal.setAttribute("aria-hidden", "true"); };
  $$("#bookModal [data-close]").forEach((n) => n.addEventListener("click", closeModal));

  function openBooking(sid) {
    const s = (C.schedule || []).find((x) => x.id === sid);
    if (!s) return;
    const left = seatsLeftFor(s);
    if (left <= 0) return;
    const maxSeats = Math.min(6, left);
    let seats = 1;
    // взнос на зал — мягкая просьба, не билет; настраивается в config/админке
    const don = (C.donation && C.donation.enabled && Number(C.donation.perSeat) > 0) ? C.donation : null;

    mBody.innerHTML = `
      <p class="eyebrow">Бронь места</p>
      <h3 class="bmodal__title">${esc(s.title)}</h3>
      <p class="bmodal__meta">${esc(s.day)}, ${esc(s.date)} · ${esc(s.time)} · свободно ${left}</p>
      <label class="bfield"><span>Как тебя зовут</span><input id="bName" maxlength="40" placeholder="Имя" autocomplete="name" /></label>
      <label class="bfield"><span>Квартира — чтобы соседи узнали своих</span><input id="bApt" maxlength="10" placeholder="№ (необязательно)" inputmode="numeric" /></label>
      <div class="bseats"><span>Сколько мест</span>
        <div class="qty"><button id="bMinus" aria-label="Меньше">−</button><b id="bCount">1</b><button id="bPlus" aria-label="Больше">+</button></div>
      </div>
      ${don ? `<div class="donate">
        <div class="donate__row"><span>${esc(don.title)} · ${Number(don.perSeat)} ₽ × <b id="bDonSeats">1</b></span><b id="bDonSum">${money(don.perSeat)}</b></div>
        <p class="donate__note">${esc(don.note)}</p>
      </div>` : ""}
      <button class="btn btn--primary btn--block" id="bGo">Забронировать</button>
      <p class="drawer__note">Бронь видна администратору зала. Передумал — отмена в один клик.</p>`;

    const updDon = () => {
      if (!don) return;
      const a = $("#bDonSeats"), b = $("#bDonSum");
      if (a) a.textContent = seats;
      if (b) b.innerHTML = money(seats * Number(don.perSeat));
    };
    $("#bMinus").onclick = () => { seats = Math.max(1, seats - 1); $("#bCount").textContent = seats; updDon(); };
    $("#bPlus").onclick = () => { seats = Math.min(maxSeats, seats + 1); $("#bCount").textContent = seats; updDon(); };
    $("#bGo").onclick = async () => {
      const nameEl = $("#bName");
      const name = nameEl.value.trim();
      if (!name) { nameEl.classList.remove("err"); void nameEl.offsetWidth; nameEl.classList.add("err"); nameEl.focus(); return; }
      const b = {
        id: "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        sid, name, apt: $("#bApt").value.trim(), seats, ts: Date.now(),
        don: don ? seats * Number(don.perSeat) : 0,
      };
      // общий счёт: бронь на сервер (все соседи видят занятые места), офлайн — локально
      const A = window.SEANS_API;
      let viaApi = false;
      if (A && A.enabled) {
        try {
          const r = await A.book({ sid, name, apt: b.apt, seats, don: b.don });
          b.id = r.id;
          viaApi = true;
          await A.refresh();
        } catch (e) { /* сервер лёг — падаем в локальный режим */ }
      }
      if (!viaApi) {
        state.bookings.push(b);
        state.mine.push(b.id);
        saveBookings();
      }
      renderSchedule();
      mBody.innerHTML = `
        <div class="ticket">
          <p class="eyebrow">Бронь подтверждена</p>
          <h3 class="bmodal__title">${esc(s.title)}</h3>
          <p class="bmodal__meta">${esc(s.day)}, ${esc(s.date)} · ${esc(s.time)}</p>
          <div class="ticket__row"><span>Гость</span><b>${esc(name)}${b.apt ? " · кв. " + esc(b.apt) : ""}</b></div>
          <div class="ticket__row"><span>Мест</span><b>${seats}</b></div>
          ${b.don ? `<div class="ticket__row"><span>${esc(don.title)} · добровольно</span><b>${money(b.don)}</b></div>` : ""}
          <div class="ticket__row"><span>Код брони</span><b class="ticket__code">${b.id.slice(-4).toUpperCase()}</b></div>
        </div>
        ${b.don && don.payHint ? `<p class="drawer__note" style="margin:-6px 0 14px">${esc(don.payHint)}</p>` : ""}
        <button class="btn btn--primary btn--block" id="bDone">Готово</button>`;
      $("#bDone").onclick = closeModal;
      toast(`Ждём тебя на <b>«${esc(s.title)}»</b>`);
    };
    openModal();
  }

  /* ============================================================
     МЕНЮ БАРА + КОРЗИНА
     ============================================================ */
  let itemIndex = {};

  function renderMenu() {
    itemIndex = {};
    (C.menu || []).forEach((g) => (g.items || []).forEach((it) => { itemIndex[it.id] = it; }));
    const wrap = $("#menu");
    wrap.innerHTML = "";
    (C.menu || []).forEach((g, gi) => {
      const group = el("div", "mgroup reveal");
      group.style.transitionDelay = (gi * 60) + "ms";
      group.appendChild(el("div", "mgroup__name", `${esc(g.category)} <span>${(g.items || []).length}</span>`));
      (g.items || []).forEach((it) => {
        const row = el("div", "mitem");
        row.innerHTML = `
          ${it.img
            ? `<span class="mitem__thumb" role="img" aria-label="${esc(it.name)}" style="background-image:url('${esc(it.img)}')"></span>`
            : `<span class="mitem__thumb--none"></span>`}
          <div class="mitem__body">
            <div class="mitem__top"><span class="mitem__name">${esc(it.name)}</span>${it.tag ? `<span class="mtag">${esc(it.tag)}</span>` : ""}</div>
            <div class="mitem__desc">${esc(it.desc)}</div>
          </div>
          <div class="mitem__right">
            <span class="mitem__price">${money(it.price)}</span>
            <button class="addbtn" data-add="${esc(it.id)}" aria-label="Добавить ${esc(it.name)}">+</button>
          </div>`;
        group.appendChild(row);
      });
      wrap.appendChild(group);
    });
    $$("[data-add]", wrap).forEach((b) => b.addEventListener("click", () => addToCart(b.dataset.add)));
    observeReveal(wrap);
  }

  function addToCart(id) {
    if (!itemIndex[id]) return;
    state.cart[id] = (state.cart[id] || 0) + 1;
    saveCart(); updateCartUI(); renderDrawer();
    const btn = $("#cartBtn"); btn.classList.remove("bump"); void btn.offsetWidth; btn.classList.add("bump");
    toast(`<b>${esc(itemIndex[id].name)}</b> — в заказе`);
  }
  function changeQty(id, d) {
    state.cart[id] = (state.cart[id] || 0) + d;
    if (state.cart[id] <= 0) delete state.cart[id];
    saveCart(); updateCartUI(); renderDrawer();
  }
  function cartTotals() {
    let count = 0, sum = 0;
    for (const id in state.cart) { count += state.cart[id]; sum += state.cart[id] * (itemIndex[id]?.price || 0); }
    return { count, sum };
  }
  // само-чинимся: выкидываем из корзины позиции, которых больше нет в меню
  function pruneCart() {
    let changed = false;
    Object.keys(state.cart).forEach((id) => { if (!itemIndex[id]) { delete state.cart[id]; changed = true; } });
    if (changed) saveCart();
  }
  function updateCartUI() {
    pruneCart();
    const { count, sum } = cartTotals();
    $("#cartCount").textContent = count;
    $("#cartSum").innerHTML = money(sum);
  }
  /* Дровер-заказ в три шага: корзина → кому заказ (имя/кв/сеанс) → билет заказа.
     Заказы копятся в localStorage — админ видит их во вкладке «Заказы». */
  let drawerStep = "cart";
  let lastOrder = null;

  const sessLabel = (sid) => {
    const s = (C.schedule || []).find((x) => x.id === sid);
    return s ? `${s.title} · ${s.day}, ${s.date} · ${s.time}` : "";
  };

  function renderDrawer() {
    const body = $("#drawerBody");
    const totalEl = $("#drawerTotal"), btn = $("#checkoutBtn"), note = $("#drawerNote");
    pruneCart();

    if (drawerStep === "form") {
      const ids = Object.keys(state.cart);
      body.innerHTML = `
        <p class="eyebrow" style="margin-top:14px">Кому готовить</p>
        ${ids.map((id) => `<div class="oline"><span>${state.cart[id]} × ${esc(itemIndex[id].name)}</span><b>${money(itemIndex[id].price * state.cart[id])}</b></div>`).join("")}
        <label class="bfield" style="margin-top:18px"><span>Как тебя зовут</span><input id="oName" maxlength="40" placeholder="Имя" autocomplete="name" /></label>
        <label class="bfield"><span>Квартира — чтобы бармен узнал своих</span><input id="oApt" maxlength="10" placeholder="№ (необязательно)" inputmode="numeric" /></label>
        <label class="bfield"><span>К какому сеансу</span>
          <select id="oSession">
            <option value="">Просто заберу в баре</option>
            ${(C.schedule || []).filter((s) => !(/голосован/i.test(s.status || "") || /голосован/i.test(s.title || "")))
              .map((s) => `<option value="${esc(s.id)}">${esc(s.title)} · ${esc(s.day)}, ${esc(s.date)} · ${esc(s.time)}</option>`).join("")}
          </select>
        </label>`;
      btn.textContent = "Подтвердить заказ";
      note.textContent = "Оплата в баре при получении.";
      totalEl.innerHTML = money(cartTotals().sum);
      return;
    }

    if (drawerStep === "done" && lastOrder) {
      body.innerHTML = `
        <div class="ticket" style="margin-top:16px">
          <p class="eyebrow">Заказ принят</p>
          <h3 class="bmodal__title">${esc(lastOrder.name)}${lastOrder.apt ? " · кв. " + esc(lastOrder.apt) : ""}</h3>
          <p class="bmodal__meta">${lastOrder.sid ? esc(sessLabel(lastOrder.sid)) : "Заберёшь в баре, когда удобно"}</p>
          ${lastOrder.items.map((i) => `<div class="ticket__row"><span>${i.qty} × ${esc(i.name)}</span><b>${money(i.price * i.qty)}</b></div>`).join("")}
          <div class="ticket__row"><span>Код заказа</span><b class="ticket__code">${lastOrder.id.slice(-4).toUpperCase()}</b></div>
        </div>`;
      btn.textContent = "Готово";
      note.textContent = "Назови бармену код или имя — заказ твой.";
      totalEl.innerHTML = money(lastOrder.total);
      return;
    }

    // шаг "cart"
    const ids = Object.keys(state.cart);
    if (!ids.length) {
      body.innerHTML = `<div class="drawer__empty">Пока пусто.<br>Добавь попкорн из меню — и в зал.</div>`;
    } else {
      body.innerHTML = "";
      ids.forEach((id) => {
        const it = itemIndex[id]; const q = state.cart[id];
        const row = el("div", "crow");
        row.innerHTML = `
          <div class="crow__name"><b>${esc(it.name)}</b><span>${money(it.price)}</span></div>
          <div class="qty">
            <button data-m="${esc(id)}" aria-label="Меньше">−</button>
            <b>${q}</b>
            <button data-p="${esc(id)}" aria-label="Больше">+</button>
          </div>`;
        body.appendChild(row);
      });
      $$("[data-m]", body).forEach((b) => b.addEventListener("click", () => changeQty(b.dataset.m, -1)));
      $$("[data-p]", body).forEach((b) => b.addEventListener("click", () => changeQty(b.dataset.p, 1)));
    }
    btn.textContent = "Оформить предзаказ";
    note.textContent = "Оплата в баре. Заказ ждёт тебя к началу сеанса.";
    totalEl.innerHTML = money(cartTotals().sum);
  }

  const drawer = $("#drawer");
  const openDrawer = () => { drawerStep = "cart"; renderDrawer(); drawer.classList.add("open"); drawer.setAttribute("aria-hidden", "false"); };
  const closeDrawer = () => { drawer.classList.remove("open"); drawer.setAttribute("aria-hidden", "true"); drawerStep = "cart"; };
  $("#cartBtn").addEventListener("click", openDrawer);
  $("#drawerClose").addEventListener("click", closeDrawer);
  $("#drawerScrim").addEventListener("click", closeDrawer);
  $("#checkoutBtn").addEventListener("click", () => {
    if (drawerStep === "cart") {
      if (!cartTotals().count) { toast("Заказ пуст — добавь что-нибудь из бара"); return; }
      drawerStep = "form";
      renderDrawer();
      $("#oName")?.focus();
      return;
    }
    if (drawerStep === "form") {
      const nameEl = $("#oName");
      const name = (nameEl?.value || "").trim();
      if (!name) { nameEl.classList.remove("err"); void nameEl.offsetWidth; nameEl.classList.add("err"); nameEl.focus(); return; }
      const items = Object.keys(state.cart).map((id) => ({
        id, name: itemIndex[id].name, price: Number(itemIndex[id].price) || 0, qty: state.cart[id],
      }));
      lastOrder = {
        id: "o" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name, apt: ($("#oApt")?.value || "").trim(), sid: $("#oSession")?.value || "",
        items, total: items.reduce((a, x) => a + x.price * x.qty, 0), ts: Date.now(),
      };
      state.orders.push(lastOrder);
      saveOrders();
      // и на сервер — чтобы админ видел заказы всех соседей
      const A = window.SEANS_API;
      if (A && A.enabled) {
        A.order({ name: lastOrder.name, apt: lastOrder.apt, sid: lastOrder.sid, items: lastOrder.items, total: lastOrder.total })
          .catch(() => {});
      }
      state.cart = {}; saveCart(); updateCartUI();
      drawerStep = "done";
      renderDrawer();
      toast(`Заказ принят, <b>${esc(name)}</b> — ждём в баре!`);
      return;
    }
    closeDrawer();   // шаг "done"
  });

  /* ============================================================
     ЗАЛ
     ============================================================ */
  function renderHall() {
    $("#hallAbout").textContent = C.hall.about;
    $("#specs").innerHTML = (C.hall.specs || []).map((s) =>
      `<div class="spec reveal"><div class="spec__val">${esc(s.value)}</div><div class="spec__label">${esc(s.label)}</div></div>`
    ).join("");
    const g = $("#gallery");
    const shots = C.gallery || [];
    g.style.display = shots.length ? "" : "none";   // нет реальных фото — блок не показываем
    g.innerHTML = shots.map((x) =>
      `<div class="gcard reveal"><img src="${esc(x.src)}" alt="${esc(x.label)}" loading="lazy" onerror="this.parentElement.style.background='linear-gradient(160deg,#1d1d25,#101014)'"/><span>${esc(x.label)}</span></div>`
    ).join("");
    observeReveal($("#hall"));
  }

  /* ============================================================
     НАВИГАЦИЯ: скролл-состояние, бургер, Esc
     ============================================================ */
  const nav = $("#nav");
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 24);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const burger = $("#burger"), mnav = $("#mnav");
  if (burger && mnav) {
    const closeM = () => { burger.classList.remove("x"); mnav.classList.remove("open"); };
    burger.addEventListener("click", () => { burger.classList.toggle("x"); mnav.classList.toggle("open"); });
    $$("a", mnav).forEach((a) => a.addEventListener("click", closeM));
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeDrawer(); closeModal(); closeFilm(); }
  });

  /* ============================================================
     СБОРКА + мост для админки
     ============================================================ */
  function renderAll() {
    renderMarquee();
    renderVoting();
    renderSchedule();
    renderMenu();
    updateCartUI();
    renderHall();
    renderSuggest();
    initHero();
  }

  window.__seans = {
    renderAll,
    renderSchedule,
    getBookings: () => state.bookings.slice(),
    removeBooking(id) {
      state.bookings = state.bookings.filter((x) => x.id !== id);
      state.mine = state.mine.filter((x) => x !== id);
      saveBookings(); renderSchedule();
    },
    clearBookings() { state.bookings = []; state.mine = []; saveBookings(); renderSchedule(); },
    resetMyVote() { state.vote = null; saveVote(); renderVoting(); },
    getOrders: () => state.orders.slice(),
    removeOrder(id) { state.orders = state.orders.filter((x) => x.id !== id); saveOrders(); },
    clearOrders() { state.orders = []; saveOrders(); },
    finishVoting,
    votingTitle,
    getSuggestions: () => state.suggestions.slice(),
    removeSuggestion(id) { state.suggestions = state.suggestions.filter((x) => x.id !== id); saveSg(); renderSuggest(); },
    clearSuggestions() { state.suggestions = []; saveSg(); renderSuggest(); },
    sync: () => syncFromServer(),
  };
  if (window.STORE) window.STORE.onChange(renderAll);

  /* ---------- синк с сервером (общий счёт для всего дома) ---------- */
  let lastContentSig = "", lastLiveSig = "";
  function applyServer(st) {
    const c = st.content;
    if (c) {
      if (Array.isArray(c.votingOptions)) C.voting.options = c.votingOptions;
      if (Array.isArray(c.menu)) C.menu = c.menu;
      if (Array.isArray(c.schedule)) C.schedule = c.schedule;
      C.votingRound = c.votingRound || null;
      if (c.donation) C.donation = c.donation;
    }
    if (st.myVote !== undefined) { state.vote = st.myVote; saveVote(); }
  }
  async function syncFromServer() {
    const A = window.SEANS_API;
    if (!A || !A.enabled) return;
    const st = await A.refresh();
    if (!st) return;
    const contentSig = JSON.stringify(st.content || null);
    const liveSig = JSON.stringify([st.votes, st.booked, st.suggestions, st.myVote, (st.myBookings || []).length]);
    if (contentSig !== lastContentSig) {
      // контент админки изменился (фильмы/меню/афиша/раунд) — полная перерисовка
      lastContentSig = contentSig; lastLiveSig = liveSig;
      applyServer(st);
      renderAll();
    } else if (liveSig !== lastLiveSig) {
      // изменились только голоса/брони/пожелания — без перезапуска героя
      lastLiveSig = liveSig;
      applyServer(st);
      renderVoting(); renderSchedule(); renderSuggest();
    }
  }

  renderAll();
  tickCountdown();
  setInterval(tickCountdown, 1000);
  observeReveal(document);
  syncFromServer();                       // первый синк сразу
  setInterval(syncFromServer, 25000);     // и дальше — живые счётчики у всех
})();
