# Release preparation

Prepared version 1.2.31 and release notes from the previous npm publication's
source commit, rather than stale local tags. npm 10 regenerated the three
missing Node type dependency entries without changing runtime dependencies.

Local validation passed: npm 10 clean install, all five repository gates,
complete root `npm test`, harness evaluation, embedded package-boundary checks
and diff whitespace checks. Publication remains conditional on official PR CI
and successful registry verification; this document does not assert publication.

Official integration: https://github.com/O-Pencil/Catui/pull/21.
The contributor fork was used for transport only. Release credentials are not
part of the working tree, package inputs or Git history.
