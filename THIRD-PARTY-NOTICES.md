# Third-Party Notices

Johnny CyberSuite X uses third-party software components. Each component remains
subject to its own license and copyright. This notice lists the **direct**
dependencies declared by the project (see `package.json` and
`backend/requirements.txt`).

License information below was read from the locally installed package metadata
(`node_modules/` and the Python virtual environment) at the time of writing.
Transitive dependencies of these packages may have additional terms and are not
individually enumerated here.

## JavaScript / Electron

| Name | Version | License | Project |
| --- | --- | --- | --- |
| Electron | `^30.0.0` (installed `30.5.1`) | MIT | https://github.com/electron/electron |
| electron-builder | `^24.13.3` (installed `24.13.3`) | MIT | https://github.com/electron-userland/electron-builder |

### Runtime web component (loaded from CDN, not via npm)

| Name | Version | License | Notes |
| --- | --- | --- | --- |
| xterm.js | `5.3.0` | Verify from upstream project | Loaded at runtime from `cdn.jsdelivr.net` by `desktop/renderer/index.html`; xterm-addon-fit `0.8.0` used alongside it |

## Python (backend)

Versions are pinned in `backend/requirements.txt`.

| Name | Version | License | Project |
| --- | --- | --- | --- |
| FastAPI | `0.115.0` | MIT | https://github.com/fastapi/fastapi |
| Uvicorn | `0.30.6` | BSD | https://github.com/encode/uvicorn |
| websockets | `12.0` | BSD-3-Clause | https://github.com/python-websockets/websockets |
| psutil | `6.0.0` | BSD-3-Clause | https://github.com/giampaolo/psutil |
| requests | `2.32.3` | Apache-2.0 | https://github.com/psf/requests |
| python-dotenv | `1.0.1` | BSD-3-Clause | https://github.com/theskumar/python-dotenv |
| anthropic | `0.34.2` | MIT | https://github.com/anthropics/anthropic-sdk-python |
| openai | `1.45.0` | Apache-2.0 | https://github.com/openai/openai-python |
| google-generativeai | `0.7.2` | Apache-2.0 | https://github.com/google/generative-ai-python |
| python-multipart | `0.0.9` | Apache-2.0 | https://github.com/andrew-d/python-multipart |
| aiofiles | `24.1.0` | Apache-2.0 | https://github.com/Tinche/aiofiles |
| Jinja2 | `3.1.4` | BSD-3-Clause | https://github.com/pallets/jinja |
| Matplotlib | `3.9.2` | PSF (Python Software Foundation License) | https://matplotlib.org |
| ReportLab | `4.2.2` | BSD | https://www.reportlab.com/ |
| pytest | `8.3.3` | MIT | https://github.com/pytest-dev/pytest |

> **Note:** `pytest` is declared twice in `backend/requirements.txt`. The
> duplicate entry is harmless but should be cleaned up; this has been left
> untouched deliberately.

## Notes

- License classifications above were taken from local package metadata
  (`License` / `Classifier` fields) and are believed accurate as of the version
  shown. Always confirm against the upstream project before making legal
  determinations.
- xterm.js is not installed via npm; its license could not be verified from
  local package metadata and should be confirmed from
  https://github.com/xtermjs/xterm.js (it is commonly published under MIT).
- Runtime system tools invoked by the backend (e.g. `ping`, `traceroute`,
  `nmcli`, `iw`, `systemctl`, `whois`, `openvpn`, `wg`) are provided by the
  operating system and are subject to their own licenses.
