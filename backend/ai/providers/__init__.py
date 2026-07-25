"""backend.ai.providers — provider plugins.

Importing this package triggers auto-discovery via base._autodiscover(),
which imports every module here so their @register decorators populate the
registry in backend/ai/base.py.
"""
from backend.ai.base import _autodiscover as _discover

_discover()
