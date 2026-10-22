<div align="center">
  <img src="./assets/jeikcode-logo.svg" alt="JeikCode Logo" width="120" />
  <h1>JeikCode: Grafo de Código Nativo · Caché KV Extrema · Agente Todo en Uno Multiplataforma (TUI / WebUI / Desktop)</h1>
  <p><strong>Grafo de Código Nativo · 98–99% Protección de Caché KV · Agente Multiplataforma (TUI, WebUI, Desktop) · Recuperación Ultrarrápida</strong></p>
  <p>
    <em>Agente de programación autónomo con IA de última generación diseñado para ingeniería de software compleja en producción — eliminando el desbordamiento de contexto, bucles de herramientas rotos y la degradación de caché.</em>
  </p>
  <p>
    <a href="./README.md"><strong>English (Default)</strong></a> · <a href="./README.zh-CN.md"><strong>简体中文</strong></a> · <a href="./README.zh-TW.md"><strong>繁體中文</strong></a> · <a href="./README.ja.md"><strong>日本語</strong></a> · <a href="./README.ko.md"><strong>한국어</strong></a> · <a href="./README.ru.md"><strong>Русский</strong></a> · <a href="./README.fr.md"><strong>Français</strong></a> · <strong>Español</strong> · <a href="./README.de.md"><strong>Deutsch</strong></a> · <a href="./README.ar.md"><strong>العربية</strong></a> · <a href="./README.vi.md"><strong>Tiếng Việt</strong></a>
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
    🌐 <strong>Portal de Documentación Oficial</strong>: <a href="https://jeikcode.top"><strong>https://jeikcode.top</strong></a> · 
    ⭐ <strong>Código Fuente</strong>: <a href="https://github.com/jeikl/JeikCode"><strong>https://github.com/jeikl/JeikCode</strong></a>
  </p>
</div>

---

## 📌 ¿Qué es JeikCode?

**JeikCode** es un agente autónomo de codificación con IA de código abierto, multiplataforma y con todas las funciones, construido de forma nativa en **Rust** puro. Diseñado para ingeniería de software de alta complejidad en producción, ofrece velocidad ultraligera, control total y flujos de trabajo multidispositivo:

- 🔍 **Grafo de Código Semántico (CodeExplore)**: Impulsado por Tree-Sitter en más de 12 lenguajes. Permite buscar relaciones de código y flujos en lenguaje natural de negocio, con actualización incremental en 1 a 3 ms;
- 🛡️ **Protección de Caché KV del 98–99% (Sacred Floor)**: Implementa inmutabilidad estricta de bytes (append-only) y preservación de memoria (`sacred_floor`), congelando prefijos entre turnos. Reduce los costos de tokens en más del 90% y comprime la latencia (TTFT) a milisegundos;
- ⚡ **Prompts Mínimos de 9k y Alta Disciplina**: Evita el consumo excesivo de 30–50k tokens en prompts del sistema. Un turno estándar consume solo ~9–11k tokens, reservando la ventana de contexto para su código real;
- 📱 **Flujos de Trabajo Omni-Plataforma**: Cobertura total: terminal TUI, WebUI moderna, aplicación de escritorio Tauri, demonios en segundo plano y routers OpenWrt. Experiencia unificada en Windows, macOS, Linux y OpenWrt;
- 🔒 **Protección Atómica de Máquina de Estados Estilo Git**: Límites estrictos de edición simultánea que eliminan escrituras sucias, con puntos de restauración y retroceso en un clic;
- 🔄 **Soporte Nativo para 5 Protocolos de la Industria**: Integra `OpenAI Chat`, `OpenAI Responses`, `Anthropic Claude`, `Google Gemini` y `Ollama`, con desacoplamiento total de cuentas y modelos.

---

## 🚀 Inicio Rápido

### Instalación en un paso (recomendado)

```bash
# macOS y Linux
curl -fsSL https://jeikcode.top/install.sh | bash

# Windows (PowerShell)
irm https://jeikcode.top/install.ps1 | iex
```

### Ejecución tras la instalación

```bash
# Iniciar TUI interactiva en terminal
jeikcode

# Iniciar servicio WebUI
jeikcode serve --host 0.0.0.0 --port 13457
```
