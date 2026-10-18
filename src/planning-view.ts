import type { GlassesPanel } from './glasses-view.ts'
import type { PlanningSnapshot } from './glasses-planner.ts'
import type { SpeechSnapshot } from './asr/stt.ts'

function lines(text: string, columns: number, maximum: number) {
  const words = text.replace(/\s+/g, ' ').trim().split(' '), rows: string[] = []; let row = ''
  for (let word of words) {
    if (row && row.length + word.length + 1 > columns) { rows.push(row); row = '' }
    while (word.length > columns) { rows.push(word.slice(0, columns)); word = word.slice(columns) }
    row += `${row ? ' ' : ''}${word}`
  }
  if (row) rows.push(row)
  if (rows.length > maximum) { rows.length = maximum; rows[maximum - 1] = rows[maximum - 1].slice(0, columns - 3) + '...' }
  return rows.join('\n')
}

export function planningView(state: PlanningSnapshot, speech: SpeechSnapshot): GlassesPanel[] {
  const box = (id: number, y: number, height: number, content: string, border = false): GlassesPanel => ({
    containerID: id, containerName: `planning-${id}`, xPosition: 12, yPosition: y, width: 552, height,
    paddingLength: 8, borderWidth: border ? 1 : 0, borderColor: border ? 1 : 0, borderRadius: 6, isEventCapture: 0, content,
  })
  const input = { ...box(6, 0, 288, ' '), xPosition: 0, width: 576, paddingLength: 0, isEventCapture: 1 }
  if (state.phase === 'choose-origin' || state.phase === 'choose-destination') {
    const origin = state.phase === 'choose-origin', list = origin ? state.originCandidates! : state.destinationCandidates!
    const index = origin ? state.originIndex! : state.destinationIndex!, place = list[index]
    return [input, box(1, 4, 44, origin ? 'WHICH STARTING PLACE?' : 'WHICH DESTINATION?'),
      box(2, 48, 76, lines(place.name, 42, 2)), box(3, 124, 116, lines(place.address, 42, 3)),
      box(4, 244, 44, `${index + 1}/${list.length}  Scroll to choose. Tap to select.`)]
  }
  if (state.phase === 'confirm') return [input,
    box(1, 4, 44, 'IS THIS RIGHT?'),
    // Endpoints are bounded to 70 characters; hard wrapping preserves every
    // character on the confirmation page, including unusually long words.
    box(2, 48, 76, (`FROM: ${state.origin}`.match(/.{1,42}/g) || []).join('\n')),
    box(3, 124, 76, (`TO: ${state.destination}`.match(/.{1,42}/g) || []).join('\n')),
    box(4, 202, 40, `${state.yes ? '> YES' : '  YES'}                 ${!state.yes ? '> NO' : '  NO'}`, true),
    box(5, 246, 40, 'Scroll to choose. Tap to confirm.'),
  ]
  const processing = state.phase === 'understanding' || (state.phase === 'listening' && ['stopping', 'transcribing'].includes(speech.phase))
  const title = state.phase === 'error' ? 'LET\'S TRY AGAIN' : state.phase === 'planning' ? 'PLANNING YOUR ROUTE'
    : processing ? 'UNDERSTANDING INTENT' : state.phase === 'listening' ? speech.phase === 'starting' ? 'OPENING MICROPHONE' : 'LISTENING' : 'WHERE ARE WE GOING?'
  const detail = state.phase === 'error' ? state.error : state.phase === 'planning' ? 'Finding your trains and stations.'
    : processing ? 'Transcribing and understanding\nyour starting place and destination.'
      : 'Tell me where you are and\nwhere you want to go.'
  const action = state.phase === 'error' ? 'TAP TO TRY AGAIN' : state.phase === 'prompt' ? 'TAP TO BEGIN RECORDING'
    : state.phase === 'listening' && speech.phase === 'recording' ? 'TAP TO SUBMIT PLAN' : 'Please wait...'
  return [input, box(1, 12, 60, title), box(2, 82, 126, lines(detail, 42, 3)), box(4, 220, 56, action, true)]
}
