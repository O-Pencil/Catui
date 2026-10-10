# Composer alignment closure

Status: accepted locally.

The editor no longer prepends an external gutter. Its horizontal and vertical
box edges occupy the first and last supplied columns, matching user-message
background extents. Internal arrow spacing and configurable editor padding stay
inside the box. Autocomplete follows the shifted prefix. The HTML preview uses
the same outer width and updated cursor column, including pet-column accounting.

Validation: 11 focused tests passed, including exact message/composer boundary
comparison at 10/20/40/80/100/120 columns, wrapped CJK/ASCII, cursor preservation,
autocomplete acceptance and real VirtualTerminal typing/streaming viewport smoke.
All five gates passed: verify:dip, verify:quality, verify:package-boundary, build
and tsc --noEmit. git diff --check passed. Browser visual smoke confirmed the
120-column conversation with pets disabled; composer-aligned.png records it in
the existing external preview directory. The local preview server was restarted.

PR self-check: P3 and the existing P2 member description match the final owner;
no new modules, public exports, types, dependencies, reverse imports or model/
prompt costs. The review preceded implementation. Pet placement and the existing
under-10-column fallback are unchanged. The browser preview is outside the npm
package. Reopen for cell-boundary, cursor or autocomplete regressions.
