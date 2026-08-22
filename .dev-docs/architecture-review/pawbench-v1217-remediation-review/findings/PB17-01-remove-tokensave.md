# PB17-01 Remove TokenSave

## Phenomenon

PawBench continues to treat TokenSave history as the transcript source, and the user no longer wants the TokenSave extension in Catui.

## Essence

TokenSave mixed two concerns:

- useful shell-output shortening;
- persistent analytics history that external systems could mistake for canonical agent transcript.

The second concern has repeatedly created integration ambiguity. Since the user has chosen removal, the product should stop shipping TokenSave as a default capability and remove the `/tokensave` command surface.

## Decision

Delete the TokenSave extension source from active product code, remove its default registry entry and test script coverage, and update P2 module documentation.

Historical review documents may keep references because they describe past decisions, but current topology must no longer list TokenSave as a default extension.

## Verification

- Registry tests assert no default or metadata `token-save` entry.
- Command-completion tests no longer import or assert `/tokensave`.
- `rg` over active source/test scripts shows no TokenSave product wiring.
