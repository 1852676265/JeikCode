<div align="center">
  <img src="./assets/jeikcode-logo.svg" alt="JeikCode Logo" width="120" />
  <h1>JeikCode: Graphe de Code Natif · Cache KV Extrême · Agent Tout-en-Un Multiplateforme (TUI / WebUI / Desktop)</h1>
  <p><strong>Graphe de Code Natif · Protection du Cache KV 98–99% · Agent Tout-en-Un (TUI, WebUI, Desktop) · Auto-Réparation Rapide</strong></p>
  <p>
    <em>Agent de programmation IA autonome de nouvelle génération conçu pour l'ingénierie logicielle complexe en production — éliminant la saturation du contexte, les boucles d'outils défaillantes et la dégradation du cache.</em>
  </p>
  <p>
    <a href="./README.md"><strong>English (Default)</strong></a> · <a href="./README.zh-CN.md"><strong>简体中文</strong></a> · <a href="./README.zh-TW.md"><strong>繁體中文</strong></a> · <a href="./README.ja.md"><strong>日本語</strong></a> · <a href="./README.ko.md"><strong>한국어</strong></a> · <a href="./README.ru.md"><strong>Русский</strong></a> · <strong>Français</strong> · <a href="./README.es.md"><strong>Español</strong></a> · <a href="./README.de.md"><strong>Deutsch</strong></a> · <a href="./README.ar.md"><strong>العربية</strong></a> · <a href="./README.vi.md"><strong>Tiếng Việt</strong></a>
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
    🌐 <strong>Documentation officielle</strong>: <a href="https://jeikcode.top"><strong>https://jeikcode.top</strong></a> · 
    ⭐ <strong>Code source</strong>: <a href="https://github.com/jeikl/JeikCode"><strong>https://github.com/jeikl/JeikCode</strong></a>
  </p>
</div>

---

## 📌 Qu'est-ce que JeikCode ?

**JeikCode** est un agent de codage IA autonome open source de nouvelle génération, multiplateforme et complet, développé nativement en pur **Rust**. Conçu pour les projets logiciels à haute complexité, il offre une rapidité exceptionnelle, un contrôle total et des flux de travail multi-appareils de bout en bout :

- 🔍 **Graphe de code sémantique (CodeExplore)** : Propulsé par Tree-Sitter sur plus de 12 langages. Interrogez l'architecture et les appels de code en langage naturel métier avec une mise à jour incrémentale en 1 à 3 ms ;
- 🛡️ **Protection du cache KV à 98–99% (Sacred Floor)** : Applique une immutabilité stricte des octets en ajout seul (append-only) et une protection mémoire (`sacred_floor`), figeant les préfixes de prompt entre les tours. Réduit les coûts de jetons de plus de 90% et comprime la latence initiale (TTFT) à quelques millisecondes ;
- ⚡ **Prompts minimaux de 9k & haute discipline** : Évite les prompts système de 30 à 50k jetons. Un tour standard ne consomme que ~9–11k jetons, préservant la fenêtre de contexte maximale pour votre code ;
- 📱 **Flux de travail omni-plateformes** : Couverture complète : interface terminal TUI, WebUI moderne, application de bureau Tauri, démons en arrière-plan et routeurs OpenWrt. Fonctionne parfaitement sous Windows, macOS, Linux et OpenWrt ;
- 🔒 **Protection atomique de machine à états style Git** : Délimitation stricte des éditions simultanées pour éviter les écritures corrompues, avec points de contrôle d'annulation et de retour en arrière en un clic ;
- 🔄 **Support natif de 5 protocoles industriels** : Intègre `OpenAI Chat`, `OpenAI Responses`, `Anthropic Claude`, `Google Gemini` et `Ollama`, avec un découplage complet des comptes et des modèles.

---

## 🚀 Démarrage rapide

### Installation en une commande (recommandé)

```bash
# macOS & Linux
curl -fsSL https://jeikcode.top/install.sh | bash

# Windows (PowerShell)
irm https://jeikcode.top/install.ps1 | iex
```

### Lancement après installation

```bash
# Lancer le terminal interactif TUI
jeikcode

# Lancer le service WebUI
jeikcode serve --host 0.0.0.0 --port 13457
```
