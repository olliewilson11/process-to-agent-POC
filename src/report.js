// Builds a Markdown version of the analysis for pasting into a document or email.

import { hours, money, fte, pct, num } from './format.js';

const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');

export function toMarkdown(analysis, calc, settings, meta = {}) {
  const c = settings.currency;
  const t = calc.total;
  const stepsById = Object.fromEntries(analysis.steps.map((s) => [s.id, s]));
  const oppCalc = Object.fromEntries(calc.opportunities.map((o) => [o.id, o]));
  const ranked = [...analysis.opportunities].sort((a, b) => oppCalc[b.id].hoursPerBuildWeek - oppCalc[a.id].hoursPerBuildWeek);
  const out = [];

  out.push(`# ${analysis.process_name}`, '', analysis.summary, '');
  out.push('## Estimated upside', '');
  out.push(`- **Hours saved a year:** ${num(t.lowAnnualHours)} to ${num(t.annualHours)}`);
  out.push(`- **Value a year:** ${money(t.lowAnnualValue, c)} to ${money(t.annualValue, c)}`);
  out.push(`- **Equivalent people:** ${fte(t.fte)}`);
  out.push(`- **Share of current effort:** ${pct(t.shareOfCurrent)} of ${num(t.currentAnnualHours)} hours a year`, '');
  out.push(`Assumptions: ${c}${settings.hourlyCost} an hour fully loaded, ${num(settings.hoursPerFte)} productive hours per person a year, ${pct(settings.adoption)} adoption. The low end of each range reflects the confidence in each opportunity.`, '');

  out.push('## The process today', '');
  out.push('| Step | Who | Minutes per run | Runs per month | Hours per month | Agent fit |');
  out.push('| --- | --- | ---: | ---: | ---: | --- |');
  for (const s of analysis.steps) {
    out.push(`| ${s.id} ${cell(s.name)} | ${cell(s.actor)} | ${s.minutes_per_run}${s.estimated ? ' (est.)' : ''} | ${num(s.runs_per_month)} | ${num(s.minutes_per_run * s.runs_per_month / 60)} | ${s.automation_fit} |`);
  }
  out.push('');

  out.push('## Agent opportunities', '', 'Ranked by hours saved per week of build effort.', '');
  ranked.forEach((o, i) => {
    const oc = oppCalc[o.id];
    out.push(`### ${i + 1}. ${o.title}`, '');
    out.push(`${o.pattern} · effort ${o.effort} · confidence ${o.confidence} · ${hours(oc.annualHours)} a year (${money(oc.annualValue, c)}) · ${oc.weeks} weeks to roll out`, '');
    out.push(o.what_the_agent_does, '');
    if (o.human_in_the_loop) out.push(`**People still:** ${o.human_in_the_loop}`, '');
    out.push('**Steps affected**', '');
    for (const imp of o.step_impacts) {
      const s = stepsById[imp.step_id];
      out.push(`- ${imp.step_id} ${s?.name ?? ''}: removes ${pct(imp.share)} of the time${imp.rationale ? `. ${imp.rationale}` : ''}`);
    }
    out.push('');
    if (o.integrations.length) out.push('**Integrations**', '', ...o.integrations.map((x) => `- ${x}`), '');
    if (o.data_needed.length) out.push('**Data needed**', '', ...o.data_needed.map((x) => `- ${x}`), '');
    if (o.risks.length) out.push('**Risks**', '', ...o.risks.map((x) => `- ${x}`), '');
    if (o.deployment_plan.length) {
      out.push('**Deployment plan**', '');
      o.deployment_plan.forEach((p, k) => out.push(`${k + 1}. **${p.phase}** (${p.weeks} wk): ${p.action}`));
      out.push('');
    }
  });

  if (analysis.validation_questions.length) {
    out.push('## Questions to validate', '', ...analysis.validation_questions.map((q) => `- ${q}`), '');
  }
  out.push('---', '', `Generated with Process to Agents${meta.model ? ` using ${meta.model}` : ''}. Estimates are a starting point for discovery, not a business case.`);
  return out.join('\n');
}
