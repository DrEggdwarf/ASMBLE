export interface FoldRegion { start: number; end: number; label: string }

export function computeFoldRegions(lines: string[]): FoldRegion[] {
  const regions: FoldRegion[] = []

  // Fold sections
  const sectionStarts: { idx: number; label: string }[] = []
  lines.forEach((line, i) => {
    if (/^\s*section\s+/i.test(line)) sectionStarts.push({ idx: i, label: line.trim() })
  })
  for (let i = 0; i < sectionStarts.length; i++) {
    const end = i + 1 < sectionStarts.length ? sectionStarts[i + 1].idx - 1 : lines.length - 1
    if (end > sectionStarts[i].idx) regions.push({ start: sectionStarts[i].idx, end, label: sectionStarts[i].label })
  }

  // Fold label blocks
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([a-zA-Z_.@$][a-zA-Z0-9_.@$]*):/)
    if (m) {
      let end = i + 1
      while (end < lines.length && !/^[a-zA-Z_.@$][a-zA-Z0-9_.@$]*:/.test(lines[end]) && !/^\s*section\s+/i.test(lines[end])) end++
      end--
      if (end > i) regions.push({ start: i, end, label: m[1] + ':' })
    }
  }
  return regions
}
