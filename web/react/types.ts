export type Answer = 'yes' | 'no' | 'na' | number;
export type Notify = (message: string, error?: boolean) => void;
export interface Scale { min?: number; max: number; steps: { value: number; label: string }[] }
export interface Section { id: string; name?: string; score?: number | null; max?: number | null; effective_weight?: number | null }
export interface Criterion { id: string; section_id?: string; title: string; description: string; answer_type: 'binary' | 'scale'; weight: number; scale?: Scale | null; na_allowed?: boolean; na_rule?: string | null; notes?: string | null; gross_error?: boolean; _stepsText?: string }
export interface Checklist { id: string; version: number; name: string; sections: Section[]; criteria: Criterion[]; rounding?: { digits: number }; guidance?: string[] }
export interface CriterionResult { criterion_id: string; title?: string | null; answer: Answer; applicable?: boolean; gross_error?: boolean; reason?: string | null; original_answer?: Answer; weight?: number; effective_weight?: number; points?: number | null; score?: number | null; weighted_score?: number; explanation?: string; na_reason?: string | null; needs_review?: boolean; evidence?: { turn: number; quote?: string }[]; checked_range?: { from: number; to: number } | null; review_reason?: string | null; decision?: { answer: Answer; reason: string; status?: string; decided_at?: string } | null }
export interface Evaluation { id: string; conversation_id?: string; checklist_id?: string; checklist_version?: number; checklist?: Checklist; model?: string; provider?: string; demo?: boolean; total: number | null; original_total?: number | null; original_criteria?: CriterionResult[]; gross_error?: boolean; criteria: CriterionResult[]; sections?: Section[]; evaluated_at?: string; calls?: { model?: string }[]; model_mode?: string; complete?:boolean; missing?:string[] }
export interface FragmentTurn { turn: number; speaker?: string; timestamp?: string; display_time?: string | null; text?: string }
export interface Appeal { id: string; evaluation_id: string; criterion_id: string; conversation_id?: string; criterion_title?: string | null; criterion?: CriterionResult | null; fragment?: FragmentTurn[]; total?: number | null; original_total?: number | null; comment: string; status: 'open' | 'confirmed' | 'changed'; context_unavailable?: boolean; decision?: { answer: Answer; reason: string; decided_at?: string } | null }
export interface Turn { speaker: string; text: string; timestamp?: string; display_time?: string | null }
export interface DialogRecord { conversation_id: string; title?: string; subject?: string; channel: string; language: string; transcript?: Turn[]; evaluation_id?: string | null; turns?: number; duration_seconds?: number | null; checklist_id?: string | null; checklist_version?: number | null; gross_error_reason?: string | null; open_appeals?: number; total?: number | null; gross_error?: boolean; needs_review?: boolean; status?: string }
export interface Filters { query: string; channel: string; language: string; status: string }
export interface ListState { filters: Filters; queue: 'all' | 'attention'; summaryScope: 'filtered' | 'all'; selected: Set<string> }
export interface AudioData { url?: string; audio_url?: string; turn_offsets?: Record<string, number> }
export interface Job { id: string; status: string; completed?: number; total?: number; evaluation_ids?: string[]; failed?: number; errors?: { conversation_id?: string; evaluation_id?: string; error?: string }[] }
export type ScoreSort = 'asc' | 'desc' | null;
export interface Health { provider?: string; model?: string; estimate?: { based_on?: number; cost_per_dialog_usd?: number | null; seconds_per_dialog?: number | null; workers?: number } | null }
export interface SavedNotice { checklistId: string; version: number; criteria: number; stale: string[] }
export interface Api {
  demo: boolean;
  listDialogs(): Promise<DialogRecord[]>;
  getDialog(id: string): Promise<DialogRecord>;
  listChecklists(): Promise<Checklist[]>;
  saveChecklist(checklist: Checklist): Promise<Checklist>;
  importDialogs(groupId: string): Promise<{ message?: string }>;
  uploadDialog(file: File): Promise<unknown>;
  evaluate(ids: string[], checklistId: string): Promise<Job>;
  getJob(id: string): Promise<Job>;
  getEvaluation(id: string): Promise<Evaluation>;
  listAppeals(): Promise<Appeal[]>;
  createAppeal(payload: { evaluation_id: string; criterion_id: string; comment: string }): Promise<Appeal>;
  decideAppeal(id: string, payload: { answer: Answer; reason: string; status: 'confirmed' | 'changed' }): Promise<Appeal>;
  getAudio(id: string): Promise<AudioData>;
  getHealth?(): Promise<Health>;
}
