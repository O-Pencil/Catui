# RR01 — Session commit and notification ordering

Agent subscribers are synchronous. An async SessionEventHandler hides journal
exceptions in discarded promises. A delayed message_end hook also postpones
assistant tracking past agent_end. Existing tests await each handler explicitly,
so they do not reproduce actual dispatch. The event handler must perform durable
and state work before returning, and own ordered background notification and
completion errors. AgentSession must consume its completion/failure state.

Acceptance: actual Agent dispatch with delayed hooks still checks compaction;
write failures cause a prompt rejection and abort rather than an unhandled
rejection or autonomous continuation; prior hooks settle before session changes.
