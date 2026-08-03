---
name: Bug report
description: Report something that isn't working as expected
title: "[bug] "
labels: ["bug", "needs-triage"]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for taking the time to file a bug report! Please fill out the
        information below so we can reproduce and fix the issue.
  - type: textarea
    id: description
    attributes:
      label: Description
      description: A clear and concise description of what the bug is.
    validations:
      required: true
  - type: textarea
    id: steps
    attributes:
      label: Steps to reproduce
      description: |
        List the steps that reliably reproduce the bug, one per line.
      placeholder: |
        1. Go to '...'
        2. Connect to server at '...'
        3. Send prompt '...'
        4. See error
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: Expected behavior
      description: What you expected to happen.
    validations:
      required: true
  - type: textarea
    id: actual
    attributes:
      label: Actual behavior
      description: What actually happened (include error messages, screenshots).
    validations:
      required: true
  - type: dropdown
    id: platform
    attributes:
      label: Platform
      description: Which platform(s) does the bug reproduce on?
      multiple: true
      options:
        - Android
        - iOS
        - Web
        - All platforms
    validations:
      required: true
  - type: input
    id: version
    attributes:
      label: App version
      description: The version of Desk Escape (e.g. 1.0.2 or commit hash).
      placeholder: "1.0.2"
    validations:
      required: true
  - type: input
    id: opencode
    attributes:
      label: OpenCode SDK version
      description: The version of @opencode-ai/sdk bundled with the app (if known).
      placeholder: "^1.17.8"
    validations:
      required: false
  - type: textarea
    id: device
    attributes:
      label: Device / OS details
      description: Phone model, Android/iOS version, or browser.
      placeholder: "Pixel 8 / Android 15, or iPhone 15 / iOS 18, etc."
    validations:
      required: false
  - type: textarea
    id: logs
    attributes:
      label: Logs
      description: Relevant error logs or debug output (use `bun run android` logcat or React Native logs).
      render: textarea
    validations:
      required: false
  - type: checkboxes
    id: checklist
    attributes:
      label: Checklist
      options:
        - label: I have searched the existing issues to make sure this isn't a duplicate.
          required: true
        - label: I have confirmed this bug is specific to this app (not an OpenCode server issue).
          required: false
        - label: I am willing to provide additional information if needed.
          required: false
---
