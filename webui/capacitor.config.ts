import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jeikcode.mobile',
  appName: 'JeikCode',
  webDir: 'dist',
  server: {
    // 允许通过 HTTP 协议与局域网 / Tailscale 主机通信，避免 iOS ATS 强拦截私有 IP
    cleartext: true,
    androidScheme: 'https',
    iosScheme: 'capacitor',
  },
  ios: {
    contentInset: 'automatic',
    allowsLinkPreview: false,
    scrollEnabled: false,
    preferredContentMode: 'mobile',
  },
};

export default config;
