import * as vscode from 'vscode';
import * as crypto from 'crypto';

export type LlmProviderId = 'gemini' | 'claude' | 'openai' | 'grok' | 'ollama';

export interface ChatTurn {
    role: 'user' | 'assistant';
    content: string;
    timestamp?: string;
    phase?: string;
}

export interface LlmCallOptions {
    temperature?: number;
    maxTokens?: number;
    jsonMode?: boolean;
    useNativeWebSearch?: boolean;
    /**
     * Large static reference context (e.g., concepts_brief.md, design_draft.md, project structure).
     * Placed at the prompt prefix / marked with Anthropic `cache_control: { type: 'ephemeral' }`
     * so Gemini Implicit Caching, Claude Prompt Caching, OpenAI/Grok Prefix Caching, and Ollama KV Cache hit maximally.
     */
    cacheableContext?: string;
    /**
     * Sticky session/routing key for OpenAI (`prompt_cache_key`) and xAI Grok (`x-grok-conv-id`).
     */
    sessionKey?: string;
    /**
     * When true, skips the local SHA-256 response cache and forces a live API call.
     */
    bypassCache?: boolean;
}

export interface LlmCacheStats {
    totalCalls: number;
    providerCacheHits: number;
    localCacheHits: number;
    totalInputTokens: number;
    cachedInputTokens: number;
    totalOutputTokens: number;
    lastCall?: {
        timestamp: string;
        provider: LlmProviderId;
        model: string;
        source: 'local-cache' | 'provider-cache' | 'fresh';
        inputTokens: number;
        cachedTokens: number;
        outputTokens: number;
    };
}

interface LocalCacheEntry {
    hash: string;
    provider: LlmProviderId;
    model: string;
    response: string;
    estimatedTokens: number;
    createdAt: number;
}

export interface ProviderSummary {
    elephantProvider: LlmProviderId;
    elephantModel: string;
    goldfishProvider: LlmProviderId;
    goldfishModel: string;
    keyStatus: Record<
        LlmProviderId,
        { configured: boolean; source: 'secret' | 'settings' | 'env' | 'not-required' | 'none'; masked: string }
    >;
    cacheStats: LlmCacheStats;
}

const DEFAULT_MODELS: Record<LlmProviderId, string> = {
    gemini: 'gemini-4-argon',
    claude: 'claude-opus-5-5',
    openai: 'gpt-6-astra',
    grok: 'grok-4.7',
    ollama: 'gemma4:latest'
};

export const BUILTIN_MODEL_PRESETS: Record<LlmProviderId, string[]> = {
    gemini: [
        'gemini-4-argon',
        'gemini-3.1-pro-preview',
        'gemini-3.8-flash',
        'gemini-3.5-flash',
        'gemini-3.5-flash-lite'
    ],
    claude: [
        'claude-opus-5-5',
        'claude-fable-5-1',
        'claude-sonnet-5-5',
        'claude-haiku-5-5'
    ],
    openai: [
        'gpt-6-astra',
        'gpt-6.1-sol',
        'gpt-5.5-pro',
        'gpt-5.5',
        'gpt-5.4'
    ],
    grok: [
        'grok-4.7',
        'grok-420-reasoning',
        'grok-4'
    ],
    ollama: [
        'gemma4:latest',
        'deepseek-r1:latest',
        'qwen3-coder:latest',
        'gemma3:latest'
    ]
};

export class LlmClient {
    private activeAbortController: AbortController | null = null;
    private modelListCache: Partial<
        Record<LlmProviderId, { models: string[]; fromLiveApi: boolean; expiresAt: number }>
    > = {};

    constructor(private readonly context: vscode.ExtensionContext) {}

    public cancelActiveRequest(): boolean {
        if (this.activeAbortController) {
            this.activeAbortController.abort();
            this.activeAbortController = null;
            return true;
        }
        return false;
    }

    private createRequestSignal(timeoutMs = 180000): AbortSignal {
        if (this.activeAbortController) {
            this.activeAbortController.abort();
        }
        const controller = new AbortController();
        this.activeAbortController = controller;
        const timeoutSignal = AbortSignal.timeout(timeoutMs);
        if (typeof AbortSignal.any === 'function') {
            return AbortSignal.any([controller.signal, timeoutSignal]);
        }
        timeoutSignal.addEventListener('abort', () => controller.abort());
        return controller.signal;
    }

    public getDefaultModelForProvider(provider: LlmProviderId): string {
        return DEFAULT_MODELS[provider] || 'gemini-3.8-flash';
    }

    private getSecretKeyName(provider: LlmProviderId): string {
        return `egmStudio.secret.${provider}`;
    }

    public getCacheStats(): LlmCacheStats {
        const stored = this.context.workspaceState.get<LlmCacheStats>('egmStudio.cacheStats');
        return (
            stored || {
                totalCalls: 0,
                providerCacheHits: 0,
                localCacheHits: 0,
                totalInputTokens: 0,
                cachedInputTokens: 0,
                totalOutputTokens: 0
            }
        );
    }

    public async clearResponseCache(): Promise<void> {
        await this.context.workspaceState.update('egmStudio.llmResponseCache', []);
        await this.context.workspaceState.update('egmStudio.cacheStats', {
            totalCalls: 0,
            providerCacheHits: 0,
            localCacheHits: 0,
            totalInputTokens: 0,
            cachedInputTokens: 0,
            totalOutputTokens: 0
        });
    }

    private async recordUsageTelemetry(params: {
        provider: LlmProviderId;
        model: string;
        source: 'local-cache' | 'provider-cache' | 'fresh';
        inputTokens: number;
        cachedTokens: number;
        outputTokens: number;
    }): Promise<void> {
        const stats = this.getCacheStats();
        stats.totalCalls += 1;
        if (params.source === 'local-cache') {
            stats.localCacheHits += 1;
        } else if (params.cachedTokens > 0) {
            stats.providerCacheHits += 1;
        }
        stats.totalInputTokens += Math.max(0, params.inputTokens);
        stats.cachedInputTokens += Math.max(0, params.cachedTokens);
        stats.totalOutputTokens += Math.max(0, params.outputTokens);
        stats.lastCall = {
            timestamp: new Date().toISOString(),
            provider: params.provider,
            model: params.model,
            source: params.source,
            inputTokens: Math.max(0, params.inputTokens),
            cachedTokens: Math.max(0, params.cachedTokens),
            outputTokens: Math.max(0, params.outputTokens)
        };
        await this.context.workspaceState.update('egmStudio.cacheStats', stats);
    }

    private getStickySessionKey(role: 'elephant' | 'goldfish'): string {
        const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 'default-ws';
        const wsHash = crypto.createHash('sha256').update(wsFolder).digest('hex').slice(0, 12);
        return `egm-${wsHash}-${role}`;
    }

    public async setApiKey(provider: LlmProviderId, apiKey: string): Promise<void> {
        if (provider === 'ollama') {
            return;
        }
        delete this.modelListCache[provider];
        const trimmed = apiKey.trim();
        if (!trimmed) {
            await this.context.secrets.delete(this.getSecretKeyName(provider));
        } else {
            await this.context.secrets.store(this.getSecretKeyName(provider), trimmed);
        }
    }

    public async clearApiKey(provider: LlmProviderId): Promise<void> {
        delete this.modelListCache[provider];
        await this.context.secrets.delete(this.getSecretKeyName(provider));
    }

    public async resolveApiKey(provider: LlmProviderId): Promise<{
        key: string;
        source: 'secret' | 'settings' | 'env' | 'not-required' | 'none';
    }> {
        if (provider === 'ollama') {
            return { key: 'ollama', source: 'not-required' };
        }

        // 1. SecretStorage
        const fromSecret = (await this.context.secrets.get(this.getSecretKeyName(provider)))?.trim();
        if (fromSecret) {
            return { key: fromSecret, source: 'secret' };
        }

        // 2. VS Code settings.json
        const cfg = vscode.workspace.getConfiguration('egmStudio');
        const fromSettings = (cfg.get<string>(`apiKeys.${provider}`) || '').trim();
        if (fromSettings) {
            return { key: fromSettings, source: 'settings' };
        }

        // 3. Environment variable fallback
        const envMap: Record<LlmProviderId, string[]> = {
            gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
            claude: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
            openai: ['OPENAI_API_KEY'],
            grok: ['XAI_API_KEY', 'GROK_API_KEY'],
            ollama: []
        };
        for (const envName of envMap[provider]) {
            const val = (process.env[envName] || '').trim();
            if (val) {
                return { key: val, source: 'env' };
            }
        }

        return { key: '', source: 'none' };
    }

    public async getProviderSummary(): Promise<ProviderSummary> {
        const cfg = vscode.workspace.getConfiguration('egmStudio');
        const elephantProvider = (cfg.get<string>('provider') || 'gemini') as LlmProviderId;
        const rawModel = (cfg.get<string>('model') || '').trim();
        // Auto-upgrade legacy default 'gemini-2.5-pro' if user hasn't customized or is on Gemini
        const elephantModel =
            !rawModel || (elephantProvider === 'gemini' && rawModel === 'gemini-2.5-pro')
                ? this.getDefaultModelForProvider(elephantProvider)
                : rawModel;

        const rawGfProvider = (cfg.get<string>('goldfishProvider') || 'same').trim();
        const goldfishProvider: LlmProviderId =
            rawGfProvider === 'same' || !rawGfProvider ? elephantProvider : (rawGfProvider as LlmProviderId);
        const rawGfModel = (cfg.get<string>('goldfishModel') || '').trim();
        const goldfishModel =
            rawGfModel ||
            (goldfishProvider === elephantProvider ? elephantModel : this.getDefaultModelForProvider(goldfishProvider));

        const providers: LlmProviderId[] = ['gemini', 'claude', 'openai', 'grok', 'ollama'];
        const keyStatus = {} as ProviderSummary['keyStatus'];

        for (const p of providers) {
            const resolved = await this.resolveApiKey(p);
            const configured = p === 'ollama' || Boolean(resolved.key);
            const masked =
                p === 'ollama'
                    ? 'Local'
                    : resolved.key
                    ? `${resolved.key.slice(0, 4)}...${resolved.key.slice(-4)} (${resolved.source})`
                    : '';
            keyStatus[p] = {
                configured,
                source: resolved.source,
                masked
            };
        }

        return {
            elephantProvider,
            elephantModel,
            goldfishProvider,
            goldfishModel,
            keyStatus,
            cacheStats: this.getCacheStats()
        };
    }

    /**
     * Fetches live available models directly from the selected provider's API (with 10-minute in-memory TTL cache)
     * Falls back to BUILTIN_MODEL_PRESETS if API key is missing or endpoint doesn't list models.
     */
    public async fetchAvailableModels(
        provider: LlmProviderId,
        forceRefresh = false
    ): Promise<{
        models: string[];
        fromLiveApi: boolean;
    }> {
        const cached = this.modelListCache[provider];
        if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
            return { models: cached.models, fromLiveApi: cached.fromLiveApi };
        }

        const cfg = vscode.workspace.getConfiguration('egmStudio');
        try {
            if (provider === 'gemini') {
                const { key } = await this.resolveApiKey('gemini');
                if (!key) {
                    return { models: BUILTIN_MODEL_PRESETS.gemini, fromLiveApi: false };
                }
                const endpoint = (
                    cfg.get<string>('endpoints.gemini') || 'https://generativelanguage.googleapis.com'
                ).replace(/\/+$/, '');
                const res = await fetch(`${endpoint}/v1beta/models`, {
                    headers: { 'x-goog-api-key': key },
                    signal: AbortSignal.timeout(4500)
                });
                if (res.ok) {
                    const data = (await res.json()) as {
                        models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
                    };
                    const live = (data.models || [])
                        .filter(
                            (m) =>
                                m.name &&
                                (!m.supportedGenerationMethods ||
                                    m.supportedGenerationMethods.includes('generateContent'))
                        )
                        .map((m) => m.name!.replace(/^models\//, ''))
                        .filter((id) => id.startsWith('gemini-') && !id.includes('embedding'));
                    if (live.length > 0) {
                        const merged = Array.from(new Set([...BUILTIN_MODEL_PRESETS.gemini, ...live])).slice(0, 18);
                        this.modelListCache[provider] = {
                            models: merged,
                            fromLiveApi: true,
                            expiresAt: Date.now() + 10 * 60 * 1000
                        };
                        return { models: merged, fromLiveApi: true };
                    }
                }
            } else if (provider === 'claude') {
                const { key } = await this.resolveApiKey('claude');
                if (!key) {
                    return { models: BUILTIN_MODEL_PRESETS.claude, fromLiveApi: false };
                }
                const endpoint = (cfg.get<string>('endpoints.claude') || 'https://api.anthropic.com').replace(
                    /\/+$/,
                    ''
                );
                const res = await fetch(`${endpoint}/v1/models`, {
                    headers: {
                        'x-api-key': key,
                        'anthropic-version': '2023-06-01'
                    },
                    signal: AbortSignal.timeout(4500)
                });
                if (res.ok) {
                    const data = (await res.json()) as { data?: Array<{ id?: string }> };
                    const live = (data.data || []).map((m) => m.id || '').filter(Boolean);
                    if (live.length > 0) {
                        const merged = Array.from(new Set([...BUILTIN_MODEL_PRESETS.claude, ...live])).slice(0, 18);
                        this.modelListCache[provider] = {
                            models: merged,
                            fromLiveApi: true,
                            expiresAt: Date.now() + 10 * 60 * 1000
                        };
                        return { models: merged, fromLiveApi: true };
                    }
                }
            } else if (provider === 'openai' || provider === 'grok') {
                const { key } = await this.resolveApiKey(provider);
                if (!key) {
                    return { models: BUILTIN_MODEL_PRESETS[provider], fromLiveApi: false };
                }
                const defaultBase = provider === 'grok' ? 'https://api.x.ai/v1' : 'https://api.openai.com/v1';
                const endpoint = (cfg.get<string>(`endpoints.${provider}`) || defaultBase).replace(/\/+$/, '');
                const res = await fetch(`${endpoint}/models`, {
                    headers: { Authorization: `Bearer ${key}` },
                    signal: AbortSignal.timeout(4500)
                });
                if (res.ok) {
                    const data = (await res.json()) as { data?: Array<{ id?: string }> };
                    const live = (data.data || [])
                        .map((m) => m.id || '')
                        .filter(
                            (id) =>
                                Boolean(id) &&
                                !id.includes('embedding') &&
                                !id.includes('whisper') &&
                                !id.includes('tts') &&
                                !id.includes('moderation')
                        );
                    if (live.length > 0) {
                        const merged = Array.from(new Set([...BUILTIN_MODEL_PRESETS[provider], ...live])).slice(0, 18);
                        this.modelListCache[provider] = {
                            models: merged,
                            fromLiveApi: true,
                            expiresAt: Date.now() + 10 * 60 * 1000
                        };
                        return { models: merged, fromLiveApi: true };
                    }
                }
            } else if (provider === 'ollama') {
                const endpoint = (cfg.get<string>('endpoints.ollama') || 'http://localhost:11434').replace(/\/+$/, '');
                const res = await fetch(`${endpoint}/api/tags`, {
                    signal: AbortSignal.timeout(2500)
                });
                if (res.ok) {
                    const data = (await res.json()) as { models?: Array<{ name?: string }> };
                    const live = (data.models || []).map((m) => m.name || '').filter(Boolean);
                    if (live.length > 0) {
                        this.modelListCache[provider] = {
                            models: live,
                            fromLiveApi: true,
                            expiresAt: Date.now() + 5 * 60 * 1000
                        };
                        return { models: live, fromLiveApi: true };
                    }
                }
            }
        } catch {
            // Fall back to presets below
        }

        return { models: BUILTIN_MODEL_PRESETS[provider] || [], fromLiveApi: false };
    }

    /**
     * Automatically fetches live models in parallel for all providers on startup or key change.
     */
    public async fetchAllConfiguredModels(): Promise<
        Record<LlmProviderId, { models: string[]; fromLiveApi: boolean }>
    > {
        const providers: LlmProviderId[] = ['gemini', 'claude', 'openai', 'grok', 'ollama'];
        const entries = await Promise.all(
            providers.map(async (p) => {
                const res = await this.fetchAvailableModels(p);
                return [p, res] as const;
            })
        );
        return Object.fromEntries(entries) as Record<
            LlmProviderId,
            { models: string[]; fromLiveApi: boolean }
        >;
    }

    /**
     * 🐘 Elephant Call: Uses full conversation/context history + sticky session routing
     */
    public async callElephant(
        systemPrompt: string,
        userPrompt: string,
        history: ChatTurn[] = [],
        options: LlmCallOptions = {}
    ): Promise<string> {
        const summary = await this.getProviderSummary();
        return this.dispatchRequest(
            summary.elephantProvider,
            summary.elephantModel,
            systemPrompt,
            userPrompt,
            history,
            {
                ...options,
                sessionKey: options.sessionKey || this.getStickySessionKey('elephant')
            }
        );
    }

    /**
     * 🐠 Goldfish Call: Strictly ZERO-CONTEXT (No history parameter allowed!)
     */
    public async callGoldfish(
        systemPrompt: string,
        isolatedPrompt: string,
        options: LlmCallOptions = {}
    ): Promise<string> {
        const summary = await this.getProviderSummary();
        return this.dispatchRequest(
            summary.goldfishProvider,
            summary.goldfishModel,
            systemPrompt,
            isolatedPrompt,
            [],
            {
                ...options,
                sessionKey: options.sessionKey || this.getStickySessionKey('goldfish')
            }
        );
    }

    /**
     * Quick connection test for the active provider
     */
    public async testConnection(targetProvider?: LlmProviderId, targetModel?: string): Promise<{
        ok: boolean;
        provider: LlmProviderId;
        model: string;
        latencyMs: number;
        message: string;
    }> {
        const summary = await this.getProviderSummary();
        const provider = targetProvider || summary.elephantProvider;
        const model =
            targetModel ||
            (provider === summary.elephantProvider ? summary.elephantModel : this.getDefaultModelForProvider(provider));
        const t0 = Date.now();
        try {
            const reply = await this.dispatchRequest(
                provider,
                model,
                'You are a connectivity check assistant.',
                'Reply with a short greeting in 10 words or less.',
                [],
                { maxTokens: 64, temperature: 0, bypassCache: true }
            );
            return {
                ok: true,
                provider,
                model,
                latencyMs: Date.now() - t0,
                message: reply.trim().slice(0, 120)
            };
        } catch (err) {
            return {
                ok: false,
                provider,
                model,
                latencyMs: Date.now() - t0,
                message: err instanceof Error ? err.message : String(err)
            };
        }
    }

    private computeRequestCacheHash(
        provider: LlmProviderId,
        model: string,
        systemPrompt: string,
        userPrompt: string,
        history: ChatTurn[],
        options: LlmCallOptions
    ): string {
        const payload = JSON.stringify({
            provider,
            model,
            systemPrompt,
            cacheableContext: options.cacheableContext || '',
            userPrompt,
            history: history.slice(-6).map((h) => ({ r: h.role, c: h.content })),
            jsonMode: Boolean(options.jsonMode),
            useNativeWebSearch: Boolean(options.useNativeWebSearch)
        });
        return crypto.createHash('sha256').update(payload).digest('hex');
    }

    private estimateTokens(text: string): number {
        return Math.max(1, Math.ceil(text.length / 3.5));
    }

    private async dispatchRequest(
        provider: LlmProviderId,
        model: string,
        systemPrompt: string,
        userPrompt: string,
        history: ChatTurn[],
        options: LlmCallOptions
    ): Promise<string> {
        const cfg = vscode.workspace.getConfiguration('egmStudio');
        const nativeGrounding =
            options.useNativeWebSearch ?? cfg.get<boolean>('webSearch.nativeGrounding', false);
        const enableLocalCache = cfg.get<boolean>('enableLocalCache', true);

        const reqHash = this.computeRequestCacheHash(provider, model, systemPrompt, userPrompt, history, {
            ...options,
            useNativeWebSearch: nativeGrounding
        });

        // 1. Check Local Exact-Match SHA-256 Cache (0ms latency, 100% API cost savings)
        if (enableLocalCache && !options.bypassCache) {
            const entries = this.context.workspaceState.get<LocalCacheEntry[]>('egmStudio.llmResponseCache', []);
            const now = Date.now();
            const ttlMs = 24 * 60 * 60 * 1000; // 24 hours
            const hit = entries.find((e) => e.hash === reqHash && now - e.createdAt < ttlMs);
            if (hit && hit.response) {
                await this.recordUsageTelemetry({
                    provider,
                    model,
                    source: 'local-cache',
                    inputTokens: hit.estimatedTokens,
                    cachedTokens: hit.estimatedTokens,
                    outputTokens: 0
                });
                return hit.response;
            }
        }

        let responseText = '';
        switch (provider) {
            case 'gemini':
                responseText = await this.callGemini(model, systemPrompt, userPrompt, history, {
                    ...options,
                    useNativeWebSearch: nativeGrounding
                });
                break;
            case 'claude':
                responseText = await this.callClaude(model, systemPrompt, userPrompt, history, options);
                break;
            case 'openai':
                responseText = await this.callOpenAiCompatible('openai', model, systemPrompt, userPrompt, history, options);
                break;
            case 'grok':
                responseText = await this.callOpenAiCompatible('grok', model, systemPrompt, userPrompt, history, {
                    ...options,
                    useNativeWebSearch: nativeGrounding
                });
                break;
            case 'ollama':
                responseText = await this.callOllama(model, systemPrompt, userPrompt, history, options);
                break;
            default:
                throw new Error(`Unsupported provider: ${provider}`);
        }

        // 2. Store in Local Exact-Match SHA-256 Cache (keep most recent 35 entries)
        if (enableLocalCache && !options.bypassCache && responseText) {
            const entries = this.context.workspaceState.get<LocalCacheEntry[]>('egmStudio.llmResponseCache', []);
            const estInput = this.estimateTokens(
                systemPrompt + (options.cacheableContext || '') + userPrompt + history.map((h) => h.content).join('')
            );
            const updated: LocalCacheEntry[] = [
                {
                    hash: reqHash,
                    provider,
                    model,
                    response: responseText,
                    estimatedTokens: estInput,
                    createdAt: Date.now()
                },
                ...entries.filter((e) => e.hash !== reqHash)
            ].slice(0, 35);
            await this.context.workspaceState.update('egmStudio.llmResponseCache', updated);
        }

        return responseText;
    }

    /**
     * Google Gemini API (v1beta/models/{model}:generateContent)
     * Maximizes Gemini Implicit Context Caching by placing static `systemInstruction` and `cacheableContext`
     * at the exact beginning (prefix) of `contents`, and tracks `usageMetadata.cachedContentTokenCount`.
     */
    private async callGemini(
        model: string,
        systemPrompt: string,
        userPrompt: string,
        history: ChatTurn[],
        options: LlmCallOptions
    ): Promise<string> {
        const { key } = await this.resolveApiKey('gemini');
        if (!key) {
            throw new Error(
                'Gemini APIキーが未設定です。サイドバー上部の「🔑 API・LLM」から Gemini API Key を登録してください。'
            );
        }
        const cfg = vscode.workspace.getConfiguration('egmStudio');
        const endpoint = (cfg.get<string>('endpoints.gemini') || 'https://generativelanguage.googleapis.com').replace(
            /\/+$/,
            ''
        );
        const cleanModel = model.replace(/^models\//, '').trim() || 'gemini-3.8-flash';
        const url = `${endpoint}/v1beta/models/${encodeURIComponent(cleanModel)}:generateContent`;

        const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
        for (const turn of history.slice(-6)) {
            contents.push({
                role: turn.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: turn.content }]
            });
        }

        // Prefix-first ordering for Gemini Implicit Caching: static cacheableContext part first, dynamic userPrompt part second
        const userParts: Array<{ text: string }> = [];
        if (options.cacheableContext && options.cacheableContext.trim()) {
            userParts.push({ text: options.cacheableContext });
        }
        userParts.push({ text: userPrompt });

        contents.push({
            role: 'user',
            parts: userParts
        });

        const generationConfig: Record<string, unknown> = {
            temperature: options.temperature ?? 0.25,
            maxOutputTokens: options.maxTokens ?? 16384
        };

        if (options.jsonMode && !options.useNativeWebSearch) {
            generationConfig.responseMimeType = 'application/json';
        }

        const body: Record<string, unknown> = {
            systemInstruction: {
                parts: [{ text: systemPrompt }]
            },
            contents,
            generationConfig
        };

        if (options.useNativeWebSearch && !options.jsonMode) {
            body.tools = [{ google_search: {} }];
        }

        const signal = this.createRequestSignal(180000);
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': key
            },
            body: JSON.stringify(body),
            signal
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Gemini API Error (${res.status}): ${errText.slice(0, 350)}`);
        }

        const data = (await res.json()) as {
            candidates?: Array<{
                content?: { parts?: Array<{ text?: string }> };
            }>;
            usageMetadata?: {
                promptTokenCount?: number;
                candidatesTokenCount?: number;
                cachedContentTokenCount?: number;
            };
        };
        const text =
            data.candidates?.[0]?.content?.parts
                ?.map((p) => p.text || '')
                .join('')
                .trim() || '';
        if (!text) {
            throw new Error('Gemini API returned an empty response.');
        }

        const inputTok =
            data.usageMetadata?.promptTokenCount ??
            this.estimateTokens(systemPrompt + (options.cacheableContext || '') + userPrompt);
        const cachedTok = data.usageMetadata?.cachedContentTokenCount ?? 0;
        const outputTok = data.usageMetadata?.candidatesTokenCount ?? this.estimateTokens(text);
        await this.recordUsageTelemetry({
            provider: 'gemini',
            model: cleanModel,
            source: cachedTok > 0 ? 'provider-cache' : 'fresh',
            inputTokens: inputTok,
            cachedTokens: cachedTok,
            outputTokens: outputTok
        });

        return text;
    }

    /**
     * Anthropic Claude API (v1/messages)
     * Uses official Anthropic Prompt Caching (`cache_control: { type: 'ephemeral' }`) on system prompt
     * and `cacheableContext` blocks for up to 90% input token discount on `cache_read_input_tokens`.
     * Automatically falls back if a custom proxy or model rejects `cache_control` or `temperature`.
     */
    private async callClaude(
        model: string,
        systemPrompt: string,
        userPrompt: string,
        history: ChatTurn[],
        options: LlmCallOptions
    ): Promise<string> {
        const { key } = await this.resolveApiKey('claude');
        if (!key) {
            throw new Error(
                'Claude APIキーが未設定です。サイドバー上部の「🔑 API・LLM」から Anthropic Claude API Key を登録してください。'
            );
        }
        const cfg = vscode.workspace.getConfiguration('egmStudio');
        const endpoint = (cfg.get<string>('endpoints.claude') || 'https://api.anthropic.com').replace(/\/+$/, '');
        const url = `${endpoint}/v1/messages`;

        const buildMessages = (useCacheControl: boolean) => {
            const msgs: Array<{
                role: 'user' | 'assistant';
                content: string | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>;
            }> = [];
            for (const turn of history.slice(-6)) {
                if (turn.content.trim()) {
                    msgs.push({
                        role: turn.role,
                        content: turn.content
                    });
                }
            }
            if (useCacheControl && options.cacheableContext && options.cacheableContext.trim()) {
                msgs.push({
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: options.cacheableContext,
                            cache_control: { type: 'ephemeral' }
                        },
                        {
                            type: 'text',
                            text: userPrompt
                        }
                    ]
                });
            } else {
                const combined =
                    options.cacheableContext && options.cacheableContext.trim()
                        ? `${options.cacheableContext}\n\n${userPrompt}`
                        : userPrompt;
                msgs.push({
                    role: 'user',
                    content: combined
                });
            }
            return msgs;
        };

        const targetModel = model.trim() || 'claude-sonnet-5-5';
        const signal = this.createRequestSignal(180000);
        const sendReq = async (includeTemp: boolean, useCacheControl: boolean) => {
            const payload: Record<string, unknown> = {
                model: targetModel,
                max_tokens: options.maxTokens ?? 16384,
                system: useCacheControl
                    ? [
                          {
                              type: 'text',
                              text: systemPrompt,
                              cache_control: { type: 'ephemeral' }
                          }
                      ]
                    : systemPrompt,
                messages: buildMessages(useCacheControl)
            };
            if (includeTemp && options.temperature !== undefined) {
                payload.temperature = options.temperature;
            }
            return fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': key,
                    'anthropic-version': '2023-06-01',
                    'anthropic-beta': 'prompt-caching-2024-07-31'
                },
                body: JSON.stringify(payload),
                signal
            });
        };

        let res = await sendReq(true, true);
        if (!res.ok && res.status === 400) {
            res = await sendReq(false, true);
        }
        if (!res.ok && res.status === 400) {
            res = await sendReq(false, false);
        }

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Claude API Error (${res.status}): ${errText.slice(0, 350)}`);
        }

        const data = (await res.json()) as {
            content?: Array<{ type?: string; text?: string }>;
            usage?: {
                input_tokens?: number;
                cache_creation_input_tokens?: number;
                cache_read_input_tokens?: number;
                output_tokens?: number;
            };
        };
        const text = (data.content || [])
            .filter((block) => block.type === 'text')
            .map((block) => block.text || '')
            .join('')
            .trim();
        if (!text) {
            throw new Error('Claude API returned an empty response.');
        }

        const cachedRead = data.usage?.cache_read_input_tokens ?? 0;
        const cacheCreated = data.usage?.cache_creation_input_tokens ?? 0;
        const uncachedInput = data.usage?.input_tokens ?? 0;
        const totalInput =
            uncachedInput + cachedRead + cacheCreated ||
            this.estimateTokens(systemPrompt + (options.cacheableContext || '') + userPrompt);
        const outputTok = data.usage?.output_tokens ?? this.estimateTokens(text);

        await this.recordUsageTelemetry({
            provider: 'claude',
            model: targetModel,
            source: cachedRead > 0 ? 'provider-cache' : 'fresh',
            inputTokens: totalInput,
            cachedTokens: cachedRead,
            outputTokens: outputTok
        });

        return text;
    }

    /**
     * OpenAI & xAI Grok API (/chat/completions)
     * - OpenAI: Prefix-first static message placement + `prompt_cache_key` for sticky server routing
     * - xAI Grok: Prefix-first static message placement + `x-grok-conv-id` header for sticky server KV cache routing
     * - Tracks `usage.prompt_tokens_details.cached_tokens`
     */
    private async callOpenAiCompatible(
        provider: 'openai' | 'grok',
        model: string,
        systemPrompt: string,
        userPrompt: string,
        history: ChatTurn[],
        options: LlmCallOptions
    ): Promise<string> {
        const { key } = await this.resolveApiKey(provider);
        const label = provider === 'grok' ? 'xAI Grok' : 'OpenAI';
        if (!key) {
            throw new Error(
                `${label} APIキーが未設定です。サイドバー上部の「🔑 API・LLM」から ${label} API Key を登録してください。`
            );
        }

        const cfg = vscode.workspace.getConfiguration('egmStudio');
        const defaultBase = provider === 'grok' ? 'https://api.x.ai/v1' : 'https://api.openai.com/v1';
        const endpoint = (cfg.get<string>(`endpoints.${provider}`) || defaultBase).replace(/\/+$/, '');
        const url = `${endpoint}/chat/completions`;

        // Place static system prompt and static cacheableContext at the very front of `messages`
        // so the 1,024+ token prefix remains byte-identical across retries and iterative steps!
        const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
            { role: 'system', content: systemPrompt }
        ];
        for (const turn of history.slice(-6)) {
            messages.push({
                role: turn.role,
                content: turn.content
            });
        }
        if (options.cacheableContext && options.cacheableContext.trim()) {
            messages.push({
                role: 'user',
                content: `${options.cacheableContext}\n\n${userPrompt}`
            });
        } else {
            messages.push({
                role: 'user',
                content: userPrompt
            });
        }

        const targetModel = model.trim() || this.getDefaultModelForProvider(provider);
        const sessionKey = options.sessionKey || this.getStickySessionKey('elephant');

        const signal = this.createRequestSignal(180000);
        const sendReq = async (includeTemp: boolean, includeCacheKey: boolean) => {
            const payload: Record<string, unknown> = {
                model: targetModel,
                messages
            };
            if (includeTemp && options.temperature !== undefined) {
                payload.temperature = options.temperature;
            }
            if (provider === 'openai' && includeCacheKey && sessionKey) {
                payload.prompt_cache_key = sessionKey;
            }
            if (provider === 'grok' && options.useNativeWebSearch) {
                payload.search_parameters = { mode: 'auto' };
            }
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${key}`
            };
            // Official xAI Grok sticky routing header for per-server prompt cache hits
            if (provider === 'grok' && sessionKey) {
                headers['x-grok-conv-id'] = sessionKey;
            }
            return fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
                signal
            });
        };

        let res = await sendReq(true, true);
        if (!res.ok && res.status === 400) {
            res = await sendReq(false, true);
        }
        if (!res.ok && res.status === 400) {
            res = await sendReq(false, false);
        }

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`${label} API Error (${res.status}): ${errText.slice(0, 350)}`);
        }

        const data = (await res.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
            usage?: {
                prompt_tokens?: number;
                completion_tokens?: number;
                prompt_tokens_details?: {
                    cached_tokens?: number;
                };
            };
        };
        const text = data.choices?.[0]?.message?.content?.trim() || '';
        if (!text) {
            throw new Error(`${label} API returned an empty response.`);
        }

        const inputTok =
            data.usage?.prompt_tokens ??
            this.estimateTokens(systemPrompt + (options.cacheableContext || '') + userPrompt);
        const cachedTok = data.usage?.prompt_tokens_details?.cached_tokens ?? 0;
        const outputTok = data.usage?.completion_tokens ?? this.estimateTokens(text);

        await this.recordUsageTelemetry({
            provider,
            model: targetModel,
            source: cachedTok > 0 ? 'provider-cache' : 'fresh',
            inputTokens: inputTok,
            cachedTokens: cachedTok,
            outputTokens: outputTok
        });

        return text;
    }

    /**
     * Local Ollama API (/api/chat with fallback to /api/generate)
     * Uses `keep_alive: "30m"` so Ollama keeps model weights and `llama.cpp` KV cache resident in VRAM,
     * and reads `prompt_eval_cached_count` telemetry.
     */
    private async callOllama(
        model: string,
        systemPrompt: string,
        userPrompt: string,
        history: ChatTurn[],
        options: LlmCallOptions
    ): Promise<string> {
        const cfg = vscode.workspace.getConfiguration('egmStudio');
        const endpoint = (cfg.get<string>('endpoints.ollama') || 'http://localhost:11434').replace(/\/+$/, '');
        const targetModel = model.trim() || 'gemma4:latest';
        const combinedUserPrompt =
            options.cacheableContext && options.cacheableContext.trim()
                ? `${options.cacheableContext}\n\n${userPrompt}`
                : userPrompt;

        const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
            { role: 'system', content: systemPrompt }
        ];
        for (const turn of history.slice(-6)) {
            messages.push({
                role: turn.role,
                content: turn.content
            });
        }
        messages.push({
            role: 'user',
            content: combinedUserPrompt
        });

        try {
            const chatRes = await fetch(`${endpoint}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: targetModel,
                    messages,
                    stream: false,
                    keep_alive: '30m',
                    ...(options.jsonMode ? { format: 'json' } : {}),
                    options: {
                        temperature: options.temperature ?? 0.25
                    }
                })
            });

            if (chatRes.ok) {
                const data = (await chatRes.json()) as {
                    message?: { content?: string };
                    prompt_eval_count?: number;
                    prompt_eval_cached_count?: number;
                    eval_count?: number;
                };
                const content = data.message?.content?.trim();
                if (content) {
                    const inputTok =
                        data.prompt_eval_count ?? this.estimateTokens(systemPrompt + combinedUserPrompt);
                    const cachedTok = data.prompt_eval_cached_count ?? 0;
                    const outputTok = data.eval_count ?? this.estimateTokens(content);
                    await this.recordUsageTelemetry({
                        provider: 'ollama',
                        model: targetModel,
                        source: cachedTok > 0 ? 'provider-cache' : 'fresh',
                        inputTokens: inputTok,
                        cachedTokens: cachedTok,
                        outputTokens: outputTok
                    });
                    return content;
                }
            }
        } catch {
            // Fallback to /api/generate below
        }

        const genRes = await fetch(`${endpoint}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: targetModel,
                system: systemPrompt,
                prompt: combinedUserPrompt,
                stream: false,
                keep_alive: '30m',
                ...(options.jsonMode ? { format: 'json' } : {})
            })
        });

        if (!genRes.ok) {
            const errText = await genRes.text();
            throw new Error(`Ollama API Error (${genRes.status}): ${errText.slice(0, 300)}`);
        }

        const genData = (await genRes.json()) as {
            response?: string;
            prompt_eval_count?: number;
            prompt_eval_cached_count?: number;
            eval_count?: number;
        };
        const text = genData.response?.trim() || '';
        if (!text) {
            throw new Error('Ollama returned an empty response.');
        }

        const inputTok = genData.prompt_eval_count ?? this.estimateTokens(systemPrompt + combinedUserPrompt);
        const cachedTok = genData.prompt_eval_cached_count ?? 0;
        const outputTok = genData.eval_count ?? this.estimateTokens(text);
        await this.recordUsageTelemetry({
            provider: 'ollama',
            model: targetModel,
            source: cachedTok > 0 ? 'provider-cache' : 'fresh',
            inputTokens: inputTok,
            cachedTokens: cachedTok,
            outputTokens: outputTok
        });

        return text;
    }
}

/**
 * Extracts a JSON object or array from LLM text output, tolerating Markdown code fences
 */
export function extractJsonFromText<T>(rawText: string): T | null {
    const trimmed = rawText.trim();
    const candidates: string[] = [trimmed];

    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch && fenceMatch[1]) {
        candidates.unshift(fenceMatch[1].trim());
    }

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
    }

    const firstBracket = trimmed.indexOf('[');
    const lastBracket = trimmed.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
        candidates.push(trimmed.slice(firstBracket, lastBracket + 1));
    }

    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate) as T;
        } catch {
            // Try next candidate
        }
    }
    return null;
}
