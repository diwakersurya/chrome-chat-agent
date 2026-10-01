/** Save text as a file through a temporary link. */
export function download(name: string, type: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type }))
  Object.assign(document.createElement('a'), { href: url, download: name }).click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** YYYY-MM-DD for export file names. */
export const stamp = () => new Date().toISOString().slice(0, 10)
