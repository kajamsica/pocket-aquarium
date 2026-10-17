import { projectPublicV43GreenwayQuestChain, projectPublicV43QuestContinuation }
  from '../domain/publicWorldV43GreenwayQuestChain'
import type { PublicV43Progress } from '../domain/publicWorldV43Snapshot'
import type { PublicV35LedgerQuest } from './publicV35LedgerQuest'
import type { PublicV40WaystationQuest } from './publicV40WaystationQuest'
import type { PublicV42IronHallQuest } from './publicV42IronHallQuest'
import { projectPublicV43FamiliarQuest } from './PublicV43FamiliarQuest'

const statusLabel = {
  complete: 'Complete', closed: 'Closed',
} as const

export type PublicV43QuestLeads = Readonly<{
  head: PublicV43Progress
  ledgerQuest: PublicV35LedgerQuest
  waystationQuest?: PublicV40WaystationQuest
  ironHallQuest?: PublicV42IronHallQuest | null
}>

/** One suggested lead from checked projections, or null once every lead is recorded. Never a gate. */
export function selectPublicV43QuestLead({ head, ledgerQuest, waystationQuest, ironHallQuest }:
  PublicV43QuestLeads): Readonly<{ id: string; title: string; objective: string }> | null {
  const starter = projectPublicV43GreenwayQuestChain(head).find((quest) =>
    quest.status === 'active' && quest.id !== 'carpenter-order/v1')
  if (starter) return starter
  if (ledgerQuest.stage !== 'complete') return { id: ledgerQuest.id,
    title: 'Outfitters Ledger', objective: ledgerQuest.objective }
  if (waystationQuest && !waystationQuest.complete) return waystationQuest
  const familiar = projectPublicV43QuestContinuation(head).familiar
  if (head.familiar.phase !== 'claimed') return { id: familiar.id,
    title: 'Lost Familiar',
    objective: head.southbankReached
      ? projectPublicV43FamiliarQuest(head)?.objective ?? familiar.objective
      : familiar.objective }
  if (head.southbankReached && ironHallQuest && !ironHallQuest.complete)
    return ironHallQuest
  return familiar.stage !== 'mount-ready'
    ? { id: familiar.id, title: 'Lost Familiar', objective: familiar.objective } : null
}

/** Read-only guidance from the checked head; rewards remain owned by world actions. */
export function PublicV43QuestJournal(leads: PublicV43QuestLeads) {
  const { head, ledgerQuest, waystationQuest, ironHallQuest } = leads
  const quests = projectPublicV43GreenwayQuestChain(head)
  const continuation = projectPublicV43QuestContinuation(head)
  const next = selectPublicV43QuestLead(leads)
  const resolved = quests.filter((quest) => quest.status === 'complete'
    || quest.status === 'closed').length
  return <section aria-label="Greenway quest journal" data-quest-journal="v43">
    <h2>Greenway route</h2>
    {next ? <p><strong>Next: {next.title}.</strong> {next.objective}</p>
      : <p>Starter route, Ledger, and familiar care are recorded. The carpenter order remains optional if unclaimed.</p>}
    <details><summary>Starter leads ({resolved}/{quests.length} resolved)</summary>
      <ol>{quests.map((quest) => <li key={quest.id} data-quest-status={quest.status}>
        <strong>{quest.title}: {quest.status === 'active'
          ? quest.id === next?.id ? 'Next'
            : quest.id === 'carpenter-order/v1' ? 'Optional' : 'Suggested'
          : statusLabel[quest.status]}</strong>
        <p>{quest.objective}</p>
        <small>{quest.existingReward}</small>
      </li>)}</ol>
    </details>
    <details><summary>Later leads</summary>
      <p><strong>Outfitters Ledger, {ledgerQuest.stage}:</strong>{' '}
        {ledgerQuest.objective}</p>
      <p><small>{ledgerQuest.reward}</small></p>
      {waystationQuest && <><p><strong>{waystationQuest.title}, {waystationQuest.stage}:</strong>{' '}
        {waystationQuest.objective}</p>
      <p><small>{waystationQuest.reward}</small></p></>}
      {ironHallQuest && <><p><strong>{ironHallQuest.title}, {ironHallQuest.next}:</strong>{' '}
        {ironHallQuest.objective}</p>
      <p><small>{ironHallQuest.reward}</small></p></>}
      <p><strong>Lost Familiar, {continuation.familiar.stage === 'mount-ready'
        ? 'mature companion' : continuation.familiar.stage}:</strong>{' '}
        {continuation.familiar.objective}</p>
      <p><small>{continuation.familiar.existingReward}</small></p>
    </details>
    <small>Suggested lead order does not lock available actions. Progress follows checked world actions; this journal does not claim extra rewards.</small>
  </section>
}
