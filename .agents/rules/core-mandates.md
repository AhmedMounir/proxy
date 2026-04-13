---
trigger: always_on
---

# CORE MANDATES & SYSTEM CONSTRAINTS
This is a strict production environment, not an MVP. All code generated must prioritize long-term maintainability, strict typing, and system stability over rapid task execution.

CRITICAL INSTRUCTIONS: DO NOT EVER TAKE THE PATH OF LEAST RESISTANCE, Always evaluate alternative design and how we detect and recover from failures.

## 0. Major Release & Compatibility Policy (v-Next)
- **Zero Backward Compatibility:** This is a new major release. You are explicitly authorized and required to BREAK backward compatibility to achieve architectural purity. DO NOT write adapter code, shims, or polyfills to support legacy interfaces.
- **Clean Code Paradigm:** Ruthlessly strip away legacy cruft. Prioritize modern, clean code patterns. 
- **AI Agent Standards:** All new implementations must strictly maintain compatibility with modern AI Agent standards. Optimize interfaces for agentic tool-calling, state management, and LLM-driven orchestration.

## 1. Architecture & Performance (`packages/core`)
- **Domain:** This package is a multi-tenant, multi-session HTTP/Server-Sent Events (SSE) backend.
- **Performance:** Code must be strictly non-blocking. Optimize for concurrent connections, minimal memory footprint per session, and efficient event-loop management.
- **Tenant Isolation:** Ensure strict logical separation of tenant data and session states in all backend operations.

## 2. Tech Stack & Execution Workflow
- **Package Manager:** Strictly use `bun` for all package management and script execution.
- **Typechecking:** Always run run `bun typecheck` after making modifications.
- **Windows Execution Protocol:** You are operating in a Windows environment. If `bun typecheck` finds errors, it will return Exit Code 1. **THIS IS EXPECTED.** Do not treat Exit Code 1 as a system crash or failed execution.
- **No File Dumping:** You are strictly forbidden from dumping the typecheck output to a temporary text file (e.g., `> errors.txt`) to read it. You must capture the console stream directly in memory.
- **Allowed Output Capture:** You must capture the COMPLETE output. Do not use commands that truncate (e.g., `tail` or `head`). To prevent Windows shell errors and capture the full buffer, you are authorized to use stream merging (e.g., `bun typecheck 2>&1 | Out-String` in PowerShell), provided the output remains entirely un-truncated.
- **Linting:** Always run `bun lint:fix` after making modifications to ensure formatting compliance.
- **Testing Scope:** A full `bun test` run takes ~30 minutes. NEVER run the global test suite. You MUST run scoped tests mapped directly to the files or domains you are modifying (e.g., `bun test test/sessions`). If no scope is specified, infer from modified files.

## 3. Variable & Linter Policy
- **Unused Variables:** If you encounter an unused variable warning, DO NOT blindly remove it or instantly prefix it with `_` to suppress the linter. 
- **Analysis Required:** First, analyze if the variable *should* have been used (i.e., a missed implementation detail). 
- **Justified Suppression:** If the variable is genuinely unused but required by a signature or interface (e.g., an external callback function), you may prefix it with `_` ONLY IF you add an explicit, inline comment justifying its presence.

## 4. Design & Refactoring Guardrails
- **Design > Speed:** Structural integrity and design patterns take precedence over writing code quickly. 
- **The "Roadmap" Rule:** While you must drop legacy compatibility (per Directive 0), if you encounter an entirely separate domain or massive architectural anti-pattern outside your current scope, DO NOT initiate an unprompted global rewrite. Explicitly propose the refactor to be added to the technical roadmap in packages/core/roadmap/
- **Incremental Changes:** Keep functional changes tightly scoped to the current objective.

## 5. Strict Error Handling (Fail-Fast Protocol)
- **NO Silent Fallbacks:** Fall-back values (e.g., returning `null`, empty arrays, or default objects when an operation fails) are strictly forbidden unless explicitly justified by business logic. Silent fallbacks hide systemic issues.
- **Explicit Exceptions:** Throw structured, typed errors immediately upon encountering an invalid state. 
- **UAT Detectability:** All errors must be logged and bubbled up in a standardized format so they are immediately detectable during User Acceptance Testing (UAT).
- **Fault Tolerance:** Implement fault tolerance at the infrastructure/architectural level (e.g., circuit breakers, retry logic for external APIs), NOT by masking internal runtime errors.

## 6. Test Resolution Protocol
When a test fails, DO NOT immediately assume the implementation code is broken. You must perform a root-cause analysis to determine if the failure is a regression or a symptom of an outdated test.

- **Analyze First, Modify Second:** Before writing any code to "fix" a failing test, evaluate the nature of the failure against recent changes.
- **When to Update the Test (Refactor/Feature):** If the test is failing due to intentional architectural changes—such as different return types, modified function signatures, dropped legacy compatibility, or new business logic—the *test* is outdated. You must update the test suite to reflect the new expected behavior.
- **When to Fix the Code (Regression/Bug):** If the test is failing due to logic errors (e.g., null references, off-by-one errors, math errors, unexpected state mutations) within a domain that should not have changed, it is a genuine bug. You must fix the implementation code.
- **The "No Assumption" Rule:** If the root cause of the test failure is ambiguous or crosses domain boundaries, DO NOT guess. You must stop, explicitly explain the conflicting interpretations to the user, and ask for a definitive direction on whether to patch the code or rewrite the test.

## 7. Architectural Design & Decision Protocol
When tasked with a new design, feature architecture, or a large-scale change request, you must suspend immediate execution and enter a structured design phase.

- **Multiple Alternatives:** Never default to the first idea. You must formulate at least two distinct design alternatives.
- **Pattern-Driven Engineering:** Base your designs strictly on well-established software design patterns (e.g., Strategy, Factory, Reactor, State, Dependency Injection). 
- **Structured Evaluation:** Use a sequential thinking process to rigorously evaluate the pros, cons, and system tradeoffs of each approach. Consider whether a hybrid design optimally mitigates the weaknesses of the individual patterns.
- **The "No Assumption" Decision Gate:** If there are significant architectural tradeoffs between the alternatives (e.g., execution speed vs. memory footprint, complexity vs. extensibility), DO NOT make the final decision. You must stop, present the tradeoffs clearly, and ask the user to make the final call. You may only proceed autonomously if one solution is clearly superior with zero architectural downside.
autonomously if one solution is unequivocally optimal with zero architectural downside.
- **Mandatory Artifact Creation:** Before initiating any code implementation, you must generate a formal design artifact (e.g., an Architecture Decision Record (ADR), a Markdown specification, or an Mermaid diagram) detailing your evaluated patterns, reasoning, and the finalized blueprint.

## 8. Execution Gate & Planning Protocol
When discussing, formulating, or modifying a plan or design, you are strictly in "Planning Mode." You must not write, modify, or delete any implementation code until the user provides explicit confirmation to proceed.

- **No Premature Execution:** Do not jump the gun. If the user provides feedback or modifications to a proposed plan/design, your ONLY task is to acknowledge the feedback, update the plan, and wait.
- **The Acknowledge & Update Loop:** - *User:* "ok, but we also need to remove the condition..."
  - *WRONG:* You acknowledge the change and immediately start modifying the codebase.
  - *CORRECT:* You update the plan/design artifact to include the removal of the condition, present the updated plan, and stop.
- **Explicit Authorization Required:** You must end your planning responses by explicitly asking for permission to begin coding (e.g., "Shall I proceed with implementation?"). Do not transition from Planning Mode to Execution Mode without a definitive "yes," "proceed," or equivalent confirmation from the user.



NOTE: $0 authorizes breaking changes within the current task scope. $4 prevents scope creep beyond the task boundary.