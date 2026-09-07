# GG01: Queue and run ownership

status: resolved

A paused goal clears the complete follow-up queue on unrelated turns. Grub treats
abort as retry and accepts any agent_end while awaitingTurn is set. Resume either
does nothing (Goal) or duplicates dispatch (Grub). Budget crossing acknowledges
an unsent notice. Terminal Grub tasks are excluded from resume discovery, while
Goal run allowances confuse assistant cycles and cannot be renewed.

These defects were reproduced against e496366 using production controllers and
extension hooks, despite all 69 existing controller tests passing. Repair the
ownership boundary and add lifecycle integration tests, rather than adding more
prompt warnings. Product policy belongs to the two extensions; only reusable
queue and lease mechanics belong to the host.
