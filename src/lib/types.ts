// Core domain types for OpenBid. Every vendor quote, regardless of source,
// is normalized into `Quote`. Every price carries an `Evidence` record.

export type SourceType = "catalog" | "phone";

export type EvidenceKind =
  | "catalog_url"
  | "menu_document"
  | "phone_transcript"
  | "restaurant_confirmation"
  | "user_provided"
  | "computed";

export interface Evidence {
  kind: EvidenceKind;
  /** Human-readable source label, e.g. "Panda Express catering catalog snapshot". */
  label: string;
  /** URL, file path, Senso content id, or Guava call id. */
  ref?: string;
  /** Verbatim text the value was taken from. */
  quote?: string;
}

export interface QuoteItem {
  name: string;
  category: "standard" | "vegetarian" | "vegan";
  quantity: number;
  unitPrice: number | null;
  evidence: Evidence | null;
  /** True when the item's dietary label is not confirmed by a source. */
  dietaryUnverified?: boolean;
}

export type RequirementStatus = "confirmed" | "uncertain" | "not_available" | "unknown";

export interface DietaryFinding {
  status: RequirementStatus;
  rawAnswer: string;
  evidence: Evidence | null;
}

export interface Quote {
  id: string;
  vendorId: string;
  vendorName: string;
  sourceType: SourceType;
  items: QuoteItem[];
  subtotal: number | null;
  deliveryFee: number | null;
  deliveryFeeEvidence: Evidence | null;
  taxRate: number;
  taxEstimate: number | null;
  total: number | null;
  minimumOrder: number | null;
  minimumOrderEvidence: Evidence | null;
  canFulfillCount: RequirementStatus;
  deliveryPromise: string | null; // ISO timestamp
  deliveryPromiseEvidence: Evidence | null;
  vegetarian: DietaryFinding;
  vegan: DietaryFinding;
  allergen: DietaryFinding & { allergy: string } | null;
  quoteConfidence: number;
  quoteValidUntil: string | null;
  quoteValidRaw: string | null;
  missingFields: string[];
  /** Answers to the requester's custom call questions. */
  extraAnswers?: { question: string; answer: string }[];
  createdAt: string;
}

export interface OrderRequest {
  deliveryAddress: string;
  deliveryDeadline: string; // ISO
  headcount: number;
  budget: number;
  vegetarianQty: number;
  veganQty: number;
  allergies: string[];
  foodPreferences: string;
  maxRadiusMiles: number;
  permissionToCall: boolean;
  taxRate: number;
  rawText?: string;
}

export type Variant = "A_online_only" | "B_online_plus_phone";

export type VendorStage =
  | "searching"
  | "menu_found"
  | "no_menu"
  | "awaiting_call_approval"
  | "calling"
  | "answered"
  | "collecting_menu"
  | "confirming_dietary"
  | "repeating_quote"
  | "quote_extracted"
  | "quote_received"
  | "checking_constraints"
  | "ready"
  | "skipped"
  | "failed";

export interface TranscriptLine {
  speaker: "AGENT" | "RESTAURANT";
  text: string;
  at: string;
}

export interface CallRecord {
  id: string; // our id
  guavaCallId: string | null;
  vendorId: string;
  purpose: "quote" | "confirmation";
  toNumber: string;
  direction?: "outbound" | "inbound";
  /** Set when outbound is unavailable: the Guava number the restaurant must call. */
  dialIn?: string;
  status: "dialing" | "in_progress" | "completed" | "failed";
  stageLabel: string;
  transcript: TranscriptLine[];
  fields: Record<string, unknown>;
  terminationReason?: string;
  error?: string;
  startedAt: string;
  endedAt?: string;
}

export interface ConstraintCheck {
  key: string;
  label: string;
  hard: boolean;
  passed: boolean | null; // null = cannot determine
  detail: string;
}

export interface Evaluation {
  vendorId: string;
  eligible: boolean;
  statusLabel: string;
  checks: ConstraintCheck[];
  softScore: number; // 0-100
  softBreakdown: { label: string; score: number; weight: number; detail: string }[];
  warnings: string[];
  requiresAllergenAck: boolean;
}

export interface AuditEvent {
  id: string;
  at: string;
  action: string;
  actor: "agent" | "user" | "system" | "restaurant" | "stripe" | "guava" | "senso" | "openai";
  evidence?: Evidence | null;
  confidence?: number | null;
  raw?: unknown;
  decisionAffected?: string | null;
  humanApproval?: { required: boolean; granted?: boolean; by?: string; at?: string } | null;
}

export interface VendorState {
  vendorId: string;
  name: string;
  sourceType: SourceType;
  distanceMiles: number | null;
  address?: string;
  /** Link to the real-world location record (Google Maps / OpenStreetMap). */
  locationRef?: string;
  /** The demo restaurant whose phone is the presenter's phone. */
  isDemo?: boolean;
  /** E.164 phone for restaurants added from search results. */
  phone?: string;
  stage: VendorStage;
  note?: string;
  quoteId?: string;
  callId?: string;
}

export interface Payment {
  stripeSessionId: string;
  url: string;
  status: "created" | "paid" | "expired";
  amountTotal: number;
  createdAt: string;
  paidAt?: string;
}

export interface Run {
  id: string;
  createdAt: string;
  updatedAt: string;
  status:
    | "sourcing"
    | "awaiting_call_approval"
    | "comparing"
    | "awaiting_selection"
    | "awaiting_payment"
    | "paid"
    | "confirming"
    | "confirmed"
    | "confirmation_failed"
    | "error";
  error?: string;
  variant: Variant;
  order: OrderRequest;
  vendors: VendorState[];
  quotes: Quote[];
  calls: CallRecord[];
  evaluations: Evaluation[];
  recommendation: {
    vendorId: string | null;
    summary: string;
    decisionConfidence: number;
  } | null;
  selection: {
    vendorId: string;
    quoteId: string;
    allergenAcknowledged: boolean;
    approvedAt: string;
  } | null;
  payment: Payment | null;
  buyerVerification?: { provider: "persona"; inquiryId: string; status: string; verified: boolean; verifiedAt?: string };
  restaurantConfirmation: {
    status: "pending" | "calling" | "confirmed" | "declined" | "failed" | "not_applicable";
    detail: string;
    callId?: string;
  } | null;
  audit: AuditEvent[];
  callScript: import("./questions").ScriptQuestion[];
  discovery: {
    venue: { display: string; source: string } | null;
    candidates: import("./discovery").Candidate[];
    searching?: boolean;
    startedAt?: string;
    error?: string;
  } | null;
  metrics: {
    startedAt: string;
    quotesCompletedAt?: string;
  };
}
