---
name: data-schema-valid
description: Valid fixture for a Skill data namespace with a JSON Schema.
data:
  user_profile:
    type: object
    schema:
      type: object
      required: [goal]
      properties:
        goal:
          type: string
---

# Data Schema Fixture

Used by runtime Skill loader tests.
