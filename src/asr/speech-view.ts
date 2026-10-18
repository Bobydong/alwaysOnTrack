import type { GlassesPanel } from '../glasses-view.ts'
import type { SpeechSnapshot } from './stt.ts'

export function speechGlasses(state: SpeechSnapshot): GlassesPanel[] {
  const panel = (id: number, name: string, x: number, y: number, content: string): GlassesPanel => ({
    containerID: id, containerName: name, xPosition: x, yPosition: y, width: 264, height: 116,
    borderWidth: 0, borderColor: 0, borderRadius: 0, paddingLength: 10, isEventCapture: 0, content,
  })
  const input = { ...panel(6, 'trip-input', 0, 0, ' '), width: 576, height: 288, paddingLength: 0, isEventCapture: 1 }
  if (state.phase === 'recording') return [input,
    panel(1, 'trip-station', 8, 8, `LISTENING\n${state.seconds.toFixed(1)}s received`),
    panel(3, 'trip-detail', 304, 8, 'Say where you are\nand where you\nwant to go'),
    panel(4, 'trip-action', 8, 164, 'TAP TO FINISH'),
  ]
  return [input,
    panel(1, 'trip-station', 8, 8, state.phase === 'starting' ? 'OPENING MICROPHONE'
      : state.phase === 'transcribing' ? 'TRANSCRIBING\nMicrophone off' : state.phase === 'error' ? 'MICROPHONE ERROR' : 'CLOSING MICROPHONE'),
    ...(state.phase === 'error' ? [panel(3, 'trip-detail', 304, 8, 'Press Cancel\non your phone')] : []),
  ]
}
