import type { ReactNode } from 'react'
import './DataTable.css'

export interface DataTableColumn<Row> {
  key: string
  header: ReactNode
  cell: (row: Row) => ReactNode
  align?: 'start' | 'end'
}

export interface DataTableProps<Row> {
  /** Accessible table caption (visually hidden when `hideCaption`). */
  caption: string
  hideCaption?: boolean
  columns: DataTableColumn<Row>[]
  rows: Row[]
  getRowKey: (row: Row) => string | number
  empty?: ReactNode
}

export function DataTable<Row>({
  caption,
  hideCaption = false,
  columns,
  rows,
  getRowKey,
  empty = 'Nothing to show yet.',
}: DataTableProps<Row>) {
  return (
    <div className="nr-table-wrap">
      <table className="nr-table">
        <caption className={hideCaption ? 'nr-visually-hidden' : 'nr-table__caption'}>
          {caption}
        </caption>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={col.align === 'end' ? 'nr-table__cell--end' : undefined}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="nr-table__empty">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={getRowKey(row)}>
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={col.align === 'end' ? 'nr-table__cell--end' : undefined}
                  >
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
