#!/usr/bin/env python3
"""Create a local confidential Alice client without printing its secret."""
import hashlib
import os
from pathlib import Path
import uuid
import secrets
import sys


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python3 scripts/init-alice-env.py <skill UUID from Yandex Dialogs>")
    try:
        skill_id = str(uuid.UUID(sys.argv[1]))
    except ValueError:
        raise SystemExit("Skill ID must be a UUID from Yandex Dialogs.")
    root = Path(__file__).resolve().parent.parent
    paths = [root / ".env.alice", root / ".env.alice-secret"]
    if any(path.exists() or path.is_symlink() for path in paths):
        raise SystemExit("Alice files already exist; nothing changed.")
    secret = secrets.token_hex(32)
    contents = [
        "ALICE_CLIENT_ID=planly-alice\n"
        f"ALICE_CLIENT_SECRET_SHA256={hashlib.sha256(secret.encode()).hexdigest()}\n"
        f"ALICE_SKILL_ID={skill_id}\n",
        secret + "\n",
    ]
    created = []
    try:
        for path, text in zip(paths, contents):
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            created.append(path)
            with os.fdopen(fd, "w") as stream:
                stream.write(text)
    except BaseException:
        for path in created:
            path.unlink()
        raise
    print("Created .env.alice (server configuration) and .env.alice-secret (console secret), mode 600.")
    print("Keep both private. Do not send their contents to chat or Git.")


if __name__ == "__main__":
    main()
