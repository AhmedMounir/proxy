# Python SSL/TLS Intercepting Forward Proxy

This project is a self-contained Python script that functions as a forward proxy server capable of SSL/TLS interception (Man-in-the-Middle) to log HTTP and HTTPS traffic.

## Features

*   Acts as an HTTP/HTTPS forward proxy.
*   Listens on a configurable IP address and port.
*   Intercepts HTTPS connections using a dynamically generated certificate.
*   Dynamically generates TLS certificates signed by a local root Certificate Authority (CA).
*   Logs all HTTP and decrypted HTTPS traffic to the console and a log file.
*   Uses `asyncio` for efficient handling of concurrent connections.

## Requirements

*   Python 3.10+
*   `cryptography` library

## Installation

1.  **Clone the repository or download the `proxy.py` script.**

2.  **Install the required Python library:**

    ```bash
    uv pip install cryptography
    ```

## How to Run the Proxy

1.  **Execute the script from your terminal**, providing the host, port, and a log file path.

    ```bash
    python proxy.py --host 127.0.0.1 --port 8080 --log-file traffic.log
    ```

2.  When you run the script for the first time, it will automatically generate a root Certificate Authority (CA) certificate (`ca.pem`) and a private key (`ca-key.pem`) in the same directory.

## Setting Up Your System to Trust the CA

For the proxy to intercept and decrypt HTTPS traffic, you must configure your browser or operating system to trust the generated root CA.

**Warning:** Only trust this CA for development and testing purposes. Do not use it in a production environment.

### Step 1: Locate the `ca.pem` File

After running the proxy for the first time, a `ca.pem` file will be created in the same directory where the script is located.

### Step 2: Import and Trust the CA Certificate

You need to import `ca.pem` into your browser's or operating system's trust store. The process varies depending on your OS and browser.

#### **Windows**

1.  Double-click the `ca.pem` file.
2.  Click the **"Install Certificate..."** button.
3.  Choose **"Current User"** and click **"Next"**.
4.  Select **"Place all certificates in the following store"**.
5.  Click **"Browse..."** and select the **"Trusted Root Certification Authorities"** store.
6.  Click **"OK"**, then **"Next"**, and finally **"Finish"**.
7.  If you see a security warning, click **"Yes"** to install the certificate.

#### **macOS**

1.  Open the **Keychain Access** application.
2.  Select the **"System"** keychain.
3.  Drag and drop the `ca.pem` file into the certificates list.
4.  Find the "My Proxy CA" certificate in the list and double-click it.
5.  Expand the **"Trust"** section.
6.  Set **"When using this certificate"** to **"Always Trust"**.
7.  Close the window (you may need to enter your password).

#### **Firefox**

Firefox has its own separate trust store.

1.  Open Firefox settings.
2.  Go to **"Privacy & Security"**.
3.  Scroll down to the **"Certificates"** section and click **"View Certificates..."**.
4.  In the **"Authorities"** tab, click **"Import..."**.
5.  Select the `ca.pem` file.
6.  Check the box for **"Trust this CA to identify websites."**
7.  Click **"OK"**.

## Configuring Your Browser to Use the Proxy

After starting the proxy and trusting the CA, you need to configure your system or browser to route traffic through it.

### **System-Wide Proxy (Windows)**

1.  Go to **Settings > Network & Internet > Proxy**.
2.  Under "Manual proxy setup", turn on **"Use a proxy server"**.
3.  Set the **Address** to `127.0.0.1` and the **Port** to `8080` (or whatever you configured).
4.  Click **"Save"**.

### **System-Wide Proxy (macOS)**

1.  Go to **System Preferences > Network**.
2.  Select your active network connection (e.g., Wi-Fi).
3.  Click **"Advanced..."**, then go to the **"Proxies"** tab.
4.  Check the boxes for **"Web Proxy (HTTP)"** and **"Secure Web Proxy (HTTPS)"**.
5.  For both, enter `127.0.0.1` as the server and `8080` as the port.
6.  Click **"OK"** and then **"Apply"**.

### **Browser-Specific Proxy (e.g., using an extension)**

Alternatively, you can use a browser extension like "FoxyProxy" or "Proxy SwitchyOmega" to easily switch proxy settings without changing your system-wide configuration. Configure the extension to use `127.0.0.1` and port `8080`.

## Viewing the Traffic

Once the proxy is running and your browser is configured, all HTTP and HTTPS traffic will be logged to both the console and the specified log file (`traffic.log` in the example).
