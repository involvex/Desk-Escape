---

name: Pull Request
description: Propose changes to Desk Escape
title: ''
labels: []
body:

- type: markdown
  attributes:
  value: |
  Thanks for contributing to Desk Escape! Please review the checklist
  below and make sure all tests pass.
- type: checkboxes
  id: checklist
  attributes:
  label: Checklist
  options: - label: I have read CONTRIBUTING.md and followed the conventions.
  required: true - label: My change passes `bun run lint` and `bun run typecheck`.
  required: true - label: I have added or updated documentation if needed.
  required: false - label: I have added tests for new functionality (if applicable).
  required: false - label: I have verified my change on at least one platform (Android / iOS / Web).
  required: false - label: My commit messages follow the Conventional Commits specification.
  required: true
- type: textarea
  id: description
  attributes:
  label: Description of changes
  description: |
  Briefly describe what this PR does. Include the **why** (problem it
  solves) and **how** (approach taken). Reference any related issue or
  plan item, e.g. "Closes #123".
  validations:
  required: true
