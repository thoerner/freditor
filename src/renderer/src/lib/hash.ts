/** Small non-cryptographic content hash (djb2 variant), hex-encoded. */
export function contentHash(input: string): string {
  let h1 = 5381
  let h2 = 52711
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i)
    h1 = (h1 * 33) ^ c
    h2 = (h2 * 31) ^ c
  }
  return ((h1 >>> 0).toString(16) + (h2 >>> 0).toString(16)).padStart(16, '0')
}
