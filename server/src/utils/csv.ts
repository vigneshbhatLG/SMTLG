/**
 * Minimal RFC4180 CSV parser — handles quoted fields, escaped quotes and
 * newlines inside quotes (the ALM exports have multi-line defect summaries).
 * Deliberately dependency-free.
 */
export function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;

    // Strip a UTF-8 BOM so the first header name matches
    const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (inQuotes) {
            if (ch === '"') {
                if (src[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else field += ch;
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ',') {
            row.push(field); field = '';
        } else if (ch === '\r') {
            // handled by the \n branch
        } else if (ch === '\n') {
            row.push(field); field = '';
            rows.push(row); row = [];
        } else {
            field += ch;
        }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
}

/** Parse into objects keyed by trimmed header name, skipping fully blank rows. */
export function parseCsvRecords(text: string): Record<string, string>[] {
    const rows = parseCsv(text);
    if (!rows.length) return [];
    const headers = rows[0].map(h => h.trim());
    return rows.slice(1)
        .filter(r => r.some(c => c && c.trim()))
        .map(r => {
            const rec: Record<string, string> = {};
            headers.forEach((h, i) => { if (h) rec[h] = (r[i] ?? '').trim(); });
            return rec;
        });
}
