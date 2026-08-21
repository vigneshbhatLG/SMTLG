import React from "react";

export function dashboardColumns(
    columnHelper,
    openMemberView,
    selected = {},
    patchCountsByMember = {},
    patchCountsLoading = false
) {
    const hourCell = (info) => formatHours(info.getValue());

    const base = [
        // ===================== BASE COLUMNS =====================
        columnHelper.accessor("member", { header: "Member", cell: (info) => info.getValue() }),
        columnHelper.accessor("storypoints", { header: "Planned Story Points", cell: (info) => info.getValue() }),
        // columnHelper.accessor("planned", { header: "Planned Hours", cell: (info) => formatHours(info.getValue()) }),
        // columnHelper.accessor("logged", { header: "Logged Hours", cell: (info) => formatHours(info.getValue()) }),
        // columnHelper.accessor("planned", { header: "Planned SP", cell: (info) => formatHours(info.getValue()) }),
        columnHelper.accessor("logged", { header: "Logged SP", cell: (info) => formatHours(info.getValue()) }),
        columnHelper.accessor("diff", {
            // header: "Difference in Hours",
            header: "Difference in SP",
            cell: (info) => {
                const diff = Number(info.getValue() ?? 0);
                const val = diff.toFixed(2).replace(/\.?0+$/, "");
                return <span style={{ color: diff < 0 ? "red" : "green" }}>{val}</span>;
            },
        }),
    ];

    const groups = [];

    if (selected.development)
        groups.push({
            header: "Development",
            columns: [
                // columnHelper.accessor("development.totalOriginalEstimateHours", { header: "Estimated Hrs", cell: hourCell }),
                // columnHelper.accessor("development.totalTimeSpentHours", { header: "Logged Hrs", cell: hourCell }),
                columnHelper.accessor("development.totalOriginalEstimateStoryPoints", { header: "Estimated SP", cell: hourCell }),
                columnHelper.accessor("development.totalTimeSpentStoryPoints", { header: "Logged SP", cell: hourCell }),
            ],
        });
    if (selected.issue)
        groups.push({
            header: "Issue",
            columns: [
                // columnHelper.accessor("issue.totalOriginalEstimateHours", { header: "Estimated Hrs", cell: hourCell }),
                // columnHelper.accessor("issue.totalTimeSpentHours", { header: "Logged Hrs", cell: hourCell }),
                columnHelper.accessor("issue.totalOriginalEstimateStoryPoints", { header: "Estimated SP", cell: hourCell }),
                columnHelper.accessor("issue.totalTimeSpentStoryPoints", { header: "Logged SP", cell: hourCell }),
            ],
        });
    if (selected.training)
        groups.push({
            header: "Training",
            columns: [
                // columnHelper.accessor("training.totalOriginalEstimateHours", { header: "Estimated Hrs", cell: hourCell }),
                // columnHelper.accessor("training.totalTimeSpentHours", { header: "Logged Hrs", cell: hourCell }),
                columnHelper.accessor("training.totalOriginalEstimateStoryPoints", { header: "Estimated SP", cell: hourCell }),
                columnHelper.accessor("training.totalTimeSpentStoryPoints", { header: "Logged SP", cell: hourCell }),
            ],
        });
    if (selected.operation)
        groups.push({
            header: "Operation",
            columns: [
                columnHelper.accessor("operation.totalOriginalEstimateStoryPoints", { header: "Estimated SP", cell: hourCell }),
                columnHelper.accessor("operation.totalTimeSpentStoryPoints", { header: "Logged SP", cell: hourCell }),
            ],
        });
    if (selected.plannedLeave)
        groups.push({
            header: "Planned Leave",
            columns: [
                // columnHelper.accessor("plannedLeave.totalOriginalEstimateHours", { header: "Estimated Hrs", cell: hourCell }),
                // columnHelper.accessor("plannedLeave.totalTimeSpentHours", { header: "Logged Hrs", cell: hourCell }),
                columnHelper.accessor("plannedLeave.totalOriginalEstimateStoryPoints", { header: "Estimated SP", cell: hourCell }),
                columnHelper.accessor("plannedLeave.totalTimeSpentStoryPoints", { header: "Logged SP", cell: hourCell }),
            ],
        });
    if (selected.unplannedLeave)
        groups.push({
            header: "Unplanned Leave",
            columns: [
                // columnHelper.accessor("unplannedLeave.totalOriginalEstimateHours", { header: "Estimated Hrs", cell: hourCell }),
                // columnHelper.accessor("unplannedLeave.totalTimeSpentHours", { header: "Logged Hrs", cell: hourCell }),
                columnHelper.accessor("unplannedLeave.totalOriginalEstimateStoryPoints", { header: "Estimated SP", cell: hourCell }),
                columnHelper.accessor("unplannedLeave.totalTimeSpentStoryPoints", { header: "Logged SP", cell: hourCell }),
            ],
        });

    // view column
    const view = columnHelper.accessor("view", {
        header: "View",
        cell: (info) => {
            const memberName = info.row.original.memberKey || info.row.original.member;
            return (
                <button
                    onClick={() => openMemberView(memberName)}
                    style={{ color: "#0b74de", textDecoration: "underline", background: "transparent", border: "none", cursor: "pointer" }}
                >
                    View
                </button>
            );
        },
    });

    const patches = columnHelper.accessor(
        (row) => {
            const v = row?.patches;
            return typeof v === 'number' ? v : null;
        },
        {
            id: 'patches',
            header: 'Patches',
            cell: (info) => {
                if (patchCountsLoading) return '...';
                const v = info.getValue();
                return v == null ? '—' : v;
            }
        }
    );

    return [...base, ...groups, patches, view];
}

const formatHours = (val) => {
    const num = Number(val ?? 0) || 0;
    return num.toFixed(2).replace(/\.?0+$/, "");
};

export default dashboardColumns;
