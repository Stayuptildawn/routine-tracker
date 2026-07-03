/** Calm placeholder cards shown while a screen loads. Slow opacity pulse,
 * no shimmer sweep — and prefers-reduced-motion stills it entirely. */
export default function Skeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="skel-card">
          <div className="skel skel-line w40" />
          <div className="skel skel-line w80" />
          <div className="skel skel-line w60" />
        </div>
      ))}
    </div>
  )
}
