// src/scraper/email_content.js — subject + body, tailored to the specific lead.
// Greets the poster by first name when known, names the role/company, picks the
// 2 projects most relevant to the post text, and stays short (recruiters skim).
import { getProfile } from '../profile.js';

const clean = s => (s || '').replace(/[#*_|]+/g, ' ').replace(/\s+/g, ' ').trim();

function roleLabel(job) {
  const r = clean(job.role);
  return r && r.length < 70 && !/^(hiring|remote|python|engineer)$/i.test(r) ? r : 'engineering role';
}

export function subject(job, profile = getProfile()) {
  const r = roleLabel(job);
  const co = clean(job.company);
  const title = clean(profile.currentTitle || profile.headline || 'DevOps Engineer');
  const years = profile.yearsExperience ? `${profile.yearsExperience}+ yrs` : 'experienced';
  return `${r === 'engineering role' ? 'Application' : r}${co && co.length < 40 && !/^r\//.test(co) ? ' at ' + co : ''} — ${profile.name} (${title}, ${years})`;
}

export function body(job, profile = getProfile()) {
  const L = profile.links || {};
  const text = `${job.role} ${job.description || job.postText || ''}`.toLowerCase();
  const first = clean(job.posterName || job.poster_name).split(' ')[0];
  const hi = first && /^[A-Z][a-z]{1,15}$/.test(first) ? `Hi ${first},` : 'Hi,';
  const co = clean(job.company);
  const where = job.source?.startsWith('linkedin') ? 'your LinkedIn post' : job.source === 'x_post' ? 'your post on X' : job.source === 'hn_hiring' ? 'your HN "Who is hiring" post' : job.source?.startsWith('reddit') ? 'your Reddit post' : 'the listing';

  const projects = [...(profile.projects || [])].map(p => {
    const words = `${p.name} ${p.blurb}`.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
    return { p, s: words.filter(w => text.includes(w)).length };
  }).sort((a, b) => b.s - a.s).slice(0, 2).map(x => x.p);

  const ai = /\b(ai|ml|llm|rag|agent|genai|nlp|langchain|model)\b/.test(text);
  const hook = ai
    ? (profile.answers || {})['cover hook'] || 'I build production AI systems — RAG, agents, and the evaluation layer that keeps model output defensible.'
    : 'I ship production backend systems end to end — Python/FastAPI APIs, AWS infrastructure, queues, Postgres, and CI with quality gates.';

  const headline = profile.headline || profile.currentTitle || 'Software Engineer';
  const yrs = profile.yearsExperience ? `${profile.yearsExperience}+ years` : 'several years';
  const skills = (profile.skills || []).slice(0, 5).join(', ') || 'modern engineering stacks';
  const loc = profile.location ? `, based in ${profile.location}` : '';
  const remote = profile.preferences?.remoteOnly ? ' and working remotely' : '';
  const jobpilot = clean(L.jobpilot);

  return `${hi}

I saw ${where} about the ${roleLabel(job)}${co && co.length < 40 && !/^r\//.test(co) ? ` at ${co}` : ''} and I'd like to apply. I'm a ${headline} (${yrs}: ${skills})${loc}${remote}.

${hook}

Recent work:
${projects.map(p => `- ${p.name} (${p.url}) — ${p.blurb}`).join('\n')}

CV attached. Portfolio: ${L.portfolio || ''}  ·  GitHub: ${L.github || ''}  ·  LinkedIn: ${L.linkedin || ''}${jobpilot ? `\nJobPilot: ${jobpilot}` : ''}

Happy to do a quick call this week.

Best,
${profile.name}
${[profile.email, profile.phone].filter(Boolean).join(' | ')}`;
}
