// Server-side language support. The client stores its i18n pack id in
// user_settings.language; everything the server writes or pushes as text
// (nudge bodies, deterministic query answers, the reflection prompt's target
// language) resolves through here. Pure data + pure functions, no Deno APIs.

export const KNOWN_LANGS = ['en', 'fr', 'es', 'de', 'zh', 'ar', 'fa', 'tr', 'ru', 'cs', 'ja'] as const
export type Lang = (typeof KNOWN_LANGS)[number]

/** Anything (body param, db value, null) -> a known pack id, default en. */
export function normLang(raw: unknown): Lang {
  const s = String(raw ?? '').toLowerCase().slice(0, 2)
  return (KNOWN_LANGS as readonly string[]).includes(s) ? (s as Lang) : 'en'
}

/** What to call the language inside a Gemini prompt. */
export const LANGUAGE_NAMES: Record<Lang, string> = {
  en: 'English',
  fr: 'French',
  es: 'Spanish',
  de: 'German',
  zh: 'Simplified Chinese',
  ar: 'Arabic',
  fa: 'Persian (Farsi)',
  tr: 'Turkish',
  ru: 'Russian',
  cs: 'Czech',
  ja: 'Japanese',
}

interface ServerStrings {
  // push nudges (send-nudges)
  routineReady: (name: string) => string
  dueToday: (text: string, more: number) => string
  reflectHeadsUp: string
  // deterministic query answers (interpret core)
  nothingOnHold: string
  onHold: (list: string) => string
  byDue: (date: string, time: string) => string // " (by 2026-07-20 18:00)"
  lastDone: (label: string, when: string) => string
  noRecord: (label: string) => string
  nothingLoggedFor: (exercise: string) => string
  lastWorkout: (exercise: string, when: string, sets: string) => string
  today: string
  yesterday: string
  daysAgo: (n: number, date: string) => string
}

export const SERVER_STRINGS: Record<Lang, ServerStrings> = {
  en: {
    routineReady: (name) => `${name} is ready when you are.`,
    dueToday: (text, more) => `🔔 Due today: ${text}${more > 0 ? ` (+${more} more)` : ''}`,
    reflectHeadsUp: "Tonight's reflection reads the day at 22:00 — a good moment to log anything still floating around.",
    nothingOnHold: 'Nothing on hold.',
    onHold: (list) => `On hold: ${list}.`,
    byDue: (date, time) => ` (by ${date}${time ? ` ${time}` : ''})`,
    lastDone: (label, when) => `${label}: last done ${when}.`,
    noRecord: (label) => `${label}: no record of it yet.`,
    nothingLoggedFor: (exercise) => `${exercise}: nothing logged yet.`,
    lastWorkout: (exercise, when, sets) => `${exercise}, ${when}${sets ? `: ${sets}` : ''}.`,
    today: 'today',
    yesterday: 'yesterday',
    daysAgo: (n, date) => `${n} days ago (${date})`,
  },
  fr: {
    routineReady: (name) => `${name} vous attend, quand vous voulez.`,
    dueToday: (text, more) => `🔔 Pour aujourd’hui : ${text}${more > 0 ? ` (+${more} autres)` : ''}`,
    reflectHeadsUp: 'Le bilan du soir lit la journée à 22 h — bon moment pour noter ce qui traîne encore.',
    nothingOnHold: 'Rien en attente.',
    onHold: (list) => `En attente : ${list}.`,
    byDue: (date, time) => ` (pour le ${date}${time ? ` ${time}` : ''})`,
    lastDone: (label, when) => `${label} : fait pour la dernière fois ${when}.`,
    noRecord: (label) => `${label} : aucune trace pour l’instant.`,
    nothingLoggedFor: (exercise) => `${exercise} : rien d’enregistré pour l’instant.`,
    lastWorkout: (exercise, when, sets) => `${exercise}, ${when}${sets ? ` : ${sets}` : ''}.`,
    today: 'aujourd’hui',
    yesterday: 'hier',
    daysAgo: (n, date) => `il y a ${n} jours (${date})`,
  },
  es: {
    routineReady: (name) => `${name} te espera cuando quieras.`,
    dueToday: (text, more) => `🔔 Para hoy: ${text}${more > 0 ? ` (+${more} más)` : ''}`,
    reflectHeadsUp: 'La reflexión de esta noche lee el día a las 22:00 — buen momento para anotar lo que quede suelto.',
    nothingOnHold: 'Nada en espera.',
    onHold: (list) => `En espera: ${list}.`,
    byDue: (date, time) => ` (para el ${date}${time ? ` ${time}` : ''})`,
    lastDone: (label, when) => `${label}: hecho por última vez ${when}.`,
    noRecord: (label) => `${label}: sin registro todavía.`,
    nothingLoggedFor: (exercise) => `${exercise}: nada registrado todavía.`,
    lastWorkout: (exercise, when, sets) => `${exercise}, ${when}${sets ? `: ${sets}` : ''}.`,
    today: 'hoy',
    yesterday: 'ayer',
    daysAgo: (n, date) => `hace ${n} días (${date})`,
  },
  de: {
    routineReady: (name) => `${name} ist bereit, wann immer du willst.`,
    dueToday: (text, more) => `🔔 Heute fällig: ${text}${more > 0 ? ` (+${more} weitere)` : ''}`,
    reflectHeadsUp: 'Der Abendrückblick liest den Tag um 22:00 — ein guter Moment, um Offenes noch einzutragen.',
    nothingOnHold: 'Nichts in der Warteschleife.',
    onHold: (list) => `In der Warteschleife: ${list}.`,
    byDue: (date, time) => ` (bis ${date}${time ? ` ${time}` : ''})`,
    lastDone: (label, when) => `${label}: zuletzt erledigt ${when}.`,
    noRecord: (label) => `${label}: bisher kein Eintrag.`,
    nothingLoggedFor: (exercise) => `${exercise}: bisher nichts protokolliert.`,
    lastWorkout: (exercise, when, sets) => `${exercise}, ${when}${sets ? `: ${sets}` : ''}.`,
    today: 'heute',
    yesterday: 'gestern',
    daysAgo: (n, date) => `vor ${n} Tagen (${date})`,
  },
  zh: {
    routineReady: (name) => `${name}准备好了，随时可以开始。`,
    dueToday: (text, more) => `🔔 今天到期：${text}${more > 0 ? `（另有 ${more} 条）` : ''}`,
    reflectHeadsUp: '今晚 22:00 的回顾会读取今天的记录——现在正好把还没记的补上。',
    nothingOnHold: '暂无待办提醒。',
    onHold: (list) => `待办中：${list}。`,
    byDue: (date, time) => `（截止 ${date}${time ? ` ${time}` : ''}）`,
    lastDone: (label, when) => `${label}：上次完成是${when}。`,
    noRecord: (label) => `${label}：还没有记录。`,
    nothingLoggedFor: (exercise) => `${exercise}：还没有记录。`,
    lastWorkout: (exercise, when, sets) => `${exercise}，${when}${sets ? `：${sets}` : ''}。`,
    today: '今天',
    yesterday: '昨天',
    daysAgo: (n, date) => `${n} 天前（${date}）`,
  },
  ar: {
    routineReady: (name) => `${name} جاهز متى كنت مستعدًا.`,
    dueToday: (text, more) => `🔔 مستحق اليوم: ${text}${more > 0 ? ` (+${more} غيرها)` : ''}`,
    reflectHeadsUp: 'تأمّل الليلة يقرأ اليوم في 22:00 — لحظة مناسبة لتسجيل ما لم يُسجَّل بعد.',
    nothingOnHold: 'لا شيء قيد الانتظار.',
    onHold: (list) => `قيد الانتظار: ${list}.`,
    byDue: (date, time) => ` (بحلول ${date}${time ? ` ${time}` : ''})`,
    lastDone: (label, when) => `${label}: آخر إنجاز ${when}.`,
    noRecord: (label) => `${label}: لا سجلّ له بعد.`,
    nothingLoggedFor: (exercise) => `${exercise}: لا شيء مسجّل بعد.`,
    lastWorkout: (exercise, when, sets) => `${exercise}، ${when}${sets ? `: ${sets}` : ''}.`,
    today: 'اليوم',
    yesterday: 'أمس',
    daysAgo: (n, date) => `قبل ${n} أيام (${date})`,
  },
  fa: {
    routineReady: (name) => `${name} آماده است؛ هر وقت خودت آماده بودی.`,
    dueToday: (text, more) => `🔔 موعد امروز: ${text}${more > 0 ? ` (+${more} مورد دیگر)` : ''}`,
    reflectHeadsUp: 'مرور امشب ساعت ۲۲:۰۰ روزت را می‌خواند — الان وقت خوبی است هر چه مانده را ثبت کنی.',
    nothingOnHold: 'چیزی در انتظار نیست.',
    onHold: (list) => `در انتظار: ${list}.`,
    byDue: (date, time) => ` (تا ${date}${time ? ` ${time}` : ''})`,
    lastDone: (label, when) => `${label}: آخرین بار ${when} انجام شد.`,
    noRecord: (label) => `${label}: هنوز رکوردی ندارد.`,
    nothingLoggedFor: (exercise) => `${exercise}: هنوز چیزی ثبت نشده.`,
    lastWorkout: (exercise, when, sets) => `${exercise}، ${when}${sets ? `: ${sets}` : ''}.`,
    today: 'امروز',
    yesterday: 'دیروز',
    daysAgo: (n, date) => `${n} روز پیش (${date})`,
  },
  tr: {
    routineReady: (name) => `${name} hazır; sen ne zaman istersen.`,
    dueToday: (text, more) => `🔔 Bugün için: ${text}${more > 0 ? ` (+${more} tane daha)` : ''}`,
    reflectHeadsUp: 'Bu akşamki değerlendirme günü 22:00\'de okuyor — aklında kalanları not etmek için iyi bir an.',
    nothingOnHold: 'Beklemede bir şey yok.',
    onHold: (list) => `Beklemede: ${list}.`,
    byDue: (date, time) => ` (son: ${date}${time ? ` ${time}` : ''})`,
    lastDone: (label, when) => `${label}: en son ${when} yapıldı.`,
    noRecord: (label) => `${label}: henüz kaydı yok.`,
    nothingLoggedFor: (exercise) => `${exercise}: henüz bir kayıt yok.`,
    lastWorkout: (exercise, when, sets) => `${exercise}, ${when}${sets ? `: ${sets}` : ''}.`,
    today: 'bugün',
    yesterday: 'dün',
    daysAgo: (n, date) => `${n} gün önce (${date})`,
  },
  ru: {
    routineReady: (name) => `${name} ждёт — начинай, когда захочешь.`,
    dueToday: (text, more) => `🔔 На сегодня: ${text}${more > 0 ? ` (+ещё ${more})` : ''}`,
    reflectHeadsUp: 'Вечерняя рефлексия читает день в 22:00 — самое время записать то, что ещё не записано.',
    nothingOnHold: 'Ничего не отложено.',
    onHold: (list) => `Отложено: ${list}.`,
    byDue: (date, time) => ` (до ${date}${time ? ` ${time}` : ''})`,
    lastDone: (label, when) => `${label}: последний раз — ${when}.`,
    noRecord: (label) => `${label}: записей пока нет.`,
    nothingLoggedFor: (exercise) => `${exercise}: пока ничего не записано.`,
    lastWorkout: (exercise, when, sets) => `${exercise}, ${when}${sets ? `: ${sets}` : ''}.`,
    today: 'сегодня',
    yesterday: 'вчера',
    daysAgo: (n, date) => `${n} дн. назад (${date})`,
  },
  cs: {
    routineReady: (name) => `${name} čeká — začni, kdy budeš chtít.`,
    dueToday: (text, more) => `🔔 Dnes má termín: ${text}${more > 0 ? ` (+${more} dalších)` : ''}`,
    reflectHeadsUp: 'Večerní reflexe čte den ve 22:00 — dobrá chvíle zapsat, co ještě zbývá.',
    nothingOnHold: 'Nic nečeká.',
    onHold: (list) => `Čeká: ${list}.`,
    byDue: (date, time) => ` (do ${date}${time ? ` ${time}` : ''})`,
    lastDone: (label, when) => `${label}: naposledy ${when}.`,
    noRecord: (label) => `${label}: zatím žádný záznam.`,
    nothingLoggedFor: (exercise) => `${exercise}: zatím nic nezapsáno.`,
    lastWorkout: (exercise, when, sets) => `${exercise}, ${when}${sets ? `: ${sets}` : ''}.`,
    today: 'dnes',
    yesterday: 'včera',
    daysAgo: (n, date) => `před ${n} dny (${date})`,
  },
  ja: {
    routineReady: (name) => `${name}の準備ができています。いつでもどうぞ。`,
    dueToday: (text, more) => `🔔 今日が期限：${text}${more > 0 ? `（ほか ${more} 件）` : ''}`,
    reflectHeadsUp: '今夜のふりかえりは22:00に一日を読み取ります — まだ記録していないことを書き留めるのによい頃合いです。',
    nothingOnHold: '保留中のものはありません。',
    onHold: (list) => `保留中：${list}。`,
    byDue: (date, time) => `（${date}${time ? ` ${time}` : ''} まで）`,
    lastDone: (label, when) => `${label}：最後に行ったのは${when}です。`,
    noRecord: (label) => `${label}：まだ記録がありません。`,
    nothingLoggedFor: (exercise) => `${exercise}：まだ記録がありません。`,
    lastWorkout: (exercise, when, sets) => `${exercise}、${when}${sets ? `：${sets}` : ''}。`,
    today: '今日',
    yesterday: '昨日',
    daysAgo: (n, date) => `${n} 日前（${date}）`,
  },
}
