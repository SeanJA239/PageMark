// PageMark Popup Script — Main + Settings + Privacy & Focus

const PLATFORM_DOMAINS = {
    claude: "claude.ai",
    chatgpt: "chatgpt.com",
    gemini: "gemini.google.com",
    grok: "grok.com",
    doubao: "www.doubao.com",
};

const PLATFORM_LABELS = {
    claude: "Claude",
    chatgpt: "ChatGPT",
    gemini: "Gemini",
    grok: "Grok",
    doubao: "Doubao",
};

document.addEventListener("DOMContentLoaded", async () => {
    const settingsView = document.getElementById("settingsView");
    const pinList = document.getElementById("pinList");
    const emptyState = document.getElementById("emptyState");
    const toast = document.getElementById("toast");
    const domainListEl = document.getElementById("domainList");

    // Load settings & apply theme
    const settings = await loadSettings();
    applyTheme(settings.theme);

    // Load pins & domain list
    loadPins();
    renderDomainList(settings.ignoredDomains || []);

    // ========== Navigation ==========

    document.getElementById("openSettings").addEventListener("click", () => {
        settingsView.classList.add("visible");
        settingsView.setAttribute("aria-hidden", "false");
        document.getElementById("closeSettings").focus();
    });

    document.getElementById("closeSettings").addEventListener("click", () => {
        settingsView.classList.remove("visible");
        settingsView.setAttribute("aria-hidden", "true");
        document.getElementById("openSettings").focus();
    });

    // ========== Theme Control ==========

    const themeControl = document.getElementById("themeControl");
    themeControl.querySelectorAll(".seg-btn").forEach(btn => {
        if (btn.dataset.value === settings.theme) {
            btn.classList.add("active");
            btn.setAttribute("aria-checked", "true");
        } else {
            btn.classList.remove("active");
            btn.setAttribute("aria-checked", "false");
        }

        btn.addEventListener("click", () => {
            themeControl.querySelectorAll(".seg-btn").forEach(b => {
                b.classList.remove("active");
                b.setAttribute("aria-checked", "false");
            });
            btn.classList.add("active");
            btn.setAttribute("aria-checked", "true");
            const theme = btn.dataset.value;
            applyTheme(theme);
            saveSetting("theme", theme);
            showToast("Theme updated");
        });
    });

    // ========== Domain Blacklist ==========

    const ignoreBtn = document.getElementById("ignoreCurrentBtn");

    ignoreBtn.addEventListener("click", async () => {
        try {
            const tabs = await browser.tabs.query({ active: true, currentWindow: true });
            if (!tabs[0]?.url) return;

            const hostname = new URL(tabs[0].url).hostname;
            if (!hostname) return;

            const result = await browser.storage.local.get(["ignoredDomains"]);
            const domains = result.ignoredDomains || [];

            if (domains.includes(hostname)) {
                showToast("Already disabled on " + hostname);
                return;
            }

            domains.push(hostname);
            await browser.storage.local.set({ ignoredDomains: domains });

            ignoreBtn.classList.add("done");
            ignoreBtn.innerHTML = "✓ Disabled on " + hostname;
            showToast("PageMark disabled on " + hostname);

            renderDomainList(domains);

            // Reset button after 2s
            setTimeout(() => {
                ignoreBtn.classList.remove("done");
                ignoreBtn.innerHTML = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
                    </svg>
                    Disable on this site
                `;
            }, 2000);
        } catch (e) {
            console.error("Failed to ignore domain:", e);
            showToast("Failed to get current tab");
        }
    });

    function renderDomainList(domains) {
        domainListEl.innerHTML = "";
        for (const domain of domains) {
            const item = document.createElement("div");
            item.className = "domain-item";
            item.innerHTML = `
                <span class="domain-name">${escapeHtml(domain)}</span>
                <button class="domain-remove" aria-label="Remove ${domain}">×</button>
            `;

            item.querySelector(".domain-remove").addEventListener("click", async () => {
                const result = await browser.storage.local.get(["ignoredDomains"]);
                const updated = (result.ignoredDomains || []).filter(d => d !== domain);
                await browser.storage.local.set({ ignoredDomains: updated });
                renderDomainList(updated);
                showToast("Re-enabled on " + domain);
            });

            domainListEl.appendChild(item);
        }
    }

    // ========== Clear All Data ==========

    const clearBtn = document.getElementById("clearAllBtn");
    let clearConfirming = false;
    let confirmTimer = null;

    clearBtn.addEventListener("click", async () => {
        if (!clearConfirming) {
            clearConfirming = true;
            clearBtn.classList.add("confirming");
            clearBtn.textContent = "Tap again to confirm";
            confirmTimer = setTimeout(() => resetClearBtn(), 3000);
            return;
        }

        // Confirmed — clear everything
        if (confirmTimer) clearTimeout(confirmTimer);
        clearBtn.disabled = true;
        clearBtn.textContent = "Clearing…";

        try {
            // 1. Clear native database (SwiftData PinNodes)
            await browser.runtime.sendMessage({ type: "clearAll" });
            // 2. Clear extension storage (settings, ignored domains)
            await browser.storage.local.clear();

            clearBtn.classList.remove("confirming");
            clearBtn.innerHTML = "✓ All data cleared";
            showToast("All data erased");

            // Reset UI
            renderDomainList([]);
            setTimeout(() => loadPins(), 500);
        } catch (e) {
            console.error("Clear failed:", e);
            clearBtn.textContent = "Error — try again";
            clearBtn.classList.remove("confirming");
        }

        clearBtn.disabled = false;
        clearConfirming = false;
    });

    function resetClearBtn() {
        clearConfirming = false;
        clearBtn.classList.remove("confirming");
        clearBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6l-2 14H7L5 6"></path>
                <path d="M10 11v6"></path>
                <path d="M14 11v6"></path>
            </svg>
            Clear All Data
        `;
    }

    // ========== Pin Loading ==========

    async function loadPins() {
        try {
            const response = await browser.runtime.sendMessage({ type: "getPins" });
            if (!response || !response.success || !response.pins || response.pins.length === 0) {
                showEmpty();
                return;
            }
            renderPins(response.pins);
        } catch (error) {
            console.error("PageMark popup error:", error);
            pinList.innerHTML = `<div class="error">Failed to load pins</div>`;
        }
    }

    function showEmpty() {
        pinList.classList.add("hidden");
        emptyState.classList.remove("hidden");
    }

    function renderPins(pins) {
        pinList.innerHTML = "";
        pinList.classList.remove("hidden");
        emptyState.classList.add("hidden");

        const groups = {};
        for (const pin of pins) {
            const key = pin.conversationPath;
            if (!groups[key]) {
                groups[key] = {
                    title: pin.conversationTitle,
                    platform: pin.platform,
                    conversationPath: pin.conversationPath,
                    pins: [],
                };
            }
            groups[key].pins.push(pin);
        }

        for (const [path, group] of Object.entries(groups)) {
            const folder = document.createElement("div");
            folder.className = "folder";

            const platformLabel = PLATFORM_LABELS[group.platform] || group.platform;

            const header = document.createElement("div");
            header.className = "folder-header";
            header.innerHTML = `
                <span class="folder-icon">▶</span>
                <span class="folder-title">${escapeHtml(group.title)}</span>
                <span class="folder-badge">${platformLabel}</span>
                <span class="folder-count">${group.pins.length}</span>
            `;

            header.addEventListener("click", () => folder.classList.toggle("expanded"));
            folder.appendChild(header);

            const pinsContainer = document.createElement("div");
            pinsContainer.className = "folder-pins";

            for (const pin of group.pins) {
                const card = document.createElement("div");
                card.className = "pin-card";
                card.innerHTML = `
                    <div class="pin-query">${escapeHtml(pin.queryText)}</div>
                    ${pin.answerSnippet ? `<div class="pin-snippet">${escapeHtml(pin.answerSnippet)}</div>` : ""}
                    <div class="pin-meta">${timeAgo(pin.timestamp)}</div>
                `;

                card.addEventListener("click", () => {
                    const domain = PLATFORM_DOMAINS[pin.platform] || pin.platform;
                    const url = `https://${domain}${pin.conversationPath}#pinboard=${encodeURIComponent(pin.queryText)}`;
                    browser.tabs.create({ url });
                });

                pinsContainer.appendChild(card);
            }

            folder.appendChild(pinsContainer);
            pinList.appendChild(folder);
        }

        const firstFolder = pinList.querySelector(".folder");
        if (firstFolder) firstFolder.classList.add("expanded");
    }

    // ========== Helpers ==========

    function escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    function timeAgo(ts) {
        const sec = Math.floor((Date.now() - ts) / 1000);
        if (sec < 60) return "just now";
        if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
        if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
        return `${Math.floor(sec / 86400)}d ago`;
    }

    function showToast(message) {
        toast.textContent = message;
        toast.classList.remove("visible");
        void toast.offsetWidth;
        toast.classList.add("visible");
        setTimeout(() => toast.classList.remove("visible"), 2000);
    }
});

// ========== Settings Persistence ==========

async function loadSettings() {
    try {
        const result = await browser.storage.local.get(["theme", "ignoredDomains"]);
        return {
            theme: result.theme || "system",
            ignoredDomains: result.ignoredDomains || [],
        };
    } catch (e) {
        return { theme: "system", ignoredDomains: [] };
    }
}

async function saveSetting(key, value) {
    try {
        await browser.storage.local.set({ [key]: value });
    } catch (e) {
        console.error("Failed to save setting:", e);
    }
}

function applyTheme(theme) {
    document.body.classList.remove("light-theme", "dark-theme");
    if (theme === "light") {
        document.body.classList.add("light-theme");
    } else if (theme === "dark") {
        // dark is default
    } else {
        if (window.matchMedia("(prefers-color-scheme: light)").matches) {
            document.body.classList.add("light-theme");
        }
    }
}
