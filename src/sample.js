// A worked example so the tool shows its output before anyone adds a key.
// Harbourside Distribution is fictional.

export const SAMPLE_INPUT = `Harbourside Distribution is a PE-backed wholesale distributor. Our accounts payable team is three people and handles about 1,600 supplier invoices a month. The team is stretched and month-end overtime is common.

Invoices arrive in the shared ap@ mailbox, mostly as PDF attachments, some as phone photos or scanned paper. A clerk opens each email, saves the PDF and keys the header and line details into Sage Intacct. That takes about 6 minutes an invoice.

Around 80% of invoices have a purchase order. For those, the clerk matches the invoice to the PO and the goods received note in Sage. Price or quantity mismatches affect about 15% of PO invoices. They get emailed to the buyer, who replies when they can, and chasing takes around 20 minutes per exception.

Non-PO invoices go to the budget holder for approval by email. We chase approvals weekly, roughly 10 minutes each.

Approved invoices go into the twice-weekly payment run, which the AP lead prepares in Sage and releases in the banking portal.

Suppliers email or phone about payment status around 300 times a month, about 8 minutes each.

At month end we reconcile statements for our top 60 suppliers, about 45 minutes each. Duplicate invoices slip through a few times a quarter.`;

export const SAMPLE_ANALYSIS = {
  process_name: 'Supplier invoice processing',
  summary: 'A three-person accounts payable team receives, keys, matches, approves and pays about 1,600 supplier invoices a month in Sage Intacct. Most of the time goes on manual data entry, chasing price and quantity mismatches with buyers, and chasing approvals for invoices without a purchase order.',
  steps: [
    {
      id: 'S1', name: 'Receive and log invoices', actor: 'AP clerk', systems: ['Shared ap@ mailbox'],
      description: 'Open each email in the shared mailbox and save the invoice attachment.',
      minutes_per_run: 1.5, runs_per_month: 1600, estimated: true, basis: 'Minutes not stated. Typical for opening an email and saving one attachment.',
      source_quote: 'A clerk opens each email, saves the PDF', pain_points: ['Mixed formats including phone photos and scanned paper'],
      automation_fit: 'high', fit_reason: 'Repetitive, rule-based and fully digital once the email arrives.'
    },
    {
      id: 'S2', name: 'Key invoice into Sage Intacct', actor: 'AP clerk', systems: ['Sage Intacct'],
      description: 'Type the invoice header and line details into the ERP.',
      minutes_per_run: 6, runs_per_month: 1600, estimated: false, basis: '',
      source_quote: 'keys the header and line details into Sage Intacct. That takes about 6 minutes an invoice',
      pain_points: ['Largest single block of time', 'Duplicates slip through a few times a quarter'],
      automation_fit: 'high', fit_reason: 'Structured extraction from documents is a strong fit for current models with a confidence check.'
    },
    {
      id: 'S3', name: 'Match PO invoices to PO and GRN', actor: 'AP clerk', systems: ['Sage Intacct'],
      description: 'Check each PO invoice against its purchase order and goods received note.',
      minutes_per_run: 2, runs_per_month: 1280, estimated: true, basis: 'Minutes not stated. 80% of 1,600 invoices have a PO.',
      source_quote: 'the clerk matches the invoice to the PO and the goods received note in Sage', pain_points: [],
      automation_fit: 'high', fit_reason: 'Matching within agreed tolerances is rule-based.'
    },
    {
      id: 'S4', name: 'Resolve match exceptions with buyers', actor: 'AP clerk and buyer', systems: ['Email', 'Sage Intacct'],
      description: 'Email the buyer about each price or quantity mismatch and chase until resolved.',
      minutes_per_run: 20, runs_per_month: 192, estimated: false, basis: '',
      source_quote: 'chasing takes around 20 minutes per exception', pain_points: ['Buyers reply when they can', 'Exceptions delay payment'],
      automation_fit: 'medium', fit_reason: 'Drafting and chasing can be automated. Deciding on the variance needs the buyer.'
    },
    {
      id: 'S5', name: 'Get approval for non-PO invoices', actor: 'AP clerk and budget holder', systems: ['Email'],
      description: 'Send non-PO invoices to the budget holder and chase approval weekly.',
      minutes_per_run: 10, runs_per_month: 320, estimated: false, basis: '',
      source_quote: 'We chase approvals weekly, roughly 10 minutes each', pain_points: ['Approvals sit in inboxes'],
      automation_fit: 'medium', fit_reason: 'Routing and chasing are mechanical. The approval decision stays with the budget holder.'
    },
    {
      id: 'S6', name: 'Prepare and release payment runs', actor: 'AP lead', systems: ['Sage Intacct', 'Banking portal'],
      description: 'Build the twice-weekly payment run in Sage and release it in the banking portal.',
      minutes_per_run: 60, runs_per_month: 9, estimated: true, basis: 'Minutes not stated. Twice weekly is about nine runs a month.',
      source_quote: 'the twice-weekly payment run, which the AP lead prepares in Sage and releases in the banking portal', pain_points: [],
      automation_fit: 'low', fit_reason: 'A key financial control with little time to save. Keep it with people.'
    },
    {
      id: 'S7', name: 'Answer supplier payment queries', actor: 'AP clerk', systems: ['Email', 'Phone', 'Sage Intacct'],
      description: 'Look up invoice status and tell suppliers when they will be paid.',
      minutes_per_run: 8, runs_per_month: 300, estimated: false, basis: '',
      source_quote: 'Suppliers email or phone about payment status around 300 times a month, about 8 minutes each', pain_points: ['Interrupts other work'],
      automation_fit: 'high', fit_reason: 'Most email queries are a status lookup and a templated reply.'
    },
    {
      id: 'S8', name: 'Reconcile supplier statements', actor: 'AP lead', systems: ['Sage Intacct'],
      description: 'Reconcile month-end statements for the top 60 suppliers against the ledger.',
      minutes_per_run: 45, runs_per_month: 60, estimated: false, basis: '',
      source_quote: 'we reconcile statements for our top 60 suppliers, about 45 minutes each', pain_points: ['Drives month-end overtime'],
      automation_fit: 'high', fit_reason: 'Line-by-line matching with a short list of differences for a person to review.'
    }
  ],
  opportunities: [
    {
      id: 'O1', title: 'Invoice capture and entry agent', pattern: 'Document extraction',
      what_the_agent_does: 'Watches the ap@ mailbox, reads each invoice whether PDF, scan or photo, extracts header and line data, checks for duplicates against open and paid invoices, and posts a draft bill to Sage Intacct for one-click confirmation.',
      human_in_the_loop: 'Clerks confirm drafts below a confidence threshold and every invoice from a new supplier.',
      step_impacts: [
        { step_id: 'S1', share: 0.85, rationale: 'Logging becomes automatic. Clerks only handle unreadable attachments.' },
        { step_id: 'S2', share: 0.75, rationale: 'Most entry becomes a review of a pre-filled draft.' }
      ],
      integrations: ['Microsoft 365 mailbox through the Graph API', 'Sage Intacct API for draft bills and the supplier list'],
      data_needed: ['300 posted invoices with their ERP entries, for a test set', 'Supplier master data'],
      risks: ['Poor-quality phone photos', 'Line coding on invoices split across cost centres'],
      deployment_plan: [
        { phase: 'Discover', action: 'Pull 300 posted invoices as a labelled test set. Agree the field list and accuracy targets of 98% on headers and 95% on lines.', weeks: 1 },
        { phase: 'Build', action: 'Mailbox listener, extraction with confidence scores, duplicate check and draft-bill push to a Sage sandbox.', weeks: 3 },
        { phase: 'Evaluate', action: 'Run against the test set and tune until targets are met. Set the confidence threshold for one-click confirmation.', weeks: 1 },
        { phase: 'Pilot', action: 'Go live for the top 20 suppliers with a clerk checking every draft. Track corrections.', weeks: 2 },
        { phase: 'Roll out', action: 'Extend to all suppliers. Clerks review low-confidence drafts only. Weekly accuracy report to the AP lead.', weeks: 2 }
      ],
      effort: 'M', confidence: 'high'
    },
    {
      id: 'O2', title: 'Three-way match and exception agent', pattern: 'Reconciliation and matching',
      what_the_agent_does: 'Matches each PO invoice to its purchase order and goods received note, clears those within tolerance, and for mismatches drafts a specific query to the buyer with the variance and documents attached. It chases on a schedule and logs the reply.',
      human_in_the_loop: 'Buyers decide every price or quantity variance. The finance controller approves the tolerance rules.',
      step_impacts: [
        { step_id: 'S3', share: 0.8, rationale: 'Clean matches clear without a clerk.' },
        { step_id: 'S4', share: 0.5, rationale: 'Drafting and chasing go. The buyer conversation stays.' }
      ],
      integrations: ['Sage Intacct API for POs and goods received notes', 'Email or Microsoft Teams for buyer queries'],
      data_needed: ['Six months of match exceptions and how each was resolved', 'Agreed price and quantity tolerances'],
      risks: ['Tolerances set too loosely', 'Goods received notes recorded late, causing false mismatches'],
      deployment_plan: [
        { phase: 'Discover', action: 'Agree tolerance rules with the finance controller. Extract six months of exceptions and their outcomes.', weeks: 1 },
        { phase: 'Build', action: 'Matching rules plus an agent that drafts buyer queries and tracks replies.', weeks: 3 },
        { phase: 'Evaluate', action: 'Replay six months of invoices and compare decisions with what clerks did.', weeks: 1 },
        { phase: 'Pilot', action: 'Run for one warehouse with clerks approving each buyer query before it is sent.', weeks: 3 },
        { phase: 'Roll out', action: 'All sites. Queries send automatically. Weekly exception ageing report.', weeks: 2 }
      ],
      effort: 'M', confidence: 'medium'
    },
    {
      id: 'O3', title: 'Approval routing and chasing agent', pattern: 'Workflow orchestration',
      what_the_agent_does: 'Routes each non-PO invoice to the right budget holder using the cost-centre map, sends an approval request in Teams with a one-line summary, chases on a schedule and escalates after five working days.',
      human_in_the_loop: 'Budget holders make every approval decision.',
      step_impacts: [{ step_id: 'S5', share: 0.6, rationale: 'Routing and chasing are automatic. Clerks handle escalations.' }],
      integrations: ['Microsoft Teams approvals', 'Sage Intacct API to record the decision'],
      data_needed: ['Cost-centre to budget-holder map', 'Delegated authority limits'],
      risks: ['An out-of-date cost-centre map sends requests to the wrong person'],
      deployment_plan: [
        { phase: 'Discover', action: 'Confirm the cost-centre map and approval limits with finance.', weeks: 1 },
        { phase: 'Build', action: 'Routing logic, Teams approval cards, chasing and escalation rules.', weeks: 2 },
        { phase: 'Evaluate', action: 'Check routing against three months of past approvals.', weeks: 1 },
        { phase: 'Pilot', action: 'Two departments for two weeks.', weeks: 1 },
        { phase: 'Roll out', action: 'All departments, with a monthly report of approval times.', weeks: 1 }
      ],
      effort: 'S', confidence: 'high'
    },
    {
      id: 'O4', title: 'Supplier statement reconciliation agent', pattern: 'Reconciliation and matching',
      what_the_agent_does: 'Reads each supplier statement, reconciles it line by line against the ledger and lists only the differences, with the likely cause such as a missing invoice, an unapplied credit or timing.',
      human_in_the_loop: 'The AP lead reviews the differences and decides what to post.',
      step_impacts: [{ step_id: 'S8', share: 0.7, rationale: 'Matching is automatic. Review of differences stays.' }],
      integrations: ['Sage Intacct API for open items', 'Statement PDFs from the mailbox'],
      data_needed: ['Last three months of statements and completed reconciliations'],
      risks: ['Statements in unusual layouts from smaller suppliers'],
      deployment_plan: [
        { phase: 'Discover', action: 'Collect three months of statements and the finished reconciliations.', weeks: 1 },
        { phase: 'Build', action: 'Statement reading, ledger matching and a differences report.', weeks: 2 },
        { phase: 'Evaluate', action: 'Compare with the finished reconciliations. Target every real difference found.', weeks: 1 },
        { phase: 'Pilot', action: 'Run alongside the manual process for one month end.', weeks: 1 },
        { phase: 'Roll out', action: 'Replace the manual process for all 60 suppliers.', weeks: 1 }
      ],
      effort: 'S', confidence: 'high'
    },
    {
      id: 'O5', title: 'Supplier query assistant', pattern: 'Drafting and communication',
      what_the_agent_does: 'Reads payment status emails, looks up the invoice and the next payment run, and drafts a reply. Clerks approve drafts at first. Routine status replies then send automatically.',
      human_in_the_loop: 'Clerks handle disputes and anything off-script. Phone calls stay with people.',
      step_impacts: [{ step_id: 'S7', share: 0.6, rationale: 'Most email queries are status lookups. Phone share is unknown.' }],
      integrations: ['Shared mailbox through the Graph API', 'Sage Intacct API for invoice and payment status'],
      data_needed: ['A month of past supplier queries and replies'],
      risks: ['Replying with a payment date that later slips'],
      deployment_plan: [
        { phase: 'Discover', action: 'Sort a month of queries by type and measure the email versus phone split.', weeks: 1 },
        { phase: 'Build', action: 'Query classifier, status lookup and reply drafting.', weeks: 2 },
        { phase: 'Evaluate', action: 'Check drafts against 100 past replies for accuracy and tone.', weeks: 1 },
        { phase: 'Pilot', action: 'Clerk approves every draft for two weeks.', weeks: 2 },
        { phase: 'Roll out', action: 'Auto-send routine status replies. Everything else stays as a draft.', weeks: 1 }
      ],
      effort: 'S', confidence: 'medium'
    }
  ],
  validation_questions: [
    'What share of invoices arrive as clean PDFs rather than scans or photos?',
    'How are invoices coded to cost centres today, and how often is the coding corrected later?',
    'What price and quantity tolerances would the finance controller accept for automatic clearing?',
    'Is API access enabled on your Sage Intacct licence, and who owns integrations?',
    'How many supplier queries come by phone rather than email?',
    'Who has to approve changes to the AP process under your controls framework?'
  ]
};
