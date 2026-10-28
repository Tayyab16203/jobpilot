// CV match, answer confidence, and explicit tailoring approval controls.
import { table, esc, rel } from '../helpers.js';

function pct(value) {
  const v = value == null ? null : Math.max(0, Math.min(100, Math.round(+value)));
  return v == null ? '<span class="dim">—</span>' : `<span class="pct">${v}%</span>`;
}

export function renderCvTab({ jobs = [], answers = [], allowTailoredCv = false, cvPath = '' }) {
  const jobRows = jobs.map(j => `<tr>
    <td class="role">${esc(j.role || '')}<div class="dim">${esc(j.company || '')}</div></td>
    <td>${pct(j.cv_match_percent)}</td>
    <td>${pct(j.cv_drift_percent)}</td>
    <td class="dim">${esc(j.cv_missing_terms || 'none')}</td>
    <td>${esc(j.selected_cv_id || 'main')}<div class="dim">${esc(j.selected_cv_reason || '')}</div></td>
    <td>${esc(j.tailor_status || 'not_requested')}</td>
  </tr>`).join('');
  const answerRows = answers.map(a => `<tr>
    <td class="role" style="max-width:460px">${esc(a.question || '')}</td>
    <td class="em">${esc(a.answer || '')}</td>
    <td>${pct(a.confidence)}</td>
    <td>${pct(a.match_percent)}</td>
    <td class="dim">${esc(a.confidence_basis || a.options || 'profile')}</td>
  </tr>`).join('');
  return `<div class="cvguard">
    <h2 style="margin-top:0">📄 Canonical CV + optional tailoring</h2>
    <p><b>Source of truth:</b> ${esc(cvPath || 'No CV configured')}</p>
    <p class="dim">JobPilot records a match and drift percentage for every lead. A tailored draft can only reorder facts already in your profile/CV; it cannot add qualifications. Turn drafts on or off with the Tailored CV control at the top of this page.</p>
    <p style="margin-top:8px"><b>Tailored CV upload:</b> ${allowTailoredCv ? '<span class="ok">approved</span>' : '<span class="warn">not approved</span>'}</p>
  </div>
  <h2>CV match and drift by job</h2>
  ${table('cv_jobs', ['Role / company', 'Match', 'Drift', 'Terms not evidenced', 'Selected CV', 'Tailoring'], jobRows, 'No CV assessments yet')}
  <h2>Answer confidence report</h2>
  <p class="dim" style="margin-bottom:8px">These inferred answers remain reviewable in Questions. Confidence is a transparent estimate of how directly the answer came from the canonical profile/CV.</p>
  ${table('answer_report', ['Question', 'Answer', 'Confidence', 'Match', 'Basis'], answerRows, 'No agent-inferred answers yet')}`.trim();
}
