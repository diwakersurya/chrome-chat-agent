import { useState } from 'react'
import { Button } from './Button'

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      icon={done ? 'check' : 'copy'}
      label={done ? 'Copied' : label}
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
    />
  )
}
