import * as vscode from 'vscode';
import { LlmClient, LlmProviderId } from './llmClient';
import { EgmEngine } from './egmEngine';
import { SidebarProvider } from './sidebarProvider';

export function activate(context: vscode.ExtensionContext): void {
    console.log('Extension "antigravity-egm-studio-ext" (EGM Studio v0.2.0) is now active!');

    const llmClient = new LlmClient(context);
    const egmEngine = new EgmEngine(llmClient);
    const sidebarProvider = new SidebarProvider(context.extensionUri, egmEngine, llmClient);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebarProvider, {
            webviewOptions: {
                retainContextWhenHidden: true
            }
        })
    );

    // Command: Open Extension Settings
    context.subscriptions.push(
        vscode.commands.registerCommand('egmStudio.openSettings', async () => {
            await vscode.commands.executeCommand('workbench.action.openSettings', 'egmStudio');
        })
    );

    // Command: Toggle Language (ja <-> en)
    context.subscriptions.push(
        vscode.commands.registerCommand('egmStudio.toggleLanguage', async () => {
            const current = egmEngine.getLanguage();
            const next = current === 'ja' ? 'en' : 'ja';
            await vscode.workspace
                .getConfiguration('egmStudio')
                .update('language', next, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(
                next === 'en' ? 'EGM Studio language switched to English.' : 'EGM Studio の言語を日本語に切り替えました。'
            );
            await sidebarProvider.refresh();
        })
    );

    // Command: Set API Key via QuickPick + InputBox (Claude / OpenAI / Grok / Gemini)
    context.subscriptions.push(
        vscode.commands.registerCommand('egmStudio.setApiKey', async () => {
            const lang = egmEngine.getLanguage();
            const pick = await vscode.window.showQuickPick(
                [
                    { label: 'Google Gemini API Key', provider: 'gemini' as LlmProviderId, detail: 'Gemini 4 Argon / Gemini 3.8 Flash / 3.1 Pro' },
                    { label: 'Anthropic Claude API Key', provider: 'claude' as LlmProviderId, detail: 'Claude 5.5 Opus / Sonnet / Haiku / Fable 5.1' },
                    { label: 'OpenAI API Key', provider: 'openai' as LlmProviderId, detail: 'GPT-6 Astra / 6.1 Sol / GPT-5.5' },
                    { label: 'xAI Grok API Key', provider: 'grok' as LlmProviderId, detail: 'Grok 4.7 / Grok 420 Reasoning' }
                ],
                {
                    title:
                        lang === 'en'
                            ? 'EGM Studio: Select LLM Provider to Set API Key'
                            : 'EGM Studio: APIキーを設定するLLMプロバイダーを選択',
                    placeHolder: lang === 'en' ? 'Select a provider' : 'プロバイダーを選択してください'
                }
            );
            if (!pick) {
                return;
            }

            const key = await vscode.window.showInputBox({
                title:
                    lang === 'en'
                        ? `Enter ${pick.label} (Encrypted in SecretStorage; leave blank to clear)`
                        : `${pick.label} を入力（SecretStorageへ暗号化保存されます・空欄で削除）`,
                password: true,
                ignoreFocusOut: true,
                placeHolder: lang === 'en' ? 'Paste API key...' : 'APIキーを入力...'
            });
            if (key === undefined) {
                return;
            }

            await llmClient.setApiKey(pick.provider, key);
            vscode.window.showInformationMessage(
                key.trim()
                    ? lang === 'en'
                        ? `Saved ${pick.label}.`
                        : `${pick.label} を保存しました。`
                    : lang === 'en'
                    ? `Cleared ${pick.label}.`
                    : `${pick.label} を削除しました。`
            );
            await sidebarProvider.refresh();
        })
    );

    // Command: Test LLM Connection
    context.subscriptions.push(
        vscode.commands.registerCommand('egmStudio.testConnection', async () => {
            const res = await llmClient.testConnection();
            if (res.ok) {
                vscode.window.showInformationMessage(
                    `✅ EGM Studio [${res.provider} / ${res.model}] (${res.latencyMs}ms): ${res.message}`
                );
            } else {
                vscode.window.showErrorMessage(
                    `❌ EGM Studio [${res.provider} / ${res.model}]: ${res.message}`
                );
            }
        })
    );

    // Command: Reset Elephant Session
    context.subscriptions.push(
        vscode.commands.registerCommand('egmStudio.resetSession', async () => {
            const lang = egmEngine.getLanguage();
            await egmEngine.resetElephantHistory();
            vscode.window.showInformationMessage(
                lang === 'en' ? '🐘 Reset Elephant conversation history.' : '🐘 Elephantの対話履歴をリセットしました。'
            );
            await sidebarProvider.refresh();
        })
    );

    // Refresh sidebar when configuration or workspace files change
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('egmStudio')) {
                void sidebarProvider.refresh();
            }
        }),
        vscode.workspace.onDidSaveTextDocument(() => {
            void sidebarProvider.refresh();
        })
    );
}

export function deactivate(): void {}
