// CODA import strategy: one batch per statement; statements are unique by
// account + year + statement number, transactions by statement + sequence + detail.

import { parseCoda } from '../coda/parser.js';
import { checkStatement } from '../checks/balance.js';
import { checkContinuity } from '../checks/continuity.js';
import { statementId, transactionId, yearOf, formatIban } from '../model/ids.js';
import { assignBookingOrder } from '../model/booking-order.js';

/**
 * @returns {{ data: object|null, errors: object[] }} data === null on failure
 */
export function importCoda(data, file, report, now) {
  const parsed = parseCoda(file.bytes);
  report.encoding = parsed.encoding;
  const lineMsg = (i) => ({ level: i.level, message: i.line ? `Regel ${i.line}: ${i.message}` : i.message });
  const parseErrors = parsed.issues.filter((i) => i.level === 'error');
  report.messages.push(...parsed.issues.filter((i) => i.level !== 'error').map(lineMsg));
  if (parseErrors.length) return { data: null, errors: parseErrors.map(lineMsg) };
  if (!parsed.statements.length) return { data: null, errors: [{ level: 'error', message: 'Het bestand bevat geen uittreksels.' }] };

  const errors = [];
  const newAccounts = {};
  const newStatements = {};
  const newTransactions = [];
  const existingTxIds = new Set(data.transactions.map((t) => t.id));

  for (const st of parsed.statements) {
    const acc = st.account;
    const accountId = acc.number;
    const year = yearOf(st.newBalanceDate);
    const sid = statementId(accountId, year, st.paperStatementNumber);
    const label = `${formatIban(accountId)} uittreksel ${year}/${String(st.paperStatementNumber).padStart(3, '0')}`;
    const checks = checkStatement(st);
    for (const i of checks.issues) {
      (i.level === 'error' ? errors : report.messages).push({ level: i.level, message: `${label}: ${i.message}` });
    }
    const existingAccount = data.accounts[accountId] ?? newAccounts[accountId];
    if (!existingAccount) {
      newAccounts[accountId] = createAccount(acc, st, now);
      report.newAccounts.push(accountId);
      if (!acc.isIban) {
        report.messages.push({ level: 'warning', message: `${accountId}: rekeningnummer is geen IBAN.` });
      }
    } else if ((existingAccount.sourceFormat ?? 'coda') !== 'coda') {
      errors.push({ level: 'error', message: `${label}: deze rekening wordt al via ${existingAccount.profileId?.toUpperCase()}-export ingelezen. CODA en CSV voor dezelfde rekening mengen kan niet betrouwbaar (andere sleutels).` });
    } else if (existingAccount.currency !== acc.currency) {
      errors.push({ level: 'error', message: `${label}: munt ${acc.currency} verschilt van de rekening (${existingAccount.currency}).` });
    }

    const fingerprint = statementFingerprint(st);
    const existing = data.statements[sid] ?? newStatements[sid];
    if (existing) {
      if (existing.fingerprint === fingerprint) {
        report.statements.push({ id: sid, status: 'dubbel' });
        report.duplicateTransactions += st.movements.filter((m) => !m.isDetail).length;
        continue;
      }
      errors.push({
        level: 'error',
        message: `${label}: dit uittreksel bestaat al met andere inhoud. Er wordt niets overschreven; controleer beide bestanden.`,
      });
      continue;
    }

    const stored = {
      id: sid,
      accountId,
      year,
      number: st.paperStatementNumber,
      codaSequenceNumber: st.codaSequenceNumber,
      oldBalance: st.oldBalance,
      oldBalanceDate: st.oldBalanceDate,
      newBalance: st.newBalance,
      newBalanceDate: st.newBalanceDate,
      currency: acc.currency,
      movementCount: 0,
      trailer: st.trailer,
      checks: { balance: checks.balance, trailer: checks.trailer },
      freeCommunications: st.freeCommunications.map((f) => f.text),
      information: st.information.map((i) => i.text),
      duplicateFlag: st.header.duplicate,
      fingerprint,
      importId: report.id,
      fileHash: file.fileHash,
    };
    newStatements[sid] = stored;
    report.statements.push({ id: sid, status: 'nieuw' });

    for (const m of st.movements) {
      if (m.isDetail) continue;
      const tid = transactionId(sid, m.sequence, m.detail);
      if (existingTxIds.has(tid)) {
        report.duplicateTransactions++;
        continue;
      }
      existingTxIds.add(tid);
      const details = st.movements.filter((d) => d.isDetail && d.sequence === m.sequence);
      newTransactions.push(toTransaction(m, tid, stored, acc.currency, details, report.id));
      stored.movementCount++;
    }
  }

  if (errors.length) return { data: null, errors };

  const touched = new Set(parsed.statements.map((s) => s.account.number));
  const merged = {
    ...data,
    accounts: { ...data.accounts, ...newAccounts },
    statements: { ...data.statements, ...newStatements },
    transactions: newTransactions.length ? assignBookingOrder(data.transactions.concat(newTransactions), touched) : data.transactions,
  };
  report.newTransactions = newTransactions.length;

  // Continuity over all statements of the touched accounts (warnings: the
  // file itself is valid, but something may be missing).
  for (const accountId of touched) {
    const list = Object.values(merged.statements).filter((s) => s.accountId === accountId);
    for (const i of checkContinuity(list)) {
      report.messages.push({ level: 'warning', message: `${formatIban(accountId)}: ${i.message}` });
    }
  }
  return { data: merged, errors: [] };
}

function createAccount(acc, st, now) {
  return {
    id: acc.number,
    number: acc.number,
    isIban: acc.isIban,
    currency: acc.currency,
    holderName: st.holderName,
    bankDescription: st.description,
    bic: st.header.bic,
    displayName: st.description || formatIban(acc.number),
    kind: /spaar/i.test(st.description) ? 'spaar' : 'zicht',
    ownership: { type: 'individueel', owners: [] },
    sourceFormat: 'coda',
    profileId: 'coda',
    bankAccountType: null,
    createdAt: now,
  };
}

function statementFingerprint(st) {
  const parts = [st.oldBalance, st.oldBalanceDate, st.newBalance, st.newBalanceDate];
  for (const m of st.movements) parts.push(`${m.sequence}.${m.detail}:${m.amount}:${m.entryDate}`);
  return parts.join('|');
}

function toTransaction(m, id, stmt, currency, details, importId) {
  return {
    id,
    accountId: stmt.accountId,
    statementId: stmt.id,
    statementYear: stmt.year,
    statementNumber: stmt.number,
    sequence: m.sequence,
    detail: m.detail,
    amount: m.amount,
    currency,
    entryDate: m.entryDate,
    valueDate: m.valueDate,
    counterparty: { ...m.counterparty },
    communication: { ...m.communication },
    txCode: m.txCode,
    bankReference: m.bankReference,
    customerReference: m.customerReference,
    information: m.information.map((i) => i.text),
    details: details.map((d) => ({
      detail: d.detail,
      amount: d.amount,
      counterparty: { ...d.counterparty },
      communication: { ...d.communication },
      txCode: d.txCode,
    })),
    source: 'coda',
    profileId: 'coda',
    bankType: null,
    balanceAfter: null,
    costs: null,
    exchangeRate: null,
    card: null,
    bookingOrder: 0, // assigned by assignBookingOrder
    importId,
  };
}
