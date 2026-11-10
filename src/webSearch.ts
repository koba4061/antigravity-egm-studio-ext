import * as vscode from 'vscode';

export interface WebSearchResultItem {
    title: string;
    url: string;
    snippet: string;
    source: string;
    fetchedAt: string;
}

export class WebSearchService {
    /**
     * Executes web search across available sources:
     * 1. Direct URL fetch if query contains http(s):// URLs
     * 2. Tavily API (if configured in settings)
     * 3. Built-in free multi-source search (DuckDuckGo Lite/HTML + GitHub API + Wikipedia API)
     */
    public async search(query: string, maxResults = 5): Promise<WebSearchResultItem[]> {
        const trimmed = query.trim();
        if (!trimmed) {
            return [];
        }

        const results: WebSearchResultItem[] = [];
        const now = new Date().toISOString();

        // 1. Check if query contains direct URLs to fetch
        const urlMatches = trimmed.match(/https?:\/\/[^\s"'<>]+/g);
        if (urlMatches && urlMatches.length > 0) {
            for (const url of urlMatches.slice(0, 3)) {
                const pageItem = await this.fetchUrlContent(url, now);
                if (pageItem) {
                    results.push(pageItem);
                }
            }
        }

        // Clean query without raw URLs if there is remaining text
        const textQuery = trimmed.replace(/https?:\/\/[^\s"'<>]+/g, '').trim() || trimmed;

        // 2. Check Tavily API if configured
        const cfg = vscode.workspace.getConfiguration('egmStudio');
        const tavilyKey = (cfg.get<string>('webSearch.tavilyApiKey') || process.env.TAVILY_API_KEY || '').trim();
        if (tavilyKey && results.length < maxResults) {
            try {
                const tavilyItems = await this.searchTavily(textQuery, tavilyKey, maxResults - results.length, now);
                results.push(...tavilyItems);
            } catch (err) {
                console.warn('[EGM WebSearch] Tavily search failed, falling back to built-in search:', err);
            }
        }

        // 3. Built-in free search: DuckDuckGo + GitHub + Wikipedia in parallel
        if (results.length < maxResults) {
            const needed = maxResults - results.length;
            const [ddgRes, ghRes, wikiRes] = await Promise.allSettled([
                this.searchDuckDuckGo(textQuery, needed, now),
                this.searchGitHubRepos(textQuery, 2, now),
                this.searchWikipedia(textQuery, 2, now),
            ]);

            if (ddgRes.status === 'fulfilled') {
                results.push(...ddgRes.value);
            }
            if (ghRes.status === 'fulfilled') {
                results.push(...ghRes.value);
            }
            if (wikiRes.status === 'fulfilled') {
                results.push(...wikiRes.value);
            }
        }

        // Deduplicate by URL
        const seen = new Set<string>();
        const deduped: WebSearchResultItem[] = [];
        for (const item of results) {
            if (!item.url || seen.has(item.url)) {
                continue;
            }
            seen.add(item.url);
            deduped.push(item);
            if (deduped.length >= maxResults) {
                break;
            }
        }

        return deduped;
    }

    /**
     * Fetches and extracts readable text from a direct URL
     */
    private async fetchUrlContent(url: string, fetchedAt: string): Promise<WebSearchResultItem | null> {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 8000);
            const res = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 EGMStudio/0.1',
                    'Accept': 'text/html,application/xhtml+xml,text/plain,application/json,*/*'
                }
            });
            clearTimeout(timer);
            if (!res.ok) {
                return null;
            }
            const raw = await res.text();
            const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            const title = titleMatch ? this.decodeHtmlEntities(titleMatch[1].trim()) : url;
            const cleaned = this.stripHtmlToReadableText(raw).slice(0, 1800);
            return {
                title: title || url,
                url,
                snippet: cleaned || '(No text content extracted)',
                source: 'Direct URL',
                fetchedAt
            };
        } catch {
            return null;
        }
    }

    /**
     * Optional Tavily Search API
     */
    private async searchTavily(
        query: string,
        apiKey: string,
        maxResults: number,
        fetchedAt: string
    ): Promise<WebSearchResultItem[]> {
        const res = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: apiKey,
                query,
                max_results: maxResults,
                include_answer: true
            })
        });
        if (!res.ok) {
            throw new Error(`Tavily HTTP ${res.status}`);
        }
        const data = (await res.json()) as {
            answer?: string;
            results?: Array<{ title?: string; url?: string; content?: string }>;
        };
        const items: WebSearchResultItem[] = [];
        if (data.answer) {
            items.push({
                title: `Tavily Summary: ${query}`,
                url: `https://tavily.com/?q=${encodeURIComponent(query)}`,
                snippet: data.answer,
                source: 'Tavily AI Summary',
                fetchedAt
            });
        }
        for (const r of data.results || []) {
            if (r.url) {
                items.push({
                    title: r.title || r.url,
                    url: r.url,
                    snippet: (r.content || '').slice(0, 600),
                    source: 'Tavily Search',
                    fetchedAt
                });
            }
        }
        return items;
    }

    /**
     * Built-in DuckDuckGo HTML/Instant Answer Search (No API Key Required)
     */
    private async searchDuckDuckGo(
        query: string,
        maxResults: number,
        fetchedAt: string
    ): Promise<WebSearchResultItem[]> {
        const items: WebSearchResultItem[] = [];

        // 1. Try DuckDuckGo Instant Answer JSON API first
        try {
            const iaUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
            const iaRes = await fetch(iaUrl, {
                headers: { 'User-Agent': 'EGMStudio-VSCode-Extension/0.1' }
            });
            if (iaRes.ok) {
                const iaData = (await iaRes.json()) as {
                    Heading?: string;
                    AbstractText?: string;
                    AbstractURL?: string;
                    RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
                };
                if (iaData.AbstractText && iaData.AbstractURL) {
                    items.push({
                        title: iaData.Heading || query,
                        url: iaData.AbstractURL,
                        snippet: iaData.AbstractText,
                        source: 'DuckDuckGo Instant',
                        fetchedAt
                    });
                }
                for (const topic of (iaData.RelatedTopics || []).slice(0, 3)) {
                    if (topic.Text && topic.FirstURL) {
                        items.push({
                            title: topic.Text.split(' - ')[0] || query,
                            url: topic.FirstURL,
                            snippet: topic.Text,
                            source: 'DuckDuckGo Related',
                            fetchedAt
                        });
                    }
                }
            }
        } catch {
            // Ignore and continue to HTML search
        }

        // 2. DuckDuckGo HTML Search
        try {
            const htmlUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
            const res = await fetch(htmlUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8'
                }
            });
            if (res.ok) {
                const html = await res.text();
                const blockRegex = /<div[^>]*class="[^"]*result__body[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
                let match: RegExpExecArray | null;
                while ((match = blockRegex.exec(html)) !== null && items.length < maxResults) {
                    const block = match[1];
                    const linkMatch = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
                    const snippetMatch = block.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
                    if (linkMatch) {
                        let rawUrl = linkMatch[1];
                        const uddgMatch = rawUrl.match(/[?&]uddg=([^&]+)/);
                        if (uddgMatch) {
                            rawUrl = decodeURIComponent(uddgMatch[1]);
                        }
                        const title = this.stripHtmlToReadableText(linkMatch[2]);
                        const snippet = snippetMatch ? this.stripHtmlToReadableText(snippetMatch[1]) : '';
                        if (rawUrl.startsWith('http') && title) {
                            items.push({
                                title,
                                url: rawUrl,
                                snippet: snippet.slice(0, 500),
                                source: 'DuckDuckGo Web',
                                fetchedAt
                            });
                        }
                    }
                }
            }
        } catch {
            // Ignore HTML scrape errors
        }

        return items.slice(0, maxResults);
    }

    /**
     * Built-in GitHub Repository / Documentation Search (No API Key Required)
     */
    private async searchGitHubRepos(
        query: string,
        maxResults: number,
        fetchedAt: string
    ): Promise<WebSearchResultItem[]> {
        try {
            const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${maxResults}`;
            const res = await fetch(url, {
                headers: {
                    'Accept': 'application/vnd.github+json',
                    'User-Agent': 'EGMStudio-VSCode-Extension/0.1'
                }
            });
            if (!res.ok) {
                return [];
            }
            const data = (await res.json()) as {
                items?: Array<{
                    full_name?: string;
                    html_url?: string;
                    description?: string;
                    stargazers_count?: number;
                    language?: string;
                }>;
            };
            return (data.items || [])
                .filter((r) => Boolean(r.html_url && r.full_name))
                .slice(0, maxResults)
                .map((r) => ({
                    title: `GitHub: ${r.full_name} (★${r.stargazers_count ?? 0}${r.language ? ` / ${r.language}` : ''})`,
                    url: r.html_url!,
                    snippet: r.description || 'GitHub repository reference',
                    source: 'GitHub',
                    fetchedAt
                }));
        } catch {
            return [];
        }
    }

    /**
     * Built-in Wikipedia Search (ja & en)
     */
    private async searchWikipedia(
        query: string,
        maxResults: number,
        fetchedAt: string
    ): Promise<WebSearchResultItem[]> {
        try {
            const isJapanese = /[\u3040-\u30ff\u4e00-\u9faf]/.test(query);
            const lang = isJapanese ? 'ja' : 'en';
            const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json&srlimit=${maxResults}`;
            const res = await fetch(url, {
                headers: { 'User-Agent': 'EGMStudio-VSCode-Extension/0.1' }
            });
            if (!res.ok) {
                return [];
            }
            const data = (await res.json()) as {
                query?: {
                    search?: Array<{ title?: string; snippet?: string; pageid?: number }>;
                };
            };
            return (data.query?.search || []).slice(0, maxResults).map((s) => ({
                title: `Wikipedia: ${s.title}`,
                url: `https://${lang}.wikipedia.org/?curid=${s.pageid}`,
                snippet: this.stripHtmlToReadableText(s.snippet || ''),
                source: `Wikipedia (${lang})`,
                fetchedAt
            }));
        } catch {
            return [];
        }
    }

    public formatResultsAsMarkdown(results: WebSearchResultItem[]): string {
        if (!results || results.length === 0) {
            return '';
        }
        const lines = ['### 🌐 Web調査・技術リファレンス結果 (Web Research Context)'];
        for (const [idx, item] of results.entries()) {
            lines.push(`${idx + 1}. **[${item.title}](${item.url})** (${item.source})`);
            if (item.snippet) {
                lines.push(`   > ${item.snippet.replace(/\r?\n/g, ' ')}`);
            }
        }
        return lines.join('\n');
    }

    private stripHtmlToReadableText(html: string): string {
        const withoutScripts = html
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
        const withoutTags = withoutScripts.replace(/<[^>]+>/g, ' ');
        return this.decodeHtmlEntities(withoutTags).replace(/\s+/g, ' ').trim();
    }

    private decodeHtmlEntities(text: string): string {
        return text
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, ' ');
    }
}

