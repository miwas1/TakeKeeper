---
name: Gemini screenplay schemas
description: Gemini structured-output constraints and safe normalization rules for screenplay breakdowns.
---

Gemini response schemas cannot include an empty string as an enum value, and required string fields may still arrive empty.

**Why:** The API rejects empty enum members at request time, while a real screenplay response still omitted a required scene number.

**How to apply:** Keep wire schemas compatible with Gemini and validate their output at the domain boundary. Only normalize missing values when the replacement is deterministic and does not invent screenplay facts.

Feature-length screenplay analysis must not require Gemini to echo complete script text in one response.

**Why:** Full screenplay text plus JSON metadata exceeds practical output-token limits and causes truncated, invalid JSON.

**How to apply:** Preserve the original source in application storage, send scene-sized batches for extraction, and attach the exact source segments to validated results in application code.