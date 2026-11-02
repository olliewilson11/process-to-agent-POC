import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, combinedShareByStep, stepMonthlyHours } from '../src/savings.js';
import { normalise } from '../src/schema.js';
import { progressFrom } from '../src/analyse.js';
import { SAMPLE_ANALYSIS } from '../src/sample.js';

const settings = { hourlyCost: 30, hoursPerFte: 1650, adoption: 1, currency: '£' };
const step = (id, minutes, runs) => ({ id, minutes_per_run: minutes, runs_per_month: runs });
const opp = (id, impacts, extra = {}) => ({ id, step_impacts: impacts, deployment_plan: [{ weeks: 4 }], confidence: 'high', ...extra });

test('step hours are minutes times runs over sixty', () => {
  assert.equal(stepMonthlyHours(step('S1', 6, 1600)), 160);
});

test('a single opportunity saves its share of the step', () => {
  const r = calculate({ steps: [step('S1', 6, 100)], opportunities: [opp('O1', [{ step_id: 'S1', share: 0.5 }])] }, settings);
  assert.equal(r.total.savedMonthly, 5);
  assert.equal(r.total.annualHours, 60);
  assert.equal(r.total.annualValue, 1800);
});

test('overlapping opportunities combine rather than add', () => {
  const a = { steps: [step('S1', 60, 10)], opportunities: [opp('O1', [{ step_id: 'S1', share: 0.6 }]), opp('O2', [{ step_id: 'S1', share: 0.6 }])] };
  const combined = combinedShareByStep(a);
  assert.ok(Math.abs(combined.S1 - 0.84) < 1e-9);
  const r = calculate(a, settings);
  assert.ok(r.total.savedMonthly <= 10, 'cannot save more than the step takes');
  assert.ok(Math.abs(r.total.savedMonthly - 8.4) < 1e-9);
});

test('adoption scales the annual saving', () => {
  const a = { steps: [step('S1', 60, 10)], opportunities: [opp('O1', [{ step_id: 'S1', share: 0.5 }])] };
  assert.equal(calculate(a, { ...settings, adoption: 0.5 }).total.annualHours, 30);
});

test('low end of the range follows confidence', () => {
  const a = { steps: [step('S1', 60, 10)], opportunities: [opp('O1', [{ step_id: 'S1', share: 0.5 }], { confidence: 'low' })] };
  const r = calculate(a, settings);
  assert.equal(r.total.lowAnnualHours, r.total.annualHours * 0.35);
});

test('the worked example produces sensible totals', () => {
  const { analysis, warnings } = normalise(structuredClone(SAMPLE_ANALYSIS));
  assert.deepEqual(warnings, []);
  const r = calculate(analysis, { ...settings, adoption: 0.8 });
  assert.ok(r.total.annualHours > 2000 && r.total.annualHours < 4000, `got ${r.total.annualHours}`);
  assert.ok(r.total.shareOfCurrent < 0.6);
});

test('normalise caps shares, drops unknown steps and fills gaps', () => {
  const { analysis, warnings } = normalise({
    process_name: 'Test',
    steps: [{ id: 'S1', name: 'One', minutes_per_run: '5', runs_per_month: 10 }, { id: 'S1', name: 'Dup', minutes_per_run: 'abc' }],
    opportunities: [
      { id: 'O1', title: 'A', step_impacts: [{ step_id: 'S1', share: 1.4 }, { step_id: 'S9', share: 0.5 }], deployment_plan: [{ phase: 'Nope', action: 'Do it', weeks: 99 }] },
      { id: 'O2', title: 'B', step_impacts: [{ step_id: 'S7', share: 0.3 }] }
    ]
  });
  assert.equal(analysis.steps.length, 2);
  assert.equal(analysis.steps[1].id, 'S2', 'duplicate id is renamed');
  assert.equal(analysis.steps[0].minutes_per_run, 5);
  assert.equal(analysis.steps[1].minutes_per_run, 0);
  assert.equal(analysis.opportunities.length, 1, 'opportunity with no valid steps is dropped');
  assert.equal(analysis.opportunities[0].step_impacts[0].share, 0.9);
  assert.equal(analysis.opportunities[0].deployment_plan[0].phase, 'Build');
  assert.equal(analysis.opportunities[0].deployment_plan[0].weeks, 52);
  assert.ok(warnings.length >= 3);
});

test('normalise rejects an analysis with no steps', () => {
  assert.throws(() => normalise({ steps: [] }), /did not find any process steps/);
});

test('progress is read from partial streamed JSON', () => {
  const p = progressFrom('{"process_name":"x","steps":[{"minutes_per_run":3},{"minutes_per_run":4}],"opportunities":[{"what_the_agent_does":"y"');
  assert.equal(p.steps, 2);
  assert.equal(p.opportunities, 1);
  assert.equal(p.stage, 'Designing agent solutions');
});
