import { Button } from '@nightreel/ui'
import './Pagination.css'

export interface PaginationProps {
  /** 1-based current page. */
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  label?: string
}

export function Pagination({
  page,
  pageCount,
  onPageChange,
  label = 'Pagination',
}: PaginationProps) {
  if (pageCount <= 1) return null
  return (
    <nav className="nr-pagination" aria-label={label}>
      <Button
        variant="secondary"
        size="sm"
        icon="chevron-left"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </Button>
      <span className="nr-pagination__status" aria-live="polite">
        Page {page} of {pageCount}
      </span>
      <Button
        variant="secondary"
        size="sm"
        iconRight="chevron-right"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </Button>
    </nav>
  )
}
