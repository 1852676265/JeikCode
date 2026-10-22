<div align="center">
  <img src="./assets/jeikcode-logo.svg" alt="JeikCode Logo" width="120" />
  <h1>JeikCode: ネイティブコードグラフ · 極限KVキャッシュ · クロスプラットフォーム統合エージェント（TUI / WebUI / デスクトップ）</h1>
  <p><strong>ネイティブコードグラフ · 98–99% KVキャッシュ保護 · クロスプラットフォーム統合エージェント (TUI, WebUI, Desktop) · 高速自己修復</strong></p>
  <p>
    <em>複雑な本番ソフトウェア開発のために設計された次世代の自律型AIコーディングエージェント — コンテキスト肥大化、ツールエラー、キャッシュ消失を一掃します。</em>
  </p>
  <p>
    <a href="./README.md"><strong>English (Default)</strong></a> · <a href="./README.zh-CN.md"><strong>简体中文</strong></a> · <a href="./README.zh-TW.md"><strong>繁體中文</strong></a> · <strong>日本語</strong> · <a href="./README.ko.md"><strong>한국어</strong></a> · <a href="./README.ru.md"><strong>Русский</strong></a> · <a href="./README.fr.md"><strong>Français</strong></a> · <a href="./README.es.md"><strong>Español</strong></a> · <a href="./README.de.md"><strong>Deutsch</strong></a> · <a href="./README.ar.md"><strong>العربية</strong></a> · <a href="./README.vi.md"><strong>Tiếng Việt</strong></a>
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
    🌐 <strong>公式ドキュメント</strong>: <a href="https://jeikcode.top"><strong>https://jeikcode.top</strong></a> · 
    ⭐ <strong>ソースコード</strong>: <a href="https://github.com/jeikl/JeikCode"><strong>https://github.com/jeikl/JeikCode</strong></a>
  </p>
</div>

---

## 📌 JeikCode とは？

**JeikCode** は、100% ピュアな **Rust** で構築された次世代のクロスプラットフォーム・フル機能オープンソース AI コーディングエージェントです。複雑な実稼働ソフトウェアエンジニアリング専用に設計されており、圧倒的な軽量性と高速性、完全な制御、エンドツーエンドのマルチデバイスワークフローを提供します：

- 🔍 **セマンティックコードグラフ (CodeExplore)**: 12以上の主要言語に対応する Tree-Sitter 駆動。ビジネス自然言語でコード構造や呼び出し関係を高速検索、1〜3ms のインクリメンタルパッチを実現；
- 🛡️ **98〜99% KVキャッシュ保護 (Sacred Floor)**: 厳格な追記専用（append-only）バイト不変性とメモリ保護により、マルチターン対話でもプレフィックスを固定。キャッシュ消失を根絶し、トークン費用を90%以上削減、ミリ秒単位の TTFT を実現；
- ⚡ **9k ミニマルプロンプトと高い規律**: 30〜50k トークンの肥大化を排除。標準対話のシステム消費は約 9〜11k トークンに抑えられ、コンテキストウィンドウを最大限コードベースに開放；
- 📱 **オムニプラットフォームワークフロー**: ターミナル TUI、最新の WebUI、Tauri デスクトップアプリ、バックグラウンドデーモン、OpenWrt ルーター/ゲートウェイを完全網羅。Windows、macOS、Linux、OpenWrt 間で一貫した開発体験を提供；
- 🔒 **Gitスタイルの状態マシンアトミック保護**: ファイル編集の並行境界を厳格に保護し、ダーティライトを防止。ワンクリックの取り消し・ロールバックチェックポイントを完備；
- 🔄 **5大業界プロトコルのネイティブサポート**: `OpenAI Chat`、`OpenAI Responses`、`Anthropic Claude`、`Google Gemini`、`Ollama` フォーマットを統合、アカウントとモデルを完全に分離。

---

## 🚀 クイックスタート

### ワンクリックインストール（推奨）

```bash
# macOS & Linux
curl -fsSL https://jeikcode.top/install.sh | bash

# Windows (PowerShell)
irm https://jeikcode.top/install.ps1 | iex
```

### インストール後の起動

```bash
# 対話型 TUI を起動
jeikcode

# WebUI またはヘッドレスサービスを起動
jeikcode serve --host 0.0.0.0 --port 13457
```
