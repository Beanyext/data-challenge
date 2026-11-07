export type Answer = 'yes' | 'no' | 'na' | number;
export interface Scale { min?: number; max: number; steps: { value: number; label: string }[] }
export interface Section { id: string; name?: string; score?: number | null; max?: number | null; effective_weight?: number | null }
export interface Criterion { id: string; section_id?: string; title: string; description: string; answer_type: 'binary' | 'scale'; weight: number; scale?: Scale | null; na_allowed?: boolean; na_rule?: string | null; notes?: string | null; gross_error?: boolean; _stepsText?: string }
export interface Checklist { id: string; version: number; name: string; sections: Section[]; criteria: Criterion[] }
export interface CriterionResult { criterion_id: string; title?: string | null; answer: Answer; original_answer?: Answer; weight?: number; effective_weight?: number; points?: number | null; score?: number | null; applicable?: boolean; gross_error?: boolean; explanation?: string; reason?: string | null; na_reason?: string | null; needs_review?: boolean; evidence?: { turn: number; quote: string }[]; checked_range?: { from: number; to: number } | null }
export interface Evaluation { id: string; conversation_id?: string; checklist_id?: string; checklist_version?: number; checklist?: Checklist; model?: string; total: number | null; original_total?: number | null; gross_error?: boolean; criteria: CriterionResult[]; sections?: Section[] }
export interface FragmentTurn { turn: number; speaker?: string; timestamp?: string; display_time?: string | null; text?: string }
export interface Appeal { id: string; evaluation_id: string; criterion_id: string; conversation_id?: string; criterion_title?: string | null; criterion?: CriterionResult | null; fragment?: FragmentTurn[]; total?: number | null; original_total?: number | null; comment: string; status: 'open' | 'confirmed' | 'changed'; decision?: { answer: Answer; reason: string } | null }
export interface Turn { speaker: string; text: string; timestamp?: string; display_time?: string | null }
export interface DialogRecord { conversation_id: string; title?: string; subject?: string; channel: string; language: string; transcript?: Turn[]; turns?: number; evaluation_id?: string | null; total?: number | null; gross_error?: boolean; gross_error_reason?: string | null; needs_review?: boolean; open_appeals?: number; duration_seconds?: number | null; checklist_id?: string | null; checklist_version?: number | null; status?: string }
export interface Filters { query: string; channel: string; language: string; status: string }
export type ScoreSort = 'asc' | 'desc' | null;
export interface Health { provider?: string; model?: string; estimate?: { based_on?: number; cost_per_dialog_usd?: number | null; seconds_per_dialog?: number | null; workers?: number } | null }
export interface SavedNotice { checklistId: string; version: number; criteria: number; stale: string[] }
