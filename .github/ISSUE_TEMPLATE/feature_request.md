---
name: Feature request
description: Suggest an idea for Desk Escape
title: "[feature] "
labels: ["feature", "needs-triage"]
body:
  - type: markdown
    attributes:
      value: |
        Have an idea that would make Desk Escape better for you and other
        developers? Let us know!
  - type: textarea
    id: problem
    attributes:
      label: Problem this solves
      description: |
        Describe the problem you're trying to solve. What can't you do today
        that you wish you could?
      placeholder: "I often want to do X while coding on my phone but..."
    validations:
      required: true
  - type: textarea
    id: solution
    attributes:
      label: Proposed solution
      description: A description of what you want to happen. Be specific.
    validations:
      required: true
  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives considered
      description: |
        What else did you try, or what would you use instead? This helps us
        understand the breadth of the problem.
      placeholder: "I could also switch to app Y, but..."
    validations:
      required: false
  - type: dropdown
    id: priority
    attributes:
      label: Priority
      description: "How important is this feature to you?"
      multiple: false
      options:
        - "Nice to have (Low)"
        - "It would help me (Medium)"
        - "I can't work without this (High)"
    validations:
      required: true
  - type: checkboxes
    id: checklist
    attributes:
      label: Checklist
      options:
        - label: I have searched the existing feature requests and this is not a duplicate.
          required: true
        - label: I am willing to discuss implementation details or help test.
          required: false
---
