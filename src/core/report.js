// Human-readable import report (written next to failed files in fout/).
const STATUS = { ok: 'Geslaagd', waarschuwing: 'Geslaagd met waarschuwingen', fout: 'Mislukt', overgeslagen: 'Overgeslagen (al geïmporteerd)' };

export function statusLabel(status) {
  return STATUS[status] ?? status;
}

export function formatReportText(report) {
  const lines = [
    'Importrapport',
    '=============',
    `Bestand:   ${report.fileName}`,
    `Tijdstip:  ${report.at}`,
    `Resultaat: ${statusLabel(report.status)}`,
    `Formaat:   ${report.format ?? 'onbekend'}${report.encoding ? ` (${report.encoding})` : ''}`,
    `SHA-256:   ${report.fileHash}`,
    `Nieuwe transacties: ${report.newTransactions}`,
    `Reeds aanwezig:     ${report.duplicateTransactions}`,
    '',
  ];
  if (report.messages.length) {
    lines.push('Meldingen:');
    for (const m of report.messages) lines.push(`- [${m.level === 'error' ? 'FOUT' : m.level === 'warning' ? 'WAARSCHUWING' : 'INFO'}] ${m.message}`);
  } else {
    lines.push('Geen meldingen.');
  }
  return lines.join('\r\n') + '\r\n';
}
