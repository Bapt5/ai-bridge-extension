// AI Bridge — Popup Script v3
// All event listeners attached in JS (Firefox CSP blocks inline onclick)

const SUPPORTED_DOMAINS = [
  "chatgpt.com", "chat.openai.com",
  "gemini.google.com",
  "claude.ai",
  "copilot.microsoft.com", "www.bing.com",
  "poe.com",
  "chat.mistral.ai", "mistral.ai",
  "perplexity.ai",
];

const DEFAULT_PROMPT_TEMPLATE =
`Tu vas recevoir une conversation exportée depuis {{provider}}.
Titre de la conversation : "{{title}}"

Cette conversation a été importée depuis un autre assistant IA. Elle a eu lieu entre moi (désigné par "Moi :") et l'IA (désigné par "IA :"). Continue cette conversation en prenant conscience du contexte ci-dessous, comme si tu en faisais partie depuis le début. Réponds de façon naturelle, cohérente avec l'historique.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HISTORIQUE DE LA CONVERSATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{{conversation}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

La conversation ci-dessus est maintenant ton contexte. Tu peux maintenant continuer à partir de là.`;

let extractedData = null;
let currentPromptTab = "default";
let currentUrl = null;

// ── Helpers ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showToast(msg, type = "success") {
  const t = $("toast");
  t.textContent = msg;
  t.className = `toast show ${type}`;
  setTimeout(() => t.classList.remove("show"), 2500);
}

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  currentUrl = tab.url;

  const url = new URL(tab.url);
  const isSupported = SUPPORTED_DOMAINS.some(d => url.hostname.includes(d));
  const badge = $("provider-badge");
  const providerName = $("provider-name");

  if (!isSupported) {
    $("state-unsupported").style.display = "block";
    providerName.textContent = "Non supporté";
    return;
  }

  try {
    const res = await browser.tabs.sendMessage(tab.id, { action: "ping" });
    if (res && res.provider) {
      providerName.textContent = res.provider;
      badge.classList.add("active");
    }
  } catch {
    providerName.textContent = "Détecté";
    badge.classList.add("active");
  }

  $("state-main").style.display = "block";

  // Restore settings
  const stored = await browser.storage.local.get(["customPrompt", "customTab"]);
  if (stored.customPrompt) $("custom-prompt").value = stored.customPrompt;
  if (stored.customTab === "custom") switchTab("custom", false);

  // Restore cached extraction for this URL
  const urlKey = urlToKey(tab.url);
  const saved = await browser.storage.local.get(urlKey);
  if (saved[urlKey]) {
    try {
      const data = JSON.parse(saved[urlKey]);
      extractedData = data;
      displayExtracted(data, true);
    } catch (_) {}
  }

  // ── Attach all event listeners ──
  $("btn-extract").addEventListener("click", extractConversation);

  $("tab-default").addEventListener("click", () => switchTab("default"));
  $("tab-custom").addEventListener("click", () => switchTab("custom"));

  $("btn-regen").addEventListener("click", () => buildPrompt());
  $("btn-copy").addEventListener("click", () => copyPrompt());

  $("cache-indicator").addEventListener("click", () => extractConversation());

  $("custom-prompt").addEventListener("input", () => {
    browser.storage.local.set({ customPrompt: $("custom-prompt").value });
    if (extractedData) buildPrompt();
  });
});

function urlToKey(url) {
  try {
    return "ex_" + btoa(encodeURIComponent(url)).replace(/[^a-zA-Z0-9]/g, "").slice(0, 80);
  } catch {
    return "ex_fallback";
  }
}

// ── Extract ────────────────────────────────────────────────────────────────
async function extractConversation() {
  const btn = $("btn-extract");
  const errEl = $("extract-error");
  const isGemini = currentUrl && currentUrl.includes("gemini.google.com");

  btn.disabled = true;
  btn.innerHTML = isGemini
    ? "<span>⟳</span> Chargement des messages… (≤15s)"
    : "<span>⟳</span> Extraction en cours…";
  errEl.style.display = "none";

  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const res = await browser.tabs.sendMessage(tabs[0].id, { action: "extractConversation" });

    if (!res || !res.success) throw new Error(res?.error || "Impossible d'extraire.");

    const data = res.data;
    if (!data.messages || data.messages.length === 0) {
      throw new Error(
        isGemini
          ? "Aucun message trouvé. Assure-toi que la conversation est bien chargée."
          : "Aucun message trouvé. La page est peut-être en cours de chargement."
      );
    }

    extractedData = data;
    const key = urlToKey(tabs[0].url);
    await browser.storage.local.set({ [key]: JSON.stringify(data) });
    displayExtracted(data, false);

  } catch (err) {
    errEl.textContent = "⚠ " + err.message;
    errEl.style.display = "block";
    btn.disabled = false;
    btn.innerHTML = "<span>⬇</span> Réessayer";
  }
}

// ── Display ────────────────────────────────────────────────────────────────
function displayExtracted(data, fromCache) {
  const btn = $("btn-extract");
  btn.disabled = false;
  btn.innerHTML = fromCache ? "<span>↺</span> Ré-extraire" : "<span>✓</span> Extraire à nouveau";

  const userCount = data.messages.filter(m => m.role === "user").length;
  const aiCount = data.messages.filter(m => m.role === "assistant").length;
  $("stat-msgs").textContent = data.messages.length;
  $("stat-user").textContent = userCount;
  $("stat-ai").textContent = aiCount;
  $("stats-bar").style.display = "flex";

  const cacheEl = $("cache-indicator");
  if (fromCache) {
    const d = new Date(data.extractedAt);
    const t = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    cacheEl.textContent = `↺ Résultat de ${t} — cliquer pour ré-extraire`;
    cacheEl.style.display = "block";
  } else {
    cacheEl.style.display = "none";
  }

  const scroll = $("preview-scroll");
  scroll.innerHTML = "";
  data.messages.slice(0, 8).forEach(m => {
    const line = document.createElement("div");
    line.className = "msg-line " + (m.role === "user" ? "msg-user" : "msg-ai");
    const prefix = m.role === "user" ? "Moi" : "IA";
    const truncated = m.text.length > 120 ? m.text.slice(0, 120) + "…" : m.text;
    line.textContent = `${prefix} : ${truncated}`;
    scroll.appendChild(line);
  });
  if (data.messages.length > 8) {
    const more = document.createElement("div");
    more.className = "msg-line";
    more.style.color = "var(--muted)";
    more.textContent = `… et ${data.messages.length - 8} messages de plus`;
    scroll.appendChild(more);
  }

  $("preview-title").textContent = data.title;
  $("preview-wrap").style.display = "block";
  $("divider-1").style.display = "block";
  $("prompt-section").style.display = "block";

  buildPrompt();
}

// ── Build prompt ───────────────────────────────────────────────────────────
function buildPrompt() {
  if (!extractedData) return;

  const conversation = extractedData.messages
    .map(m => `${m.role === "user" ? "Moi" : "IA"} : ${m.text}`)
    .join("\n\n");

  const customText = $("custom-prompt").value.trim();
  const template = (currentPromptTab === "custom" && customText)
    ? customText
    : DEFAULT_PROMPT_TEMPLATE;

  const final = template
    .replace(/\{\{provider\}\}/g, extractedData.provider)
    .replace(/\{\{title\}\}/g, extractedData.title)
    .replace(/\{\{conversation\}\}/g, conversation);

  $("output-scroll").textContent = final;
  $("output-scroll").classList.add("has-content");
  $("output-chars").textContent = `${final.length.toLocaleString()} car.`;

  window._finalPrompt = final;
  $("btn-copy").disabled = false;
  $("btn-regen").disabled = false;
}

// ── Copy — triple fallback ─────────────────────────────────────────────────
async function copyPrompt() {
  const text = window._finalPrompt;
  if (!text) return;

  const btn = $("btn-copy");
  btn.disabled = true;

  // Fallback 1: navigator.clipboard (works if popup has focus)
  try {
    await navigator.clipboard.writeText(text);
    onCopied(btn);
    return;
  } catch (_) {}

  // Fallback 2: background script injects execCommand in the active page
  try {
    const res = await browser.runtime.sendMessage({ action: "copyToClipboard", text });
    if (res && res.success) { onCopied(btn); return; }
  } catch (_) {}

  // Fallback 3: textarea select in popup itself — user presses Ctrl+C
  btn.disabled = false;
  const ta = document.createElement("textarea");
  ta.value = text;
  Object.assign(ta.style, {
    position: "fixed", top: "0", left: "0", width: "100%", height: "56px",
    opacity: "1", zIndex: "9999", fontSize: "10px",
    background: "#1e1e28", color: "#e8e8f0",
    border: "2px solid var(--accent)", borderRadius: "6px", padding: "6px",
  });
  document.body.appendChild(ta);
  ta.focus();
  ta.select();

  const hint = document.createElement("div");
  hint.textContent = "Appuie sur Ctrl+C puis ferme";
  Object.assign(hint.style, {
    position: "fixed", top: "60px", left: "0", right: "0",
    textAlign: "center", fontSize: "11px", color: "var(--accent)", zIndex: "9999",
  });
  document.body.appendChild(hint);
  setTimeout(() => { ta.remove(); hint.remove(); }, 7000);
}

function onCopied(btn) {
  btn.disabled = false;
  btn.classList.add("copied");
  btn.innerHTML = "✓ Copié !";
  showToast("Prompt copié dans le presse-papier !", "success");
  setTimeout(() => {
    btn.classList.remove("copied");
    btn.innerHTML = "⎘ Copier le prompt";
  }, 2000);
}

// ── Tab switching ──────────────────────────────────────────────────────────
function switchTab(tab, rebuild = true) {
  currentPromptTab = tab;
  $("tab-default").classList.toggle("active", tab === "default");
  $("tab-custom").classList.toggle("active", tab === "custom");
  $("prompt-custom-wrap").style.display = tab === "custom" ? "block" : "none";
  browser.storage.local.set({ customTab: tab });
  if (rebuild && extractedData) buildPrompt();
}
