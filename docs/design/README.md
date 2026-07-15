# MCPixel design notes

Version map for product UX and upcoming capability research.

| Doc | Scope |
| --- | --- |
| [v3.md](./v3.md) | Current UX: Ink-only shell, Create as main pane, Queue/Projects, Settings |
| [v4-image-edit.md](./v4-image-edit.md) | Research: OpenAI `images.edit` / reference images |
| [v4-angles.md](./v4-angles.md) | Research: rotate / multi-view sprites |
| [v4-animation.md](./v4-animation.md) | Research: frame sequences / sprite sheets |

Jobs remain on disk under `data/jobs/<id>/`. Projects live in `data/projects.json`. UI-managed keys live in `data/settings.json` (process env still wins on boot when already set).
