# Source Evolution

> P2 | Parent: ../AGENT.md

Member List
types.ts: Local source evolution configuration, observation, job and durable state contracts
cli.ts: Source evolution setup, daemon control, status, foreground launch and service installation
runtime/: Durable state, bounded subprocesses, observation bridge and supervisor
delivery/: Candidate repair, independent review, GitHub acceptance, publication and managed adoption

Source evolution is separately configured. Workers never inherit merge/publish authority.
