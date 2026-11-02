import { DEFAULT_SETTINGS, calculate } from './savings.js';
import { normalise } from './schema.js';
import { analyse, MODELS, ApiError } from './analyse.js';
import { ingestFile, ACCEPT, LIMITS } from './ingest.js';
import { SAMPLE_INPUT, SAMPLE_ANALYSIS } from './sample.js';
import { toMarkdown } from './report.js';
import { hours, money, fte, pct, num } from './format.js';

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

  const previous = { ...state };
  state.controller = new AbortController();
  runBtn.textContent = 'Cancel';
  note('');
  showProgress();
  const started = Date.now();
  const timer = setInterval(() => { const el = $('#p-time'); if (el) el.textContent = `${Math.round((Date.now() - started) / 1000)} seconds`; }, 1000);
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
      meta: { model: MODELS.find((m) => m.id === model)?.label ?? model, usage, seconds: Math.round((Date.now() - started) / 1000) }
    });
    renderResults();
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    Object.assign(state, { analysis: previous.analysis, warnings: previous.warnings, source: previous.source, meta: previous.meta });
    renderResults();
    if (err.name === 'AbortError') note('Analysis cancelled.');
    else note(err instanceof ApiError || err.message ? err.message : 'Something went wrong. Try again.', true);
  } finally {
    clearInterval(timer);
    state.controller = null;
    runBtn.textContent = 'Analyse the process';
  }
});

function showProgress() {
  results.innerHTML = `
    <div class="progress-card" role="status">
      <div class="pulse" aria-hidden="true"><i></i><i></i><i></i></div>
      <h2 id="p-stage">Reading the material</h2>
      <p id="p-detail">Sending your process to Claude</p>
      <p class="muted" id="p-time">0 seconds</p>
      <p class="muted">A full analysis usually takes one to three minutes.</p>
    </div>`;
}
function updateProgress(p) {
  const stage = $('#p-stage');
  if (!stage) return;
  stage.textContent = p.stage;
  $('#p-detail').textContent = `${p.steps} ${p.steps === 1 ? 'step' : 'steps'} mapped · ${p.opportunities} agent ${p.opportunities === 1 ? 'opportunity' : 'opportunities'} so far`;
}

/* ---------- Results ---------- */
const FIT_LABEL = { high: 'Strong fit', medium: 'Partial fit', low: 'Keep with people' };
const PHASE_CLASS = { Discover: 'ph-discover', Build: 'ph-build', Evaluate: 'ph-evaluate', Pilot: 'ph-pilot', 'Roll out': 'ph-rollout' };

function banner() {
  if (state.source === 'example') {
    return `<div class="banner">
      <p><strong>Worked example.</strong> Harbourside Distribution is a fictional company. Add your API key on the left to analyse your own process.</p>
      <button type="button" class="btn ghost" data-action="use-example">Load this example's input</button>
    </div>`;
  }
  const u = state.meta.usage || {};
  const tokens = u.input_tokens ? ` · ${num(u.input_tokens)} tokens in, ${num(u.output_tokens || 0)} out` : '';
  const warn = state.warnings.length
    ? `<details class="warnings"><summary>${state.warnings.length} ${state.warnings.length === 1 ? 'fix' : 'fixes'} applied to the model's output</summary><ul>${state.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>`
    : '';
  return `<div class="banner live">
    <p><strong>Your analysis.</strong> Written by ${esc(state.meta.model)} in ${state.meta.seconds} seconds${tokens}. Figures marked <span class="est">est.</span> were not in your material, so check those first.</p>
    ${warn}
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
    ${banner()}
    <section class="headline" aria-labelledby="process-name">
      <div class="eyebrow">Process</div>
      <h2 id="process-name">${esc(a.process_name)}</h2>
      <p class="lede">${esc(a.summary)}</p>
      <div class="kpis">
        <div class="kpi"><span class="k-label">Hours saved a year</span><span class="k-val" data-calc="total-hours"></span><span class="k-sub" data-calc="total-hours-range"></span></div>
        <div class="kpi"><span class="k-label">Value a year</span><span class="k-val" data-calc="total-value"></span><span class="k-sub" data-calc="total-value-range"></span></div>
        <div class="kpi"><span class="k-label">Equivalent people</span><span class="k-val" data-calc="total-fte"></span><span class="k-sub" data-calc="fte-sub"></span></div>
        <div class="kpi"><span class="k-label">Share of current effort</span><span class="k-val" data-calc="total-share"></span><span class="k-sub" data-calc="share-sub"></span></div>
      </div>
      <div class="assumptions">
        <span class="a-title">Assumptions</span>
        <label>Cost per hour <span class="input-wrap"><select id="set-currency" data-edit="setting:currency" aria-label="Currency">${['£', '$', '€'].map((c) => `<option ${c === s.currency ? 'selected' : ''}>${c}</option>`).join('')}</select><input id="set-cost" type="number" min="0" step="1" value="${s.hourlyCost}" data-edit="setting:hourlyCost"></span></label>
        <label>Hours per person a year <input id="set-fte" type="number" min="1" step="10" value="${s.hoursPerFte}" data-edit="setting:hoursPerFte"></label>
        <label>Adoption <span class="input-wrap"><input id="set-adoption" type="number" min="0" max="100" step="5" value="${Math.round(s.adoption * 100)}" data-edit="setting:adoption"><span class="unit">%</span></span></label>
      </div>
    </section>

    <section aria-labelledby="map-h">
      <h3 id="map-h">The process today</h3>
      <p class="muted">Each step as it runs now. Colour shows how well it suits an agent. Badges show which opportunity covers it.</p>
      <div class="flow-wrap"><ol class="flow">
        ${a.steps.map((st) => `
          <li class="step fit-${st.automation_fit}">
            <div class="step-top"><span class="step-id">${esc(st.id)}</span><span class="fit">${FIT_LABEL[st.automation_fit]}</span></div>
            <div class="step-name">${esc(st.name)}</div>
            <div class="step-actor">${esc(st.actor)}</div>
            <div class="step-hours"><span data-calc="step-hours:${esc(st.id)}"></span> a month</div>
            <div class="badges">${(oppsByStep[st.id] || []).map((id) => `<a class="badge" href="#opp-${esc(id)}">${esc(id)}</a>`).join('')}</div>
          </li>`).join('')}
      </ol></div>
    </section>

    <section aria-labelledby="bars-h">
      <h3 id="bars-h">Where the hours go</h3>
      <p class="muted">Hands-on hours a month for each step, and the part the agents would remove before adoption.</p>
      <div class="bars">
        ${a.steps.map((st) => `
          <div class="bar-row">
            <span class="bar-label"><span class="step-id">${esc(st.id)}</span> ${esc(st.name)}</span>
            <span class="bar-track"><span class="bar-now" data-calc="bar-now:${esc(st.id)}"></span><span class="bar-saved" data-calc="bar-saved:${esc(st.id)}"></span></span>
            <span class="bar-val" data-calc="bar-val:${esc(st.id)}"></span>
          </div>`).join('')}
        <div class="legend"><span><i class="sw now"></i>Current hours</span><span><i class="sw saved"></i>Removed by agents</span></div>
      </div>
    </section>

    <section aria-labelledby="opps-h">
      <h3 id="opps-h">Agent opportunities</h3>
      <p class="muted">Ranked by hours saved a year for each week of build effort, so quick wins come first. Edit any share to see the totals change.</p>
      <div class="opps">${ranked.map((o, i) => oppCard(o, i, a)).join('')}</div>
    </section>

    <section aria-labelledby="steps-h">
      <h3 id="steps-h">Step timings</h3>
      <p class="muted">Every figure behind the estimate. Change any of them and the totals update.</p>
      <div class="table-wrap"><table class="steps-table">
        <thead><tr><th scope="col">Step</th><th scope="col">Who</th><th scope="col" class="r">Minutes per run</th><th scope="col" class="r">Runs per month</th><th scope="col" class="r">Hours per month</th><th scope="col">Evidence</th></tr></thead>
        <tbody>${a.steps.map((st) => `
          <tr>
            <th scope="row"><span class="step-id">${esc(st.id)}</span> ${esc(st.name)}</th>
            <td>${esc(st.actor)}</td>
            <td class="r"><input type="number" min="0" step="0.5" value="${st.minutes_per_run}" data-edit="step:${esc(st.id)}:minutes_per_run" aria-label="Minutes per run for ${esc(st.name)}">${st.estimated ? '<span class="est">est.</span>' : ''}</td>
            <td class="r"><input type="number" min="0" step="1" value="${st.runs_per_month}" data-edit="step:${esc(st.id)}:runs_per_month" aria-label="Runs per month for ${esc(st.name)}"></td>
            <td class="r num" data-calc="step-hours-num:${esc(st.id)}"></td>
            <td class="evidence">${st.source_quote ? `<q>${esc(st.source_quote)}</q>` : ''}${st.estimated && st.basis ? `<span class="basis">${esc(st.basis)}</span>` : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </section>

    ${a.validation_questions.length ? `
    <section aria-labelledby="q-h">
      <h3 id="q-h">Questions to validate</h3>
      <p class="muted">What to ask the process owner before committing to a build.</p>
      <ol class="questions">${a.validation_questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ol>
    </section>` : ''}

    <section class="export" aria-label="Export">
      <button type="button" class="btn" data-action="copy-md">Copy as Markdown</button>
      <button type="button" class="btn ghost" data-action="download-md">Download report</button>
      <button type="button" class="btn ghost" data-action="download-json">Download data</button>
      <span class="muted" id="export-note" aria-live="polite"></span>
    </section>`;
  updateNumbers();
}

function oppCard(o, i, a) {
  const stepsById = Object.fromEntries(a.steps.map((s) => [s.id, s]));
  const totalWeeks = o.deployment_plan.reduce((sum, p) => sum + p.weeks, 0) || 1;
  const listBlock = (title, items) => (items.length ? `<div><h5>${title}</h5><ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '');
  return `
    <article class="opp" id="opp-${esc(o.id)}">
      <header class="opp-head">
        <span class="rank">${i + 1}</span>
        <div class="opp-title">
          <div class="opp-meta"><span class="oid">${esc(o.id)}</span><span>${esc(o.pattern)}</span><span>Effort ${esc(o.effort)}</span><span class="conf conf-${o.confidence}">${esc(o.confidence)} confidence</span></div>
          <h4>${esc(o.title)}</h4>
        </div>
        <div class="opp-value"><span class="v" data-calc="opp-hours:${esc(o.id)}"></span><span class="s" data-calc="opp-value:${esc(o.id)}"></span></div>
      </header>
      <p>${esc(o.what_the_agent_does)}</p>
      ${o.human_in_the_loop ? `<p class="hitl"><strong>People still decide.</strong> ${esc(o.human_in_the_loop)}</p>` : ''}
      <div class="table-wrap"><table class="impacts">
        <thead><tr><th scope="col">Step</th><th scope="col" class="r">Now, h a month</th><th scope="col" class="r">Share removed</th><th scope="col" class="r">Saved, h a month</th></tr></thead>
        <tbody>${o.step_impacts.map((imp) => `
          <tr>
            <th scope="row"><span class="step-id">${esc(imp.step_id)}</span> ${esc(stepsById[imp.step_id]?.name)}${imp.rationale ? `<span class="why">${esc(imp.rationale)}</span>` : ''}</th>
            <td class="r num" data-calc="imp-now:${esc(o.id)}:${esc(imp.step_id)}"></td>
            <td class="r"><span class="input-wrap"><input type="number" min="0" max="90" step="5" value="${Math.round(imp.share * 100)}" data-edit="share:${esc(o.id)}:${esc(imp.step_id)}" aria-label="Share of ${esc(imp.step_id)} removed by ${esc(o.title)}"><span class="unit">%</span></span></td>
            <td class="r num" data-calc="imp-saved:${esc(o.id)}:${esc(imp.step_id)}"></td>
          </tr>`).join('')}
        </tbody>
      </table></div>
      <div class="opp-cols">
        ${listBlock('Integrations', o.integrations)}
        ${listBlock('Data needed', o.data_needed)}
        ${listBlock('Risks', o.risks)}
      </div>
      ${o.deployment_plan.length ? `
      <div class="plan">
        <h5>Deployment plan <span class="muted">· ${num(totalWeeks)} weeks · <span data-calc="opp-rate:${esc(o.id)}"></span></span></h5>
        <div class="gantt" aria-hidden="true">${o.deployment_plan.map((p) => `<span class="${PHASE_CLASS[p.phase]}" style="flex:${Math.max(p.weeks, 0.3)}" title="${esc(p.phase)}: ${p.weeks} weeks"></span>`).join('')}</div>
        <ol class="phases">${o.deployment_plan.map((p) => `
          <li><span class="phase ${PHASE_CLASS[p.phase]}">${esc(p.phase)}</span><span class="wk">${p.weeks} wk</span><span class="act">${esc(p.action)}</span></li>`).join('')}
        </ol>
      </div>` : ''}
    </article>`;
}

function updateNumbers() {
  const a = state.analysis;
  const s = state.settings;
  const calc = calculate(a, s);
  const set = (key, text) => { const el = results.querySelector(`[data-calc="${key}"]`); if (el) el.textContent = text; };
  const t = calc.total;
  set('total-hours', num(t.annualHours));
  set('total-hours-range', `Range ${num(t.lowAnnualHours)} to ${num(t.annualHours)}`);
  set('total-value', money(t.annualValue, s.currency));
  set('total-value-range', `Range ${money(t.lowAnnualValue, s.currency)} to ${money(t.annualValue, s.currency)}`);
  set('total-fte', fte(t.fte));
  set('fte-sub', `At ${num(s.hoursPerFte)} hours each`);
  set('total-share', pct(t.shareOfCurrent));
  set('share-sub', `Of ${num(t.currentAnnualHours)} hours a year`);

  const max = Math.max(1, ...calc.steps.map((x) => x.currentMonthly));
  for (const st of calc.steps) {
    set(`step-hours:${st.id}`, hours(st.currentMonthly));
    set(`step-hours-num:${st.id}`, num(st.currentMonthly));
    const now = results.querySelector(`[data-calc="bar-now:${st.id}"]`);
    const saved = results.querySelector(`[data-calc="bar-saved:${st.id}"]`);
    if (now) now.style.width = `${(st.currentMonthly / max) * 100}%`;
    if (saved) saved.style.width = `${(st.savedMonthly / max) * 100}%`;
    set(`bar-val:${st.id}`, st.savedMonthly > 0.05 ? `${num(st.currentMonthly)} h, saves ${num(st.savedMonthly)}` : `${num(st.currentMonthly)} h`);
  }
  for (const o of calc.opportunities) {
    set(`opp-hours:${o.id}`, `${num(o.annualHours)} h a year`);
    set(`opp-value:${o.id}`, `${money(o.annualValue, s.currency)} · ${fte(o.fte)} people`);
    set(`opp-rate:${o.id}`, `${num(o.hoursPerBuildWeek)} hours saved a year per build week`);
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
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  const md = () => toMarkdown(state.analysis, calculate(state.analysis, state.settings), state.settings, state.meta);
  const exportNote = $('#export-note');
  if (action === 'use-example') {
    descEl.value = SAMPLE_INPUT;
    descEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    descEl.focus({ preventScroll: true });
  } else if (action === 'copy-md') {
    try { await navigator.clipboard.writeText(md()); exportNote.textContent = 'Copied.'; } catch { download(`${slug()}.md`, md(), 'text/markdown'); exportNote.textContent = 'Copy was blocked, so the report was downloaded instead.'; }
  } else if (action === 'download-md') {
    download(`${slug()}.md`, md(), 'text/markdown');
  } else if (action === 'download-json') {
    download(`${slug()}.json`, JSON.stringify({ analysis: state.analysis, settings: state.settings, results: calculate(state.analysis, state.settings) }, null, 2), 'application/json');
  }
});

renderResults();
