---
name: PNPM deployment installs
description: Preventing an install-time deployment failure caused by a mismatched pnpm package-manager pin.
---

Keep this workspace's `packageManager` pnpm version aligned with the pnpm runtime provided by Replit.

**Why:** A mismatched pin caused deployment package installation to repeatedly bootstrap another pnpm copy rather than proceed to dependency installation.

**How to apply:** When a publish log stops at `pnpm install`, check the active `pnpm --version` and the root package-manager pin before changing build commands or application code.