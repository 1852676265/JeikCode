<div align="center">
  <img src="./assets/jeikcode-logo.svg" alt="JeikCode Logo" width="120" />
  <h1>JeikCode: 네이티브 코드 그래프 · 극한의 KV 캐시 · 크로스 플랫폼 올인원 에이전트 (TUI / WebUI / Desktop)</h1>
  <p><strong>네이티브 코드 그래프 · 98–99% KV 캐시 보존 · 크로스 플랫폼 올인원 에이전트 (TUI, WebUI, Desktop) · 고속 자가 복구</strong></p>
  <p>
    <em>복잡한 프로덕션 엔지니어링을 위해 구축된 차세대 자율 AI 코딩 에이전트 — 컨텍스트 비대화, 도구 루프 오류, 캐시 손실을 근본적으로 해결합니다.</em>
  </p>
  <p>
    <a href="./README.md"><strong>English (Default)</strong></a> · <a href="./README.zh-CN.md"><strong>简体中文</strong></a> · <a href="./README.zh-TW.md"><strong>繁體中文</strong></a> · <a href="./README.ja.md"><strong>日本語</strong></a> · <strong>한국어</strong> · <a href="./README.ru.md"><strong>Русский</strong></a> · <a href="./README.fr.md"><strong>Français</strong></a> · <a href="./README.es.md"><strong>Español</strong></a> · <a href="./README.de.md"><strong>Deutsch</strong></a> · <a href="./README.ar.md"><strong>العربية</strong></a> · <a href="./README.vi.md"><strong>Tiếng Việt</strong></a>
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
    🌐 <strong>공식 문서 포털</strong>: <a href="https://jeikcode.top"><strong>https://jeikcode.top</strong></a> · 
    ⭐ <strong>소스 코드</strong>: <a href="https://github.com/jeikl/JeikCode"><strong>https://github.com/jeikl/JeikCode</strong></a>
  </p>
</div>

---

## 📌 JeikCode란 무엇인가요?

**JeikCode**는 순수 **Rust**로 네이티브하게 개발된 차세대 크로스 플랫폼 오픈소스 AI 코딩 에이전트입니다. 대규모 프로덕션 소프트웨어 엔지니어링 환경을 위해 설계되어, 탁월한 속도와 제어력, 완벽한 멀티 디바이스 워크플로를 제공합니다:

- 🔍 **시맨틱 코드 그래프 (CodeExplore)**: 12개 이상의 주요 프로그래밍 언어를 지원하는 Tree-Sitter 기반. 비즈니스 자연어로 코드 구조와 호출 관계를 빠르게 탐색하며, 1~3ms 단위의 제로터치 증분 패치 지원;
- 🛡️ **98–99% 극한의 KV 캐시 보호 (Sacred Floor)**: 엄격한 추가 전용(append-only) 바이트 불변성과 메모리 보호(`sacred_floor`)를 통해 여러 턴에 걸쳐 프롬프트 접두사를 고정. 캐시 스래싱을 제거하고 토큰 비용을 90% 이상 절감하며 첫 토큰 생성 지연을 밀리초 단위로 단축;
- ⚡ **9k 미니멀 프롬프트 및 엄격한 규율**: 30~50k 토큰의 시스템 프롬프트 비대화를 방지. 기본 인사는 약 9~11k 토큰만 소모하여 컨텍스트 창을 실제 프로젝트 코드베이스에 온전히 보존;
- 📱 **옴니 플랫폼 워크플로**: 터미널 TUI, 최신 WebUI, Tauri 데스크톱 앱, 백그라운드 데몬 및 OpenWrt 라우터/게이트웨이 완벽 지원. Windows, macOS, Linux, OpenWrt 전반에서 일관된 경험 제공;
- 🔒 **Git 스타일의 상태 머신 원자적 보호**: 파일 편집 동시성 경계를 엄격히 관리하여 더티 라이트를 방지하고, 원클릭 실행 취소/롤백 체크포인트 제공;
- 🔄 **5대 산업 표준 프로토콜 네이티브 지원**: `OpenAI Chat`, `OpenAI Responses`, `Anthropic Claude`, `Google Gemini`, `Ollama` 형식을 완벽 통합하며 계정과 모델의 완전한 디커플링 구현.

---

## 🚀 빠른 시작

### 원클릭 설치 (권장)

```bash
# macOS & Linux
curl -fsSL https://jeikcode.top/install.sh | bash

# Windows (PowerShell)
irm https://jeikcode.top/install.ps1 | iex
```

### 설치 후 실행

```bash
# 대화형 터미널 TUI 실행
jeikcode

# WebUI 및 원격 서비스 실행
jeikcode serve --host 0.0.0.0 --port 13457
```
