export type Locale = 'ru' | 'kk' | 'en';
export type Localized = Record<Locale, string>;
export type Skill = 'empathy' | 'accuracy' | 'safety' | 'resolution' | 'professionalism';
export type Mode = 'story' | 'quick' | 'daily' | 'mistakes' | 'boss';
export type Tag = 'empathy' | 'clarify' | 'solution' | 'rude' | 'avoid' | 'promise' | 'unsafe';
export interface Emotion { stress: number; trust: number }
export interface QualityError { id: string; skill: Skill; penalty: number; explanation: Localized }
export interface Action {
  id: string; text: Localized; tags: Tag[]; effects: Emotion; events: string[];
  errors: QualityError[]; critical?: boolean; next: string;
  reaction: Localized; tenseReaction?: Localized;
  transition?: { stressGte: number; next: string };
}
export interface DialogueNode { id: string; title: Localized; prompt: Localized; hint: Localized; idealActionId: string; actions: Action[]; terminal?: 'resolved' | 'unresolved' }
export interface Check { id: string; skill: Skill; event: string; points: number; label: Localized }
export interface Objective { id: string; label: Localized; required: boolean }
export interface Mission {
  id: string; version: 1; order: number; title: Localized; summary: Localized; client: Localized;
  objective: Localized; difficulty: 1 | 2 | 3; duration: number; maxXP: 100 | 150 | 200; unlock: number;
  start: string; initial: Emotion; maxTurns: number; objectives: Objective[]; checks: Check[];
  knowledge: Localized[]; nodes: Record<string, DialogueNode>;
}
export interface Turn { nodeId: string; actionId: string; nextNodeId: string; emotion: Emotion; tense: boolean }
export interface Session {
  id: string; missionId: string; mode: Mode; nodeId: string; emotion: Emotion; events: string[];
  turns: Turn[]; critical: boolean; hintedNodes: string[]; status: 'active' | 'completed'; startedAt: string;
}
export interface Evaluation {
  score: number; rawScore: number; skills: Record<Skill, number>; passed: boolean; critical: boolean;
  completedGoals: string[]; missedGoals: string[]; passedChecks: string[]; missedChecks: string[];
  errors: { turn: number; nodeId: string; actionId: string; errorId: string }[];
}
export interface Attempt extends Evaluation {
  id: string; missionId: string; mode: Mode; finishedAt: string; turns: Turn[]; hintedNodes: string[];
  initial: Emotion; final: Emotion; xpEarned: number; newAwards: string[];
}
export interface AcademyState {
  version: 1; dataset: 'broker-v1'; contributions: Record<string, number>; best: Record<string, number>;
  mastered: string[]; awards: Record<string, string>; completedDays: string[]; history: Attempt[];
  active: Session | null; demoUnlocked: boolean;
}
export interface LevelInfo { level: number; total: number; progress: number; remaining: number; rank: number; maximum: boolean }
export interface ResponseSource { kind: 'local'; choose(session: Session, mission: Mission, actionId: string): Session }
