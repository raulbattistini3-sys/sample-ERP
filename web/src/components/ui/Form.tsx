
interface TableProps {
  columns: string[],
  rows: string[] | string[][] 

}

export const Table = ({columns, rows}: {
  rows: TableProps["rows"], 
  columns: TableProps["columns"]}) => {
  return (
  <>
        <table>
        <td>
          {columns}
        </td>
        <tr>
          {rows}
        </tr>
        </table>
    <span>
    </span>
  </>
  )
}
