// Planner UI types (aligned with backend artifact schema)
// Source of truth: shared/src/grand_router_contracts/artifacts.py

export type PlannerTaskStatus = 'todo' | 'doing' | 'done';

export interface PlannerTask {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  status: PlannerTaskStatus;
}

export interface PlannerPhase {
  id: string;
  title: string;
  icon: string;
  tasks: PlannerTask[];
}

export interface PlannerProjectPlan {
  projectName: string;
  currentProgress: number;
  phases: PlannerPhase[];
}

export interface PlannerMessage {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: string;
}
