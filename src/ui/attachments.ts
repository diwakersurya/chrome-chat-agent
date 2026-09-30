export interface Attachment {
  kind: 'image' | 'audio'
  mimeType: string
  /** base64 without the data: prefix */
  data: string
  name: string
}

const MAX_IMAGE_EDGE = 1536

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

/** Downscale big photos: smaller prompts, smaller DB rows. */
export async function imageAttachment(file: File): Promise<Attachment> {
  let blob: Blob = file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bmp.width, bmp.height))
    if (scale < 1) {
      const canvas = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale))
      canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
      blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 })
    }
    bmp.close()
  } catch {
    // unsupported format for bitmap decode — send as-is
  }
  return { kind: 'image', mimeType: blob.type || file.type, data: await blobToBase64(blob), name: file.name }
}

export async function audioAttachment(blob: Blob): Promise<Attachment> {
  return { kind: 'audio', mimeType: blob.type || 'audio/webm', data: await blobToBase64(blob), name: 'Voice note' }
}

/** Minimal MediaRecorder wrapper. */
export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const rec = new MediaRecorder(stream)
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => chunks.push(e.data)
  rec.start()
  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop())
          resolve(new Blob(chunks, { type: rec.mimeType }))
        }
        rec.stop()
      }),
    cancel: () => {
      rec.onstop = null
      rec.stop()
      stream.getTracks().forEach((t) => t.stop())
    },
  }
}
