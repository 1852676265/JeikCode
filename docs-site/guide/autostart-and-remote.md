# Autostart & Remote Access

JeikCode can run as an always-on background daemon service on any physical machine, cloud instance, or gateway router. Wherever you are, you can connect from a browser, phone, tablet, or terminal for effortless remote management and AI pair programming.

---

## 1. Unified Cross-Platform CLI Autostart

Currently, the recommended and unified way to configure autostart is **via the command-line interface (CLI)**. This single approach seamlessly supports **Windows, Linux, macOS, and OpenWrt / iStoreOS**.

### 1. Unified Setup Command

Run the following command in your terminal, specifying your desired host, port, and security token:

::: code-group

```bash [Listen on All Interfaces (Recommended for Remote Access)]
# Allows LAN and remote multi-device access
jeikcode --host 0.0.0.0 --port 13457 --token your-secure-token
```

```bash [Loopback Only]
# Accessible only from local browser
jeikcode --host 127.0.0.1 --port 13457 --token your-secure-token
```

:::

> 🔒 **Security Notice**: To prevent unauthorized exposure and scanning, **binding to non-loopback interfaces (e.g. `0.0.0.0`) strictly requires `--token` or the `JEIKCODE_SERVER_TOKEN` environment variable**. Unauthenticated external exposure is rejected by design.

### 2. Automatic System Adaptation

Upon executing this command, the CLI **automatically diagnoses your OS characteristics** and prompts an interactive wizard to configure persistent background service:

- **Linux Distributions** (Ubuntu, Debian, CentOS, Arch, etc.): Automatically registered as a standard `systemd` unit;
- **macOS**: Automatically generates and loads a user-level `launchd` plist daemon;
- **OpenWrt / iStoreOS** (Routers and embedded gateways): Detects embedded environments and configures OpenWrt's native lightweight `procd` supervisor with automatic crash respawn;
- **Windows**: Automatically sets up background daemon services and logon autostart tasks.

You do not need to manually write complex `.service` files or supervisor scripts. Follow the terminal prompt to finish in seconds.

### 3. Immediate WebUI Remote Management

Once the background service is registered and running, the terminal immediately outputs the access URL with your authentication token:

```text
============================================================
JeikCode Daemon Service is ready!
Local WebUI URL:    http://127.0.0.1:13457/?token=your-secure-token
Remote Network URL: http://192.168.1.100:13457/?token=your-secure-token
============================================================
```

Open this link in any browser on your phone, tablet, or laptop connected to the same network (or over VPN / reverse proxy) to enjoy the full WebUI experience with live code graph search, file management, and multi-model dispatch.

> 📌 **Note for Windows Users**:  
> The Windows Desktop app does not currently feature a graphical autostart toggle in its UI. On Windows, please use the CLI command above to configure the background daemon service for autostart.

---

## 2. Desktop App: Built-in 0.0.0.0 Remote Service

If you use the **JeikCode Desktop App** on your workstation or laptop:

- **Always-on Background Listener**: Launching the desktop app naturally starts a background daemon listening on `0.0.0.0` protected by a strong, auto-generated random security token;
- **Zero Configuration**: As long as the desktop app is open on your computer, other devices on the same network can access the WebUI directly using your computer's IP and token;
- **Multi-Device Synchronization**: Actions taken from your mobile browser sync live with the desktop app in real time.

---

## 3. Managing Background Services

JeikCode provides straightforward cross-platform service management commands:

```bash
# List all registered JeikCode background services
jeikcode server list

# Uninstall and deregister a service (stops process and cleans up system scripts)
jeikcode server uninstall <SERVICE_ID>
```
