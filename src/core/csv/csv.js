// Generic CSV tokenizer (RFC 4180 style):
//  - configurable delimiter and quote character
//  - quoted fields may contain delimiters, line breaks (LF or CRLF) and "" escapes
//  - records end at CRLF, LF or CR outside quotes
// Returns records with the 1-based physical line number where they start.

export class CsvError extends Error {
  constructor(message, line) {
    super(message);
    this.line = line;
  }
}

export function parseCsv(text, { delimiter = ';', quote = '"' } = {}) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  const records = [];
  let fields = [];
  let field = '';
  let inQuotes = false;
  let wasQuoted = false;
  let line = 1;
  let recordLine = 1;
  const n = text.length;
  const endField = () => {
    fields.push(field);
    field = '';
    wasQuoted = false;
  };
  const endRecord = () => {
    endField();
    records.push({ fields, line: recordLine });
    fields = [];
  };
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === quote) {
        if (text[i + 1] === quote) {
          field += quote;
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (c === '\n') line++;
        else if (c === '\r') {
          line++;
          if (text[i + 1] === '\n') {
            field += '\r';
            i++;
            field += '\n';
            continue;
          }
        }
        field += c;
      }
      continue;
    }
    if (c === quote && field === '' && !wasQuoted) {
      inQuotes = true;
      wasQuoted = true;
    } else if (c === delimiter) {
      endField();
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      field += c;
    }
  }
  if (inQuotes) throw new CsvError('Aanhalingsteken wordt nergens afgesloten (onvolledig bestand?).', recordLine);
  if (field !== '' || fields.length) endRecord();
  return records;
}

export const isEmptyRecord = (r) => r.fields.every((f) => f.trim() === '');
