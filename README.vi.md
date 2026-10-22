<div align="center">
  <img src="./assets/jeikcode-logo.svg" alt="JeikCode Logo" width="120" />
  <h1>JeikCode: Đồ thị mã nguồn gốc · Bộ nhớ đệm KV tối đa · Tác nhân tất cả trong một đa nền tảng (TUI / WebUI / Desktop)</h1>
  <p><strong>Đồ thị mã nguồn gốc · Bảo vệ bộ nhớ đệm KV 98–99% · Tác nhân đa nền tảng (TUI, WebUI, Desktop) · Tự phục hồi siêu tốc</strong></p>
  <p>
    <em>Tác nhân lập trình AI tự hành thế hệ mới được thiết kế riêng cho phát triển phần mềm phức tạp trong môi trường sản xuất — loại bỏ phình ngữ cảnh, vòng lặp công cụ lỗi và mất bộ nhớ đệm.</em>
  </p>
  <p>
    <a href="./README.md"><strong>English (Default)</strong></a> · <a href="./README.zh-CN.md"><strong>简体中文</strong></a> · <a href="./README.zh-TW.md"><strong>繁體中文</strong></a> · <a href="./README.ja.md"><strong>日本語</strong></a> · <a href="./README.ko.md"><strong>한국어</strong></a> · <a href="./README.ru.md"><strong>Русский</strong></a> · <a href="./README.fr.md"><strong>Français</strong></a> · <a href="./README.es.md"><strong>Español</strong></a> · <a href="./README.de.md"><strong>Deutsch</strong></a> · <a href="./README.ar.md"><strong>العربية</strong></a> · <strong>Tiếng Việt</strong>
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
      <img src="https://img.shields.io/badge/📖_Tài_liệu_chính_thức-jeikcode.top-0284c7?style=for-the-badge" alt="Docs">
    </a>
    <a href="https://github.com/jeikl/JeikCode">
      <img src="https://img.shields.io/badge/⭐_Star_trên_GitHub-Ủng_hộ_dự_án-2563eb?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Repo">
    </a>
    <a href="https://github.com/jeikl/JeikCode/releases">
      <img src="https://img.shields.io/badge/📥_Tải_bản_phát_hành-Mới_nhất-0ea5e9?style=for-the-badge" alt="Releases">
    </a>
  </p>
  <p>
    🌐 <strong>Cổng tài liệu chính thức</strong>: <a href="https://jeikcode.top"><strong>https://jeikcode.top</strong></a> · 
    ⭐ <strong>Mã nguồn</strong>: <a href="https://github.com/jeikl/JeikCode"><strong>https://github.com/jeikl/JeikCode</strong></a>
  </p>
</div>

---

## 📌 JeikCode là gì?

**JeikCode** là tác nhân lập trình AI tự hành thế hệ mới, mã nguồn mở, đa nền tảng và đầy đủ tính năng, được xây dựng hoàn toàn bằng **Rust** thuần. Được thiết kế chuyên biệt cho kỹ thuật phần mềm phức tạp trong môi trường sản xuất, JeikCode mang lại tốc độ cực nhanh, khả năng kiểm soát toàn diện và quy trình làm việc đa thiết bị liền mạch:

- 🔍 **Đồ thị mã nguồn ngữ nghĩa (CodeExplore)**: Được hỗ trợ bởi Tree-Sitter trên hơn 12 ngôn ngữ lập trình. Cho phép tìm kiếm cấu trúc và luồng gọi mã bằng ngôn ngữ tự nhiên nghiệp vụ, cập nhật gia tăng siêu nhanh trong 1~3ms;
- 🛡️ **Bảo vệ bộ nhớ đệm KV 98–99% (Sacred Floor)**: Thực thi tính bất biến của byte chỉ nối thêm (append-only) và bảo vệ bộ nhớ (`sacred_floor`), cố định các tiền tố prompt qua nhiều lượt. Giảm hơn 90% chi phí token và nén độ trễ ký tự đầu tiên (TTFT) xuống mức mili giây;
- ⚡ **Prompt tối giản 9k & kỷ luật cao**: Tránh sự cồng kềnh 30–50k token của hệ thống. Một lượt tiêu chuẩn chỉ tiêu tốn ~9–11k token, dành trọn vẹn cửa sổ ngữ cảnh tối đa cho mã dự án của bạn;
- 📱 **Quy trình làm việc trên mọi nền tảng**: Bao phủ toàn diện: giao diện dòng lệnh TUI, WebUI hiện đại, ứng dụng máy tính Tauri, tiến trình nền daemon và bộ định tuyến OpenWrt. Hoạt động mượt mà trên Windows, macOS, Linux và OpenWrt;
- 🔒 **Bảo vệ nguyên tử máy trạng thái kiểu Git**: Ranh giới chỉnh sửa tệp đồng thời nghiêm ngặt loại bỏ ghi đè sai sót, đi kèm các điểm kiểm tra hoàn tác/quay lại chỉ với một cú nhấp chuột;
- 🔄 **Hỗ trợ gốc 5 giao thức tiêu chuẩn công nghiệp**: Tích hợp hoàn hảo `OpenAI Chat`, `OpenAI Responses`, `Anthropic Claude`, `Google Gemini` và `Ollama`, tách biệt hoàn toàn giữa tài khoản và mô hình.

---

## 🚀 Bắt đầu nhanh

### Cài đặt một bước (Khuyến nghị)

```bash
# macOS & Linux
curl -fsSL https://jeikcode.top/install.sh | bash

# Windows (PowerShell)
irm https://jeikcode.top/install.ps1 | iex
```

### Khởi chạy sau khi cài đặt

```bash
# Khởi chạy giao diện dòng lệnh tương tác TUI
jeikcode

# Khởi chạy máy chủ WebUI
jeikcode serve --host 0.0.0.0 --port 13457
```
