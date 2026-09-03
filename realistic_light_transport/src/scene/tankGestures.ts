const activeTouches = new Set<number>()
let pinchSequence = false
let lastPinchAt = -Infinity

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
