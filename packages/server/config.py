import json
import os
from pathlib import Path
from typing import Any


CONFIG_DIR = Path.home() / ".minion-orchestra"
CONFIG_FILE = CONFIG_DIR / "config.json"

DEFAULTS = {
    "port": 3000,
    "debug": False,
    "cleanup_interval_ms": 5000,
    "notifications": {
        "enabled": True,
        "macos_native": True,
        "on_waiting": True,
        "on_failed": True,
        "on_completed": False,
        "on_permission_request": True,
        "dedup_window_seconds": 30,
    },
    "session_watcher": {
        "enabled": True,
        "watched_directories": [],
    },
    "terminal": {
        "preferred": "auto",
        "auto_detect": True,
    },
}


class Config:
    def __init__(self):
        # Start with defaults
        self._data: dict = json.loads(json.dumps(DEFAULTS))

        # Load persisted config from file (merges into defaults)
        self._load()

        # Environment variables override file values
        env_port = os.environ.get("PORT")
        if env_port is not None:
            self._data["port"] = int(env_port)

        env_debug = os.environ.get("DEBUG")
        if env_debug is not None:
            self._data["debug"] = env_debug.lower() == "true"

    # ── Backward-compatible attribute access ──────────────────────────

    @property
    def cleanup_interval_ms(self) -> int:
        return self._data["cleanup_interval_ms"]

    @cleanup_interval_ms.setter
    def cleanup_interval_ms(self, value: int):
        self._data["cleanup_interval_ms"] = value

    @property
    def port(self) -> int:
        return self._data["port"]

    @port.setter
    def port(self, value: int):
        self._data["port"] = value

    @property
    def debug(self) -> bool:
        return self._data["debug"]

    @debug.setter
    def debug(self, value: bool):
        self._data["debug"] = value

    # ── Public mutators (all persist to disk) ─────────────────────────

    def set_cleanup_interval(self, ms: int) -> bool:
        """Set the cleanup interval in milliseconds. Must be between 1000 and 300000."""
        if 1000 <= ms <= 300000:
            self._data["cleanup_interval_ms"] = ms
            self._save()
            return True
        return False

    def set_notification_pref(self, key: str, value: Any) -> bool:
        """Update a single notification setting. Returns True if the key exists and was set."""
        if key not in DEFAULTS["notifications"]:
            return False
        expected_type = type(DEFAULTS["notifications"][key])
        if not isinstance(value, expected_type):
            return False
        self._data["notifications"][key] = value
        self._save()
        return True

    def set_session_watcher_pref(self, key: str, value: Any) -> bool:
        """Update a single session_watcher setting. Returns True if the key exists and was set."""
        if key not in DEFAULTS["session_watcher"]:
            return False
        expected_type = type(DEFAULTS["session_watcher"][key])
        # Allow list check for watched_directories
        if isinstance(DEFAULTS["session_watcher"][key], list):
            if not isinstance(value, list):
                return False
        elif not isinstance(value, expected_type):
            return False
        self._data["session_watcher"][key] = value
        self._save()
        return True

    def set_terminal_pref(self, key: str, value: Any) -> bool:
        """Update a single terminal setting. Returns True if the key exists and was set."""
        if key not in DEFAULTS["terminal"]:
            return False
        expected_type = type(DEFAULTS["terminal"][key])
        if not isinstance(value, expected_type):
            return False
        self._data["terminal"][key] = value
        self._save()
        return True

    def to_dict(self) -> dict:
        """Return the full configuration as a plain dictionary (deep copy)."""
        return json.loads(json.dumps(self._data))

    # ── Internal persistence ──────────────────────────────────────────

    def _load(self) -> None:
        """Read config from ~/.minion-orchestra/config.json and merge into current data.

        If the file does not exist or is corrupt, the in-memory defaults are kept.
        Nested dicts are merged so that new default keys are preserved even if the
        saved file is from an older version.
        """
        if not CONFIG_FILE.exists():
            return
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
        except (json.JSONDecodeError, OSError):
            return

        self._merge(self._data, saved)

    def _save(self) -> None:
        """Write the current config to ~/.minion-orchestra/config.json."""
        try:
            CONFIG_DIR.mkdir(parents=True, exist_ok=True)
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(self._data, f, indent=2)
                f.write("\n")
        except OSError:
            # If we cannot write (permissions, disk full, etc.), silently continue.
            # The in-memory config is still valid.
            pass

    @staticmethod
    def _merge(base: dict, overrides: dict) -> None:
        """Recursively merge *overrides* into *base* in place.

        Only keys that already exist in *base* are accepted so that stale or
        unknown keys in a saved file do not leak into the running config.
        """
        for key in base:
            if key in overrides:
                if isinstance(base[key], dict) and isinstance(overrides[key], dict):
                    Config._merge(base[key], overrides[key])
                else:
                    # Accept the override only if it matches the expected type
                    if isinstance(overrides[key], type(base[key])):
                        base[key] = overrides[key]


config = Config()
