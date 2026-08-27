/**
 * The hand-written types, checked against the generated ones.
 *
 * `src/types/*.ts` is written by hand. That is a deliberate choice — the
 * generated file is 8,800 lines of `components["schemas"]["ProjectOut"]`, which
 * is unreadable at a call site and carries none of the reasoning that makes the
 * hand-written modules worth having. But a hand-written type drifts from the
 * API silently: the server renames a field, every page keeps compiling, and the
 * failure surfaces as an undefined at runtime in front of a user.
 *
 * So this file closes the loop. It contains no runtime code and no assertions
 * in the testing sense — every check here is a *type* assertion, and `tsc` is
 * what runs them. If the API changes shape, `npm run api:types` regenerates the
 * schema, and this file stops compiling.
 *
 * ## When this file fails
 *
 * Read the error, then fix the hand-written type in `src/types/`. It is the one
 * that is wrong: the generated file came from the server's own OpenAPI
 * document, so it is by construction the truth about what the API sends.
 *
 * ## Why assignability, and in this direction
 *
 * The check is `Local extends Generated` — "a value of the hand-written type
 * would satisfy the generated one". That direction is chosen deliberately, and
 * it catches exactly the failures worth catching:
 *
 * * The server **adds a required field** → the local type lacks it → fails.
 * * The server **renames a field** → the local type still has the old name and
 *   lacks the new one → fails.
 * * The server **changes a field's type** incompatibly → fails.
 *
 * while permitting the one difference that is intended: the hand-written types
 * **narrow**. `Me.role` is a union of the five roles the API can return, where
 * the generated type says `string`. That is the point of writing them by hand,
 * and a narrower type is still assignable to a wider one.
 *
 * Exact equality would reject every one of those narrowings, so this file would
 * either be deleted or filled with exceptions until it checked nothing.
 */

import type { components } from "@/types/api-schema";
import type {
  Acknowledged,
  ApprovalListRow,
  AuditEntry,
  CollectionListRow,
  ConsentListRow,
  ConsentRow,
  ExportListRow,
  LinkListRow,
  LinkStats,
  LoginResponse,
  Me,
  NoticeListRow,
  Notice,
  DataSource,
  Processor,
  Project,
  Purpose,
  SiteListRow,
  User,
} from "@/types";

type Schemas = components["schemas"];

/**
 * Assert that `Local` covers every field of `Generated`, compatibly.
 *
 * Resolves to `Generated` when it holds and to a descriptive error type when it
 * does not, so the compiler's message names the type that drifted instead of
 * saying "true is not assignable to false".
 */
type Covers<Name extends string, Generated, Local> = Local extends Generated
  ? true
  : { error: `${Name} has drifted from the API`; expected: Generated; got: Local };

// Each line is one type. A drift turns the right-hand side into the error
// object above, and `true` stops being assignable.
export type _Me = Covers<"Me", Schemas["MeResponse"], Me>;
export type _LoginResponse = Covers<"LoginResponse", Schemas["LoginResponse"], LoginResponse>;
export type _Acknowledged = Covers<"Acknowledged", Schemas["Acknowledged"], Acknowledged>;

export type _Project = Covers<"Project", Schemas["ProjectOut"], Project>;
export type _Site = Covers<"Site", Schemas["SiteListRow"], SiteListRow>;
export type _ApprovalListRow = Covers<
  "ApprovalListRow",
  Schemas["ApprovalListRow"],
  ApprovalListRow
>;

export type _Notice = Covers<"Notice", Schemas["NoticeOut"], Notice>;
export type _NoticeListRow = Covers<"NoticeListRow", Schemas["NoticeListRow"], NoticeListRow>;

export type _Purpose = Covers<"Purpose", Schemas["PurposeOut"], Purpose>;
export type _Processor = Covers<"Processor", Schemas["ProcessorOut"], Processor>;
// Absent until a field the API returns silently stopped arriving: the column
// was joined and selected, the response model did not declare it, and the
// payload lost it with nothing failing anywhere.
export type _DataSource = Covers<"DataSource", Schemas["SourceOut"], DataSource>;

export type _ConsentRow = Covers<"ConsentRow", Schemas["ConsentRow"], ConsentRow>;
export type _ConsentListRow = Covers<"ConsentListRow", Schemas["ConsentListRow"], ConsentListRow>;
export type _LinkListRow = Covers<"LinkListRow", Schemas["LinkListRow"], LinkListRow>;
export type _LinkStats = Covers<"LinkStats", Schemas["LinkStats"], LinkStats>;

export type _ExportListRow = Covers<"ExportListRow", Schemas["ExportListRow"], ExportListRow>;
export type _CollectionListRow = Covers<
  "CollectionListRow",
  Schemas["CollectionListRow"],
  CollectionListRow
>;

export type _AuditEntry = Covers<"AuditEntry", Schemas["AuditEntry"], AuditEntry>;
export type _User = Covers<"User", Schemas["UserOut"], User>;

/**
 * The check itself.
 *
 * Every entry above has to be `true`. One that has drifted is the error object,
 * which is not assignable, and the compiler names it.
 */
const _contractHolds: {
  Me: _Me;
  LoginResponse: _LoginResponse;
  Acknowledged: _Acknowledged;
  Project: _Project;
  SiteListRow: _Site;
  ApprovalListRow: _ApprovalListRow;
  Notice: _Notice;
  NoticeListRow: _NoticeListRow;
  Purpose: _Purpose;
  Processor: _Processor;
  DataSource: _DataSource;
  ConsentRow: _ConsentRow;
  ConsentListRow: _ConsentListRow;
  LinkListRow: _LinkListRow;
  LinkStats: _LinkStats;
  ExportListRow: _ExportListRow;
  CollectionListRow: _CollectionListRow;
  AuditEntry: _AuditEntry;
  User: _User;
} = {
  Me: true,
  LoginResponse: true,
  Acknowledged: true,
  Project: true,
  SiteListRow: true,
  ApprovalListRow: true,
  Notice: true,
  NoticeListRow: true,
  Purpose: true,
  Processor: true,
  DataSource: true,
  ConsentRow: true,
  ConsentListRow: true,
  LinkListRow: true,
  LinkStats: true,
  ExportListRow: true,
  CollectionListRow: true,
  AuditEntry: true,
  User: true,
};

void _contractHolds;
