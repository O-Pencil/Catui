# UI01 — Framing introduced an external gutter

Message backgrounds render across the supplied width, but the framed editor
prepends a space to every box row. Its visible box therefore starts one column
later. The HTML prototype also subtracts two columns before adding this gutter.
Neither difference is required by the arrow or the editor's own internal padding.

Remove the external gutter and account for the remaining frame columns when
delegating to Editor. Preserve Editor as the sole owner of editing state. Verify
alignment on real component output; do not rely only on maximum-width assertions.
