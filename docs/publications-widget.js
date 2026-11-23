(function () {
  "use strict";

  const DEFAULTS = {
    dataUrl: "./data/publications.json",
    containerId: "pub-news",
    maxItems: 20,
    featuredCount: 5,
    featuredDays: 90,
    locale: "en-US",
    language: "en",
    cache: "daily", // "daily", "hourly", false
    showHeader: true,
    title: "Recent Publications"
  };

  const MESSAGES = {
    en: {
      loading: "Loading publications…",
      loadError: "Could not load publications.",
      empty: "No publications found.",
      invalid: "Invalid publication data format.",
      subtitle: (count) => `Showing the latest ${count} publications retrieved from ORCID profiles.`,
      noTitle: "No title",
      noAbstract: "Abstract not available — please follow the DOI link."
    },
    de: {
      loading: "Publikationen werden geladen…",
      loadError: "Publikationen konnten nicht geladen werden.",
      empty: "Keine Publikationen gefunden.",
      invalid: "Ungültiges Publikationsdatenformat.",
      subtitle: (count) => `Anzeige der neuesten ${count} Publikationen aus ORCID-Profilen.`,
      noTitle: "Ohne Titel",
      noAbstract: "Abstract nicht verfügbar – bitte dem DOI-Link folgen."
    }
  };

  function getConfig() {
    const legacy = {
      dataUrl: window.PUBLICATIONS_JSON_URL,
      containerId: window.PUBLICATIONS_CONTAINER_ID,
      maxItems: window.PUBLICATIONS_MAX_ITEMS,
      featuredCount: window.PUBLICATIONS_FEATURED_COUNT,
      locale: window.PUBLICATIONS_LOCALE,
      language: window.PUBLICATIONS_LANGUAGE
    };
    const modern = window.PUBLICATIONS_WIDGET_CONFIG || {};
    return Object.assign({}, DEFAULTS, removeEmpty(legacy), removeEmpty(modern));
  }

  function removeEmpty(obj) {
    const out = {};
    Object.keys(obj || {}).forEach((key) => {
      if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") out[key] = obj[key];
    });
    return out;
  }

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  ready(init);

  function init() {
    const config = getConfig();
    const messages = MESSAGES[config.language] || MESSAGES.en;
    const container = document.getElementById(config.containerId);
    if (!container) {
      console.warn(`Publication widget container #${config.containerId} not found.`);
      return;
    }

    container.classList.add("pub-news-widget");
    renderStatus(container, messages.loading);

    fetch(withCacheBuster(config.dataUrl, config.cache), { cache: "no-cache", credentials: "omit" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => normalizeItems(data))
      .then((items) => render(container, items, config, messages))
      .catch((error) => {
        console.error("Failed to load publication data:", error);
        renderStatus(container, messages.loadError);
      });
  }

  function normalizeItems(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.items)) return data.items;
    return null;
  }

  function render(container, items, config, messages) {
    if (!Array.isArray(items)) {
      renderStatus(container, messages.invalid);
      return;
    }

    const now = new Date();
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const maxItems = toPositiveInt(config.maxItems, DEFAULTS.maxItems);
    const earliestFeatured = today - toPositiveInt(config.featuredDays, DEFAULTS.featuredDays) * 86400000;
    const sorted = items
      .filter((item) => item && (item.title || item.doi || item.url))
      .map((item) => ({ item, date: parseDateParts(item.date) }))
      .filter(({ date }) => !date || date.timestamp <= today)
      .sort((a, b) => (b.date?.timestamp ?? -Infinity) - (a.date?.timestamp ?? -Infinity));

    if (!sorted.length) {
      renderStatus(container, messages.empty);
      return;
    }

    const featuredCount = Math.min(toPositiveInt(config.featuredCount, DEFAULTS.featuredCount), maxItems);
    const featured = sorted
      .filter(({ date }) => date?.precision === "day" && date.timestamp >= earliestFeatured)
      .slice(0, featuredCount);
    const rest = sorted.filter((entry) => !featured.includes(entry)).slice(0, maxItems - featured.length);

    const root = document.createElement("div");
    root.className = "pub-news-layout";

    if (config.showHeader !== false) {
      root.appendChild(createHeader(config.title, messages.subtitle(featured.length + rest.length)));
    }

    if (featured.length) {
      const featuredSection = document.createElement("section");
      featuredSection.className = "pub-news-featured";
      featured.forEach(({ item }, index) => {
        const card = createCard(item, true, config, messages);
        if (index === 0) card.classList.add("pub-card--featured-main");
        featuredSection.appendChild(card);
      });
      root.appendChild(featuredSection);
    }

    if (rest.length) {
      const restSection = document.createElement("section");
      restSection.className = "pub-news-rest";
      rest.forEach(({ item }) => restSection.appendChild(createCard(item, false, config, messages)));
      root.appendChild(restSection);
    }

    container.replaceChildren(root);
  }

  function createHeader(titleText, subtitleText) {
    const header = document.createElement("div");
    header.className = "pub-news-header";

    const title = document.createElement("h2");
    title.className = "pub-news-header__title";
    title.textContent = titleText || DEFAULTS.title;

    const subtitle = document.createElement("p");
    subtitle.className = "pub-news-header__subtitle";
    subtitle.textContent = subtitleText;

    header.append(title, subtitle);
    return header;
  }

  function createCard(pub, isFeatured, config, messages) {
    const card = document.createElement("article");
    card.className = "pub-card";
    if (isFeatured) card.classList.add("pub-card--featured");

    const title = document.createElement("h3");
    title.className = "pub-card__title";

    const linkUrl = safeLink(pub.url || (pub.doi ? `https://doi.org/${pub.doi}` : ""));
    if (linkUrl) {
      const link = document.createElement("a");
      link.href = linkUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = pub.title || messages.noTitle;
      title.appendChild(link);
    } else {
      title.textContent = pub.title || messages.noTitle;
    }

    const meta = document.createElement("p");
    meta.className = "pub-card__meta";
    const parts = [pub.journal, formatDate(pub.date, config.locale)].filter(Boolean);
    meta.textContent = parts.join(" · ");

    const authors = document.createElement("p");
    authors.className = "pub-card__authors";
    authors.textContent = pub.authors || "";

    const abstract = document.createElement("p");
    abstract.className = "pub-card__abstract";
    const abstractText = String(pub.abstract || "").trim();
    if (abstractText) {
      abstract.textContent = shorten(abstractText, isFeatured ? 520 : 260);
    } else {
      abstract.textContent = messages.noAbstract;
      abstract.classList.add("pub-card__abstract--muted");
    }

    card.append(title, meta, authors, abstract);
    return card;
  }

  function renderStatus(container, message) {
    const box = document.createElement("div");
    box.className = "pub-news-status";
    box.textContent = message;
    container.replaceChildren(box);
  }

  function parseDateParts(value) {
    if (!value) return null;
    const match = String(value).trim().match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2] || 1);
    const day = Number(match[3] || 1);
    const timestamp = Date.UTC(year, month - 1, day);
    const date = new Date(timestamp);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      return null;
    }
    return { timestamp, precision: match[3] ? "day" : match[2] ? "month" : "year" };
  }

  function formatDate(value, locale) {
    const parts = parseDateParts(value);
    if (!parts) return "";
    const options = parts.precision === "year"
      ? { year: "numeric", timeZone: "UTC" }
      : parts.precision === "month"
        ? { year: "numeric", month: "short", timeZone: "UTC" }
        : { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" };
    return new Intl.DateTimeFormat(locale || "en-US", options).format(parts.timestamp);
  }

  function shorten(text, maxLen) {
    const max = toPositiveInt(maxLen, 250);
    if (text.length <= max) return text;
    return text.slice(0, max - 1).trimEnd() + "…";
  }

  function toPositiveInt(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  }

  function safeLink(value) {
    if (!value) return "";
    try {
      const url = new URL(value, window.location.href);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch (_) {
      return "";
    }
  }

  function withCacheBuster(url, mode) {
    if (!mode) return url;
    const now = new Date();
    const stamp = mode === "hourly"
      ? now.toISOString().slice(0, 13)
      : now.toISOString().slice(0, 10);
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}v=${encodeURIComponent(stamp)}`;
  }
})();
