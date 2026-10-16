export function minimumVersion (range, packageName) {
  if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(range)) return range
  const match = /^>=([^ ]+)/.exec(range)
  if (match) return match[1]
  throw new Error(`Cannot derive a version from ${packageName} range: ${range}`)
}
