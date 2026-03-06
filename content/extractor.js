// AI Bridge — Content Script v4
// Gemini: API-based extraction (no DOM scroll needed)
// ChatGPT, Claude: DOM-based with scroll
// Selectors verified against real exported HTML files

(function () {
  "use strict";

  const PROVIDERS = {
    "chatgpt.com": "ChatGPT",
    "chat.openai.com": "ChatGPT",
    "gemini.google.com": "Gemini",
    "claude.ai": "Claude",
    "copilot.microsoft.com": "Copilot",
    "www.bing.com": "Copilot",
    "poe.com": "Poe",
    "chat.mistral.ai": "Mistral",
    "mistral.ai": "Mistral",
    "perplexity.ai": "Perplexity",
  };

  function getProvider() {
    const h = window.location.hostname;
    for (const [domain, name] of Object.entries(PROVIDERS)) {
      if (h.includes(domain)) return name;
    }
    return "Unknown AI";
  }

  function getConversationTitle() {
    const hostname = window.location.hostname;

    // ── Claude ──
    // data-testid="chat-title-button" > div > div.truncate.font-base-bold
    if (hostname.includes("claude.ai")) {
      const el = document.querySelector('[data-testid="chat-title-button"] .truncate');
      if (el && el.textContent.trim()) return el.textContent.trim();
    }

    // ── Gemini ──
    // 1. top-bar-actions contains the active conversation title as direct text
    // 2. Fallback: a.conversation.selected in sidebar chat-history
    if (hostname.includes("gemini.google.com")) {
      const topBar = document.querySelector("top-bar-actions");
      if (topBar) {
        // top-bar-actions renders the title as its first non-empty text node / child
        // Strip button labels like "Share", "Obtenir Plus", etc.
        const clone = topBar.cloneNode(true);
        clone.querySelectorAll("button, mat-menu, bard-mode-switcher").forEach(n => n.remove());
        const title = clone.textContent.trim();
        if (title && title.length > 2) return title;
      }
      // Fallback: selected entry in sidebar
      const selected = document.querySelector(".chat-history a.selected, .chat-history .conversation.selected");
      if (selected && selected.textContent.trim()) return selected.textContent.trim();
    }

    // ── ChatGPT ──
    // document.title = "SGDF - Réunion scout et infos" (full conv title, no ChatGPT suffix)
    // Only strip known trailing suffixes " - ChatGPT" or " | ChatGPT"
    if (hostname.includes("chatgpt.com") || hostname.includes("openai.com")) {
      const title = document.title.replace(/\s*[|\-]\s*ChatGPT\s*$/i, "").trim();
      if (title && title !== "New chat" && title !== "ChatGPT") return title;
      // Fallback: active conversation in sidebar nav
      const active = document.querySelector('nav [aria-current="page"] .truncate, nav li [class*="font-semibold"] .truncate');
      if (active && active.textContent.trim()) return active.textContent.trim();
    }

    // ── Generic fallback ──
    const h1 = document.querySelector("h1");
    if (h1 && h1.textContent.trim()) return h1.textContent.trim();

    return document.title.trim() || "Conversation importée";
  }

  // ── GEMINI — API extraction ───────────────────────────────────────────────
  // Instead of trying to scroll the virtualized DOM, we replay the same API
  // call Gemini makes to load conversation history (rpcid=hNvQHb).
  // All required tokens (at, bl, f.sid) are embedded in the page's HTML.
  async function extractGemini() {
    // 1. Extract conversation ID from URL: /app/<conv_id>
    const convIdMatch = window.location.pathname.match(/\/app\/([a-f0-9]+)/);
    if (!convIdMatch) throw new Error("Impossible de trouver l'ID de conversation dans l'URL.");
    const convId = "c_" + convIdMatch[1];

    // 2. Extract tokens from the page HTML (embedded in initial JSON data)
    const html = document.documentElement.innerHTML;

    const atMatch = html.match(/"SNlM0e":"([^"]+)"/);
    const blMatch = html.match(/"cfb2h":"([^"]+)"/);
    const sidMatch = html.match(/"FdrFJe":"(-?\d+)"/);

    if (!atMatch) throw new Error("Token 'at' introuvable dans la page (SNlM0e).");
    if (!blMatch) throw new Error("Token 'bl' introuvable dans la page (cfb2h).");

    const atToken = atMatch[1];
    const blToken = blMatch[1];
    const fSid = sidMatch ? sidMatch[1] : "";

    // 3. Build the batchexecute request (mirrors exactly what Gemini sends)
    // f.req payload: [[["hNvQHb","[\"<convId>\",<count>,null,1,[1],[4],null,1]",null,"generic"]]]
    // count=100 to get all messages (Gemini caps at ~100 per request)
    const fReqInner = JSON.stringify([convId, 100, null, 1, [1], [4], null, 1]);
    const fReq = JSON.stringify([[["hNvQHb", fReqInner, null, "generic"]]]);

    const urlParams = new URLSearchParams({
      rpcids: "hNvQHb",
      "source-path": window.location.pathname,
      bl: blToken,
      "f.sid": fSid,
      hl: document.documentElement.lang || "fr",
      rt: "c",
    });

    const body = new URLSearchParams({ "f.req": fReq, at: atToken });

    const resp = await fetch(
      `https://gemini.google.com/_/BardChatUi/data/batchexecute?${urlParams}`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: body.toString(),
      }
    );

    if (!resp.ok) throw new Error(`API Gemini erreur HTTP ${resp.status}`);

    const text = await resp.text();

    // 4. Parse the response: )]}'\n\n<size>\n[[...]]
    // Extract the inner JSON string from wrb.fr wrapper
    const wrbMatch = text.match(/\["wrb\.fr","hNvQHb","([\s\S]+?)",null,null,null,"generic"\]/);
    if (!wrbMatch) throw new Error("Réponse API Gemini inattendue (wrb.fr introuvable).");

    // Double-unescape the inner JSON string
    let innerStr;
    try {
      innerStr = wrbMatch[1].replace(/\\n/g, "\n").replace(/\\t/g, "\t");
      // Standard JSON unescape
      innerStr = JSON.parse('"' + wrbMatch[1] + '"');
    } catch {
      // Fallback: manual decode
      innerStr = wrbMatch[1]
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\")
        .replace(/\\n/g, "\n")
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    }

    const inner = JSON.parse(innerStr);
    const rawTurns = inner[0];
    if (!rawTurns || !rawTurns.length) throw new Error("Aucun tour trouvé dans la réponse API.");

    // 5. Extract messages
    // Turn structure (verified):
    //   turn[2][0][0] = user text (string)
    //   turn[3][0][0][1][0] = AI text (string, markdown)
    // Turns are in REVERSE chronological order → reverse them
    const messages = [];
    for (const turn of [...rawTurns].reverse()) {
      let userText = "";
      let aiText = "";

      try {
        const t2 = turn[2];
        if (Array.isArray(t2) && Array.isArray(t2[0]) && typeof t2[0][0] === "string") {
          userText = t2[0][0].trim();
        }
      } catch (_) {}

      try {
        aiText = turn[3][0][0][1][0].trim();
        // Clean escaped markdown artifacts (\\! → !)
        aiText = aiText.replace(/\\\\/g, "\\").replace(/\\!/g, "!").replace(/\\\[/g, "[").replace(/\\\]/g, "]");
      } catch (_) {}

      if (userText) messages.push({ role: "user", text: userText });
      if (aiText) messages.push({ role: "assistant", text: aiText });
    }

    return messages;
  }

  // ── Scroll-to-load helper (for non-Gemini providers) ─────────────────────
  function scrollToLoadAll(hostname) {
    return new Promise((resolve) => {
      let container = null;

      if (hostname.includes("chatgpt.com") || hostname.includes("openai.com")) {
        container = Array.from(document.querySelectorAll('[class*="overflow-y-auto"]'))
          .find(el => el.querySelectorAll('[data-message-author-role]').length > 0);
      } else if (hostname.includes("claude.ai")) {
        container = Array.from(document.querySelectorAll('[class*="overflow-y-auto"]'))
          .find(el => el.querySelectorAll('[data-testid="user-message"]').length > 0);
      } else {
        try {
          container = Array.from(document.querySelectorAll("*"))
            .filter(el => {
              const s = window.getComputedStyle(el);
              return (s.overflowY === "auto" || s.overflowY === "scroll") && el.scrollHeight > 1500;
            })
            .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
        } catch (_) {}
      }

      if (!container) { resolve(); return; }

      const savedTop = container.scrollTop;
      let lastH = -1;
      let stable = 0;

      const iv = setInterval(() => {
        container.scrollTop = 0;
        const h = container.scrollHeight;
        if (h === lastH) {
          if (++stable >= 4) {
            clearInterval(iv);
            setTimeout(() => { container.scrollTop = savedTop; resolve(); }, 200);
          }
        } else { stable = 0; lastH = h; }
      }, 400);

      setTimeout(() => { clearInterval(iv); container.scrollTop = savedTop; resolve(); }, 15000);
    });
  }

  // ── CHATGPT ───────────────────────────────────────────────────────────────
  function extractChatGPT() {
    const messages = [];
    document.querySelectorAll("[data-message-author-role]").forEach((turn) => {
      const role = turn.getAttribute("data-message-author-role");
      if (role !== "user" && role !== "assistant") return;
      const contentEl = turn.querySelector(".markdown, .prose");
      const text = (contentEl || turn).textContent.trim();
      if (text) messages.push({ role, text });
    });
    return messages;
  }

  // ── CLAUDE ────────────────────────────────────────────────────────────────
  function extractClaude() {
    const messages = [];
    const firstUserMsg = document.querySelector('[data-testid="user-message"]');
    if (!firstUserMsg) return messages;

    let el = firstUserMsg;
    for (let i = 0; i < 6; i++) {
      if (!el.parentElement) break;
      el = el.parentElement;
    }
    const container = el.parentElement;
    if (!container) return messages;

    for (const child of container.children) {
      const userMsg = child.querySelector('[data-testid="user-message"]');
      if (userMsg) {
        const text = userMsg.textContent.trim();
        if (text) messages.push({ role: "user", text });
      } else {
        const contents = child.querySelector("div.contents");
        const text = (contents || child).textContent.trim();
        if (text) messages.push({ role: "assistant", text });
      }
    }
    return messages;
  }

  // ── COPILOT ───────────────────────────────────────────────────────────────
  function extractCopilot() {
    const messages = [];
    const userEls = document.querySelectorAll('[data-author="user"], cib-chat-turn [class*="user"]');
    const aiEls = document.querySelectorAll('[data-author="bot"], cib-message-group[source="bot"]');
    const maxLen = Math.max(userEls.length, aiEls.length);
    for (let i = 0; i < maxLen; i++) {
      if (userEls[i]) messages.push({ role: "user", text: userEls[i].textContent.trim() });
      if (aiEls[i]) messages.push({ role: "assistant", text: aiEls[i].textContent.trim() });
    }
    return messages;
  }

  // ── PERPLEXITY ────────────────────────────────────────────────────────────
  function extractPerplexity() {
    const messages = [];
    const userEls = document.querySelectorAll('[class*="user-query"], [data-testid*="user"]');
    const aiEls = document.querySelectorAll('[class*="answer-content"], .prose');
    const maxLen = Math.max(userEls.length, aiEls.length);
    for (let i = 0; i < maxLen; i++) {
      if (userEls[i]) messages.push({ role: "user", text: userEls[i].textContent.trim() });
      if (aiEls[i]) messages.push({ role: "assistant", text: aiEls[i].textContent.trim() });
    }
    return messages;
  }

  // ── MISTRAL ───────────────────────────────────────────────────────────────
  function extractMistral() {
    const messages = [];
    const userEls = document.querySelectorAll('[class*="human"], [data-role="user"]');
    const aiEls = document.querySelectorAll('[class*="assistant"], [data-role="assistant"]');
    const maxLen = Math.max(userEls.length, aiEls.length);
    for (let i = 0; i < maxLen; i++) {
      if (userEls[i]) messages.push({ role: "user", text: userEls[i].textContent.trim() });
      if (aiEls[i]) messages.push({ role: "assistant", text: aiEls[i].textContent.trim() });
    }
    return messages;
  }

  // ── GENERIC ───────────────────────────────────────────────────────────────
  function extractGeneric() {
    const messages = [];
    const userEls = document.querySelectorAll('[data-role="user"], [data-author="user"], .user-message');
    const aiEls = document.querySelectorAll('[data-role="assistant"], [data-author="assistant"], .ai-message, .bot-message');
    const maxLen = Math.max(userEls.length, aiEls.length);
    for (let i = 0; i < maxLen; i++) {
      if (userEls[i]) messages.push({ role: "user", text: userEls[i].textContent.trim() });
      if (aiEls[i]) messages.push({ role: "assistant", text: aiEls[i].textContent.trim() });
    }
    return messages;
  }

  // ── Main ──────────────────────────────────────────────────────────────────
  async function extractConversation() {
    const provider = getProvider();
    const hostname = window.location.hostname;
    let messages = [];

    if (hostname.includes("gemini.google.com")) {
      // API-based: no scroll needed, gets ALL messages instantly
      messages = await extractGemini();
    } else {
      // DOM-based: scroll first to load lazy content
      await scrollToLoadAll(hostname);

      if (hostname.includes("chatgpt.com") || hostname.includes("openai.com"))
        messages = extractChatGPT();
      else if (hostname.includes("claude.ai"))
        messages = extractClaude();
      else if (hostname.includes("copilot.microsoft.com") || hostname.includes("bing.com"))
        messages = extractCopilot();
      else if (hostname.includes("perplexity.ai"))
        messages = extractPerplexity();
      else if (hostname.includes("mistral.ai"))
        messages = extractMistral();
      else
        messages = extractGeneric();
    }

    messages = messages.filter(m => m.text && m.text.length > 0);

    return {
      provider,
      title: getConversationTitle(),
      url: window.location.href,
      messages,
      extractedAt: new Date().toISOString(),
    };
  }

  // ── Message listener ──────────────────────────────────────────────────────
  browser.runtime.onMessage.addListener((request) => {
    if (request.action === "extractConversation") {
      return extractConversation()
        .then(data => ({ success: true, data }))
        .catch(err => ({ success: false, error: err.message }));
    }
    if (request.action === "ping") {
      return Promise.resolve({ pong: true, provider: getProvider() });
    }
  });

})();
