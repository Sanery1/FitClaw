---
name: permissions-network-enabled
description: A skill requesting unsupported command network access.
permissions:
  network: true
  commands:
    allow:
      - executable: python
        args: [scripts/query.py]
---

# Permissions Network Enabled
