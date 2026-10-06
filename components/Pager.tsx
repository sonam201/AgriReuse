'use client'

import { useEffect, useRef, useState } from 'react'

export const PAGE_SIZE = 5

// Splits a list into pages. `resetOn` (e.g. the search text) jumps back to page 1 when it changes.
export function usePage<T>(items: T[], resetOn: unknown = null, size = PAGE_SIZE) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(items.length / size))
  useEffect(() => { setPage(0) }, [resetOn])
  const current = Math.min(page, pages - 1) // a list that shrinks never leaves you on an empty page
  return { items: items.slice(current * size, current * size + size), page: current, pages, total: items.length, setPage }
}

// ‹ Previous · Page 2 of 5 · Next ›  (hidden when everything fits on one page)
export function Pager({ page, pages, total, setPage, noun = 'items' }: {
  page: number; pages: number; total: number; setPage: (p: number) => void; noun?: string
}) {
  const top = useRef<HTMLDivElement>(null)
  if (pages <= 1) return null
  const go = (p: number) => {
    setPage(p)
    // Bring the start of the list back into view.
    top.current?.closest('section, .card, main')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
  return (
    <div className="pager" ref={top} role="navigation" aria-label={`${noun} pages`}>
      <button className="btn alt" disabled={page == 0} onClick={() => go(page - 1)}>‹ Previous</button>
      <span className="s">Page {page + 1} of {pages} · {total} {noun}</span>
      <button className="btn alt" disabled={page >= pages - 1} onClick={() => go(page + 1)}>Next ›</button>
    </div>
  )
}
