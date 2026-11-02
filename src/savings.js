// Savings are calculated here, in code, from the figures in the analysis.
// The model supplies step timings and the share of each step an agent would remove.
// It never does the arithmetic.

export const DEFAULT_SETTINGS = {
  hourlyCost: 30,      // fully loaded cost per hour
  hoursPerFte: 1650,   // productive hours per person per year
  adoption: 0.8,       // share of the modelled saving realised in practice
  currency: '£'
};

// Low end of the range, as a fraction of the modelled saving, by confidence.
export const CONFIDENCE_FLOOR = { high: 0.85, medium: 0.6, low: 0.35 };

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function stepMonthlyHours(step) {
  return (step.minutes_per_run * step.runs_per_month) / 60;
}

export function opportunityMonthlyHours(opp, stepsById) {
  return opp.step_impacts.reduce((sum, imp) => {
    const step = stepsById[imp.step_id];
    return step ? sum + stepMonthlyHours(step) * clamp(imp.share, 0, 1) : sum;
  }, 0);
}

// When two opportunities touch the same step, their shares combine
// rather than add, so a step can never save more than its own time.
export function combinedShareByStep(analysis) {
  const remaining = {};
  for (const opp of analysis.opportunities) {
    for (const imp of opp.step_impacts) {
      remaining[imp.step_id] = (remaining[imp.step_id] ?? 1) * (1 - clamp(imp.share, 0, 1));
    }
  }
  const combined = {};
  for (const id of Object.keys(remaining)) combined[id] = 1 - remaining[id];
  return combined;
}

export function buildWeeks(opp) {
  return opp.deployment_plan.reduce((sum, p) => sum + p.weeks, 0);
}

export function calculate(analysis, settings = DEFAULT_SETTINGS) {
  const stepsById = Object.fromEntries(analysis.steps.map((s) => [s.id, s]));
  const combined = combinedShareByStep(analysis);
  const yearly = (monthly) => monthly * 12 * settings.adoption;

  const steps = analysis.steps.map((s) => {
    const current = stepMonthlyHours(s);
    const saved = current * (combined[s.id] ?? 0);
    return { id: s.id, currentMonthly: current, savedMonthly: saved };
  });

  const opportunities = analysis.opportunities.map((o) => {
    const monthly = opportunityMonthlyHours(o, stepsById);
    const annualHours = yearly(monthly);
    const weeks = buildWeeks(o);
    return {
      id: o.id,
      monthly,
      annualHours,
      annualValue: annualHours * settings.hourlyCost,
      fte: annualHours / settings.hoursPerFte,
      weeks,
      hoursPerBuildWeek: weeks > 0 ? annualHours / weeks : annualHours,
      lowAnnualHours: annualHours * (CONFIDENCE_FLOOR[o.confidence] ?? CONFIDENCE_FLOOR.medium),
      impacts: o.step_impacts.map((imp) => {
        const step = stepsById[imp.step_id];
        const current = step ? stepMonthlyHours(step) : 0;
        return { step_id: imp.step_id, currentMonthly: current, savedMonthly: current * clamp(imp.share, 0, 1) };
      })
    };
  });

  const currentMonthly = steps.reduce((a, s) => a + s.currentMonthly, 0);
  const savedMonthly = steps.reduce((a, s) => a + s.savedMonthly, 0);
  const annualHours = yearly(savedMonthly);

  // Scale the low end by each opportunity's confidence, weighted by its standalone saving.
  const standalone = opportunities.reduce((a, o) => a + o.annualHours, 0);
  const standaloneLow = opportunities.reduce((a, o) => a + o.lowAnnualHours, 0);
  const lowFactor = standalone > 0 ? standaloneLow / standalone : 1;

  return {
    steps,
    opportunities,
    total: {
      currentAnnualHours: currentMonthly * 12,
      currentMonthly,
      savedMonthly,
      annualHours,
      lowAnnualHours: annualHours * lowFactor,
      annualValue: annualHours * settings.hourlyCost,
      lowAnnualValue: annualHours * lowFactor * settings.hourlyCost,
      fte: annualHours / settings.hoursPerFte,
      shareOfCurrent: currentMonthly > 0 ? savedMonthly * settings.adoption / currentMonthly : 0
    }
  };
}
