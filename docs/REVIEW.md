# Final review (P6)

The automated `code-reviewer` / `security-reviewer` subagents were cut off by an API session limit during the final
phase, so the review below was done by hand on the highest-risk areas. Findings and their fixes:

| Sev | Area | Finding | Fix |
|---|---|---|---|
| HIGH | server/engine/runner | Deterministic setup ids (`stp-<playbook>-<zone>`) collided when a zone was proposed again after its earlier setup ended, overwriting the journal entry. | Runner aliases re-proposals to `<id>~n` while keeping the active alias stable (`withUniqueId`, tested). |
| HIGH | server/market/feed | A re-sent last M1 bar (possible with the Twelve Data poller) was merged twice into the forming M5/M15/M30 buckets. | Buckets are rebuilt from the M1 history when the last bar is replaced (tested). |
| MEDIUM | server/http | No authentication and no rate limiting on mutating routes (`/api/chat`, `/api/playbook/run`, replay controls); fine on localhost, risky if exposed. | Optional `SERVER_API_TOKEN` (Bearer on POST + `?token=` on `/ws`) and a per-IP fixed-window limit `API_RATE_LIMIT_PER_MINUTE` (tested). |
| MEDIUM | server/agents | Validator re-ran (and would spend LLM tokens) on every entry-TF close while price sat inside a zone. | Fingerprint per setup (status + pressure); re-run only when it changes. |
| MEDIUM | server/main | `feed.push` ran outside the try/catch of the feed callback; a provider edge case could crash the process. | Whole callback guarded; errors go to the log and the activity log. |
| LOW | db | `sql.raw` is used only for the fixed view names and `ASC/DESC`; all values are parameterized. | No change. |
| LOW | copilot | Tool inputs are zod-validated; `drawAnnotation` only accepts prices within 0.01 of engine-known levels; no tool touches the filesystem or network. | No change. |
| INFO | web | The only `dangerouslySetInnerHTML` is the constant theme-boot script; model/agent text is rendered as text. | No change. |
| INFO | secrets | `.env` is git- and docker-ignored; env parse errors print keys, never values; the ingest masks `DATABASE_URL`. | No change. |

Residual notes: the unofficial TradingView adapter is untested against the live service (protocol tests only) and is
disabled by default; Twelve Data's forming-bar behaviour is observed, not documented, so the poller re-reads the last
4 bars and dedupes by open time.
