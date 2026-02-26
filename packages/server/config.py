import os


class Config:
    def __init__(self):
        self.cleanup_interval_ms: int = 5000
        self.port: int = int(os.environ.get("PORT", 3000))
        self.debug: bool = os.environ.get("DEBUG", "").lower() == "true"

    def set_cleanup_interval(self, ms: int) -> bool:
        if 1000 <= ms <= 300000:
            self.cleanup_interval_ms = ms
            return True
        return False


config = Config()
