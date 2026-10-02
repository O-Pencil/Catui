# Release 1.2.31 review

Owner: root package metadata, lockfile and changelog. Official delivery target:
`O-Pencil/Catui`; npm package: `catui-agent`.

The official PR combines the three already reviewed changes: runtime/default
skills, README branding and output guidance. No unrelated open PR is included.

Before publication, regenerate the lockfile with npm 10, which runs in CI, and
verify clean installation. Prepare a patch version and changelog, run all five
gates and the complete root test suite, then require official PR checks to pass.
Publish from the merged official commit and compare npm integrity with the
verified local package. Credentials remain in a temporary file outside Git.
