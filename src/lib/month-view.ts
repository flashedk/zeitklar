import { auditReport } from './audit';
import { calculate, euro } from './calculate';
import { compactEmployerRows } from './check-presentation';
import { groupStandbyChecks } from './check-groups';
import type { ReviewCheck } from './review';
import { automaticContinuedPay, compensationTotal } from './sickness';
import type { WorkspaceData } from './workspace';

const isPayment = (check: ReviewCheck) => check.title.startsWith('Auszahlung: ');

/** Values derived from one month's page data that more than one tab displays. */
export function monthView(data: WorkspaceData) {
  const report = data.report;
  const result = calculate(data.entries, data.rules, data.month, data.settlement);
  const ownPay = (n: number) => (result.payAvailable ? euro(n) : 'Tarifgrundlage fehlt');
  const audit = report ? auditReport(report, data.rules, data.settlement, data.reports) : null;
  const sickness = automaticContinuedPay(data.entries, data.reports, data.rules, data.month, data.continuedPay);
  const continuedAmount = sickness ? sickness.amount : 0;
  const informationalIssues = audit?.information ?? [];
  // The server-built review is the single source for checks, acknowledgements and open counts.
  const employerChecks: ReviewCheck[] = data.review?.employerChecks ?? [];
  const paymentChecks = employerChecks.filter(isPayment);
  return {
    report,
    result,
    ownPay,
    audit,
    sickness,
    continuedLines: sickness?.lines ?? [],
    continuedAmount,
    ownTotalPay: continuedAmount === null ? 'Grundlagen fehlen' : ownPay(result.expectedPay + continuedAmount),
    combinedAuditPay: compensationTotal(audit, sickness),
    informationalIssues,
    employerIssues:
      report?.issues.filter(
        issue => !informationalIssues.some(info => info.date === issue.date && info.message === issue.message)
      ) ?? [],
    review: data.review,
    employerChecks,
    employerCheckRows: compactEmployerRows(groupStandbyChecks(employerChecks.filter(check => !isPayment(check)))),
    paymentChecks,
    paymentCount: paymentChecks.length,
    paymentAcknowledged: paymentChecks.length > 0 && paymentChecks.every(check => !!check.acknowledgedAt),
    personalChecks: (data.review?.personalChecks ?? []) as ReviewCheck[],
    flags: data.review?.openCount ?? 0
  };
}
export type MonthView = ReturnType<typeof monthView>;
