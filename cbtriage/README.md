# cbtriage

Local web UI for analyzing Couchbase cbcollect logs without an LLM. Python 3 standard library plus `rg`. No data leaves the machine except what you ask it to fetch from Supportal.

    python3 cbtriage/server.py                     # http://127.0.0.1:8765/ (localhost only)
    python3 cbtriage/server.py --root <folder>     # a different folder of ticket folders for this run

The logs folder defaults to the one in Settings, else `~/Downloads/couchbaselogs/support`.

## The flow

1. **Ticket.** Your open tickets from Supportal, or the ones already on this computer, or any ticket number. Open one to read its full history, see its triage fields (Component, Case Type, versions, impact), where its logs are, and download them (`prep_ticket_aws.sh` from the parent repo, run in the background with live progress).
2. **Log files.** One row per log file with a tick for that file on every node that has it; choose nodes per file, turn a whole node on or off, or read any file in the built-in reader (go to a time, find in file, copy lines with the command).
3. **Question.** Suggested for the ticket (from its Component, Case Type, subject and description), worth-a-look spots, the common questions, REST access questions, and known problems. Search for anything.
4. **Analysis.** When it happened (a lane per node), what was logged (similar lines grouped, a column per node), the lines (docked panel), counts by value, how often. Select lines, copy them with the command, or add them to the reply draft.

**Customize** edits the questions, the known problems and the log files each reads. **Settings** holds who you are, how tickets are listed, the Supportal address, and shows where everything is stored.

## Needs

- `rg` on PATH.
- For tickets and downloads: the Couchbase VPN; downloads also need an AWS sign-in (`aws sso login --profile supportal`). Without the VPN, saved tickets still work.

## Files

| File | Purpose |
| --- | --- |
| `server.py` | JSON API and static pages |
| `core.py` | inventory, time parsing (any format the logs use), helpers |
| `searchx.py` | search over many nodes and files, line context |
| `winprof.py` | per-minute index (cached), lanes, moments, window profile |
| `logfiles.py` | file inventory and the raw file reader |
| `supportal.py`, `tickets.py`, `triage.py` | Supportal tickets, saved ticket data, triage fields |
| `config.py` | settings and the editable questions and known problems |
| `categories.default.json`, `signatures.json` | built-in questions, known problems |
| `static/` | the UI: `app.js` (shell), `tickets.js`, `logs.js`, `start.js` (questions), `analyze.js`, `config.js`, `settings.js` |

Your own questions and settings are saved under `config/` (with backups) and are not part of the repository.
