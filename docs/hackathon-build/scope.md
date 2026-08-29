# Project Scope

## Project Name

- Confirmed: **Frontmend**. The participant chose the name; this workflow will not generate substitutes.

## One-Line Summary

Frontmend turns a natural frontend-quality request into a shared, durable mission where a person and their repository-aware coding agent measure a live site, diagnose the most important evidence, prepare and review a bounded fix, and verify the deployed result.

## Target User

- Primary: a developer using Codex or another WebMCP-capable coding agent with access to the site's repository.
- Secondary: the product owner or maintainer who must understand the evidence, control repair authority, deploy through their normal workflow, and verify the outcome.
- Judge experience: a reviewer should be able to use a natural prompt, see real WebMCP tools operate against the same state as the visible app, and understand the human/agent authority boundary without reading the architecture first.

## Problem

Automated frontend audits usually stop at generic Lighthouse output. A coding agent may summarise the score and produce a cosmetic punch list, but the result is disconnected from browser reproduction, repository ownership, human approval, implementation evidence, deployment, and fresh verification. The person then has to reconstruct the workflow manually and cannot see what authority the agent exercised.

Frontmend already solves much of the underlying protocol. The remaining product risk is comprehension and continuation: a natural request can still end after measurement, making the differentiated repository-aware mission look like “Lighthouse through tool calls.”

## Product Thesis

WebMCP is most valuable here as a shared application protocol, not as a way to trigger Lighthouse. The page owns durable public evidence, policy, review, deployment attestation, and verification; the coding agent owns repository investigation and implementation; the person can review every plan or grant a bounded low-risk auto policy. Each actor sees the same mission and only receives actions valid for the current state.

## Core Workflow

1. The person asks naturally: “Hey Codex, please use Frontmend to audit my site for accessibility and SEO issues.”
2. The agent starts a real asynchronous audit with the requested focus and follows the contextual progress tools.
3. Frontmend returns no more than three deduplicated priorities, but clearly distinguishes “measurement complete” from “mission complete.”
4. For an actionable diagnostic finding, the agent opens a durable mission and contributes separately attributed browser reproduction plus repository-relative ownership evidence.
5. The agent submits a bounded repair plan. The visible human policy either requires explicit review or consumes a previously granted, narrowly scoped low-risk auto approval.
6. The repository-aware agent implements outside Frontmend and records bounded files, checks, summary, and optional Git object evidence.
7. The person deploys through their normal workflow and explicitly attests the handoff.
8. Frontmend performs a fresh audit and returns exact-rule verification with comparable evidence boundaries.

## What We Are Building

### 1. Mission-oriented natural-intent continuity

- Persist or otherwise retain the requested audit focus so the visible workspace and WebMCP results agree on the user's goal.
- Make structured results state whether the requested mission is complete, blocked, or ready for a specific next actor.
- Return narrow, executable continuation guidance when evidence supports diagnosis, without falsely implying every finding can be repaired automatically.
- Ensure tool descriptions and contextual registration lead capable agents beyond measurement when the user asked for actionable remediation.

### 2. A judge-legible shared mission experience

- Make the visible workspace explain the current goal, completed phase, next actor, evidence provenance, and human-only authority at the moment it matters.
- Let the session activity ledger demonstrate genuine contextual WebMCP calls without exposing inputs, URLs, prompts, source, or secrets.
- Keep the differentiator legible in the first successful audit: Frontmend measures; the agent investigates the repository; the person controls deployment; Frontmend verifies.

### 3. Contract and fresh-session proof for the real prompt

- Add deterministic contracts/evals for the natural accessibility-and-SEO request and its continuation state.
- Produce exact fresh-session ChatGPT and Chrome verification instructions that prove discovery, contextual tool changes, diagnosis/repository handoff, authority gating, and visible shared state—not merely audit completion.
- Align the README, submission story, and under-three-minute demo path with evidence the current build can reproduce.

### 4. Release completion

- Preserve the existing Cloudflare deployment contract and PageSpeed provider path.
- Remove temporary Cloudflare Access or provide usable judge access before final release.
- Publish the repository with visible Apache-2.0 licensing and challenge-period commit history.
- Record the exact deployed revision and supported-browser receipts before submission.

## What We Are Not Building

- More Lighthouse categories or a larger rule catalogue merely to increase feature count.
- An unrestricted crawler, arbitrary browser-rendering proxy, or private-network scanner.
- Direct repository upload, source ingestion, patch execution, Git hosting integration, autonomous deployment, or agent-created permission grants.
- A generic chatbot or a broad “AI fixes every website” promise.
- A full visual redesign before the mission continuity and proof path are strong.
- A contrived demo-only implementation that cannot be exercised as the real product.
- Direct repair of arbitrary third-party sites; Frontmend coordinates evidence and authority while the repository-aware agent and site owner act in their existing environments.

## Inspiration And Positioning

- Lighthouse/PageSpeed supplies valuable measurement, but Frontmend's product begins where those reports normally stop.
- Code-scanning remediation workflows show the value of issue-to-fix traceability, while Frontmend adds live-browser evidence and human/WebMCP collaboration.
- Typical WebMCP commerce demos show semantic agent actions; Frontmend applies the standard to a longer-lived, multi-actor engineering mission with changing authority.

## Demo Path

The video opens on the natural prompt and a live Frontmend workspace. It shows a real audit start, contextual progress, focused priorities, and then spends most of its time on the differentiated section: diagnostic mission, repository evidence, visible review or bounded auto authorisation, implementation receipt, person-only deployment gate, and fresh verification. The visible activity ledger and human UI corroborate the agent's calls. Waiting and setup are cut; claims remain tied to genuine recorded runs.

## Submission Story

Frontmend demonstrates that WebMCP can make a web product and a coding agent collaborators rather than parallel interfaces. The agent does not scrape UI or receive a hidden superuser API. It participates in the same durable mission as the person, receives contextual semantic tools, contributes bounded repository evidence, and cannot cross human approval or deployment boundaries. That creates a workflow that was previously fragmented across Lighthouse, browser debugging, repository work, deployment, and another audit.

## Time Budget

- Hard deadline: 3 September 2026 at 1:00 pm Pacific Time (4 September 2026 at 4:00 am Australia/Perth).
- Scope ruler: use the remaining submission window for one coherent mission-continuity product slice, its automated contracts, fresh supported-browser proof, repository publication, and demo/submission assets.
- No daily-hour assumption is invented. Lower-value breadth is cut before the core mission or release evidence is compromised.

## Definition Of Done

- The natural audit prompt produces focused evidence and makes the next mission state unambiguous.
- A fresh capable agent can continue into a diagnostic/repository mission without being coached through Frontmend's internal tool sequence.
- The visible UI and WebMCP outputs agree on goal, evidence, state, next actor, and authority.
- Explicit review and bounded auto mode remain human-governed; deployment attestation remains person-only.
- Tests, production build, and Wrangler strict dry run pass.
- Fresh ChatGPT and Chrome WebMCP sessions demonstrate the same real workflow.
- Judges can access the live app and public source, and the final description/video accurately show this implementation.
