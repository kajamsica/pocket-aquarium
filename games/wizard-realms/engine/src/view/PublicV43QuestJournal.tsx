import { projectPublicV43GreenwayQuestChain, projectPublicV43QuestContinuation }
  from '../domain/publicWorldV43GreenwayQuestChain'
import type { PublicV43Progress } from '../domain/publicWorldV43Snapshot'
import type { PublicV35LedgerQuest } from './publicV35LedgerQuest'

const statusLabel = {
  active: 'Open', complete: 'Complete', closed: 'Closed',
} as const

/** Read-only guidance from the checked head; rewards remain owned by world actions. */
export function PublicV43QuestJournal({ head, ledgerQuest }: {
  head: PublicV43Progress; ledgerQuest: PublicV35LedgerQuest
}) {
  const quests = projectPublicV43GreenwayQuestChain(head)
  const continuation = projectPublicV43QuestContinuation(head)
  const next = quests.find((quest) => quest.status === 'active'
    && quest.id !== 'carpenter-order/v1')
  const resolved = quests.filter((quest) => quest.status === 'complete'
    || quest.status === 'closed').length
  return <section aria-label="Greenway quest journal" data-quest-journal="v43">
    <h2>Greenway route</h2>
    {next ? <p><strong>Next: {next.title}.</strong> {next.objective}</p>
      : ledgerQuest.stage !== 'complete'
        ? <p><strong>Next: Outfitters Ledger.</strong> {ledgerQuest.objective}</p>
        : continuation.familiar.stage !== 'mount-ready'
          ? <p><strong>Next: Lost Familiar.</strong> {continuation.familiar.objective}</p>
          : <p>Starter route, Ledger, and familiar care are recorded. The carpenter order remains optional if unclaimed.</p>}
    <details><summary>Starter leads ({resolved}/{quests.length} resolved)</summary>
      <ol>{quests.map((quest) => <li key={quest.id} data-quest-status={quest.status}>
        <strong>{quest.title}: {statusLabel[quest.status]}</strong>
        <p>{quest.objective}</p>
        <small>{quest.existingReward}</small>
      </li>)}</ol>
    </details>
    <details><summary>Later leads</summary>
      <p><strong>Outfitters Ledger, {ledgerQuest.stage}:</strong>{' '}
        {ledgerQuest.objective}</p>
      <p><small>{ledgerQuest.reward}</small></p>
      <p><strong>Lost Familiar, {continuation.familiar.stage}:</strong>{' '}
        {continuation.familiar.objective}</p>
      <p><small>{continuation.familiar.existingReward}</small></p>
    </details>
    <small>Suggested lead order does not lock available actions. Progress follows checked world actions; this journal does not claim extra rewards.</small>
  </section>
}
