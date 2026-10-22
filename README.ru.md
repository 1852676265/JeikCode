<div align="center">
  <img src="./assets/jeikcode-logo.svg" alt="JeikCode Logo" width="120" />
  <h1>JeikCode: Нативный граф кода · Экстремальный KV-кэш · Кроссплатформенный агент «Все в одном» (TUI / WebUI / Desktop)</h1>
  <p><strong>Нативный граф кода · 98–99% защита KV-кэша · Кроссплатформенный агент (TUI, WebUI, Desktop) · Быстрое самовосстановление</strong></p>
  <p>
    <em>Автономный ИИ-ассистент нового поколения для сложной промышленной разработки ПО — забудьте о раздувании контекста, ошибках инструментов и деградации кэша.</em>
  </p>
  <p>
    <a href="./README.md"><strong>English (Default)</strong></a> · <a href="./README.zh-CN.md"><strong>简体中文</strong></a> · <a href="./README.zh-TW.md"><strong>繁體中文</strong></a> · <a href="./README.ja.md"><strong>日本語</strong></a> · <a href="./README.ko.md"><strong>한국어</strong></a> · <strong>Русский</strong> · <a href="./README.fr.md"><strong>Français</strong></a> · <a href="./README.es.md"><strong>Español</strong></a> · <a href="./README.de.md"><strong>Deutsch</strong></a> · <a href="./README.ar.md"><strong>العربية</strong></a> · <a href="./README.vi.md"><strong>Tiếng Việt</strong></a>
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
    🌐 <strong>Официальная документация</strong>: <a href="https://jeikcode.top"><strong>https://jeikcode.top</strong></a> · 
    ⭐ <strong>Исходный код</strong>: <a href="https://github.com/jeikl/JeikCode"><strong>https://github.com/jeikl/JeikCode</strong></a>
  </p>
</div>

---

## 📌 Что такое JeikCode?

**JeikCode** — это автономный агент программирования с искусственным интеллектом нового поколения с открытым исходным кодом, полностью написанный на чистом **Rust**. Разработанный для масштабных и сложных проектов, он обеспечивает исключительное быстродействие, полный контроль и удобный рабочий процесс на любых устройствах:

- 🔍 **Семантический граф кода (CodeExplore)**: Поддержка 12+ языков программирования на базе Tree-Sitter. Поиск архитектурных связей и логики на естественном языке бизнеса с инкрементальным обновлением за 1–3 мс;
- 🛡️ **98–99% Защита KV-кэша (Sacred Floor)**: Строгая неизменяемость байтов (append-only) и защита памяти (`sacred_floor`) фиксируют системные префиксы между раундами. Снижает затраты на токены более чем на 90% и сокращает задержку ответа (TTFT) до миллисекунд;
- ⚡ **Минималистичные промпты (9k) и высокая дисциплина**: Никаких раздутых системных инструкций на 30–50k токенов. Базовый раунд занимает всего ~9–11k токенов, сохраняя окно контекста для вашего реального кода;
- 📱 **Кроссплатформенные рабочие процессы**: Полный охват: терминальный интерфейс (TUI), современный WebUI, десктопное приложение Tauri, фоновые демоны и маршрутизаторы OpenWrt. Единый опыт на Windows, macOS, Linux и OpenWrt;
- 🔒 **Атомарная защита конечного автомата в стиле Git**: Четкие границы параллельного редактирования исключают грязную запись. Доступны контрольные точки для отката и отмены в один клик;
- 🔄 **Нативная поддержка 5 отраслевых протоколов**: Поддержка `OpenAI Chat`, `OpenAI Responses`, `Anthropic Claude`, `Google Gemini` и `Ollama` с полным разделением аккаунтов и моделей.

---

## 🚀 Быстрый старт

### Установка в одну команду (рекомендуется)

```bash
# macOS & Linux
curl -fsSL https://jeikcode.top/install.sh | bash

# Windows (PowerShell)
irm https://jeikcode.top/install.ps1 | iex
```

### Запуск после установки

```bash
# Запуск интерактивного терминала TUI
jeikcode

# Запуск WebUI или фоновой службы
jeikcode serve --host 0.0.0.0 --port 13457
```
