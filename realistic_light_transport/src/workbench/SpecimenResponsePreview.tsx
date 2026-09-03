export type ResponseBandName = 'ideal' | 'neutral' | 'poor' | 'critical'

export interface ResponseBandDraft {
  readonly band: ResponseBandName
  readonly conditionMultiplier: number
  readonly stressPerDay: number
}

export function SpecimenResponsePreview({ bands, criticalHazardAfterHours }: {
  readonly bands: readonly ResponseBandDraft[]
  readonly criticalHazardAfterHours: number
}) {
  return (
    <section className="profile-section" aria-labelledby="response-preview-title">
      <header><p>Game calibration</p><h2 id="response-preview-title">Condition response</h2></header>
      <div className="response-bands">
        {bands.map(({ band, conditionMultiplier, stressPerDay }) => (
          <article className={`response-band response-band--${band}`} key={band}>
            <strong>{band}</strong>
            <span>{Math.round(conditionMultiplier * 100)}% condition</span>
            <span>+{Math.round(stressPerDay * 100)}% stress/day</span>
          </article>
        ))}
      </div>
      <p className="critical-note">
        Critical starts cumulative hazard after {criticalHazardAfterHours} hours of continuous exposure.
        Crossing a band boundary never causes instant death.
      </p>
    </section>
  )
}
