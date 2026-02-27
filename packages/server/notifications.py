"""
Native macOS notifications for Minion Orchestra.

Sends desktop notifications for key agent events:
  - Agent waiting for input
  - Task failed
  - Task completed
  - Permission requests

Uses terminal-notifier if available (click opens dashboard),
falls back to osascript.

Includes per-agent deduplication to avoid notification spam.
"""

import shutil
import subprocess
import time
import logging

from config import config

logger = logging.getLogger(__name__)

# Deduplication tracking: (event_type, agent_id) -> last_notification_timestamp
_dedup_cache: dict[tuple[str, str], float] = {}

# Check once at import time whether terminal-notifier is available
_HAS_TERMINAL_NOTIFIER = shutil.which("terminal-notifier") is not None

DASHBOARD_URL = "http://localhost:3000"

# Maps event types to the corresponding config preference key
_EVENT_CONFIG_MAP: dict[str, str] = {
    "waiting": "on_waiting",
    "awaiting-permission": "on_waiting",
    "failed": "on_failed",
    "completed": "on_completed",
    "permission_request": "on_permission_request",
}


def _should_notify(event_type: str, agent_id: str) -> bool:
    """Check config preferences and dedup window before sending a notification."""
    notifications_cfg = getattr(config, "notifications", None) or {}

    # Global kill switch
    if not notifications_cfg.get("enabled", True):
        return False

    # macOS native notifications must be enabled
    if not notifications_cfg.get("macos_native", True):
        return False

    # Check per-event-type preference
    config_key = _EVENT_CONFIG_MAP.get(event_type)
    if config_key and not notifications_cfg.get(config_key, True):
        return False

    # Deduplication window
    dedup_window = notifications_cfg.get("dedup_window_seconds", 30)
    cache_key = (event_type, agent_id)
    now = time.time()
    last_sent = _dedup_cache.get(cache_key)

    if last_sent is not None and (now - last_sent) < dedup_window:
        return False

    return True


def _send_macos_notification(title: str, message: str, subtitle: str = "") -> None:
    """Send a native macOS notification.

    Prefers terminal-notifier (clicking opens the dashboard).
    Falls back to osascript if terminal-notifier is not installed.
    """
    if not _HAS_TERMINAL_NOTIFIER:
        return

    try:
        cmd = [
            "terminal-notifier",
            "-title", title,
            "-subtitle", subtitle,
            "-message", message,
            "-group", "minion-orchestra",
        ]
        subprocess.run(cmd, capture_output=True, timeout=5)
    except subprocess.TimeoutExpired:
        logger.warning("terminal-notifier timed out")
    except Exception as e:
        logger.warning(f"Failed to send notification: {e}")


async def notify(event_type: str, agent_id: str, agent_name: str, message: str,
                 folder: str = "", task: str = "") -> None:
    """Main entry point for sending a notification.

    Args:
        event_type: One of "waiting", "awaiting-permission", "failed",
                    "completed", "permission_request".
        agent_id:   Unique identifier for the agent.
        agent_name: Human-readable agent name (used in the notification).
        message:    Body text for the notification.
        folder:     Working directory folder name.
        task:       Current task description.
    """
    if not _should_notify(event_type, agent_id):
        return

    # Title: event type
    if event_type in ("waiting", "awaiting-permission"):
        title = "Agent Needs Attention"
    elif event_type == "failed":
        title = "Task Failed"
    elif event_type == "completed":
        title = "Task Completed"
    elif event_type == "permission_request":
        title = "Permission Requested"
    else:
        title = "Minion Orchestra"

    # Subtitle: agent name + folder
    subtitle_parts = [agent_name]
    if folder:
        subtitle_parts.append(folder)
    subtitle = " - ".join(subtitle_parts)

    # Message: task context + event detail
    body_parts = []
    if task:
        body_parts.append(task)
    if message and message != task:
        body_parts.append(message)
    body = "\n".join(body_parts) if body_parts else message

    _send_macos_notification(title=title, message=body, subtitle=subtitle)

    # Record send time for dedup
    _dedup_cache[(event_type, agent_id)] = time.time()
