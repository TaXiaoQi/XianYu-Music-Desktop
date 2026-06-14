<div align="center">
  <img src="logo.png" width="120" height="120" alt="Lycia Player Logo" style="border-radius: 24px; box-shadow: 0 8px 24px rgba(0,0,0,0.15);" />
  
  # Lycia Player

  A modern, high-performance, and beautiful desktop local music player built with **Tauri v2** and **Vue 3**. Tailored for Windows, focusing on immersive playback experience, outstanding lyrics display, and seamless system integration.

  [![简体中文](https://img.shields.io/badge/Document-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-red?style=flat-square)](./README.md)
  [![Tauri](https://img.shields.io/badge/Tauri-v2.0-2496ED?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app/)
  [![Vue](https://img.shields.io/badge/Vue-3.x-4FC08D?style=flat-square&logo=vue.js&logoColor=white)](https://vuejs.org/)
  [![TS](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![Rust](https://img.shields.io/badge/Rust-Stable-000000?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)
  [![Tailwind](https://img.shields.io/badge/TailwindCSS-v4.0-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
  
  [![Dev Last Commit](https://img.shields.io/github/last-commit//LyciaMusic/dev?style=flat-square&logo=git&logoColor=white&label=dev%20last%20commit)](https://github.com//LyciaMusic/commits/dev)
  [![Stars](https://img.shields.io/github/stars//LyciaMusic?style=flat-square&logo=github&label=stars)](https://github.com//LyciaMusic/stargazers)
  [![Contributors](https://img.shields.io/github/contributors//LyciaMusic?style=flat-square&color=blueviolet)](https://github.com//LyciaMusic/graphs/contributors)
  [![License](https://img.shields.io/badge/License-AGPL--3.0-orange?style=flat-square)](./LICENSE)
  [![QQ Group](https://img.shields.io/badge/QQ%E7%BE%A4-1085716541-df3e3e?style=flat-square&logo=tencent-qq&logoColor=white)](https://qm.qq.com/cgi-bin/qm/qr?k=xxxx)
</div>

---

> [!IMPORTANT]
> **Project Status: Under Development (Alpha)**
> This project is developed based on personal interest. Features are prioritized around the author's local music usage scenarios. Test coverage for some features is still limited and has not been thoroughly tested. If you encounter issues during daily use, feel free to report them via [GitHub Issues](https://github.com//LyciaMusic/issues).
>
> Due to limited time and energy, development progresses slowly. If you are a developer, or familiar with AI-assisted coding (Vibe Coding), you are more than welcome to expand features using AI tools and submit a Pull Request (please target the `dev` branch as priority).

---

## ✨ Key Features

* 🎨 **Aesthetic & Immersive UI**
  - **Dynamic Background System**: Experience fluid, Apple Music-style liquid mesh gradients that evolve based on album art colors. Supports static blur and custom user skins.
  - **Glassmorphism Visuals**: A polished, translucent interface that blends perfectly with your desktop environment.
  - **Responsive Layout**: Sidebar-driven navigation with a docked "Drawer-style" play queue for seamless interaction.

* 🚀 **Performance Optimized**
  - **Zero-Wait Startup**: Deeply customized main window skeleton screen with theme colors prevents any initial white flash.
  - **Smart Loading**: Route-based lazy loading and asynchronous component mounting ensure the app stays snappy.
  - **Concurrency Control**: Concurrency for image processing and metadata extraction during large music library scans is throttled using Rust semaphores to prevent CPU spikes.

* 🛠️ **Native Desktop Integration**
  - **System Integration**: Fully supports system media notifications, Windows media key controls, and system tray quick actions.
  - **Local Management**: High-performance music file scanning, metadata tag reading, and physical file renaming/organization.
  - **Advanced UX**: Custom context menus with smart boundary detection (auto-flip) and disabled browser defaults for a true native app feel.
  - **Desktop Lyrics**: Lightweight, high-performance floating lyrics overlay, supporting window lock, click-through, and style customization.

* 📝 **Lyrics & File Management**
  - **All-format Lyrics**: Supports embedded tags, external `.lrc` files, and AMLL-based word-by-word lyrics animation.
  - **Physical Organization**: Built-in folder management mode, batch rename preview, external tag editor, and background library refresh.

---

## 📸 Screenshots

### Core Interface

| 🎵 Home Overview | 💿 Immersive Player |
| --- | --- |
| <img src="./screenshots/%E9%A6%96%E9%A1%B5.png" width="100%"> | <img src="./screenshots/%E6%92%AD%E6%94%BE%E9%A1%B5.png" width="100%"> |

<details>
<summary>📂 Click to expand for more feature screenshots</summary>

### Library & File Management

| 📂 Folder View | ⚙️ Folder Management Mode |
| --- | --- |
| <img src="./screenshots/%E6%96%87%E4%BB%B6%E5%A4%B9.png" width="100%"> | <img src="./screenshots/%E6%96%87%E4%BB%B6%E5%A4%B9-%E7%AE%A1%E7%90%86%E6%A8%A1%E5%BC%8F.png" width="100%"> |

### Playlists, Statistics & Tools

| 🎶 Playlist Page | 📊 Playback History Stats |
| --- | --- |
| <img src="./screenshots/%E6%AD%8C%E5%8D%95%E9%A1%B5%E9%9D%A2.png" width="100%"> | <img src="./screenshots/%E7%BB%9F%E8%AE%A1.png" width="100%"> |

### Settings & Personalization

| 🔧 General Settings | 📦 Library Settings |
| --- | --- |
| <img src="./screenshots/%E8%AE%BE%E7%BD%AE-%E5%B8%B8%E8%A7%84.png" width="100%"> | <img src="./screenshots/%E8%AE%BE%E7%BD%AE-%E9%9F%B3%E4%B9%90%E5%BA%93.png" width="100%"> |

### External Integration

| 🔗 Lyricify Integration Support |
| --- |
| <img src="./screenshots/%E6%94%AF%E6%8C%81Lyricify.png" width="50%"> |

</details>

---

## 🛠️ Run from Source

### Prerequisites

| Dependency | Required Version |
| :--- | :--- |
| **Node.js** | `>= 18` |
| **Rust** | Latest stable release |
| **OS** | Windows 10 / 11 |
| **WebView2** | Ensure WebView2 runtime is installed (Default in Windows 11) |

### Development & Build Steps

1. Clone the repository:
   ```bash
   git clone https://github.com//LyciaMusic.git
   cd LyciaMusic
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start Tauri desktop app in development mode:
   ```bash
   npm run tauri dev
   ```

4. Debug the frontend UI in browser only:
   ```bash
   npm run dev
   ```

5. Build production executable installer:
   ```bash
   npm run tauri build
   ```

---

## 📐 Technology Architecture

Lycia Player adopts a classic separation of frontend and backend architecture, utilizing Tauri's IPC channel for high-performance cross-process communication:

```mermaid
graph TD
    subgraph Frontend [Frontend UI - Vue 3 / TS]
        A[Views] --> B[Components]
        B --> C[Composables]
        C --> D[Playback State / Metadata / Lyrics]
    end

    subgraph Bridge [Cross-Process IPC]
        D <-->|Tauri IPC invoke/listen| E[Tauri Command Router]
    end

    subgraph Backend [Rust Backend Services]
        E --> F[Audio Engine Rodio]
        E --> G[Database SQLite/rusqlite]
        E --> H[File Scanner & Metadata Parser]
        H -->|Concurrency Limit Semaphore| I[Local Music Folder]
    end
    
    style Frontend fill:#f5faff,stroke:#3178C6,stroke-width:2px;
    style Bridge fill:#fff7e6,stroke:#ffa940,stroke-width:2px;
    style Backend fill:#f6ffed,stroke:#52c41a,stroke-width:2px;
```

- **Frontend Stack**: Vue 3 (Composition API), Vite, TypeScript, Tailwind CSS 4.0
- **Backend Stack**: Rust, Tauri v2.0, SQLite (via `rusqlite` for high-performance indexing)
- **Audio Playback Engine**: Under the hood control powered by the `rodio` library

---

## 💝 Special Thanks

- **[AMLL (Apple Music-like Lyrics)](https://github.com/Steve-xmh/Apple-Music-Like-Lyrics)**: Adaptations and rendering implementations of lyrics in this project are heavily inspired and adapted from AMLL. Special thanks to the original author and all contributors!

---

## 👥 Contributors & Commit Stats

Thanks to everyone who has contributed to Lycia Player through commits and issue reports!

| Contributor | Avatar | Commits |
| :--- | :---: | :---: |
| **[](https://github.com/)** | <img src="https://github.com/.png" width="36" height="36" style="border-radius: 50%;" /> | **586** |
| **[](https://github.com/)** | <img src="https://github.com/.png" width="36" height="36" style="border-radius: 50%;" /> | **7** |

*If you submit a Pull Request and it gets merged, your avatar and commit stats will be shown here in the next document update.*

---

## 📈 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=/LyciaMusic&type=Date)](https://star-history.com/#/LyciaMusic&Date)

---

## ⚖️ License & Asset Statement

- **Open Source License**: This project is licensed under the **AGPL-3.0-only** license. See the [LICENSE](LICENSE) and [NOTICE](NOTICE) files for full details and attribution details.
- **Visual Assets Copyright**: All visual assets (including but not limited to application Logos, illustrations, and screenshots) contained in this project belong to the original author. No commercial use or redistribution of these assets is allowed without explicit authorization.

---

*Last Updated: 2026-06-08*

