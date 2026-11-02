// The structure Claude must return, and the checks applied before anything is shown.

export const PATTERNS = [
  'Document extraction',
  'Classification and routing',
  'Drafting and communication',
  'Reconciliation and matching',
  'Research and summarisation',
  'Monitoring and alerting',
  'Workflow orchestration'
];
export const PHASES = ['Discover', 'Build', 'Evaluate', 'Pilot', 'Roll out'];
const FITS = ['high', 'medium', 'low'];
const EFFORTS = ['S', 'M', 'L'];
const MAX_SHARE = 0.9;

const str = { type: 'string' };
const strList = { type: 'array', items: str };

export const ANALYSIS_TOOL = {
  name: 'submit_process_analysis',
  description: 'Submit the structured analysis of the business process.',
  input_schema: {
    type: 'object',
    required: ['process_name', 'summary', 'steps', 'opportunities', 'validation_questions'],
    properties: {
      process_name: { type: 'string', description: 'Short name for the process, for example "Supplier invoice processing".' },
      summary: { type: 'string', description: 'Two or three sentences: what the process does, who runs it and where the time goes.' },
      steps: {
        type: 'array',
        description: 'The process as it runs today, in order.',
        items: {
          type: 'object',
          required: ['id', 'name', 'actor', 'description', 'minutes_per_run', 'runs_per_month', 'estimated', 'automation_fit', 'fit_reason'],
          properties: {
            id: { type: 'string', description: 'S1, S2 and so on, in process order.' },
            name: str,
            actor: { type: 'string', description: 'The role that does the step.' },
            description: str,
            systems: strList,
            minutes_per_run: { type: 'number', description: 'Hands-on minutes each time the step runs.' },
            runs_per_month: { type: 'number' },
            estimated: { type: 'boolean', description: 'True if either figure was not stated in the source.' },
            basis: { type: 'string', description: 'If estimated, how the figure was estimated, in a few words.' },
            source_quote: { type: 'string', description: 'A short verbatim quote from the input that evidences this step. Empty if none.' },
            pain_points: strList,
            automation_fit: { type: 'string', enum: FITS },
            fit_reason: str
          }
        }
      },
      opportunities: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'title', 'pattern', 'what_the_agent_does', 'human_in_the_loop', 'step_impacts', 'integrations', 'risks', 'deployment_plan', 'effort', 'confidence'],
          properties: {
            id: { type: 'string', description: 'O1, O2 and so on.' },
            title: str,
            pattern: { type: 'string', enum: PATTERNS },
            what_the_agent_does: str,
            human_in_the_loop: { type: 'string', description: 'What people still decide or check, and why.' },
            step_impacts: {
              type: 'array',
              items: {
                type: 'object',
                required: ['step_id', 'share'],
                properties: {
                  step_id: str,
                  share: { type: 'number', description: `Fraction of the step's current hands-on time removed at steady state, net of review time. 0 to ${MAX_SHARE}.` },
                  rationale: str
                }
              }
            },
            integrations: strList,
            data_needed: strList,
            risks: strList,
            deployment_plan: {
              type: 'array',
              items: {
                type: 'object',
                required: ['phase', 'action', 'weeks'],
                properties: { phase: { type: 'string', enum: PHASES }, action: str, weeks: { type: 'number' } }
              }
            },
            effort: { type: 'string', enum: EFFORTS, description: 'S is under six weeks, M is six to twelve, L is longer.' },
            confidence: { type: 'string', enum: FITS }
          }
        }
      },
      validation_questions: { ...strList, description: 'Questions to put to the process owner to test the assumptions.' }
    }
  }
};

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const list = (v) => (Array.isArray(v) ? v.map(text).filter(Boolean) : []);
const num = (v, lo, hi, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

// Model output is treated as untrusted: coerce types, clamp numbers,
// drop references to steps that don't exist and record what was fixed.
export function normalise(raw) {
  const warnings = [];
  if (!raw || typeof raw !== 'object') throw new Error('The model returned no analysis.');

  const seen = new Set();
  const idMap = {};
  const steps = (Array.isArray(raw.steps) ? raw.steps : []).map((s, i) => {
    let id = text(s?.id) || `S${i + 1}`;
    if (seen.has(id)) id = `S${i + 1}`;
    seen.add(id);
    if (s?.id) idMap[text(s.id)] = id;
    const minutes = num(s?.minutes_per_run, 0, 24 * 60);
    const runs = num(s?.runs_per_month, 0, 1e6);
    if (!Number.isFinite(Number(s?.minutes_per_run)) || !Number.isFinite(Number(s?.runs_per_month))) {
      warnings.push(`Step ${id} had a missing figure, set to 0. Edit it below.`);
    }
    return {
      id,
      name: text(s?.name) || `Step ${i + 1}`,
      actor: text(s?.actor) || 'Unassigned',
      description: text(s?.description),
      systems: list(s?.systems),
      minutes_per_run: minutes,
      runs_per_month: runs,
      estimated: Boolean(s?.estimated),
      basis: text(s?.basis),
      source_quote: text(s?.source_quote),
      pain_points: list(s?.pain_points),
      automation_fit: pick(s?.automation_fit, FITS, 'medium'),
      fit_reason: text(s?.fit_reason)
    };
  });
  if (!steps.length) throw new Error('The model did not find any process steps. Add more detail and try again.');
  const stepIds = new Set(steps.map((s) => s.id));

  const opportunities = [];
  (Array.isArray(raw.opportunities) ? raw.opportunities : []).forEach((o, i) => {
    const impacts = (Array.isArray(o?.step_impacts) ? o.step_impacts : [])
      .map((imp) => ({ step_id: idMap[text(imp?.step_id)] ?? text(imp?.step_id), share: Number(imp?.share), rationale: text(imp?.rationale) }))
      .filter((imp) => {
        if (!stepIds.has(imp.step_id)) { warnings.push(`An opportunity referred to an unknown step (${imp.step_id || 'blank'}), so it was ignored.`); return false; }
        return true;
      })
      .map((imp) => {
        if (!Number.isFinite(imp.share) || imp.share < 0 || imp.share > MAX_SHARE) {
          warnings.push(`A share of ${imp.share} on ${imp.step_id} was capped to the range 0 to ${MAX_SHARE * 100}%.`);
        }
        return { ...imp, share: num(imp.share, 0, MAX_SHARE) };
      });
    if (!impacts.length) return;
    opportunities.push({
      id: text(o?.id) || `O${i + 1}`,
      title: text(o?.title) || `Opportunity ${i + 1}`,
      pattern: pick(o?.pattern, PATTERNS, 'Workflow orchestration'),
      what_the_agent_does: text(o?.what_the_agent_does),
      human_in_the_loop: text(o?.human_in_the_loop),
      step_impacts: impacts,
      integrations: list(o?.integrations),
      data_needed: list(o?.data_needed),
      risks: list(o?.risks),
      deployment_plan: (Array.isArray(o?.deployment_plan) ? o.deployment_plan : [])
        .map((p) => ({ phase: pick(p?.phase, PHASES, 'Build'), action: text(p?.action), weeks: num(p?.weeks, 0, 52) }))
        .filter((p) => p.action),
      effort: pick(o?.effort, EFFORTS, 'M'),
      confidence: pick(o?.confidence, FITS, 'medium')
    });
  });

  return {
    analysis: {
      process_name: text(raw.process_name) || 'Untitled process',
      summary: text(raw.summary),
      steps,
      opportunities,
      validation_questions: list(raw.validation_questions)
    },
    warnings: [...new Set(warnings)]
  };
}
