// PageMark Content Script
// Runs on AI chat sites. Injects pin buttons on user messages,
// provides an in-page sidebar for browsing pins,
// saves/loads pins via native messaging through the background script.

(function () {
    "use strict";

    // ========== Domain Blacklist Guard ==========
    // Check if this domain is ignored — abort entirely if so
    try {
        browser.storage.local.get(["ignoredDomains"]).then(result => {
            const ignored = result.ignoredDomains || [];
            if (ignored.includes(window.location.hostname)) {
                console.log("PageMark: Disabled on", window.location.hostname);
                return; // Abort — don't initialize anything
            }
            // Domain not ignored — proceed with full initialization
            initPageMark();
        }).catch(() => initPageMark());
    } catch (e) {
        // storage API unavailable — proceed normally
        initPageMark();
    }

    function initPageMark() {

        // ========== Site-specific configurations ==========
        const SITE_CONFIGS = {
            "gemini.google.com": {
                userMessageSelector: "user-query",
                aiMessageSelector: "model-response",
                contentSelector: ".model-response-text",
                excludeSelectors: [],
                titleSelector: '[data-test-id="conversation-title"]',
                platform: "gemini",
                domain: "gemini.google.com",
                filePillSelector: '[data-test-id="file-preview"], [data-test-id="image-preview"], .file-preview, .image-preview, [data-test-id="upload-preview"]',
                chatInputSelector: '.ql-editor, .text-input-area, [contenteditable="true"][role="textbox"], rich-textarea .ql-editor',
            },
            "claude.ai": {
                userMessageSelector: '[data-testid="user-message"]',
                aiMessageSelector: '[data-testid="chat-message-content"]',
                contentSelector: ".font-claude-message",
                excludeSelectors: [
                    '[class*="thinking"]',
                    '[class*="Thinking"]',
                    "details",
                    "summary",
                    '[data-testid*="thinking"]',
                ],
                titleSelector: '',
                platform: "claude",
                domain: "claude.ai",
                filePillSelector: '[data-testid="file-attachment"], .file-attachment, [class*="attachment"][class*="file"], [class*="FileAttachment"]',
                chatInputSelector: '[contenteditable="true"].ProseMirror, [contenteditable="true"][data-placeholder], div[contenteditable="true"]',
            },
            "chatgpt.com": {
                userMessageSelector: '[data-message-author-role="user"]',
                aiMessageSelector: '[data-message-author-role="assistant"]',
                contentSelector: ".markdown",
                excludeSelectors: [],
                titleSelector: '',
                platform: "chatgpt",
                domain: "chatgpt.com",
                filePillSelector: '[class*="file"][class*="pill"], [data-testid*="file"], .uploaded-file-item, [class*="attachment"]',
                chatInputSelector: '#prompt-textarea, [contenteditable="true"][id="prompt-textarea"], textarea[data-id="root"]',
            },
            "grok.com": {
                userMessageSelector: ".items-end .message-bubble",
                aiMessageSelector: 'div[id^="response-"] .message-bubble',
                contentSelector: ".markdown",
                excludeSelectors: [],
                titleSelector: "",
                platform: "grok",
                domain: "grok.com",
                filePillSelector: '[class*="file"], [class*="attachment"]',
                chatInputSelector: 'textarea, [contenteditable="true"]',
            },
            "doubao.com": {
                userMessageSelector: 'div[data-testid="send_message"]',
                aiMessageSelector: 'div[data-testid="receive_message"]',
                contentSelector: 'div[data-testid="message_text_content"]',
                excludeSelectors: [],
                titleSelector: "",
                platform: "doubao",
                domain: "www.doubao.com",
                filePillSelector: '[class*="file"], [data-testid*="file"]',
                chatInputSelector: 'textarea, [contenteditable="true"]',
            },
        };

        function getSiteConfig() {
            const hostname = window.location.hostname;
            for (const [site, config] of Object.entries(SITE_CONFIGS)) {
                if (hostname.includes(site)) return config;
            }
            return null;
        }

        const SITE_CONFIG = getSiteConfig();
        if (!SITE_CONFIG) return;

        let currentPath = getConversationKey();
        let shadowRoot = null;
        let expandedFolders = new Set();
        let syncInterval = null;

        // Platform → domain mapping for cross-site navigation
        const PLATFORM_DOMAINS = {
            gemini: "gemini.google.com",
            claude: "claude.ai",
            chatgpt: "chatgpt.com",
            grok: "grok.com",
            doubao: "www.doubao.com",
        };

        // All pins keyed by conversationPath → { title, platform, pins: { id: {queryText, snippet, timestamp} } }
        let allDialogues = {};

        // ========== Theme ==========
        // Theme is controlled by popup settings, stored in browser.storage.local
        let currentTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

        // Load theme from popup settings
        try {
            browser.storage.local.get(["theme"]).then(result => {
                const pref = result.theme || "system";
                if (pref === "light") currentTheme = "light";
                else if (pref === "dark") currentTheme = "dark";
                // else system — already set from matchMedia
                applyTheme();
            });

            // Listen for theme/setting changes from popup — real-time sync
            browser.storage.onChanged.addListener((changes, area) => {
                if (area !== "local") return;
                if (changes.theme) {
                    const pref = changes.theme.newValue || "system";
                    if (pref === "light") currentTheme = "light";
                    else if (pref === "dark") currentTheme = "dark";
                    else currentTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
                    applyTheme();
                }
            });
        } catch (e) { /* storage API may not be available */ }

        // Theme-aware accent colors
        function getAccentColor() {
            return currentTheme === "dark" ? "#d97706" : "#5e5ce6";
        }
        function getAccentRgba(alpha) {
            return currentTheme === "dark"
                ? `rgba(217,119,6,${alpha})`
                : `rgba(94,92,230,${alpha})`;
        }

        // Conversation key — use pathname + search to distinguish conversations
        function getConversationKey() {
            return window.location.pathname + window.location.search;
        }

        // ========== Storage — native messaging ==========

        async function loadAllDialogues() {
            try {
                const response = await browser.runtime.sendMessage({ type: "getPins" });
                if (response && response.success && response.pins) {
                    allDialogues = {};
                    for (const pin of response.pins) {
                        const path = pin.conversationPath;
                        if (!allDialogues[path]) {
                            allDialogues[path] = {
                                title: pin.conversationTitle,
                                platform: pin.platform,
                                pins: {},
                            };
                        }
                        allDialogues[path].pins[pin.id] = {
                            queryText: pin.queryText,
                            snippet: pin.answerSnippet || "",
                            timestamp: pin.timestamp,
                        };
                    }
                }
            } catch (e) {
                console.error("PageMark: Load failed", e);
                allDialogues = {};
            }
            renderSidebar();
        }

        function getCurrentDialogue() {
            if (!allDialogues[currentPath]) {
                allDialogues[currentPath] = {
                    title: getConversationTitle(),
                    platform: SITE_CONFIG.platform,
                    pins: {},
                };
            }
            return allDialogues[currentPath];
        }

        function getCurrentPins() {
            return getCurrentDialogue().pins;
        }

        // Invalid/generic titles that should be skipped
        const INVALID_TITLES = [
            "claude", "chatgpt", "gemini", "grok", "doubao",
            "google", "openai", "anthropic", "new chat", "new conversation",
            "untitled", "home", "chat", "pinned chat",
            "google gemini", "gemini - google",
        ];

        function isInvalidTitle(t) {
            if (!t) return true;
            const lower = t.toLowerCase().trim();
            if (lower.length < 2 || lower.length > 100) return true;
            return INVALID_TITLES.some(inv => lower === inv || lower.startsWith(inv + " -") || lower.startsWith(inv + " |"));
        }

        function cleanTitle(raw) {
            if (!raw) return null;
            let t = raw.trim();
            // Strip brand suffixes/prefixes
            t = t.replace(/\s*[-|–|]\s*(Claude|ChatGPT|Gemini|Grok|Doubao|Google|Anthropic|OpenAI).*$/i, "");
            t = t.replace(/^(Claude|ChatGPT|Gemini|Grok|Doubao|Google)\s*[-|–|]\s*/i, "");
            // Strip UI metadata suffixes
            t = t.replace(/\s*(Pinned|Pinned chat|New chat|Starred|\(\d+\))\s*$/i, "");
            t = t.trim();
            if (isInvalidTitle(t)) return null;
            return t.substring(0, 60);
        }

        // Extract only leaf text (innermost text node), avoiding reading child button/icon text
        function getLeafText(el) {
            if (!el) return null;
            // If el has a dedicated text child with no sub-elements, use it directly
            const childNodes = Array.from(el.childNodes);
            const textOnly = childNodes.filter(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
            if (textOnly.length > 0) {
                return textOnly.map(n => n.textContent.trim()).join(" ");
            }
            // Otherwise look for the first span/div that is purely text
            for (const child of el.querySelectorAll("span, div, p, h1, h2, h3")) {
                if (child.children.length === 0 && child.textContent.trim()) {
                    return child.textContent.trim();
                }
            }
            return el.textContent.trim();
        }

        function getConversationTitle() {
            // === Tier 0: Site-specific title selector (most reliable when it exists) ===
            try {
                if (SITE_CONFIG.titleSelector) {
                    const el = document.querySelector(SITE_CONFIG.titleSelector);
                    if (el) {
                        const t = cleanTitle(getLeafText(el));
                        if (t) return t;
                    }
                }
            } catch (e) { }

            // === Tier 1: Match active conversation in sidebar by URL path ===
            try {
                const pathParts = window.location.pathname.split("/").filter(Boolean);
                const conversationId = pathParts[pathParts.length - 1]; // usually UUID or slug
                if (conversationId && conversationId.length > 3) {
                    // Look for a nav/sidebar link whose href contains this conversation ID
                    const navLink = document.querySelector(
                        `nav a[href*="${CSS.escape(conversationId)}"], ` +
                        `aside a[href*="${CSS.escape(conversationId)}"], ` +
                        `[role="navigation"] a[href*="${CSS.escape(conversationId)}"]`
                    );
                    if (navLink) {
                        const t = cleanTitle(getLeafText(navLink));
                        if (t) return t;
                    }
                }
            } catch (e) { }

            // === Tier 2: document.title (most reliable cross-platform) ===
            try {
                const t = cleanTitle(document.title);
                if (t) return t;
            } catch (e) { }

            // === Tier 3: First user message as title ===
            try {
                const firstMsg = document.querySelector(SITE_CONFIG.userMessageSelector);
                if (firstMsg) {
                    const text = cleanQueryText(firstMsg.textContent);
                    if (text && text.length > 2) {
                        return text.substring(0, 50) + (text.length > 50 ? "…" : "");
                    }
                }
            } catch (e) { }

            return "Untitled";
        }

        // Auto-correct title for current dialogue if we have a better one now
        function refreshCurrentTitle() {
            if (!allDialogues[currentPath]) return;
            const oldTitle = allDialogues[currentPath].title;
            const newTitle = getConversationTitle();
            if (newTitle !== "Untitled" && (oldTitle === "Untitled" || isInvalidTitle(oldTitle))) {
                allDialogues[currentPath].title = newTitle;
            }
        }

        // Strip platform-specific UI prefixes from user message text
        function cleanQueryText(raw) {
            if (!raw) return "";
            let t = raw.replace(/\s+/g, " ").trim();
            // Gemini: "You said ..." prefix
            t = t.replace(/^You said\s+/i, "");
            // Common: "You: ..."
            t = t.replace(/^You:\s*/i, "");
            // Chinese variants
            t = t.replace(/^你说了?\s*/i, "");
            return t.trim();
        }

        function findUserMessageByQuery(queryText) {
            const messages = document.querySelectorAll(
                SITE_CONFIG.userMessageSelector
            );
            for (const msg of messages) {
                const text = cleanQueryText(msg.textContent);
                if (
                    text.includes(queryText) ||
                    queryText.includes(text.substring(0, 100))
                ) {
                    return msg;
                }
            }
            return null;
        }

        function findFollowingAiMessage(userMessageEl) {
            const aiMessages = document.querySelectorAll(
                SITE_CONFIG.aiMessageSelector
            );
            const userMessages = document.querySelectorAll(
                SITE_CONFIG.userMessageSelector
            );

            let userIndex = -1;
            userMessages.forEach((el, idx) => {
                if (el === userMessageEl) userIndex = idx;
            });
            if (userIndex === -1) return null;

            const userRect = userMessageEl.getBoundingClientRect();
            for (const aiMsg of aiMessages) {
                const aiRect = aiMsg.getBoundingClientRect();
                if (aiRect.top > userRect.top) return aiMsg;
            }
            return aiMessages[userIndex] || null;
        }

        function extractCleanContent(el) {
            const clone = el.cloneNode(true);
            for (const selector of SITE_CONFIG.excludeSelectors) {
                clone.querySelectorAll(selector).forEach((n) => n.remove());
            }
            const contentEl =
                clone.querySelector(SITE_CONFIG.contentSelector) || clone;
            return contentEl.textContent.replace(/\s+/g, " ").trim();
        }

        // ========== Sidebar UI (Shadow DOM) ==========

        function createSidebar() {
            const host = document.createElement("div");
            host.id = "pagemark-host";
            host.style.cssText =
                "position:fixed;top:0;right:0;z-index:2147483647;pointer-events:none;";
            document.body.appendChild(host);

            shadowRoot = host.attachShadow({ mode: "open" });

            shadowRoot.innerHTML = `
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }

        #pagemark-container {
          --bg-color: rgba(18, 18, 22, 0.95);
          --text-color: #f5f5f5;
          --text-secondary: #ccc;
          --text-muted: #888;
          --border-color: rgba(255,255,255,0.1);
          --card-bg: rgba(255,255,255,0.04);
          --hover-bg: rgba(255,255,255,0.05);
          --btn-bg: rgba(255,255,255,0.06);
          --accent: #d97706;
          --accent-hover: rgba(217,119,6,0.12);
        }

        #pagemark-container.light-theme {
          --bg-color: rgba(245, 245, 250, 0.97);
          --text-color: #1a1a1a;
          --text-secondary: #333;
          --text-muted: #666;
          --border-color: rgba(0,0,0,0.12);
          --card-bg: rgba(0,0,0,0.03);
          --hover-bg: rgba(0,0,0,0.05);
          --btn-bg: rgba(0,0,0,0.06);
          --accent-subtle: rgba(94, 92, 230, 0.08);
        }

        .sidebar {
          position: fixed;
          top: 50%;
          right: 0;
          transform: translateX(100%) translateY(-50%);
          width: 300px;
          max-height: 75vh;
          background: var(--bg-color);
          color: var(--text-color);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid var(--border-color);
          border-right: none;
          border-radius: 12px 0 0 12px;
          box-shadow: none;
          display: flex;
          flex-direction: column;
          font-family: system-ui, -apple-system, sans-serif;
          transition: transform 0.3s ease, opacity 0.3s ease;
          opacity: 0;
          pointer-events: none;
        }

        .sidebar.open {
          transform: translateX(0) translateY(-50%);
          box-shadow: -4px 0 30px rgba(0,0,0,0.5);
          opacity: 1;
          pointer-events: auto;
        }

        .toggle-tab {
          position: fixed;
          top: 50%;
          right: 0;
          transform: translateY(-50%);
          width: 36px;
          height: 90px;
          background: var(--bg-color);
          border: 1px solid var(--border-color);
          border-right: none;
          border-radius: 10px 0 0 10px;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 6px;
          font-size: 18px;
          color: var(--text-muted);
          pointer-events: auto;
          transition: all 0.2s, opacity 0.2s ease;
          opacity: 1;
        }

        .toggle-tab.hidden { opacity: 0; pointer-events: none; }

        .toggle-tab:hover {
          background: rgba(30, 30, 40, 0.98);
          color: var(--text-color);
          width: 40px;
        }

        .toggle-tab .count {
          background: var(--accent);
          color: white;
          font-size: 10px;
          min-width: 18px;
          padding: 2px 5px;
          border-radius: 9px;
          font-weight: 600;
          text-align: center;
        }

        .header {
          padding: 14px 16px;
          border-bottom: 1px solid var(--border-color);
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-shrink: 0;
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .title { font-size: 14px; font-weight: 600; color: var(--text-color); }

        .theme-btn, .close-btn {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 16px;
          padding: 4px 6px;
          border-radius: 4px;
          line-height: 1;
        }
        .theme-btn:hover, .close-btn:hover { background: var(--hover-bg); color: var(--text-color); }

        .folders-list {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
        }

        .folders-list::-webkit-scrollbar { width: 5px; }
        .folders-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }

        .folder {
          margin-bottom: 4px;
          border-radius: 8px;
          overflow: hidden;
        }

        .folder.current {
          background: var(--accent-hover);
          border: 1px solid rgba(217,119,6,0.25);
        }

        .light-theme .folder.current {
          background: rgba(94,92,230,0.06);
          border: 1px solid rgba(94,92,230,0.15);
        }

        .folder-header {
          display: flex;
          align-items: center;
          padding: 10px 12px;
          cursor: pointer;
          transition: background 0.15s;
          gap: 8px;
        }

        .folder-header:hover { background: var(--hover-bg); }

        .folder-icon {
          font-size: 12px;
          color: var(--text-muted);
          transition: transform 0.2s;
          width: 16px;
        }

        .folder.expanded .folder-icon { transform: rotate(90deg); }

        .folder-title {
          flex: 1;
          font-size: 12px;
          color: var(--text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .folder.current .folder-title { color: var(--accent); font-weight: 500; }

        .folder-count {
          font-size: 10px;
          color: var(--text-muted);
          background: var(--btn-bg);
          padding: 2px 6px;
          border-radius: 8px;
        }

        .folder.current .folder-count { background: var(--accent-hover); color: #fff; }

        .folder-delete {
          background: none;
          border: none;
          color: #444;
          cursor: pointer;
          font-size: 14px;
          padding: 2px 6px;
          border-radius: 4px;
          opacity: 0;
          transition: all 0.15s;
          margin-left: 4px;
        }

        .folder-header:hover .folder-delete { opacity: 1; }
        .folder-delete:hover { color: #ef4444; background: rgba(239,68,68,0.15); }

        .folder-pins {
          display: none;
          padding: 4px 8px 8px 28px;
        }

        .folder.expanded .folder-pins { display: block; }

        .pin-card {
          background: var(--card-bg);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 6px;
          padding: 10px;
          margin-bottom: 6px;
          cursor: pointer;
          transition: all 0.15s;
        }

        .pin-card:hover {
          background: var(--accent-hover);
          border-color: var(--accent);
        }

        .pin-card.inactive {
          opacity: 0.65;
          border-left: 2px solid var(--text-muted);
        }

        .pin-card.inactive:hover {
          opacity: 1;
          background: var(--accent-hover);
          border-color: var(--accent);
          border-left: 2px solid var(--accent);
        }

        .pin-query {
          font-size: 12px;
          font-weight: 500;
          color: var(--text-color);
          line-height: 1.4;
          margin-bottom: 4px;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          text-overflow: ellipsis;
          word-break: break-word;
        }

        .pin-snippet {
          font-size: 11px;
          color: var(--text-secondary);
          line-height: 1.3;
          margin-bottom: 6px;
          word-break: break-word;
          opacity: 0.8;
        }

        .pin-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .pin-meta { font-size: 10px; color: var(--text-muted); }

        .pin-card.inactive .pin-meta::after {
          content: ' · opens new tab';
          color: var(--text-muted);
        }

        .delete-btn {
          background: none;
          border: none;
          color: #555;
          cursor: pointer;
          font-size: 12px;
          padding: 3px 6px;
          border-radius: 4px;
          opacity: 0;
          transition: all 0.15s;
        }

        .pin-card:hover .delete-btn { opacity: 1; }
        .delete-btn:hover { color: #ef4444; background: rgba(239,68,68,0.15); }

        .empty {
          text-align: center;
          padding: 30px 20px;
          color: var(--text-muted);
          font-size: 12px;
          line-height: 1.6;
        }

        .nav-hint {
          font-size: 10px;
          color: var(--text-muted);
          padding: 8px 12px;
          border-top: 1px solid var(--border-color);
          text-align: center;
        }

        /* Light theme overrides */
        #pagemark-container.light-theme .toggle-tab:hover { background: rgba(230,230,235,0.98); }
        #pagemark-container.light-theme .sidebar.open { box-shadow: -4px 0 30px rgba(0,0,0,0.15); }
        #pagemark-container.light-theme .close-btn { color: #999; }
        #pagemark-container.light-theme .close-btn:hover { background: rgba(0,0,0,0.08); color: #000; }
        #pagemark-container.light-theme .folder-header:hover { background: var(--hover-bg); }
        #pagemark-container.light-theme .folder.current { background: rgba(94,92,230,0.06); border-color: rgba(94,92,230,0.15); }
        #pagemark-container.light-theme .folder.current .folder-title { color: #4338ca; }
        #pagemark-container.light-theme .pin-card { background: var(--card-bg); border-color: rgba(0,0,0,0.08); }
        #pagemark-container.light-theme .pin-card:hover { background: var(--accent-subtle); border-color: rgba(94,92,230,0.25); }
        #pagemark-container.light-theme .pin-card.inactive:hover { border-left-color: rgba(94,92,230,0.5); }
        #pagemark-container.light-theme .folders-list::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); }
      </style>

      <div id="pagemark-container">
        <div class="toggle-tab" id="toggle">
          <span>📌</span>
          <span class="count" id="count">0</span>
        </div>

        <div class="sidebar" id="sidebar">
          <div class="header">
            <div class="header-left">
              <span class="title">📌 PageMark</span>
            </div>
            <div>
              <button class="close-btn" id="close">×</button>
            </div>
          </div>
          <div class="folders-list" id="folders"></div>
          <div class="nav-hint">Pins from other chats open in a new tab</div>
        </div>
      </div>
    `;

            // Toggle sidebar — reload from native storage on every open for sync
            shadowRoot.getElementById("toggle").addEventListener("click", async () => {
                shadowRoot.getElementById("toggle").classList.add("hidden");
                shadowRoot.getElementById("sidebar").classList.add("open");
                expandedFolders.add(currentPath);
                await loadAllDialogues();
            });

            shadowRoot.getElementById("close").addEventListener("click", () => {
                shadowRoot.getElementById("sidebar").classList.remove("open");
                shadowRoot.getElementById("toggle").classList.remove("hidden");
            });

        }

        function applyTheme() {
            if (!shadowRoot) return;
            const container = shadowRoot.getElementById("pagemark-container");
            if (!container) return;
            if (currentTheme === "light") {
                container.classList.add("light-theme");
            } else {
                container.classList.remove("light-theme");
            }
        }

        // ========== Render sidebar ==========

        function renderSidebar() {
            if (!shadowRoot) return;

            const foldersEl = shadowRoot.getElementById("folders");
            const countEl = shadowRoot.getElementById("count");

            // Count total pins
            let totalPins = 0;
            Object.values(allDialogues).forEach((d) => {
                totalPins += Object.keys(d.pins || {}).length;
            });

            countEl.textContent = totalPins;
            countEl.style.display = totalPins > 0 ? "" : "none";

            // Get dialogues with pins, sorted (current first)
            const dialoguesWithPins = Object.entries(allDialogues)
                .filter(([_, d]) => Object.keys(d.pins || {}).length > 0)
                .sort((a, b) => {
                    if (a[0] === currentPath) return -1;
                    if (b[0] === currentPath) return 1;
                    return 0;
                });

            if (dialoguesWithPins.length === 0) {
                foldersEl.innerHTML = `
        <div class="empty">
          No pins yet<br>
          Hover over your queries and click 📌
        </div>
      `;
                return;
            }

            foldersEl.innerHTML = "";

            for (const [path, dialogue] of dialoguesWithPins) {
                const isCurrent = path === currentPath;
                const isExpanded = expandedFolders.has(path);
                const pins = Object.entries(dialogue.pins || {});

                const folder = document.createElement("div");
                folder.className = `folder${isCurrent ? " current" : ""}${isExpanded ? " expanded" : ""
                    }`;

                // Folder header
                const header = document.createElement("div");
                header.className = "folder-header";
                header.innerHTML = `
        <span class="folder-icon">▶</span>
        <span class="folder-title">${escapeHtml(
                    dialogue.title || "Untitled"
                )}</span>
        <span class="folder-count">${pins.length}</span>
        <button class="folder-delete" title="Delete all pins in this folder">✕</button>
      `;

                header.addEventListener("click", (e) => {
                    if (e.target.classList.contains("folder-delete")) {
                        deleteFolder(path);
                        return;
                    }
                    if (expandedFolders.has(path)) {
                        expandedFolders.delete(path);
                    } else {
                        expandedFolders.add(path);
                    }
                    renderSidebar();
                });

                folder.appendChild(header);

                // Pins container
                const pinsContainer = document.createElement("div");
                pinsContainer.className = "folder-pins";

                // Sort pins by timestamp
                pins.sort((a, b) => a[1].timestamp - b[1].timestamp);

                for (const [pinId, pinData] of pins) {
                    const card = document.createElement("div");
                    card.className = `pin-card${isCurrent ? "" : " inactive"}`;
                    card.innerHTML = `
          <div class="pin-query">${escapeHtml(
                        pinData.queryText
                    )}</div>
          ${pinData.snippet
                            ? `<div class="pin-snippet">${escapeHtml(
                                pinData.snippet
                            )}</div>`
                            : ""
                        }
          <div class="pin-footer">
            <span class="pin-meta">${timeAgo(pinData.timestamp)}</span>
            <button class="delete-btn">✕</button>
          </div>
        `;

                    card.addEventListener("click", (e) => {
                        if (e.target.classList.contains("delete-btn")) {
                            deletePin(path, pinId);
                        } else if (isCurrent) {
                            jumpToMessage(pinData.queryText);
                        } else {
                            // Open in new tab — use the CORRECT platform domain
                            const targetDomain = PLATFORM_DOMAINS[dialogue.platform] || SITE_CONFIG.domain;
                            const hash = encodeURIComponent(pinData.queryText);
                            window.open(
                                "https://" + targetDomain + path + "#pinboard=" + hash,
                                "_blank"
                            );
                        }
                    });

                    pinsContainer.appendChild(card);
                }

                folder.appendChild(pinsContainer);
                foldersEl.appendChild(folder);
            }

            updatePinButtonStates();
        }

        // ========== Pin button states ==========

        function updatePinButtonStates() {
            const currentPins = getCurrentPins();
            document.querySelectorAll("[data-pagemark-idx]").forEach((el) => {
                const btnContainer = el.nextElementSibling;
                const btn = btnContainer?.querySelector(".pagemark-btn");
                if (!btn) return;

                const queryText = el.textContent
                    .replace(/\s+/g, " ")
                    .trim()
                    .substring(0, 150);
                const isPinned = Object.values(currentPins).some(
                    (p) => p.queryText === queryText
                );
                if (isPinned) {
                    btn.style.opacity = "1";
                    btn.style.background = getAccentRgba(0.45);
                } else {
                    btn.style.background = "rgba(30,30,35,0.85)";
                }
            });
        }

        // ========== Delete operations ==========

        async function deletePin(path, pinId) {
            if (allDialogues[path]?.pins) {
                delete allDialogues[path].pins[pinId];
                if (Object.keys(allDialogues[path].pins).length === 0) {
                    delete allDialogues[path];
                }
                renderSidebar();
                try {
                    await browser.runtime.sendMessage({
                        type: "unpinMessage",
                        id: pinId,
                    });
                } catch (e) {
                    console.error("PageMark: Delete failed", e);
                }
            }
        }

        async function deleteFolder(path) {
            if (allDialogues[path]) {
                const pinIds = Object.keys(allDialogues[path].pins || {});
                delete allDialogues[path];
                expandedFolders.delete(path);
                renderSidebar();
                if (path === currentPath) updatePinButtonStates();

                // Delete all pins from native storage
                for (const id of pinIds) {
                    try {
                        await browser.runtime.sendMessage({
                            type: "unpinMessage",
                            id: id,
                        });
                    } catch (e) {
                        console.error("PageMark: Delete pin failed", e);
                    }
                }
            }
        }

        // ========== Jump to message ==========

        function jumpToMessage(queryText) {
            const el = findUserMessageByQuery(queryText);
            if (!el) {
                // Remove orphan pin from local state
                const pins = getCurrentPins();
                for (const [id, data] of Object.entries(pins)) {
                    if (data.queryText === queryText) {
                        deletePin(currentPath, id);
                    }
                }
                return;
            }

            el.scrollIntoView({ behavior: "smooth", block: "start" });

            // Highlight Q&A pair with border overlay
            const aiMessage = findFollowingAiMessage(el);
            const queryRect = el.getBoundingClientRect();
            let top = queryRect.top;
            let bottom = queryRect.bottom;
            let left = queryRect.left;
            let right = queryRect.right;

            if (aiMessage) {
                const aiRect = aiMessage.getBoundingClientRect();
                top = Math.min(top, aiRect.top);
                bottom = Math.max(bottom, aiRect.bottom);
                left = Math.min(left, aiRect.left);
                right = Math.max(right, aiRect.right);
            }

            const overlay = document.createElement("div");
            overlay.style.cssText = `
      position: fixed;
      top: ${top - 8}px; left: ${left - 8}px;
      width: ${right - left + 16}px; height: ${bottom - top + 16}px;
      border: 2px solid ${getAccentColor()};
      border-radius: 12px;
      pointer-events: none;
      z-index: 10000;
      box-shadow: 0 0 20px ${getAccentRgba(0.35)};
      transition: opacity 0.3s;
    `;
            document.body.appendChild(overlay);

            const updatePosition = () => {
                const nr = el.getBoundingClientRect();
                let t = nr.top, b = nr.bottom, l = nr.left, r = nr.right;
                if (aiMessage) {
                    const ar = aiMessage.getBoundingClientRect();
                    t = Math.min(t, ar.top);
                    b = Math.max(b, ar.bottom);
                    l = Math.min(l, ar.left);
                    r = Math.max(r, ar.right);
                }
                overlay.style.top = `${t - 8}px`;
                overlay.style.left = `${l - 8}px`;
                overlay.style.width = `${r - l + 16}px`;
                overlay.style.height = `${b - t + 16}px`;
            };

            window.addEventListener("scroll", updatePosition, true);

            setTimeout(() => {
                overlay.style.opacity = "0";
                setTimeout(() => {
                    overlay.remove();
                    window.removeEventListener("scroll", updatePosition, true);
                }, 300);
            }, 2500);
        }

        // ========== Pin button injection ==========

        function addPinButton(messageEl, index) {
            if (messageEl.hasAttribute("data-pagemark-idx")) return;
            messageEl.setAttribute("data-pagemark-idx", index);

            const btnContainer = document.createElement("div");
            btnContainer.className = "pagemark-btn-container";
            btnContainer.style.cssText =
                "display:flex;justify-content:flex-end;padding:2px 0;width:100%;";

            const btn = document.createElement("button");
            btn.className = "pagemark-btn";
            btn.innerHTML = "📌";
            btn.title = "Pin this query";
            btn.style.cssText = `
      width: 28px; height: 28px; padding: 0;
      background: ${currentTheme === "dark" ? "rgba(30,30,35,0.85)" : "rgba(255,255,255,0.9)"};
      border: 1px solid ${currentTheme === "dark" ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)"};
      border-radius: 6px; cursor: pointer; font-size: 13px;
      opacity: 0; transition: opacity 0.15s, transform 0.15s, background 0.15s;
      display: flex; align-items: center; justify-content: center;
    `;

            // Check if already pinned
            const queryText = cleanQueryText(messageEl.textContent)
                .substring(0, 150);
            const currentPins = getCurrentPins();
            const isPinned = Object.values(currentPins).some(
                (p) => p.queryText === queryText
            );
            if (isPinned) {
                btn.style.opacity = "1";
                btn.style.background = getAccentRgba(0.45);
            }

            btn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                handlePinClick(messageEl, btn);
            });

            btn.addEventListener("mouseenter", () => {
                btn.style.transform = "scale(1.1)";
            });
            btn.addEventListener("mouseleave", () => {
                btn.style.transform = "scale(1)";
            });

            btnContainer.appendChild(btn);
            messageEl.parentNode.insertBefore(btnContainer, messageEl.nextSibling);

            // Show/hide on hover
            const showBtn = () => (btn.style.opacity = "1");
            const hideBtn = () => {
                const qText = cleanQueryText(messageEl.textContent)
                    .substring(0, 150);
                const pins = getCurrentPins();
                const stillPinned = Object.values(pins).some(
                    (p) => p.queryText === qText
                );
                if (!stillPinned) btn.style.opacity = "0";
            };

            messageEl.addEventListener("mouseenter", showBtn);
            messageEl.addEventListener("mouseleave", hideBtn);
            btnContainer.addEventListener("mouseenter", showBtn);
            btnContainer.addEventListener("mouseleave", hideBtn);
        }

        async function handlePinClick(messageEl, btn) {
            const queryText = cleanQueryText(messageEl.textContent)
                .substring(0, 150);

            const pins = getCurrentPins();
            const existingPin = Object.entries(pins).find(
                ([_, p]) => p.queryText === queryText
            );

            if (existingPin) {
                // Unpin
                const [pinId] = existingPin;
                delete pins[pinId];
                btn.style.background = "rgba(30,30,35,0.85)";

                if (Object.keys(pins).length === 0) {
                    delete allDialogues[currentPath];
                }

                try {
                    await browser.runtime.sendMessage({
                        type: "unpinMessage",
                        id: pinId,
                    });
                } catch (e) {
                    console.error("PageMark: Unpin failed", e);
                }

                // Reload all dialogues from native storage to stay in sync
                await loadAllDialogues();
            } else {
                // Pin
                const aiMessage = findFollowingAiMessage(messageEl);
                let answerSnippet = null;
                if (aiMessage) {
                    const text = extractCleanContent(aiMessage);
                    answerSnippet =
                        text.substring(0, 80) + (text.length > 80 ? "…" : "");
                }

                let pinId = "pin_" + Date.now();

                try {
                    const response = await browser.runtime.sendMessage({
                        type: "pinMessage",
                        conversationPath: currentPath,
                        queryText: queryText,
                        answerSnippet: answerSnippet,
                        conversationTitle: getConversationTitle(),
                        platform: SITE_CONFIG.platform,
                    });

                    // Use the native-generated UUID if available
                    if (
                        response &&
                        response.success &&
                        response.response &&
                        response.response.id
                    ) {
                        pinId = response.response.id;
                    }
                } catch (e) {
                    console.error("PageMark: Pin failed", e);
                    return;
                }

                btn.style.background = getAccentRgba(0.45);
                btn.style.opacity = "1";

                // Reload all dialogues from native storage to stay in sync
                await loadAllDialogues();
            }
        }

        // ========== Process messages ==========

        function processMessages() {
            try {
                const messages = document.querySelectorAll(
                    SITE_CONFIG.userMessageSelector
                );
                messages.forEach((msg, idx) => addPinButton(msg, idx));
            } catch (e) {
                console.error("PageMark: Process error", e);
            }
        }

        // ========== Hash-based restore ==========

        function checkHashAndScroll() {
            const hash = window.location.hash;
            if (!hash.startsWith("#pinboard=")) return;

            const queryText = decodeURIComponent(
                hash.substring("#pinboard=".length)
            );
            let attempts = 0;
            const tryScroll = () => {
                const el = findUserMessageByQuery(queryText);
                if (el) {
                    jumpToMessage(queryText);
                    history.replaceState(
                        null,
                        "",
                        window.location.pathname + window.location.search
                    );
                } else if (attempts < 15) {
                    attempts++;
                    setTimeout(tryScroll, 500);
                }
            };
            tryScroll();
        }

        // ========== SPA navigation ==========

        function checkUrlChange() {
            const newKey = getConversationKey();
            if (newKey !== currentPath) {
                currentPath = newKey;
                expandedFolders.add(currentPath);
                renderSidebar();
                setTimeout(processMessages, 500);
            }
            // Auto-correct stored title for current conversation
            refreshCurrentTitle();
        }

        function setupObserver() {
            const observer = new MutationObserver(() => {
                clearTimeout(observer._timeout);
                observer._timeout = setTimeout(() => {
                    checkUrlChange();
                    processMessages();
                    processFilePills();
                }, 300);
            });
            observer.observe(document.body, { childList: true, subtree: true });
            setInterval(checkUrlChange, 1000);
        }

        // ========== Utilities ==========

        function escapeHtml(text) {
            const div = document.createElement("div");
            div.textContent = text;
            return div.innerHTML;
        }

        function timeAgo(ts) {
            const sec = Math.floor((Date.now() - ts) / 1000);
            if (sec < 60) return "now";
            if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
            if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
            return `${Math.floor(sec / 86400)}d ago`;
        }

        // ========== File Pill Insert Feature ==========

        let trackedFilePills = new WeakSet();

        function isValidFileName(name) {
            if (!name || name.length < 2 || name.length > 200) return false;
            // Reject strings corrupted by our own code
            if (/Ctrl\+/i.test(name) || /insert filename/i.test(name)) return false;
            if (/Image preview/i.test(name)) return false;
            return true;
        }

        function getFileNameFromPill(pill) {
            // 1. Check saved filename (extracted at first sight)
            const saved = pill.getAttribute("data-pagemark-filename");
            if (isValidFileName(saved)) return saved;

            // 2. Gemini file: child [data-test-id="file-name"] with title attribute
            const fileNameEl = pill.querySelector('[data-test-id="file-name"], [data-testid="file-name"], .file-name');
            if (fileNameEl) {
                const t = fileNameEl.getAttribute("title");
                if (isValidFileName(t)) return t.trim();
                const tc = fileNameEl.textContent.trim();
                if (isValidFileName(tc)) return tc;
            }

            // 3. Data attributes on the pill itself
            for (const attr of ["data-file-name", "data-filename"]) {
                const v = pill.getAttribute(attr);
                if (isValidFileName(v)) return v.trim();
            }

            // 4. Title attribute (only if clean)
            const title = pill.getAttribute("title");
            if (isValidFileName(title)) return title.trim();

            // 5. Fallback: clean text content
            const clone = pill.cloneNode(true);
            clone.querySelectorAll('button, [role="button"], svg, .cancel-button, .file-type, mat-icon').forEach(n => n.remove());
            const text = clone.textContent.replace(/\s+/g, " ").trim();
            if (isValidFileName(text)) return text;

            return null;
        }

        function findChatInput() {
            if (!SITE_CONFIG.chatInputSelector) return null;
            const selectors = SITE_CONFIG.chatInputSelector.split(", ");
            for (const sel of selectors) {
                const el = document.querySelector(sel.trim());
                if (el) return el;
            }
            return null;
        }

        function insertTextAtCursor(inputEl, text) {
            inputEl.focus();

            if (inputEl.tagName === "TEXTAREA" || inputEl.tagName === "INPUT") {
                const start = inputEl.selectionStart ?? inputEl.value.length;
                const end = inputEl.selectionEnd ?? start;
                const before = inputEl.value.substring(0, start);
                const after = inputEl.value.substring(end);
                inputEl.value = before + text + " " + after;
                const newPos = start + text.length + 1;
                inputEl.setSelectionRange(newPos, newPos);
                inputEl.dispatchEvent(new Event("input", { bubbles: true }));
            } else if (inputEl.contentEditable === "true") {
                const sel = window.getSelection();
                if (sel && sel.rangeCount > 0 && inputEl.contains(sel.getRangeAt(0).startContainer)) {
                    const range = sel.getRangeAt(0);
                    range.deleteContents();
                    const textNode = document.createTextNode(text + " ");
                    range.insertNode(textNode);
                    range.setStartAfter(textNode);
                    range.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(range);
                } else {
                    // Cursor outside or no cursor — append
                    inputEl.focus();
                    document.execCommand("insertText", false, text + " ");
                }
                inputEl.dispatchEvent(new Event("input", { bubbles: true }));
            }
        }

        function flashFeedback(pill) {
            const origBg = pill.style.backgroundColor;
            const origTransition = pill.style.transition;
            pill.style.transition = "background-color 0.15s";
            pill.style.backgroundColor = getAccentRgba(0.4);
            setTimeout(() => {
                pill.style.backgroundColor = origBg || "";
                setTimeout(() => { pill.style.transition = origTransition || ""; }, 200);
            }, 300);
        }

        function handleFilePillClick(e, pill) {
            const target = e.target;
            if (
                target.closest('button') ||
                target.closest('[role="button"]') ||
                target.closest('.remove, .close, .delete, .cancel-button') ||
                target.closest('[data-test-id="cancel-button"]') ||
                target.closest('svg') ||
                target.closest('mat-icon')
            ) return;

            e.preventDefault();
            e.stopPropagation();

            const fileName = getFileNameFromPill(pill);
            if (!fileName) return;

            const input = findChatInput();
            if (!input) return;

            insertTextAtCursor(input, fileName);
            flashFeedback(pill);
        }

        function extractAndSaveFileName(pill) {
            // If already has a VALID saved filename, skip
            const existing = pill.getAttribute("data-pagemark-filename");
            if (isValidFileName(existing)) return;
            // Clear corrupted value if any
            if (existing) pill.removeAttribute("data-pagemark-filename");

            // Gemini file: child [data-test-id="file-name"] with title attr
            const fileNameEl = pill.querySelector('[data-test-id="file-name"], [data-testid="file-name"], .file-name');
            if (fileNameEl) {
                const t = fileNameEl.getAttribute("title");
                if (isValidFileName(t)) { pill.setAttribute("data-pagemark-filename", t.trim()); return; }
                const tc = fileNameEl.textContent.trim();
                if (isValidFileName(tc)) { pill.setAttribute("data-pagemark-filename", tc); return; }
            }

            // Title attribute on the pill itself
            const titleAttr = pill.getAttribute("title");
            if (isValidFileName(titleAttr)) {
                pill.setAttribute("data-pagemark-filename", titleAttr.trim());
                return;
            }

            // aria-label (skip generic ones)
            const ariaLabel = pill.getAttribute("aria-label");
            if (isValidFileName(ariaLabel)) {
                pill.setAttribute("data-pagemark-filename", ariaLabel.trim());
                return;
            }

            // Fallback: clean text content
            const clone = pill.cloneNode(true);
            clone.querySelectorAll('button, [role="button"], svg, .cancel-button, .file-type, mat-icon').forEach(n => n.remove());
            const text = clone.textContent.replace(/\s+/g, " ").trim();
            if (isValidFileName(text)) {
                pill.setAttribute("data-pagemark-filename", text);
                return;
            }

            // Final fallback: use captured filenames from File API
            if (capturedFileNames.length > 0) {
                const fname = capturedFileNames.shift();
                if (isValidFileName(fname)) {
                    pill.setAttribute("data-pagemark-filename", fname);
                }
            }
        }

        function processFilePills() {
            if (!SITE_CONFIG.filePillSelector) return;
            const pills = document.querySelectorAll(SITE_CONFIG.filePillSelector);
            let index = 0;
            pills.forEach((pill) => {
                if (trackedFilePills.has(pill)) { index++; return; }
                trackedFilePills.add(pill);
                // Extract and save filename FIRST, before any DOM changes
                extractAndSaveFileName(pill);
                index++;
            });
        }

        function setupFilePillKeyboard() {
            document.addEventListener("keydown", (e) => {
                if (!e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
                const num = parseInt(e.key, 10) || parseInt(e.code?.replace("Digit", ""), 10);
                if (!num || num < 1 || num > 9) return;
                if (!SITE_CONFIG.filePillSelector) return;
                const pills = document.querySelectorAll(SITE_CONFIG.filePillSelector);
                const pill = pills[num - 1];
                if (!pill) return;

                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                const fileName = getFileNameFromPill(pill);
                if (!fileName) return;
                const input = findChatInput();
                if (!input) return;

                insertTextAtCursor(input, fileName);
                flashFeedback(pill);
            }, true);
        }


        // ========== File Input Capture (for images without DOM filename) ==========

        let capturedFileNames = [];

        function setupFileInputCapture() {
            // Intercept file input changes to capture filenames from File API
            document.addEventListener("change", (e) => {
                const input = e.target;
                if (input.tagName !== "INPUT" || input.type !== "file") return;
                if (!input.files || input.files.length === 0) return;
                const names = Array.from(input.files).map(f => f.name);
                capturedFileNames.push(...names);
                console.log("PageMark: Captured filenames:", names);
            }, true);
        }

        // ========== Initialize ==========

        async function init() {
            createSidebar();
            applyTheme();
            await loadAllDialogues();
            expandedFolders.add(currentPath);

            setTimeout(() => {
                processMessages();
                setupObserver();
                checkHashAndScroll();
                processFilePills();
            }, 800);

            setupFilePillKeyboard();
            setupFileInputCapture();

            // Periodic sync
            syncInterval = setInterval(async () => {
                await loadAllDialogues();
            }, 8000);

            console.log("PageMark: Ready on", SITE_CONFIG.platform);
        }

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", init);
        } else {
            init();
        }
    } // end initPageMark

})();
