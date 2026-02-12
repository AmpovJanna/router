
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
  onEditTask?: (phaseId: string, taskId: string, title: string, description: string) => void;
}

const Workspace: React.FC<WorkspaceProps> = ({ plan, risks = null, strategy = null, onToggleTask, onUpdateTaskStatus, onEditTask }) => {
  // "Roadmap" is the primary tab; within it the user can switch between Plan and Task Board.
  const [currentTab, setCurrentTab] = useState<'roadmap' | 'board' | 'risks'>('roadmap');

  // Task editing state
  const [editingTask, setEditingTask] = useState<{ phaseId: string; taskId: string; title: string; description: string } | null>(null);

  const handleStartEdit = (phaseId: string, taskId: string, title: string, description: string) => {
    setEditingTask({ phaseId, taskId, title, description });
  };

  const handleSaveEdit = () => {
    if (editingTask && onEditTask) {
      onEditTask(editingTask.phaseId, editingTask.taskId, editingTask.title, editingTask.description);
    }
    setEditingTask(null);
  };

  const handleCancelEdit = () => {
    setEditingTask(null);
  };

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

  const exportToPDF = () => {
    if (!plan) return;
    
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const totalTasks = plan.phases.reduce((acc, phase) => acc + phase.tasks.length, 0);
    const completedTasks = plan.phases.reduce((acc, phase) => 
      acc + phase.tasks.filter(t => t.status === 'done' || t.completed).length, 0
    );
    const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <title>${plan.projectName} - Project Plan</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
      background: white;
    }
    .header {
      text-align: center;
      border-bottom: 3px solid #FF8E72;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    h1 {
      font-size: 32px;
      color: #2D2424;
      margin-bottom: 10px;
    }
    .meta {
      color: #666;
      font-size: 14px;
    }
    .progress-bar {
      background: #e0e0e0;
      height: 20px;
      border-radius: 10px;
      margin: 20px 0;
      overflow: hidden;
    }
    .progress-fill {
      background: #FF8E72;
      height: 100%;
      border-radius: 10px;
      transition: width 0.3s;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
      margin: 30px 0;
      text-align: center;
    }
    .stat-box {
      background: #f5f5f5;
      padding: 15px;
      border-radius: 8px;
    }
    .stat-number {
      font-size: 28px;
      font-weight: bold;
      color: #FF8E72;
    }
    .stat-label {
      font-size: 12px;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .phase {
      margin: 30px 0;
      page-break-inside: avoid;
    }
    .phase-header {
      background: #FF8E72;
      color: white;
      padding: 15px 20px;
      border-radius: 8px 8px 0 0;
      font-size: 18px;
      font-weight: bold;
    }
    .tasks {
      background: #fafafa;
      border: 1px solid #e0e0e0;
      border-top: none;
      border-radius: 0 0 8px 8px;
    }
    .task {
      padding: 15px 20px;
      border-bottom: 1px solid #e0e0e0;
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }
    .task:last-child {
      border-bottom: none;
    }
    .task-checkbox {
      width: 20px;
      height: 20px;
      border: 2px solid #ccc;
      border-radius: 4px;
      flex-shrink: 0;
      margin-top: 2px;
    }
    .task.completed .task-checkbox {
      background: #FF8E72;
      border-color: #FF8E72;
    }
    .task-content h4 {
      font-size: 16px;
      margin-bottom: 5px;
      color: #2D2424;
    }
    .task.completed h4 {
      text-decoration: line-through;
      color: #999;
    }
    .task-content p {
      font-size: 14px;
      color: #666;
    }
    @media print {
      body { padding: 20px; }
      .phase { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${plan.projectName}</h1>
    <div class="meta">Generated on ${new Date().toLocaleDateString()}</div>
  </div>

  <div class="progress-bar">
    <div class="progress-fill" style="width: ${progress}%"></div>
  </div>

  <div class="stats">
    <div class="stat-box">
      <div class="stat-number">${plan.phases.length}</div>
      <div class="stat-label">Phases</div>
    </div>
    <div class="stat-box">
      <div class="stat-number">${totalTasks}</div>
      <div class="stat-label">Total Tasks</div>
    </div>
    <div class="stat-box">
      <div class="stat-number">${completedTasks}</div>
      <div class="stat-label">Completed</div>
    </div>
  </div>

  ${plan.phases.map((phase, idx) => `
    <div class="phase">
      <div class="phase-header">
        Phase ${idx + 1}: ${phase.name}
      </div>
      <div class="tasks">
        ${phase.tasks.map(task => `
          <div class="task ${task.status === 'done' || task.completed ? 'completed' : ''}">
            <div class="task-checkbox"></div>
            <div class="task-content">
              <h4>${task.title}</h4>
              ${task.description ? `<p>${task.description}</p>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('')}

  <script>
    window.onload = () => {
      setTimeout(() => {
        window.print();
      }, 500);
    };
  </script>
</body>
</html>`;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
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
                      <div
                        key={task.id}
                        className={`group w-full text-left flex gap-4 p-4 rounded-2xl border transition-all shadow-sm ${
                          task.status === 'done'
                            ? 'bg-white border-black/5 hover:border-primary/30'
                            : 'bg-white/50 border-black/5 hover:border-primary/30'
                        }`}
                      >
                        <button
                          onClick={() => onToggleTask(phase.id, task.id)}
                          className="mt-0.5 shrink-0"
                        >
                          <span className={`material-symbols-outlined !text-2xl transition-colors ${
                            task.status === 'done' ? 'text-primary fill-1' : 'text-gray-200'
                          }`}>
                            {task.status === 'done' ? 'check_circle' : 'radio_button_unchecked'}
                          </span>
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <h5
                              onClick={() => handleStartEdit(phase.id, task.id, task.title, task.description)}
                              className={`text-sm font-bold transition-colors cursor-pointer hover:text-primary ${
                                task.status === 'done' ? 'text-text-main' : 'text-text-main/70'
                              }`}
                            >
                              {task.title}
                            </h5>
                            <button
                              onClick={() => handleStartEdit(phase.id, task.id, task.title, task.description)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-black/5 rounded text-gray-400 hover:text-primary"
                              title="Edit task"
                            >
                              <span className="material-symbols-outlined !text-[16px]">edit</span>
                            </button>
                          </div>
                          <p
                            onClick={() => handleStartEdit(phase.id, task.id, task.title, task.description)}
                            className={`text-xs leading-relaxed mt-1 transition-colors cursor-pointer hover:text-gray-600 ${
                              task.status === 'done' ? 'text-gray-500' : 'text-gray-400'
                            }`}
                          >
                            {task.description}
                          </p>
                        </div>
                      </div>
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
                      <div className="flex items-start justify-between gap-2">
                        <h5
                          onClick={() => handleStartEdit(task.phaseId, task.id, task.title, task.description)}
                          className="text-sm font-bold text-text-main mb-1 cursor-pointer hover:text-primary"
                        >
                          {task.title}
                        </h5>
                        <button
                          onClick={() => handleStartEdit(task.phaseId, task.id, task.title, task.description)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-black/5 rounded text-gray-400 hover:text-primary"
                          title="Edit task"
                        >
                          <span className="material-symbols-outlined !text-[16px]">edit</span>
                        </button>
                      </div>
                      <p
                        onClick={() => handleStartEdit(task.phaseId, task.id, task.title, task.description)}
                        className="text-[11px] text-gray-400 leading-normal line-clamp-2 cursor-pointer hover:text-gray-600"
                      >
                        {task.description}
                      </p>
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

      {/* Task Edit Modal */}
      {editingTask && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-lg shadow-2xl border border-black/5">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-text-main">Edit Task</h3>
              <button
                onClick={handleCancelEdit}
                className="p-2 hover:bg-black/5 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
              >
                <span className="material-symbols-outlined !text-[20px]">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                  Task Title
                </label>
                <input
                  type="text"
                  value={editingTask.title}
                  onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-black/5 rounded-xl text-sm font-medium text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all"
                  placeholder="Enter task title..."
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                  Description
                </label>
                <textarea
                  value={editingTask.description}
                  onChange={(e) => setEditingTask({ ...editingTask, description: e.target.value })}
                  rows={4}
                  className="w-full px-4 py-3 bg-gray-50 border border-black/5 rounded-xl text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all resize-none"
                  placeholder="Enter task description..."
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={handleCancelEdit}
                className="px-5 py-2.5 text-sm font-bold text-gray-500 hover:text-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                className="px-5 py-2.5 bg-primary text-white text-sm font-bold rounded-xl hover:bg-primary/90 transition-colors shadow-sm"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="p-4 border-t border-black/5 flex items-center justify-center gap-8 bg-white/20 shrink-0">
        <button className="flex items-center gap-2 text-gray-400 hover:text-primary transition-colors">
          <span className="material-symbols-outlined !text-[20px]">print</span>
          <span className="text-[10px] font-bold uppercase tracking-tighter">Print Plan</span>
        </button>
        <button onClick={exportPlan} className="flex items-center gap-2 text-gray-400 hover:text-primary transition-colors">
          <span className="material-symbols-outlined !text-[20px]">download</span>
          <span className="text-[10px] font-bold uppercase tracking-tighter">Export JSON</span>
        </button>
        <button onClick={exportToPDF} className="flex items-center gap-2 text-primary hover:text-primary/80 transition-colors">
          <span className="material-symbols-outlined !text-[20px]">picture_as_pdf</span>
          <span className="text-[10px] font-bold uppercase tracking-tighter">Export PDF</span>
        </button>
      </footer>
    </section>
  );
};

export default Workspace;
