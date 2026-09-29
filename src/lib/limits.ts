/** Length caps for every free-text field. The CSS wraps anything that gets
 *  through (body { overflow-wrap: anywhere }); these keep a single entry from
 *  turning into a wall of text that buries the controls around it. */
export const MAX_LEN = {
  /** routine and gym session names - they head a card */
  name: 60,
  /** task labels, exercise names, cardio lines - one row each */
  label: 120,
  /** reps schemes like "8-12" or "AMRAP" */
  reps: 20,
  /** reminders and exercise notes */
  note: 300,
  /** the Now composer - a message, not an essay */
  message: 2000,
} as const
