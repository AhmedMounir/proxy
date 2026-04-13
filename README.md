# High-Performance SSL/TLS Intercepting Forward Proxy (Bun / TypeScript)

A modern, high-performance forward proxy built with [Bun](https://bun.sh) and TypeScript. It features a scalable, event-driven hybrid Reactor/Pipeline architecture and a React Ink-based Terminal UI (TUI) for real-time monitoring of intercepted HTTP and HTTPS traffic.

## Features

- **High-Performance Non-Blocking I/O:** Built natively on Bun using asynchronous streams and a Reactor pattern.
- **On-the-Fly MITM TLS Termination:** Dynamically generates signed SSL certificates to inspect encrypted HTTPS traffic.
- **HAR Trace Recording:** Records traced requests into an asynchronous HAR (HTTP Archive) trace file. 
- **React Ink TUI:** Monitor active multiplexed connections and view real-time traffic details directly in your terminal.
- **Strictly Typed:** Written entirely in TypeScript for maximum maintainability and robustness.
- **Blind Relay Mode:** Automatically falls back to high-speed TCP blind relay if MITM interception is toggled off.

## Requirements

- [Bun](https://bun.sh/) (v1.0 or higher)

## Installation

1. **Clone the repository.**
2. **Install the dependencies:**

   ```bash
   bun install
   ```

## Generating the Root CA

To perform Man-in-the-Middle (MITM) SSL interception, the proxy requires a local Root Certificate Authority (CA) key pair.

If you don't already have `ca.pem` and `ca-key.pem` in your project root, you can generate them using OpenSSL:

```bash
# Generate the private key
openssl genrsa -out ca-key.pem 2048

# Generate the Root CA Certificate
openssl req -new -x509 -days 3650 -key ca-key.pem -out ca.pem -subj "/CN=My Proxy CA"
```

## How to Run the Proxy

1. **Start the Proxy Server:**

   ```bash
   bun start
   ```

### Supported Arguments

When starting the proxy, you can pass arguments to configure its listener. 
*(Note: Because of how `bun start` forwards CLI options, you can pass them directly).*

- `--host <ip>`, `-h`: The interface IP address to bind to. Defaults to `0.0.0.0` (all interfaces), which is ideal for sharing the proxy across WSL/Docker. For strict local loops, pass `--host 127.0.0.1`.
- `--port <number>`, `-p`: The port to listen on. Defaults to `8080`.

**Example:**
```bash
bun start -- --host 127.0.0.1 --port 9090
```

2. **Using the TUI:**
   Once running, you'll see an interactive terminal dashboard:
   - Press <kbd>m</kbd> to toggle MITM interception *(Defaults to `Disabled`)*.
   - Press <kbd>r</kbd> to toggle asynchronous HAR trace recording *(Defaults to `Stopped`)*.
   - Press <kbd>q</kbd> to safely shut down the proxy and exit.

## Setting Up Your System to Trust the CA

For the proxy to decrypt HTTPS traffic without browser security warnings, you must configure your OS or browser to trust the generated root CA (`ca.pem`).

**Warning:** Only trust this CA for local development and testing purposes. Never use it in a production environment.

### Step 1: Locate the `ca.pem` File
Ensure `ca.pem` is located in the root directory of the proxy project.

### Step 2: Import and Trust the CA Certificate
*The process varies depending on your OS/browser. See the options below:*

#### **Windows**
1. Double-click the `ca.pem` file.
2. Click **"Install Certificate..."** -> **"Current User"** -> **"Next"**.
3. Select **"Place all certificates in the following store"**.
4. Click **"Browse..."** and select **"Trusted Root Certification Authorities"**.
5. Click **"OK"**, **"Next"**, and **"Finish"**.

#### **macOS**
1. Open **Keychain Access**.
2. Select the **"System"** keychain on the left pane.
3. Drag and drop `ca.pem` into the certificates list.
4. Double-click the newly imported "My Proxy CA" certificate.
5. Expand the **"Trust"** section and set **"When using this certificate"** to **"Always Trust"**.

#### **Firefox (Uses its own trust store)**
1. Go to Firefox Settings -> **"Privacy & Security"**.
2. Scroll to the **"Certificates"** section and click **"View Certificates..."**.
3. In the **"Authorities"** tab, click **"Import..."** and select `ca.pem`.
4. Check **"Trust this CA to identify websites"** and click **"OK"**.

## Configuring Your Browser/System to Use the Proxy

### System-Wide Setup
- **Windows:** Go to **Settings > Network & Internet > Proxy**. Set Address to `127.0.0.1` and Port to `8080`.
- **macOS:** Go to **System Preferences > Network > Advanced > Proxies**. Check both "Web Proxy (HTTP)" and "Secure Web Proxy (HTTPS)", pointing them to `127.0.0.1` and port `8080`.

### Using WSL (Windows Subsystem for Linux)
*(For detailed WSL interception configuration like APT proxies and Mirrored Networking, you can set the environment variables.)*

#### For WSL2 (Default NAT Mode):
```bash
export WINDOWS_HOST=$(grep nameserver /etc/resolv.conf | awk '{print $2}')
export http_proxy="http://$WINDOWS_HOST:8080"
export https_proxy="http://$WINDOWS_HOST:8080"
export HTTP_PROXY="http://$WINDOWS_HOST:8080"
export HTTPS_PROXY="http://$WINDOWS_HOST:8080"
```
*(You may need to modify the proxy setup to bind to `0.0.0.0` instead of `127.0.0.1` via the codebase configuration to listen for cross-subnet NAT traffic).*

#### For WSL2 (Windows 11 Mirrored Networking):
If you have Windows 11, you can enable mirrored networking so localhost is shared between Windows and WSL.

1. **Enable Mirrored Networking:** Add the following to your `%USERPROFILE%\.wslconfig` file in Windows and restart WSL (`wsl --shutdown`):
   ```ini
   [wsl2]
   networkingMode=mirrored
   dnsTunneling=true
   autoProxy=true
   ```

2. **Set Environment Variables:** In WSL, simply point the proxy directly to `127.0.0.1`:
   ```bash
   export http_proxy="http://127.0.0.1:8080"
   export https_proxy="http://127.0.0.1:8080"
   export HTTP_PROXY="http://127.0.0.1:8080"
   export HTTPS_PROXY="http://127.0.0.1:8080"
   ```

#### Configure APT Package Manager (Optional)
If you want to intercept traffic from `apt` (e.g., when running `sudo apt update`), it won't automatically use your user-level HTTP proxy environment variables due to `sudo` isolation.

1. Create a new proxy configuration file for APT:
   ```bash
   sudo nano /etc/apt/apt.conf.d/80proxy
   ```
2. Add the following lines. Replace `IP_ADDRESS` with your proxy IP (`127.0.0.1` for mirrored networking, or your Windows host IP for NAT mode):
   ```text
   Acquire::http::Proxy "http://IP_ADDRESS:8080/";
   Acquire::https::Proxy "http://IP_ADDRESS:8080/";
   ```
3. Save the file. APT will now route its HTTP/HTTPS traffic through the proxy.

## Developer Scripts

You can execute the following scripts using Bun:
- `bun start`: Launch the interactive Proxy Server dashboard (TUI).
- `bun test`: Run the internal bounded test suites.
- `bun lint` / `bun lint:fix`: Run Biome checks and fix formatting/styling issues.
- `bun typecheck`: Run TypeScript compilation check `--noEmit`.
