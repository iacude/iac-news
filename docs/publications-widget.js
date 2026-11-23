(function () {
  "use strict";

  const DEFAULTS = {
    dataUrl: "./data/publications.json",
    mediaUrl: null,
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
      count: (shown, total) => shown === total ? `${total} publications` : `${shown} of ${total} publications`,
      filter: "Filter by author",
      allAuthors: "All authors",
      authorAction: (name) => `Filter by ${name}`,
      featured: "New publications",
      graphical: "Graphical abstracts",
      graphicalAbstract: "Graphical abstract",
      more: "More publications",
      abstract: "Abstract",
      noTitle: "No title"
    },
    de: {
      loading: "Publikationen werden geladen…",
      loadError: "Publikationen konnten nicht geladen werden.",
      empty: "Keine Publikationen gefunden.",
      invalid: "Ungültiges Publikationsdatenformat.",
      count: (shown, total) => shown === total ? `${total} Publikationen` : `${shown} von ${total} Publikationen`,
      filter: "Nach Autor filtern",
      allAuthors: "Alle Autorinnen und Autoren",
      authorAction: (name) => `Nach ${name} filtern`,
      featured: "Neue Publikationen",
      graphical: "Graphical Abstracts",
      graphicalAbstract: "Graphical Abstract",
      more: "Weitere Publikationen",
      abstract: "Abstract",
      noTitle: "Ohne Titel"
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

    Promise.all([
      loadJson(config.dataUrl, config.cache).then(normalizeItems),
      loadMedia(config)
    ])
      .then(([items, media]) => render(container, items, config, messages, media))
      .catch((error) => {
        console.error("Failed to load publication data:", error);
        renderStatus(container, messages.loadError);
      });
  }

  async function loadJson(url, cache) {
    const response = await fetch(withCacheBuster(url, cache), { cache: "no-cache", credentials: "omit" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function loadMedia(config) {
    if (config.mediaUrl === false) return {};
    try {
      const dataUrl = new URL(config.dataUrl, window.location.href);
      const url = config.mediaUrl || new URL("publication-media.json", dataUrl).href;
      return (await loadJson(url, config.cache)) || {};
    } catch (_) {
      return {};
    }
  }

  function normalizeItems(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.items)) return data.items;
    return null;
  }

  function render(container, items, config, messages, media = {}) {
    if (!Array.isArray(items)) {
      renderStatus(container, messages.invalid);
      return;
    }

    const now = new Date();
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const maxItems = toPositiveInt(config.maxItems, DEFAULTS.maxItems);
    const earliestFeatured = today - toPositiveInt(config.featuredDays, DEFAULTS.featuredDays) * 86400000;
    const authorDirectory = indexAuthors(media.authors);
    const sorted = items
      .filter((item) => item && (item.title || item.doi || item.url))
      .map((item) => ({
        item,
        date: parseDateParts(item.date),
        authors: publicationAuthors(item.authors, authorDirectory)
      }))
      .filter(({ date }) => !date || date.timestamp <= today)
      .sort((a, b) => (b.date?.timestamp ?? -Infinity) - (a.date?.timestamp ?? -Infinity));

    if (!sorted.length) {
      renderStatus(container, messages.empty);
      return;
    }

    const root = document.createElement("div");
    root.className = "pub-news-layout";

    if (config.showHeader !== false) {
      const header = document.createElement("header");
      header.className = "pub-news-header";
      const title = document.createElement("h2");
      title.className = "pub-news-header__title";
      title.textContent = config.title || DEFAULTS.title;
      header.appendChild(title);
      root.appendChild(header);
    }

    const toolbar = document.createElement("div");
    toolbar.className = "pub-news-toolbar";
    const authorOptions = new Map();
    sorted.forEach(({ authors }) => authors.forEach((author) => authorOptions.set(author.id, author.name)));

    const select = document.createElement("select");
    select.appendChild(new Option(messages.allAuthors, ""));
    const byName = new Intl.Collator(config.locale);
    [...authorOptions]
      .sort(([, a], [, b]) => byName.compare(a, b))
      .forEach(([id, name]) => select.appendChild(new Option(name, id)));

    if (authorOptions.size) {
      const label = document.createElement("label");
      label.className = "pub-news-toolbar__filter";
      const caption = document.createElement("span");
      caption.textContent = messages.filter;
      label.append(caption, select);
      toolbar.appendChild(label);
    }

    const count = document.createElement("span");
    count.className = "pub-news-toolbar__count";
    count.setAttribute("role", "status");
    toolbar.appendChild(count);
    root.appendChild(toolbar);

    const results = document.createElement("div");
    results.className = "pub-news-results";
    root.appendChild(results);

    function selectAuthor(id) {
      select.value = select.value === id ? "" : id;
      renderResults();
      select.focus();
    }

    function renderResults() {
      const selected = select.value;
      const matching = selected ? sorted.filter(({ authors }) => authors.some(({ id }) => id === selected)) : sorted;
      const featuredCount = Math.min(toPositiveInt(config.featuredCount, DEFAULTS.featuredCount), maxItems);
      const featured = matching
        .filter(({ date }) => date?.precision === "day" && date.timestamp >= earliestFeatured)
        .slice(0, featuredCount);
      const rest = matching.filter((entry) => !featured.includes(entry)).slice(0, maxItems - featured.length);
      const graphical = rest.filter(({ item }) => graphicalAbstract(item, media));
      const other = rest.filter((entry) => !graphical.includes(entry));

      count.textContent = messages.count(featured.length + rest.length, matching.length);
      results.replaceChildren();
      appendSection(results, featured, "featured", messages.featured, config, messages, media, selectAuthor, selected);
      appendSection(results, graphical, "graphical", messages.graphical, config, messages, media, selectAuthor, selected);
      appendSection(results, other, "rest", messages.more, config, messages, media, selectAuthor, selected);
    }

    select.addEventListener("change", renderResults);
    renderResults();
    container.replaceChildren(root);
  }

  function authorKey(name) {
    return name.normalize("NFKC").toLowerCase().replaceAll(".", "").replace(/\s+/g, " ").trim();
  }

  function indexAuthors(authors) {
    const directory = new Map();
    Object.entries(authors || {}).forEach(([id, entry]) => {
      if (typeof entry?.name !== "string" || !entry.name.trim()) return;
      const person = { ...entry, id };
      const names = [entry.name, ...(Array.isArray(entry.aliases) ? entry.aliases : [])];
      names.filter((name) => typeof name === "string" && name.trim()).forEach((name) => {
        const key = authorKey(name);
        const existing = directory.get(key);
        if (!directory.has(key) || existing?.id === id) directory.set(key, person);
        else directory.set(key, null);
      });
    });
    return directory;
  }

  function publicationAuthors(value, directory) {
    const people = new Map();
    String(value || "").split(",").map((name) => name.trim()).filter(Boolean).forEach((name) => {
      const key = authorKey(name);
      const person = directory.get(key) || { id: `name:${key}`, name };
      if (!people.has(person.id)) people.set(person.id, person);
    });
    return [...people.values()];
  }

  function appendSection(root, entries, layout, label, config, messages, media, selectAuthor, selected) {
    if (!entries.length) return;
    const section = document.createElement("section");
    section.className = `pub-news-section pub-news-section--${layout}`;
    const heading = document.createElement(config.showHeader === false ? "h2" : "h3");
    heading.className = "pub-news-section__title";
    heading.textContent = label;
    const grid = document.createElement("div");
    grid.className = "pub-news-grid";
    entries.forEach((entry, index) => {
      const lead = layout === "featured" && index === 0;
      grid.appendChild(createCard(entry, lead, config, messages, media, selectAuthor, selected));
    });
    section.append(heading, grid);
    root.appendChild(section);
  }

  function createCard({ item: pub, authors }, lead, config, messages, media, selectAuthor, selected) {
    const card = document.createElement("article");
    card.className = "pub-card";
    if (lead) card.classList.add("pub-card--lead");

    const body = document.createElement("div");
    body.className = "pub-card__body";
    const heading = document.createElement("div");
    heading.className = "pub-card__heading";
    body.appendChild(heading);

    const meta = document.createElement("p");
    meta.className = "pub-card__meta";
    meta.textContent = [pub.journal, formatDate(pub.date, config.locale)].filter(Boolean).join(" · ");
    if (meta.textContent) heading.appendChild(meta);

    const title = document.createElement(config.showHeader === false ? "h3" : "h4");
    title.className = "pub-card__title";
    const titleText = pub.title || messages.noTitle;
    const url = safeLink(pub.url) || safeLink(pub.doi ? `https://doi.org/${pub.doi}` : "");
    if (url) title.appendChild(externalLink(url, titleText));
    else title.textContent = titleText;
    heading.appendChild(title);

    if (authors.length) heading.appendChild(createAuthors(authors, messages, selectAuthor, selected));

    const abstract = String(pub.abstract || "").trim();
    if (abstract) body.appendChild(createAbstract(abstract, lead, messages.abstract));

    card.appendChild(body);
    const graphic = graphicalAbstract(pub, media);
    if (graphic) card.prepend(createGraphic(graphic, titleText, messages.graphicalAbstract));
    return card;
  }

  function createAbstract(abstract, lead, label) {
    const excerpt = document.createElement("div");
    excerpt.className = "pub-card__excerpt";
    if (lead) {
      const preview = document.createElement("p");
      preview.className = "pub-card__preview";
      preview.textContent = shorten(abstract, 260);
      excerpt.appendChild(preview);
    }
    if (!lead || abstract.length > 260) {
      const details = document.createElement("details");
      details.className = "pub-card__details";
      const summary = document.createElement("summary");
      summary.textContent = label;
      const paragraph = document.createElement("p");
      paragraph.textContent = abstract;
      details.append(summary, paragraph);
      excerpt.appendChild(details);
    }

    return excerpt;
  }

  function graphicalAbstract(pub, media) {
    const doi = String(pub.doi || "").trim().toLowerCase();
    const entry = media.graphicalAbstracts?.[doi];
    return entry && safeLink(entry.image) ? entry : null;
  }

  function createGraphic(graphic, title, label) {
    const figure = document.createElement("figure");
    figure.className = "pub-card__graphic";
    const url = safeLink(graphic.image);
    const link = externalLink(url, "");
    const image = document.createElement("img");
    image.alt = graphic.alt || `${label}: ${title}`;
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => figure.remove(), { once: true });
    image.src = url;
    link.appendChild(image);
    const caption = document.createElement("figcaption");
    caption.textContent = label;
    const license = safeLink(graphic.licenseUrl);
    if (graphic.license && license) {
      caption.append(" · ", externalLink(license, graphic.license));
    }
    figure.append(link, caption);
    return figure;
  }

  function createAuthors(people, messages, selectAuthor, selected) {
    const authors = document.createElement("div");
    authors.className = "pub-card__authors";
    const stack = document.createElement("div");
    stack.className = "pub-card__portraits";

    people.filter((person) => safeLink(person.image)).slice(0, 4).forEach((person) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pub-card__portrait";
      button.title = person.name;
      button.setAttribute("aria-label", messages.authorAction(person.name));
      button.setAttribute("aria-pressed", String(person.id === selected));
      button.addEventListener("click", () => selectAuthor(person.id));

      const image = document.createElement("img");
      image.alt = "";
      image.width = 34;
      image.height = 34;
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => {
        button.remove();
        if (!stack.childElementCount) stack.remove();
      }, { once: true });
      const position = person.position;
      if (Array.isArray(position) && position.length === 2 && position.every((value) => Number.isFinite(value) && value >= 0 && value <= 100)) {
        image.style.objectPosition = `${position[0]}% ${position[1]}%`;
      }
      button.appendChild(image);
      stack.appendChild(button);
      image.src = safeLink(person.image);
    });

    if (stack.childElementCount) authors.appendChild(stack);
    const names = document.createElement("span");
    names.textContent = people.map(({ name }) => name).join(", ");
    authors.appendChild(names);
    return authors;
  }

  function externalLink(url, text) {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = text;
    return link;
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
    const cut = text.slice(0, max - 1);
    const lastSpace = cut.lastIndexOf(" ");
    return (lastSpace > max * .8 ? cut.slice(0, lastSpace) : cut.trimEnd()) + "…";
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
