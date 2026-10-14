// src/fake-emails.js — SELF-EVOLVING registry of KNOWN-FAKE / decoy hiring emails.
//
// Why this exists: some lists circulating online (e.g. mass "Saudi company HR email" dumps) are
// FAKE — the addresses don't belong to real hiring contacts, bounce, or are honeypots. Emailing
// them wastes sends and can hurt the sender's Gmail reputation. This file is the SHIPPED, code-level
// memory so EVERY future brain recognizes them and never contacts them again — it is contributed
// back to the repo (unlike the per-user data/jobs.db fake_emails table, which stays local).
//
// How it works:
//   • tracker.isBadEmail() consults FAKE_EMAIL_PATTERNS (here) AND the per-user fake_emails table.
//   • A brain that discovers a fake address should: (1) tracker.markFakeEmail(addr, reason) for the
//     local DB, and (2) add a durable pattern HERE and contribute_improvements so the whole fleet
//     learns it. Prefer a precise literal/domain pattern over anything broad.
//
// Each entry is a RegExp tested against the lowercased address.

export const FAKE_EMAIL_PATTERNS = [
  // ── 2026-10: a widely-shared "large Saudi companies HR email" list flagged by the user as fake.
  //    Scoped to the EXACT addresses from that dump so we never nuke a legitimate address at these
  //    domains later. (reason: user-reported fake decoy list; do not contact.)
  /^cv@arabianfal\.com$/i,
  /^cv@aldawaa\.com\.sa$/i,
  /^hr\.qrm@hotmail\.com$/i,
  /^rec@alojaimi\.com$/i,
  /^recruitment@rawabiholding\.com$/i,
  /^job\.s6@hotmail\.com$/i,
  /^careers@dnata\.com$/i,
  /^hr@alesayi_motors\.com$/i,
  /^hr@alarayan\.com$/i,
  /^recruiting\.ksa@mcmermott\.com$/i,
  /^recruitment@aytb\.com$/i,
  /^wadaef@gtecorp\.com$/i,
  /^careers@nesr\.com$/i,
  /^recruit@farm\.com\.sa$/i,
  /^info@alhumamlaw\.com$/i,
  /^hr1@gulfteksaudi\.com$/i,
  /^catcosa@catcosa\.com$/i,
  /^cv@tafear\.com$/i,
  /^recruitment@sraco\.com\.sa$/i,
  /^info@atco\.com\.sa$/i,
  /^hrdepartmental@sa\.yokogawa\.com$/i,
  /^recruitment@shadeco\.com$/i,
  /^klc\.hr@alkafaa\.com$/i,
  /^kbr-amcdehr@kbr\.com$/i,
  /^recruitment@batook\.com$/i,
  /^career@shawarmer\.com$/i,
  /^hrsupport@archirodon\.net$/i,
  /^jobs@binajinah\.com$/i,
  /^marketing\.np@nesma\.com$/i,
  /^wadaef2019@abdulla-fouad\.com$/i,
  /^careers@innosoft\.sa$/i,
  /^m@startime\.com\.sa$/i,
  /^job@musk\.sa\.com$/i,
  /^shababwatansa@gmail\.com$/i,
  /^j@sabksa\.com$/i,
  /^al\.alshaikh@bonyan\.sa$/i,
  /^ymohammed@innovest\.com\.sa$/i,
  /^s\.alwadi@nhc\.sa$/i,
  /^i\.atassi@artar\.com\.sa$/i,
  /^oalkhunaizi@darwaemaar\.com$/i,
  /^jobs@almasah\.net$/i,
  /^recruitment\.amjad@gmail\.com$/i,
  /^jobrydlaw@gmail\.com$/i,
  /^job@almoosahospital\.com\.sa$/i,
  /^recruitment@almoosahospital\.com\.sa$/i,
  /^jobs@sghgroup\.net$/i,
  /^career\.dmm@sghgroup\.net$/i,
  /^talent\.acquisition@drsulaimanalhabib\.com$/i,
  /^careers@jhah\.com$/i,
  /^hrd@alahsahospital\.com\.sa$/i,
  /^career@almanahospital\.com\.sa$/i,
  /^info@familycare\.com\.sa$/i,
  /^info@ramclinics\.com$/i,
  /^hr\.dsfhr@fakeeh\.care$/i,
  /^career@mouwasat\.com$/i,
  /^careers@dallah-hospital\.com$/i,
  /^hr\.phc@drsulaimanalhabib\.com$/i,
  /^careers@almurjanhospital\.com$/i,
  /^hiringnow\.ksa@gmail\.com$/i,
];

export default FAKE_EMAIL_PATTERNS;
