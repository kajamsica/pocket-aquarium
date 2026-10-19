export type AtomicV8Record = { saveRevision: number; value: unknown }
export type AtomicV8Lineage = { sourceV7Bytes: string | null }
export type AtomicV8Read =
  | { status: 'ok'; head: AtomicV8Record | null; previous: AtomicV8Record | null; lineage: AtomicV8Lineage | null }
  | { status: 'storage-error' }
export type AtomicV8Write = 'committed' | 'revision-changed' | 'lineage-changed' | 'invalid' | 'storage-error'

const STORE = 'records'
const validRevision = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const validLineage = (value: unknown): value is AtomicV8Lineage =>
  value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === 1 &&
  (typeof (value as AtomicV8Lineage).sourceV7Bytes === 'string' ||
    (value as AtomicV8Lineage).sourceV7Bytes === null)

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1)
    let blocked = false
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onerror = () => reject(request.error)
    request.onblocked = () => { blocked = true; reject(new Error('IndexedDB upgrade blocked')) }
    request.onsuccess = () => {
      if (blocked) request.result.close()
      else resolve(request.result)
    }
  })
}

function writeTransaction(db: IDBDatabase): IDBTransaction {
  try {
    return db.transaction(STORE, 'readwrite', { durability: 'strict' })
  } catch (error) {
    if (!(error instanceof TypeError) &&
      !(error instanceof DOMException && error.name === 'NotSupportedError')) throw error
    return db.transaction(STORE, 'readwrite')
  }
}

export function createAtomicV8Store(factory: IDBFactory, name = 'wizard-realms:world:v8') {
  return {
    async read(): Promise<AtomicV8Read> {
      let db: IDBDatabase | undefined
      try {
        db = await openDatabase(factory, name)
        return await new Promise<AtomicV8Read>((resolve) => {
          const transaction = db!.transaction(STORE, 'readonly')
          const records = transaction.objectStore(STORE)
          const head = records.get('head')
          const previous = records.get('previous')
          const lineage = records.get('lineage')
          transaction.oncomplete = () => resolve({ status: 'ok',
            head: head.result ?? null, previous: previous.result ?? null, lineage: lineage.result ?? null })
          transaction.onabort = () => resolve({ status: 'storage-error' })
        })
      } catch {
        return { status: 'storage-error' }
      } finally {
        db?.close()
      }
    },

    async commit(expectedRevision: number | null, expectedLineage: AtomicV8Lineage | null,
      next: AtomicV8Record, initialLineage?: AtomicV8Lineage): Promise<AtomicV8Write> {
      if (!next || !validRevision(next.saveRevision) || !Object.hasOwn(next, 'value')) return 'invalid'
      if (expectedRevision === null) {
        if (expectedLineage !== null || !validLineage(initialLineage) || next.saveRevision !== 0) return 'invalid'
      } else if (!validRevision(expectedRevision) || !validLineage(expectedLineage) ||
        initialLineage !== undefined || next.saveRevision !== expectedRevision + 1) return 'invalid'

      let db: IDBDatabase | undefined
      try {
        db = await openDatabase(factory, name)
        return await new Promise<AtomicV8Write>((resolve) => {
          const transaction = writeTransaction(db!)
          const records = transaction.objectStore(STORE)
          let result: AtomicV8Write = 'storage-error'
          transaction.oncomplete = () => resolve(result)
          transaction.onabort = () => resolve('storage-error')
          const head = records.get('head')
          const lineage = records.get('lineage')
          const lastRead = expectedRevision === null ? records.get('previous') : lineage
          lastRead.onsuccess = () => {
            const prior = head.result as AtomicV8Record | undefined
            const source = lineage.result as AtomicV8Lineage | undefined
            if ((prior === undefined ? null : prior.saveRevision) !== expectedRevision) {
              result = 'revision-changed'
              return
            }
            if (expectedRevision === null ? source !== undefined :
              !source || source.sourceV7Bytes !== expectedLineage!.sourceV7Bytes) {
              result = 'lineage-changed'
              return
            }
            if (expectedRevision === null && lastRead.result !== undefined) {
              result = 'invalid'
              return
            }
            try {
              records.put({ saveRevision: next.saveRevision, value: next.value }, 'head')
              if (prior !== undefined) records.put(prior, 'previous')
              if (expectedRevision === null) records.put({ sourceV7Bytes: initialLineage!.sourceV7Bytes }, 'lineage')
              result = 'committed'
            } catch {
              transaction.abort()
            }
          }
        })
      } catch {
        return 'storage-error'
      } finally {
        db?.close()
      }
    },
  }
}
