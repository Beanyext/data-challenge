export type Answer = 'yes' | 'no' | 'na' | number;
export interface Scale { min?: number; max: number; steps: { value: number; label: string }[] }
export interface Section { id: string; name?: string; score?: number | null }
export interface Criterion { id: string; section_id?: string; title: string; description: string; answer_type: 'binary' | 'scale'; weight: number; scale?: Scale | null; na_allowed?: boolean; na_rule?: string | null; notes?: string | null; gross_error?: boolean; _stepsText?: string }
export interface Checklist { id: string; version: number; name: string; sections: Section[]; criteria: Criterion[] }
export interface CriterionResult { criterion_id: string; answer: Answer; original_answer?: Answer; weight?: number; effective_weight?: number; points?: number | null; score?: number | null; explanation?: string; na_reason?: string | null; needs_review?: boolean; evidence?: { turn: number; quote: string }[]; checked_range?: { from: number; to: number } | null }
export interface Evaluation { id: string; conversation_id?: string; checklist_id?: string; checklist_version?: number; checklist?: Checklist; model?: string; total: number | null; original_total?: number | null; gross_error?: boolean; criteria: CriterionResult[]; sections?: Section[] }
export interface Appeal { id: string; evaluation_id: string; criterion_id: string; conversation_id?: string; criterion_title?: string; comment: string; status: 'open' | 'confirmed' | 'changed'; decision?: { answer: Answer; reason: string } | null }
export interface Turn { speaker: string; text: string; timestamp?: string }
export interface DialogRecord { conversation_id: string; title?: string; subject?: string; channel: string; language: string; transcript?: Turn[]; evaluation_id?: string; total?: number | null; gross_error?: boolean; status?: string }
export interface Filters { query: string; channel: string; language: string; status: string }
