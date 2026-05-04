# Operations

Operator-facing playbooks: how to tune, monitor, and recover live
subsystems. Distinct from
[`docs/architecture/`](../architecture/README.md), which documents
_how the code is organised_. These docs answer _"the alert fired —
now what?"_.

## What's in here

| Doc                                      | Read it when…                                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| [preview-tuning.md](./preview-tuning.md) | A preview window misbehaves, you're sizing the deploy, or running the load harness. |

## Conventions

- One subsystem per file; mirror the architecture-doc filename so the
  pair is easy to find (`docs/architecture/preview-stream.md` ↔
  `docs/operations/preview-tuning.md`).
- Each playbook should answer four questions in order: **what's
  tunable**, **where do I look (logs / UI)**, **what does healthy
  look like (SLO)**, **what do I do when it breaks**.
- No code walkthroughs — link to the architecture doc instead.
