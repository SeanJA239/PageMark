# PageMark 🔖

PageMark is a spatial memory tool designed to bridge the gap between your web browser and native iOS environment. It is a Safari Web Extension and an accompanying native iOS app that doesn't just save a link—it anchors your exact cognitive context (scroll position and selected text) so you can instantly retrieve it later.

Created for the **Apple Swift Student Challenge**.

## ✨ Key Features

* **Context Capture:** Save your exact reading state (URL, page title, scroll position) directly from Safari with a single tap.
* **Precision Restoration:** Tap a saved memory node in the iOS app to automatically open Safari and scroll exactly to where you left off.
* **Privacy & Local First:** All data is stored locally on-device using SwiftData. No external servers or tracking.
* **Inclusive Design:** Built with accessibility in mind, featuring full support for VoiceOver, Dynamic Type, and keyboard navigation within the extension popup.

## 🛠️ Architecture & Tech Stack

This project focuses heavily on solving the complex cross-process communication challenge between a Web Extension and a native app:

* **Native App:** SwiftUI, MVVM Architecture.
* **Safari Web Extension:** HTML, CSS, JavaScript (DOM manipulation & state extraction).
* **Data Bridge:** `SFSafariApplication.dispatchMessage` (Native Messaging) combined with **App Groups** to securely bypass sandbox limitations.
* **Persistence:** SwiftData with a shared `ModelContainer` across targets.

## 🚀 How to Run & Test

1. Open `PageMark.xcodeproj` in Xcode (requires Xcode 16+).
2. Select the `PageMark` scheme and choose an iOS Simulator (iOS 17+ recommended).
3. Build and Run (`Cmd + R`).
4. **Enable the Extension:** - In the iOS Simulator, open the **Settings** app.
   - Navigate to **Safari** > **Extensions**.
   - Find **PageMark** and toggle it **ON**.
5. **Test the Flow:**
   - Open Safari in the simulator and browse to any webpage.
   - Tap the puzzle piece icon (Extensions) in the URL bar and select PageMark to save the page.
   - Return to the PageMark native app to view your saved card. Tap it to see the auto-scroll restoration in action!

## 📝 Developer's Note (MVP Status)

Due to the tight development timeline, I made a strategic engineering trade-off: I prioritized building a robust, secure, and accessible cross-process data bridge over achieving a highly polished visual UI. 

The current interface serves as a functional proof-of-concept (Minimum Viable Product). While the UI is intentionally minimal, the underlying architecture and accessibility foundations (Semantic Dynamic Type, combined VoiceOver elements, ARIA roles) are structurally sound and built for future iteration.