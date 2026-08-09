# Johnny CyberSuite X

**Johnny CyberSuite X 3.9.0 — Stable**

A modern, modular cybersecurity and network toolkit built around an Electron desktop interface and a Python/FastAPI backend.

> **Status:** Stable  
> **Version:** 3.9.0  
> **Build:** 390  
> **Stable checkpoint:** `v3.9.0-stable`

---

## ✨ Overview

Johnny CyberSuite X is designed as a unified desktop environment for network analysis, system monitoring, cybersecurity utilities, VPN/network diagnostics, and future extensible security tools.

The project combines:

- Electron desktop application
- HTML/CSS/JavaScript renderer
- Python backend
- FastAPI services
- Modular network tools
- Theme engine
- Cyberpunk-inspired interface
- Runtime session statistics
- Automated testing
- Linux packaging and release automation

---

## 🖥️ Current Interface

The v3.9.0 stable interface includes:

- Dashboard
- Network Center
- System monitoring
- VPN status and diagnostics
- Profile/session information
- Runtime uptime
- Tools-used tracking
- Task tracking
- Multiple visual themes
- Responsive themed layout
- Cyberpunk/neon visual design

The profile identity currently uses:

**CURIOUS MIND**

---

## 🏗️ Architecture

```text
Johnny CyberSuite X
│
├── desktop/
│   ├── main.js
│   ├── preload.js
│   └── renderer/
│       ├── index.html
│       ├── style.css
│       └── app.js
│
├── backend/
│   ├── FastAPI application
│   └── network/system services
│
├── assets/
├── build/
├── tests/
├── .github/
│   └── workflows/
├── package.json
├── VERSION
├── version.json
├── start.sh
└── README.md
🧰 Main Technologies
Desktop
Electron
JavaScript
HTML5
CSS3
Backend
Python
FastAPI
Uvicorn
Development
Git
GitHub
npm
Python virtual environments
pytest
GitHub Actions
electron-builder
Linux Packaging

The project supports Linux desktop packaging through Electron Builder, including:

AppImage
Debian package
🚀 Running From Source

Clone the repository:

git clone https://github.com/johnnywish78/CyberSuite.git
cd CyberSuite

Create/activate the Python environment as required by the project and install dependencies.

Then:

./start.sh

The application starts the Python backend and launches the Electron desktop interface.

🧪 Testing

Run the test suite with:

pytest tests -v

The v3.9 development checkpoint was verified with the project's automated test suite before being marked stable.

📦 Version

Current stable version:

3.9.0

Git tag:

v3.9.0-stable
🔐 Security

CyberSuite is intended for legitimate defensive security, network administration, diagnostics, learning, and authorized testing.

Only use network and security functionality against systems and networks for which you have permission.

📜 License

Johnny CyberSuite X source code is released under the MIT License.

See:

LICENSE

Third-party libraries and dependencies remain subject to their respective licenses.

👤 Author

Johnny Wish

Project:

Johnny CyberSuite X

GitHub:

https://github.com/johnnywish78/CyberSuite

❤️ Project Philosophy

CyberSuite is built around a simple idea:

CURIOUS MIND

Explore. Understand. Build. Secure.

⚠️ Disclaimer

This software is provided for educational, research, defensive security, system administration, and authorized testing purposes.

The author is not responsible for misuse of the software or for actions performed against systems without authorization.
