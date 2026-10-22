<div align="center" dir="rtl">
  <img src="./assets/jeikcode-logo.svg" alt="JeikCode Logo" width="120" />
  <h1>JeikCode: مخطط كود أصلي · تخزين مؤقت فائق لـ KV · وكيل شامل متعدد المنصات (TUI / WebUI / Desktop)</h1>
  <p><strong>مخطط كود أصلي · حماية تخزين مؤقت لـ KV بنسبة 98–99% · وكيل شامل لجميع الأجهزة · استرداد ذاتي فائق السرعة</strong></p>
  <p>
    <em>الجيل الجديد من وكلاء البرمجة الذاتية بالذكاء الاصطناعي المصمم خصيصًا للهندسة البرمجية المعقدة في الإنتاج — يقضي على تضخم السياق وحلقات الأدوات المتعطلة وفقدان التخزين المؤقت.</em>
  </p>
  <p>
    <a href="./README.md"><strong>English (Default)</strong></a> · <a href="./README.zh-CN.md"><strong>简体中文</strong></a> · <a href="./README.zh-TW.md"><strong>繁體中文</strong></a> · <a href="./README.ja.md"><strong>日本語</strong></a> · <a href="./README.ko.md"><strong>한국어</strong></a> · <a href="./README.ru.md"><strong>Русский</strong></a> · <a href="./README.fr.md"><strong>Français</strong></a> · <a href="./README.es.md"><strong>Español</strong></a> · <a href="./README.de.md"><strong>Deutsch</strong></a> · <strong>العربية</strong> · <a href="./README.vi.md"><strong>Tiếng Việt</strong></a>
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
    🌐 <strong>بوابة التوثيق الرسمية</strong>: <a href="https://jeikcode.top"><strong>https://jeikcode.top</strong></a> · 
    ⭐ <strong>المستودع البرمجي</strong>: <a href="https://github.com/jeikl/JeikCode"><strong>https://github.com/jeikl/JeikCode</strong></a>
  </p>
</div>

---

## 📌 ما هو JeikCode؟

**JeikCode** هو وكيل برمجة ذاتي بالذكاء الاصطناعي من الجيل الجديد، مفتوح المصدر ومتعدد المنصات بالكامل، مبني بلغة **Rust** الصافية. صُمم خصيصًا للهندسة البرمجية الإنتاجية المعقدة، ويوفر سرعة فائقة وتحكمًا كاملاً وتدفق عمل سلس عبر الأجهزة المختلفة:

- 🔍 **مخطط الكود الدلالي (CodeExplore)**: مدعوم بمحرك Tree-Sitter لأكثر من 12 لغة برمجة. يتيح الاستعلام عن الكود وعلاقات الاستدعاء بلغة الأعمال الطبيعية، مع تحديثات تدريجية في غضون 1 إلى 3 مللي ثانية؛
- 🛡️ **حماية فائقة للتخزين المؤقت KV بنسبة 98–99% (Sacred Floor)**: يفرض ثباتًا صارمًا للبيانات وحماية الذاكرة (`sacred_floor`)، مما يثبت بادئات المحادثة عبر الجولات. يخفض تكاليف الرموز (Tokens) بأكثر من 90% ويقلل زمن الاستجابة إلى أجزاء من الثانية؛
- ⚡ **توجيهات موجزة بحجم 9k وانضباط عالٍ**: يتجنب تضخم التعليمات النظامية التي تصل إلى 30–50k رمز. تستهلك الجولة القياسية حوالي 9–11k رمز فقط، مما يوفر نافذة السياق القصوى لكود مشروعك الحقيقي؛
- 📱 **سير عمل متكامل عبر كافة المنصات**: تغطية كاملة: واجهة الطرفية TUI، واجهة الويب الحديثة WebUI، تطبيق سطح المكتب Tauri، الخدمات الخلفية، وأجهزة توجيه OpenWrt. تجربة متسقة وموحدة عبر أنظمة Windows و macOS و Linux و OpenWrt؛
- 🔒 **حماية ذرية للعمليات بأسلوب Git**: حدود صارمة لتعديل الملفات المتزامنة لمنع الكتابة الخاطئة، مع نقاط استعادة وتراجع بنقرة واحدة؛
- 🔄 **دعم أصلي لأهم 5 بروتوكولات قياسية**: تكامل تام مع `OpenAI Chat` و `OpenAI Responses` و `Anthropic Claude` و `Google Gemini` و `Ollama`، مع فصل كامل بين الحسابات والنماذج.

---

## 🚀 البدء السريع

### التثبيت بنقرة واحدة (موصى به)

```bash
# macOS و Linux
curl -fsSL https://jeikcode.top/install.sh | bash

# Windows (PowerShell)
irm https://jeikcode.top/install.ps1 | iex
```

### التشغيل بعد التثبيت

```bash
# تشغيل واجهة الطرفية التفاعلية TUI
jeikcode

# تشغيل خادم WebUI
jeikcode serve --host 0.0.0.0 --port 13457
```
