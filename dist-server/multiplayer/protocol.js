export function parseClientMessage(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed == null || typeof parsed.type !== 'string') {
            return null;
        }
        return parsed;
    }
    catch {
        return null;
    }
}
export function parseServerMessage(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed == null || typeof parsed.type !== 'string') {
            return null;
        }
        return parsed;
    }
    catch {
        return null;
    }
}
