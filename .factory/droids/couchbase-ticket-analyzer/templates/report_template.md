# Ticket Analysis Report: {{TICKET_NUMBER}}

**Analysis Date**: {{ANALYSIS_TIMESTAMP}}  
**Agent Version**: {{AGENT_VERSION}}  
**Analyst**: Automated (couchbase-ticket-analyzer)

---

## Executive Summary

| Attribute | Value |
|-----------|-------|
| **Issue** | {{ISSUE_SUMMARY}} |
| **Component** | {{COMPONENT}} |
| **Root Cause** | {{ROOT_CAUSE_SUMMARY}} |
| **Confidence** | {{CONFIDENCE_LEVEL}} |
| **Severity** | {{SEVERITY}} |

### Quick Recommendations
{{QUICK_ACTIONS_LIST}}

---

## Ticket Overview

### Customer Report
- **Ticket Number**: {{TICKET_NUMBER}}
- **Subject**: {{TICKET_SUBJECT}}
- **Customer Description**: 
  > {{CUSTOMER_DESCRIPTION}}

- **Issue Timestamp**: {{ISSUE_TIMESTAMP}}
- **Time Zone**: {{TIMEZONE}}

### Environment
- **Couchbase Version**: {{CB_VERSION}}
- **Cluster Configuration**:
  - Total Nodes: {{CLUSTER_SIZE}}
  - Affected Nodes: {{AFFECTED_NODES}}
  - Cluster Topology: {{TOPOLOGY}}
- **Snapshots Available**: {{SNAPSHOT_COUNT}}
- **Data Size**: {{DATA_SIZE}}

### Key Symptoms
{{SYMPTOMS_LIST}}

---

## Analysis Process

### Documentation Research

This section documents all external sources consulted during analysis.

#### Couchbase Official Documentation
{{#each DOCS_REFERENCES}}
- **[{{this.title}}]({{this.url}})**
  - Relevance: {{this.relevance}}
  - Key Finding: {{this.key_finding}}
{{/each}}

#### Bug Tracker (MB Issues)
{{#each MB_REFERENCES}}
- **[MB-{{this.number}}]({{this.url}})** - {{this.title}}
  - Status: {{this.status}}
  - Affects Version: {{this.affects_version}}
  - Fix Version: {{this.fix_version}}
  - Relevance: {{this.relevance}}
{{/each}}

#### Knowledge Base Articles
{{#each KB_REFERENCES}}
- **[{{this.title}}]({{this.url}})**
  - Summary: {{this.summary}}
{{/each}}

### Initial Classification

**Component Identification Process**:
1. Keywords from ticket: {{KEYWORDS_FOUND}}
2. Mapped to component: {{COMPONENT}}
3. Target log files: {{TARGET_LOGS}}

**Reasoning**: {{CLASSIFICATION_REASONING}}

---

## Log Analysis

### Timeline Reconstruction

Visual timeline of events leading to and following the issue:

```
{{ISSUE_TIMESTAMP_MINUS_5M}} | [Baseline]
    |
    | ... normal operation ...
    |
{{TRIGGER_TIMESTAMP}}        | [TRIGGER] {{TRIGGER_EVENT}}
    |
    | ↓
    |
{{CASCADE_1_TIMESTAMP}}      | [Effect 1] {{CASCADE_1_EVENT}}
    |
    | ↓
    |
{{CASCADE_2_TIMESTAMP}}      | [Effect 2] {{CASCADE_2_EVENT}}
    |
    | ... incident continues ...
    |
{{RESOLUTION_TIMESTAMP}}     | [Resolution/Current]
```

---

### Component Analysis

{{#each LOG_ANALYSES}}

#### {{this.component}} - {{this.log_file}}

**Node**: {{this.node}}  
**File Path**: `{{this.file_path}}`  
**Search Pattern**: `{{this.search_pattern}}`  
**Time Window**: {{this.time_start}} to {{this.time_end}}

##### Search Commands Used
```bash
{{this.search_commands}}
```

##### Key Findings

**Occurrences**: {{this.occurrence_count}} instances in {{this.time_window_duration}}

**Pattern**: {{this.pattern_description}}

##### Log Excerpts

```
{{this.log_excerpt}}
```

##### Analysis

{{this.analysis_text}}

**Significance**: {{this.significance}}

---

{{/each}}

### Cross-Node Comparison

{{#if MULTI_NODE}}

Comparing patterns across nodes to identify cluster-wide vs node-specific issues:

| Node | Error Count | First Occurrence | Pattern |
|------|-------------|------------------|---------|
{{#each NODE_COMPARISON}}
| {{this.node}} | {{this.count}} | {{this.first_time}} | {{this.pattern}} |
{{/each}}

**Conclusion**: {{CROSS_NODE_CONCLUSION}}

{{else}}

Single-node issue analysis (only one node affected or single-node cluster).

{{/if}}

### Cross-Component Correlation

Examining relationships between errors across different components:

{{#each COMPONENT_CORRELATIONS}}

**{{this.component_a}} → {{this.component_b}}**

- Time lag: {{this.time_lag}}
- Relationship: {{this.relationship_type}}
- Evidence: {{this.evidence}}

{{/each}}

**Overall cascade pattern**: {{CASCADE_SUMMARY}}

---

## Root Cause Analysis

### Hypothesis

{{ROOT_CAUSE_HYPOTHESIS}}

### Supporting Evidence

#### 1. Log Evidence

{{#each LOG_EVIDENCE}}
**Source**: {{this.source}} (Line {{this.line_number}})

```
{{this.excerpt}}
```

**Interpretation**: {{this.interpretation}}

{{/each}}

#### 2. Documentation Support

{{DOCUMENTATION_SUPPORT_TEXT}}

#### 3. Timeline Alignment

Customer reported issue at: **{{CUSTOMER_REPORTED_TIME}}**  
Logs show trigger event at: **{{LOG_TRIGGER_TIME}}**  
Time delta: **{{TIME_DELTA}}**

{{TIMELINE_ALIGNMENT_ANALYSIS}}

#### 4. Pattern Consistency

{{PATTERN_CONSISTENCY_ANALYSIS}}

### Alternative Explanations Considered

{{#each ALTERNATIVE_HYPOTHESES}}

**Alternative {{@index}}**: {{this.hypothesis}}

- Evidence for: {{this.evidence_for}}
- Evidence against: {{this.evidence_against}}
- Likelihood: {{this.likelihood}}

{{/each}}

### Confidence Assessment

**Confidence Level**: {{CONFIDENCE_LEVEL}}

**Justification**:
{{CONFIDENCE_JUSTIFICATION}}

---

## Impact Analysis

### What Happened

{{IMPACT_DESCRIPTION}}

### Affected Operations

- {{AFFECTED_OPERATION_1}}
- {{AFFECTED_OPERATION_2}}
- {{AFFECTED_OPERATION_3}}

### Duration

- **Incident Start**: {{INCIDENT_START}}
- **Incident End/Current**: {{INCIDENT_END}}
- **Total Duration**: {{INCIDENT_DURATION}}

### User Impact

{{USER_IMPACT_DESCRIPTION}}

---

## Recommended Actions

### Immediate Actions (Do Now)

{{#each IMMEDIATE_ACTIONS}}

**{{@index}}. {{this.action}}**

{{#if this.command}}
```bash
{{this.command}}
```
{{/if}}

- **Purpose**: {{this.purpose}}
- **Expected Result**: {{this.expected_result}}
- **Risk**: {{this.risk}}

{{/each}}

### Investigation Steps (Next 24 Hours)

{{#each INVESTIGATION_STEPS}}

**{{@index}}. {{this.step}}**

{{#if this.command}}
```bash
{{this.command}}
```
{{/if}}

- **What to look for**: {{this.what_to_look_for}}
- **Why it matters**: {{this.rationale}}

{{/each}}

### Long-term Recommendations (Preventive)

{{#each LONGTERM_RECOMMENDATIONS}}

**{{@index}}. {{this.recommendation}}**

- **Benefit**: {{this.benefit}}
- **Implementation**: {{this.implementation}}
- **Effort**: {{this.effort_level}}

{{/each}}

---

## Questions for Customer

Based on analysis, these questions would help confirm or refine the diagnosis:

{{#each CUSTOMER_QUESTIONS}}
{{@index}}. {{this.question}}
   - **Why we're asking**: {{this.rationale}}
{{/each}}

---

## Related Tickets Analysis

{{#if RELATED_TICKETS}}

{{#each RELATED_TICKETS}}

### Ticket {{this.number}}

- **Similarity**: {{this.similarity_score}}%
- **Common Patterns**: {{this.common_patterns}}
- **Differences**: {{this.differences}}
- **Relevance**: {{this.relevance}}

{{/each}}

### Pattern Across Tickets

{{CROSS_TICKET_PATTERN_ANALYSIS}}

{{else}}

No related tickets analyzed. To compare with related tickets, provide ticket numbers for comparative analysis.

{{/if}}

---

## Additional Resources

### Relevant Documentation
{{#each ADDITIONAL_DOCS}}
- [{{this.title}}]({{this.url}})
{{/each}}

### Monitoring Commands

Use these commands to monitor the situation:

```bash
{{MONITORING_COMMANDS}}
```

### Useful Log Searches

If issue recurs, use these searches:

```bash
{{USEFUL_LOG_SEARCHES}}
```

---

## Appendix

### Analysis Metadata

- **Total logs analyzed**: {{TOTAL_LOGS_ANALYZED}}
- **Log lines scanned**: {{TOTAL_LOG_LINES}}
- **Search patterns used**: {{SEARCH_PATTERNS_COUNT}}
- **Documentation pages consulted**: {{DOCS_PAGES_COUNT}}
- **Analysis duration**: {{ANALYSIS_DURATION}}

### Agent Configuration

- **Model**: {{MODEL_NAME}}
- **Agent Version**: {{AGENT_VERSION}}
- **Configuration**: {{CONFIG_HASH}}

### Files Analyzed

{{#each FILES_ANALYZED}}
- `{{this.path}}` ({{this.size}}, {{this.line_count}} lines)
{{/each}}

---

## Feedback

Was this analysis helpful? Please provide feedback to improve future analyses:
- Accuracy of root cause: ☐ Correct ☐ Partially Correct ☐ Incorrect
- Usefulness of recommendations: ☐ Very Helpful ☐ Somewhat Helpful ☐ Not Helpful
- Report clarity: ☐ Excellent ☐ Good ☐ Needs Improvement

---

**End of Report**

Generated by: couchbase-ticket-analyzer v{{AGENT_VERSION}}  
For questions about this report, see [README.md](../README.md)
