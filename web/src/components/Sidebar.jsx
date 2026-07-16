export default function Sidebar({
  modules,
  questions,
  currentIndex,
  responses,
  assessments,
  allAssessments,
  stats,
  month,
  onMonthChange,
  onJumpTo,
  onJumpToModule,
  owners,
  ownerFilter,
  onOwnerFilterChange,
  statusFilter,
  onStatusFilterChange,
  reminders
}) {
  const currentModuleId = questions[currentIndex]?.moduleId;

  // Helper: check if a prior assessment carries forward for this quest/month
  const getCarriedAssessment = (questId) => {
    const quest = questions.find(q => q.questId === questId);
    if (!quest || !quest.recurrenceInterval || quest.recurrenceInterval === "none") return null;
    if (!allAssessments || !allAssessments.length) return null;

    const nextDue = quest.nextDueDate ? quest.nextDueDate.slice(0, 7) : null;

    const prior = allAssessments
      .filter(a =>
        (a.questId === questId || a.quest_id === questId) &&
        (a.reviewStatus === "FINISHED" || a.review_status === "FINISHED") &&
        (a.month || "") <= month
      )
      .sort((a, b) => (b.month || "").localeCompare(a.month || ""));

    if (prior.length === 0) return null;
    const latest = prior[0];

    // If next_due_date is set and is after the selected month, carry forward
    if (nextDue && nextDue >= month) return latest;

    // Otherwise check interval window
    const intervalMonths = { weekly: 0, fortnightly: 0, monthly: 1, quarterly: 3, "semi-annual": 6, annual: 12 };
    const maxMonths = intervalMonths[quest.recurrenceInterval] || 1;
    const assessMonth = latest.month || "";
    const monthDiff = (parseInt(month.slice(0, 4)) - parseInt(assessMonth.slice(0, 4))) * 12 +
                      (parseInt(month.slice(5, 7)) - parseInt(assessMonth.slice(5, 7)));
    if (monthDiff >= 0 && monthDiff < maxMonths) return latest;

    return null;
  };

  const getModuleStats = (moduleId) => {
    const moduleQuests = questions.filter(q => q.moduleId === moduleId);
    const assessed = moduleQuests.filter(q => {
      let assessment = assessments.find(a => 
        (a.questId === q.questId || a.quest_id === q.questId) && 
        (a.month === month || String(a.month) === String(month))
      );
      if (!assessment) assessment = getCarriedAssessment(q.questId);
      return assessment && (assessment.reviewStatus === "FINISHED" || assessment.review_status === "FINISHED");
    }).length;
    return { assessed, total: moduleQuests.length };
  };

  const getQuestionDot = (questId) => {
    // Check this month's assessment
    if (assessments && assessments.length) {
      const a = assessments.find(x => (x.questId === questId || x.quest_id === questId));
      if (a && (a.reviewStatus || a.review_status) === 'FINISHED') return 'dot-implemented';
    }
    // Check carry-forward
    const carried = getCarriedAssessment(questId);
    if (carried) return 'dot-implemented';

    const resp = responses[questId];
    if (resp?.answer === "IMPLEMENTED") return "dot-implemented";
    if (resp?.answer === "NOT_IMPLEMENTED") return "dot-notimpl";
    if (resp?.answer === "PARTIALLY_IMPLEMENTED") return "dot-partial";
    if (resp?.answer === "PLANNED") return "dot-planned";
    if (resp?.answer === "NOT_APPLICABLE") return "dot-na";
    // Legacy support
    if (resp?.answer === "YES") return "dot-implemented";
    if (resp?.answer === "NO") return "dot-notimpl";
    if (resp?.answer === "WIP") return "dot-partial";
    return "dot-unanswered";
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div style={{ width: "100%", maxWidth: 200, height: 56, overflow: "hidden", display: "flex", alignItems: "center" }}>
          <img src="/prism-logo.png" alt="PRISM" style={{ width: "100%", display: "block", transform: "scale(0.62)", transformOrigin: "center center" }} />
        </div>
      </div>

      <div className="sidebar-month">
        <label>Assessment month</label>
        <select value={month} onChange={(e) => onMonthChange(e.target.value)}>
          {(() => {
            const options = [];
            for (let year = 2026; year >= 2023; year--) {
              for (let m = 12; m >= 1; m--) {
                const value = `${year}-${String(m).padStart(2, '0')}`;
                const date = new Date(value + '-01');
                const label = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
                options.push(<option key={value} value={value}>{label}</option>);
              }
            }
            return options;
          })()}
        </select>
      </div>

      <div className="sidebar-month">
        <label>Filter by owner</label>
        <select value={ownerFilter} onChange={(e) => onOwnerFilterChange(e.target.value)}>
          <option value="">All owners</option>
          {owners && owners.map((owner) => (
            <option key={owner} value={owner}>{owner}</option>
          ))}
        </select>
      </div>

      <div className="sidebar-month">
        <label>Filter by status</label>
        <select value={statusFilter} onChange={(e) => onStatusFilterChange(e.target.value)}>
          <option value="">All statuses</option>
          <option value="IMPLEMENTED">Implemented</option>
          <option value="PARTIALLY_IMPLEMENTED">Partially Implemented</option>
          <option value="PLANNED">Planned</option>
          <option value="NOT_IMPLEMENTED">Not Implemented</option>
          <option value="NOT_APPLICABLE">Not Applicable</option>
          <option value="UNANSWERED">Unanswered</option>
          <option value="OVERDUE">Overdue</option>
        </select>
      </div>

      <nav className="module-nav">
        {modules.map((module) => {
          const moduleStats = getModuleStats(module.moduleId);
          const isActive = currentModuleId === module.moduleId;
          const moduleQuests = questions.filter(q => q.moduleId === module.moduleId);

          return (
            <div key={module.moduleId} className="module-group">
              <button
                className={`module-btn ${isActive ? "active" : ""}`}
                onClick={() => onJumpToModule(module.moduleId)}
              >
                <div className="module-dot"></div>
                <div className="module-btn-text">
                  <div className="module-id">{module.moduleId}</div>
                  <div className="module-name">{module.name}</div>
                </div>
                <div className="module-progress">
                  {moduleStats.assessed}/{moduleStats.total}
                </div>
              </button>
              {isActive && (
                <div className="quest-list">
                  {moduleQuests.map((quest, idx) => {
                    const questIndex = questions.indexOf(quest);
                    const hasReminder = reminders && reminders.some(r => (r.questId === quest.questId || r.quest_id === quest.questId));
                    const dotClass = getQuestionDot(quest.questId);
                    const statusClass = dotClass.replace('dot-', 'status-');
                    return (
                      <button
                        key={quest.questId}
                        className={`quest-nav-item ${statusClass} ${questIndex === currentIndex ? "active" : ""}`}
                        onClick={() => onJumpTo(questIndex)}
                      >
                        <div className={`quest-status-dot ${dotClass}`}></div>
                        <span className="quest-nav-text">
                          {quest.questId && <span className="quest-nav-id">{quest.questId}</span>}
                          {quest.baselineQuestion
                            ? quest.baselineQuestion.length > 40
                              ? quest.baselineQuestion.slice(0, 40) + "…"
                              : quest.baselineQuestion
                            : quest.controlArea}
                        </span>
                        {hasReminder && <span className="reminder-badge" title="Upcoming reminder">⏰</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="score-summary">
          <div className="score-box">
            <div className="score-label">Total quests</div>
            <div className="score-val">{stats.total}</div>
          </div>
          <div className="score-box">
            <div className="score-label">Implemented</div>
            <div className="score-val green">{stats.yesEligible}</div>
          </div>
          <div className="score-box">
            <div className="score-label">Assessed</div>
            <div className="score-val">{stats.assessed}</div>
          </div>
          <div className="score-box">
            <div className="score-label">Score</div>
            <div className="score-val">
              {stats.total > 0 ? Math.round((stats.yesEligible / stats.total) * 100) : 0}%
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
