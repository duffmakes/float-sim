// Workspace chrome: menu bar, stage tabs (Float · Waves · RAO, plus the drop / rise test mode), the tool panes
// (mooring, wind, drag), the animation toolbar, the status bar and the drop-test orientation fields.
// The simulation modules keep their own element IDs; this file only shows, hides and mirrors them.
import { currentTask } from './progress.js';

const $ = (id) => document.getElementById(id);

// results tab → stage (the stage tabs are the results tabs, so the modules' showTab() also switches stage)
const STAGE_OF_TAB = { tabHydro: 'float', tabSea: 'waves', tabRao: 'rao', tabDrop: 'drop' };
const HUD_TITLE = { float: 'Free float', waves: 'Wave run', rao: 'RAO · frequency domain', drop: 'Drop / rise test' };
const TOOLS = { moor: 'moorOn', wind: 'windOn', drag: 'dragOn' };
const TOOL_NAMES = { moorOn: 'Mooring', windOn: 'Wind', dragOn: 'Drag & heave plates' };
const VIEW_NAMES = { fit: null, iso: 'Isometric', front: 'Front', right: 'Right', top: 'Top' };

export function initUI(api) {
  const body = document.body;
  let stage = 'float', tool = null, wavesRan = false;

  // ------------------------------------------------------------ menus
  const wraps = [...document.querySelectorAll('.menuwrap')];
  const closeMenus = (except = null) => {
    for (const w of wraps) {
      if (w === except) continue;
      w.querySelector('.menu').classList.add('hidden');
      const b = w.querySelector('.mm'); b.classList.remove('open'); b.setAttribute('aria-expanded', 'false');
    }
  };
  for (const w of wraps) {
    const btn = w.querySelector('.mm'), menu = w.querySelector('.menu');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = menu.classList.contains('hidden');
      closeMenus(w);
      menu.classList.toggle('hidden', !open); btn.classList.toggle('open', open); btn.setAttribute('aria-expanded', String(open));
      if (open) refreshToolStates();
    });
    // moving across the bar while a menu is open opens the neighbour (desktop menu behaviour)
    btn.addEventListener('mouseenter', () => { if (wraps.some((x) => x !== w && !x.querySelector('.menu').classList.contains('hidden'))) btn.click(); });
  }
  document.addEventListener('click', (e) => { if (!e.target.closest('.menuwrap')) closeMenus(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const act = el.dataset.act;
    if (el.closest('.menu')) closeMenus();
    if (act === 'upload') $('file').click();
    else if (act === 'demo') { $('demo').value = el.dataset.demo; $('demo').dispatchEvent(new Event('change')); }
    else if (act === 'view') setView(el.dataset.view);
    else if (act === 'tool') openTool(el.dataset.tool);
    else if (act === 'closetool') closeTool();
    else if (act === 'drop') openDrop();
    else if (act === 'help') $('helpDlg').showModal();
    else if (act === 'closehelp') $('helpDlg').close();
    else if (act === 'ori') { $({ x: 'quarterX', y: 'quarterY', reset: 'resetOri' }[el.dataset.ori]).click(); syncAttitude(); }
  });
  for (const b of document.querySelectorAll('#gtb [data-view]')) b.addEventListener('click', () => setView(b.dataset.view));
  function setView(v) {
    api.setView(v);
    if (VIEW_NAMES[v]) $('sbView').textContent = VIEW_NAMES[v];
  }

  // ------------------------------------------------------------ stages and panes
  function showPane(name) {
    for (const p of document.querySelectorAll('.stagepane')) p.classList.toggle('active', p.dataset.pane === name);
  }
  function applyStage(s) {
    const changed = s !== stage;
    stage = s; body.dataset.stage = s;
    if (tool && s !== 'waves') { tool = null; delete body.dataset.tool; }
    showPane(tool ? `tool-${tool}` : s);
    for (const g of document.querySelectorAll('#anim .grp')) g.classList.toggle('on', g.dataset.for === s);
    $('hudTitle').textContent = HUD_TITLE[s];
    for (const b of $('tabs').children) b.classList.toggle('on', b.dataset.stage === s);
    if (changed && s === 'drop') syncAttitude();
    api.onStage(s);
  }
  // follow whichever results tab the modules (or the user) brought up
  const tabObserver = new MutationObserver(() => {
    const shown = Object.keys(STAGE_OF_TAB).find((id) => !$(id).classList.contains('hidden'));
    if (shown && STAGE_OF_TAB[shown] !== stage) applyStage(STAGE_OF_TAB[shown]);
  });
  for (const id of Object.keys(STAGE_OF_TAB)) tabObserver.observe($(id), { attributes: true, attributeFilter: ['class'] });
  const showStage = (s) => { const b = [...$('tabs').children].find((x) => x.dataset.stage === s); if (b) b.click(); };

  function openTool(t) {
    if (stage !== 'waves') showStage('waves');
    tool = t; body.dataset.tool = t;
    showPane(`tool-${t}`);
  }
  function closeTool() { tool = null; delete body.dataset.tool; showPane(stage); }
  // a stage tab always brings up that stage's own setup, so clicking Waves while a tool pane is open closes the tool
  $('tabs').addEventListener('click', (e) => { if (e.target.closest('button') && tool) closeTool(); });
  function openDrop() { showStage('drop'); }
  function exitDrop() {
    if (!$('dzReset').disabled) $('dzReset').click();
    showStage('float');
  }
  $('exitDrop').onclick = exitDrop;
  $('dropDone').onclick = exitDrop;

  // ------------------------------------------------------------ add-ons (mooring, wind, drag)
  function refreshToolStates() {
    const on = Object.values(TOOLS).filter((id) => $(id).checked);
    for (const s of document.querySelectorAll('.mi .st[data-state]')) {
      const c = $(s.dataset.state).checked; s.textContent = c ? '✓ On' : 'Off'; s.classList.toggle('on', c);
    }
    const names = on.map((id) => TOOL_NAMES[id]);
    for (const e of document.querySelectorAll('.addons-sum')) e.textContent = names.length ? names.join(', ') : 'none';
    $('sbAddons').textContent = `Add-ons: ${names.length ? names.join(', ') : 'none'}`;
    $('toolsBtn').textContent = on.length ? `Tools (${on.length} on)` : 'Tools';
  }
  for (const id of Object.values(TOOLS)) $(id).addEventListener('change', refreshToolStates);

  // ------------------------------------------------------------ start attitude: summary and the drop-test copy
  const ATT = [['rollN', 'dzRoll'], ['pitchN', 'dzPitch'], ['yawN', 'dzYaw']];
  const fmtDeg = (v) => `${+(+v || 0).toFixed(1)}°`;
  function syncAttitude() {
    const vals = ATT.map(([main]) => $(main).value);
    $('attSummary').textContent = vals.map(fmtDeg).join(', ');
    $('dzAttSummary').textContent = vals.map(fmtDeg).join(', ');
    ATT.forEach(([main, copy]) => { if (document.activeElement !== $(copy)) $(copy).value = $(main).value; });
  }
  for (const [main, copy] of ATT) {
    $(copy).addEventListener('change', () => { $(main).value = $(copy).value; $(main).dispatchEvent(new Event('change')); syncAttitude(); });
    $(main).addEventListener('change', syncAttitude);
    $(main.replace('N', '')).addEventListener('input', syncAttitude);
  }

  // ------------------------------------------------------------ dz runs table
  $('dzRunsClear').onclick = () => api.clearDropRuns();

  // ------------------------------------------------------------ status text on the tabs, the mode bar and the status bar
  function refreshStatus() {
    const v = $('verdict'), vb = v.querySelector('b');
    const st = $('stFloat');
    st.textContent = vb ? vb.textContent.split(' · ')[0] : '';
    st.className = `s ${/good|ok/.test(v.className) ? 'ok' : /bad/.test(v.className) ? 'bad' : ''}`;
    const running = $('waveRun').textContent.includes('Stop');
    const task = currentTask(), pct = task && Number.isFinite(task.frac) ? ` ${Math.round(task.frac * 100)} %` : '…';
    const statsRunning = !!task && task.title.startsWith('Running statistics');
    if (running || statsRunning) wavesRan = true;
    const sw = $('stWaves');
    sw.textContent = body.classList.contains('locked') ? 'paused' : statsRunning ? `statistics${pct}` : running ? 'running' : wavesRan ? 'run' : 'not run';
    sw.className = `s ${running || statsRunning ? 'run' : ''}`;
    const solving = !$('raoProgWrap').classList.contains('hidden');
    const sr = $('stRao');
    sr.textContent = body.classList.contains('locked') ? 'paused' : solving ? `solving ${$('raoProgText').textContent || '…'}` : !$('raoCsv').disabled ? 'solved' : 'not run';
    sr.className = `s ${solving ? 'run' : !$('raoCsv').disabled ? 'ok' : ''}`;
    const dv = $('dropVerdict').querySelector('b');
    $('stDrop').textContent = dv ? dv.textContent.replace(/^[✓✕]\s*/, '').toLowerCase() : '';
    const placed = !$('dzReset').disabled;
    $('modeText').textContent = placed
      ? 'The body is placed away from its float position, so Waves and RAO are paused until you exit.'
      : 'Set the start height and orientation, place the body, then release it.';
    $('sbState').textContent = task ? 'Busy'
      : $('simRun').textContent.includes('Pause') ? 'Running free float'
        : running ? 'Running waves'
          : $('dzRun').textContent.includes('Pause') ? 'Running drop test' : 'Ready';
  }
  setInterval(refreshStatus, 400);
  document.addEventListener('floatsim:task', () => refreshStatus());

  // ------------------------------------------------------------ hooks for app.js
  applyStage('float');
  refreshToolStates();
  return {
    onModel(name, { stl = false } = {}) {
      $('hudModel').textContent = name;
      $('sbModel').textContent = name;
      $('stlUnitsRow').classList.toggle('hidden', !stl);
      wavesRan = false;
    },
    onUpdate({ rho }) {
      $('sbWater').textContent = `ρ ${rho} kg/m³`;
      syncAttitude();
      refreshStatus();
    },
    setLocked(on) { body.classList.toggle('locked', on); refreshStatus(); },
    get stage() { return stage; },
  };
}
