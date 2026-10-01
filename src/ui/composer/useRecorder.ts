import { useEffect, useRef, useState } from 'react'
import { audioAttachment, startRecording, type Attachment } from '../attachments'

type Recorder = Awaited<ReturnType<typeof startRecording>>

/**
 * Voice recording with an elapsed-time readout. The microphone is always
 * released when the composer goes away (chat switch, new chat).
 */
export function useRecorder(onRecorded: (a: Attachment) => void, onError: (message: string) => void) {
  const [recorder, setRecorder] = useState<Recorder>()
  const [seconds, setSeconds] = useState(0)
  const current = useRef<Recorder>(undefined)
  current.current = recorder

  useEffect(() => () => current.current?.cancel(), [])

  useEffect(() => {
    if (!recorder) return setSeconds(0)
    const started = Date.now()
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 500)
    return () => clearInterval(t)
  }, [recorder])

  const toggle = async () => {
    if (recorder) {
      setRecorder(undefined)
      onRecorded(await audioAttachment(await recorder.stop()))
      return
    }
    try {
      setRecorder(await startRecording())
    } catch {
      onError('Microphone access was blocked. Allow it in the site settings to record.')
    }
  }

  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  return { recording: !!recorder, elapsed, toggle }
}
