<div align="center">
  <img src="./assets/jeikcode-logo.svg" alt="JeikCode Logo" width="120" />
  <h1>JeikCode: 原生程式碼圖譜 · 極致快取 · 跨平台全功能 Agent（TUI / WebUI / 桌面）</h1>
  <p><strong>原生程式碼圖譜 · 98–99% 極致快取 · 跨平台全功能 Agent (TUI / WebUI / Desktop) · 開源極速自癒</strong></p>
  <p>
    <em>專為大型複雜工程打造的新一代自主程式設計智慧體，告別可設定性差、上下文臃腫、工具報錯與快取雪崩。</em>
  </p>
  <p>
    <a href="./README.md"><strong>English (Default)</strong></a> · <a href="./README.zh-CN.md"><strong>简体中文</strong></a> · <strong>繁體中文</strong> · <a href="./README.ja.md"><strong>日本語</strong></a> · <a href="./README.ko.md"><strong>한국어</strong></a> · <a href="./README.ru.md"><strong>Русский</strong></a> · <a href="./README.fr.md"><strong>Français</strong></a> · <a href="./README.es.md"><strong>Español</strong></a> · <a href="./README.de.md"><strong>Deutsch</strong></a> · <a href="./README.ar.md"><strong>العربية</strong></a> · <a href="./README.vi.md"><strong>Tiếng Việt</strong></a>
  </p>
  <p>
    <a href="https://github.com/jeikl/JeikCode/releases" target="_blank">
      <img src="https://img.shields.io/github/v/release/jeikl/JeikCode?color=blue&label=version" alt="version">
    </a>
    <img src="https://img.shields.io/badge/rust-1.88%2B-orange.svg" alt="rust">
    <img src="https://img.shields.io/badge/license-Non--Commercial%20(CC--BY--NC--4.0)-red.svg" alt="license">
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows%20%7C%20HarmonyOS-lightgrey.svg" alt="platform">
    <a href="https://github.com/jeikl/JeikCode" target="_blank">
      <img src="https://img.shields.io/github/stars/jeikl/JeikCode?style=social" alt="GitHub Stars"/>
    </a>
  </p>
  <p>
    <a href="https://jeikcode.top">
      <img src="https://img.shields.io/badge/📖_Official_Documentation-jeikcode.top-0284c7?style=for-the-badge" alt="Docs">
    </a>
    <a href="https://github.com/jeikl/JeikCode">
      <img src="https://img.shields.io/badge/⭐_Star_on_GitHub-Support_Project-2563eb?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Repo">
    </a>
    <a href="https://github.com/jeikl/JeikCode/releases">
      <img src="https://img.shields.io/badge/📥_Download_Releases-Latest-0ea5e9?style=for-the-badge" alt="Releases">
    </a>
  </p>
  <p>
    🌐 <strong>官方文件門戶</strong>: <a href="https://jeikcode.top"><strong>https://jeikcode.top</strong></a> · 
    ⭐ <strong>原始碼倉庫</strong>: <a href="https://github.com/jeikl/JeikCode"><strong>https://github.com/jeikl/JeikCode</strong></a>
  </p>
</div>

---

## 📌 什麼是 JeikCode？

**JeikCode** 是專為大型複雜生產軟體工程打造的新一代自主開源 AI Coding Agent，全端由純 **Rust** 原生構築。告別傳統 Agent 工具報錯、上下文臃腫與快取雪崩，具備極致的效能、可控性與端到端跨裝置工作流：

- 🔍 **語意程式碼圖譜 (CodeExplore)**：原生 Tree-Sitter 引擎覆蓋 12+ 主流語言，無縫整合雙語同義詞庫 (`thesaurus`)，支援使用自然業務術語檢索架構與呼叫鏈，1~3ms 無感增量熱補丁；
- 🛡️ **98–99% 極致快取保護 (Sacred Floor)**：嚴格實施追加式（append-only）位元組不變性與記憶體保護 (`sacred_floor`)，多輪對話前綴絕對凍結，消除快取抖動，降低 Token 費用超 90%，首字延遲壓縮至毫秒級；
- ⚡ **9k 極簡 Prompt 與高度自律**：拒絕 30–50k 的臃腫 System Prompt。標準對話開局僅消耗約 9–11k Token，最大化上下文視窗留給您的真實專案程式碼；
- 📱 **全平台工作流與統一心智模型**：終端 TUI、現代 WebUI、Tauri 桌面端、背景常駐守護行程及 OpenWrt 軟路由/閘道全覆蓋。Windows、macOS、Linux、OpenWrt 均可無縫運行；
- 🔒 **Git 式狀態機原子化保護**：嚴格的檔案編輯並行邊界徹底杜絕髒寫，提供一鍵 Undo / 回退檢查點；
- 🔄 **原生支援五大業界標準協定**：深度適配 `OpenAI Chat`、`OpenAI Responses`、`Anthropic Claude`、`Google Gemini`、`Ollama`，帳號與模型徹底解耦。

---

## 🚀 快速上手

### 一鍵安裝（推薦）

```bash
# macOS & Linux
curl -fsSL https://jeikcode.top/install.sh | bash

# Windows (PowerShell)
irm https://jeikcode.top/install.ps1 | iex
```

### 安裝後啟動

```bash
# 啟動互動式終端 TUI
jeikcode

# 啟動 WebUI 服務
jeikcode serve --host 0.0.0.0 --port 13457
```
