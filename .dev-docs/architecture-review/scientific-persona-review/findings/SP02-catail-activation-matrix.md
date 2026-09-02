# SP02 — Use an Explicit Activation Matrix

## Evidence

CRW03 protects Catui's coding default by forbidding keyword-based CATAIL activation. A dedicated scientific persona is itself an explicit user choice, but making every Vera turn a paper workflow would still mis-handle ordinary coding and administrative requests.

## Decision

| Persona | Intent | CATAIL activation |
|---|---|---|
| Any non-Vera persona | Ordinary coding or scientific vocabulary alone | No |
| Any non-Vera persona | `/skill:catail` or explicit request to use CATAIL | Yes |
| Vera | Scientific inquiry, experiment, evidence, paper, review, or publication work | Yes |
| Vera | Ordinary coding, debugging, file maintenance, or administration | No mandatory research workflow |

Vera grants persona-level authorization for scientific intent. CATAIL must still route to the smallest sufficient method and requested endpoint. It must not initialize a research workspace, run an experiment, or continue toward a paper without task need and user authority.

## Supersession

This finding narrows and supersedes the name-only activation rule in CRW03 for the active Vera persona only. CRW03 remains unchanged for every other persona.
