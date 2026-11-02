# Process to Agents

Describe a business process or upload its documents. The tool maps the process, proposes AI agents with practical deployment plans and estimates the time they would save. Every figure can be adjusted.

**Live:** https://olliewilson11.github.io/process-to-agent-POC/

It opens on a worked example for a fictional company, so you can see the output without an API key. To analyse your own process, add an Anthropic API key. The key goes straight from your browser to Anthropic and nowhere else.

## What you get

- **A process map** of the steps as they run today, who does them and how well each suits an agent
- **Agent opportunities**, each with what the agent does, what people still decide, integrations, data needed, risks and a phased deployment plan
- **An upside estimate** in hours, value and equivalent people, with a range based on confidence
- **Questions to validate** with the process owner before building
- **Exports** as a Markdown report or as JSON

## How it works

1. **Ingest.** Files are read in the browser. PDFs and images go to Claude as they are. Word and Excel files are converted to text first.
2. **Analyse.** Claude returns the analysis through a forced tool call with a strict JSON schema, so the structure is always the same. Timings it had to estimate are flagged with their basis, and each step quotes its evidence from the source.
3. **Validate.** Model output is treated as untrusted. Numbers are coerced and clamped, references to unknown steps are dropped and every fix is shown to the user.
4. **Calculate.** Savings are worked out in code from the step timings, never by the model. When two agents touch the same step their shares combine, so a step can never save more than its own time.
5. **Adjust.** Every timing, share and assumption is editable and the totals update straight away.

Opportunities are ranked by hours saved a year per week of build effort, so quick wins come first.

## Project layout

```
index.html          Page and styles
src/app.js          Interface and rendering
src/analyse.js      Prompt and streaming call to the Claude Messages API
src/schema.js       Output schema and validation
src/savings.js      Savings calculation
src/ingest.js       File reading
src/report.js       Markdown export
src/sample.js       Worked example
tests/              Unit tests for the calculation and validation
```

## Run it locally

No build step. Serve the folder with any static server, for example `python3 -m http.server`, then open `http://localhost:8000`.

Run the tests with `npm test` (Node 20 or later).

## Notes

Estimates are a starting point for discovery, not a business case. Built by Ollie Wilson as an illustration of how I scope AI deployments. It contains no client or employer code or data.
