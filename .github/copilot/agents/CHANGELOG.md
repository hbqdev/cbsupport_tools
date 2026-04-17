# Agent Changes Log

## 2026-03-19 - Post-Test Quality Improvements

### Issue Found
During testing with ticket 76862, the agent made an unsupported claim that "XDCR pause during operator upgrade is EXPECTED and NORMAL behavior" without citing documentation. Manual verification showed no such documentation exists.

### Root Cause
- Agent instructions said "consult docs expert if needed"
- Agent decided it didn't need to
- Made assumptions based on general knowledge
- No enforcement of citation requirements

### Changes Made

#### couchbase-ticket-analyzer.md
1. **Enhanced Section 3 (Research Documentation)**:
   - Changed from "Use the couchbase-docs-expert" to "MANDATORY: Use the couchbase-docs-expert"
   - Added CRITICAL RULE: Never make claims about expected behavior without evidence
   - Added examples for behavioral questions (e.g., "Does XDCR pause during upgrades?")
   - Added instruction: If no docs found, state "Unknown - requires investigation"

2. **Enhanced Quality Standards**:
   - Added: "CITE ALL SOURCES: Every claim about expected behavior MUST cite documentation URL"
   - Added: "No assumptions: If unsure, state 'Unknown - requires investigation'"
   - Added: "Consult docs expert: For any behavioral claims, invoke couchbase-docs-expert first"

#### ticket-agents-manager.md
1. **Enhanced Documentation Verification (Section 4C)**:
   - Added: "No unsupported claims: Every 'expected behavior' statement has citation?"
   - Added: "Flag unverified claims: Mark any assumptions or inferences clearly"

2. **Enhanced Error Handling**:
   - Added to "Missing documentation research" section:
     - "CRITICAL: Flag any unsupported behavioral claims in report"
     - "Add warning if claims made without documentation"

### Expected Behavior After Changes
- Agents will invoke couchbase-docs-expert for ALL behavioral claims
- No claims of "expected behavior" without documented sources
- If documentation doesn't exist, clearly state "Unknown"
- Manager will flag unsupported claims during QA

### Testing Recommendation
Test with a ticket that has:
- Real incident with logs
- Known error messages with documented causes
- MBs (known issues) that can be cited
- Clear root cause with documentation links

This will validate that agents properly cite sources.

### Files Updated
- `.github/copilot/agents/couchbase-ticket-analyzer.md`
- `.github/copilot/agents/ticket-agents-manager.md`

### Files Added
- `.github/copilot/agents/CHANGELOG.md` (this file)
- `/Users/tin.tran/Downloads/couchbaselogs/support/76862/AGENT_TEST_ISSUES.md` (test findings)

## 2026-03-19 - Workflow Clarification (Post-Test Feedback)

### Issue Identified
User noted that ANALYSIS_SUMMARY.txt was redundant with analysis_report.md, and clarified the proper workflow separation between analyzer and manager.

### Correct Workflow
1. **ticket-analyzer**: Creates ONLY `analysis_metadata.json`
2. **ticket-agents-manager**: 
   - Reads and validates JSON
   - Checks for unsupported claims
   - Re-invokes docs-expert if needed
   - Creates final `analysis_report.md`

### Changes Made

#### couchbase-ticket-analyzer.md
- Clarified: "Create ONLY analysis_metadata.json"
- Added: "DO NOT create analysis_report.md - that's the manager's job"
- Updated completion message to indicate manager will generate final report

#### ticket-agents-manager.md
1. **Section 3 (Read Analysis Metadata)**:
   - Added CRITICAL validation step before using findings
   - Must verify documentation was consulted
   - Must check for citations
   - Must cross-reference evidence with conclusions
   - Re-invoke docs-expert if findings seem unsupported

2. **Section 6 (Generate Report)**:
   - Clarified: "YOU create analysis_report.md - not the analyzer"
   - Added validation checklist before writing report
   - Must flag unsupported claims found in JSON

3. **Important Notes**:
   - Updated to reflect proper division of responsibilities
   - Analyzer: JSON only
   - Manager: Validates JSON, creates markdown report
   - Manager must be critical and validate, not blindly trust

### Expected Behavior After Changes
- Analyzer outputs ONLY analysis_metadata.json
- Manager validates JSON before using it
- Manager flags any quality issues in analyzer's output
- Manager creates single comprehensive analysis_report.md
- No redundant ANALYSIS_SUMMARY.txt file

### Files Updated
- `.github/copilot/agents/couchbase-ticket-analyzer.md`
- `.github/copilot/agents/ticket-agents-manager.md`
- `.github/copilot/agents/CHANGELOG.md`
