import * as vscode from 'vscode';
import { EgmEngine } from './egmEngine';
import { LlmClient, LlmProviderId } from './llmClient';
import { EgmLanguage, GoldfishReviewLenses } from './prompts';

export class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'egmStudio.sidebarView';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _engine: EgmEngine,
        private readonly _llmClient: LlmClient
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (msg) => {
            const lang = this._engine.getLanguage();
            try {
                switch (msg.type) {
                    case 'init':
                    case 'refreshState': {
                        await this.pushFullState();
                        void this.autoFetchModelsInBackground();
                        break;
                    }

                    case 'cancelOperation': {
                        this._llmClient.cancelActiveRequest();
                        this.postLoading(false);
                        vscode.window.showInformationMessage(
                            lang === 'en'
                                ? '⏹️ Cancelled active LLM request.'
                                : '⏹️ 実行中のLLM処理を中断しました。'
                        );
                        await this.pushFullState();
                        break;
                    }

                    case 'setLanguage': {
                        const targetLang: EgmLanguage = msg.language === 'en' ? 'en' : 'ja';
                        const cfg = vscode.workspace.getConfiguration('egmStudio');
                        await cfg.update('language', targetLang, vscode.ConfigurationTarget.Global);
                        await this._engine.regenerateLocalizedArtifacts();
                        await this.pushFullState();
                        break;
                    }

                    case 'openSettings': {
                        await vscode.commands.executeCommand('workbench.action.openSettings', 'egmStudio');
                        break;
                    }

                    case 'openFolder': {
                        await vscode.commands.executeCommand('vscode.openFolder');
                        break;
                    }

                    case 'revealSpecFolder': {
                        await this._engine.revealSpecFolder();
                        break;
                    }

                    case 'saveProviderConfig': {
                        const cfg = vscode.workspace.getConfiguration('egmStudio');
                        if (msg.provider) {
                            await cfg.update('provider', msg.provider, vscode.ConfigurationTarget.Global);
                        }
                        if (typeof msg.model === 'string' && msg.model.trim()) {
                            await cfg.update('model', msg.model.trim(), vscode.ConfigurationTarget.Global);
                        }
                        if (msg.goldfishProvider) {
                            await cfg.update('goldfishProvider', msg.goldfishProvider, vscode.ConfigurationTarget.Global);
                        }
                        if (typeof msg.goldfishModel === 'string') {
                            await cfg.update('goldfishModel', msg.goldfishModel.trim(), vscode.ConfigurationTarget.Global);
                        }
                        if (typeof msg.webSearchEnabled === 'boolean') {
                            await cfg.update('webSearch.enabled', msg.webSearchEnabled, vscode.ConfigurationTarget.Global);
                        }
                        if (typeof msg.nativeGrounding === 'boolean') {
                            await cfg.update('webSearch.nativeGrounding', msg.nativeGrounding, vscode.ConfigurationTarget.Global);
                        }
                        vscode.window.showInformationMessage(
                            lang === 'en'
                                ? 'EGM Studio: LLM configuration saved.'
                                : 'EGM Studio: LLM設定を保存しました。'
                        );
                        await this.pushFullState();
                        break;
                    }

                    case 'saveApiKey': {
                        const provider = msg.provider as LlmProviderId;
                        const apiKey = String(msg.apiKey || '');
                        await this._llmClient.setApiKey(provider, apiKey);
                        vscode.window.showInformationMessage(
                            apiKey.trim()
                                ? lang === 'en'
                                    ? `Saved ${provider.toUpperCase()} API Key to SecretStorage.`
                                    : `${provider.toUpperCase()} APIキーを安全に保存しました（SecretStorage）。`
                                : lang === 'en'
                                    ? `Cleared ${provider.toUpperCase()} API Key.`
                                    : `${provider.toUpperCase()} APIキーを削除しました。`
                        );
                        await this.pushFullState();
                        void this.autoFetchModelsInBackground();
                        break;
                    }

                    case 'testConnection': {
                        this.postLoading(
                            true,
                            lang === 'en' ? 'Testing LLM connection...' : 'LLM接続テストを実行中...'
                        );
                        const res = await this._llmClient.testConnection(msg.provider, msg.model);
                        this.postLoading(false);
                        if (res.ok) {
                            vscode.window.showInformationMessage(
                                `✅ [${res.provider} / ${res.model}] (${res.latencyMs}ms): ${res.message}`
                            );
                        } else {
                            vscode.window.showErrorMessage(
                                `❌ [${res.provider} / ${res.model}]: ${res.message}`
                            );
                        }
                        this._view?.webview.postMessage({ type: 'connectionTestResult', result: res });
                        break;
                    }

                    case 'fetchModels': {
                        const targetProvider = (msg.provider || 'gemini') as LlmProviderId;
                        const silent = Boolean(msg.silent);
                        if (!silent) {
                            this.postLoading(
                                true,
                                lang === 'en'
                                    ? `Fetching available models from ${targetProvider}...`
                                    : `${targetProvider} APIから利用可能なモデル一覧を取得中...`
                            );
                        }
                        const res = await this._llmClient.fetchAvailableModels(targetProvider);
                        if (!silent) {
                            this.postLoading(false);
                        }
                        this._view?.webview.postMessage({
                            type: 'modelsListResult',
                            provider: targetProvider,
                            models: res.models,
                            fromLiveApi: res.fromLiveApi
                        });
                        if (!silent && res.fromLiveApi) {
                            vscode.window.showInformationMessage(
                                lang === 'en'
                                    ? `🔄 Fetched ${res.models.length} models from ${targetProvider} API.`
                                    : `🔄 ${targetProvider} APIから ${res.models.length} 件のモデル一覧を取得しました。`
                            );
                        }
                        break;
                    }

                    case 'openFile': {
                        if (msg.relativePath) {
                            await this._engine.openWorkspaceFile(
                                String(msg.relativePath),
                                Boolean(msg.previewMode)
                            );
                        }
                        break;
                    }

                    case 'openDiff': {
                        await this._engine.openStepDiff(msg.mode === 'step2' ? 'step2' : 'step4');
                        break;
                    }

                    case 'saveArtifactEdit': {
                        const rel = msg.relativePath === 'design_draft.md' ? 'design_draft.md' : 'concepts_brief.md';
                        const content = String(msg.content || '');
                        await this._engine.saveSpecArtifactContent(rel, content);
                        vscode.window.showInformationMessage(
                            lang === 'en'
                                ? `💾 Saved your edits to ${rel}!`
                                : `💾 ${rel} の編集内容を保存しました！`
                        );
                        await this.pushFullState();
                        break;
                    }

                    case 'saveUiInputs': {
                        if (msg.inputs && typeof msg.inputs === 'object') {
                            await this._engine.saveUiInputs(msg.inputs);
                        }
                        break;
                    }

                    case 'resetElephant': {
                        await this._engine.resetElephantHistory();
                        vscode.window.showInformationMessage(
                            lang === 'en'
                                ? '🐘 Reset Elephant conversation context (.egm/elephant_context.json).'
                                : '🐘 Elephantの対話履歴 (.egm/elephant_context.json) をリセットしました。'
                        );
                        await this.pushFullState();
                        break;
                    }

                    case 'rollbackToStep': {
                        const targetStep = Number(msg.targetStep || 1);
                        const confirmLabel =
                            lang === 'en' ? `Yes, Redo from Step ${targetStep}` : `はい（Step ${targetStep} からやり直す）`;
                        const cancelLabel = lang === 'en' ? 'Cancel' : 'キャンセル';
                        const promptText =
                            targetStep === 1
                                ? lang === 'en'
                                    ? 'Reset all current design drafts and start fresh from Step 1?'
                                    : '現在のブリーフ・設計書ドラフトをクリアして、Step 1 からやり直しますか？'
                                : targetStep === 2
                                ? lang === 'en'
                                    ? 'Keep concepts_brief.md (Step 1) and clear design_draft.md & reviews to redo from Step 2?'
                                    : 'Step 1 の要件ブリーフ (concepts_brief.md) は残したまま、設計書ドラフトとレビュー結果をクリアして Step 2 からやり直しますか？'
                                : lang === 'en'
                                ? 'Clear current Goldfish review results and redo from Step 3?'
                                : '現在の金魚レビュー結果をクリアして、Step 3 からやり直しますか？';

                        const choice = await vscode.window.showWarningMessage(
                            promptText,
                            { modal: true },
                            confirmLabel,
                            cancelLabel
                        );
                        if (choice === confirmLabel) {
                            await this._engine.rollbackToStep(targetStep);
                            vscode.window.showInformationMessage(
                                lang === 'en'
                                    ? `⏪ Rolled back to Step ${targetStep}.`
                                    : `⏪ Step ${targetStep} の状態に戻しました。`
                            );
                            await this.pushFullState();
                        }
                        break;
                    }

                    case 'clearWebResearch': {
                        await this._engine.clearWebResearch();
                        vscode.window.showInformationMessage(
                            lang === 'en'
                                ? '🌐 Cleared Web research cache (.egm/web_research.json).'
                                : '🌐 Web検索キャッシュ (.egm/web_research.json) をクリアしました。'
                        );
                        await this.pushFullState();
                        break;
                    }

                    case 'manualWebSearch': {
                        const query = String(msg.query || '').trim();
                        if (!query) {
                            vscode.window.showWarningMessage(
                                lang === 'en'
                                    ? 'Please enter a search query or URL.'
                                    : '検索キーワードまたはURLを入力してください。'
                            );
                            return;
                        }
                        this.postLoading(
                            true,
                            lang === 'en'
                                ? `🌐 Searching web for "${query}"...`
                                : `🌐 Web検索中: "${query}" ...`,
                            'web-search'
                        );
                        const items = await this._engine.executeWebSearch(query);
                        this.postLoading(false);
                        vscode.window.showInformationMessage(
                            lang === 'en'
                                ? `🌐 Web research updated (${items.length} reference items).`
                                : `🌐 Web調査結果を更新しました（計 ${items.length} 件）。`
                        );
                        await this.pushFullState();
                        break;
                    }

                    case 'step1Clarify': {
                        const idea = String(msg.idea || '').trim();
                        if (!idea) {
                            vscode.window.showWarningMessage(
                                lang === 'en'
                                    ? 'Step 1: Please enter your feature idea first.'
                                    : 'Step 1: まず作りたい機能やアイデアを入力してください。'
                            );
                            return;
                        }
                        const useWebSearch = Boolean(msg.useWebSearch);
                        this.postLoading(
                            true,
                            lang === 'en'
                                ? '🐘 Elephant is analyzing blind spots and generating clarifying questions...'
                                : '🐘 Elephantが前提の甘さを分析し、深掘り質問（Clarifying Questions）を生成中...',
                            'step1-clarify'
                        );
                        await this._engine.runStep1ClarifyQuestions(idea, useWebSearch);
                        this.postLoading(false);
                        await this.pushFullState();
                        break;
                    }

                    case 'step1Brainstorm': {
                        const idea = String(msg.idea || '').trim();
                        if (!idea) {
                            vscode.window.showWarningMessage(
                                lang === 'en'
                                    ? 'Step 1: Please enter your feature requirements or feedback.'
                                    : 'Step 1: 作りたい機能や要望を入力してください。'
                            );
                            return;
                        }
                        const useWebSearch = Boolean(msg.useWebSearch);
                        const refine = Boolean(msg.refine);
                        this.postLoading(
                            true,
                            lang === 'en'
                                ? refine
                                    ? '🐘 Elephant is updating concepts_brief.md with your feedback...'
                                    : '🐘 Elephant is running 7-Lens Brainstorm to generate concepts_brief.md...'
                                : refine
                                    ? '🐘 Elephantが壁打ち内容を反映して concepts_brief.md を更新中...'
                                    : '🐘 Elephantが7つのEGMレンズで分析し concepts_brief.md を生成中...',
                            refine ? 'step1-refine' : 'step1-brief'
                        );
                        await this._engine.runStep1Brainstorm(idea, useWebSearch, refine);
                        this.postLoading(false);
                        vscode.window.showInformationMessage(
                            lang === 'en'
                                ? '✅ Step 1 Complete: Generated concepts_brief.md!'
                                : '✅ Step 1 完了: concepts_brief.md を生成しました！'
                        );
                        await this.pushFullState();
                        break;
                    }

                    case 'step2GenerateDraft': {
                        const extra = String(msg.extraInstructions || '');
                        const useWebSearch = Boolean(msg.useWebSearch);
                        const refineExistingDraft = Boolean(msg.refineExistingDraft);
                        this.postLoading(
                            true,
                            lang === 'en'
                                ? refineExistingDraft
                                    ? '🐘 Elephant is updating design_draft.md with your latest brief & instructions...'
                                    : '🐘 Elephant is drafting the 9-section Design Specification (design_draft.md)...'
                                : refineExistingDraft
                                ? '🐘 Elephantが既存の design_draft.md を最新ブリーフ＆指示に基づき差分更新中...'
                                : '🐘 Elephantが全9セクションの詳細設計仕様書 (design_draft.md) を執筆中...',
                            refineExistingDraft ? 'step2-update' : 'step2-draft'
                        );
                        await this._engine.runStep2GenerateDraft(extra, useWebSearch, refineExistingDraft);
                        this.postLoading(false);
                        vscode.window.showInformationMessage(
                            lang === 'en'
                                ? refineExistingDraft
                                    ? '✅ Step 2 Complete: Updated design_draft.md!'
                                    : '✅ Step 2 Complete: Generated design_draft.md!'
                                : refineExistingDraft
                                ? '✅ Step 2 完了: 既存の design_draft.md を差分更新しました！'
                                : '✅ Step 2 完了: design_draft.md を生成しました！'
                        );
                        await this.pushFullState();
                        break;
                    }

                    case 'step3GoldfishReview': {
                        const lenses: GoldfishReviewLenses = {
                            comprehension: msg.lenses?.comprehension ?? true,
                            edgeCases: msg.lenses?.edgeCases ?? true,
                            consistency: msg.lenses?.consistency ?? true,
                            security: msg.lenses?.security ?? true,
                            readiness: msg.lenses?.readiness ?? true
                        };
                        this.postLoading(
                            true,
                            lang === 'en'
                                ? '🐠 Goldfish is auditing design_draft.md in a fresh Zero-Context session...'
                                : '🐠 Goldfishが過去の文脈を完全遮断（Zero-Context）して design_draft.md を冷徹に監査中...',
                            'step3-review'
                        );
                        const reviewState = await this._engine.runStep3GoldfishReview(lenses);
                        this.postLoading(false);
                        vscode.window.showInformationMessage(
                            lang === 'en'
                                ? `🐠 Step 3 Complete: Goldfish identified ${reviewState.findings.length} findings.`
                                : `🐠 Step 3 完了: 金魚レビューで ${reviewState.findings.length} 件の指摘事項が検出されました。`
                        );
                        await this.pushFullState();
                        break;
                    }

                    case 'step4ResolveReviews': {
                        const selectedIds: string[] = Array.isArray(msg.selectedIds) ? msg.selectedIds : [];
                        const humanComment = String(msg.humanComment || '');
                        const openDiff = msg.openDiff !== false;
                        this.postLoading(
                            true,
                            lang === 'en'
                                ? `🐘 Elephant is resolving ${selectedIds.length} finding(s) in design_draft.md...`
                                : `🐘 Elephantが選択された ${selectedIds.length} 件の指摘を解決して design_draft.md を更新中...`,
                            'step4-resolve'
                        );
                        await this._engine.runStep4ResolveReviews(selectedIds, humanComment, openDiff);
                        this.postLoading(false);
                        vscode.window.showInformationMessage(
                            lang === 'en'
                                ? '✨ Step 4 Complete: Updated design_draft.md with selected resolutions!'
                                : '✨ Step 4 完了: 指摘事項を反映し、design_draft.md をアップデートしました！'
                        );
                        await this.pushFullState();
                        break;
                    }

                    case 'step5ApproveSpec': {
                        const featureName = String(msg.featureName || 'feature-spec');
                        this.postLoading(
                            true,
                            lang === 'en'
                                ? '✅ Promoting approved specification to EleGold_Specs/approved_specs/ and updating SITEMAP.md...'
                                : '✅ 設計仕様書を正式承認アーカイブ (EleGold_Specs/approved_specs/) に昇格し SITEMAP.md を更新中...',
                            'step5-approve'
                        );
                        const savedPath = await this._engine.runStep5ApproveSpec(featureName);
                        this.postLoading(false);
                        vscode.window.showInformationMessage(
                            lang === 'en'
                                ? `🎉 Specification Approved & Archived: ${savedPath}`
                                : `🎉 設計仕様書を承認・保存しました: ${savedPath}`
                        );
                        await this.pushFullState();
                        break;
                    }

                    case 'step5CopySddPrompt': {
                        const promptText = await this._engine.buildSddHandoffPrompt();
                        await vscode.env.clipboard.writeText(promptText);
                        vscode.window.showInformationMessage(
                            lang === 'en'
                                ? '📋 Copied SDD Implementation Prompt to clipboard!'
                                : '📋 仕様駆動開発（SDD）実装指示プロンプトをクリップボードにコピーしました！'
                        );
                        break;
                    }

                    case 'step5Implement': {
                        this.postLoading(
                            true,
                            lang === 'en'
                                ? '💻 Generating implementation guide & code from approved specification...'
                                : '💻 承認済み仕様書に基づき実装コード＆ガイドを生成中...',
                            'step5-implement'
                        );
                        const result = await this._engine.runStep5ImplementFromSpec();
                        this.postLoading(false);
                        vscode.window.showInformationMessage(
                            result.writtenFiles.length > 0
                                ? lang === 'en'
                                    ? `🚀 Wrote ${result.writtenFiles.length} file(s) from approved spec!`
                                    : `🚀 実装完了: ${result.writtenFiles.length} ファイルを書き出しました！`
                                : lang === 'en'
                                    ? `🚀 Generated implementation guide: ${result.guidePath}`
                                    : `🚀 実装ガイドを生成しました: ${result.guidePath}`
                        );
                        await this.pushFullState();
                        break;
                    }

                    case 'step5DriftReport': {
                        this.postLoading(
                            true,
                            lang === 'en'
                                ? '⚖️ Goldfish is auditing codebase drift against the approved specification...'
                                : '⚖️ Goldfishが承認済み仕様書と現在のコードのドリフト（乖離）を監査中...',
                            'step5-drift'
                        );
                        const reportPath = await this._engine.runStep5DriftReport();
                        this.postLoading(false);
                        vscode.window.showInformationMessage(
                            lang === 'en'
                                ? `⚖️ Drift Audit Report generated: ${reportPath}`
                                : `⚖️ ドリフト監査レポートを生成しました: ${reportPath}`
                        );
                        await this.pushFullState();
                        break;
                    }

                    case 'clearLlmCache': {
                        await this._llmClient.clearResponseCache();
                        vscode.window.showInformationMessage(
                            lang === 'en'
                                ? '🧹 Cleared local LLM response cache and reset cache telemetry.'
                                : '🧹 ローカルLLMキャッシュと節約統計をリセットしました。'
                        );
                        await this.pushFullState();
                        break;
                    }
                }
            } catch (err) {
                this.postLoading(false);
                const message = err instanceof Error ? err.message : String(err);
                vscode.window.showErrorMessage(`EGM Studio Error: ${message}`);
                this._view?.webview.postMessage({
                    type: 'error',
                    message
                });
            }
        });
    }

    public async refresh(): Promise<void> {
        await this.pushFullState();
    }

    private postLoading(isLoading: boolean, text = '', operationKey = ''): void {
        this._view?.webview.postMessage({
            type: 'loading',
            isLoading,
            text,
            operationKey
        });
    }

    private async pushFullState(): Promise<void> {
        if (!this._view) {
            return;
        }
        const [providerSummary, workspaceStatus] = await Promise.all([
            this._llmClient.getProviderSummary(),
            this._engine.getWorkspaceStatus()
        ]);
        const cfg = vscode.workspace.getConfiguration('egmStudio');
        const language = this._engine.getLanguage();
        const webSearchEnabled = cfg.get<boolean>('webSearch.enabled', true);
        const nativeGrounding = cfg.get<boolean>('webSearch.nativeGrounding', false);
        const rawGoldfishProvider = cfg.get<string>('goldfishProvider', 'same');
        const rawGoldfishModel = cfg.get<string>('goldfishModel', '');

        this._view.webview.postMessage({
            type: 'stateUpdate',
            payload: {
                language,
                providerSummary,
                workspaceStatus,
                settings: {
                    webSearchEnabled,
                    nativeGrounding,
                    rawGoldfishProvider,
                    rawGoldfishModel
                }
            }
        });
    }

    /**
     * Automatically fetches live model lists for all configured providers in the background
     * when the sidebar opens or when API keys are updated.
     */
    private async autoFetchModelsInBackground(): Promise<void> {
        if (!this._view) {
            return;
        }
        try {
            const modelsByProvider = await this._llmClient.fetchAllConfiguredModels();
            this._view?.webview.postMessage({
                type: 'allModelsListResult',
                modelsByProvider
            });
        } catch {
            // Silent fallback to built-in frontier presets
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
        const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'logo.png'));
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet">
    <title>EleGold Studio</title>
</head>
<body>
    <!-- Top Header, Bilingual Switcher & Status Bar -->
    <header class="top-bar">
        <div class="brand-row">
            <div class="brand-title">
                <img src="${logoUri}" alt="EleGold Studio Logo" class="brand-logo" />
                <div>
                    <h1 data-i18n="appTitle">EleGold Studio</h1>
                    <p class="subtitle" data-i18n="appSubtitle">エレゴールド 仕様駆動設計 (SDD)</p>
                </div>
            </div>
            <div class="header-actions">
                <div class="lang-switch" title="日本語 / English 切替">
                    <button id="btnLangJa" class="lang-btn active">日本語</button>
                    <button id="btnLangEn" class="lang-btn">EN</button>
                </div>
                <button id="btnToggleConfig" class="icon-btn" data-i18n="btnApiConfig">🔑 API・LLM</button>
                <button id="btnOpenVsSettings" class="icon-btn" title="VS Code Settings">⚙️</button>
            </div>
        </div>

        <!-- EGM Role & Model Indicator -->
        <div class="active-models-bar">
            <div class="model-chip elephant-chip" id="chipElephant" title="Elephant: 文脈をすべて保持して設計仕様書を作成するアーキテクト">
                <span class="role-icon">🐘</span>
                <span class="role-label" data-i18n="roleElephant">設計(象):</span>
                <strong id="lblElephantModel">gemini</strong>
            </div>
            <div class="model-chip goldfish-chip" id="chipGoldfish" title="Goldfish: 過去の会話文脈を一切遮断し初見で設計書を監査するレビュアー">
                <span class="role-icon">🐠</span>
                <span class="role-label" data-i18n="roleGoldfish">監査(金魚):</span>
                <strong id="lblGoldfishModel">Zero-Context</strong>
            </div>
        </div>

        <!-- Visual 5-Step Progress Stepper -->
        <nav class="egm-stepper" aria-label="EGM Workflow Steps">
            <button class="stepper-node active" data-target="secStep1" id="stepNode1">
                <span class="step-num">1</span>
                <span class="step-txt" data-i18n="stepNav1">壁打ち</span>
            </button>
            <span class="stepper-line"></span>
            <button class="stepper-node" data-target="secStep2" id="stepNode2">
                <span class="step-num">2</span>
                <span class="step-txt" data-i18n="stepNav2">設計書</span>
            </button>
            <span class="stepper-line"></span>
            <button class="stepper-node" data-target="secStep3" id="stepNode3">
                <span class="step-num">3</span>
                <span class="step-txt" data-i18n="stepNav3">金魚監査</span>
            </button>
            <span class="stepper-line"></span>
            <button class="stepper-node" data-target="secStep4" id="stepNode4">
                <span class="step-num">4</span>
                <span class="step-txt" data-i18n="stepNav4">反映</span>
            </button>
            <span class="stepper-line"></span>
            <button class="stepper-node" data-target="secStep5" id="stepNode5">
                <span class="step-num">5</span>
                <span class="step-txt" data-i18n="stepNav5">承認確定</span>
            </button>
        </nav>

        <!-- File Status Pills -->
        <div class="file-status-row">
            <button id="pillBrief" class="status-pill pending" title="Click to open concepts_brief.md">
                📄 <code>concepts_brief.md</code>: <strong id="stBrief">未作成</strong>
            </button>
            <button id="pillDraft" class="status-pill pending" title="Click to open design_draft.md">
                📝 <code>design_draft.md</code>: <strong id="stDraft">未作成</strong>
            </button>
            <span class="status-meta" id="stTurns">🐘 0</span>
            <span class="status-meta" id="stCacheStats" title="Prompt Caching (Gemini/Claude/OpenAI/Grok/Ollama) + Local SHA-256 Cache">⚡ Cache ON</span>
            <button id="btnClearCache" class="mini-link-btn" title="ローカルLLMキャッシュをクリア">🧹</button>
            <button id="btnResetElephant" class="mini-link-btn" data-i18n="btnReset">履歴リセット</button>
        </div>
    </header>

    <!-- Collapsible API Key & LLM Settings Drawer -->
    <section id="configDrawer" class="config-drawer hidden">
        <div class="drawer-header">
            <h2 data-i18n="drawerTitle">🔑 LLMプロバイダー & APIキー設定</h2>
            <button id="btnCloseConfig" class="mini-link-btn" data-i18n="btnClose">✕ 閉じる</button>
        </div>
        <p class="drawer-desc" data-i18n="drawerDesc">
            Gemini / Claude / OpenAI / Grok / Ollama を利用できます。APIキーはOSの暗号化領域（SecretStorage）に安全に保存されます。
        </p>

        <div class="form-group">
            <label data-i18n="lblSelectElephant">🐘 Elephant（文脈保持・設計書作成）プロバイダー</label>
            <select id="selProvider">
                <option value="gemini">Google Gemini</option>
                <option value="claude">Anthropic Claude</option>
                <option value="openai">OpenAI</option>
                <option value="grok">xAI Grok</option>
                <option value="ollama">Ollama (Local)</option>
            </select>
        </div>

        <div class="form-group">
            <div class="label-with-action">
                <label data-i18n="lblSelectElephantModel">🐘 Elephant モデル名（クリック選択または直接入力）</label>
                <button type="button" id="btnFetchModels" class="mini-link-btn" data-i18n="btnFetchModels">🔄 APIから最新一覧を取得</button>
            </div>
            <div class="input-with-presets">
                <input type="text" id="inpModel" placeholder="e.g. gemini-4-argon / gemini-3.8-flash / claude-sonnet-5-5 / gpt-6-astra / grok-4.7" />
                <div id="modelPresets" class="preset-pills"></div>
            </div>
        </div>

        <div class="form-group">
            <label>
                <span data-i18n="lblSelectGoldfish">🐠 Goldfish（ゼロ文脈・初見レビュアー）プロバイダー</span>
                <span class="badge-hint" data-i18n="badgeCrossLlm">異種LLMクロス監査可</span>
            </label>
            <select id="selGoldfishProvider">
                <option value="same" data-i18n="optSameProvider">Elephantと同じプロバイダー（文脈は完全遮断）</option>
                <option value="gemini">Google Gemini</option>
                <option value="claude">Anthropic Claude</option>
                <option value="openai">OpenAI</option>
                <option value="grok">xAI Grok</option>
                <option value="ollama">Ollama (Local)</option>
            </select>
            <input type="text" id="inpGoldfishModel" class="mt-4" data-i18n-placeholder="phGoldfishModel" placeholder="Goldfish用モデル名（空欄なら自動選択）" />
            <div id="goldfishModelPresets" class="preset-pills"></div>
        </div>

        <div class="btn-row">
            <button id="btnSaveProviderConfig" class="primary-btn small" data-i18n="btnSaveConfig">💾 モデル設定を保存</button>
            <button id="btnTestConnection" class="secondary-btn small" data-i18n="btnTestConn">🔌 接続テスト</button>
        </div>

        <hr class="divider" />

        <div class="api-keys-section">
            <h3 data-i18n="hdrApiKeys">各クラウドLLMのAPIキー登録 (SecretStorage)</h3>
            <div class="key-card" data-provider="gemini">
                <div class="key-card-top">
                    <strong>Google Gemini</strong>
                    <span id="keyStatus-gemini" class="key-badge">未設定</span>
                </div>
                <div class="key-input-row">
                    <input type="password" id="keyInput-gemini" placeholder="AIzaSy..." />
                    <button class="save-key-btn" data-provider="gemini" data-i18n="btnSaveKey">保存</button>
                </div>
            </div>

            <div class="key-card" data-provider="claude">
                <div class="key-card-top">
                    <strong>Anthropic Claude</strong>
                    <span id="keyStatus-claude" class="key-badge">未設定</span>
                </div>
                <div class="key-input-row">
                    <input type="password" id="keyInput-claude" placeholder="sk-ant-..." />
                    <button class="save-key-btn" data-provider="claude" data-i18n="btnSaveKey">保存</button>
                </div>
            </div>

            <div class="key-card" data-provider="openai">
                <div class="key-card-top">
                    <strong>OpenAI</strong>
                    <span id="keyStatus-openai" class="key-badge">未設定</span>
                </div>
                <div class="key-input-row">
                    <input type="password" id="keyInput-openai" placeholder="sk-..." />
                    <button class="save-key-btn" data-provider="openai" data-i18n="btnSaveKey">保存</button>
                </div>
            </div>

            <div class="key-card" data-provider="grok">
                <div class="key-card-top">
                    <strong>xAI Grok</strong>
                    <span id="keyStatus-grok" class="key-badge">未設定</span>
                </div>
                <div class="key-input-row">
                    <input type="password" id="keyInput-grok" placeholder="xai-..." />
                    <button class="save-key-btn" data-provider="grok" data-i18n="btnSaveKey">保存</button>
                </div>
            </div>
        </div>
    </section>

    <!-- Onboarding & Next-Action Navigation Card -->
    <section id="onboardingCard" class="onboarding-card">
        <div class="onboarding-header">
            <span class="onboarding-title" data-i18n="hdrGuide">🧭 ナビゲーション・ガイド（現在地と次の操作）</span>
        </div>
        <div class="readiness-row">
            <div id="readyFolderBadge" class="ready-item">
                <span id="lblFolderStatus">📂 確認中...</span>
                <button id="btnOpenFolder" class="mini-cta-btn hidden" data-i18n="btnOpenFolder">📂 フォルダを開く</button>
                <button id="btnRevealSpecFolder" class="mini-cta-btn" data-i18n="btnRevealSpecFolder" title="EleGold_Specs 専用保存フォルダを開く">📁 保存先を開く</button>
            </div>
            <div id="readyKeyBadge" class="ready-item">
                <span id="lblKeyReadyStatus">🔑 確認中...</span>
                <button id="btnQuickOpenKeys" class="mini-cta-btn hidden" data-i18n="btnQuickKey">🔑 APIキーを設定</button>
            </div>
        </div>
        <div id="nextActionBanner" class="next-action-box">
            <strong id="lblNextActionTitle" data-i18n="lblNextAction">👉 次にやること:</strong>
            <p id="lblNextActionDesc">Step 1 に作りたいアプリのアイデアを入力してください。</p>
        </div>
    </section>

    <!-- Rich Thinking & Telemetry Banner (Dynamically placed directly above the active Step Card) -->
    <div id="loadingBanner" class="loading-banner hidden">
        <div class="loading-top-row">
            <div class="loading-title-group">
                <div class="spinner-large"></div>
                <div class="loading-title-wrap">
                    <div id="loadingText" class="loading-main-title">処理中...</div>
                    <div id="loadingSubText" class="loading-sub-title">LLMエンジンと通信して仕様を分析・構築しています...</div>
                </div>
            </div>
            <div class="loading-right-actions">
                <span id="loadingElapsedBadge" class="loading-timer-badge">⏱️ 0.0s</span>
                <button type="button" id="btnCancelLoading" class="loading-cancel-btn" data-i18n="btnCancelLoading">⏹️ 中断</button>
            </div>
        </div>
        <div class="loading-progress-track">
            <div id="loadingProgressBar" class="loading-progress-fill"></div>
        </div>
        <div id="loadingMetaChips" class="loading-meta-chips"></div>
        <ul id="loadingStagesList" class="loading-stages-list"></ul>
    </div>

    <!-- Error Banner -->
    <div id="errorBanner" class="error-banner hidden">
        <span id="errorText"></span>
        <button id="btnDismissError" class="mini-link-btn">✕</button>
    </div>

    <!-- STEP 1: Brainstorm & 7-Lens Concept Brief (Elephant) -->
    <section class="step-card" id="secStep1">
        <div class="step-header">
            <span class="step-badge elephant-badge">Step 1 · 🐘 Elephant</span>
            <h2 data-i18n="hdrStep1">🧠 アイデア壁打ち & 7レンズ要件定義</h2>
            <span id="focusBadge1" class="focus-step-pill" data-i18n="badgeHere">👈 いまここ</span>
            <button id="btnRollbackStep1" class="rollback-btn hidden" data-i18n="btnRollback1">⏪ Step 1 からやり直す</button>
        </div>
        <p class="step-desc" data-i18n="descStep1">
            まだコードが1行もない「まっさらな状態（0→1開発）」でも、既存プロジェクトへの機能追加でも使えます。まずは作りたいものを書いてみましょう。
        </p>

        <!-- Quick Starter Templates for Blank State -->
        <div class="template-bar">
            <span class="template-label" data-i18n="lblTemplates">💡 記入例を挿入:</span>
            <button type="button" class="template-chip" data-template="greenfield" data-i18n="tplGreenfield">🌱 新規アプリ(0→1)</button>
            <button type="button" class="template-chip" data-template="feature" data-i18n="tplFeature">🧩 既存プロジェクトへの機能追加</button>
            <button type="button" class="template-chip" data-template="api" data-i18n="tplApi">🔌 API・バックエンド設計</button>
        </div>

        <textarea id="txtBrainstormIdea" rows="5" data-i18n-placeholder="phStep1" placeholder="【例】何を作りたいですか？（目的・主な機能・使いたい言語やフレームワークなど、思いつく範囲で自由に書いてください）"></textarea>

        <!-- Clarifying Questions Output Box (Interactive Wizard + Fallback) -->
        <div id="clarifyBox" class="clarify-box hidden">
            <div class="clarify-box-header">
                <strong data-i18n="hdrClarifyBox">🐘 Elephantからの深掘り質問 & 初期ストレスチェック</strong>
                <div class="artifact-btn-group">
                    <button type="button" id="btnOpenClarifyMd" class="mini-cta-btn" data-i18n="btnOpenMd">📄 MDを開く</button>
                    <button type="button" id="btnPreviewClarifyMd" class="mini-cta-btn secondary" data-i18n="btnMdPreview">👁️ 見やすく表示</button>
                </div>
            </div>

            <!--Interactive Question Wizard -->
            <div id="clarifyWizardContainer" class="clarify-wizard hidden">
                <div id="clarifyStressSection" class="clarify-stress-section hidden">
                    <div class="clarify-stress-title" data-i18n="hdrStressTest">🔍 初期ストレスチェック（隠れた前提・リスクの指摘）</div>
                    <ul id="clarifyStressList" class="clarify-stress-list"></ul>
                </div>

                <div class="wizard-card">
                    <div class="wizard-top-bar">
                        <span id="wizardProgressText" class="wizard-progress">質問 1 / 4</span>
                        <div id="wizardStepDots" class="wizard-dots"></div>
                    </div>
                    <div id="wizardCategoryBadge" class="wizard-cat-badge">設計方針</div>
                    <div id="wizardQuestionTitle" class="wizard-q-title"></div>
                    <div id="wizardWhyText" class="wizard-why-text"></div>
                    <div id="wizardOptionsList" class="wizard-options-list"></div>
                    <div class="wizard-custom-row">
                        <input type="text" id="inpWizardCustom" data-i18n-placeholder="phWizardCustom" placeholder="✍️ その他・自由記述で回答する場合はこちらに入力..." />
                    </div>
                    <div class="wizard-nav-row">
                        <button type="button" id="btnWizardPrev" class="secondary-btn small" data-i18n="btnWizardPrev">◀ 前の質問</button>
                        <button type="button" id="btnWizardApplyAll" class="primary-btn small" data-i18n="btnWizardApply">✨ 選択した回答を仕様に反映</button>
                        <button type="button" id="btnWizardNext" class="secondary-btn small" data-i18n="btnWizardNext">次の質問 ▶</button>
                    </div>
                </div>
                <div id="wizardSummaryPreview" class="wizard-summary-preview hidden"></div>
            </div>

            <pre id="clarifyContent" class="clarify-pre hidden"></pre>
            <div class="clarify-reply-hint" data-i18n="hintClarifyReply">
                ✍️ 選択肢をクリックして回答を選ぶと、上の入力欄に回答が自動反映されます。そのまま「② 7レンズ分析ブリーフを生成」を押してください！
            </div>
        </div>

        <div class="step1-actions">
            <button id="btnStep1Clarify" class="secondary-btn full-width mb-6" data-i18n="btnStep1Clarify">① ❓ まず前提の深掘り質問を受ける（推奨・Clarify）</button>
            <button id="btnStep1Create" class="primary-btn full-width" data-i18n="btnStep1Create">② 🧠 7レンズ分析ブリーフを生成 (concepts_brief.md)</button>
            <button id="btnStep1Refine" class="secondary-btn full-width mt-6 hidden" data-i18n="btnStep1Refine">💬 追加要望で既存ブリーフを更新 (Refine Brief)</button>
        </div>

        <!-- Generated concepts_brief.md Result & Inline Direct Editor Box -->
        <div id="step1ResultBox" class="artifact-result-box hidden">
            <div class="artifact-result-top">
                <span class="artifact-ready-badge" data-i18n="lblBriefReady">✅ concepts_brief.md 生成完了！</span>
                <div class="artifact-btn-group">
                    <button type="button" id="btnOpenBriefInline" class="mini-cta-btn" data-i18n="btnOpenBrief">📄 エディタで開く</button>
                    <button type="button" id="btnPreviewBriefSide" class="mini-cta-btn secondary" data-i18n="btnMdPreview">👁️ 見やすく表示</button>
                </div>
            </div>
            <details class="artifact-preview-details" open>
                <summary data-i18n="sumBriefPreview">✏️ ここで中身を確認・直接編集する（開閉可）</summary>
                <textarea id="txtBriefInlineEditor" class="artifact-inline-textarea" rows="10"></textarea>
                <div class="artifact-editor-footer">
                    <span id="lblBriefSaveHint" class="artifact-save-hint" data-i18n="hintInlineEdit">💡 直接書き換えて「💾 編集を保存」を押すと即座にファイルへ反映されます</span>
                    <button type="button" id="btnSaveBriefInline" class="primary-btn small" data-i18n="btnSaveInline">💾 編集を保存</button>
                </div>
            </details>
        </div>

        <!-- Integrated Collapsible Web Search Grounding Bar -->
        <details class="web-grounding-details">
            <summary>
                <span data-i18n="hdrWebSearch">🌐 Web検索・最新技術ドキュメント調査（自動ON）</span>
                <span class="web-ref-pill"><span id="lblWebCount">0</span> refs</span>
            </summary>
            <div class="web-grounding-body">
                <div class="checkbox-list compact">
                    <label class="checkbox-item">
                        <input type="checkbox" id="chkAutoWebSearch" checked />
                        <span data-i18n="chkAutoWeb">設計時に自動でWeb検索（DuckDuckGo / GitHub / Wikipedia）を実行し設計書に反映</span>
                    </label>
                    <label class="checkbox-item">
                        <input type="checkbox" id="chkNativeGrounding" />
                        <span data-i18n="chkNativeWeb">Gemini Search Grounding / Grok Live Search ネイティブ検索も併用</span>
                    </label>
                </div>
                <div class="search-input-row">
                    <input type="text" id="inpWebQuery" data-i18n-placeholder="phWebSearch" placeholder="特定の技術名・API名・または https://... URLを直接調査" />
                    <button id="btnRunWebSearch" class="secondary-btn small" data-i18n="btnRunWeb">🔍 検索・取得</button>
                </div>
                <div id="webResearchDetails" class="research-details">
                    <div class="research-actions">
                        <span data-i18n="lblWebRef">📚 収集済みWebリファレンス</span>
                        <div class="artifact-btn-group">
                            <button type="button" id="btnOpenWebResearchJson" class="mini-link-btn" data-i18n="btnOpenWebJson">📄 JSONを開く</button>
                            <button type="button" id="btnClearWebResearch" class="mini-link-btn" data-i18n="btnClearWeb">クリア</button>
                        </div>
                    </div>
                    <ul id="webResearchList" class="research-list"></ul>
                </div>
            </div>
        </details>
    </section>

    <!-- STEP 2: Formal 9-Section Design Spec (Elephant) -->
    <section class="step-card" id="secStep2">
        <div class="step-header">
            <span class="step-badge elephant-badge">Step 2 · 🐘 Elephant</span>
            <h2 data-i18n="hdrStep2">📝 詳細設計仕様書の作成 (Draft Spec)</h2>
            <span id="focusBadge2" class="focus-step-pill hidden" data-i18n="badgeHere">👈 いまここ</span>
            <button id="btnRollbackStep2" class="rollback-btn hidden" data-i18n="btnRollback2">⏪ Step 2 からやり直す</button>
        </div>
        <div id="prereqStep2" class="prereq-notice" data-i18n="prereqStep2">
            🔒 先に Step 1 で <code>concepts_brief.md</code> を作成すると、このステップが解放されます。
        </div>
        <div id="staleStep2Notice" class="stale-notice hidden" data-i18n="staleStep2">
            ⚠️ Step 1 の要件ブリーフが更新されました。下の「🔄 既存の設計書をベースに差分更新」または「📝 新規に書き直す」を選択してください。
        </div>
        <p class="step-desc" data-i18n="descStep2">
            <code>concepts_brief.md</code> をもとに、CUJ（Given/When/Then）、Mermaidデータフロー図、代替案の棄却理由、異常系仕様、変更対象ファイル＆厳密なインターフェース定義、テスト計画を備えた全9章の設計仕様書 <code>design_draft.md</code> を書き起こします。
        </p>
        <input type="text" id="inpStep2Extra" class="mb-8" data-i18n-placeholder="phStep2Extra" placeholder="追加のアーキテクチャ制約・変更指示・使用ライブラリ指定など（任意）" />
        <button id="btnStep2UpdateDraft" class="primary-btn full-width mb-6 hidden" data-i18n="btnStep2Update">🔄 既存の設計書をベースに差分更新 (Update Existing Draft)</button>
        <button id="btnStep2Draft" class="primary-btn full-width" data-i18n="btnStep2Draft">📝 設計仕様書を書き起こす (Generate Design Spec)</button>

        <!-- Generated design_draft.md Result & Inline Direct Editor Box -->
        <div id="step2ResultBox" class="artifact-result-box hidden">
            <div class="artifact-result-top">
                <span class="artifact-ready-badge" data-i18n="lblDraftReady">✅ design_draft.md 生成完了！</span>
                <div class="artifact-btn-group">
                    <button type="button" id="btnOpenDraftInline" class="mini-cta-btn" data-i18n="btnOpenDraft">📝 エディタで開く</button>
                    <button type="button" id="btnPreviewDraftSide" class="mini-cta-btn secondary" data-i18n="btnMdPreview">👁️ 見やすく表示</button>
                    <button type="button" id="btnOpenStep2Diff" class="mini-cta-btn secondary hidden" data-i18n="btnOpenDiff">🔍 更新前後Diff</button>
                </div>
            </div>
            <details class="artifact-preview-details" open>
                <summary data-i18n="sumDraftPreview">✏️ ここで設計書の中身を確認・直接編集する（開閉可）</summary>
                <textarea id="txtDraftInlineEditor" class="artifact-inline-textarea" rows="12"></textarea>
                <div class="artifact-editor-footer">
                    <span id="lblDraftSaveHint" class="artifact-save-hint" data-i18n="hintInlineEdit">💡 直接書き換えて「💾 編集を保存」を押すと即座にファイルへ反映されます</span>
                    <button type="button" id="btnSaveDraftInline" class="primary-btn small" data-i18n="btnSaveInline">💾 編集を保存</button>
                </div>
            </details>
        </div>
    </section>

    <!-- STEP 3 ⇄ STEP 4 Iterative Review-Refine Loop Banner -->
    <div id="reviewLoopBanner" class="review-loop-banner">
        <div class="loop-banner-top">
            <span class="loop-badge" data-i18n="badgeReviewLoop">🔄 反復ブラッシュアップ・ループ (Step 3 ⇄ Step 4)</span>
            <span id="lblReviewRoundBadge" class="loop-round-pill">Round 0</span>
        </div>
        <p id="lblLoopBannerDesc" class="loop-banner-desc" data-i18n="descReviewLoop">
            🐠 <strong>Step 3（金魚が初見で穴を指摘）</strong> ➔ 🐘 <strong>Step 4（象が設計書を修正）</strong> を1〜2回繰り返して致命的な穴（Critical / High）がなくなったら、<strong>Step 5（正式承認）</strong>へ進みます。
        </p>
    </div>

    <!-- STEP 3: Zero-Context Fresh Review (Goldfish) -->
    <section class="step-card goldfish-card" id="secStep3">
        <div class="step-header">
            <span class="step-badge goldfish-badge">Step 3 · 🐠 Goldfish</span>
            <h2 data-i18n="hdrStep3">🔍 金魚による初見ゼロ文脈レビュー</h2>
            <span id="focusBadge3" class="focus-step-pill hidden" data-i18n="badgeHere">👈 いまここ</span>
            <button id="btnRollbackStep3" class="rollback-btn hidden" data-i18n="btnRollback3">⏪ レビューをリセット</button>
        </div>
        <div id="prereqStep3" class="prereq-notice" data-i18n="prereqStep3">
            🔒 先に Step 2 で <code>design_draft.md</code> を作成すると、金魚レビューを実行できます。
        </div>
        <div class="isolation-notice" data-i18n="noticeIsolation">
            🛡️ <strong>文脈完全遮断 (Zero-Context Isolation)</strong>: Elephantとの対話履歴（<code>elephant_context.json</code>）や <code>concepts_brief.md</code> を完全遮断し、初見の冷徹な監査役として <code>design_draft.md</code> のみをストレスチェックします。
        </div>

        <div class="checkbox-list">
            <label class="checkbox-item">
                <input type="checkbox" id="chkLensComprehension" checked />
                <span data-i18n="lensComprehension">[Comprehension] 初見理解テスト・曖昧表現の排除（自己完結しているか）</span>
            </label>
            <label class="checkbox-item">
                <input type="checkbox" id="chkLensEdge" checked />
                <span data-i18n="lensEdge">[Design Critic] 前提の甘さ・エッジケース（重複実行・競合・切断・境界値）</span>
            </label>
            <label class="checkbox-item">
                <input type="checkbox" id="chkLensConsistency" checked />
                <span data-i18n="lensConsistency">[Codebase Fit] 既存コード・インターフェースとの整合性・YAGNIチェック</span>
            </label>
            <label class="checkbox-item">
                <input type="checkbox" id="chkLensSecurity" checked />
                <span data-i18n="lensSecurity">[Security & SRE] セキュリティ・障害耐性・ロールバック安全性</span>
            </label>
            <label class="checkbox-item">
                <input type="checkbox" id="chkLensReadiness" checked />
                <span data-i18n="lensReadiness">[Readiness] 実装準備完了度（初見エンジニアが推測ゼロで実装できるか）</span>
            </label>
        </div>
        <button id="btnStep3Review" class="goldfish-btn full-width" data-i18n="btnStep3Review">🐠 金魚レビューを実行 (Run Fresh Goldfish Review)</button>

        <!-- Readiness Score & Stop-Condition (Pass/Revision) Dashboard -->
        <div id="readinessScoreBox" class="readiness-score-box hidden">
            <div class="readiness-top-row">
                <div class="readiness-score-group">
                    <span class="readiness-label" data-i18n="lblReadinessScore">📊 設計完成度スコア:</span>
                    <strong id="lblReadinessScoreVal" class="readiness-score-val">0%</strong>
                </div>
                <span id="lblReadinessVerdict" class="verdict-pill">判定中</span>
            </div>
            <div class="readiness-meter-track">
                <div id="readinessMeterFill" class="readiness-meter-fill"></div>
            </div>
            <p id="lblStopGuideText" class="stop-guide-text"></p>
        </div>

        <!-- Step 3 Generated Review Report Artifact Bar -->
        <div id="step3ArtifactBar" class="artifact-quick-bar hidden">
            <span class="artifact-quick-label" data-i18n="lblReviewReportReady">📄 金魚レビュー報告書 (goldfish_review_report.md)</span>
            <div class="artifact-btn-group">
                <button type="button" id="btnOpenReviewReportMd" class="mini-cta-btn" data-i18n="btnOpenMd">📄 MDを開く</button>
                <button type="button" id="btnPreviewReviewReportMd" class="mini-cta-btn secondary" data-i18n="btnMdPreview">👁️ 見やすく表示</button>
                <button type="button" id="btnOpenReviewJson" class="mini-cta-btn secondary" data-i18n="btnOpenJson">📋 JSON</button>
            </div>
        </div>

        <!-- Goldfish Comprehension Paraphrase Box (EGM Stage 6) -->
        <div id="paraphraseBox" class="paraphrase-box hidden">
            <div class="paraphrase-title" data-i18n="hdrParaphrase">🐠 金魚の初見理解テスト (Stage 6 Comprehension Paraphrase)</div>
            <p id="paraphraseText" class="paraphrase-text"></p>
        </div>

        <!-- Goldfish Review Findings Container -->
        <div id="reviewsContainer" class="reviews-container">
            <div class="reviews-toolbar hidden" id="reviewsToolbar">
                <span id="lblReviewSummary">指摘事項: 0件</span>
                <div class="toolbar-links">
                    <button id="btnSelectImportantReviews" class="mini-link-btn" data-i18n="btnSelectImportant">🚨 重要のみ選択</button>
                    <button id="btnSelectAllReviews" class="mini-link-btn" data-i18n="btnSelectAll">全選択</button>
                    <button id="btnDeselectAllReviews" class="mini-link-btn" data-i18n="btnDeselectAll">全解除</button>
                </div>
            </div>
            <div id="reviewsList" class="reviews-list">
                <p class="empty-hint" data-i18n="emptyReviews">まだ金魚レビューは実行されていません。</p>
            </div>
        </div>
    </section>

    <!-- STEP 4: Resolve Findings & Reconcile (Elephant) -->
    <section class="step-card" id="secStep4">
        <div class="step-header">
            <span class="step-badge elephant-badge">Step 4 · 🐘 Elephant</span>
            <h2 data-i18n="hdrStep4">✨ 指摘の反映・設計書ブラッシュアップ</h2>
            <span id="focusBadge4" class="focus-step-pill hidden" data-i18n="badgeHere">👈 いまここ</span>
        </div>
        <div id="prereqStep4" class="prereq-notice" data-i18n="prereqStep4">
            🔒 Step 3 で金魚レビューを実行し、反映したい指摘にチェックを入れると実行できます。
        </div>
        <p class="step-desc" data-i18n="descStep4">
            チェックを入れた金魚の指摘事項を「象（Elephant）」に渡し、<code>design_draft.md</code> の各章と第9章「設計判断・レビュー履歴」をアップデートします。
        </p>
        <input type="text" id="inpStep4Comment" class="mb-8" data-i18n-placeholder="phStep4Comment" placeholder="設計者（あなた）からの補足判断・修正指示があれば入力（任意）" />
        <label class="checkbox-item mb-8">
            <input type="checkbox" id="chkOpenDiff" checked />
            <span data-i18n="chkDiffView">更新後に変更前後を VS Code Diff ビューで比較表示する</span>
        </label>
        <button id="btnStep4Resolve" class="primary-btn full-width" data-i18n="btnStep4Resolve">✨ 選択した指摘を設計書に反映 (Resolve Selected)</button>

        <!-- Step 4 Updated Spec & Diff Quick-Open Bar -->
        <div id="step4ArtifactBar" class="artifact-quick-bar hidden">
            <span class="artifact-quick-label" data-i18n="lblStep4ArtifactReady">✅ 反映済み設計仕様書 (design_draft.md)</span>
            <div class="artifact-btn-group">
                <button type="button" id="btnOpenStep4Draft" class="mini-cta-btn" data-i18n="btnOpenDraft">📝 エディタで開く</button>
                <button type="button" id="btnPreviewStep4Draft" class="mini-cta-btn secondary" data-i18n="btnMdPreview">👁️ 見やすく表示</button>
                <button type="button" id="btnOpenStep4Diff" class="mini-cta-btn secondary" data-i18n="btnOpenDiff">🔍 反映前後Diff</button>
            </div>
        </div>

        <!-- Post-Resolution Next-Decision Fork (Re-run Step 3 vs Proceed to Step 5) -->
        <div id="step4LoopForkBox" class="loop-fork-box hidden">
            <div class="loop-fork-title" id="lblLoopForkTitle" data-i18n="hdrLoopFork">
                ✅ 指摘の反映が完了しました！次のアクションを選んでください：
            </div>
            <p class="loop-fork-desc" data-i18n="descLoopFork">
                修正後の設計書にまだ抜け漏れがないか<strong>もう一度「金魚レビュー」で確認（ループ）</strong>するか、問題なければ<strong>「Step 5 最終承認」へ進む</strong>かを選べます。
            </p>
            <div class="loop-fork-actions">
                <button type="button" id="btnLoopRerunGoldfish" class="goldfish-btn small" data-i18n="btnLoopRerun">
                    🔄 修正後の設計書で金魚レビューを再実行 (Step 3へ)
                </button>
                <button type="button" id="btnLoopGoApprove" class="approve-btn small" data-i18n="btnLoopProceed">
                    🚀 完璧なので最終承認へ進む (Step 5へ)
                </button>
            </div>
        </div>
    </section>

    <!-- STEP 5: Finalize & Approve Design Spec -->
    <section class="step-card approve-card" id="secStep5">
        <div class="step-header">
            <span class="step-badge approve-badge">Step 5 · ✅ SDD</span>
            <h2 data-i18n="hdrStep5">🚀 設計書の最終承認 & 仕様駆動開発連携</h2>
            <span id="focusBadge5" class="focus-step-pill hidden" data-i18n="badgeHere">👈 いまここ</span>
        </div>
        <div id="prereqStep5" class="prereq-notice" data-i18n="prereqStep5">
            🔒 Step 2〜4 で <code>design_draft.md</code> を完成させると、最終承認とAI実装出力が可能になります。
        </div>
        <p class="step-desc" data-i18n="descStep5">
            ガチガチに固まった設計仕様書に <code>Status: Approved</code> と金魚レビュー通過記録を刻印し、専用フォルダ内の <code>EleGold_Specs/approved_specs/NNN-[feature-name].md</code> および <code>SITEMAP.md</code> に正式登録します。
        </p>
        <div class="form-group">
            <label data-i18n="lblFeatureSlug">設計書ファイル名 (Feature Slug)</label>
            <input type="text" id="inpFeatureName" placeholder="e.g. initial-architecture" value="initial-architecture" />
        </div>
        <button id="btnStep5Approve" class="approve-btn full-width mb-8" data-i18n="btnStep5Approve">✅ 設計書を承認して確定保存 (Approve & Archive Spec)</button>

        <details class="sdd-tools-details" open>
            <summary data-i18n="sumSddTools">🛠️ 承認後の実装連携・ドリフト監査ツール (SDD Post-Design Tools)</summary>
            <div id="prereqStep5Sdd" class="prereq-notice mt-6" data-i18n="prereqStep5Sdd">
                🔒 先に上の「✅ 設計書を承認して確定保存」を実行し、仕様書を正式承認 (Approved) すると以下の実装・ドリフト監査ツールが解放されます。
            </div>
            <div class="btn-row mt-6">
                <button id="btnStep5CopyPrompt" class="secondary-btn small" data-i18n="btnCopyPrompt">📋 コーディングAI用指示をコピー</button>
                <button id="btnStep5Implement" class="primary-btn small" data-i18n="btnImplement">💻 この設計書からコード生成</button>
            </div>
            <!-- Implementation Guide Artifact Bar -->
            <div id="step5ImplArtifactBar" class="artifact-quick-bar hidden">
                <span class="artifact-quick-label" data-i18n="lblImplGuideReady">💻 実装ガイド (implementation_output.md)</span>
                <div class="artifact-btn-group">
                    <button type="button" id="btnOpenImplGuide" class="mini-cta-btn" data-i18n="btnOpenMd">📄 MDを開く</button>
                    <button type="button" id="btnPreviewImplGuide" class="mini-cta-btn secondary" data-i18n="btnMdPreview">👁️ 見やすく表示</button>
                </div>
            </div>

            <button id="btnStep5Drift" class="secondary-btn small full-width mt-6" data-i18n="btnDrift">⚖️ 仕様ドリフト監査を実行 (/egm-drift-report)</button>
            <!-- Drift Report Artifact Bar -->
            <div id="step5DriftArtifactBar" class="artifact-quick-bar hidden">
                <span class="artifact-quick-label" data-i18n="lblDriftReportReady">⚖️ ドリフト監査レポート (drift_report.md)</span>
                <div class="artifact-btn-group">
                    <button type="button" id="btnOpenDriftReport" class="mini-cta-btn" data-i18n="btnOpenReport">📄 レポートを開く</button>
                    <button type="button" id="btnPreviewDriftReport" class="mini-cta-btn secondary" data-i18n="btnMdPreview">👁️ 見やすく表示</button>
                </div>
            </div>
        </details>

        <div id="approvedSpecsBox" class="approved-specs-box hidden">
            <div class="approved-specs-header">
                <h3 data-i18n="hdrApprovedSpecs">📁 承認済み設計仕様書アーカイブ (EleGold_Specs/approved_specs/)</h3>
                <div id="sitemapArtifactGroup" class="artifact-btn-group hidden">
                    <button type="button" id="btnOpenSitemapMd" class="mini-cta-btn" data-i18n="btnOpenSitemap">🗺️ SITEMAP.md</button>
                    <button type="button" id="btnPreviewSitemapMd" class="mini-cta-btn secondary" data-i18n="btnMdPreview">👁️ 見やすく表示</button>
                </div>
            </div>
            <ul id="approvedSpecsList"></ul>
        </div>
    </section>

    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
