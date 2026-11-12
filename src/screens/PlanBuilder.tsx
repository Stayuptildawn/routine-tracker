import { useState } from 'react'
import { t } from '../i18n'
import { Button, Chips, Panel } from '../components/ui'
import ExerciseList from '../components/ExerciseList'
import { buildPlan, MAX_DAYS, MIN_DAYS } from '../lib/planBuilder'
import type { BuiltPlan, PlanFocus } from '../lib/planBuilder'
import type { FlexLength } from '../lib/flexSession'

const FOCUS_LABEL: Record<PlanFocus, string> = {
  upper: t.gym.flex.upper,
  lower: t.gym.flex.lower,
  full: t.gym.flex.fullBody,
  push: t.gym.builder.push,
  pull: t.gym.builder.pull,
  legs: t.gym.builder.legs,
}

/** "Upper A", "Lower", "Full body" - what each day of a built plan is called,
 *  in the user's language. These become the plan's session names. */
export function sessionNames(plan: BuiltPlan): string[] {
  return plan.days.map((d) => (d.letter ? `${FOCUS_LABEL[d.focus]} ${d.letter}` : FOCUS_LABEL[d.focus]))
}

const DAY_OPTIONS = Array.from({ length: MAX_DAYS - MIN_DAYS + 1 }, (_, i) => ({ value: MIN_DAYS + i, label: MIN_DAYS + i }))
const LENGTH_OPTIONS: { value: FlexLength; label: string }[] = [
  { value: 'short', label: t.gym.flex.short },
  { value: 'full', label: t.gym.flex.long },
]

/** Two questions - how many days, how long - and the week they add up to,
 *  shown as it is picked. Nothing is saved until Create. */
export default function PlanBuilder({ busy, onCreate }: { busy: boolean; onCreate: (plan: BuiltPlan, names: string[]) => void }) {
  const [days, setDays] = useState(3)
  const [length, setLength] = useState<FlexLength>('full')
  const [variant, setVariant] = useState(0)

  const plan = buildPlan({ days, length, variant })
  const names = sessionNames(plan)

  return (
    <div className="stack">
      <p className="hint">{t.gym.builder.intro}</p>
      <div className="field">
        <span className="field__label">{t.gym.builder.daysLabel}</span>
        <Chips label={t.gym.builder.daysLabel} value={days} onChange={setDays} disabled={busy} options={DAY_OPTIONS} />
      </div>
      <div className="field">
        <span className="field__label">{t.gym.flex.lengthLabel}</span>
        <Chips label={t.gym.flex.lengthLabel} value={length} onChange={setLength} disabled={busy} options={LENGTH_OPTIONS} />
      </div>
      <p className="hint">{t.gym.flex.weekWhy}</p>
      {plan.days.map((day, i) => (
        <Panel key={i} title={names[i]} meta={t.gym.flex.sets(day.sets)}>
          <ExerciseList
            items={day.exercises.map((x) => ({ exercise: x.exercise, scheme: x.schemes['1-2'], muscle: x.muscle_group }))}
          />
        </Panel>
      ))}
      <div className="actions">
        <Button variant="primary" busy={busy} onClick={() => onCreate(plan, names)}>
          {busy ? t.gym.settingUp : t.gym.builder.create}
        </Button>
        <Button icon="shuffle" disabled={busy} onClick={() => setVariant(variant + 1)}>
          {t.gym.flex.anotherMix}
        </Button>
      </div>
    </div>
  )
}
