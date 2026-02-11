
import React, { useEffect, useMemo, useState } from 'react';
import type { PlannerProjectPlan, PlannerTaskStatus } from '../plannerTypes';

type ParsedEstimate = { costUsd?: number; days?: number };

type EstimateTotals = { costUsd?: number; days?: number };

const formatUsd = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
};

const formatDays = (days: number): string => {
  const rounded = Math.round(days * 100) / 100;
  const isInt = Math.abs(rounded - Math.round(rounded)) < 1e-9;
  const value = isInt ? String(Math.round(rounded)) : String(rounded);
  return `${value} day${rounded === 1 ? '' : 's'}`;
};

const parseNumberLoose = (raw: string): number | undefined => {
  const s = (raw || '').trim();
  if (!s) return undefined;
  const normalized = s.replace(/,/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
};

const extractEstimateFromText = (text: string | undefined | null): ParsedEstimate => {
  const t = (text || '').replace(/\s+/g, ' ');
  if (!t) return {};

  // Allow either order of cost/time, and allow the estimate to appear anywhere.
  // Examples: "(Est: $0, 3 days)", "Est: 3 days, $0", "Est: $1,200  5 day"
  const estWindowMatch = t.match(/\bEst\s*:\s*([^\)\]]+)(?:\)|\]|$)/i);
  const window = (estWindowMatch?.[1] || t).trim();

  const costMatch = window.match(/\$\s*([\d,]+(?:\.\d+)?)/);
  const daysMatch = window.match(/(\d+(?:\.\d+)?)\s*days?\b/i);

  const costUsd = costMatch ? parseNumberLoose(costMatch[1]) : undefined;
  const days = daysMatch ? parseNumberLoose(daysMatch[1]) : undefined;

  return {
    ...(costUsd != null ? { costUsd } : {}),
    ...(days != null ? { days } : {}),
  };
};

const getTaskEstimate = (task: any): ParsedEstimate => {
  // Prefer structured fields if they exist (supports multiple naming conventions).
  const structuredCost =
    task?.estimateCostUsd ??
    task?.estimate_cost_usd ??
    task?.estimateCost ??
    task?.estimate_cost ??
    task?.costUsd ??
    task?.cost_usd;

  const structuredDays =
    task?.estimateDays ??
    task?.estimate_days ??
    task?.estimateTimeDays ??
    task?.estimate_time_days ??
    task?.days;

  const costUsd = structuredCost != null ? parseNumberLoose(String(structuredCost)) : undefined;
  const days = structuredDays != null ? parseNumberLoose(String(structuredDays)) : undefined;

  if (costUsd != null || days != null) {
    return {
      ...(costUsd != null ? { costUsd } : {}),
      ...(days != null ? { days } : {}),
    };
  }

  // Fallback to parsing from task title/description.
  const fromTitle = extractEstimateFromText(task?.title);
  const fromDesc = extractEstimateFromText(task?.description);

  return {
    ...(fromTitle.costUsd != null ? { costUsd: fromTitle.costUsd } : {}),
    ...(fromTitle.days != null ? { days: fromTitle.days } : {}),
    ...(fromDesc.costUsd != null ? { costUsd: fromDesc.costUsd } : {}),
    ...(fromDesc.days != null ? { days: fromDesc.days } : {}),
  };
};

const mergeTotals = (a: EstimateTotals, b: ParsedEstimate): EstimateTotals => {
  return {
    ...(a.costUsd != null || b.costUsd != null ? { costUsd: (a.costUsd || 0) + (b.costUsd || 0) } : {}),
    ...(a.days != null || b.days != null ? { days: (a.days || 0) + (b.days || 0) } : {}),
  };
};

const formatTotals = (totals: EstimateTotals): string => {
  const parts: string[] = [];
  if (totals.costUsd != null) parts.push(formatUsd(totals.costUsd));
  if (totals.days != null) parts.push(formatDays(totals.days));
  return parts.join(' • ');
};

interface WorkspaceProps {
  plan: PlannerProjectPlan | null;
  risks?: string[] | null;
  strategy?: string | null;
  onToggleTask: (phaseId: string, taskId: string) => void;
  onUpdateTaskStatus: (phaseId: string, taskId: string, status: PlannerTaskStatus) => void;
}

const Workspace: React.FC<WorkspaceProps> = ({ plan, risks = null, strategy = null, onToggleTask, onUpdateTaskStatus }) => {
  // "Roadmap" is the primary tab; within it the user can switch between Plan and Task Board.
  const [currentTab, setCurrentTab] = useState<'roadmap' | 'board' | 'risks'>('roadmap');

  const tabs = useMemo(
    () =>
      [
        { key: 'roadmap' as const, label: 'Roadmap', title: 'Roadmap view' },
        { key: 'risks' as const, label: 'Risks', title: 'Risks & mitigations' },
      ],
    []
  );

  if (!plan) {
    return (
      <section className="flex flex-col flex-1 glass-workspace bg-white/40 items-center justify-center p-10">
        <div className="text-center">
          <span className="material-symbols-outlined text-gray-300 text-6xl mb-4">analytics</span>
          <h2 className="text-xl font-bold text-gray-400">Waiting for a Project Request</h2>
          <p className="text-sm text-gray-500 max-w-sm mt-2">Describe your project goal in the chat sidebar to generate a structured roadmap.</p>
        </div>
      </section>
    );
  }

const formatRisk = (raw: string): { title: string; details: string; mitigation: string } => {
  const cleaned = (raw || '')
    .trim()
    .replace(/^\*\s+/, '')
    .replace(/^[-•]\s+/, '')
    .replace(/\*\*/g, '')
    .trim();

  // Split on "Mitigation:" if present.
  const [beforeMit, afterMit] = cleaned.split(/\bMitigation\s*:\s*/i);
  const mitigation = (afterMit || '').trim();

  // Title is text before first colon, if it looks like a label.
  const b = (beforeMit || '').trim();
  const parts = b.split(/:\s+/, 2);
  const title = (parts.length === 2 ? parts[0] : 'Risk').trim();
  const details = (parts.length === 2 ? parts[1] : b).trim();

  return {
    title: title || 'Risk',
    details,
    mitigation,
  };
};

  const exportPlan = () => {
    if (!plan) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(plan, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `${plan.projectName.replace(/\s+/g, '_')}_plan.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const allTasks = plan.phases.flatMap(p => p.tasks.map(t => ({ ...t, phaseId: p.id })));
  const todoTasks = allTasks.filter(t => t.status === 'todo' || (!t.status && !t.completed));
  const doingTasks = allTasks.filter(t => t.status === 'doing');
  const doneTasks = allTasks.filter(t => t.status === 'done' || t.completed);

  return (
    <section className="flex flex-col flex-1 glass-workspace bg-white/40 h-full overflow-hidden">
      <header className="p-6 border-b border-black/5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="font-bold text-lg tracking-tight">Workspace</h2>
          <div className="h-4 w-[1px] bg-black/10"></div>
          <span className="text-xs text-gray-500 font-medium truncate max-w-[200px]">{plan.projectName}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-gray-200/50 p-1.5 rounded-xl border border-black/5 backdrop-blur-sm">
            {[
              { key: 'roadmap' as const, label: 'Roadmap', title: 'Roadmap view' },
              { key: 'board' as const, label: 'Task Board', title: 'Task board view' },
              { key: 'risks' as const, label: 'Risks', title: 'Risks & mitigations' },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => setCurrentTab(t.key)}
                className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${currentTab === t.key ? 'bg-white text-primary shadow-sm border border-black/5' : 'text-gray-400 hover:text-gray-600'}`}
                title={t.title}
                type="button"
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {currentTab === 'roadmap' ? (
          <div className="p-10 max-w-2xl mx-auto space-y-12">
            {/* Progress Header */}
            <div className="bg-white/80 rounded-3xl p-6 border border-black/5 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold text-primary uppercase tracking-widest mb-1">Current Progress</p>
                <h3 className="text-2xl font-bold tracking-tight">{plan.currentProgress}% Complete</h3>
              </div>
              <div className="relative size-16 flex items-center justify-center">
                <svg className="size-full -rotate-90" viewBox="0 0 36 36">
                  <circle className="stroke-emerald-light" cx="18" cy="18" fill="none" r="16" strokeWidth="3"></circle>
                  <circle 
                    className="stroke-primary transition-all duration-1000 ease-out" 
                    cx="18" cy="18" fill="none" r="16" 
                    strokeDasharray={`${plan.currentProgress}, 100`} 
                    strokeLinecap="round" strokeWidth="3"
                  ></circle>
                </svg>
                <span className="absolute text-[10px] font-bold text-primary">{plan.currentProgress}%</span>
              </div>
            </div>

            {/* Phases */}
            <div className="space-y-10 pb-20">
              {plan.phases.map((phase) => {
                const phaseTotals = phase.tasks.reduce<EstimateTotals>((acc, t) => mergeTotals(acc, getTaskEstimate(t)), {});
                const totalsLabel = formatTotals(phaseTotals);

                return (
                  <div key={phase.id} className="phase-connector">
                    <div className="flex items-center gap-3 mb-6">
                      <div className={`p-1.5 rounded-lg ${phase.tasks.every(t => t.status !== 'done') ? 'bg-primary/20' : 'bg-primary'}`}>
                        <span className={`material-symbols-outlined !text-sm ${phase.tasks.every(t => t.status !== 'done') ? 'text-primary' : 'text-white'}`}>
                          {phase.icon || 'star'}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <h4 className={`text-sm font-bold uppercase tracking-widest ${phase.tasks.every(t => t.status !== 'done') ? 'text-gray-400' : 'text-primary'}`}>
                          {phase.title}
                        </h4>
                        {totalsLabel ? (
                          <div className="mt-1 text-[11px] font-bold text-text-main/80">
                            {totalsLabel}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="space-y-4 ml-2">
                    {phase.tasks.map((task) => (
                      <button
                        key={task.id}
                        onClick={() => onToggleTask(phase.id, task.id)}
                        className={`group w-full text-left flex gap-4 p-4 rounded-2xl border transition-all shadow-sm ${
                          task.status === 'done'
                            ? 'bg-white border-black/5 hover:border-primary/30' 
                            : 'bg-white/50 border-black/5 hover:border-primary/30'
                        }`}
                      >
                        <div className="mt-0.5">
                          <span className={`material-symbols-outlined !text-2xl transition-colors ${
                            task.status === 'done' ? 'text-primary fill-1' : 'text-gray-200'
                          }`}>
                            {task.status === 'done' ? 'check_circle' : 'radio_button_unchecked'}
                          </span>
                        </div>
                        <div>
                          <h5 className={`text-sm font-bold transition-colors ${
                            task.status === 'done' ? 'text-text-main group-hover:text-primary' : 'text-text-main/70'
                          }`}>
                            {task.title}
                          </h5>
                          <p className={`text-xs leading-relaxed mt-1 transition-colors ${
                            task.status === 'done' ? 'text-gray-500' : 'text-gray-400'
                          }`}>
                            {task.description}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : currentTab === 'board' ? (
          <div className="h-full p-6 flex gap-6 overflow-x-auto min-w-full custom-scrollbar">
            {[
              { id: 'todo' as PlannerTaskStatus, label: 'To Do', tasks: todoTasks, color: 'text-gray-400' },
              { id: 'doing' as PlannerTaskStatus, label: 'Doing', tasks: doingTasks, color: 'text-primary' },
              { id: 'done' as PlannerTaskStatus, label: 'Done', tasks: doneTasks, color: 'text-emerald-600' }
            ].map(column => (
              <div key={column.id} className="flex-1 min-w-[300px] flex flex-col gap-4">
                <div className="flex items-center justify-between px-2">
                  <h3 className={`text-xs font-black uppercase tracking-widest ${column.color}`}>
                    {column.label} <span className="ml-1 opacity-40">({column.tasks.length})</span>
                  </h3>
                  <button className="text-gray-300 hover:text-gray-600">
                    <span className="material-symbols-outlined !text-[18px]">add</span>
                  </button>
                </div>
                <div className="flex-1 bg-black/5 rounded-3xl p-3 flex flex-col gap-3 overflow-y-auto custom-scrollbar">
                  {column.tasks.map(task => (
                    <div 
                      key={task.id} 
                      className="bg-white p-4 rounded-2xl border border-black/5 shadow-sm group hover:shadow-md hover:border-primary/20 transition-all"
                    >
                      <h5 className="text-sm font-bold text-text-main mb-1">{task.title}</h5>
                      <p className="text-[11px] text-gray-400 leading-normal line-clamp-2">{task.description}</p>
                      <div className="mt-3 flex items-center justify-between pt-3 border-t border-black/5">
                        <span className="text-[9px] font-bold uppercase tracking-tighter text-gray-300">ID: {task.id}</span>
                        <div className="flex gap-1">
                          {column.id !== 'todo' && (
                            <button onClick={() => onUpdateTaskStatus(task.phaseId, task.id, 'todo')} className="p-1 hover:bg-black/5 rounded text-gray-400">
                              <span className="material-symbols-outlined !text-[16px]">arrow_back</span>
                            </button>
                          )}
                          {column.id !== 'done' && (
                            <button onClick={() => onUpdateTaskStatus(task.phaseId, task.id, column.id === 'todo' ? 'doing' : 'done')} className="p-1 hover:bg-black/5 rounded text-primary">
                              <span className="material-symbols-outlined !text-[16px]">arrow_forward</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {column.tasks.length === 0 && (
                    <div className="flex-1 flex flex-col items-center justify-center opacity-20 py-10">
                      <span className="material-symbols-outlined !text-4xl">inbox</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : currentTab === 'risks' ? (
          <div className="p-10 max-w-3xl mx-auto">
            <div className="bg-white/80 rounded-3xl p-6 border border-black/5 shadow-sm">
              <div className="flex items-center justify-between gap-6">
                <div>
                  <p className="text-[10px] font-bold text-primary uppercase tracking-widest mb-1">Risks & Mitigations</p>
                  <h3 className="text-2xl font-bold tracking-tight">What could go wrong</h3>
                  <p className="text-xs text-gray-500 mt-2 max-w-xl">Review these before executing the roadmap. Treat them as guardrails and mitigation reminders.</p>
                </div>
                <div className="hidden sm:flex items-center gap-2 text-gray-400">
                  <span className="material-symbols-outlined !text-[18px]">warning</span>
                  <span className="text-[10px] font-bold uppercase tracking-widest">
                    {(risks || []).map((r) => (r || '').trim()).filter((r) => r && !/^#{1,6}\s+/m.test(r)).length} items
                  </span>
                </div>
              </div>

              <div className="mt-6">
                {(!risks || risks.length === 0) ? (
                  <div className="rounded-2xl border border-black/5 bg-white/60 p-5 text-sm text-gray-500">
                    No risks artifact yet. Generate a plan to see risks here.
                  </div>
                ) : (
                  <ol className="space-y-3">
                    {risks
                      .map((r) => (r || '').trim())
                      // Drop headings that the planner sometimes includes in markdown form.
                      .filter((r) => r && !/^#{1,6}\s+/m.test(r))
                      .map((r) => formatRisk(r))
                      .map((r, idx) => (
                        <li key={idx} className="rounded-2xl border border-black/5 bg-white/60 p-4 shadow-sm">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 size-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                              <span className="text-[11px] font-extrabold text-primary">{idx + 1}</span>
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-text-main leading-relaxed">{r.title}</p>
                              {r.details ? (
                                <p className="mt-1 text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{r.details}</p>
                              ) : null}
                              {r.mitigation ? (
                                <div className="mt-3 rounded-xl border border-primary/10 bg-primary/5 p-3">
                                  <p className="text-[11px] font-extrabold uppercase tracking-widest text-primary">Mitigation</p>
                                  <p className="mt-1 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{r.mitigation}</p>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </li>
                      ))}
                  </ol>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <footer className="p-4 border-t border-black/5 flex items-center justify-center gap-8 bg-white/20 shrink-0">
        <button className="flex items-center gap-2 text-gray-400 hover:text-primary transition-colors">
          <span className="material-symbols-outlined !text-[20px]">print</span>
          <span className="text-[10px] font-bold uppercase tracking-tighter">Print Plan</span>
        </button>
        <button onClick={exportPlan} className="flex items-center gap-2 text-gray-400 hover:text-primary transition-colors">
          <span className="material-symbols-outlined !text-[20px]">download</span>
          <span className="text-[10px] font-bold uppercase tracking-tighter">Export JSON</span>
        </button>
        <button onClick={() => alert('Plan saved to browser!')} className="flex items-center gap-2 text-primary transition-colors">
          <span className="material-symbols-outlined !text-[20px]">save</span>
          <span className="text-[10px] font-bold uppercase tracking-tighter">Save Workspace</span>
        </button>
      </footer>
    </section>
  );
};

export default Workspace;
