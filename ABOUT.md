
About Johnny CyberSuite X
Johnny CyberSuite X 3.9.0

Johnny CyberSuite X is a Linux-oriented desktop cybersecurity and network toolkit designed to bring multiple system, network, monitoring, and diagnostic capabilities into a single unified interface.

The project uses an Electron desktop shell with a Python/FastAPI backend.

Project Goals

CyberSuite is designed around the following principles:

Practical cybersecurity tooling
Network visibility
System monitoring
Modular architecture
Clean desktop integration
Expandable functionality
Automated testing
Reproducible releases
A distinctive cyberpunk-inspired user interface

The project is intended to evolve into a broader security workstation rather than remain a collection of unrelated scripts.

Architecture
Electron

Electron provides the desktop application shell and manages the native application lifecycle.

Renderer

The renderer is implemented with:

HTML
CSS
JavaScript

It provides the main user interface, dashboard, navigation, themes, and interactive tools.

Python Backend

The backend provides local services through FastAPI/Uvicorn.

This separation allows the UI and system/network functionality to evolve independently.

Major Components
Dashboard

Provides a centralized view of system and application status.

Network Center

Provides network-oriented diagnostics and information.

Monitor

Provides system monitoring information such as resource usage.

VPN Status

Provides VPN/network status information and diagnostics.

Theme Engine

CyberSuite includes a configurable visual theme system designed around the application's cyberpunk/neon identity.

Profile Session

The profile area tracks runtime session information such as:

Application uptime
Tools used
Tasks performed

These values are runtime statistics and reset when the application starts a new session.

Technology Stack
Component	Technology
Desktop shell	Electron
Frontend	HTML / CSS / JavaScript
Backend	Python
API framework	FastAPI
ASGI server	Uvicorn
Package management	npm / pip
Testing	pytest
CI/CD	GitHub Actions
Linux packaging	electron-builder
Source control	Git
Version 3.9.0

Version 3.9.0 represents the stable checkpoint following the v3.8 release line.

The stable checkpoint includes:

Updated profile/session interface
Improved themed layout
Improved typography/readability
Stabilized bottom navigation/status areas
VPN status integration
Updated profile identity
Correct startup version reporting
Stable Git checkpoint
Automated test verification
Stable Git tag

Git tag:

v3.9.0-stable

Commit checkpoint:

d66e3e8
Design Identity

The project uses a cyberpunk-inspired visual language with emphasis on:

Dark interfaces
Neon accents
High-contrast information
Technical typography
Modular panels
Security-console aesthetics

The current profile identity is:

CURIOUS MIND

This represents the project's philosophy of exploration and continuous learning.

Open Source and Third-Party Software

CyberSuite uses open-source software and libraries.

Important examples include:

Electron
FastAPI
Uvicorn
Python ecosystem packages
Node.js/npm ecosystem packages
pytest
electron-builder

Each third-party component remains governed by its own license and copyright terms.

The CyberSuite project license applies to the original CyberSuite source code only.

For the exact dependency versions and package metadata, see:

package.json
package-lock.json

and the Python dependency files included in the repository.

Responsible Use

Cybersecurity functionality must only be used against systems, networks, devices, and accounts for which the user has explicit authorization.

CyberSuite is not intended to facilitate unauthorized access, disruption, theft, or abuse.

Author

Johnny Wish

Project:

Johnny CyberSuite X

Repository:

https://github.com/johnnywish78/CyberSuite

Philosophy

CURIOUS MIND

Understand the system.

Observe the network.

Learn how things work.

Build better tools.

Secure what you control.
