import { useState } from 'react'

export type AquariumLibraryTank = {
  id: string
  name: string
  habitat: 'reef' | 'amazon' | null
  active: boolean
}

export type AquariumLibraryModel = {
  tanks: AquariumLibraryTank[]
  onCreate(): void
  onActivate(id: string): void
  onRename(id: string, name: string): void
  onEraseAll?(): void
}

function waterType(habitat: AquariumLibraryTank['habitat']) {
  if (habitat === 'reef') return 'Saltwater'
  if (habitat === 'amazon') return 'Freshwater'
  return 'Not set up'
}

export function AquariumLibraryPanel({ model }: { readonly model: AquariumLibraryModel }) {
  const [confirmingErase, setConfirmingErase] = useState(false)

  return <section className="pocket-aquarium-library" aria-label="Your aquariums">
    <div className="pocket-library-summary">
      <div><p>Aquarium library</p><strong>{model.tanks.length} {model.tanks.length === 1 ? 'tank' : 'tanks'}</strong></div>
      <button className="hud-button hud-button-primary" type="button" onClick={model.onCreate}>New tank</button>
    </div>
    {model.tanks.length ? <ul className="pocket-library-list">{model.tanks.map((tank) =>
      <li key={tank.id} data-active={tank.active}>
        <div className="pocket-library-identity">
          <strong>{tank.name}</strong>
          <span><small>{waterType(tank.habitat)}</small>{tank.active ? <b>Active</b> : null}</span>
        </div>
        <button className="hud-button" type="button" disabled={tank.active}
          onClick={() => model.onActivate(tank.id)}>{tank.active ? 'Current' : 'Switch'}</button>
        <form onSubmit={(event) => {
          event.preventDefault()
          const input = event.currentTarget.elements.namedItem('tankName')
          if (!(input instanceof HTMLInputElement)) return
          const name = input.value.trim()
          if (name && name !== tank.name) model.onRename(tank.id, name)
        }}>
          <label htmlFor={`aquarium-name-${tank.id}`}>Tank name</label>
          <input key={`${tank.id}:${tank.name}`} id={`aquarium-name-${tank.id}`} name="tankName"
            type="text" defaultValue={tank.name} maxLength={24} autoComplete="off" />
          <button className="hud-button" type="submit">Rename</button>
        </form>
      </li>)}</ul> : <p className="pocket-empty-state">No aquariums yet. Start a new tank to choose its water type.</p>}
    <div className="pocket-library-danger">
      {confirmingErase ? <div role="alertdialog" aria-labelledby="erase-aquarium-data-title"
        aria-describedby="erase-aquarium-data-description">
        <strong id="erase-aquarium-data-title">Permanently erase all aquarium data?</strong>
        <p id="erase-aquarium-data-description">Every tank and local preference on this device will be deleted. This cannot be undone.</p>
        <div>
          <button className="hud-button" type="button" autoFocus onClick={() => setConfirmingErase(false)}>Cancel</button>
          <button className="hud-button pocket-destructive-action" type="button" onClick={model.onEraseAll}>Erase everything</button>
        </div>
      </div> : <button className="hud-button pocket-destructive-action" type="button"
        onClick={() => setConfirmingErase(true)}>Erase all aquarium data</button>}
    </div>
  </section>
}
