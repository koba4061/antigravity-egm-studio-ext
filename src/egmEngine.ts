import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { LlmClient, ChatTurn, extractJsonFromText } from './llmClient';
import { WebSearchService, WebSearchResultItem } from './webSearch';
import {
    EgmLanguage,
    GoldfishReviewLenses,
    getElephantClarifyPrompt,
    getElephantBrainstormPrompt,
    getElephantDraftPrompt,
    buildGoldfishReviewPrompt,
    getElephantResolvePrompt,
    getElephantImplementPrompt,
    getGoldfishDriftReportPrompt
} from './prompts';

export interface GoldfishReviewItem {
    id: string;
    severity: 'Critical' | 'High' | 'Medium' | 'Low' | string;
    category: string;
    title: string;
    summary?: string;
    description: string;
    suggestion: string;
    resolved?: boolean;
}

export interface GoldfishReviewState {
    paraphrase: string;
    reviewedAt: string;
    roundCount?: number;
    readinessScore?: number;
    verdict?: 'PASS' | 'REVISION_NEEDED' | string;
    resolvedInRound?: boolean;
    findings: GoldfishReviewItem[];
}

export interface ClarifyingQuestionItem {
    id: string;
    category: string;
    question: string;
    whyItMatters?: string;
    options: string[];
}

export interface ClarifyingInterviewData {
    stressTest: string[];
    questions: ClarifyingQuestionItem[];
    rawMarkdown?: string;
}

export interface PersistedUiInputs {
    step1Idea: string;
    wizardAnswers: Record<string, { question: string; answer: string }>;
    wizardCurrentIdx?: number;
    step2Extra: string;
    step3Lenses?: GoldfishReviewLenses;
    selectedReviewIds?: string[] | null;
    step4Comment: string;
    step4OpenDiff?: boolean;
    step5FeatureName: string;
    updatedAt?: string;
}

export interface WorkspaceEgmStatus {
    hasWorkspace: boolean;
    workspaceName: string;
    outputFolder: string;
    isGreenfield: boolean;
    hasBrief: boolean;
    briefPreview: string;
    hasDraft: boolean;
    draftPreview: string;
    briefNewerThanDraft: boolean;
    draftApproved: boolean;
    elephantTurnCount: number;
    clarifyingNotes: string;
    clarifyingInterview: ClarifyingInterviewData | null;
    uiInputs: PersistedUiInputs;
    goldfishParaphrase: string;
    reviewRoundCount: number;
    readinessScore: number;
    reviewVerdict: string;
    resolvedInCurrentRound: boolean;
    reviews: GoldfishReviewItem[];
    webResearch: WebSearchResultItem[];
    approvedSpecs: string[];
    hasClarifyMd: boolean;
    hasStep2Diff: boolean;
    hasReviewReportMd: boolean;
    hasStep4Diff: boolean;
    hasSitemapMd: boolean;
    hasImplementationGuide: boolean;
    hasDriftReport: boolean;
    canRunStep2: boolean;
    canRunStep3: boolean;
    canRunStep4: boolean;
    canApproveStep5: boolean;
    canRunStep5SddTools: boolean;
    currentStep: number; // 1 to 5
}

export class EgmEngine {
    private readonly webSearch: WebSearchService;

    constructor(private readonly llmClient: LlmClient) {
        this.webSearch = new WebSearchService();
    }

    public getLanguage(): EgmLanguage {
        const cfg = vscode.workspace.getConfiguration('egmStudio');
        const lang = cfg.get<string>('language', 'en');
        return lang === 'ja' ? 'ja' : 'en';
    }

    public getSpecFolderName(): string {
        const cfg = vscode.workspace.getConfiguration('egmStudio');
        const raw = (cfg.get<string>('outputFolder', 'EleGold_Specs') || 'EleGold_Specs').trim();
        const cleaned = raw
            .replace(/^[/\\]+|[/\\]+$/g, '')
            .replace(/\.\./g, '')
            .replace(/[:*?"<>|]/g, '_');
        return cleaned || 'EleGold_Specs';
    }

    private getWorkspaceRoot(): string {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            const lang = this.getLanguage();
            throw new Error(
                lang === 'en'
                    ? 'No workspace folder is open. Please open a project folder in VS Code first.'
                    : 'ワークスペース（フォルダ）が開かれていません。先にVS Codeで対象プロジェクトのフォルダを開いてください。'
            );
        }
        return folder.uri.fsPath;
    }

    private getSpecDir(): string {
        return path.join(this.getWorkspaceRoot(), this.getSpecFolderName());
    }

    public async revealSpecFolder(): Promise<string> {
        const specDir = this.getSpecDir();
        await this.ensureDir(specDir);
        try {
            await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(specDir));
        } catch {
            await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(specDir));
        }
        return specDir;
    }

    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    private async ensureDir(dirPath: string): Promise<void> {
        await fs.mkdir(dirPath, { recursive: true });
    }

    /**
     * Inspects current workspace EGM files inside the dedicated EleGold_Specs folder
     * and determines current workflow step
     */
    public async getWorkspaceStatus(): Promise<WorkspaceEgmStatus> {
        const folder = vscode.workspace.workspaceFolders?.[0];
        const outputFolder = this.getSpecFolderName();
        const defaultUiInputs: PersistedUiInputs = {
            step1Idea: '',
            wizardAnswers: {},
            wizardCurrentIdx: 0,
            step2Extra: '',
            step3Lenses: {
                comprehension: true,
                edgeCases: true,
                consistency: true,
                security: true,
                readiness: true
            },
            selectedReviewIds: null,
            step4Comment: '',
            step4OpenDiff: true,
            step5FeatureName: 'initial-architecture'
        };

        if (!folder) {
            return {
                hasWorkspace: false,
                workspaceName: '(No Folder)',
                outputFolder,
                isGreenfield: true,
                hasBrief: false,
                briefPreview: '',
                hasDraft: false,
                draftPreview: '',
                briefNewerThanDraft: false,
                draftApproved: false,
                elephantTurnCount: 0,
                clarifyingNotes: '',
                clarifyingInterview: null,
                uiInputs: defaultUiInputs,
                goldfishParaphrase: '',
                reviewRoundCount: 0,
                readinessScore: 0,
                reviewVerdict: '',
                resolvedInCurrentRound: false,
                reviews: [],
                webResearch: [],
                approvedSpecs: [],
                hasClarifyMd: false,
                hasStep2Diff: false,
                hasReviewReportMd: false,
                hasStep4Diff: false,
                hasSitemapMd: false,
                hasImplementationGuide: false,
                hasDriftReport: false,
                canRunStep2: false,
                canRunStep3: false,
                canRunStep4: false,
                canApproveStep5: false,
                canRunStep5SddTools: false,
                currentStep: 1
            };
        }

        const root = folder.uri.fsPath;
        const specDir = path.join(root, outputFolder);
        const briefPath = path.join(specDir, 'concepts_brief.md');
        const draftPath = path.join(specDir, 'design_draft.md');
        const elephantPath = path.join(specDir, '.egm', 'elephant_context.json');
        const clarifyPath = path.join(specDir, '.egm', 'clarifying_questions.md');
        const clarifyJsonPath = path.join(specDir, '.egm', 'clarifying_questions.json');
        const uiInputsPath = path.join(specDir, '.egm', 'ui_inputs.json');
        const reviewsPath = path.join(specDir, '.egm', 'goldfish_reviews.json');
        const researchPath = path.join(specDir, '.egm', 'web_research.json');
        const designsDir = path.join(specDir, 'approved_specs');

        const hasBrief = await this.fileExists(briefPath);
        const hasDraft = await this.fileExists(draftPath);

        let briefPreview = '';
        if (hasBrief) {
            try {
                briefPreview = await fs.readFile(briefPath, 'utf-8');
            } catch {
                briefPreview = '';
            }
        }

        let draftApproved = false;
        let draftPreview = '';
        if (hasDraft) {
            try {
                const rawDraftText = await fs.readFile(draftPath, 'utf-8');
                draftPreview = rawDraftText;
                draftApproved = /Status:\s*`?Approved`?/i.test(rawDraftText.slice(0, 600));
            } catch {
                draftApproved = false;
            }
        }

        let elephantTurnCount = 0;
        let recoveredStep1Idea = '';
        if (await this.fileExists(elephantPath)) {
            try {
                const raw = await fs.readFile(elephantPath, 'utf-8');
                const parsed = JSON.parse(raw) as ChatTurn[];
                if (Array.isArray(parsed)) {
                    elephantTurnCount = parsed.length;
                    // Recover latest step1 user prompt as fallback if ui_inputs.json wasn't saved yet
                    for (let i = parsed.length - 1; i >= 0; i--) {
                        const turn = parsed[i];
                        if (
                            turn &&
                            turn.role === 'user' &&
                            (turn.phase === 'step1-brainstorm' || turn.phase === 'step1-clarify') &&
                            turn.content &&
                            turn.content.trim()
                        ) {
                            recoveredStep1Idea = turn.content;
                            break;
                        }
                    }
                }
            } catch {
                elephantTurnCount = 0;
            }
        }

        const uiInputs: PersistedUiInputs = { ...defaultUiInputs };
        if (await this.fileExists(uiInputsPath)) {
            try {
                const rawUi = JSON.parse(await fs.readFile(uiInputsPath, 'utf-8')) as Partial<PersistedUiInputs>;
                if (typeof rawUi.step1Idea === 'string') {
                    uiInputs.step1Idea = rawUi.step1Idea;
                }
                if (rawUi.wizardAnswers && typeof rawUi.wizardAnswers === 'object') {
                    uiInputs.wizardAnswers = rawUi.wizardAnswers;
                }
                if (typeof rawUi.wizardCurrentIdx === 'number' && rawUi.wizardCurrentIdx >= 0) {
                    uiInputs.wizardCurrentIdx = rawUi.wizardCurrentIdx;
                }
                if (typeof rawUi.step2Extra === 'string') {
                    uiInputs.step2Extra = rawUi.step2Extra;
                }
                if (rawUi.step3Lenses && typeof rawUi.step3Lenses === 'object') {
                    uiInputs.step3Lenses = {
                        comprehension: rawUi.step3Lenses.comprehension ?? true,
                        edgeCases: rawUi.step3Lenses.edgeCases ?? true,
                        consistency: rawUi.step3Lenses.consistency ?? true,
                        security: rawUi.step3Lenses.security ?? true,
                        readiness: rawUi.step3Lenses.readiness ?? true
                    };
                }
                if (Array.isArray(rawUi.selectedReviewIds)) {
                    uiInputs.selectedReviewIds = rawUi.selectedReviewIds;
                } else if (rawUi.selectedReviewIds === null) {
                    uiInputs.selectedReviewIds = null;
                }
                if (typeof rawUi.step4Comment === 'string') {
                    uiInputs.step4Comment = rawUi.step4Comment;
                }
                if (typeof rawUi.step4OpenDiff === 'boolean') {
                    uiInputs.step4OpenDiff = rawUi.step4OpenDiff;
                }
                if (typeof rawUi.step5FeatureName === 'string' && rawUi.step5FeatureName.trim()) {
                    uiInputs.step5FeatureName = rawUi.step5FeatureName;
                }
            } catch {
                // Keep defaults
            }
        }
        if (!uiInputs.step1Idea.trim() && recoveredStep1Idea.trim()) {
            uiInputs.step1Idea = recoveredStep1Idea;
        }

        let clarifyingNotes = '';
        if (await this.fileExists(clarifyPath)) {
            try {
                clarifyingNotes = await fs.readFile(clarifyPath, 'utf-8');
            } catch {
                clarifyingNotes = '';
            }
        }

        let clarifyingInterview: ClarifyingInterviewData | null = null;
        if (await this.fileExists(clarifyJsonPath)) {
            try {
                const rawJson = await fs.readFile(clarifyJsonPath, 'utf-8');
                const parsedJson = JSON.parse(rawJson) as ClarifyingInterviewData;
                if (parsedJson && Array.isArray(parsedJson.questions) && parsedJson.questions.length > 0) {
                    clarifyingInterview = parsedJson;
                }
            } catch {
                clarifyingInterview = null;
            }
        }

        let reviews: GoldfishReviewItem[] = [];
        let goldfishParaphrase = '';
        let reviewRoundCount = 0;
        let readinessScore = 0;
        let reviewVerdict = '';
        let parsedResolvedInRound = false;
        if (await this.fileExists(reviewsPath)) {
            try {
                const raw = await fs.readFile(reviewsPath, 'utf-8');
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    reviews = parsed;
                    reviewRoundCount = 1;
                    parsedResolvedInRound = reviews.some((r) => Boolean(r.resolved));
                } else if (parsed && Array.isArray(parsed.findings)) {
                    reviews = parsed.findings;
                    goldfishParaphrase = parsed.paraphrase || '';
                    reviewRoundCount = typeof parsed.roundCount === 'number' && parsed.roundCount > 0 ? parsed.roundCount : 1;
                    readinessScore = typeof parsed.readinessScore === 'number' ? parsed.readinessScore : 0;
                    reviewVerdict = typeof parsed.verdict === 'string' ? parsed.verdict : '';
                    parsedResolvedInRound =
                        typeof parsed.resolvedInRound === 'boolean'
                            ? parsed.resolvedInRound
                            : reviews.some((r) => Boolean(r.resolved));
                }
            } catch {
                reviews = [];
            }
        }
        // Fallback score calculation if existing goldfish_reviews.json was created before readinessScore was added
        if (reviews.length > 0 && readinessScore === 0) {
            const openItems = reviews.filter((r) => !r.resolved);
            const critCount = openItems.filter((r) => String(r.severity).toLowerCase() === 'critical').length;
            const highCount = openItems.filter((r) => String(r.severity).toLowerCase() === 'high').length;
            const medCount = openItems.filter((r) => String(r.severity).toLowerCase() === 'medium').length;
            const lowCount = openItems.filter((r) => String(r.severity).toLowerCase() === 'low').length;
            readinessScore = Math.max(35, Math.min(98, 100 - critCount * 22 - highCount * 12 - medCount * 5 - lowCount * 2));
            reviewVerdict = critCount === 0 && highCount === 0 ? 'PASS' : 'REVISION_NEEDED';
        }

        let webResearch: WebSearchResultItem[] = [];
        if (await this.fileExists(researchPath)) {
            try {
                const raw = await fs.readFile(researchPath, 'utf-8');
                const parsed = JSON.parse(raw) as WebSearchResultItem[];
                if (Array.isArray(parsed)) {
                    webResearch = parsed;
                }
            } catch {
                webResearch = [];
            }
        }

        let approvedSpecs: string[] = [];
        const nonSpecFiles = new Set(['SITEMAP.md', 'drift_report.md', 'implementation_output.md']);
        if (await this.fileExists(designsDir)) {
            try {
                const entries = await fs.readdir(designsDir);
                approvedSpecs = entries
                    .filter((f) => f.endsWith('.md') && !nonSpecFiles.has(f))
                    .sort()
                    .map((f) => `approved_specs/${f}`);
            } catch {
                approvedSpecs = [];
            }
        }

        const step2DiffPath = path.join(specDir, '.egm', 'design_draft.before_step2_update.md');
        const step4DiffPath = path.join(specDir, '.egm', 'design_draft.prev.md');
        const reviewReportMdPath = path.join(specDir, 'goldfish_review_report.md');
        const sitemapPath = path.join(designsDir, 'SITEMAP.md');
        const implGuidePath = path.join(designsDir, 'implementation_output.md');
        const driftReportPath = path.join(designsDir, 'drift_report.md');

        if (reviews.length > 0 && !(await this.fileExists(reviewReportMdPath))) {
            try {
                await this.writeGoldfishReviewMarkdown(
                    reviewReportMdPath,
                     {
                        paraphrase: goldfishParaphrase,
                        reviewedAt: new Date().toISOString(),
                        roundCount: reviewRoundCount,
                        readinessScore,
                        verdict: reviewVerdict,
                        findings: reviews
                    }
                );
            } catch {
                // Non-fatal
            }
        }

        const [
            hasClarifyMd,
            hasStep2Diff,
            hasReviewReportMd,
            hasStep4Diff,
            hasSitemapMd,
            hasImplementationGuide,
            hasDriftReport
        ] = await Promise.all([
            this.fileExists(clarifyPath),
            this.fileExists(step2DiffPath),
            this.fileExists(reviewReportMdPath),
            this.fileExists(step4DiffPath),
            this.fileExists(sitemapPath),
            this.fileExists(implGuidePath),
            this.fileExists(driftReportPath)
        ]);

        let isGreenfield = true;
        try {
            const topEntries = await fs.readdir(root);
            const egmManaged = new Set([
                '.git',
                '.egm',
                outputFolder,
                'EleGold_Specs',
                'concepts_brief.md',
                'design_draft.md',
                'docs',
                '.DS_Store'
            ]);
            const userFiles = topEntries.filter((name) => !egmManaged.has(name));
            isGreenfield = userFiles.length === 0;
        } catch {
            isGreenfield = true;
        }

        let briefNewerThanDraft = false;
        if (hasBrief && hasDraft) {
            try {
                const [briefStat, draftStat] = await Promise.all([
                    fs.stat(briefPath),
                    fs.stat(draftPath)
                ]);
                briefNewerThanDraft = briefStat.mtimeMs > draftStat.mtimeMs + 500;
            } catch {
                briefNewerThanDraft = false;
            }
        }

        // Calculate strict step completion & unlock flags (Steps 1..5)
        const canRunStep2 = hasBrief;
        const canRunStep3 = hasBrief && hasDraft && !briefNewerThanDraft;
        const canRunStep4 = canRunStep3 && reviews.length > 0;
        const resolvedInCurrentRound = canRunStep4 && (parsedResolvedInRound || reviews.some((r) => Boolean(r.resolved)));
        const critHighOpenCount = reviews.filter((r) => {
            const sev = String(r.severity || '').toLowerCase();
            return !r.resolved && (sev === 'critical' || sev === 'high');
        }).length;
        const canApproveStep5 =
            canRunStep3 &&
            reviews.length > 0 &&
            (resolvedInCurrentRound || critHighOpenCount === 0 || reviewVerdict === 'PASS');
        const canRunStep5SddTools = canApproveStep5 && (draftApproved || approvedSpecs.length > 0);

        // Calculate active step (1..5)
        let currentStep = 1;
        if (!hasBrief) {
            currentStep = 1;
        } else if (!hasDraft || briefNewerThanDraft) {
            currentStep = 2;
        } else if (reviews.length === 0) {
            currentStep = 3;
        } else if (!resolvedInCurrentRound && critHighOpenCount > 0 && !draftApproved) {
            currentStep = 4;
        } else {
            currentStep = 5;
        }

        return {
            hasWorkspace: true,
            workspaceName: folder.name,
            outputFolder,
            isGreenfield,
            hasBrief,
            briefPreview,
            hasDraft,
            draftPreview,
            briefNewerThanDraft,
            draftApproved,
            elephantTurnCount,
            clarifyingNotes,
            clarifyingInterview,
            uiInputs,
            goldfishParaphrase,
            reviewRoundCount,
            readinessScore,
            reviewVerdict,
            resolvedInCurrentRound,
            reviews,
            webResearch,
            approvedSpecs,
            hasClarifyMd,
            hasStep2Diff,
            hasReviewReportMd,
            hasStep4Diff: hasStep4Diff && resolvedInCurrentRound,
            hasSitemapMd,
            hasImplementationGuide,
            hasDriftReport,
            canRunStep2,
            canRunStep3,
            canRunStep4,
            canApproveStep5,
            canRunStep5SddTools,
            currentStep
        };
    }

    /**
     * Collects a concise snapshot of workspace structure and key metadata
     */
    private async gatherProjectContext(root: string): Promise<string> {
        const lines: string[] = ['### Workspace Structure'];
        try {
            const topEntries = await fs.readdir(root, { withFileTypes: true });
            const ignore = new Set([
                'node_modules',
                '.git',
                'out',
                'dist',
                'build',
                '.egm',
                '.vscode-test',
                'EleGold_Specs',
                this.getSpecFolderName()
            ]);
            let visibleCount = 0;
            for (const entry of topEntries.slice(0, 40)) {
                if (ignore.has(entry.name)) {
                    continue;
                }
                visibleCount++;
                if (entry.isDirectory()) {
                    lines.push(`- 📁 ${entry.name}/`);
                    try {
                        const subEntries = await fs.readdir(path.join(root, entry.name), { withFileTypes: true });
                        for (const sub of subEntries.slice(0, 15)) {
                            if (!ignore.has(sub.name)) {
                                lines.push(`  - ${sub.isDirectory() ? '📁' : '📄'} ${sub.name}`);
                            }
                        }
                    } catch {
                        // Ignore unreadable subdir
                    }
                } else {
                    lines.push(`- 📄 ${entry.name}`);
                }
            }
            if (visibleCount === 0) {
                lines.push(
                    '(Greenfield / Blank Project Directory — No existing source code yet. Please design the initial directory structure, tech stack, and entry points from scratch.)'
                );
            }
        } catch {
            lines.push('(Failed to list directory)');
        }

        const pkgPath = path.join(root, 'package.json');
        if (await this.fileExists(pkgPath)) {
            try {
                const pkgContent = (await fs.readFile(pkgPath, 'utf-8')).slice(0, 2000);
                lines.push('\n### package.json\n```json\n' + pkgContent + '\n```');
            } catch {
                // Ignore
            }
        }

        return lines.join('\n');
    }

    private async loadElephantHistory(specDir: string): Promise<ChatTurn[]> {
        const filePath = path.join(specDir, '.egm', 'elephant_context.json');
        if (!(await this.fileExists(filePath))) {
            return [];
        }
        try {
            const raw = await fs.readFile(filePath, 'utf-8');
            const data = JSON.parse(raw);
            return Array.isArray(data) ? data : [];
        } catch {
            return [];
        }
    }

    private async appendElephantHistory(
        specDir: string,
        phase: string,
        userPrompt: string,
        assistantReply: string
    ): Promise<void> {
        const egmDir = path.join(specDir, '.egm');
        await this.ensureDir(egmDir);
        const history = await this.loadElephantHistory(specDir);
        const now = new Date().toISOString();
        history.push(
            { role: 'user', content: userPrompt, timestamp: now, phase },
            { role: 'assistant', content: assistantReply, timestamp: now, phase }
        );
        await fs.writeFile(path.join(egmDir, 'elephant_context.json'), JSON.stringify(history, null, 2), 'utf-8');
    }

    public async saveUiInputs(partial: Partial<PersistedUiInputs>): Promise<void> {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            return;
        }
        const specDir = this.getSpecDir();
        const egmDir = path.join(specDir, '.egm');
        await this.ensureDir(egmDir);
        const uiInputsPath = path.join(egmDir, 'ui_inputs.json');

        let current: PersistedUiInputs = {
            step1Idea: '',
            wizardAnswers: {},
            step2Extra: '',
            step4Comment: '',
            step5FeatureName: 'initial-architecture'
        };
        if (await this.fileExists(uiInputsPath)) {
            try {
                const parsed = JSON.parse(await fs.readFile(uiInputsPath, 'utf-8')) as Partial<PersistedUiInputs>;
                current = { ...current, ...parsed };
            } catch {
                // Ignore corrupted file
            }
        }

        const merged: PersistedUiInputs = {
            step1Idea: typeof partial.step1Idea === 'string' ? partial.step1Idea : current.step1Idea,
            wizardAnswers:
                partial.wizardAnswers && typeof partial.wizardAnswers === 'object'
                    ? partial.wizardAnswers
                    : current.wizardAnswers,
            wizardCurrentIdx:
                typeof partial.wizardCurrentIdx === 'number'
                    ? partial.wizardCurrentIdx
                    : current.wizardCurrentIdx ?? 0,
            step2Extra: typeof partial.step2Extra === 'string' ? partial.step2Extra : current.step2Extra,
            step3Lenses:
                partial.step3Lenses && typeof partial.step3Lenses === 'object'
                    ? partial.step3Lenses
                    : current.step3Lenses,
            selectedReviewIds:
                partial.selectedReviewIds !== undefined ? partial.selectedReviewIds : current.selectedReviewIds,
            step4Comment: typeof partial.step4Comment === 'string' ? partial.step4Comment : current.step4Comment,
            step4OpenDiff:
                typeof partial.step4OpenDiff === 'boolean' ? partial.step4OpenDiff : current.step4OpenDiff ?? true,
            step5FeatureName:
                typeof partial.step5FeatureName === 'string' ? partial.step5FeatureName : current.step5FeatureName,
            updatedAt: new Date().toISOString()
        };

        await fs.writeFile(uiInputsPath, JSON.stringify(merged, null, 2), 'utf-8');
    }

    public async resetElephantHistory(): Promise<void> {
        const specDir = this.getSpecDir();
        const filesToRemove = [
            path.join(specDir, '.egm', 'elephant_context.json'),
            path.join(specDir, '.egm', 'clarifying_questions.md'),
            path.join(specDir, '.egm', 'clarifying_questions.json')
        ];
        for (const f of filesToRemove) {
            if (await this.fileExists(f)) {
                await fs.unlink(f);
            }
        }
    }

    /**
     * Rolls back downstream artifacts so the user can cleanly redo from a specific step (1, 2, or 3).
     * Preserves user text inputs in ui_inputs.json so the user never loses their typed idea!
     */
    public async rollbackToStep(targetStep: number): Promise<void> {
        const specDir = this.getSpecDir();
        const filesToRemove: string[] = [];

        if (targetStep <= 1) {
            filesToRemove.push(
                path.join(specDir, 'concepts_brief.md'),
                path.join(specDir, 'design_draft.md'),
                path.join(specDir, 'goldfish_review_report.md'),
                path.join(specDir, '.egm', 'goldfish_reviews.json'),
                path.join(specDir, '.egm', 'design_draft.prev.md'),
                path.join(specDir, '.egm', 'design_draft.before_step2_update.md'),
                path.join(specDir, '.egm', 'clarifying_questions.md'),
                path.join(specDir, '.egm', 'clarifying_questions.json'),
                path.join(specDir, '.egm', 'elephant_context.json')
            );
            await this.saveUiInputs({ selectedReviewIds: null, wizardCurrentIdx: 0 });
        } else if (targetStep === 2) {
            filesToRemove.push(
                path.join(specDir, 'design_draft.md'),
                path.join(specDir, 'goldfish_review_report.md'),
                path.join(specDir, '.egm', 'goldfish_reviews.json'),
                path.join(specDir, '.egm', 'design_draft.prev.md'),
                path.join(specDir, '.egm', 'design_draft.before_step2_update.md')
            );
            await this.saveUiInputs({ selectedReviewIds: null });
        } else if (targetStep === 3) {
            filesToRemove.push(
                path.join(specDir, 'goldfish_review_report.md'),
                path.join(specDir, '.egm', 'goldfish_reviews.json'),
                path.join(specDir, '.egm', 'design_draft.prev.md')
            );
            await this.saveUiInputs({ selectedReviewIds: null });
        }

        for (const f of filesToRemove) {
            if (await this.fileExists(f)) {
                await fs.unlink(f);
            }
        }
    }

    public async clearWebResearch(): Promise<void> {
        const specDir = this.getSpecDir();
        const filePath = path.join(specDir, '.egm', 'web_research.json');
        if (await this.fileExists(filePath)) {
            await fs.unlink(filePath);
        }
    }

    /**
     * Executes Web Search and stores findings in EleGold_Specs/.egm/web_research.json
     */
    public async executeWebSearch(query: string): Promise<WebSearchResultItem[]> {
        const specDir = this.getSpecDir();
        const egmDir = path.join(specDir, '.egm');
        await this.ensureDir(egmDir);
        const researchPath = path.join(egmDir, 'web_research.json');

        let existing: WebSearchResultItem[] = [];
        if (await this.fileExists(researchPath)) {
            try {
                existing = JSON.parse(await fs.readFile(researchPath, 'utf-8')) as WebSearchResultItem[];
            } catch {
                existing = [];
            }
        }

        const fresh = await this.webSearch.search(query, 5);
        const combined = [...fresh, ...existing];
        const seen = new Set<string>();
        const deduped: WebSearchResultItem[] = [];
        for (const item of combined) {
            if (!seen.has(item.url)) {
                seen.add(item.url);
                deduped.push(item);
            }
        }
        const trimmed = deduped.slice(0, 15);
        await fs.writeFile(researchPath, JSON.stringify(trimmed, null, 2), 'utf-8');
        return trimmed;
    }

    /**
     * Step 1A: 🐘 Ask Clarifying Questions (/egm-brainstorm Problem Drilling)
     */
    public async runStep1ClarifyQuestions(userIdea: string, useWebSearch: boolean): Promise<string> {
        const root = this.getWorkspaceRoot();
        const specDir = this.getSpecDir();
        const lang = this.getLanguage();
        const egmDir = path.join(specDir, '.egm');
        await this.ensureDir(egmDir);
        await this.saveUiInputs({ step1Idea: userIdea });

        const history = await this.loadElephantHistory(specDir);
        const projectContext = await this.gatherProjectContext(root);

        let webMarkdown = '';
        if (useWebSearch && userIdea.trim()) {
            const results = await this.executeWebSearch(userIdea.trim().slice(0, 140));
            webMarkdown = this.webSearch.formatResultsAsMarkdown(results.slice(0, 5));
        }

        const systemPrompt = getElephantClarifyPrompt(lang);
        const cacheableContext = [projectContext, webMarkdown ? `\n${webMarkdown}` : '']
            .filter(Boolean)
            .join('\n');
        const prompt = [
            lang === 'en' ? '## User Feature Idea / Concept' : '## ユーザーの初期アイデア・要望',
            userIdea
        ].join('\n');

        const response = await this.llmClient.callElephant(systemPrompt, prompt, history, {
            temperature: 0.3,
            useNativeWebSearch: useWebSearch,
            cacheableContext
        });

        const parsed = extractJsonFromText<{
            stressTest?: string[];
            questions?: ClarifyingQuestionItem[];
        }>(response);

        const clarifyPath = path.join(egmDir, 'clarifying_questions.md');
        const clarifyJsonPath = path.join(egmDir, 'clarifying_questions.json');

        if (parsed && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
            const interviewData: ClarifyingInterviewData = {
                stressTest: Array.isArray(parsed.stressTest) ? parsed.stressTest : [],
                questions: parsed.questions.map((q, idx) => ({
                    id: q.id || `Q${idx + 1}`,
                    category: q.category || (lang === 'en' ? 'Architecture' : '設計方針'),
                    question: q.question || '',
                    whyItMatters: q.whyItMatters || '',
                    options: Array.isArray(q.options) && q.options.length > 0
                        ? q.options
                        : lang === 'en'
                        ? ['(Recommended) Standard minimal implementation', 'Custom configuration']
                        : ['(推奨) 標準のシンプルな構成で実装する', 'カスタム構成で詳細を指定する']
                }))
            };
            await fs.writeFile(clarifyJsonPath, JSON.stringify(interviewData, null, 2), 'utf-8');

            const mdLines: string[] = [
                lang === 'en'
                    ? '### 🔍 Initial Stress-Test (Blind Spots & Risks)'
                    : '### 🔍 初期ストレスチェック（隠れた前提・リスクの指摘）',
                ...interviewData.stressTest.map((s) => `- ${s}`),
                '',
                lang === 'en'
                    ? '### ❓ Interactive Clarifying Questions'
                    : '### ❓ 仕様を固めるための深掘り質問 (選択肢をクリックして回答)'
            ];
            for (const q of interviewData.questions) {
                mdLines.push(`\n**${q.id} [${q.category}]: ${q.question}**`);
                if (q.whyItMatters) {
                    mdLines.push(`> 💡 ${q.whyItMatters}`);
                }
                for (const opt of q.options) {
                    mdLines.push(`- [ ] ${opt}`);
                }
            }
            const mdText = mdLines.join('\n');
            await fs.writeFile(clarifyPath, mdText, 'utf-8');
            await this.appendElephantHistory(specDir, 'step1-clarify', userIdea, mdText);
            return mdText;
        }

        const cleaned = this.stripOuterMarkdownFence(response);
        await fs.writeFile(clarifyPath, cleaned, 'utf-8');
        await this.appendElephantHistory(specDir, 'step1-clarify', userIdea, cleaned);
        return cleaned;
    }

    /**
     * Step 1B: 🐘 7-Lens Brainstorm & Generate/Refine EleGold_Specs/concepts_brief.md
     */
    public async runStep1Brainstorm(
        userIdea: string,
        useWebSearch: boolean,
        refineExisting = false
    ): Promise<string> {
        const root = this.getWorkspaceRoot();
        const specDir = this.getSpecDir();
        await this.ensureDir(specDir);
        await this.saveUiInputs({ step1Idea: userIdea });
        const lang = this.getLanguage();
        const briefPath = path.join(specDir, 'concepts_brief.md');
        const history = await this.loadElephantHistory(specDir);
        const projectContext = await this.gatherProjectContext(root);

        let webMarkdown = '';
        if (useWebSearch && userIdea.trim()) {
            const searchQuery = userIdea.trim().slice(0, 140);
            const results = await this.executeWebSearch(searchQuery);
            webMarkdown = this.webSearch.formatResultsAsMarkdown(results.slice(0, 6));
        } else {
            const status = await this.getWorkspaceStatus();
            if (status.webResearch.length > 0) {
                webMarkdown = this.webSearch.formatResultsAsMarkdown(status.webResearch.slice(0, 6));
            }
        }

        const hasExistingBrief = await this.fileExists(briefPath);
        const isRefine = refineExisting && hasExistingBrief;
        const systemPrompt = getElephantBrainstormPrompt(lang, isRefine);

        let cacheableContext = [projectContext, webMarkdown ? `\n${webMarkdown}` : '']
            .filter(Boolean)
            .join('\n');
        let prompt = '';
        if (isRefine) {
            const currentBrief = await fs.readFile(briefPath, 'utf-8');
            cacheableContext = [
                projectContext,
                webMarkdown ? `\n${webMarkdown}` : '',
                '',
                lang === 'en' ? '## Current `concepts_brief.md`' : '## 現在の `concepts_brief.md`',
                currentBrief
            ]
                .filter(Boolean)
                .join('\n');
            prompt = [
                lang === 'en'
                    ? '## Additional User Feedback / Answers to Clarifying Questions'
                    : '## ユーザーからの追加要望・深掘り質問への回答',
                userIdea
            ].join('\n');
        } else {
            prompt = [
                lang === 'en' ? '## User Feature Request & Goals' : '## ユーザーの要望・作りたい機能',
                userIdea
            ].join('\n');
        }

        const response = await this.llmClient.callElephant(systemPrompt, prompt, history, {
            temperature: 0.3,
            useNativeWebSearch: useWebSearch,
            cacheableContext
        });

        const cleanedMarkdown = this.stripOuterMarkdownFence(response);
        await fs.writeFile(briefPath, cleanedMarkdown, 'utf-8');
        await this.appendElephantHistory(specDir, 'step1-brainstorm', userIdea, cleanedMarkdown);

        // Clear stale Goldfish reviews and Step 4 snapshots since upstream requirements changed
        for (const staleFile of [
            path.join(specDir, '.egm', 'goldfish_reviews.json'),
            path.join(specDir, 'goldfish_review_report.md'),
            path.join(specDir, '.egm', 'design_draft.prev.md')
        ]) {
            if (await this.fileExists(staleFile)) {
                await fs.unlink(staleFile);
            }
        }
        await this.saveUiInputs({ selectedReviewIds: null });

        await this.openDocumentInEditor(briefPath);
        return briefPath;
    }

    /**
     * Step 2: 🐘 Generate or Update Formal 9-Section Design Specification (EleGold_Specs/design_draft.md)
     */
    public async runStep2GenerateDraft(
        extraInstructions = '',
        useWebSearch = false,
        refineExistingDraft = false
    ): Promise<string> {
        const root = this.getWorkspaceRoot();
        const specDir = this.getSpecDir();
        const lang = this.getLanguage();
        const briefPath = path.join(specDir, 'concepts_brief.md');
        const draftPath = path.join(specDir, 'design_draft.md');
        const egmDir = path.join(specDir, '.egm');
        await this.ensureDir(egmDir);

        if (!(await this.fileExists(briefPath))) {
            throw new Error(
                lang === 'en'
                    ? '`concepts_brief.md` does not exist yet. Please generate the Concept Brief in Step 1 first.'
                    : '`concepts_brief.md` が存在しません。先に Step 1 でコンセプトブリーフを生成してください。'
            );
        }

        const briefContent = await fs.readFile(briefPath, 'utf-8');
        const hasExistingDraft = await this.fileExists(draftPath);
        const isUpdateMode = refineExistingDraft && hasExistingDraft;
        const previousDraft = isUpdateMode ? await fs.readFile(draftPath, 'utf-8') : '';

        const projectContext = await this.gatherProjectContext(root);
        const history = await this.loadElephantHistory(specDir);

        if (useWebSearch && extraInstructions.trim()) {
            await this.executeWebSearch(extraInstructions.trim().slice(0, 140));
        }
        const status = await this.getWorkspaceStatus();
        const webMarkdown =
            status.webResearch.length > 0
                ? this.webSearch.formatResultsAsMarkdown(status.webResearch.slice(0, 8))
                : '';

        const systemPrompt = getElephantDraftPrompt(lang);
        const cacheableContext = [
            projectContext,
            webMarkdown ? `\n${webMarkdown}` : '',
            '',
            lang === 'en'
                ? '## Agreed Concept Brief (`concepts_brief.md`)'
                : '## 合意された初期要件ブリーフ (`concepts_brief.md`)',
            briefContent,
            isUpdateMode
                ? (lang === 'en'
                      ? `\n## Existing Design Specification (\`design_draft.md\` to Update)\n${previousDraft}`
                      : `\n## 既存の設計仕様書 (\`design_draft.md\` — この内容をベースに差分更新してください)\n${previousDraft}`)
                : ''
        ]
            .filter(Boolean)
            .join('\n');

        const userPrompt = [
            extraInstructions.trim()
                ? (lang === 'en'
                      ? `## Additional Design Constraints & Update Instructions\n${extraInstructions.trim()}\n`
                      : `## 追加の設計指示・変更点・制約条件\n${extraInstructions.trim()}\n`)
                : '',
            isUpdateMode
                ? (lang === 'en'
                      ? 'Update the existing 9-section Engineering Design Document (`design_draft.md`) in English to reflect the latest Concept Brief and instructions while preserving existing valid architecture and Section 9 review logs.'
                      : '既存の全9セクション設計仕様書 `design_draft.md` をベースに、最新の `concepts_brief.md` および追加指示を反映して日本語でアップデートしてください（既存の有効な設計詳細や第9章の履歴は維持してください）。')
                : (lang === 'en'
                      ? 'Draft the complete 9-section Engineering Design Document (`design_draft.md`) in English.'
                      : '上記の文脈に基づき、全9セクション構成の詳細設計仕様書 `design_draft.md` を日本語で作成してください。')
        ]
            .filter(Boolean)
            .join('\n');

        const compactStep2History = history
            .filter((t) => t.phase !== 'step2-draft' && t.phase !== 'step2-update-draft' && t.phase !== 'step4-resolve')
            .slice(-4);

        const response = await this.llmClient.callElephant(systemPrompt, userPrompt, compactStep2History, {
            temperature: 0.2,
            useNativeWebSearch: useWebSearch,
            cacheableContext
        });

        const cleanedMarkdown = this.stripOuterMarkdownFence(response).replace(
            /^<!-- EGM-APPROVED-HEADER[\s\S]*?-->\s*/m,
            ''
        );

        let backupPath = '';
        if (isUpdateMode && previousDraft) {
            backupPath = path.join(egmDir, 'design_draft.before_step2_update.md');
            await fs.writeFile(backupPath, previousDraft, 'utf-8');
        }

        await fs.writeFile(draftPath, cleanedMarkdown, 'utf-8');
        await this.appendElephantHistory(
            specDir,
            isUpdateMode ? 'step2-update-draft' : 'step2-draft',
            isUpdateMode ? 'Update design_draft.md' : 'Generate design_draft.md',
            cleanedMarkdown
        );

        // Clear stale Goldfish reviews and Step 4 diff so Step 3 will run fresh on the new/updated draft
        for (const staleFile of [
            path.join(egmDir, 'goldfish_reviews.json'),
            path.join(specDir, 'goldfish_review_report.md'),
            path.join(egmDir, 'design_draft.prev.md')
        ]) {
            if (await this.fileExists(staleFile)) {
                await fs.unlink(staleFile);
            }
        }
        await this.saveUiInputs({ step2Extra: extraInstructions, selectedReviewIds: null });

        if (isUpdateMode && backupPath) {
            await vscode.commands.executeCommand(
                'vscode.diff',
                vscode.Uri.file(backupPath),
                vscode.Uri.file(draftPath),
                lang === 'en'
                    ? 'EleGold Spec Diff: Before vs. After Step 2 Update'
                    : 'EleGold 設計書差分: Step 2 更新前 ⇔ 更新後'
            );
        } else {
            await this.openDocumentInEditor(draftPath);
        }
        return draftPath;
    }

    /**
     * Step 3: 🐠 Goldfish Fresh Zero-Context Review
     * STRICT CONTEXT SEPARATION:
     * - Blocks .egm/elephant_context.json completely
     * - Blocks concepts_brief.md completely
     * - Sends ONLY design_draft.md (+ linked local files if consistency lens is active)
     */
    public async runStep3GoldfishReview(lenses: GoldfishReviewLenses): Promise<GoldfishReviewState> {
        const root = this.getWorkspaceRoot();
        const specDir = this.getSpecDir();
        const lang = this.getLanguage();
        const draftPath = path.join(specDir, 'design_draft.md');
        const egmDir = path.join(specDir, '.egm');
        await this.ensureDir(egmDir);

        if (!(await this.fileExists(draftPath))) {
            throw new Error(
                lang === 'en'
                    ? '`design_draft.md` does not exist yet. Please run Step 2 first.'
                    : '`design_draft.md` が存在しません。先に Step 2 で設計仕様書ドラフトを作成してください。'
            );
        }

        const draftContent = await fs.readFile(draftPath, 'utf-8');
        const systemPrompt = buildGoldfishReviewPrompt(lenses, lang);

        const cacheableParts: string[] = [
            '--- BEGIN design_draft.md ---',
            draftContent,
            '--- END design_draft.md ---'
        ];

        if (lenses.consistency) {
            const treeContext = await this.gatherProjectContext(root);
            cacheableParts.push(
                '',
                lang === 'en'
                    ? '--- Reference Only: Current Project Structure (for Codebase Fit check) ---'
                    : '--- 参照用: 現在のプロジェクト構造（既存コードとの整合性チェック用） ---',
                treeContext
            );
        }

        const taskInstruction =
            lang === 'en'
                ? 'Above is the target design specification (`design_draft.md`). You have zero prior conversation context. Audit it cold based solely on this text and output the JSON review object.'
                : '上記はレビュー対象の設計仕様書（`design_draft.md`）です。過去の議論の経緯は一切ありません。この文書だけを根拠に初見の冷徹な監査を行い、JSON形式で出力してください。';

        // Call Goldfish with ZERO history + front-loaded cacheableContext
        const rawResponse = await this.llmClient.callGoldfish(systemPrompt, taskInstruction, {
            temperature: 0.2,
            jsonMode: true,
            cacheableContext: cacheableParts.join('\n')
        });

        const parsed = extractJsonFromText<
            | {
                  readinessScore?: number;
                  verdict?: string;
                  paraphrase?: string;
                  findings?: GoldfishReviewItem[];
              }
            | GoldfishReviewItem[]
        >(rawResponse);

        let rawFindings: GoldfishReviewItem[] = [];
        let paraphrase = '';
        let rawScore = 0;
        let rawVerdict = '';

        if (Array.isArray(parsed)) {
            rawFindings = parsed;
        } else if (parsed && typeof parsed === 'object') {
            paraphrase = parsed.paraphrase || '';
            if (typeof parsed.readinessScore === 'number') {
                rawScore = parsed.readinessScore;
            }
            if (typeof parsed.verdict === 'string') {
                rawVerdict = parsed.verdict;
            }
            if (Array.isArray(parsed.findings)) {
                rawFindings = parsed.findings;
            }
        }

        if (rawFindings.length === 0) {
            throw new Error(
                lang === 'en'
                    ? `Failed to parse Goldfish review findings as JSON. Please retry.\nPreview: ${rawResponse.slice(0, 200)}`
                    : `Goldfishからのレビュー結果をJSONとして解析できませんでした。再試行してください。\nPreview: ${rawResponse.slice(0, 200)}`
            );
        }

        const normalized: GoldfishReviewItem[] = rawFindings.map((item, idx) => ({
            id: item.id || `GF-${String(idx + 1).padStart(2, '0')}`,
            severity: item.severity || 'Medium',
            category: item.category || 'Edge Case',
            title: item.title || (lang === 'en' ? 'Specification Gap' : '仕様の考慮漏れ・曖昧さ'),
            summary: item.summary || '',
            description: item.description || '',
            suggestion: item.suggestion || '',
            resolved: false
        }));

        const critCount = normalized.filter((r) => String(r.severity).toLowerCase() === 'critical').length;
        const highCount = normalized.filter((r) => String(r.severity).toLowerCase() === 'high').length;
        const medCount = normalized.filter((r) => String(r.severity).toLowerCase() === 'medium').length;
        const lowCount = normalized.filter((r) => String(r.severity).toLowerCase() === 'low').length;

        const computedScore =
            rawScore > 0
                ? Math.max(30, Math.min(99, rawScore))
                : Math.max(35, Math.min(98, 100 - critCount * 22 - highCount * 12 - medCount * 5 - lowCount * 2));
        const computedVerdict =
            critCount === 0 && highCount === 0
                ? 'PASS'
                : rawVerdict === 'PASS' || rawVerdict === 'REVISION_NEEDED'
                ? rawVerdict
                : 'REVISION_NEEDED';

        const reviewsPath = path.join(egmDir, 'goldfish_reviews.json');
        let prevRoundCount = 0;
        if (await this.fileExists(reviewsPath)) {
            try {
                const prevData = JSON.parse(await fs.readFile(reviewsPath, 'utf-8'));
                if (prevData && typeof prevData.roundCount === 'number') {
                    prevRoundCount = prevData.roundCount;
                } else {
                    prevRoundCount = 1;
                }
            } catch {
                prevRoundCount = 0;
            }
        }

        const reviewState: GoldfishReviewState = {
            paraphrase,
            reviewedAt: new Date().toISOString(),
            roundCount: prevRoundCount + 1,
            readinessScore: computedScore,
            verdict: computedVerdict,
            resolvedInRound: false,
            findings: normalized
        };

        // Remove stale Step 4 snapshot from any previous round so Step 4's "Resolved" bar only appears after Step 4 runs for THIS round
        const prevDraftPath = path.join(egmDir, 'design_draft.prev.md');
        if (await this.fileExists(prevDraftPath)) {
            await fs.unlink(prevDraftPath);
        }

        await this.saveUiInputs({ step3Lenses: lenses, selectedReviewIds: null });
        await fs.writeFile(reviewsPath, JSON.stringify(reviewState, null, 2), 'utf-8');
        await this.writeGoldfishReviewMarkdown(path.join(specDir, 'goldfish_review_report.md'), reviewState);
        return reviewState;
    }

    /**
     * Step 4: ✨ Elephant Resolves Selected Goldfish Findings into EleGold_Specs/design_draft.md
     */
    public async runStep4ResolveReviews(
        selectedIds: string[],
        humanComment = '',
        openDiffView = true
    ): Promise<string> {
        const specDir = this.getSpecDir();
        const lang = this.getLanguage();
        const draftPath = path.join(specDir, 'design_draft.md');
        const briefPath = path.join(specDir, 'concepts_brief.md');
        const egmDir = path.join(specDir, '.egm');
        const reviewsPath = path.join(egmDir, 'goldfish_reviews.json');
        const prevDraftPath = path.join(egmDir, 'design_draft.prev.md');

        if (!(await this.fileExists(draftPath))) {
            throw new Error(lang === 'en' ? '`design_draft.md` not found.' : '`design_draft.md` が存在しません。');
        }
        if (!(await this.fileExists(reviewsPath))) {
            throw new Error(
                lang === 'en'
                    ? '`.egm/goldfish_reviews.json` not found. Run Step 3 first.'
                    : '`.egm/goldfish_reviews.json` が存在しません。先に Step 3 で金魚レビューを実行してください。'
            );
        }

        const currentDraft = await fs.readFile(draftPath, 'utf-8');
        const rawReviewsData = JSON.parse(await fs.readFile(reviewsPath, 'utf-8'));
        const allReviews: GoldfishReviewItem[] = Array.isArray(rawReviewsData)
            ? rawReviewsData
            : rawReviewsData.findings || [];
        const paraphrase: string = !Array.isArray(rawReviewsData) ? rawReviewsData.paraphrase || '' : '';
        const roundCount: number =
            !Array.isArray(rawReviewsData) && typeof rawReviewsData.roundCount === 'number'
                ? rawReviewsData.roundCount
                : 1;

        const selectedSet = new Set(selectedIds);
        const targetReviews = allReviews.filter((r) => selectedSet.has(r.id));
        const deferredReviews = allReviews.filter((r) => !selectedSet.has(r.id) && !r.resolved);

        if (targetReviews.length === 0 && !humanComment.trim()) {
            throw new Error(
                lang === 'en'
                    ? 'Please select at least one Goldfish finding or enter an instruction.'
                    : '反映するGoldfishの指摘事項にチェックを入れるか、追加修正コメントを入力してください。'
            );
        }

        // Save snapshot before resolution for VS Code Diff View
        await this.ensureDir(egmDir);
        await fs.writeFile(prevDraftPath, currentDraft, 'utf-8');

        let briefExcerpt = '';
        if (await this.fileExists(briefPath)) {
            briefExcerpt = (await fs.readFile(briefPath, 'utf-8')).slice(0, 2500);
        }

        const history = await this.loadElephantHistory(specDir);
        const systemPrompt = getElephantResolvePrompt(lang);
        const cacheableContext = [
            lang === 'en' ? '## Current `design_draft.md`' : '## 現在の `design_draft.md`',
            currentDraft,
            briefExcerpt
                ? (lang === 'en'
                      ? `\n## Reference: Original \`concepts_brief.md\` (for reconciliation check)\n${briefExcerpt}`
                      : `\n## 参照: 初期要件 \`concepts_brief.md\`（ゴール整合性チェック用）\n${briefExcerpt}`)
                : '',
            paraphrase
                ? (lang === 'en'
                      ? `\n## Goldfish Comprehension Paraphrase\n${paraphrase}`
                      : `\n## Goldfishの初見理解パラフレーズ\n${paraphrase}`)
                : ''
        ]
            .filter(Boolean)
            .join('\n');

        const userPrompt = [
            lang === 'en'
                ? '## Approved Goldfish Findings to Resolve'
                : '## 承認された Goldfish（金魚）からの指摘事項（すべて解決して仕様に反映すること）',
            JSON.stringify(targetReviews, null, 2),
            deferredReviews.length > 0
                ? (lang === 'en'
                      ? `\n## Findings Intentionally Deferred/Skipped by Human Author (Do NOT implement; optionally note as Deferred in Section 9)\n${deferredReviews
                            .map((d) => `- [${d.id}] ${d.title}`)
                            .join('\n')}`
                      : `\n## 人間（設計者）が意図的にスキップ・対象外とした指摘事項（仕様への組み込み不要・第9章に「設計者判断によりスキップ」と一行記載可）\n${deferredReviews
                            .map((d) => `- [${d.id}] ${d.title}`)
                            .join('\n')}`)
                : '',
            humanComment.trim()
                ? (lang === 'en'
                      ? `\n## Additional Human Author Instructions\n${humanComment.trim()}`
                      : `\n## 人間（設計者）からの追加指示・補足\n${humanComment.trim()}`)
                : ''
        ].join('\n');

        // Send only lightweight recent context (excluding massive previous full-draft turns) so Step 4 responds 3x faster!
        const compactHistory = history
            .filter((t) => t.phase !== 'step2-draft' && t.phase !== 'step2-update-draft' && t.phase !== 'step4-resolve')
            .slice(-2);

        const response = await this.llmClient.callElephant(systemPrompt, userPrompt, compactHistory, {
            temperature: 0.2,
            cacheableContext
        });

        // Strip any old Approved header since the draft has been modified and must be approved fresh in Step 5
        const updatedMarkdown = this.stripOuterMarkdownFence(response).replace(
            /^<!-- EGM-APPROVED-HEADER[\s\S]*?-->\s*/m,
            ''
        );
        await fs.writeFile(draftPath, updatedMarkdown, 'utf-8');

        // Mark selected items as resolved in goldfish_reviews.json and recalculate readiness score
        const updatedFindings = allReviews.map((item) =>
            selectedSet.has(item.id) ? { ...item, resolved: true } : item
        );
        const remainingOpen = updatedFindings.filter((r) => !r.resolved);
        const remCrit = remainingOpen.filter((r) => String(r.severity).toLowerCase() === 'critical').length;
        const remHigh = remainingOpen.filter((r) => String(r.severity).toLowerCase() === 'high').length;
        const remMed = remainingOpen.filter((r) => String(r.severity).toLowerCase() === 'medium').length;
        const remLow = remainingOpen.filter((r) => String(r.severity).toLowerCase() === 'low').length;
        const updatedScore = Math.max(
            45,
            Math.min(98, 100 - remCrit * 22 - remHigh * 12 - remMed * 4 - remLow * 1)
        );
        const updatedVerdict = remCrit === 0 && remHigh === 0 ? 'PASS' : 'REVISION_NEEDED';

        const updatedState: GoldfishReviewState = {
            paraphrase,
            reviewedAt: new Date().toISOString(),
            roundCount,
            readinessScore: updatedScore,
            verdict: updatedVerdict,
            resolvedInRound: true,
            findings: updatedFindings
        };
        await this.saveUiInputs({
            step4Comment: humanComment,
            step4OpenDiff: openDiffView,
            selectedReviewIds: null
        });
        await fs.writeFile(reviewsPath, JSON.stringify(updatedState, null, 2), 'utf-8');
        await this.writeGoldfishReviewMarkdown(path.join(specDir, 'goldfish_review_report.md'), updatedState);

        await this.appendElephantHistory(
            specDir,
            'step4-resolve',
            `Resolved Goldfish findings: ${selectedIds.join(', ')}`,
            updatedMarkdown
        );

        if (openDiffView) {
            const diffTitle =
                lang === 'en'
                    ? 'design_draft.md (Goldfish Resolution Diff: Before vs After)'
                    : 'design_draft.md (Goldfish指摘反映 Diff: 左=反映前 / 右=反映後)';
            await vscode.commands.executeCommand(
                'vscode.diff',
                vscode.Uri.file(prevDraftPath),
                vscode.Uri.file(draftPath),
                diffTitle
            );
        } else {
            await this.openDocumentInEditor(draftPath);
        }

        return draftPath;
    }

    /**
     * Step 5A: ✅ Approve Spec, Save to EleGold_Specs/approved_specs/NNN-[feature-name].md & Update SITEMAP.md
     */
    public async runStep5ApproveSpec(rawFeatureName: string): Promise<string> {
        const specDir = this.getSpecDir();
        const lang = this.getLanguage();
        const status = await this.getWorkspaceStatus();
        const draftPath = path.join(specDir, 'design_draft.md');
        if (!status.hasBrief || !(await this.fileExists(draftPath))) {
            throw new Error(
                lang === 'en'
                    ? 'Cannot approve yet: Please complete Step 1 (`concepts_brief.md`) and Step 2 (`design_draft.md`) first.'
                    : 'まだ承認できません：先に Step 1 (`concepts_brief.md`) と Step 2 (`design_draft.md`) を完了させてください。'
            );
        }
        if (status.briefNewerThanDraft) {
            throw new Error(
                lang === 'en'
                    ? 'Cannot approve yet: `concepts_brief.md` was updated after `design_draft.md`. Please update the Design Spec in Step 2 first.'
                    : 'まだ承認できません：Step 1 の要件ブリーフが更新されています。先に Step 2 で設計仕様書を最新状態に更新してください。'
            );
        }
        if (status.reviews.length === 0) {
            throw new Error(
                lang === 'en'
                    ? 'Cannot approve yet: In the Elephant-Goldfish Model, you must run Step 3 (Goldfish Zero-Context Review) at least once before approving.'
                    : 'まだ承認できません：EGM公式ルールに基づき、承認前に最低1回は Step 3（金魚ゼロ文脈レビュー）を実行してください。'
            );
        }
        if (!status.canApproveStep5) {
            throw new Error(
                lang === 'en'
                    ? 'Cannot approve yet: Please resolve the selected Goldfish review findings in Step 4 first.'
                    : 'まだ承認できません：Step 3 で検出された重要指摘（Critical / High）を Step 4 で設計書に反映してから承認してください。'
            );
        }
        await this.saveUiInputs({ step5FeatureName: rawFeatureName });

        const slug =
            rawFeatureName
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9-_]+/g, '-')
                .replace(/^-+|-+$/g, '') || 'feature-spec';

        const designsDir = path.join(specDir, 'approved_specs');
        await this.ensureDir(designsDir);

        const existingFiles = await fs.readdir(designsDir);
        let maxNum = 0;
        for (const f of existingFiles) {
            const m = f.match(/^(\d{3})-/);
            if (m) {
                const n = parseInt(m[1], 10);
                if (n > maxNum) {
                    maxNum = n;
                }
            }
        }
        const nextPrefix = String(maxNum + 1).padStart(3, '0');
        const targetFileName = `${nextPrefix}-${slug}.md`;
        const targetPath = path.join(designsDir, targetFileName);

        const rawDraft = await fs.readFile(draftPath, 'utf-8');
        const summary = await this.llmClient.getProviderSummary();
        const resolvedCount = status.reviews.filter((r) => r.resolved).length;
        const totalReviews = status.reviews.length;
        const nowIso = new Date().toISOString();

        const strippedDraft = rawDraft.replace(/^<!-- EGM-APPROVED-HEADER[\s\S]*?-->\s*/m, '');
        const approvalHeader = [
            '<!-- EGM-APPROVED-HEADER -->',
            '> **Status**: `Approved` ✅  ',
            `> **Approved At**: \`${nowIso}\`  `,
            `> **Spec ID**: \`${nextPrefix}-${slug}\`  `,
            `> **Elephant Architect**: \`${summary.elephantProvider} (${summary.elephantModel})\`  `,
            `> **Goldfish Reviewer**: \`${summary.goldfishProvider} (${summary.goldfishModel})\` — Resolved ${resolvedCount}/${totalReviews} findings  `,
            '',
            '---',
            ''
        ].join('\n');

        const finalSpecContent = approvalHeader + strippedDraft;
        await fs.writeFile(draftPath, finalSpecContent, 'utf-8');
        await fs.writeFile(targetPath, finalSpecContent, 'utf-8');

        // Also register in EleGold_Specs/approved_specs/SITEMAP.md (Official Google EGM standard)
        await this.updateDesignsSitemap(designsDir, targetFileName, slug, nowIso.slice(0, 10));

        await this.openDocumentInEditor(targetPath);
        return targetPath;
    }

    private async updateDesignsSitemap(
        designsDir: string,
        fileName: string,
        slug: string,
        dateStr: string
    ): Promise<void> {
        const sitemapPath = path.join(designsDir, 'SITEMAP.md');
        const row = `| [${fileName}](./${fileName}) | ${dateStr} | \`Approved\` | ${slug} |`;
        if (!(await this.fileExists(sitemapPath))) {
            const content = [
                '# EleGold Studio — Approved Design Specifications Sitemap',
                '',
                '| Specification | Date | Status | Feature |',
                '| :--- | :--- | :--- | :--- |',
                row,
                ''
            ].join('\n');
            await fs.writeFile(sitemapPath, content, 'utf-8');
        } else {
            const existing = await fs.readFile(sitemapPath, 'utf-8');
            if (!existing.includes(fileName)) {
                await fs.writeFile(sitemapPath, existing.trimEnd() + '\n' + row + '\n', 'utf-8');
            }
        }
    }

    /**
     * Step 5B: 💻 Generate Implementation Code / Guide from Approved Specification
     */
    public async runStep5ImplementFromSpec(): Promise<{
        guidePath: string;
        writtenFiles: string[];
    }> {
        const root = this.getWorkspaceRoot();
        const specDir = this.getSpecDir();
        const lang = this.getLanguage();
        const status = await this.getWorkspaceStatus();
        if (!status.canRunStep5SddTools) {
            throw new Error(
                lang === 'en'
                    ? 'Please click "✅ Approve & Archive Spec" in Step 5 first to lock down the canonical specification before generating code.'
                    : '先に Step 5 の「✅ 設計書を承認して確定保存」を実行し、仕様書を正式承認（Approved）してからコード生成を実行してください。'
            );
        }

        let specPath = path.join(specDir, 'design_draft.md');
        if (status.approvedSpecs.length > 0) {
            specPath = path.join(specDir, status.approvedSpecs[status.approvedSpecs.length - 1]);
        }

        if (!(await this.fileExists(specPath))) {
            throw new Error(
                lang === 'en'
                    ? 'No approved design specification found.'
                    : '実装元の設計仕様書（`approved_specs/*.md` または `design_draft.md`）が存在しません。'
            );
        }

        const specContent = await fs.readFile(specPath, 'utf-8');
        const projectContext = await this.gatherProjectContext(root);

        const cacheableContext = [
            '## Approved Specification',
            specContent,
            '',
            '## Current Workspace Structure & Files',
            projectContext
        ].join('\n');

        const prompt =
            lang === 'en'
                ? 'Generate the complete implementation summary and `filepath:` code blocks strictly matching the Approved Specification above.'
                : '上記の正式承認済み設計仕様書（Approved Specification）に100%従い、実装ガイドと各ファイルの完全なコード（`filepath:` ブロック）を出力してください。';

        const response = await this.llmClient.callElephant(getElephantImplementPrompt(lang), prompt, [], {
            temperature: 0.15,
            cacheableContext
        });

        const designsDir = path.join(specDir, 'approved_specs');
        await this.ensureDir(designsDir);
        const guidePath = path.join(designsDir, 'implementation_output.md');
        await fs.writeFile(guidePath, response, 'utf-8');

        const extracted = this.extractFileCodeBlocks(response);
        const writtenFiles: string[] = [];

        if (extracted.length > 0) {
            const writeBtn = lang === 'en' ? 'Write Files' : '書き出す (Write Files)';
            const previewBtn = lang === 'en' ? 'Preview Guide Only' : 'ガイドのみ開く (Preview Only)';
            const msg =
                lang === 'en'
                    ? `Generated ${extracted.length} implementation file(s) from the approved spec. Write them to workspace?`
                    : `承認済み仕様書から ${extracted.length} 個の実装ファイルが生成されました。ワークスペースに書き出しますか？`;

            const choice = await vscode.window.showInformationMessage(msg, { modal: false }, writeBtn, previewBtn);
            if (choice === writeBtn) {
                for (const block of extracted) {
                    const safeRel = block.filePath.replace(/^[/\\]+/, '');
                    const absTarget = path.resolve(root, safeRel);
                    if (!absTarget.startsWith(path.resolve(root))) {
                        continue;
                    }
                    await this.ensureDir(path.dirname(absTarget));
                    await fs.writeFile(absTarget, block.code, 'utf-8');
                    writtenFiles.push(safeRel);
                }
            }
        }

        await this.openDocumentInEditor(guidePath);
        return { guidePath, writtenFiles };
    }

    /**
     * Step 5C: ⚖️ Run Goldfish Drift Audit (/egm-drift-report)
     */
    public async runStep5DriftReport(): Promise<string> {
        const root = this.getWorkspaceRoot();
        const specDir = this.getSpecDir();
        const lang = this.getLanguage();
        const status = await this.getWorkspaceStatus();
        if (!status.canRunStep5SddTools) {
            throw new Error(
                lang === 'en'
                    ? 'Please click "✅ Approve & Archive Spec" in Step 5 first to lock down the canonical specification before generating code.'
                    : '先に Step 5 の「✅ 設計書を承認して確定保存」を実行し、仕様書を正式承認（Approved）してからコード生成を実行してください。'
            );
        }

        let specPath = path.join(specDir, 'design_draft.md');
        if (status.approvedSpecs.length > 0) {
            specPath = path.join(specDir, status.approvedSpecs[status.approvedSpecs.length - 1]);
        }

        if (!(await this.fileExists(specPath))) {
            throw new Error(
                lang === 'en'
                    ? 'No design specification found for drift audit.'
                    : '監査基準となる設計仕様書が見つかりません。'
            );
        }

        const specContent = await fs.readFile(specPath, 'utf-8');
        const projectContext = await this.gatherProjectContext(root);

        const cacheableContext = [
            '## Approved Specification',
            specContent,
            '',
            '## Current Workspace Structure & Files',
            projectContext
        ].join('\n');

        const isolatedPrompt =
            lang === 'en'
                ? 'Audit the current workspace structure and files against the Approved Specification above and produce the Markdown Drift Report.'
                : '上記の正式承認済み設計仕様書と現在のワークスペース構造・ファイルを比較監査し、仕様ドリフト監査レポート（Markdown）を出力してください。';

        const report = await this.llmClient.callGoldfish(getGoldfishDriftReportPrompt(lang), isolatedPrompt, {
            temperature: 0.2,
            cacheableContext
        });

        const designsDir = path.join(specDir, 'approved_specs');
        await this.ensureDir(designsDir);
        const reportPath = path.join(designsDir, 'drift_report.md');
        await fs.writeFile(reportPath, this.stripOuterMarkdownFence(report), 'utf-8');

        await this.openDocumentInEditor(reportPath);
        return reportPath;
    }

    /**
     * Generates a ready-to-paste SDD prompt for external/IDE coding agents
     */
    public async buildSddHandoffPrompt(): Promise<string> {
        const specDir = this.getSpecDir();
        const folderName = this.getSpecFolderName();
        const lang = this.getLanguage();
        const status = await this.getWorkspaceStatus();
        if (!status.canRunStep5SddTools) {
            throw new Error(
                lang === 'en'
                    ? 'Please click "✅ Approve & Archive Spec" in Step 5 first to lock down the canonical specification before generating code.'
                    : '先に Step 5 の「✅ 設計書を承認して確定保存」を実行し、仕様書を正式承認（Approved）してからコード生成を実行してください。'
            );
        }
        const relSpec =
            status.approvedSpecs.length > 0
                ? status.approvedSpecs[status.approvedSpecs.length - 1]
                : (await this.fileExists(path.join(specDir, 'design_draft.md')))
                ? 'design_draft.md'
                : 'concepts_brief.md';

        const fullSpecRef = `${folderName}/${relSpec}`;
        const fullBriefRef = `${folderName}/concepts_brief.md`;

        if (lang === 'en') {
            return [
                `# Specification-Driven Development (SDD) Build Instruction — EleGold Studio Approved Spec`,
                ``,
                `Implement the feature strictly following our EGM-verified Design Specification (drafted by Elephant and stress-tested by zero-context Goldfish reviewers).`,
                ``,
                `- **Canonical Approved Specification**: \`@${fullSpecRef}\``,
                `- **Concept Brief**: \`@${fullBriefRef}\``,
                ``,
                `## Implementation Rules`,
                `1. Adhere 100% to the target files, interface contracts, data flows, and failure-mode handling defined in \`@${fullSpecRef}\`. Do not introduce unauthorized spec drift.`,
                `2. Implement and run the verification tests defined in the Verification & Test Plan section.`
            ].join('\n');
        }

        return [
            `# 仕様駆動開発 (SDD) 実装指示 — EleGold Studio 承認済仕様`,
            ``,
            `以下の設計仕様書（Elephantで設計し、ゼロコンテキストのGoldfishレビューを通過して確定した仕様書）を正本として、迷いなく正確に実装を行ってください。`,
            ``,
            `- **参照すべき正本仕様書**: \`@${fullSpecRef}\``,
            `- **初期要件ブリーフ**: \`@${fullBriefRef}\``,
            ``,
            `## 実装ルール`,
            `1. 仕様書に記載された対象ファイル一覧、インターフェース定義、データフロー、エラーハンドリング、エッジケース対策を100%遵守し、独自の勝手な仕様変更（Spec Drift）を行わないでください。`,
            `2. 仕様書内の「テスト計画と受入基準」を満たす検証コードを併せて作成・実行してください。`
        ].join('\n');
    }

    public async openWorkspaceFile(relativePath: string, previewMode = false): Promise<void> {
        const specDir = this.getSpecDir();
        const fullInSpecDir = path.join(specDir, relativePath);
        if (await this.fileExists(fullInSpecDir)) {
            if (previewMode) {
                await vscode.commands.executeCommand('markdown.showPreviewToSide', vscode.Uri.file(fullInSpecDir));
            } else {
                await this.openDocumentInEditor(fullInSpecDir);
            }
            return;
        }
        const root = this.getWorkspaceRoot();
        const fullInRoot = path.join(root, relativePath);
        if (await this.fileExists(fullInRoot)) {
            if (previewMode) {
                await vscode.commands.executeCommand('markdown.showPreviewToSide', vscode.Uri.file(fullInRoot));
            } else {
                await this.openDocumentInEditor(fullInRoot);
            }
            return;
        }
        const lang = this.getLanguage();
        vscode.window.showWarningMessage(
            lang === 'en'
                ? `File has not been generated yet: ${this.getSpecFolderName()}/${relativePath}`
                : `ファイルがまだ生成されていません: ${this.getSpecFolderName()}/${relativePath}`
        );
    }

    /**
     * Saves direct user edits made inside the sidebar inline editor to EleGold_Specs/<relativePath>
     */
    public async saveSpecArtifactContent(
        relativePath: 'concepts_brief.md' | 'design_draft.md',
        content: string
    ): Promise<string> {
        const specDir = this.getSpecDir();
        await this.ensureDir(specDir);
        const fullPath = path.join(specDir, relativePath);
        await fs.writeFile(fullPath, content, 'utf-8');
        return fullPath;
    }

    public async openStepDiff(mode: 'step2' | 'step4'): Promise<void> {
        const specDir = this.getSpecDir();
        const lang = this.getLanguage();
        const draftPath = path.join(specDir, 'design_draft.md');
        const prevPath =
            mode === 'step2'
                ? path.join(specDir, '.egm', 'design_draft.before_step2_update.md')
                : path.join(specDir, '.egm', 'design_draft.prev.md');

        if ((await this.fileExists(prevPath)) && (await this.fileExists(draftPath))) {
            const title =
                mode === 'step2'
                    ? lang === 'en'
                        ? 'EleGold Spec Diff: Before vs. After Step 2 Update'
                        : 'EleGold 設計書差分: Step 2 更新前 ⇔ 更新後'
                    : lang === 'en'
                    ? 'design_draft.md (Goldfish Resolution Diff: Before vs After)'
                    : 'design_draft.md (Goldfish指摘反映 Diff: 左=反映前 / 右=反映後)';
            await vscode.commands.executeCommand(
                'vscode.diff',
                vscode.Uri.file(prevPath),
                vscode.Uri.file(draftPath),
                title
            );
        } else if (await this.fileExists(draftPath)) {
            await this.openDocumentInEditor(draftPath);
        }
    }

    private async writeGoldfishReviewMarkdown(filePath: string, state: GoldfishReviewState): Promise<void> {
        const lang = this.getLanguage();
        const isEn = lang === 'en';
        const lines: string[] = [
            isEn
                ? `# 🐠 Goldfish Zero-Context Review Report (Round ${state.roundCount || 1})`
                : `# 🐠 Goldfish（金魚）初見ゼロ文脈レビュー報告書 (Round ${state.roundCount || 1})`,
            '',
            `- **${isEn ? 'Reviewed At' : '監査日時'}**: \`${state.reviewedAt}\``,
            `- **${isEn ? 'Readiness Score' : '設計完成度スコア'}**: **${state.readinessScore ?? 0}%** (\`${state.verdict || 'REVISION_NEEDED'}\`)`,
            ''
        ];
        if (state.paraphrase) {
            lines.push(
                isEn ? '## 1. Comprehension Paraphrase' : '## 1. 初見理解テスト (Comprehension Paraphrase)',
                `> ${state.paraphrase.replace(/\n/g, '\n> ')}`,
                ''
            );
        }
        lines.push(isEn ? '## 2. Audit Findings' : '## 2. 指摘事項一覧 (Audit Findings)', '');
        for (const item of state.findings) {
            const statusTag = item.resolved
                ? isEn
                    ? '✅ Resolved'
                    : '✅ 反映済'
                : isEn
                ? '⬜ Open'
                : '⬜ 未解決';
            lines.push(`### [${item.id}] (${item.severity} / ${item.category}) ${item.title} — ${statusTag}`);
            if (item.summary) {
                lines.push(`- **${isEn ? 'Summary' : '要点'}**: ${item.summary}`);
            }
            lines.push('', item.description, '');
            if (item.suggestion) {
                lines.push(`> 💡 **${isEn ? 'Suggested Fix' : '仕様改善案'}**: ${item.suggestion}`, '');
            }
        }
        await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
    }

    public async regenerateLocalizedArtifacts(): Promise<void> {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            return;
        }
        const specDir = this.getSpecDir();
        const reviewsPath = path.join(specDir, '.egm', 'goldfish_reviews.json');
        if (await this.fileExists(reviewsPath)) {
            try {
                const parsed = JSON.parse(await fs.readFile(reviewsPath, 'utf-8'));
                if (parsed && Array.isArray(parsed.findings)) {
                    await this.writeGoldfishReviewMarkdown(path.join(specDir, 'goldfish_review_report.md'), parsed);
                }
            } catch {
                // Ignore
            }
        }
    }

    private async openDocumentInEditor(fullPath: string): Promise<void> {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
        await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false });
    }

    private stripOuterMarkdownFence(text: string): string {
        const trimmed = text.trim();
        const m = trimmed.match(/^```(?:markdown|md)?\r?\n([\s\S]*?)\r?\n```$/i);
        return m ? m[1].trim() : trimmed;
    }

    private extractFileCodeBlocks(markdown: string): Array<{ filePath: string; code: string }> {
        const results: Array<{ filePath: string; code: string }> = [];
        const regex = /```filepath:([^\r\n]+)\r?\n([\s\S]*?)```/g;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(markdown)) !== null) {
            const filePath = match[1].trim();
            const code = match[2];
            if (filePath && code) {
                results.push({ filePath, code });
            }
        }
        return results;
    }
}
