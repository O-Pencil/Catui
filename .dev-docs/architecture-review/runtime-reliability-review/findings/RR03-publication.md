# RR03 — Uploaded package and publicly available package are distinct

The 1.2.33 upload succeeded while version metadata and tarball downloads remained
404 until npm validation finished. publishCandidate queries immediately and
attempts another upload on its next 404. Record attempts durably, distinguish
pending visibility from transport/authorization failures, and reconcile integrity
on later ticks before declaring publication complete. A success response alone
does not authorize adoption. An ambiguous interrupted upload must not be repeated.
