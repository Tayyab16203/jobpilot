// src/cv.js — CV-grounded matching and optional, guarded tailoring.
//
// The profile/CV is the source of truth. This module may reorder facts already
// present in the profile, but it never invents experience, employers, titles, or
// qualifications. Generated files live under data/ (ignored and per-user).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DATA } from './config.js';

const GENERIC = new Set('a an and as at by for from in into of on or the to with engineer engineering remote cloud platform infrastructure solution architect architecture operations reliability site devops'.split(' '));
const TECH_TERMS = 'aws azure gcp kubernetes terraform docker linux jenkins github actions gitlab argocd helm ansible pulumi prometheus grafana istio vault nomad nginx apache python bash golang java powershell vmware eks aks gke openshift helm cloudformation fastapi langchain langgraph rag llm pytorch tensorflow postgresql redis celery pinecone chromadb'.split(' ');

// A sensible default "out of scope" list used ONLY when the profile has no skip list.
// NOTE: this is deliberately NOT the user's target roles. The old hardcoded version
// listed ai/backend/developer/full-stack here, which hard-skipped the user's own target
// roles. The out-of-scope filter must come from the profile's `skip` preferences.
const DEFAULT_SKIP = ['sales', 'intern', 'data entry', 'manual testing', 'recruiter', 'hr '];
const CV_FOCUS_RULES = {
  aws: ['aws', 'amazon web services', 'ec2', 'eks', 's3', 'lambda', 'cloudformation', 'fargate', 'iam'],
  azure: ['azure', 'azure devops', 'aks', 'entra', 'app service', 'bicep'],
  gcp: ['gcp', 'google cloud', 'gke', 'cloud run', 'bigquery', 'pub sub', 'compute engine'],
  sre: ['sre', 'site reliability', 'reliability engineering', 'observability', 'incident response', 'sli', 'slo', 'error budget'],
  dataops: ['dataops', 'data ops', 'data pipeline', 'etl', 'airflow', 'dbt', 'spark', 'snowflake'],
  mlops: ['mlops', 'ml ops', 'machine learning operations', 'model deployment', 'model serving', 'kubeflow', 'mlflow'],
};

function textHas(text, term) {
  const hay = norm(text); const needle = norm(term);
  return Boolean(needle && (hay.includes(needle) || hay.replace(/\s+/g, '').includes(needle.replace(/\s+/g, ''))));
}

function jobCvText(job = {}) {
  return [job.role, job.title, job.description, job.postText, job.location, job.salary, job.notes]
    .filter(Boolean).join(' ');
}

function configuredCvVariants(profile = {}) {
  const configured = Array.isArray(profile.preferences?.cvVariants) ? profile.preferences.cvVariants : [];
  const out = configured.filter(v => v && v.path && fs.existsSync(v.path)).map((v, i) => ({
    id: String(v.id || `cv-${i + 1}`),
    label: String(v.label || v.id || path.basename(v.path)),
    path: v.path,
    focuses: (Array.isArray(v.focuses) ? v.focuses : []).map(x => norm(x)),
    keywords: (Array.isArray(v.keywords) ? v.keywords : []).map(x => String(x)),
  }));
  if (profile.cvPath && fs.existsSync(profile.cvPath) && !out.some(v => v.path === profile.cvPath)) {
    out.push({ id: 'main', label: 'Main CV', path: profile.cvPath, focuses: ['general'], keywords: [] });
  }
  return out;
}

/** Choose the most relevant user-provided CV variant from the job title and requirements. */
export function selectCvVariant(job = {}, profile = {}) {
  const variants = configuredCvVariants(profile);
  if (!variants.length) return { id: 'main', label: 'Main CV', path: profile.cvPath || '', matchedTerms: [], reason: 'configured main CV fallback' };
  const raw = jobCvText(job);
  const title = [job.role, job.title].filter(Boolean).join(' ');
  const scored = variants.map((v, order) => {
    let score = v.focuses.includes('general') || v.id === 'main' ? 1 : 0;
    const matchedTerms = [];
    for (const [focus, terms] of Object.entries(CV_FOCUS_RULES)) {
      const titleHits = terms.filter(t => textHas(title, t));
      const bodyHits = terms.filter(t => !titleHits.includes(t) && textHas(raw, t));
      if (!titleHits.length && !bodyHits.length) continue;
      const matchesFocus = v.focuses.includes(focus) || v.id.toLowerCase() === focus || norm(v.label).includes(focus);
      if (matchesFocus) {
        score += titleHits.length * 120 + bodyHits.length * 20;
        matchedTerms.push(...titleHits, ...bodyHits);
      }
    }
    for (const keyword of v.keywords) if (textHas(raw, keyword)) { score += 4; matchedTerms.push(keyword); }
    return { ...v, score, order, matchedTerms: [...new Set(matchedTerms)] };
  }).sort((a, b) => b.score - a.score || a.order - b.order);
  const winner = scored[0];
  const reason = winner.matchedTerms.length
    ? `matched ${winner.matchedTerms.slice(0, 6).join(', ')}`
    : 'no specialist signal; using general CV';
  return { id: winner.id, label: winner.label, path: winner.path, matchedTerms: winner.matchedTerms, reason };
}

function outOfScopeFromProfile(profile) {
  const skip = (profile?.preferences?.skip?.length ? profile.preferences.skip : DEFAULT_SKIP)
    .map(s => String(s).trim().toLowerCase()).filter(Boolean);
  return skip;
}

function words(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9+#.]+/g, ' ').split(/\s+/)
    .map(x => x.trim()).filter(x => x.length > 2 && !GENERIC.has(x));
}

function norm(value = '') { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function includesTerm(hay, term) { return hay.includes(` ${term} `) || hay.startsWith(`${term} `) || hay.endsWith(` ${term}`) || hay === term; }

export const TARGET_ROLES = [
  'DevOps Engineer', 'Site Reliability Engineer', 'Cloud Engineer',
  'Platform Engineer', 'Cloud Infrastructure Engineer', 'Cloud Solution Architect',
];

function roleAligned(text, profile) {
  const hay = norm(text);
  // De-spaced haystack so hashtag/glued post titles like "#AIEngineer" or "#SeniorBackendEngineer"
  // (which norm() collapses to "aiengineer" / "seniorbackendengineer") still match a role/keyword
  // whose spaces we also strip (e.g. "ai engineer" -> "aiengineer"). This is the #1 reason real
  // LinkedIn-post leads were being wrongly skipped as "not aligned".
  const glued = hay.replace(/\s+/g, '');
  const title = String(text || '').toLowerCase();
  // Only hard-skip when the title clearly matches the user's OWN skip list
  // (e.g. "sales", "intern"). Never skip on the user's target-role keywords.
  const skip = outOfScopeFromProfile(profile);
  if (skip.some(s => s && title.includes(s))) return false;
  const roles = (profile.preferences?.roles?.length ? profile.preferences.roles : TARGET_ROLES);
  // Aligned if the title/text references any target role OR any target keyword/skill —
  // checked both spaced (word-boundary) and glued (hashtag) forms.
  const keywordHit = [
    ...(profile.preferences?.keywords || []),
    ...(profile.skills || []),
  ].map(norm).some(k => k && k.length > 2 && (hay.includes(k) || glued.includes(k.replace(/\s+/g, ''))));
  if (keywordHit) return true;
  return roles.some(role => {
    const key = norm(role);
    if (!key) return false;
    if (hay.includes(key) || glued.includes(key.replace(/\s+/g, ''))) return true;
    return words(role).filter(x => x.length > 3).filter(x => hay.includes(x)).length >= 2;
  });
}

/** Calculate a transparent match/drift report without relying on opaque scoring. */
export function assessJob(job = {}, profile = {}) {
  const title = job.role || job.title || '';
  const text = norm([title, job.company, job.description, job.postText, job.location].filter(Boolean).join(' '));
  const roles = (profile.preferences?.roles?.length ? profile.preferences.roles : TARGET_ROLES);
  const roleTerms = [...new Set(roles.flatMap(words))];
  const skillTerms = [...new Set((profile.skills || []).flatMap(words))];
  const matchedRoleTerms = roleTerms.filter(t => includesTerm(text, t));
  const matchedSkills = skillTerms.filter(t => includesTerm(text, t));
  const roleMatch = roleAligned(title || text, profile);
  const profileFacts = norm([
    ...(profile.skills || []), profile.summary, profile.extra,
    ...(profile.projects || []).flatMap(x => [x.name, x.blurb]),
  ].filter(Boolean).join(' '));
  const visibleTech = TECH_TERMS.filter(t => includesTerm(text, t));
  const matchedTech = visibleTech.filter(t => includesTerm(profileFacts, t));

  // Only score terms that the listing actually exposes. This prevents a long
  // skills list from unfairly penalising a short job post.
  const visibleRelevant = [...new Set([...roleTerms.filter(t => text.includes(t)), ...skillTerms.filter(t => text.includes(t)), ...visibleTech])];
  const missingTerms = visibleTech.filter(t => !matchedTech.includes(t)).slice(0, 12);
  const techCoverage = visibleTech.length ? Math.round((matchedTech.length / visibleTech.length) * 100) : 100;
  const matchPercent = roleMatch ? Math.max(0, Math.min(100, Math.round(60 + techCoverage * 0.4))) : Math.max(0, Math.min(100, Math.round((matchedRoleTerms.length / Math.max(1, roleTerms.length)) * 60)));
  const driftPercent = 100 - matchPercent;
  const eligible = roleMatch && driftPercent > 0 && driftPercent <= 45;
  return {
    matchPercent,
    driftPercent,
    roleAligned: roleMatch,
    matchedSkills: matchedSkills.slice(0, 20),
    missingTerms,
    tailoredEligible: eligible,
    basis: roleMatch ? 'target role + profile/CV terms' : 'listing title is outside configured CV target roles',
  };
}

function pdfEscape(line) {
  return String(line).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrap(text, width = 92) {
  const out = [];
  for (const raw of String(text || '').split(/\n/)) {
    let line = raw;
    while (line.length > width) { out.push(line.slice(0, width)); line = line.slice(width); }
    out.push(line);
  }
  return out;
}

// Small dependency-free PDF writer. It is intentionally plain text: the facts
// are selected/reordered from the canonical profile and never augmented.
function onePagePdf(lines) {
  const bodyLines = wrap(lines.join('\n')).slice(0, 48);
  const stream = ['BT', '/F1 10 Tf', '48 760 Td', '14 TL', ...bodyLines.map((line, i) => `(${pdfEscape(line)}) Tj${i === bodyLines.length - 1 ? '' : ' T*'}`), 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(pdf, 'ascii')); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/** Generate a draft tailored PDF only after explicit user approval. */
export function ensureTailoredCv(job = {}, profile = {}) {
  const assessment = assessJob(job, profile);
  const selection = selectCvVariant(job, profile);
  if (profile.preferences?.allowTailoredCv !== true || !assessment.tailoredEligible) return { path: selection.path || profile.cvPath || '', generated: false, assessment, selection };
  const dir = path.join(DATA, 'tailored-cv');
  fs.mkdirSync(dir, { recursive: true });
  const key = crypto.createHash('sha1').update(`${job.url || ''}|${profile.cvPath || ''}|${assessment.matchPercent}`).digest('hex').slice(0, 16);
  const out = path.join(dir, `${key}.pdf`);
  if (!fs.existsSync(out)) {
    const links = profile.links || {};
    const lines = [
      profile.name || 'Candidate',
      [profile.email, profile.phone, profile.location].filter(Boolean).join(' · '),
      '',
      `Target: ${job.role || 'Target role'}`,
      `CV-grounded match: ${assessment.matchPercent}% (drift ${assessment.driftPercent}%)`,
      '',
      'SUMMARY', profile.summary || profile.extra || '',
      '',
      'CORE SKILLS', (profile.skills || []).join(', '),
      assessment.matchedSkills.length ? `Relevant focus: ${assessment.matchedSkills.join(', ')}` : '',
      '',
      'EXPERIENCE', `${profile.yearsExperience || ''}${profile.yearsExperience ? '+ years' : ''} ${profile.currentTitle || profile.headline || ''}`.trim(),
      profile.currentCompany || '',
      '',
      'PROJECTS', ...(profile.projects || []).slice(0, 4).flatMap(x => [`${x.name || ''} — ${x.blurb || ''}`, x.url || '']),
      '',
      'LINKS', [links.linkedin, links.github, links.portfolio, links.website].filter(Boolean).join(' · '),
    ].filter((x, i, a) => x !== '' || (i && a[i - 1] !== '')).map(String);
    fs.writeFileSync(out, onePagePdf(lines));
  }
  return { path: out, generated: true, assessment, selection };
}

/** Return the approved tailored draft for general jobs, or the best matching user CV variant. */
export function cvAttachmentForJob(job = {}, profile = {}) {
  const selection = selectCvVariant(job, profile);
  if (selection.id !== 'main' && selection.path && fs.existsSync(selection.path)) return selection.path;
  const result = ensureTailoredCv(job, profile);
  return result.path && fs.existsSync(result.path) ? result.path : profile.cvPath || '';
}
