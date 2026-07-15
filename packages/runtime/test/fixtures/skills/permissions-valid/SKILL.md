---
name: permissions-valid
description: A skill with allowlisted commands.
permissions:
  network: false
  commands:
    allow:
      - executable: python
        args: [scripts/query.py]
      - executable: python3
        args: [scripts/query.py]
---

# Permissions Valid
