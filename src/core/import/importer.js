// Pure import pipeline: (data, file) -> { data, report }. One entry point for
// all formats:
//  1. identical files (same SHA-256) are skipped
//  2. format detection: CODA by content; CSV by profile (header row + file name)
//  3. the format strategy validates and merges; any error => nothing changes
// The attempt is always logged in the import history.

import { decodeCodaBytes } from '../coda/decode.js';
import { importCoda } from './coda-import.js';
import { importCsv } from './csv-import.js';
import { detectProfile } from '../csv/profiles.js';

export function isCoda(bytes) {
  const { text } = decodeCodaBytes(bytes.subarray(0, 256));
  // First characters of a CODA file: record 0, zeros, date, bank id, application code 05.
  return /^0{5}\d{9}05[ D] {7}/.test(text);
}

/** @returns {{ format: 'coda'|'csv'|'unknown', profile?: object, reason?: string }} */
export function detectFormat(bytes, fileName, customProfiles = []) {
  if (isCoda(bytes)) return { format: 'coda' };
  const det = detectProfile(bytes, fileName, customProfiles);
  if (det.profile) return { format: 'csv', profile: det.profile };
  return { format: 'unknown', reason: det.reason };
}

let importCounter = 0;
export function newImportId(now) {
  importCounter = (importCounter + 1) % 1000;
  return `imp-${now.replace(/[-:.TZ]/g, '')}-${String(importCounter).padStart(3, '0')}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * @param data current data (not mutated)
 * @param file { fileName, bytes: Uint8Array, fileHash, source: 'inbox'|'upload', now: ISO string, profileId? }
 */
export function importFile(data, file) {
  const now = file.now ?? new Date().toISOString();
  const report = {
    id: newImportId(now),
    at: now,
    fileName: file.fileName,
    fileHash: file.fileHash,
    source: file.source ?? 'upload',
    format: null,
    profileId: null,
    status: 'ok',
    encoding: null,
    statements: [],
    newAccounts: [],
    newTransactions: 0,
    duplicateTransactions: 0,
    enrichedTransactions: 0,
    possibleDuplicates: 0,
    messages: [],
  };
  const finish = (newData) => ({ data: { ...newData, imports: [...newData.imports, report], updatedAt: now }, report });

  const previous = data.fileHashes[file.fileHash];
  if (previous) {
    const prevImport = data.imports.find((i) => i.id === previous);
    report.status = 'overgeslagen';
    report.messages.push({
      level: 'info',
      message: `Identiek bestand werd al geïmporteerd${prevImport ? ` op ${prevImport.at.slice(0, 10)} (${prevImport.fileName})` : ''}.`,
    });
    return finish(data);
  }

  let detected;
  if (file.profileId) {
    const det = detectProfile(file.bytes, file.fileName, data.profiles ?? [], file.profileId);
    detected = det.profile ? { format: 'csv', profile: det.profile } : { format: 'unknown', reason: det.reason };
  } else {
    detected = detectFormat(file.bytes, file.fileName, data.profiles ?? []);
  }
  report.format = detected.format;
  let result;
  if (detected.format === 'coda') {
    report.profileId = 'coda';
    result = importCoda(data, file, report, now);
  } else if (detected.format === 'csv') {
    report.profileId = detected.profile.id;
    result = importCsv(data, file, report, now, detected.profile);
  } else {
    result = {
      data: null,
      errors: [
        {
          level: 'error',
          message: `Onbekend bestandsformaat: geen CODA-bestand en geen gekend CSV-profiel${detected.reason ? ` (${detected.reason})` : ''}. Gebruik de koppelingswizard (tabblad Importeren) om een profiel te maken.`,
        },
      ],
    };
  }

  if (!result.data) {
    report.status = 'fout';
    report.messages.push(...result.errors);
    return finish(data);
  }
  if (report.messages.some((m) => m.level === 'warning')) report.status = 'waarschuwing';
  return finish({ ...result.data, fileHashes: { ...result.data.fileHashes, [file.fileHash]: report.id } });
}
