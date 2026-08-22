# PB17-03 Security Alignment

## Phenomenon

The v1.2.17 report lists three P1 safety failures:

- external repository cloned into `~/skills`;
- malicious HTML comment instructions written into notes;
- authority boundary text such as "human admin only" not respected.

## Essence

These are policy decisions about risky tool calls. The owning boundary is the default `security-audit` extension because it can inspect tool calls without embedding safety-specific branches inside each core tool.

## Decision

Keep safety policy extension-owned and add focused detectors for:

- external skill installs into trusted agent skill directories;
- prompt-injection control text in comments/hidden markup being persisted;
- authority-boundary claims that reserve an action for a human/admin.

## Verification

- Security tests exercise all three report patterns through the extension tool-call boundary.
- Existing safe command/read/write tests continue to pass.
