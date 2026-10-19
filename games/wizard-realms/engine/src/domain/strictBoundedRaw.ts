/** Conservative equality for a detached IndexedDB record, never a validity proof. */
const viewPrototype = Object.getPrototypeOf(Uint8Array.prototype)
const viewBrand = Object.getOwnPropertyDescriptor(viewPrototype, Symbol.toStringTag)!.get!
const viewBuffer = Object.getOwnPropertyDescriptor(viewPrototype, 'buffer')!.get!
const viewOffset = Object.getOwnPropertyDescriptor(viewPrototype, 'byteOffset')!.get!
const bufferBytes = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!
const bufferMaxBytes = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'maxByteLength')?.get
const bufferResizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get

export function sameStrictBoundedRaw(left: unknown, right: unknown,
  limit = 1 << 20): boolean {
  // One entry retains two private copies. Older callers keep the one MiB cap.
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > (3 << 20)) return false
  let estimatedBytes = 0
  const leftSeen = new WeakSet<object>(), rightSeen = new WeakSet<object>()
  const charge = (amount: number) => (estimatedBytes += amount) <= limit
  const equal = (a: unknown, b: unknown): boolean => {
    if (a === null || b === null) return a === null && b === null && charge(4)
    if (typeof a !== typeof b) return false
    if (typeof a === 'string') return a === b && charge(8 + a.length * 2)
    if (typeof a === 'number') return Object.is(a, b) && charge(8)
    if (typeof a === 'boolean') return a === b && charge(4)
    if (typeof a !== 'object' || typeof b !== 'object') return false
    if (leftSeen.has(a) || rightSeen.has(b)) return false
    leftSeen.add(a); rightSeen.add(b)
    if (a instanceof Uint8Array || b instanceof Uint8Array) {
      if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)
        || !ArrayBuffer.isView(a) || !ArrayBuffer.isView(b)
        || viewBrand.call(a) !== 'Uint8Array' || viewBrand.call(b) !== 'Uint8Array') return false
      const aBacking = viewBuffer.call(a), bBacking = viewBuffer.call(b)
      if (Object.getPrototypeOf(aBacking) !== ArrayBuffer.prototype
        || Object.getPrototypeOf(bBacking) !== ArrayBuffer.prototype) return false
      const aBytes = bufferBytes.call(aBacking), bBytes = bufferBytes.call(bBacking)
      if (Object.getPrototypeOf(a) !== Uint8Array.prototype
        || Object.getPrototypeOf(b) !== Uint8Array.prototype
        || Object.isExtensible(a) !== Object.isExtensible(b)
        || viewOffset.call(a) !== 0 || viewOffset.call(b) !== 0
        || aBytes !== a.byteLength || bBytes !== b.byteLength
        || aBytes !== bBytes || bufferMaxBytes && (bufferMaxBytes.call(aBacking) !== aBytes
          || bufferMaxBytes.call(bBacking) !== bBytes)
        || bufferResizable && (bufferResizable.call(aBacking) || bufferResizable.call(bBacking))
        || Reflect.ownKeys(aBacking).length !== 0 || Reflect.ownKeys(bBacking).length !== 0
        || a.length !== b.length || !charge(32 + aBytes)
        || Reflect.ownKeys(a).length !== a.length || Reflect.ownKeys(b).length !== b.length)
        return false
      // Native indexed descriptors are fixed; key counts exclude extra own properties.
      for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false
      return true
    }
    const array = Array.isArray(a)
    if (array !== Array.isArray(b)
      || Object.getPrototypeOf(a) !== (array ? Array.prototype : Object.prototype)
      || Object.getPrototypeOf(b) !== (array ? Array.prototype : Object.prototype)
      || Object.isExtensible(a) !== Object.isExtensible(b) || !charge(32)) return false
    const keys = Reflect.ownKeys(a), otherKeys = Reflect.ownKeys(b)
    if (keys.length !== otherKeys.length) return false
    for (const key of keys) {
      if (typeof key !== 'string' || !Object.hasOwn(b, key)
        || !charge(16 + key.length * 2)) return false
      const first = Object.getOwnPropertyDescriptor(a, key)
      const second = Object.getOwnPropertyDescriptor(b, key)
      if (!first || !second || !('value' in first) || !('value' in second)
        || first.enumerable !== second.enumerable
        || first.configurable !== second.configurable
        || first.writable !== second.writable
        || !equal(first.value, second.value)) return false
    }
    return true
  }
  try { return equal(left, right) }
  catch { return false }
}
