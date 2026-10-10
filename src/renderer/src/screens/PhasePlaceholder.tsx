type PlaceholderProps = {
  title: string
  phase: number
  summary: string
  planned: string[]
}

/**
 * Deliberately non-interactive: unfinished areas say what they will do and
 * when, instead of showing controls that don't work (spec §21, rules 15–16).
 */
export function PhasePlaceholder({ title, phase, summary, planned }: PlaceholderProps) {
  return (
    <div className="screen">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Not available yet</p>
          <h1>{title}</h1>
        </div>
        <span className="tag tag-pending tag-lg">Arrives in Phase {phase}</span>
      </header>
      <section className="panel placeholder">
        <p className="lead">{summary}</p>
        <h2 className="small-heading">Planned</h2>
        <ul className="planned">
          {planned.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}

export const PLACEHOLDERS: Record<'create' | 'presets' | 'exports', PlaceholderProps> = {
  create: {
    title: 'Create',
    phase: 3,
    summary: 'Pick a song, a hook and a pool of clips, and get beat-synchronized drafts you can edit.',
    planned: [
      'Beat and bar-based cut generation',
      'Vertical 9:16 crop with manual positioning',
      'Lyric overlays timed word by word',
      'Several variations from one setup'
    ]
  },
  presets: {
    title: 'Presets',
    phase: 5,
    summary: 'Saved editing styles — typography, cut rhythm, motion and framing — reusable across releases.',
    planned: [
      'Create, duplicate, rename and delete presets',
      'Apply to one edit or a whole batch',
      'Import and export as JSON',
      'Changing a preset never alters finished renders'
    ]
  },
  exports: {
    title: 'Exports',
    phase: 6,
    summary: 'The render queue and everything you have exported.',
    planned: [
      'Persistent queue that resumes after a restart',
      'Progress, cancel and retry',
      '1080×1920, 1920×1080 and 1080×1080 MP4',
      'Every output validated before it is marked done'
    ]
  }
}
