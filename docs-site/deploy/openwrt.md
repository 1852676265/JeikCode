# OpenWrt & Embedded Gateway Deployment

JeikCode is designed as a truly **Unified Cross-Platform AI Coding Agent**. Built natively in Rust and compiled against musl for static Linux binaries, JeikCode runs seamlessly on Windows, macOS, Linux, and embedded **OpenWrt** devices including popular derivatives such as **iStoreOS**, **ImmortalWrt**, **Kwrt**, and **LEDE** across `x86_64` and `aarch64` architectures.

Whether deploying JeikCode on an edge gateway as an always-on resident review agent or running automated network scripts directly on your router, you enjoy identical semantic code graph intelligence, tool executions, and ultra-high cache hit rates.

---

## 1. Quick Online Installation

Run the official one-liner in the OpenWrt terminal (via SSH or the web console):

```sh
curl -fsSL https://raw.githubusercontent.com/jeikl/JeikCode/main/scripts/install.sh | sh
```

### Automated Adaptations
* **Architecture Detection**: Automatically selects and downloads verified musl static binaries for `x86_64` or `aarch64/arm64`;
* **Automatic System Symlinking**: Automatically detects OpenWrt environments and creates `/usr/bin/jeikcode -> /usr/local/bin/jeikcode` in the system default PATH;
* **Zero Reload Required**: Ready immediately upon installation without requiring manual `source` commands or shell restart.

---

## 2. Boot Autostart Configuration (procd Wizard)

OpenWrt utilizes the lightweight `procd` init system rather than systemd. JeikCode CLI provides a built-in interactive setup wizard:

When launching with `--host`:

```sh
jeikcode --host 0.0.0.0 --port 13457 --token your-secure-token
```

JeikCode automatically identifies the OpenWrt environment and prompts:

```text
JeikCode is about to listen on 0.0.0.0:13457.
Register an OpenWrt (procd) service and start it on boot? [y/N]: y
Service name (Enter for jeikcode-13457): 
```

Confirm with `y`, and the wizard will automatically:
1. Capture the runtime environment and generate a standard `USE_PROCD=1` init script under `/etc/init.d/`;
2. Configure `respawn 3600 5 0` supervision rules to automatically recover from unexpected exits;
3. Execute `/etc/init.d/jeikcode-13457 enable` to register boot autostart;
4. Start the background service, display access URLs, and cleanly restore your terminal prompt.

---

## 3. Service Management and Uninstallation

Manage your service via OpenWrt native commands or JeikCode's unified CLI:

### 1. OpenWrt Native Commands

```sh
# Check service status
/etc/init.d/jeikcode-13457 status

# Restart service
/etc/init.d/jeikcode-13457 restart

# Stop service
/etc/init.d/jeikcode-13457 stop

# Disable boot autostart
/etc/init.d/jeikcode-13457 disable

# Inspect system logs
logread -e jeikcode
```

### 2. JeikCode Unified CLI Commands

```sh
# List all registered JeikCode services on the system
jeikcode server list

# Uninstall a specific service by ID
jeikcode server uninstall <ID>
```

---

## 4. Storage Optimization Recommendations

When running agents on routers and embedded hardware, keep internal Flash (Overlay) constraints in mind:

1. **Redirect Data Directory**:
   JeikCode stores session transcripts, logs, and code graph indices under `~/.jeikcode`. If an external SSD or USB drive is mounted (e.g. `/mnt/sda1`), redirect the data directory:
   ```sh
   echo 'export JEIKCODE_HOME="/mnt/sda1/.jeikcode"' >> /etc/profile
   ```
2. **Mount Permissions**:
   Ensure the external mount target has read/write permissions (ext4 is recommended).
