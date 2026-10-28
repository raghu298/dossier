# Daily auto-apply (personal setup)

Runs after Dossier's 08:00 job agent, every day at 08:45 (launchd):

1. Checks the inbox so recruiter replies link to applications.
2. Searches JSearch for Python + GenAI and Java + GenAI roles and drafts the good ones.
3. Emails postings that ask for applications by email, attaching only your own resume
   (`DOSSIER_RESUME_PDF`, or `DOSSIER_RESUME_JAVA_PDF` for Java roles). Max 3 a day,
   never the same company twice, never QA/DevOps/trainer-type roles.
4. Mails you a summary of what was sent and which jobs to apply to on their websites.

Setup: copy these files to `~/dossier-data/`, then run `install-daily.sh`.
Dry run (sends nothing): `DRY=1` in front of the tsx command in `run-auto-apply.sh`.
Keys stay in `.env`; nothing secret is in these files.
