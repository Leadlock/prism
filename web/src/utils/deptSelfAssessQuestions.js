export const DEPT_META = {
  IT: { label: "IT & Security", icon: "💻", description: "Information systems, access controls, and cybersecurity practices" },
  HR: { label: "Human Resources", icon: "👥", description: "Employee data handling, contracts, and privacy practices" },
  Finance: { label: "Finance", icon: "💰", description: "Financial data protection and compliance controls" },
  Legal: { label: "Legal & Compliance", icon: "⚖️", description: "Regulatory obligations and consent management" },
  Operations: { label: "Operations", icon: "⚙️", description: "Process controls, vendor management, and business continuity" },
  Marketing: { label: "Marketing", icon: "📣", description: "Customer data usage, consent, and communication practices" },
};

export const DEPT_QUESTIONS = {
  IT: [
    // 1. Data & systems
    { id: "it-1",  section: "Data & Systems",             text: "Do you maintain an inventory of systems/applications that store personal data?" },
    { id: "it-2",  section: "Data & Systems",             text: "Do you know what types of personal data each system contains?" },
    { id: "it-3",  section: "Data & Systems",             text: "Can you identify where a specific individual's personal data exists?" },
    { id: "it-4",  section: "Data & Systems",             text: "Do you have any tool for discovering/classifying personal data?" },
    // 2. Privacy & consent
    { id: "it-5",  section: "Privacy & Consent",          text: "Do you have a documented privacy notice?" },
    { id: "it-6",  section: "Privacy & Consent",          text: "How is consent collected and recorded where required?" },
    { id: "it-7",  section: "Privacy & Consent",          text: "Can individuals withdraw consent?" },
    { id: "it-8",  section: "Privacy & Consent",          text: "Do you have a defined process for handling Data Principal requests such as correction or erasure?" },
    // 3. Retention & deletion
    { id: "it-9",  section: "Retention & Deletion",       text: "Do you have documented retention periods for personal data?" },
    { id: "it-10", section: "Retention & Deletion",       text: "Are retention/deletion rules technically enforced?" },
    { id: "it-11", section: "Retention & Deletion",       text: "Can you actually delete an individual's data from all relevant systems?" },
    { id: "it-12", section: "Retention & Deletion",       text: "How are backups handled when personal data is deleted?" },
    // 4. Access & security
    { id: "it-13", section: "Access & Security",          text: "Is MFA enabled for employees?" },
    { id: "it-14", section: "Access & Security",          text: "Is role-based access implemented?" },
    { id: "it-15", section: "Access & Security",          text: "Are access rights periodically reviewed?" },
    { id: "it-16", section: "Access & Security",          text: "Is there a formal Joiner-Mover-Leaver process?" },
    { id: "it-17", section: "Access & Security",          text: "Do you have endpoint protection/EDR?" },
    { id: "it-18", section: "Access & Security",          text: "Are employee devices centrally managed?" },
    { id: "it-19", section: "Access & Security",          text: "Do you have controls to prevent unauthorised sharing of personal data?" },
    // 5. Applications & cloud
    { id: "it-20", section: "Applications & Cloud",       text: "Are internet-facing applications containing personal data protected by a WAF/API security solution?" },
    { id: "it-21", section: "Applications & Cloud",       text: "Do you continuously monitor cloud environments for misconfigurations and exposure?" },
    { id: "it-22", section: "Applications & Cloud",       text: "Are excessive permissions and publicly exposed resources detected?" },
    { id: "it-23", section: "Applications & Cloud",       text: "Do you scan applications for vulnerabilities?" },
    // 6. Third parties
    { id: "it-24", section: "Third Parties",              text: "Do you maintain a list of third parties/vendors that process personal data?" },
    { id: "it-25", section: "Third Parties",              text: "Are vendors assessed for security/privacy risks?" },
    { id: "it-26", section: "Third Parties",              text: "Do you review third-party access to personal data?" },
    // 7. Breach & incident response
    { id: "it-27", section: "Breach & Incident Response", text: "Do you have a documented personal-data breach/incident response process?" },
    { id: "it-28", section: "Breach & Incident Response", text: "Can you identify what data and individuals were affected during an incident?" },
    { id: "it-29", section: "Breach & Incident Response", text: "Do you have centralised security monitoring?" },
    { id: "it-30", section: "Breach & Incident Response", text: "Are backups regularly tested for recovery?" },
    // Stress-test questions
    { id: "it-31", section: "Stress Test",                text: "If a customer asked today what personal data you hold about them, could you answer confidently?" },
    { id: "it-32", section: "Stress Test",                text: "If they ask you to delete their personal data, can you identify and delete it from every relevant system?" },
    { id: "it-33", section: "Stress Test",                text: "If personal data is leaked tonight, how quickly would you know?" },
    { id: "it-34", section: "Stress Test",                text: "If an auditor asks you to prove that your security controls are working, can you produce the evidence?" },
  ],
  HR: [
    { id: "hr-1", text: "Is employee personal data collected only for specified, legitimate purposes?" },
    { id: "hr-2", text: "Do employment contracts include data protection obligations for employees?" },
    { id: "hr-3", text: "Is there a documented retention schedule for employee records?" },
    { id: "hr-4", text: "Are employees trained on data protection and privacy at least annually?" },
    { id: "hr-5", text: "Is access to HR systems and employee data limited to HR personnel?" },
    { id: "hr-6", text: "Do you have a process for responding to employee subject access requests?" },
    { id: "hr-7", text: "Are background check data and sensitive employee records stored separately and securely?" },
  ],
  Finance: [
    { id: "fi-1", text: "Is financial and payment data stored in compliance with applicable standards (e.g., PCI-DSS)?" },
    { id: "fi-2", text: "Are financial records access-controlled with multi-factor authentication?" },
    { id: "fi-3", text: "Do you have controls to detect and prevent unauthorised financial data access or fraud?" },
    { id: "fi-4", text: "Is customer financial data shared with third parties only under formal data-sharing agreements?" },
    { id: "fi-5", text: "Are financial data retention and disposal policies documented and enforced?" },
    { id: "fi-6", text: "Do you conduct periodic reviews to ensure only necessary financial data is retained?" },
  ],
  Legal: [
    { id: "lg-1", text: "Have you identified all applicable data protection regulations for your business (e.g., DPDPA, GDPR)?" },
    { id: "lg-2", text: "Do you have a documented legal basis for each category of personal data you process?" },
    { id: "lg-3", text: "Are consent mechanisms in place where required, and is consent properly recorded?" },
    { id: "lg-4", text: "Do you have a process to handle data subject rights requests (access, deletion, correction) within statutory timelines?" },
    { id: "lg-5", text: "Are data processing agreements in place with all third-party processors?" },
    { id: "lg-6", text: "Is there a designated Data Protection Officer or privacy lead responsible for compliance?" },
    { id: "lg-7", text: "Are data breach notification obligations understood and documented?" },
  ],
  Operations: [
    { id: "op-1", text: "Are data protection requirements included in procurement and vendor onboarding processes?" },
    { id: "op-2", text: "Do you maintain a register of all third parties that process personal data on your behalf?" },
    { id: "op-3", text: "Are business continuity and disaster recovery plans documented and tested?" },
    { id: "op-4", text: "Is personal data minimisation (collecting only what is necessary) applied in operational processes?" },
    { id: "op-5", text: "Are physical access controls in place for premises where personal data is processed?" },
    { id: "op-6", text: "Do you conduct data protection impact assessments (DPIAs) for high-risk processing activities?" },
  ],
  Marketing: [
    { id: "mk-1", text: "Is explicit, informed consent obtained before sending marketing communications?" },
    { id: "mk-2", text: "Do you maintain a suppression list of individuals who have opted out of marketing?" },
    { id: "mk-3", text: "Are customer data sources documented and verified to ensure lawful data acquisition?" },
    { id: "mk-4", text: "Do marketing campaigns comply with applicable anti-spam and e-privacy regulations?" },
    { id: "mk-5", text: "Are customer profiles and segmentation data stored securely with appropriate access controls?" },
    { id: "mk-6", text: "Is personal data shared with marketing agencies or ad platforms covered by data processing agreements?" },
    { id: "mk-7", text: "Do you have a process to remove customer data from marketing systems upon request?" },
  ],
};

export const ANSWER_OPTIONS = [
  { value: "YES",         label: "Yes",         score: 1,    color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
  { value: "PARTIAL",     label: "Partially",   score: 0.5,  color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  { value: "NO",          label: "No",          score: 0,    color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
  { value: "NA",          label: "N/A",         score: null, color: "#94a3b8", bg: "rgba(148,163,184,0.12)" },
];

export const DEFAULT_DEPTS = ["IT", "HR", "Finance", "Legal", "Operations", "Marketing"];
