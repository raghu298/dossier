// Daily auto-apply for Dossier: runs after the 8:00 job agent.
// 1. Inbox check (recruiter replies get linked to applications).
// 2. For drafts whose posting asks for applications by email, writes the email
//    and sends it with Raghunath's own resume (Java + GenAI one for Java roles).
// 3. Mails a summary to himself: what was sent, and portal-only jobs to apply by hand.
const D = "/Users/raghunath/dossier/src/lib";
const { prisma } = await import(`${D}/prisma.ts`);
const { syncInbox } = await import(`${D}/google/sync.ts`);
const { sendApplicationEmail } = await import(`${D}/google/send.ts`);
const { sendMail } = await import(`${D}/google/gmail.ts`);
const { loadGoogleAccount } = await import(`${D}/google/account.ts`);
const { writeEmailJob } = await import(`${D}/jobs/write-email.ts`);
const { startJob, getJob } = await import(`${D}/jobs/runner.ts`);
const { connectorDraftJob } = await import(`${D}/connector/draft.ts`);

// Own searches on top of Dossier's job agent: Python + GenAI and Java + GenAI.
const SEARCHES = ["Python GenAI Engineer in Bengaluru", "Java GenAI Engineer in Bengaluru", "Agentic AI Engineer in Bengaluru", "Java LLM Engineer in India"];
const MAX_NEW_DRAFTS = 6;
// Titles that aren't the target: senior/lead GenAI engineering.
const WRONG_TITLE = /\b(qa|test(er|ing)?|devops|intern|trainee|junior|fresher|full[- ]?stack|front[- ]?end|data analyst|sales|recruit|support|walk-?in|part[- ]time|freelance|trainers?|faculty|instructor|teacher|mentor|tutor)\b/i;
const RIGHT_TITLE = /gen ?ai|llm|agentic|\bai\b|machine learning|ml\b|rag/i;
const MIN_FIT = 0.6;

const DRY = process.env.DRY === "1";
// The only Google account applications may go from, and where the summary goes.
const OWNER = "mahakudraghunath298@gmail.com";
const MAX_SENDS = 5;
const MIN_SCORE = 70;
const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Addresses that are not for applying: accommodation, privacy, no-reply and similar.
const NOT_FOR_APPLYING = /accommodat|disabilit|privacy|gdpr|data protection|no-?reply|unsubscribe|fraud|scam|eeo|accessib|grievance|whistle/i;
const APPLY_WORDS = /resume|cv\b|profile|apply|application|share|send|mail|reach out|contact/i;

const log: string[] = [];
const say = (line: string) => { console.log(line); log.push(line); };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The address a posting asks applications to go to, or null. */
function applyAddress(posting: string): string | null {
  for (const match of posting.matchAll(ADDRESS)) {
    const around = posting.slice(Math.max(0, match.index! - 200), match.index! + match[0].length + 50);
    if (NOT_FOR_APPLYING.test(around) || NOT_FOR_APPLYING.test(match[0])) continue;
    if (APPLY_WORDS.test(around)) return match[0].toLowerCase();
  }
  return null;
}

async function emailUnits(applicationId: string) {
  const document = await prisma.document.findFirst({ where: { applicationId, kind: "EMAIL" } });
  return (document?.units as { id: string; text: string }[] | undefined) ?? null;
}

async function writeEmail(applicationId: string) {
  const id = await startJob(writeEmailJob, { applicationId });
  for (let i = 0; i < 100; i++) {
    await pause(3000);
    const job = await getJob(id);
    if (job?.status === "DONE") return true;
    if (job?.status === "FAILED") { say(`  could not write the email: ${job.error ?? "unknown"}`); return false; }
  }
  return false;
}

if (!DRY) try {
  const inbox = await syncInbox();
  say(`Inbox: read ${inbox.fetched} new emails, linked ${inbox.kept} to applications.`);
} catch (error) {
  say(`Inbox check failed: ${String(error)}`);
}

// Fetch: new postings from JSearch, drafted with Dossier's writer.
const known = new Set((await prisma.application.findMany({ select: { company: true, role: true } })).map((a) => `${a.company}|${a.role}`.toLowerCase()));
const knownCompanies = new Set((await prisma.application.findMany({ select: { company: true } })).map((a) => a.company.toLowerCase()));
let drafted = 0;
const sentAddresses = new Set(
  (await prisma.emailMessage.findMany({ where: { direction: "OUTGOING" }, select: { toAddress: true } }))
    .flatMap((mail) => mail.toAddress.toLowerCase().match(ADDRESS) ?? []),
);
if (!DRY && process.env.DOSSIER_JSEARCH_KEY) {
  for (const query of SEARCHES) {
    if (drafted >= MAX_NEW_DRAFTS) break;
    const url = new URL("https://api.openwebninja.com/jsearch/search");
    url.search = new URLSearchParams({ query, country: "in", date_posted: "week", num_pages: "1" }).toString();
    let jobs: any[] = [];
    try {
      const answer: any = await (await fetch(url, { headers: { "x-api-key": process.env.DOSSIER_JSEARCH_KEY } })).json();
      jobs = answer.data ?? [];
      if (answer.status !== "OK") say(`Search "${query}" failed: ${JSON.stringify(answer.error ?? answer.status)}`);
    } catch (error) { say(`Search "${query}" failed: ${String(error)}`); }
    for (const job of jobs) {
      if (drafted >= MAX_NEW_DRAFTS) break;
      const company = String(job.employer_name ?? "");
      const title = String(job.job_title ?? "");
      const description = String(job.job_description ?? "");
      // AI in the title, or a Java/Python engineering title whose posting is about GenAI.
      const aiInPosting = /gen ?ai|\bllm|agentic|\brag\b|langchain|langgraph/i.test(description);
      const techTitle = /\b(java|python|backend|software|engineer|developer|lead|architect)\b/i.test(title);
      if (!company || WRONG_TITLE.test(title) || !(RIGHT_TITLE.test(title) || (techTitle && aiInPosting && /\b(java|python)\b/i.test(description)))) continue;
      if (knownCompanies.has(company.toLowerCase()) || known.has(`${company}|${title}`.toLowerCase())) continue;
      const direct = (job.apply_options ?? []).find((o: any) => o.is_direct)?.apply_link;
      const posting = `${title}\n${company} — ${job.job_location ?? "Bengaluru, India"}\n\n${job.job_description ?? ""}`;
      const id = await startJob(connectorDraftJob, { posting, postingUrl: direct ?? job.job_apply_link ?? "", note: "", postingId: null });
      knownCompanies.add(company.toLowerCase());
      for (let i = 0; i < 200; i++) {
        await pause(3000);
        const state = await getJob(id);
        if (state?.status === "DONE") { drafted++; say(`New draft: ${company} – ${title}`); break; }
        if (state?.status === "FAILED") { say(`Could not draft ${company} – ${title}: ${state.error ?? ""}`); break; }
      }
    }
  }
}

// Second source: freehire.me (Naukri, Hirist and more), free and no key. Only postings that
// give an email to apply to are drafted, since the rest need a browser.
const FREEHIRE_QUERIES = ["genai", "generative ai", "llm", "agentic", "java ai"];
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Too junior, or not a permanent job. */
function wrongKind(text: string): boolean {
  if (/part[- ]time|short[- ]term|freelance|internship|contract (role|position|basis)/i.test(text.slice(0, 1500))) return true;
  const ranges = [...text.matchAll(/(\d{1,2})\s*(?:-|to|–)\s*(\d{1,2})\s*(?:\+\s*)?(?:years|yrs)/gi)].map((m) => Number(m[2]));
  return ranges.length > 0 && Math.max(...ranges) < 6;
}
if (!DRY) {
  let fhDrafted = 0;
  const slugs = new Set<string>();
  for (const q of FREEHIRE_QUERIES) {
    try {
      const answer: any = await (await fetch(`https://freehire.me/api/v1/jobs/search?q=${encodeURIComponent(q)}&countries=in&posted_within_days=3&limit=50`)).json();
      for (const job of answer.data ?? []) {
        if (WRONG_TITLE.test(job.title ?? "") || !/bangal|bengal|remote|india/i.test(String(job.location ?? "india"))) continue;
        slugs.add(job.public_slug);
      }
    } catch (error) { say(`freehire search "${q}" failed: ${String(error)}`); }
  }
  for (const slug of slugs) {
    if (fhDrafted >= MAX_NEW_DRAFTS) break;
    let job: any;
    try { job = (await (await fetch(`https://freehire.me/api/v1/jobs/${slug}`)).json()).data; } catch { continue; }
    if (!job || job.closed_at) continue;
    const text = String(job.description ?? "").replace(/<[^>]+>/g, " ");
    const address = applyAddress(text);
    if (!address || wrongKind(text)) continue;
    const company = String(job.company ?? "");
    if (sentAddresses.has(address) || knownCompanies.has(company.toLowerCase())) continue;
    if (!/gen ?ai|llm|agentic|\brag\b|langchain|langgraph/i.test(text)) continue;
    const posting = `${job.title}\n${company} — ${job.location ?? "India"}\n\n${text}`;
    const id = await startJob(connectorDraftJob, { posting, postingUrl: job.url ?? "", note: "", postingId: null });
    knownCompanies.add(company.toLowerCase());
    for (let i = 0; i < 200; i++) {
      await pause(3000);
      const state = await getJob(id);
      if (state?.status === "DONE") { fhDrafted++; drafted++; say(`New draft (email): ${company} – ${job.title}`); break; }
      if (state?.status === "FAILED") { say(`Could not draft ${company} – ${job.title}: ${state.error ?? ""}`); break; }
    }
  }
}

/** Which of the two original resumes a posting gets (same rule as Dossier's sending). */
function resumeFor(role: string, posting: string): string {
  const javaCount = (posting.match(/\bjava\b/gi) ?? []).length;
  const isJava = /\bjava\b/i.test(role) || javaCount >= 3 || (javaCount > 0 && /spring/i.test(posting));
  return isJava ? "Raghunath_Mahakud_Java_GenAI.pdf (Java + GenAI)" : "Raghunath_Mahakud.pdf (main)";
}

/** Share of the posting's requirements the profile covers (partial counts half). */
function fit(match: unknown): number | null {
  const items = (match as { items?: { result: string }[] } | null)?.items;
  if (!items?.length) return null;
  return items.reduce((sum, item) => sum + (item.result === "covered" ? 1 : item.result === "partial" ? 0.5 : 0), 0) / items.length;
}

const connected = (await loadGoogleAccount())?.email?.toLowerCase() ?? null;
const rightAccount = connected === OWNER;
if (connected && !rightAccount) say(`WRONG GOOGLE ACCOUNT: Dossier is connected to ${connected}, not ${OWNER}. Nothing was sent. Reconnect in Dossier → Settings → Google and pick ${OWNER}.`);

const sentTo = new Set(
  (await prisma.emailMessage.findMany({ where: { direction: "OUTGOING" }, select: { toAddress: true } }))
    .flatMap((mail) => mail.toAddress.toLowerCase().match(ADDRESS) ?? []),
);
const appliedCompanies = new Set(
  (await prisma.application.findMany({ where: { status: { not: "DRAFT" } }, select: { company: true } })).map((a) => a.company.toLowerCase()),
);
const drafts = await prisma.application.findMany({ where: { status: "DRAFT" }, orderBy: { createdAt: "desc" } });

const sent: string[] = [];
const portal: string[] = [];
for (const application of drafts) {
  const label = `${application.company} – ${application.role}`;
  if (WRONG_TITLE.test(application.role)) { say(`Not for you, delete it in Dossier: ${label} (not a GenAI engineering role).`); continue; }
  const address = applyAddress(application.postingText);
  const score = application.agentScore ?? null;
  if (!address) {
    const isNew = Date.now() - application.createdAt.getTime() < 26 * 3600_000 ? "NEW · " : "";
    const f = fit(application.match);
    portal.push(`${isNew}${label}${f === null ? "" : ` (${Math.round(f * 100)}% match)`}\n   Resume: ${resumeFor(application.role, application.postingText)}\n   Apply: ${application.postingUrl || "(no link saved)"}`);
    continue;
  }
  if (score !== null && score < MIN_SCORE) { say(`Skipped ${label}: score ${score} is under ${MIN_SCORE}.`); continue; }
  const share = fit(application.match);
  if (share !== null && share < MIN_FIT) { say(`Skipped ${label}: covers only ${Math.round(share * 100)}% of the requirements.`); continue; }
  if (sentTo.has(address) || appliedCompanies.has(application.company.toLowerCase())) { say(`Skipped ${label}: already applied there.`); continue; }
  if (!rightAccount) { portal.push(`${label} (would be emailed to ${address} once the right Google account is connected)`); continue; }
  if (sent.length >= MAX_SENDS) { say(`Left for tomorrow: ${label} (daily limit of ${MAX_SENDS}).`); continue; }

  if (DRY) { say(`Would send: ${label} → ${address}`); sent.push(`${label} → ${address} (dry run)`); continue; }
  let units = await emailUnits(application.id);
  if (!units && (await writeEmail(application.id))) units = await emailUnits(application.id);
  const to = units?.find((unit) => unit.id === "to")?.text ?? "";
  if (!to.toLowerCase().includes(address)) { say(`Skipped ${label}: the email isn't addressed to ${address}.`); continue; }
  try {
    const result = await sendApplicationEmail(application.id);
    sentTo.add(address);
    appliedCompanies.add(application.company.toLowerCase());
    sent.push(`${label} → ${address} (attached: ${result.attachments.join(", ")})`);
    say(`Sent: ${label} → ${address}`);
    await pause(5000);
  } catch (error) {
    say(`Could not send ${label}: ${String(error)}`);
  }
}

say(`New drafts today: ${drafted}.`);
say(`Drafts checked: ${drafts.length}; sent by email: ${sent.length}; portal only: ${portal.length}.`);
const account = await loadGoogleAccount();
if (!account) say("Google is not connected: reconnect in Dossier → Settings → Google.");
if (account && !DRY) try {
  const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const body = [
    `Dossier daily run, ${today}`,
    "",
    `Applied by email today (${sent.length}):`,
    ...(sent.length ? sent.map((line) => ` - ${line}`) : [" - none"]),
    "",
    `Waiting for you to apply on the portal (${portal.length}):`,
    ...(portal.length ? portal.map((line) => ` - ${line}`) : [" - none"]),
    "",
    "Notes:",
    ...log.map((line) => ` - ${line}`),
    "",
    "Open Dossier: http://localhost:3000/applications",
  ].join("\n");
  await sendMail({ from: account.email, to: OWNER, subject: `Dossier: ${sent.length} applied by email, ${portal.length} waiting for you (${today})`, body, attachments: [] });
} catch (error) {
  console.log(`Could not email the summary: ${String(error)}`);
}
{
  // A Mac notification too, so a run is never missed even if Gmail fails.
  const { execFileSync } = await import("node:child_process");
  const text = !rightAccount ? `Wrong Google account connected (${connected ?? "none"}). Reconnect with ${OWNER}.` : `${sent.length} applied by email, ${portal.length} waiting for you on websites. Check Gmail or Dossier.`;
  if (!DRY) try { execFileSync("osascript", ["-e", `display notification "${text}" with title "Dossier daily run" sound name "Glass"`]); } catch {}
}
await prisma.$disconnect?.();
process.exit(0);
