---
name: permissions-invalid
description: A skill with invalid command permissions.
permissions:
  network: false
  commands:
    allow:
      - executable: python
        args: scripts/query.py
      - executable: ""
        args: []
      - executable: python3
        args: [scripts/missing.py]
---

# Permissions Invalid
