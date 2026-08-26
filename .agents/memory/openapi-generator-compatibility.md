---
name: OpenAPI generator compatibility
description: How to keep Orval's generated server validators compatible with this workspace's Zod runtime.
---

The OpenAPI-to-Zod generator emits `z.int()` for `type: integer` and `z.uuid()` for `format: uuid`, but the current workspace runtime resolves Zod 3, where those top-level helpers do not exist. Use `type: number` for API counts and plain strings for IDs in the OpenAPI document until the workspace moves to Zod 4.

**Why:** Otherwise codegen succeeds but the chained TypeScript library build fails on the generated validators.

**How to apply:** After any OpenAPI edit, run codegen immediately. Preserve stronger UUID and integer constraints in database/domain schemas while keeping transport schemas compatible.