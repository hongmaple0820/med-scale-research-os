# SCALE Verification Protocol v1.0.0

## Overview

The Verification Protocol defines a standard JSON format for verification profiles.
Any CI/CD system, test runner, or code review tool can integrate with SCALE Engine
by producing or consuming this format.

## Quick Start

```json
{
  "version": "1.0.0",
  "project": { "name": "my-app", "language": "node" },
  "profiles": {
    "default": {
      "description": "Standard CI verification",
      "services": {
        "root": {
          "type": "node",
          "commands": {
            "build": "npm run build",
            "lint": "npm run lint",
            "test": "npm run test",
            "coverage": "npm run coverage"
          },
          "policy": {
            "mode": "standard",
            "artifactGate": "block",
            "engineeringStandardsGate": "warn",
            "productSmokeGate": "warn"
          }
        }
      }
    }
  }
}
```

## Third-Party Integration

Tools can register as an integration:

```json
{
  "integrations": [
    {
      "tool": "jest",
      "type": "test-runner",
      "adapter": {
        "command": "npx jest --json --outputFile=.scale/evidence/jest-results.json",
        "outputFormat": "json",
        "exitCodeMapping": { "pass": [0], "fail": [1] }
      }
    }
  ]
}
```

## Evidence Consumption

After running verification, evidence is stored at `.scale/evidence/`.
Third-party tools can read these JSON files to extract gate results,
verification commands, and runtime evidence.

## Compatibility

- SCALE Engine v0.40+
- gstack / ECC / OMC via SKILL.md bridge
- CI/CD: GitHub Actions, GitLab CI, Jenkins
