---
name: review
description: Review code changes on the current branch or a PR
argument-hint: [PR-number|branch|staged]
user-invocable: true
allowed-tools: Read, Grep, Glob, Bash
---

# Code Review

## Steps

1. Determine what to review:
   - PR number: `gh pr diff $ARGUMENTS`
   - Branch: `git diff main...$ARGUMENTS`
   - "staged": `git diff --cached`
   - No argument: `git diff main...HEAD`

2. For each changed file, check:
   - TypeScript strictness (no `any`, proper error handling)
   - Auth checks on API routes (`extractSession` first)
   - `safePath()` usage on file operations
   - Test coverage for new logic
   - Naming conventions (kebab-case files, PascalCase components)
   - No secrets or .env values in code
   - Proper `"use client"` directives

3. Output a structured review:
   - **Summary** of changes
   - **CRITICAL** — must fix before merge (security, data loss, crashes)
   - **WARNING** — should fix (bad patterns, missing edge cases)
   - **SUGGESTION** — nice to have (style, minor improvements)
   - Specific file:line references for each finding
