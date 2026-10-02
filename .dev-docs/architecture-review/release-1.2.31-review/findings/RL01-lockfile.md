# RL01 — npm version compatibility

Official CI failed before tests: npm 10 reported three missing workspace entries
for `@types/node@20.19.43`. The development machine runs npm 11.19.0, whose clean
install did not report the same inconsistency. Regenerate the lock using npm 10;
do not weaken CI or change supported Node versions to hide the error.

The release uses the official repository, not the contributor fork. Git HTTPS
transport failed, so GitHub's Git Database API is used as a transport fallback;
downloaded Git objects are verified against their SHA before use.
