// Progress for anything the user waits on (model loading, panel-method solves in the workers, statistics runs,
// plot rendering): a progress window centred over the 3D view and a mirror in the status bar. It shows what is
// running, a bar with the percentage (a moving bar when the amount of work is unknown), the current step, the time
// elapsed and, where it can be estimated, the time left. A task can offer Cancel, and the window can be hidden
// to the status bar for long runs.
const $ = (id) => document.getElementById(id);
const tasks = [];
let seq = 0, timer = null, hidden = false;

const clock = (s) => { s = Math.max(0, Math.round(s)); return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// startTask({ title, detail, frac (0–1, or null when unknown), eta (estimate the time left from frac),
//             scrim (dim the view: nothing to look at yet), onCancel, cancelLabel }) → { update(fields), done() }
export function startTask(opts) {
  const t = { id: ++seq, title: 'Working…', detail: '', frac: null, eta: false, scrim: false, onCancel: null, cancelLabel: 'Cancel', ...opts, t0: performance.now() };
  tasks.push(t);
  hidden = false;
  render();
  if (!timer) timer = setInterval(renderTime, 500);
  return {
    update(o) { Object.assign(t, o); render(); },
    done() {
      const i = tasks.indexOf(t); if (i < 0) return;
      tasks.splice(i, 1);
      if (!tasks.length) { clearInterval(timer); timer = null; }
      render();
    },
  };
}

// the task on show (the latest started), for the status text on the stage tabs
export const currentTask = () => tasks[tasks.length - 1] || null;

// let the browser paint the progress window before a long synchronous step
export const nextPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

function render() {
  document.dispatchEvent(new Event('floatsim:task'));   // tab status and status bar follow straight away
  const t = currentTask(), box = $('taskbox');
  $('viewScrim').classList.toggle('hidden', !t || !t.scrim);
  $('sbTask').classList.toggle('hidden', !t);
  if (!t) { box.classList.add('hidden'); return; }
  box.classList.toggle('hidden', hidden);
  $('taskTitle').textContent = t.title;
  $('taskDetail').textContent = t.detail || '';
  const known = Number.isFinite(t.frac);
  const pct = known ? Math.max(0, Math.min(100, Math.round(t.frac * 100))) : null;
  for (const [bar, fill, label] of [['taskBar', 'taskFill', 'taskPct'], ['sbBar', 'sbFill', null]]) {
    $(bar).classList.toggle('indet', !known);
    $(fill).style.width = known ? `${pct}%` : '';
    if (label) $(label).textContent = known ? `${pct} %` : '';
  }
  $('taskBar').setAttribute('aria-valuetext', known ? `${pct} percent` : 'working');
  if (known) $('taskBar').setAttribute('aria-valuenow', String(pct)); else $('taskBar').removeAttribute('aria-valuenow');
  $('sbTaskText').textContent = `${t.title}${known ? ` · ${pct} %` : '…'}`;
  const c = $('taskCancel');
  c.classList.toggle('hidden', !t.onCancel);
  c.textContent = t.cancelLabel;
  $('taskMore').textContent = tasks.length > 1 ? `+${tasks.length - 1} more running` : '';
  renderTime();
}
function renderTime() {
  const t = currentTask(); if (!t) return;
  const el = (performance.now() - t.t0) / 1000;
  let txt = `${clock(el)} elapsed`;
  if (t.eta && Number.isFinite(t.frac) && t.frac > 0.02 && el > 2) txt += ` · about ${clock(el * (1 - t.frac) / t.frac)} left`;
  $('taskTime').textContent = txt;
}

export function initProgress() {
  $('taskCancel').onclick = () => { const t = currentTask(); if (t && t.onCancel) t.onCancel(); };
  $('taskHide').onclick = () => { hidden = true; render(); };
  $('sbTask').onclick = () => { hidden = false; render(); };
}
