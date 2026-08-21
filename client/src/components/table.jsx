import React, { useMemo, useState } from "react";
import { flexRender } from "@tanstack/react-table";
import "./css/Table.css";

function Table({ table, highlightMembers = [] }) {
    const [hoveredColId, setHoveredColId] = useState(null);
    const [hoveredRowId, setHoveredRowId] = useState(null);

    const highlightSet = useMemo(() => {
        const members = Array.isArray(highlightMembers) ? highlightMembers : [highlightMembers];
        return new Set(members.filter(Boolean));
    }, [highlightMembers]);

    const firstColId = table.getVisibleLeafColumns()[0]?.id;

    return (
        <div className="analytics-table-wrap">
            <table className="analytics-table">
                <thead>
                    {table.getHeaderGroups().map((headerGroup) => (
                        <tr key={headerGroup.id}>
                            {headerGroup.headers.map((header) => {
                                const isHeaderActive =
                                    header.column?.id === hoveredColId ||
                                    (typeof header.getLeafHeaders === "function" &&
                                        header.getLeafHeaders().some((h) => h.column?.id === hoveredColId));

                                return (
                                    <th
                                        key={header.id}
                                        colSpan={header.colSpan}
                                        className={`analytics-th${isHeaderActive ? " col-active" : ""}`}
                                    >
                                        {header.isPlaceholder
                                            ? null
                                            : flexRender(
                                                  header.column?.columnDef?.header ?? header.header,
                                                  header.getContext()
                                              )}
                                    </th>
                                );
                            })}
                        </tr>
                    ))}
                </thead>

                <tbody>
                    {table.getRowModel().rows.map((row) => {
                        const rowMember = row.original?.memberKey || row.original?.member;
                        const isCurrentUser = rowMember ? highlightSet.has(rowMember) : false;

                        return (
                            <tr
                                key={row.id}
                                className={isCurrentUser ? "row-highlight" : undefined}
                            >
                                {row.getVisibleCells().map((cell) => {
                                    const isFirstCol = cell.column.id === firstColId;
                                    const isRowHeaderActive = isFirstCol && row.id === hoveredRowId;
                                    return (
                                        <td
                                            key={cell.id}
                                            className={`analytics-td${isRowHeaderActive ? " col-active" : ""}`}
                                            onMouseEnter={() => {
                                                setHoveredColId(cell.column.id);
                                                setHoveredRowId(row.id);
                                            }}
                                            onMouseLeave={() => {
                                                setHoveredColId(null);
                                                setHoveredRowId(null);
                                            }}
                                        >
                                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })}
                </tbody>

                <tfoot>
                    {(() => {
                        const rows = table.getRowModel().rows;
                        const cols = table.getVisibleLeafColumns();
                        const totals = {};

                        cols.forEach((col) => {
                            let sum = 0;
                            let hasNumber = false;
                            for (const row of rows) {
                                const cell = row.getVisibleCells().find((c) => c.column.id === col.id);
                                const val = cell?.getValue?.();
                                let num = NaN;
                                if (typeof val === "number") num = val;
                                else if (typeof val === "string") {
                                    const cleaned = val.replace(/,/g, "").trim();
                                    if (cleaned !== "") num = Number(cleaned);
                                }
                                if (!Number.isNaN(num)) {
                                    sum += num;
                                    hasNumber = true;
                                }
                            }
                            totals[col.id] = hasNumber ? sum : null;
                        });

                        return (
                            <tr>
                                {cols.map((col, idx) => {
                                    const value = totals[col.id];
                                    const isFirst = idx === 0;
                                    return (
                                        <td
                                            key={`total-${col.id}`}
                                            className="analytics-td"
                                            style={{ fontWeight: isFirst ? 700 : 600 }}
                                        >
                                            {isFirst
                                                ? "Total"
                                                : value !== null
                                                ? Number.isInteger(value)
                                                    ? value
                                                    : value.toFixed(2)
                                                : null}
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })()}
                </tfoot>
            </table>
        </div>
    );
}

export default React.memo(Table);
