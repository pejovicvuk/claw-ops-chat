---
name: fix-issue
description: Fix a GitHub issue by analyzing, implementing, and testing the fix
argument-hint: <issue-number>
user-invocable: true
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---

# Fix GitHub Issue

## Steps

1. Fetch issue details: `gh issue view $ARGUMENTS`
2. Read related code files mentioned in the issue
3. Understand the root cause
4. Create a feature branch: `git checkout -b fix/$ARGUMENTS-short-description`
5. Implement the fix following project conventions (see CLAUDE.md)
6. Write or update tests for the fix
7. Run verification: `npm test && npm run lint && npx tsc --noEmit`
8. Commit with conventional format: `fix: description (closes #$ARGUMENTS)`
9. Push and create PR: `gh pr create --title "fix: ..." --body "Closes #$ARGUMENTS"`

## Rules

- Always create a branch — never commit to main
- Include test coverage for the fix
- Reference the issue number in commit and PR
- Run the self-evaluation checklist from CLAUDE.md before marking done
