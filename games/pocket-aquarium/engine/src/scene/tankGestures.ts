const activeTouches = new Set<number>()
let pinchSequence = false
let lastPinchAt = -Infinity
let dragSequence = false
let lastDragAt = -Infinity

export function noteTankPointerDown(pointerId: number, pointerType: string) {
  if (pointerType !== 'touch') return
  activeTouches.add(pointerId)
  if (activeTouches.size > 1) {
    pinchSequence = true
    lastPinchAt = performance.now()
  }
}

export function noteTankPointerUp(pointerId: number, pointerType: string) {
  if (pointerType !== 'touch') return
  if (pinchSequence) lastPinchAt = performance.now()
  activeTouches.delete(pointerId)
  if (activeTouches.size === 0) queueMicrotask(() => {
    if (activeTouches.size === 0) pinchSequence = false
  })
}

export function tankPinchInProgress() {
  return pinchSequence || performance.now() - lastPinchAt < 350
}

/** Mark the active pointer as an orbit drag once it crosses the movement threshold. */
export function noteTankDrag() {
  dragSequence = true
  lastDragAt = performance.now()
}

/** Release the orbit drag; a short latch survives until the pointerup feed check runs. */
export function endTankDrag() {
  if (dragSequence) lastDragAt = performance.now()
  dragSequence = false
}

export function tankDragInProgress() {
  return dragSequence || performance.now() - lastDragAt < 350
}
