import { useEffect, useState } from "react";
import { apiFetch } from "../api/client.js";
import Sidebar from "../components/Sidebar.jsx";
import TopBar from "../components/TopBar.jsx";
import QuestionCard from "../components/QuestionCard.jsx";
import Toast from "../components/Toast.jsx";

export default function Tracker({ token, onLogout, user, company, branding, theme, onThemeToggle }) {
  const [modules, setModules] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [allAssessments, setAllAssessments] = useState([]);
  const [evidence, setEvidence] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [responses, setResponses] = useState({});
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [toast, setToast] = useState({ show: false, message: "", type: "" });
  const [loading, setLoading] = useState(true);
  const [ownerFilter, setOwnerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [reminders, setReminders] = useState([]);

  useEffect(() => {
    loadData();
    loadDraft();
  }, [token]);

  useEffect(() => {
    if (token) {
      loadAssessments();
    }
  }, [month, token]);

  useEffect(() => {
    setCurrentIndex(0);
  }, [ownerFilter, statusFilter]);

  const loadAssessments = async () => {
    try {
      const [monthAssessments, allAssessments] = await Promise.all([
        apiFetch(`/api/assessments?month=${month}`, { token }),
        apiFetch("/api/assessments", { token })
      ]);
      setAssessments(monthAssessments || []);
      setAllAssessments(allAssessments || []);
    } catch (err) {
      console.error("Error loading assessments:", err.message);
    }
  };

  const loadData = async () => {
    try {
      const [modulesData, questionsData, evidenceData, remindersData] = await Promise.all([
        apiFetch("/api/modules", { token }),
        apiFetch("/api/questions", { token }),
        apiFetch("/api/evidence", { token }),
        apiFetch("/api/reminders?upcoming=true", { token })
      ]);
      setModules(modulesData);
      setQuestions(questionsData);
      setEvidence(evidenceData || []);
      setReminders(remindersData || []);
      await loadAssessments();
      setLoading(false);
    } catch (err) {
      showToast("Error loading data: " + err.message);
      setLoading(false);
    }
  };

  const loadDraft = () => {
    try {
      const saved = localStorage.getItem("auditReady36_draft");
      if (saved) setResponses(JSON.parse(saved));
    } catch (e) {
      console.error("Failed to load draft:", e);
    }
  };

  // Derive unique owners for the filter dropdown
  const owners = [...new Set(questions.map(q => q.defaultOwner).filter(Boolean))].sort();

  // Get the effective assessment for a question: this month's, or carried forward from a prior month
  const getEffectiveAssessment = (questId) => {
    // First check if there's an assessment for the selected month
    const thisMonth = assessments.find(a =>
      (a.questId === questId || a.quest_id === questId) &&
      (a.month === month || String(a.month) === String(month))
    );
    if (thisMonth) return thisMonth;

    // Check carry-forward: find the latest completed assessment from any prior month
    const quest = questions.find(q => q.questId === questId);
    if (!quest) return null;

    // Only carry forward if recurrence is set and next_due_date is in the future (or not yet passed the selected month)
    const nextDue = quest.nextDueDate ? quest.nextDueDate.slice(0, 7) : null;
    const recurrence = quest.recurrenceInterval;
    if (!recurrence || recurrence === "none") return null;

    // Find the most recent FINISHED assessment for this quest before or equal to selected month
    const prior = allAssessments
      .filter(a =>
        (a.questId === questId || a.quest_id === questId) &&
        (a.reviewStatus === "FINISHED" || a.review_status === "FINISHED") &&
        (a.month || a.month) <= month
      )
      .sort((a, b) => (b.month || "").localeCompare(a.month || ""));

    if (prior.length === 0) return null;

    const latestAssessment = prior[0];
    // If next_due_date exists and is after the selected month, carry forward
    if (nextDue && nextDue >= month) {
      return { ...latestAssessment, _carriedForward: true };
    }

    // If no next_due_date set, still carry forward within the recurrence window
    // Calculate months since assessment based on recurrence
    const intervalMonths = { weekly: 0, fortnightly: 0, monthly: 1, quarterly: 3, "semi-annual": 6, annual: 12 };
    const maxMonths = intervalMonths[recurrence] || 1;
    const assessMonth = latestAssessment.month || "";
    const monthDiff = (parseInt(month.slice(0, 4)) - parseInt(assessMonth.slice(0, 4))) * 12 +
                      (parseInt(month.slice(5, 7)) - parseInt(assessMonth.slice(5, 7)));

    if (monthDiff >= 0 && monthDiff < maxMonths) {
      return { ...latestAssessment, _carriedForward: true };
    }

    return null;
  };

  // Filter questions by owner and status
  const filteredQuestions = questions.filter(q => {
    if (ownerFilter && q.defaultOwner !== ownerFilter) return false;
    if (statusFilter) {
      if (statusFilter === "OVERDUE") {
        // Show questions that are overdue (past due date)
        const isOverdue = q.isOverdue || q.status === 'OVERDUE' || (q.nextDueDate && new Date(q.nextDueDate) < new Date());
        if (!isOverdue) return false;
      } else {
        // Check assessment answer for this question in current month
        const assessment = getEffectiveAssessment(q.questId);
        const draftAnswer = responses[q.questId]?.answer;
        const answer = assessment?.answer || draftAnswer || null;

        if (statusFilter === "UNANSWERED") {
          if (answer) return false;
        } else {
          if (answer !== statusFilter) return false;
        }
      }
    }
    return true;
  });

  const saveDraft = () => {
    localStorage.setItem("auditReady36_draft", JSON.stringify(responses));
    showToast("Draft saved locally", "success");
  };

  const getResponse = (questId) => {
    const draft = responses[questId] || {
      answer: null,
      maturity: null,
      link: "",
      comment: "",
      files: [],
      actionOwner: "",
      actionDueDate: "",
      actionNotes: ""
    };
    
    // Load existing evidence for this question if not already in draft
    if (draft.files.length === 0) {
      const existingEvidence = evidence.filter(e => 
        (e.questId === questId || e.quest_id === questId) &&
        (e.month === month || String(e.month) === String(month))
      );
      if (existingEvidence.length > 0) {
        draft.files = existingEvidence.map(e => ({
          id: e.id,
          name: e.evidenceName || e.evidence_name,
          link: e.evidenceLink || e.evidence_link
        }));
      }
    }
    
    return draft;
  };

  const setResponse = (questId, key, value) => {
    setResponses(prev => ({
      ...prev,
      [questId]: {
        ...getResponse(questId),
        [key]: value
      }
    }));
  };

  const navigate = (direction) => {
    const newIndex = currentIndex + direction;
    if (newIndex >= 0 && newIndex < filteredQuestions.length) {
      setCurrentIndex(newIndex);
    }
  };

  const jumpTo = (index) => {
    setCurrentIndex(index);
  };

  const jumpToModule = (moduleId) => {
    const index = filteredQuestions.findIndex(q => q.moduleId === moduleId);
    if (index >= 0) setCurrentIndex(index);
  };

  const submitReview = async () => {
    const quest = filteredQuestions[currentIndex];
    const resp = getResponse(quest.questId);

    if (!resp.answer) {
      showToast("Please select an answer first");
      return;
    }
    if (!resp.maturity) {
      showToast("Please select a maturity level");
      return;
    }
    if (resp.answer === "IMPLEMENTED" && !resp.link && !(resp.files && resp.files.length > 0)) {
      showToast("Implemented requires an evidence upload or evidence link");
      return;
    }
    if (["NOT_IMPLEMENTED", "PARTIALLY_IMPLEMENTED", "PLANNED"].includes(resp.answer) && (!resp.actionDueDate || !resp.actionOwner || !resp.actionNotes)) {
      showToast(`${resp.answer.replace(/_/g, " ")} requires an action owner, due date, and notes`);
      return;
    }
    if (resp.answer === "NOT_APPLICABLE" && !resp.comment) {
      showToast("Not Applicable requires a justification in the comments");
      return;
    }

    try {
      const evidenceIds = (resp.files || [])
        .map(file => (file && typeof file === "object" ? file.id : null))
        .filter(Boolean);

      const created = await apiFetch("/api/assessments", {
        token,
        method: "POST",
        body: JSON.stringify({
          questId: quest.questId,
          moduleId: quest.moduleId,
          month,
          answer: resp.answer,
          currentLevel: resp.maturity,
          level3Plus: resp.answer === "IMPLEMENTED" && resp.maturity >= 3,
          evidenceLink: resp.link,
          owner: quest.defaultOwner,
          reviewStatus: "Submitted",
          scoreEligible: resp.answer === "IMPLEMENTED" && resp.maturity >= 3 && (resp.link || (resp.files && resp.files.length > 0)),
          comments: resp.comment,
          evidenceIds,
          actionOwner: resp.actionOwner,
          actionDueDate: resp.actionDueDate,
          actionNotes: resp.actionNotes
        })
      });

      // The API links submitted evidence; this fallback keeps older API versions compatible.
      if (resp.files && resp.files.length > 0) {
        for (const f of resp.files) {
          const evidenceId = f && f.id ? f.id : null;
          if (evidenceId) {
            try {
              await apiFetch(`/api/evidence/${evidenceId}`, { token, method: 'PUT', body: JSON.stringify({ evidenceId: String(created.id) }) });
            } catch (e) {
              console.error('Failed to link evidence', evidenceId, e.message);
            }
          }
        }
      }

      showToast("Submitted for review ✓", "success");
      // clear local draft for this question so old data isn't resubmitted
      setResponses(prev => {
        const copy = { ...prev };
        delete copy[quest.questId];
        return copy;
      });

      // refresh assessments so review gates and stats update
      try {
        const newAssessments = await apiFetch(`/api/assessments?month=${month}`, { token });
        setAssessments(newAssessments || []);
      } catch (e) {
        console.error('Failed to refresh assessments', e.message);
      }
      if (currentIndex < filteredQuestions.length - 1) {
        setTimeout(() => navigate(1), 800);
      }
    } catch (err) {
      showToast("Error submitting: " + err.message);
    }
  };

  const showToast = (message, type = "") => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: "", type: "" }), 2500);
  };

  const stats = {
    total: filteredQuestions.length,
    assessed: filteredQuestions.filter(q => {
      const assessment = getEffectiveAssessment(q.questId);
      return assessment && (assessment.reviewStatus === "FINISHED" || assessment.review_status === "FINISHED");
    }).length,
    yesEligible: filteredQuestions.filter(q => {
      const assessment = getEffectiveAssessment(q.questId);
      return assessment && 
        (assessment.reviewStatus === "FINISHED" || assessment.review_status === "FINISHED") &&
        (assessment.answer === "IMPLEMENTED" || assessment.answer === "YES") &&
        (assessment.currentLevel || assessment.current_level) >= 3 &&
        (assessment.scoreEligible === true || assessment.score_eligible === true);
    }).length
  };

  if (loading) {
    return (
      <div className="tracker-loading">
        <div className="loading-spinner"></div>
        <p>Loading assessment tracker...</p>
      </div>
    );
  }

  const currentQuest = filteredQuestions[currentIndex];

  return (
    <div className="tracker">
      <Sidebar
        modules={modules}
        questions={filteredQuestions}
        currentIndex={currentIndex}
        responses={responses}
        assessments={assessments}
        allAssessments={allAssessments}
        stats={stats}
        month={month}
        onMonthChange={setMonth}
        onJumpTo={jumpTo}
        onJumpToModule={jumpToModule}
        owners={owners}
        ownerFilter={ownerFilter}
        onOwnerFilterChange={setOwnerFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        reminders={reminders}
      />
      <main className="main">
        <TopBar
          currentIndex={currentIndex}
          total={filteredQuestions.length}
          onNavigate={navigate}
          onSaveDraft={saveDraft}
          onSubmitReview={submitReview}
          onLogout={onLogout}
          user={user}
          company={company}
          branding={branding}
          theme={theme}
          onThemeToggle={onThemeToggle}
        />
        <div className="card-area">
          {currentQuest && (
              (() => {
                const assessment = getEffectiveAssessment(currentQuest.questId);
                return (
                  <QuestionCard
                    key={currentQuest.questId}
                    question={currentQuest}
                    assessment={assessment}
                    response={getResponse(currentQuest.questId)}
                    onSetResponse={(key, value) => setResponse(currentQuest.questId, key, value)}
                    token={token}
                    month={month}
                    reminders={reminders.filter(r => r.questId === currentQuest.questId || r.quest_id === currentQuest.questId)}
                    onEvidenceChange={async () => {
                      const evidenceData = await apiFetch("/api/evidence", { token });
                      setEvidence(evidenceData || []);
                    }}
                    onSaveActionDetails={async () => {
                      saveDraft();
                      const resp = getResponse(currentQuest.questId);
                      if (resp.actionDueDate) {
                        try {
                          await apiFetch(`/api/questions/${currentQuest.questId}/recurrence`, {
                            token,
                            method: "PUT",
                            body: JSON.stringify({ nextDueDate: resp.actionDueDate })
                          });
                          // Refresh questions so the due pill updates
                          const questionsData = await apiFetch("/api/questions", { token });
                          setQuestions(questionsData);
                        } catch (err) {
                          console.error("Failed to save due date:", err.message);
                        }
                      }
                    }}
                  />
                );
              })()
          )}
        </div>
      </main>
      <Toast show={toast.show} message={toast.message} type={toast.type} />
    </div>
  );
}
