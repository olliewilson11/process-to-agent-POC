import { DEFAULT_SETTINGS, calculate } from './savings.js';
import { normalise } from './schema.js';
import { analyse, MODELS, ApiError } from './analyse.js';
import { ingestFile, ACCEPT, LIMITS } from './ingest.js';
import { SAMPLE_INPUT, SAMPLE_ANALYSIS } from './sample.js';
import { toMarkdown } from './report.js';
import { hours, money, fte, pct, num } from './format.js';
import { icon } from './icons.js';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage unavailable */ } }
};

const state = {
  analysis: normalise(structuredClone(SAMPLE_ANALYSIS)).analysis,
  warnings: [],
  source: 'example',
  meta: {},
  settings: { ...DEFAULT_SETTINGS },
  files: [],
  controller: null
};

/* ---------- Input panel ---------- */
const form = $('#input-form');
const descEl = $('#description');
const keyEl = $('#api-key');
const rememberEl = $('#remember');
const modelEl = $('#model');
const fileEl = $('#files');
const dropEl = $('#drop');
const fileList = $('#file-list');
const runBtn = $('#run');
const runNote = $('#run-note');
const results = $('#results');

modelEl.innerHTML = MODELS.map((m) => `<option value="${m.id}">${esc(m.label)}</option>`).join('');
modelEl.value = store.get('pta.model') || MODELS[0].id;
fileEl.accept = ACCEPT;
const savedKey = store.get('pta.apiKey');
if (savedKey) { keyEl.value = savedKey; rememberEl.checked = true; }

modelEl.addEventListener('change', () => store.set('pta.model', modelEl.value));
rememberEl.addEventListener('change', () => store.set('pta.apiKey', rememberEl.checked && keyEl.value ? keyEl.value : null));
keyEl.addEventListener('change', () => { if (rememberEl.checked) store.set('pta.apiKey', keyEl.value || null); });
$('#load-example').addEventListener('click', () => { descEl.value = SAMPLE_INPUT; descEl.focus(); });
$('#toggle-key').addEventListener('click', (e) => {
  const show = keyEl.type === 'password';
  keyEl.type = show ? 'text' : 'password';
  e.currentTarget.textContent = show ? 'Hide' : 'Show';
});

async function addFiles(list) {
  for (const file of list) {
    if (state.files.length >= LIMITS.files) { note(`You can add up to ${LIMITS.files} files.`, true); break; }
    if (state.files.some((f) => f.name === file.name && f.size === file.size)) continue;
    const placeholder = { name: file.name, kind: 'Reading', size: file.size, pending: true };
    state.files.push(placeholder);
    renderFiles();
    try {
      Object.assign(placeholder, await ingestFile(file), { pending: false });
    } catch (err) {
      state.files.splice(state.files.indexOf(placeholder), 1);
      note(err.message, true);
    }
    renderFiles();
  }
}
function renderFiles() {
  fileList.innerHTML = state.files.map((f, i) => `
    <li>
      <span class="file-kind">${esc(f.kind)}</span>
      <span class="file-name">${esc(f.name)}</span>
      <span class="file-size">${f.chars ? `${num(f.chars / 6)} words` : `${num(f.size / 1024)} KB`}</span>
      <button type="button" class="link" data-remove="${i}" ${f.pending ? 'disabled' : ''} aria-label="Remove ${esc(f.name)}">Remove</button>
    </li>`).join('');
}
fileList.addEventListener('click', (e) => {
  const i = e.target.closest('[data-remove]')?.dataset.remove;
  if (i !== undefined) { state.files.splice(Number(i), 1); renderFiles(); }
});
fileEl.addEventListener('change', () => { addFiles([...fileEl.files]); fileEl.value = ''; });
['dragenter', 'dragover'].forEach((t) => dropEl.addEventListener(t, (e) => { e.preventDefault(); dropEl.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => dropEl.addEventListener(t, (e) => { e.preventDefault(); dropEl.classList.remove('over'); }));
dropEl.addEventListener('drop', (e) => addFiles([...e.dataTransfer.files]));

function note(msg, isError = false) {
  runNote.textContent = msg;
  runNote.classList.toggle('error', isError);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (state.controller) { state.controller.abort(); return; }
  const description = descEl.value.trim();
  const apiKey = keyEl.value.trim();
  if (!description && !state.files.length) return note('Describe the process or add at least one document.', true);
  if (!apiKey) { keyEl.focus(); return note('Add your Anthropic API key to run an analysis.', true); }
  if (state.files.some((f) => f.pending)) return note('Wait for your files to finish reading.', true);
  const chars = description.length + state.files.reduce((a, f) => a + (f.chars || 0), 0);
  if (chars > LIMITS.textChars) return note('That is too much text for one analysis. Remove a document or trim the description.', true);
  if (rememberEl.checked) store.set('pta.apiKey', apiKey);

  const previous = { analysis: state.analysis, warnings: state.warnings, source: state.source, meta: state.meta };
  state.controller = new AbortController();
  runBtn.textContent = 'Cancel';
  note('');
  showProgress();
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const started = Date.now();
  const timer = setInterval(() => { const el = $('#p-time'); if (el) el.textContent = `${Math.round((Date.now() - started) / 1000)}s elapsed`; }, 1000);
  const model = modelEl.value;

  try {
    const { raw, usage } = await analyse({
      apiKey, model, description,
      blocks: state.files.map((f) => f.block),
      signal: state.controller.signal,
      onProgress: updateProgress
    });
    const { analysis, warnings } = normalise(raw);
    Object.assign(state, {
      analysis, warnings, source: 'live',
      meta: { model: MODELS.find((m) => m.id === model)?.label.replace(/ \(.*\)$/, '') ?? model, usage, seconds: Math.round((Date.now() - started) / 1000) }
    });
    renderResults();
  } catch (err) {
    Object.assign(state, previous);
    renderResults();
    if (err.name === 'AbortError') note('Analysis cancelled.');
    else note(err instanceof ApiError || err.message ? err.message : 'Something went wrong. Try again.', true);
  } finally {
    clearInterval(timer);
    state.controller = null;
    runBtn.textContent = 'Analyse the process';
  }
});

/* ---------- Progress ---------- */
const STAGES = ['Reading the material', 'Mapping the process', 'Designing agent solutions', 'Writing validation questions'];
function showProgress() {
  results.innerHTML = `
    <div class="card progress-card" role="status">
      <div class="orb" aria-hidden="true"></div>
      <h2>Analysing your process</h2>
      <ul class="stages">${STAGES.map((s, i) => `<li class="${i === 0 ? 'active' : ''}"><span class="mark">${icon('check')}</span>${s}</li>`).join('')}</ul>
      <p class="p-meta"><span id="p-detail">Sending your material to Claude</span> · <span id="p-time">0s elapsed</span></p>
      <p class="hint">A full analysis usually takes one to three minutes.</p>
    </div>`;
}
function updateProgress(p) {
  const items = $$('.stages li', results);
  if (!items.length) return;
  const at = STAGES.indexOf(p.stage);
  items.forEach((li, i) => { li.className = i < at ? 'done' : i === at ? 'active' : ''; });
  $('#p-detail').textContent = `${p.steps} ${p.steps === 1 ? 'step' : 'steps'} · ${p.opportunities} ${p.opportunities === 1 ? 'agent' : 'agents'}`;
}

/* ---------- Results ---------- */
const FIT_LABEL = { high: 'Strong fit', medium: 'Partial fit', low: 'Keep with people' };
const PHASE_KEY = { Discover: 'discover', Build: 'build', Evaluate: 'evaluate', Pilot: 'pilot', 'Roll out': 'rollout' };

function callout() {
  if (state.source === 'example') {
    return `<div class="callout">
      ${icon('sparkles')}
      <p><strong>Worked example.</strong> Harbourside Distribution is a fictional company. Add your API key to analyse your own process.</p>
      <button type="button" class="btn sm" data-action="use-example">Load its input</button>
    </div>`;
  }
  const u = state.meta.usage || {};
  const tokens = u.input_tokens ? ` · ${num(u.input_tokens)} tokens in, ${num(u.output_tokens || 0)} out` : '';
  const warn = state.warnings.length
    ? `<details class="warnings"><summary>${state.warnings.length} ${state.warnings.length === 1 ? 'fix' : 'fixes'} applied to the model's output</summary><ul>${state.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>`
    : '';
  return `<div class="callout live">
    ${icon('check')}
    <p><strong>Your analysis.</strong> ${esc(state.meta.model)} · ${state.meta.seconds}s${tokens}. Figures marked <span class="est">est.</span> were not in your material, so check those first.</p>
    ${warn}
  </div>`;
}

function kpi(key, label, ic, cls = '') {
  return `<div class="kpi ${cls}">
    <div class="k-top"><span class="k-ic">${icon(ic)}</span>${label}</div>
    <div class="k-val" data-calc="${key}"></div>
    <div class="k-sub" data-calc="${key}-sub"></div>
  </div>`;
}

function renderResults() {
  const a = state.analysis;
  const calc = calculate(a, state.settings);
  const oc = Object.fromEntries(calc.opportunities.map((o) => [o.id, o]));
  const ranked = [...a.opportunities].sort((x, y) => oc[y.id].hoursPerBuildWeek - oc[x.id].hoursPerBuildWeek);
  const oppsByStep = {};
  a.opportunities.forEach((o) => o.step_impacts.forEach((i) => { (oppsByStep[i.step_id] ??= []).push(o.id); }));
  const s = state.settings;

  results.innerHTML = `
    ${callout()}

    <section class="card card-pad overview" aria-labelledby="process-name">
      <span class="kicker">Process</span>
      <h2 id="process-name">${esc(a.process_name)}</h2>
      <p class="lede">${esc(a.summary)}</p>
      <div class="kpis">
        ${kpi('total-hours', 'Hours saved a year', 'clock', 'hero-kpi')}
        ${kpi('total-value', 'Value a year', 'trend')}
        ${kpi('total-fte', 'Equivalent people', 'users')}
        ${kpi('total-share', 'Share of current effort', 'pie')}
      </div>
      <div class="assumptions">
        <span class="a-title">${icon('sliders')}Assumptions</span>
        <label class="chip-input">Cost per hour <span class="input-wrap"><select id="set-currency" data-edit="setting:currency" aria-label="Currency">${['£', '$', '€'].map((c) => `<option ${c === s.currency ? 'selected' : ''}>${c}</option>`).join('')}</select><input id="set-cost" type="number" min="0" step="1" value="${s.hourlyCost}" data-edit="setting:hourlyCost"></span></label>
        <label class="chip-input">Hours per person a year <input id="set-fte" type="number" min="1" step="10" value="${s.hoursPerFte}" data-edit="setting:hoursPerFte"></label>
        <label class="chip-input">Adoption <span class="input-wrap"><input id="set-adoption" type="number" min="0" max="100" step="5" value="${Math.round(s.adoption * 100)}" data-edit="setting:adoption"><span class="unit">%</span></span></label>
      </div>
    </section>

    <section class="section" aria-labelledby="map-h">
      <div class="section-head">
        <div><h3 id="map-h">The process today</h3><p>Each step as it runs now, how well it suits an agent and which opportunity covers it.</p></div>
        <div class="legend"><span><i style="background:var(--green)"></i>Strong fit</span><span><i style="background:var(--amber)"></i>Partial fit</span><span><i style="background:var(--faint)"></i>Keep with people</span></div>
      </div>
      <div class="flow-wrap"><ol class="flow">
        ${a.steps.map((st) => `
          <li class="node fit-${st.automation_fit}">
            <div class="node-top"><span class="sid">${esc(st.id)}</span><span class="fit">${FIT_LABEL[st.automation_fit]}</span></div>
            <div class="node-name">${esc(st.name)}</div>
            <div class="node-actor">${esc(st.actor)}</div>
            <div class="node-foot"><span class="node-hours" data-calc="step-hours:${esc(st.id)}"></span><span class="badges">${(oppsByStep[st.id] || []).map((id) => `<a class="badge" href="#opp-${esc(id)}">${esc(id)}</a>`).join('')}</span></div>
          </li>`).join('')}
      </ol></div>
    </section>

    <section class="card card-pad section" aria-labelledby="bars-h">
      <div class="section-head">
        <div><h3 id="bars-h">Where the hours go</h3><p>Hands-on hours a month per step, and the part agents would remove before adoption.</p></div>
        <div class="legend"><span><i style="background:rgba(148,163,184,.4)"></i>Current</span><span><i style="background:var(--teal)"></i>Removed</span></div>
      </div>
      <div class="bars">
        ${a.steps.map((st) => `
          <div class="bar-row">
            <span class="bar-label"><span class="sid">${esc(st.id)}</span>${esc(st.name)}</span>
            <span class="bar-track"><span class="bar-now" data-calc="bar-now:${esc(st.id)}"></span><span class="bar-saved" data-calc="bar-saved:${esc(st.id)}"></span></span>
            <span class="bar-val" data-calc="bar-val:${esc(st.id)}"></span>
          </div>`).join('')}
      </div>
    </section>

    <section class="section" aria-labelledby="opps-h">
      <div class="section-head">
        <div><h3 id="opps-h">Agent opportunities</h3><p>Ranked by hours saved a year per week of build effort, so quick wins come first. Edit any share and the totals follow.</p></div>
      </div>
      <div class="opps">${ranked.map((o, i) => oppCard(o, i, a)).join('')}</div>
    </section>

    <section class="section" aria-labelledby="steps-h">
      <div class="section-head">
        <div><h3 id="steps-h">Step timings</h3><p>Every figure behind the estimate, with its evidence. Change any of them and everything updates.</p></div>
      </div>
      <div class="card table-wrap"><table class="steps-table">
        <thead><tr><th scope="col">Step</th><th scope="col">Who</th><th scope="col" class="r">Min per run</th><th scope="col" class="r">Runs a month</th><th scope="col" class="r">Hours a month</th><th scope="col">Evidence</th></tr></thead>
        <tbody>${a.steps.map((st) => `
          <tr>
            <th scope="row"><span class="sid">${esc(st.id)}</span> ${esc(st.name)}</th>
            <td class="muted">${esc(st.actor)}</td>
            <td class="r"><input type="number" min="0" step="0.5" value="${st.minutes_per_run}" data-edit="step:${esc(st.id)}:minutes_per_run" aria-label="Minutes per run for ${esc(st.name)}">${st.estimated ? '<span class="est">est.</span>' : ''}</td>
            <td class="r"><input type="number" min="0" step="1" value="${st.runs_per_month}" data-edit="step:${esc(st.id)}:runs_per_month" aria-label="Runs per month for ${esc(st.name)}"></td>
            <td class="r num" data-calc="step-hours-num:${esc(st.id)}"></td>
            <td class="evidence">${st.source_quote ? `<q>${esc(st.source_quote)}</q>` : ''}${st.estimated && st.basis ? `<span class="basis">${esc(st.basis)}</span>` : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </section>

    ${a.validation_questions.length ? `
    <section class="section" aria-labelledby="q-h">
      <div class="section-head"><div><h3 id="q-h">Questions to validate</h3><p>What to ask the process owner before committing to a build.</p></div></div>
      <ol class="questions">${a.validation_questions.map((q) => `<li><span>${esc(q)}</span></li>`).join('')}</ol>
    </section>` : ''}

    <section class="card export" aria-label="Export">
      <button type="button" class="btn primary" data-action="copy-md">${icon('copy')}Copy as Markdown</button>
      <button type="button" class="btn" data-action="download-md">${icon('download')}Download report</button>
      <button type="button" class="btn" data-action="download-json">${icon('code')}Download data</button>
      <span class="muted" id="export-note" aria-live="polite"></span>
    </section>`;
  updateNumbers();
}

function oppCard(o, i, a) {
  const stepsById = Object.fromEntries(a.steps.map((st) => [st.id, st]));
  const weeks = o.deployment_plan.reduce((sum, p) => sum + p.weeks, 0);
  const listCol = (title, ic, items) => (items.length ? `<div><h5>${icon(ic)}${title}</h5><ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '');
  const id = esc(o.id);
  return `
    <article class="card opp" id="opp-${id}">
      <header class="opp-head">
        <span class="rank">${i + 1}</span>
        <div class="opp-title">
          <h4>${esc(o.title)}</h4>
          <div class="tags">
            <span class="tag oid">${id}</span>
            <span class="tag">${esc(o.pattern)}</span>
            <span class="tag">Effort ${esc(o.effort)}</span>
            <span class="tag conf-${o.confidence}"><span class="dot"></span>${esc(o.confidence[0].toUpperCase() + o.confidence.slice(1))} confidence</span>
          </div>
        </div>
        <div class="opp-metric"><div class="v" data-calc="opp-hours:${id}"></div><div class="s" data-calc="opp-value:${id}"></div></div>
      </header>
      <div class="opp-body">
        <p>${esc(o.what_the_agent_does)}</p>
        ${o.human_in_the_loop ? `<div class="hitl">${icon('userCheck')}<span><strong>People still decide.</strong> ${esc(o.human_in_the_loop)}</span></div>` : ''}
        <div class="tabs" role="tablist" aria-label="${esc(o.title)} details">
          <button type="button" class="tab" role="tab" aria-selected="true" data-action="tab" data-opp="${id}" data-tab="impact">Impact</button>
          ${o.deployment_plan.length ? `<button type="button" class="tab" role="tab" aria-selected="false" data-action="tab" data-opp="${id}" data-tab="plan">Deployment plan · ${num(weeks)} wk</button>` : ''}
          <button type="button" class="tab" role="tab" aria-selected="false" data-action="tab" data-opp="${id}" data-tab="build">Integrations and risks</button>
        </div>
        <div class="tab-panel" role="tabpanel" data-panel="${id}:impact">
          <div class="boxed table-wrap"><table class="impacts">
            <thead><tr><th scope="col">Step</th><th scope="col" class="r">Now, h/mo</th><th scope="col" class="r">Share removed</th><th scope="col" class="r">Saved, h/mo</th></tr></thead>
            <tbody>${o.step_impacts.map((imp) => `
              <tr>
                <th scope="row"><span class="sid">${esc(imp.step_id)}</span> ${esc(stepsById[imp.step_id]?.name)}${imp.rationale ? `<span class="why">${esc(imp.rationale)}</span>` : ''}</th>
                <td class="r num" data-calc="imp-now:${id}:${esc(imp.step_id)}"></td>
                <td class="r"><span class="input-wrap"><input type="number" min="0" max="90" step="5" value="${Math.round(imp.share * 100)}" data-edit="share:${id}:${esc(imp.step_id)}" aria-label="Share of ${esc(imp.step_id)} removed by ${esc(o.title)}"><span class="unit">%</span></span></td>
                <td class="r num pos" data-calc="imp-saved:${id}:${esc(imp.step_id)}"></td>
              </tr>`).join('')}
            </tbody>
          </table></div>
        </div>
        ${o.deployment_plan.length ? `
        <div class="tab-panel" role="tabpanel" data-panel="${id}:plan" hidden>
          <div class="plan-head"><span><b>${num(weeks)} weeks</b> from discovery to rollout</span><span data-calc="opp-rate:${id}"></span></div>
          <div class="gantt" aria-hidden="true">${o.deployment_plan.map((p) => `<span class="b-${PHASE_KEY[p.phase]}" style="flex:${Math.max(p.weeks, 0.3)}" title="${esc(p.phase)}: ${p.weeks} weeks"></span>`).join('')}</div>
          <ol class="phases">${o.deployment_plan.map((p) => `
            <li><span class="ph-dot c-${PHASE_KEY[p.phase]}"></span>
              <div><div class="ph-name">${esc(p.phase)}<span class="ph-wk">${p.weeks} wk</span></div><div class="ph-act">${esc(p.action)}</div></div>
            </li>`).join('')}
          </ol>
        </div>` : ''}
        <div class="tab-panel" role="tabpanel" data-panel="${id}:build" hidden>
          <div class="cols3">
            ${listCol('Integrations', 'route', o.integrations)}
            ${listCol('Data needed', 'code', o.data_needed)}
            ${listCol('Risks', 'alert', o.risks)}
          </div>
        </div>
      </div>
    </article>`;
}

function updateNumbers() {
  const a = state.analysis;
  const s = state.settings;
  const calc = calculate(a, s);
  const get = (key) => results.querySelector(`[data-calc="${key}"]`);
  const set = (key, text) => { const el = get(key); if (el) el.textContent = text; };
  const html = (key, markup) => { const el = get(key); if (el) el.innerHTML = markup; };
  const t = calc.total;
  set('total-hours', num(t.annualHours));
  set('total-hours-sub', `${num(t.lowAnnualHours)} – ${num(t.annualHours)} range`);
  set('total-value', money(t.annualValue, s.currency));
  set('total-value-sub', `${money(t.lowAnnualValue, s.currency)} – ${money(t.annualValue, s.currency)} range`);
  set('total-fte', fte(t.fte));
  set('total-fte-sub', `at ${num(s.hoursPerFte)} h each`);
  set('total-share', pct(t.shareOfCurrent));
  set('total-share-sub', `of ${num(t.currentAnnualHours)} h a year`);

  const max = Math.max(1, ...calc.steps.map((x) => x.currentMonthly));
  for (const st of calc.steps) {
    set(`step-hours:${st.id}`, `${num(st.currentMonthly)} h/mo`);
    set(`step-hours-num:${st.id}`, num(st.currentMonthly));
    const now = get(`bar-now:${st.id}`);
    const saved = get(`bar-saved:${st.id}`);
    if (now) now.style.width = `${(st.currentMonthly / max) * 100}%`;
    if (saved) saved.style.width = `${(st.savedMonthly / max) * 100}%`;
    html(`bar-val:${st.id}`, st.savedMonthly > 0.05 ? `${num(st.currentMonthly)} h · <b>−${num(st.savedMonthly)}</b>` : `${num(st.currentMonthly)} h`);
  }
  for (const o of calc.opportunities) {
    html(`opp-hours:${o.id}`, `${num(o.annualHours)} <small>h a year</small>`);
    set(`opp-value:${o.id}`, `${money(o.annualValue, s.currency)} · ${fte(o.fte)} FTE`);
    set(`opp-rate:${o.id}`, `${num(o.hoursPerBuildWeek)} h saved a year per build week`);
    for (const imp of o.impacts) {
      set(`imp-now:${o.id}:${imp.step_id}`, num(imp.currentMonthly));
      set(`imp-saved:${o.id}:${imp.step_id}`, num(imp.savedMonthly));
    }
  }
}

results.addEventListener('input', (e) => {
  const key = e.target.dataset.edit;
  if (!key) return;
  const [kind, a, b] = key.split(':');
  const value = e.target.value;
  const n = Number(value);
  if (kind === 'setting') {
    if (a === 'currency') state.settings.currency = value;
    else if (Number.isFinite(n) && value !== '') state.settings[a] = a === 'adoption' ? Math.min(1, Math.max(0, n / 100)) : Math.max(a === 'hoursPerFte' ? 1 : 0, n);
  } else if (kind === 'step') {
    const st = state.analysis.steps.find((x) => x.id === a);
    if (st && Number.isFinite(n) && value !== '') st[b] = Math.max(0, n);
  } else if (kind === 'share') {
    const imp = state.analysis.opportunities.find((o) => o.id === a)?.step_impacts.find((i) => i.step_id === b);
    if (imp && Number.isFinite(n) && value !== '') imp.share = Math.min(0.9, Math.max(0, n / 100));
  }
  updateNumbers();
});

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const slug = () => state.analysis.process_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'process';

results.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const md = () => toMarkdown(state.analysis, calculate(state.analysis, state.settings), state.settings, state.meta);
  const exportNote = $('#export-note');
  if (action === 'tab') {
    const card = el.closest('.opp');
    $$('.tab', card).forEach((t) => t.setAttribute('aria-selected', String(t === el)));
    $$('.tab-panel', card).forEach((p) => { p.hidden = p.dataset.panel !== `${el.dataset.opp}:${el.dataset.tab}`; });
  } else if (action === 'use-example') {
    descEl.value = SAMPLE_INPUT;
    descEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    descEl.focus({ preventScroll: true });
  } else if (action === 'copy-md') {
    try { await navigator.clipboard.writeText(md()); exportNote.textContent = 'Copied to clipboard.'; } catch { download(`${slug()}.md`, md(), 'text/markdown'); exportNote.textContent = 'Copy was blocked, so the report was downloaded instead.'; }
  } else if (action === 'download-md') {
    download(`${slug()}.md`, md(), 'text/markdown');
  } else if (action === 'download-json') {
    download(`${slug()}.json`, JSON.stringify({ analysis: state.analysis, settings: state.settings, results: calculate(state.analysis, state.settings) }, null, 2), 'application/json');
  }
});

renderResults();
