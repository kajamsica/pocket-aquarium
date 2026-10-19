import {
  inspectPublicV7Artifacts, loadPublicV7Root, parsePublicV7PlayableRoot,
} from './publicWorldV7'
import type { PublicV7PlayableRoot } from './publicWorldV7'

export type PublicV8SourceInspection =
  | { status: 'same'; root: PublicV7PlayableRoot }
  | { status: 'invalid-expected-source' | 'invalid-v7-root' | 'source-changed'
    | 'pending-v7-stage' | 'invalid-v7-backup' | 'storage-error' }

/** Caller holds PUBLIC_V7_LOCK_NAME for the complete v8 operation. */
export function inspectV7SourceForV8(
  storage: Pick<Storage, 'getItem'>, expectedV7Bytes: string,
): PublicV8SourceInspection {
  if (!parsePublicV7PlayableRoot(expectedV7Bytes)) return { status: 'invalid-expected-source' }
  const current = loadPublicV7Root(storage)
  if (current.status === 'invalid') return { status: 'invalid-v7-root' }
  if (current.status === 'storage-error' || current.status === 'source-changed') return { status: current.status }
  if (current.status !== 'valid-playable' || current.bytes !== expectedV7Bytes) return { status: 'source-changed' }
  const artifacts = inspectPublicV7Artifacts(storage)
  if (artifacts.status === 'storage-error') return { status: 'storage-error' }
  if (artifacts.stage.status === 'pending' || artifacts.stage.status === 'invalid') {
    return { status: 'pending-v7-stage' }
  }
  if (artifacts.backup.status === 'invalid') return { status: 'invalid-v7-backup' }
  return { status: 'same', root: current.root }
}
