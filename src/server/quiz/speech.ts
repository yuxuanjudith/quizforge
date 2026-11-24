/**
 * Read-aloud for the host screen (ElevenLabs through the integrations proxy).
 * Classrooms project the host screen; hearing the question helps students at
 * the back and anyone who reads slowly. Audio is generated on demand for the
 * current question only and is not stored.
 */

import type { ActionTools } from 'deepspace/worker'

const TTS_MODEL = 'eleven_flash_v2_5'
const TTS_VOICE_ID = 'WdZjiN0nNcik2LBjOHiv'
const TTS_FORMAT = 'mp3_44100_128'

export async function speak(tools: ActionTools, text: string): Promise<string> {
  const result = await tools.integration<Record<string, unknown>>('elevenlabs/generate-speech', {
    text: text.slice(0, 600),
    voice_id: TTS_VOICE_ID,
    model_id: TTS_MODEL,
    output_format: TTS_FORMAT,
  })
  if (!result.success) throw new Error(`Speech failed: ${result.error}`)
  const body = result.data as unknown as Record<string, unknown>
  const r = (body && 'response' in body ? body.response : body) as Record<string, unknown>
  const raw = [r?.audioUrl, r?.audio_base64, r?.audio, r?.base64, r?.data].find(
    (v): v is string => typeof v === 'string' && v.length > 0,
  )
  if (!raw) throw new Error('Speech returned no audio.')
  // Either a data URL or bare base64; hand the browser a data URL either way.
  if (raw.startsWith('data:') || /^https?:\/\//.test(raw)) return raw
  return `data:audio/mpeg;base64,${raw}`
}
