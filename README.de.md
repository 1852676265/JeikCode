<div align="center">
  <img src="./assets/jeikcode-logo.svg" alt="JeikCode Logo" width="120" />
  <h1>JeikCode: Nativer Code-Graph · Extremer KV-Cache · Plattformübergreifender All-in-One-Agent (TUI / WebUI / Desktop)</h1>
  <p><strong>Nativer Code-Graph · 98–99% KV-Cache-Schutz · Plattformübergreifender Agent (TUI, WebUI, Desktop) · Schnelle Selbstheilung</strong></p>
  <p>
    <em>Autonomer KI-Programmieragent der nächsten Generation, speziell für komplexe Softwareentwicklung in der Produktion entwickelt — eliminiert Kontextüberlastung, Tool-Fehlerschleifen und Cache-Verlust.</em>
  </p>
  <p>
    <a href="./README.md"><strong>English (Default)</strong></a> · <a href="./README.zh-CN.md"><strong>简体中文</strong></a> · <a href="./README.zh-TW.md"><strong>繁體中文</strong></a> · <a href="./README.ja.md"><strong>日本語</strong></a> · <a href="./README.ko.md"><strong>한국어</strong></a> · <a href="./README.ru.md"><strong>Русский</strong></a> · <a href="./README.fr.md"><strong>Français</strong></a> · <a href="./README.es.md"><strong>Español</strong></a> · <strong>Deutsch</strong> · <a href="./README.ar.md"><strong>العربية</strong></a> · <a href="./README.vi.md"><strong>Tiếng Việt</strong></a>
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
    🌐 <strong>Offizielle Dokumentation</strong>: <a href="https://jeikcode.top"><strong>https://jeikcode.top</strong></a> · 
    ⭐ <strong>Quellcode</strong>: <a href="https://github.com/jeikl/JeikCode"><strong>https://github.com/jeikl/JeikCode</strong></a>
  </p>
</div>

---

## 📌 Was ist JeikCode?

**JeikCode** ist ein autonomer, plattformübergreifender Open-Source-KI-Coding-Agent der nächsten Generation, der nativ in reinem **Rust** entwickelt wurde. Speziell für komplexe Softwareentwicklung in Produktionsumgebungen konzipiert, bietet er extreme Leichtigkeit, Geschwindigkeit und durchgängige Workflows über mehrere Geräte hinweg:

- 🔍 **Semantischer Code-Graph (CodeExplore)**: Unterstützt durch Tree-Sitter für über 12 Programmiersprachen. Ermöglicht das Abfragen von Code- und Aufrufbeziehungen in natürlicher Fachsprache mit inkrementellen Updates in 1–3 ms;
- 🛡️ **98–99% KV-Cache-Schutz (Sacred Floor)**: Erzwingt strikte Append-Only-Byte-Unveränderlichkeit und Speicherschutz (`sacred_floor`), wodurch System-Präfixe über Runden hinweg eingefroren bleiben. Senkt Token-Kosten um über 90% und minimiert die Antwortlatenz (TTFT) auf Millisekunden;
- ⚡ **9k Minimale Prompts & Hohe Disziplin**: Vermeidet überdimensionierte System-Prompts von 30–50k Tokens. Eine Standard-Runde verbraucht nur ~9–11k Tokens und reserviert das Kontextfenster für Ihren echten Code;
- 📱 **Plattformübergreifende Workflows**: Vollständige Abdeckung: Terminal-TUI, modernes WebUI, Tauri-Desktop-App, Hintergrund-Daemons und OpenWrt-Router. Nahtlose Nutzung unter Windows, macOS, Linux und OpenWrt;
- 🔒 **Atomarer Zustandsschutz im Git-Stil**: Strenge Grenzen für parallele Dateibearbeitung verhindern fehlerhafte Überschreibungen, inklusive Ein-Klick-Widerrufen und Rollback-Checkpoints;
- 🔄 **Native Unterstützung für 5 Industriestandards**: Integriert `OpenAI Chat`, `OpenAI Responses`, `Anthropic Claude`, `Google Gemini` und `Ollama` bei vollständiger Entkopplung von Konten und Modellen.

---

## 🚀 Schnellstart

### Ein-Klick-Installation (empfohlen)

```bash
# macOS & Linux
curl -fsSL https://jeikcode.top/install.sh | bash

# Windows (PowerShell)
irm https://jeikcode.top/install.ps1 | iex
```

### Starten nach der Installation

```bash
# Interaktive Terminal-TUI starten
jeikcode

# WebUI-Dienst starten
jeikcode serve --host 0.0.0.0 --port 13457
```
