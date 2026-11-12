// The content translator (lib/contentMaps.ts) maps seeded data between
// language packs BY POSITION - these tests pin the invariant that makes that
// safe: every pack's seed is shape-identical to English, cue keys match, and
// block names cover the same numbers.
import { describe, expect, it } from 'vitest'
import { languages } from '../src/i18n'
import { buildContentMaps } from '../src/lib/contentMaps'

const packs = Object.entries(languages)

describe('language packs are position-parallel', () => {
  it('same routine count and task counts per routine as English', () => {
    const en = languages.en
    for (const key of ['seed', 'seedLegacy'] as const) {
      for (const [id, pack] of packs) {
        expect(pack[key].length, `${id}.${key} length`).toBe(en[key].length)
        pack[key].forEach((routine, i) => {
          expect(routine.tasks.length, `${id}.${key}[${i}] (${routine.name}) task count`).toBe(en[key][i].tasks.length)
          expect(routine.category, `${id}.${key}[${i}] category`).toBe(en[key][i].category)
          expect(routine.active ?? true, `${id}.${key}[${i}] active`).toBe(en[key][i].active ?? true)
          routine.tasks.forEach((task, j) => {
            expect(task.tier, `${id}.${key}[${i}].tasks[${j}] tier`).toBe(en[key][i].tasks[j].tier)
            expect(task.days, `${id}.${key}[${i}].tasks[${j}] days`).toEqual(en[key][i].tasks[j].days)
          })
        })
      }
    }
  })
  it('a string kept from the old seed translates the same way in the new one', () => {
    // the translator takes the first mapping it finds, so a label that sits in
    // both seeds must lead to one and the same string in every other pack
    const pairs = (key: 'seed' | 'seedLegacy', from: string, to: string) => {
      const names = new Map<string, string>()
      const labels = new Map<string, string>()
      languages[from][key].forEach((routine, i) => {
        names.set(routine.name, languages[to][key][i].name)
        routine.tasks.forEach((task, j) => labels.set(task.label, languages[to][key][i].tasks[j].label))
      })
      return { names, labels }
    }
    for (const from of Object.keys(languages)) {
      for (const to of Object.keys(languages)) {
        const now = pairs('seed', from, to)
        const then = pairs('seedLegacy', from, to)
        for (const [name, target] of now.names) {
          if (then.names.has(name)) expect(then.names.get(name), `${from}->${to} routine "${name}"`).toBe(target)
        }
        for (const [label, target] of now.labels) {
          if (then.labels.has(label)) expect(then.labels.get(label), `${from}->${to} task "${label}"`).toBe(target)
        }
      }
    }
  })
  it('same cue keys and block numbers as English', () => {
    const en = languages.en
    for (const [id, pack] of packs) {
      expect(Object.keys(pack.cues).sort(), `${id}.cues keys`).toEqual(Object.keys(en.cues).sort())
      expect(Object.keys(pack.blocks.names).sort(), `${id}.blocks.names keys`).toEqual(
        Object.keys(en.blocks.names).sort(),
      )
    }
  })
})

describe('buildContentMaps', () => {
  it('maps seeded strings from any pack to the target pack', () => {
    const toFa = buildContentMaps('fa')
    expect(toFa.routineNames.get('Morning Routine')).toBe(languages.fa.seed[0].name)
    expect(toFa.routineNames.get(languages.de.seed[0].name)).toBe(languages.fa.seed[0].name)
    expect(toFa.taskLabels.get('🛏 Make the bed')).toBe(languages.fa.seed[0].tasks[1].label)
    expect(toFa.cueTexts.get(languages.en.cues['Leg Press'])).toBe(languages.fa.cues['Leg Press'])
    expect(toFa.blockNames.get('Block 1 — PPL')).toBe(languages.fa.blocks.names[1])
  })
  it('round-trips: translating there and back restores the original', () => {
    const toZh = buildContentMaps('zh')
    const backToEn = buildContentMaps('en')
    const zhName = toZh.routineNames.get('Bedtime Routine')!
    expect(backToEn.routineNames.get(zhName)).toBe('Bedtime Routine')
  })
  it('still maps what accounts seeded before the 2026-11 refresh hold', () => {
    const toFa = buildContentMaps('fa')
    expect(toFa.routineNames.get('Drink Water')).toBe(languages.fa.seedLegacy[3].name)
    expect(toFa.taskLabels.get('💊 Take medication')).toBe(languages.fa.seedLegacy[0].tasks[2].label)
    expect(toFa.taskLabels.get(languages.ja.seedLegacy[0].tasks[4].label)).toBe(languages.fa.seedLegacy[0].tasks[4].label)
  })
  it('knows nothing about user-written content', () => {
    const toFr = buildContentMaps('fr')
    expect(toFr.routineNames.get('My Custom Routine')).toBeUndefined()
    expect(toFr.taskLabels.get('water the plants')).toBeUndefined()
  })
})
