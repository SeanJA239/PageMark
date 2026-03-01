// PageMark Background Script
// Routes messages between content script, popup, and native app handler

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const type = message.type;

    if (type === "pinMessage") {
        // Content script wants to save a pin → forward to native handler
        browser.runtime.sendNativeMessage("application.id", {
            type: "save",
            conversationPath: message.conversationPath,
            queryText: message.queryText,
            answerSnippet: message.answerSnippet,
            conversationTitle: message.conversationTitle,
            platform: message.platform,
        })
            .then((nativeResponse) => {
                sendResponse({ success: true, response: nativeResponse });
            })
            .catch((error) => {
                console.error("PageMark pin save error:", error);
                sendResponse({
                    success: false,
                    error: error.message || String(error),
                });
            });

        return true; // async sendResponse
    }

    if (type === "unpinMessage") {
        // Content script wants to delete a pin → forward to native handler
        browser.runtime.sendNativeMessage("application.id", {
            type: "delete",
            id: message.id,
        })
            .then((nativeResponse) => {
                sendResponse({ success: true, response: nativeResponse });
            })
            .catch((error) => {
                console.error("PageMark unpin error:", error);
                sendResponse({
                    success: false,
                    error: error.message || String(error),
                });
            });

        return true;
    }

    if (type === "getPins") {
        // Popup wants to fetch all pins → forward to native handler
        browser.runtime.sendNativeMessage("application.id", {
            type: "getPins",
        })
            .then((nativeResponse) => {
                sendResponse(nativeResponse);
            })
            .catch((error) => {
                console.error("PageMark getPins error:", error);
                sendResponse({
                    success: false,
                    error: error.message || String(error),
                });
            });

        return true;
    }

    if (type === "clearAll") {
        // Settings wants to clear all pins → forward to native handler
        browser.runtime.sendNativeMessage("application.id", {
            type: "clearAll",
        })
            .then((nativeResponse) => {
                sendResponse(nativeResponse);
            })
            .catch((error) => {
                console.error("PageMark clearAll error:", error);
                sendResponse({
                    success: false,
                    error: error.message || String(error),
                });
            });

        return true;
    }
});
