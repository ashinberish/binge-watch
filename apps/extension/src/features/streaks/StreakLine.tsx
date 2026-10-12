interface Props {
  episodesToday: number
}

export function StreakLine({ episodesToday }: Props) {
  if (episodesToday < 2) return null
  return <p className="nr-panel__streak">{episodesToday} episodes tonight. Nice run.</p>
}
