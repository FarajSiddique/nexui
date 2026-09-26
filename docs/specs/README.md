# Specs

Three kinds of document live here. When two of them disagree, the more specific one wins:
a feature spec beats the roadmap, and the roadmap beats the ideas backlog.

| File                                                 | Kind          | What it holds                                                                                               |
| ---------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------- |
| [anchored-intelligence.md](anchored-intelligence.md) | Roadmap       | The product rules (§3), the feature index, phases, priorities and metrics. Why and in what order            |
| [anchored-shell.md](anchored-shell.md)               | Feature spec  | The five-tab shell, the + sheet, Home and Calendar. Ready to build                                          |
| [integrations.md](integrations.md)                   | Feature spec  | Device capabilities (place reminders, Contacts, calendars, share sheet, Live Activities) and cloud accounts |
| [auth.md](auth.md)                                   | Feature spec  | Sign-in and session ownership                                                                               |
| [living-interface.md](living-interface.md)           | Ideas backlog | Unscheduled ideas and where each one landed in the roadmap                                                  |

- A new idea goes into the backlog first. When the roadmap schedules it, its row in the
  backlog's status table points to the roadmap section.
- A roadmap feature that needs more than a page of detail gets its own feature spec, and the
  roadmap section shrinks to a summary and a link (as §5.1 and §5.11 did).
- Behavior that has shipped is described in `docs/architecture/`, not here.
