# Contributing

Thanks for considering a contribution to Johnny CyberSuite X.

This project is developed in a single repository with a branching workflow.
Please read this guide before opening a pull request.

## Fork / branch workflow

1. Fork the repository on GitHub
2. Create a feature branch from the current development branch (for example
   `develop-v3.9`), not from `main`:

   ```bash
   git checkout develop-v3.9
   git checkout -b my-feature
   ```

3. Make your changes, then open a pull request against the development branch

## Development setup

See `README.md` → Installation for the full setup. In short:

```bash
git clone https://github.com/johnnywish78/CyberSuite.git
cd CyberSuite
npm install
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt
```

Run the application with `./start.sh`, or run the backend alone with:

```bash
PYTHONPATH=. python3 -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
```

## Tests

Run the test suite before submitting a pull request:

```bash
source venv/bin/activate
pytest tests -v
```

Some tests (`tests/test_release.py`, `tests/test_release_strict.py`) require
build artifacts in `dist/` and only pass after `npm run build`. If you cannot
build locally, mention it in the pull request.

## Code quality expectations

- Follow the existing code style in the files you touch (the backend uses
  Python 3 typing, async where appropriate, and the frontend uses the existing
  `app.js` patterns)
- Do not add comments that merely restate the code
- Keep changes focused on the issue at hand
- Do not bump the version in `VERSION`, `version.json` or `package.json`
  unless your change is explicitly a release task

## Pull request expectations

- Target the current development branch, not `main`
- Give the pull request a clear title and description of what changed and why
- Reference any related issue
- Ensure the test suite passes (or state exactly what is untestable and why)
- Keep the diff as small as reasonable

## No secrets in commits

- Never commit API keys, passwords, tokens, private keys, `.env` files or
  personal credentials
- API keys are stored locally in `~/.config/Johnny CyberSuite X/settings.json`
  and must never appear in the repository
- If you believe a secret has been committed, treat it as compromised, rotate
  it, and report it (see `SECURITY.md`)
