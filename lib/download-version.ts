export function downloadVersion(info: {
  ino: bigint
  mtimeNs: bigint
  size: bigint
}) {
  return `${info.ino.toString(16)}-${info.mtimeNs.toString(16)}-${info.size.toString(16)}`
}
