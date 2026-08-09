# Security Policy

Johnny CyberSuite X is a local desktop application. This document describes how
security issues should be handled and what the project expects from its users.

## Reporting a vulnerability

If you discover a security vulnerability in Johnny CyberSuite X, please report
it privately so it can be addressed before public disclosure.

A dedicated reporting channel has **not been configured yet** — the maintainer
must still define the preferred contact (for example a security email address
or a private GitHub Security Advisory). Until one is configured, use a private
issue or direct message to the repository maintainer rather than opening a
public issue with exploit details.

When reporting, please include:

- affected version(s)
- a description of the issue
- steps to reproduce
- impact assessment, if known

## Responsible disclosure

- Do not publicly disclose the issue until the maintainer has had a reasonable
  opportunity to fix it
- Do not access, modify or delete data you are not authorized to touch
- Do not run the built-in network tools against systems you do not own or are
  not explicitly authorized to test

## Scope

The repository is scanned for obvious secrets before release (see
`tests/test_security.py`). API keys are stored only in the per-user runtime
settings file (`~/.config/Johnny CyberSuite X/settings.json`), which is
excluded from version control.

## General guidance

- Never commit API keys, passwords or tokens to the repository
- Use environment variables for secrets in any deployment or CI context
- Keep dependencies updated; monitor upstream advisories for the third-party
  components listed in `THIRD-PARTY-NOTICES.md`
