// Strategies tab. The agent shows one playbook per platform. The human marks what works and what is wrong.
import { esc } from '../helpers.js';

export function renderStrategiesTab(list) {
  const platforms = [...new Set(list.map(s => s.platform))];
  const intro = '<p class="dim" style="margin:8px 0">Each platform has its own steps, including what already worked and what failed. Write what might work, or what is wrong. Your note stays on this machine, and the agent reads it before the next pass. A step you mark wrong is blocked.</p>';
  return intro + platforms.map(platform => `<h2>${esc(platform)}</h2>` + list.filter(s => s.platform === platform).map(row).join('')).join('');
}

function row(s) {
  const said = s.human
    ? `<div>You said <b>${esc(s.human.verdict)}</b>${s.human.note ? ': ' + esc(s.human.note) : ''}</div>`
    : '';
  return `<div class="banner">
  <div><b>${esc(s.result)}</b> — ${esc(s.when)}</div>
  <div>${esc(s.step)}</div>
  ${s.evidence ? `<div class="dim">${esc(s.evidence)}</div>` : ''}
  ${said}
  <form onsubmit="return trainStrategy(event,'${esc(s.id)}')" style="margin-top:6px">
    <input name="note" placeholder="What might work, or what is wrong" value="${esc(s.human?.note || '')}" style="width:min(520px,100%)">
    <button type="submit" value="works" style="cursor:pointer">This works</button>
    <button type="submit" value="wrong" style="cursor:pointer">This is wrong</button>
  </form>
</div>`;
}
