"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  width?: string;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  cell: (row: T) => ReactNode;
  sortValue?: (row: T) => number | string;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  className?: string;
  maxHeight?: number | string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  defaultSort,
  onRowClick,
  empty,
  className,
  maxHeight,
}: DataTableProps<T>) {
  const [sort, setSort] = useState(defaultSort ?? null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col || !col.sortValue) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [rows, sort, columns]);

  return (
    <div
      className={`overflow-auto rounded-xl border border-canvas-border ${className ?? ""}`}
      style={{ maxHeight }}
    >
      <table className="w-full table-fixed text-[12px]">
        <thead className="sticky top-0 z-10 bg-canvas-bg">
          <tr className="border-b border-canvas-border">
            {columns.map((col) => {
              const isSorted = sort?.key === col.key;
              const sortClass = col.sortable ? "cursor-pointer select-none" : "";
              return (
                <th
                  key={col.key}
                  scope="col"
                  className={`px-3 py-2 text-${col.align ?? "left"} font-medium text-canvas-muted ${sortClass}`}
                  style={{ width: col.width }}
                  onClick={() => {
                    if (!col.sortable) return;
                    setSort((prev) => {
                      if (!prev || prev.key !== col.key) return { key: col.key, dir: "desc" };
                      if (prev.dir === "desc") return { key: col.key, dir: "asc" };
                      return null;
                    });
                  }}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.header}
                    {isSorted ? (
                      <span aria-hidden="true">{sort.dir === "desc" ? "↓" : "↑"}</span>
                    ) : null}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-8 text-center text-[12px] text-canvas-muted"
              >
                {empty ?? "No data"}
              </td>
            </tr>
          ) : (
            sorted.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`border-b border-canvas-border last:border-0 ${
                  onRowClick ? "cursor-pointer hover:bg-canvas-surface-hover" : ""
                }`}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`truncate px-3 py-2 text-${col.align ?? "left"} text-canvas-fg`}
                    style={{ width: col.width }}
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
  );
}
