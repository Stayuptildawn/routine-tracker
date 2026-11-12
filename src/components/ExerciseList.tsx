import { t } from '../i18n'

export interface ExerciseItem {
  exercise: string
  /** "3 x 8-10" */
  scheme: string | null
  /** stored muscle-group value; shown through the language pack */
  muscle: string
}

/** The lifts of one session as quiet rows: the name, sets x reps beside it,
 *  the muscle at the end. Used wherever a session is proposed before it
 *  exists (the plan builder, the flexible session). */
export default function ExerciseList({ items }: { items: ExerciseItem[] }) {
  return (
    <div className="rows">
      {items.map((x, i) => (
        <div key={i} className="row gym__entry">
          <span className="row__main">
            <strong>{x.exercise}</strong> <span className="mono">{x.scheme}</span>
          </span>
          <span className="badge">{t.muscles[x.muscle] ?? x.muscle}</span>
        </div>
      ))}
    </div>
  )
}
