import * as fs from 'fs';
import * as path from 'path';

const SWOT_DOMAINS_DIR = path.resolve(
    import.meta.dirname, '../../swot/lib/domains'
);

function loadLineSet(filename: string): Set<string> {
    const filePath = path.join(SWOT_DOMAINS_DIR, filename);
    const content = fs.readFileSync(filePath, 'utf-8');
    return new Set(
        content.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
    );
}

const tlds = loadLineSet('tlds.txt');
const stoplist = loadLineSet('stoplist.txt');

// "user@cs.stanford.edu" -> ["edu", "stanford", "cs"]
function domainParts(emailOrDomain: string): string[] {
    return emailOrDomain
        .trim()
        .toLowerCase()
        .replace(/^.*@/, '')
        .replace(/^.*:\/\//, '')
        .replace(/:.*$/, '')
        .split('.')
        .reverse();
}

// Progressively reconstruct domain from TLD outward and check against set.
// For parts ["edu", "stanford", "cs"]: checks "edu", "stanford.edu", "cs.stanford.edu"
function checkSet(set: Set<string>, parts: string[]): boolean {
    let subj = '';
    for (const part of parts) {
        subj = subj ? `${part}.${subj}` : part;
        if (set.has(subj)) return true;
    }
    return false;
}

function isUnderTLD(parts: string[]): boolean {
    return checkSet(tlds, parts);
}

function isStoplisted(parts: string[]): boolean {
    return checkSet(stoplist, parts);
}

// Walk domain hierarchy looking for institution files.
// For parts ["edu", "stanford"]: tries edu.txt, edu/stanford.txt
function findSchoolNamesFromParts(parts: string[]): string[] {
    let resourcePath = '';
    for (const part of parts) {
        resourcePath = resourcePath ? `${resourcePath}/${part}` : part;
        const filePath = path.join(SWOT_DOMAINS_DIR, `${resourcePath}.txt`);
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const names = content.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0);
            if (names.length > 0) return names;
        } catch {
            continue;
        }
    }
    return [];
}

// Mirrors JetBrains SWOT Kotlin logic: !stoplisted && (underTLD || knownInstitution)
export function isAcademic(emailOrDomain: string): boolean {
    const parts = domainParts(emailOrDomain);
    if (parts.length === 0 || parts[0] === '') return false;
    return !isStoplisted(parts) && (isUnderTLD(parts) || findSchoolNamesFromParts(parts).length > 0);
}

export function findSchoolNames(emailOrDomain: string): string[] {
    return findSchoolNamesFromParts(domainParts(emailOrDomain));
}
