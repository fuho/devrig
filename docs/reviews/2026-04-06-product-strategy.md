# Product Strategy Analysis

_Reviewed: 2026-04-06, v0.3.0_

## Competitive Landscape

| Solution | Limitations for AI agents |
|----------|--------------------------|
| Docker Dev Environments | No Chrome bridge, no AI agent awareness |
| GitHub Codespaces | Proprietary, costly, no local control |
| Gitpod | No local filesystem isolation, expensive |
| Coder | Enterprise-focused, not AI-agent-aware |
| devcontainers | Zero orchestration for Claude Code |
| Raw Docker | No automation, manual setup |

**devrig's unique value:** Zero-config AI sandbox + Chrome bridge + git safety + reproducible team setup.

## Positioning

**Current:** "Run Claude Code in Docker so it can't break your machine"
- Too defensive — focuses on protection, not enablement
- Sounds like a last resort, not a best practice

**Better:** "Production-grade AI development environment. Containerized, auditable, reproducible."

The tool field in devrig.toml already supports multi-tool future. Position as "AI development environment" not "Claude sandbox."

## Naming

"devrig" is good — short, memorable, searchable, conveys "development rig/setup."
Tagline needs work — lead with enablement, not fear.

## Distribution

npm alone is insufficient:
- **Homebrew** (HIGH priority) — 30M+ macOS users, massive credibility
- **Docker Hub** — AI/ML practitioners search there
- **GitHub Releases** — pre-built binaries for offline installs

## Documentation Gaps

| Gap | Priority |
|-----|----------|
| No video walkthrough | HIGH |
| No team collaboration guide | HIGH |
| No threat model document | HIGH |
| No CI/CD examples | MEDIUM |
| No multi-tool roadmap | MEDIUM |

## Feature Roadmap (Reordered for Impact)

| Priority | Feature | Why |
|----------|---------|-----|
| CRITICAL | `devrig doctor` | Prevents churn from stuck new users |
| CRITICAL | Homebrew distribution | 5-10x download reach |
| HIGH | `devrig update` | Blocker for team adoption |
| HIGH | Multi-tool scaffolding | Future-proofs product |
| HIGH | Starter template library | Faster onboarding |
| MEDIUM | `devrig logs` | Power user DX |
| MEDIUM | GitHub Actions integration | Enterprise adoption |

## Untapped Opportunities

1. **Session snapshots** — checkpoint and restore mid-feature work
2. **Diff-on-exit report** — "Claude changed X files, made Y commits"
3. **Multi-agent parallel sessions** — Claude on feature-X, Claude on feature-Y
4. **Recorded sessions for compliance** — audit what Claude did (HIPAA, SOC2)
5. **Offline-first sandboxing** — works on flights, air-gapped networks
6. **Cost attribution** — track Claude API costs per session/project

## Risk Factors

| Risk | Probability | Mitigation |
|------|-------------|-----------|
| Anthropic builds this natively | Medium | Multi-LLM positioning NOW |
| Claude Code API changes | Medium | Monitor releases, good test coverage |
| Docker licensing changes | Low | Support Podman/Colima |
| Single contributor burnout | Medium | Recruit co-maintainers early |

## 90-Day Plan

**Month 1:** Reframe positioning, enable GitHub Discussions, write threat model blog, start Homebrew submission
**Month 2:** Produce video walkthrough, publish tutorial, launch on ProductHunt, get Homebrew approved
**Month 3:** Ship devrig doctor + update, publish multi-LLM roadmap, create starter templates

## The Big Idea

devrig isn't a tool for running Claude safely. It's the **control plane for AI-assisted development at scale.** Session snapshots, parallel agents, audit logs, cost tracking — these all flow from owning that positioning.
