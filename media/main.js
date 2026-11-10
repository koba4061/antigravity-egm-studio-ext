// EGM Studio v0.2.0 Webview Frontend Logic (Bilingual JA / EN + Authentic EGM Workflow)
(function () {
    const vscode = acquireVsCodeApi();

    let currentLang = 'en';
    let lastWorkspaceStatus = null;
    let lastProviderSummary = null;

    const MODEL_PRESETS = {
        gemini: ['gemini-4-argon', 'gemini-3.1-pro-preview', 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'],
        claude: ['claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
        openai: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-5.5-pro', 'gpt-5.5', 'gpt-5.4'],
        grok: ['grok-4.7', 'grok-420-reasoning', 'grok-4'],
        ollama: ['gemma4:latest', 'deepseek-r1:latest', 'qwen3-coder:latest', 'gemma3:latest']
    };

    const I18N = {
        ja: {
            appTitle: 'EleGold Studio',
            appSubtitle: 'エレゴールド 仕様駆動設計 (SDD)',
            btnApiConfig: '🔑 API・LLM',
            roleElephant: '設計(象):',
            roleGoldfish: '監査(金魚):',
            stepNav1: '壁打ち',
            stepNav2: '設計書',
            stepNav3: '金魚監査',
            stepNav4: '反映',
            stepNav5: '承認確定',
            btnReset: '履歴リセット',
            drawerTitle: '🔑 LLMプロバイダー & APIキー設定',
            btnClose: '✕ 閉じる',
            drawerDesc: 'Gemini / Claude / OpenAI / Grok / Ollama を利用できます。APIキーはOSの暗号化領域（SecretStorage）に安全に保存されます。',
            lblSelectElephant: '🐘 Elephant（文脈保持・設計書作成）プロバイダー',
            lblSelectElephantModel: '🐘 Elephant モデル名（クリック選択または直接入力）',
            btnFetchModels: '🔄 APIから最新一覧を取得',
            lblSelectGoldfish: '🐠 Goldfish（ゼロ文脈・初見レビュアー）プロバイダー',
            badgeCrossLlm: '異種LLMクロス監査可',
            optSameProvider: 'Elephantと同じプロバイダー（文脈は完全遮断）',
            phGoldfishModel: 'Goldfish用モデル名（空欄なら自動選択）',
            btnSaveConfig: '💾 モデル設定を保存',
            btnTestConn: '🔌 接続テスト',
            hdrApiKeys: '各クラウドLLMのAPIキー登録 (SecretStorage)',
            btnSaveKey: '保存',
            badgeWeb: '🌐 Web調査',
            hdrGuide: '🧭 ナビゲーション・ガイド（現在地と次の操作）',
            btnOpenFolder: '📂 フォルダを開く',
            btnRevealSpecFolder: '📁 保存先を開く',
            btnQuickKey: '🔑 APIキーを設定',
            lblNextAction: '👉 次にやること:',
            badgeHere: '👈 いまここ',
            lblTemplates: '💡 記入例を挿入:',
            tplGreenfield: '🌱 新規アプリ(0→1)',
            tplFeature: '🧩 既存プロジェクトへの機能追加',
            tplApi: '🔌 API・バックエンド設計',
            hintClarifyReply: '✍️ 選択肢をクリックして回答を選ぶと、上の入力欄に回答が自動反映されます。そのまま「② 7レンズ分析ブリーフを生成」を押してください！',
            hdrStressTest: '🔍 初期ストレスチェック（隠れた前提・リスクの指摘）',
            phWizardCustom: '✍️ その他・自由記述で補足する場合はこちらに入力...',
            btnWizardPrev: '◀ 前の質問',
            btnWizardNext: '次の質問 ▶',
            btnWizardApply: '✨ 回答を入力欄に反映済',
            lblBriefReady: '✅ concepts_brief.md 生成完了！',
            btnOpenBrief: '📄 エディタで開く',
            btnMdPreview: '👁️ 見やすく表示',
            sumBriefPreview: '✏️ ここで中身を確認・直接編集する（開閉可）',
            lblDraftReady: '✅ design_draft.md 生成完了！',
            btnOpenDraft: '📝 エディタで開く',
            sumDraftPreview: '✏️ ここで設計書の中身を確認・直接編集する（開閉可）',
            hintInlineEdit: '💡 直接書き換えて「💾 編集を保存」を押すと即座にファイルへ反映されます',
            btnSaveInline: '💾 編集を保存',
            prereqStep2: '🔒 先に Step 1 で concepts_brief.md を作成すると、このステップが解放されます。',
            prereqStep3: '🔒 先に Step 2 で design_draft.md を作成すると、金魚レビューを実行できます。',
            prereqStep4: '🔒 Step 3 で金魚レビューを実行し、反映したい指摘にチェックを入れると実行できます。',
            prereqStep5: '🔒 Step 2〜4 で design_draft.md を完成させると、最終承認とAI実装出力が可能になります。',
            btnRollback1: '⏪ Step 1 からやり直す',
            btnRollback2: '⏪ Step 2 からやり直す',
            btnRollback3: '⏪ レビューをリセット',
            staleStep2: '⚠️ Step 1 の要件ブリーフが更新されました。下の「🔄 既存の設計書をベースに差分更新」または「📝 新規に書き直す」を選択してください。',
            btnStep2Update: '🔄 既存の設計書をベースに差分更新 (Update Existing Draft)',
            hdrWebSearch: '🌐 Web検索・最新技術ドキュメント調査（自動ON）',
            chkAutoWeb: '設計時に自動でWeb検索（DuckDuckGo / GitHub / Wikipedia）を実行し設計書に反映',
            chkNativeWeb: 'Gemini Search Grounding / Grok Live Search ネイティブ検索も併用',
            phWebSearch: '特定の技術名・API名・または https://... URLを直接調査',
            btnRunWeb: '🔍 検索・取得',
            lblWebRef: '📚 収集済みWebリファレンス',
            btnClearWeb: 'クリア',
            hdrStep1: '🧠 アイデア壁打ち & 7レンズ要件定義',
            descStep1: 'まだコードが1行もない「まっさらな状態（0→1開発）」でも、既存プロジェクトへの機能追加でも使えます。まずは作りたいものを書いてみましょう。',
            phStep1: '【例】何を作りたいですか？（目的・主な機能・使いたい言語やフレームワークなど、思いつく範囲で自由に書いてください）',
            btnStep1Clarify: '① ❓ まず前提の深掘り質問を受ける（推奨・Clarify）',
            btnStep1Refine: '💬 追加要望で既存ブリーフを更新 (Refine Brief)',
            btnStep1Create: '② 🧠 7レンズ分析ブリーフを生成 (concepts_brief.md)',
            hdrClarifyBox: '🐘 Elephantからの深掘り質問 & 初期ストレスチェック',
            hdrStep2: '📝 詳細設計仕様書の作成 (Draft Spec)',
            descStep2: 'concepts_brief.md をもとに、CUJ（Given/When/Then）、Mermaidデータフロー図、代替案の棄却理由、異常系仕様、変更対象ファイル＆厳密なインターフェース定義、テスト計画を備えた全9章の設計仕様書 design_draft.md を書き起こします。',
            phStep2Extra: '追加のアーキテクチャ制約・使用ライブラリ指定など（任意）',
            btnStep2Draft: '📝 設計仕様書を書き起こす (Generate Design Spec)',
            hdrStep3: '🔍 金魚による初見ゼロ文脈レビュー',
            noticeIsolation: '🛡️ <strong>文脈完全遮断 (Zero-Context Isolation)</strong>: Elephantとの対話履歴（<code>elephant_context.json</code>）や <code>concepts_brief.md</code> を完全遮断し、初見の冷徹な監査役として <code>design_draft.md</code> のみをストレスチェックします。',
            lensComprehension: '[Comprehension] 初見理解テスト・曖昧表現の排除（自己完結しているか）',
            lensEdge: '[Design Critic] 前提の甘さ・エッジケース（重複実行・競合・切断・境界値）',
            lensConsistency: '[Codebase Fit] 既存コード・インターフェースとの整合性・YAGNIチェック',
            lensSecurity: '[Security & SRE] セキュリティ・障害耐性・ロールバック安全性',
            lensReadiness: '[Readiness] 実装準備完了度（初見エンジニアが推測ゼロで実装できるか）',
            btnStep3Review: '🐠 金魚レビューを実行 (Run Fresh Goldfish Review)',
            lblReadinessScore: '📊 設計完成度スコア:',
            hdrParaphrase: '🐠 金魚の初見理解テスト (Stage 6 Comprehension Paraphrase)',
            btnSelectImportant: '🚨 重要のみ選択',
            btnSelectAll: '全選択',
            btnDeselectAll: '全解除',
            emptyReviews: 'まだ金魚レビューは実行されていません。',
            hdrStep4: '✨ 指摘の反映・設計書ブラッシュアップ',
            descStep4: 'チェックを入れた金魚の指摘事項を「象（Elephant）」に渡し、design_draft.md の各章と第9章「設計判断・レビュー履歴」をアップデートします。',
            phStep4Comment: '設計者（あなた）からの補足判断・修正指示があれば入力（任意）',
            chkDiffView: '更新後に変更前後を VS Code Diff ビューで比較表示する',
            btnStep4Resolve: '✨ 選択した指摘を設計書に反映 (Resolve Selected)',
            badgeReviewLoop: '🔄 反復ブラッシュアップ・ループ (Step 3 ⇄ Step 4)',
            descReviewLoop: '🐠 <strong>Step 3（金魚が初見で穴を指摘）</strong> ➔ 🐘 <strong>Step 4（象が設計書を修正）</strong> を1〜2回繰り返して致命的な穴（Critical / High）がなくなったら、<strong>Step 5（正式承認）</strong>へ進みます。',
            hdrLoopFork: '✅ 指摘の反映が完了しました！次のアクションを選んでください：',
            descLoopFork: '修正後の設計書にまだ抜け漏れがないか<strong>もう一度「金魚レビュー」で確認（ループ）</strong>するか、問題なければ<strong>「Step 5 最終承認」へ進む</strong>かを選べます。',
            btnLoopRerun: '🔄 修正後の設計書で金魚レビューを再実行 (Step 3へ戻る)',
            btnLoopProceed: '🚀 完璧なので最終承認へ進む (Step 5へ)',
            hdrStep5: '🚀 設計書の最終承認 & 仕様駆動開発連携',
            descStep5: 'ガチガチに固まった設計仕様書に Status: Approved と金魚レビュー通過記録を刻印し、専用フォルダ内の EleGold_Specs/approved_specs/NNN-[feature-name].md および SITEMAP.md に正式登録します。',
            lblFeatureSlug: '設計書ファイル名 (Feature Slug)',
            btnStep5Approve: '✅ 設計書を承認して確定保存 (Approve & Archive Spec)',
            sumSddTools: '🛠️ 承認後の実装連携・ドリフト監査ツール (SDD Post-Design Tools)',
            btnCopyPrompt: '📋 コーディングAI用指示をコピー',
            btnImplement: '💻 この設計書からコード生成',
            btnDrift: '⚖️ 仕様ドリフト監査を実行 (/egm-drift-report)',
            hdrApprovedSpecs: '📁 承認済み設計仕様書アーカイブ (EleGold_Specs/approved_specs/)',
            stCreated: '作成済 ✓',
            stMissing: '未作成',
            stApproved: '承認済 ✅',
            stEditing: '編集中 ✏️',
            keyConfigured: '設定済:',
            keyNotSet: '未設定',
            resolvedBadge: '反映済 ✓',
            suggestionPrefix: '💡 仕様改善案: ',
            noWebData: '収集済みのWeb調査データはありません。',
            btnCancelLoading: '⏹️ 中断',
            btnOpenMd: '📄 MDを開く',
            btnOpenJson: '📋 JSON',
            btnOpenWebJson: '📄 JSONを開く',
            btnOpenDiff: '🔍 前後Diff比較',
            btnOpenReport: '📄 レポートを開く',
            btnOpenSitemap: '🗺️ SITEMAP.md',
            lblReviewReportReady: '📄 金魚レビュー報告書 (goldfish_review_report.md)',
            lblStep4ArtifactReady: '✅ 反映済み設計仕様書 (design_draft.md)',
            lblImplGuideReady: '💻 実装ガイド (implementation_output.md)',
            lblDriftReportReady: '⚖️ ドリフト監査レポート (drift_report.md)',
            prereqStep5Sdd: '🔒 先に上の「✅ 設計書を承認して確定保存」を実行し、仕様書を正式承認 (Approved) すると以下の実装・ドリフト監査ツールが解放されます。'
        },
        en: {
            appTitle: 'EleGold Studio',
            appSubtitle: 'Elephant-Goldfish Spec-Driven Design',
            btnApiConfig: '🔑 API & LLM',
            roleElephant: 'Elephant:',
            roleGoldfish: 'Goldfish:',
            stepNav1: 'Brainstorm',
            stepNav2: 'Draft Spec',
            stepNav3: 'Goldfish',
            stepNav4: 'Resolve',
            stepNav5: 'Approve',
            btnReset: 'Reset History',
            drawerTitle: '🔑 LLM Provider & API Keys',
            btnClose: '✕ Close',
            drawerDesc: 'Switch between Gemini, Claude, OpenAI, Grok, and Ollama. API keys are encrypted in OS SecretStorage.',
            lblSelectElephant: '🐘 Elephant (Deep-Context Architect) Provider',
            lblSelectElephantModel: '🐘 Elephant Model ID (click or type)',
            btnFetchModels: '🔄 Fetch Live Models from API',
            lblSelectGoldfish: '🐠 Goldfish (Zero-Context Reviewer) Provider',
            badgeCrossLlm: 'Cross-LLM Audit Ready',
            optSameProvider: 'Same as Elephant (Strict Zero-Context Isolation)',
            phGoldfishModel: 'Goldfish Model ID (leave blank for auto)',
            btnSaveConfig: '💾 Save Model Config',
            btnTestConn: '🔌 Test Connection',
            hdrApiKeys: 'Cloud LLM API Keys (SecretStorage)',
            btnSaveKey: 'Save',
            badgeWeb: '🌐 Web Research',
            hdrGuide: '🧭 Navigation Guide (Readiness & Next Step)',
            btnOpenFolder: '📂 Open Folder',
            btnRevealSpecFolder: '📁 Open Save Folder',
            btnQuickKey: '🔑 Set API Key',
            lblNextAction: '👉 Next Step:',
            badgeHere: '👈 Current Step',
            lblTemplates: '💡 Quick Templates:',
            tplGreenfield: '🌱 New App (0→1)',
            tplFeature: '🧩 Add Feature to Repo',
            tplApi: '🔌 API / Backend Spec',
            hintClarifyReply: '✍️ Click options below to auto-populate your architectural decisions above, then click "② Generate 7-Lens Concept Brief"!',
            hdrStressTest: '🔍 Initial Stress-Test (Hidden Assumptions & Risks)',
            phWizardCustom: '✍️ Or type a custom answer / note for this question...',
            btnWizardPrev: '◀ Prev',
            btnWizardNext: 'Next ▶',
            btnWizardApply: '✨ Answers Synced',
            lblBriefReady: '✅ concepts_brief.md Ready!',
            btnOpenBrief: '📄 Open in Editor',
            btnMdPreview: '👁️ Rich Preview',
            sumBriefPreview: '✏️ View & Directly Edit Concept Brief Inline',
            lblDraftReady: '✅ design_draft.md Ready!',
            btnOpenDraft: '📝 Open in Editor',
            sumDraftPreview: '✏️ View & Directly Edit Design Spec Inline',
            hintInlineEdit: '💡 Edit directly and click "💾 Save Edits" to update the file',
            btnSaveInline: '💾 Save Edits',
            prereqStep2: '🔒 Complete Step 1 (concepts_brief.md) first to unlock this step.',
            prereqStep3: '🔒 Complete Step 2 (design_draft.md) first to run Goldfish Review.',
            prereqStep4: '🔒 Run Goldfish Review in Step 3 and check findings to resolve.',
            prereqStep5: '🔒 Generate design_draft.md in Steps 2–4 to approve & hand off to coding AI.',
            btnRollback1: '⏪ Redo from Step 1',
            btnRollback2: '⏪ Redo from Step 2',
            btnRollback3: '⏪ Reset Reviews',
            staleStep2: '⚠️ Step 1 brief was updated. Choose "🔄 Update Existing Draft" or "📝 Regenerate Design Spec" below.',
            btnStep2Update: '🔄 Update Existing Draft with Latest Brief',
            hdrWebSearch: '🌐 Web Search & Technical Docs Grounding (Auto ON)',
            chkAutoWeb: 'Auto-search Web (DuckDuckGo / GitHub / Wikipedia) during spec drafting',
            chkNativeWeb: 'Also enable native Gemini Search Grounding / Grok Live Search',
            phWebSearch: 'Enter library, RFC, API topic, or https://... URL',
            btnRunWeb: '🔍 Search & Fetch',
            lblWebRef: '📚 Collected Web References',
            btnClearWeb: 'Clear',
            hdrStep1: '🧠 Ideation & 7-Lens Concept Brief',
            descStep1: 'Works for both blank greenfield projects (0→1) and existing repositories. Describe what you want to build or click a starter template below.',
            phStep1: 'What do you want to build? (Goal, core features, target users, preferred tech stack, etc.)',
            btnStep1Clarify: '① ❓ Ask Clarifying Questions First (Recommended)',
            btnStep1Refine: '💬 Refine Existing Brief with New Notes',
            btnStep1Create: '② 🧠 Generate 7-Lens Concept Brief (concepts_brief.md)',
            hdrClarifyBox: '🐘 Elephant Stress-Test & Clarifying Questions',
            hdrStep2: '📝 Draft 9-Section Design Specification',
            descStep2: 'Compile concepts_brief.md into a rigorous 9-section Engineering Design Document (design_draft.md) with CUJs (Given/When/Then), Mermaid diagrams, Alternatives Considered, Failure Modes, Target Files & Interfaces, and Test Plan.',
            phStep2Extra: 'Optional extra architectural constraints or libraries to use...',
            btnStep2Draft: '📝 Generate Design Specification (design_draft.md)',
            hdrStep3: '🔍 Fresh Zero-Context Goldfish Review',
            noticeIsolation: '🛡️ <strong>Zero-Context Isolation</strong>: Completely blocks Elephant chat history (<code>elephant_context.json</code>) and <code>concepts_brief.md</code>. Audits <code>design_draft.md</code> cold with zero bias.',
            lensComprehension: '[Comprehension] Cold Paraphrase & Ambiguity Audit (Self-containment check)',
            lensEdge: '[Design Critic] Unstated Assumptions, Edge Cases, Concurrency & Failure Modes',
            lensConsistency: '[Codebase Fit] Project Structure Fit, Interface Contracts & YAGNI Check',
            lensSecurity: '[Security & SRE] Auth/Secrets, Input Validation, Observability & Rollback',
            lensReadiness: '[Readiness] Zero-Guesswork Implementation Readiness Check',
            btnStep3Review: '🐠 Run Fresh Goldfish Review',
            lblReadinessScore: '📊 Spec Readiness Score:',
            hdrParaphrase: '🐠 Goldfish Cold Comprehension Paraphrase (Stage 6 Test)',
            btnSelectImportant: '🚨 Critical/High Only',
            btnSelectAll: 'Select All',
            btnDeselectAll: 'Deselect All',
            emptyReviews: 'No Goldfish review has been run yet.',
            hdrStep4: '✨ Resolve Findings & Refine Spec',
            descStep4: 'Send checked Goldfish findings back to Elephant to update design_draft.md and log every resolution in Section 9 (Design Decisions & Review Log).',
            phStep4Comment: 'Optional author notes or custom resolution instructions...',
            chkDiffView: 'Open VS Code Diff View comparing before vs. after resolution',
            btnStep4Resolve: '✨ Resolve Selected Findings in Design Spec',
            badgeReviewLoop: '🔄 Iterative Audit & Refine Loop (Step 3 ⇄ Step 4)',
            descReviewLoop: 'Repeat 🐠 <strong>Step 3 (Cold Goldfish Audit)</strong> ➔ 🐘 <strong>Step 4 (Elephant Resolution)</strong> 1–2 times until Critical/High issues are eliminated, then proceed to <strong>Step 5 (Approve)</strong>.',
            hdrLoopFork: '✅ Findings Resolved! Choose your next step:',
            descLoopFork: 'You can either <strong>run another fresh Goldfish Review (Loop to Step 3)</strong> on the updated spec, or <strong>proceed to Final Approval (Step 5)</strong>.',
            btnLoopRerun: '🔄 Re-run Fresh Goldfish Review on Updated Spec (Loop Step 3)',
            btnLoopProceed: '🚀 Spec is Solid — Proceed to Approval (Step 5)',
            hdrStep5: '🚀 Finalize & Approve Design Specification',
            descStep5: 'Stamp Status: Approved and Goldfish verification metadata onto your specification, archive to EleGold_Specs/approved_specs/NNN-[feature-name].md, and register in SITEMAP.md.',
            lblFeatureSlug: 'Design Spec Feature Slug',
            btnStep5Approve: '✅ Approve & Archive Specification',
            sumSddTools: '🛠️ Post-Approval SDD Handoff & Drift Audit Tools',
            btnCopyPrompt: '📋 Copy SDD Prompt for Coding AI',
            btnImplement: '💻 Generate Code from Spec',
            btnDrift: '⚖️ Run Spec Drift Audit (/egm-drift-report)',
            hdrApprovedSpecs: '📁 Approved Specifications Archive (EleGold_Specs/approved_specs/)',
            stCreated: 'Ready ✓',
            stMissing: 'Missing',
            stApproved: 'Approved ✅',
            stEditing: 'Drafting ✏️',
            keyConfigured: 'Saved:',
            keyNotSet: 'Not Set',
            resolvedBadge: 'Resolved ✓',
            suggestionPrefix: '💡 Spec Fix: ',
            noWebData: 'No web research items collected yet.',
            btnCancelLoading: '⏹️ Cancel',
            btnOpenMd: '📄 Open MD',
            btnOpenJson: '📋 JSON',
            btnOpenWebJson: '📄 Open JSON',
            btnOpenDiff: '🔍 Diff View',
            btnOpenReport: '📄 Open Report',
            btnOpenSitemap: '🗺️ SITEMAP.md',
            lblReviewReportReady: '📄 Goldfish Review Report (goldfish_review_report.md)',
            lblStep4ArtifactReady: '✅ Updated Design Spec (design_draft.md)',
            lblImplGuideReady: '💻 Implementation Guide (implementation_output.md)',
            lblDriftReportReady: '⚖️ Drift Audit Report (drift_report.md)',
            prereqStep5Sdd: '🔒 Click "✅ Approve & Archive Spec" above first to lock down the canonical Approved specification and unlock these SDD tools.'
        }
    };

    function t(key) {
        return (I18N[currentLang] && I18N[currentLang][key]) || I18N.ja[key] || key;
    }

    // DOM Elements
    const btnLangJa = document.getElementById('btnLangJa');
    const btnLangEn = document.getElementById('btnLangEn');
    const configDrawer = document.getElementById('configDrawer');
    const btnToggleConfig = document.getElementById('btnToggleConfig');
    const btnCloseConfig = document.getElementById('btnCloseConfig');
    const btnOpenVsSettings = document.getElementById('btnOpenVsSettings');

    const lblElephantModel = document.getElementById('lblElephantModel');
    const lblGoldfishModel = document.getElementById('lblGoldfishModel');
    const pillBrief = document.getElementById('pillBrief');
    const stBrief = document.getElementById('stBrief');
    const pillDraft = document.getElementById('pillDraft');
    const stDraft = document.getElementById('stDraft');
    const stTurns = document.getElementById('stTurns');
    const btnResetElephant = document.getElementById('btnResetElephant');

    const selProvider = document.getElementById('selProvider');
    const inpModel = document.getElementById('inpModel');
    const btnFetchModels = document.getElementById('btnFetchModels');
    const modelPresets = document.getElementById('modelPresets');
    const selGoldfishProvider = document.getElementById('selGoldfishProvider');
    const inpGoldfishModel = document.getElementById('inpGoldfishModel');
    const goldfishModelPresets = document.getElementById('goldfishModelPresets');
    const btnSaveProviderConfig = document.getElementById('btnSaveProviderConfig');
    const btnTestConnection = document.getElementById('btnTestConnection');

    const loadingBanner = document.getElementById('loadingBanner');
    const loadingText = document.getElementById('loadingText');
    const loadingSubText = document.getElementById('loadingSubText');
    const loadingElapsedBadge = document.getElementById('loadingElapsedBadge');
    const btnCancelLoading = document.getElementById('btnCancelLoading');
    const loadingProgressBar = document.getElementById('loadingProgressBar');
    const loadingMetaChips = document.getElementById('loadingMetaChips');
    const loadingStagesList = document.getElementById('loadingStagesList');
    const errorBanner = document.getElementById('errorBanner');
    const errorText = document.getElementById('errorText');
    const btnDismissError = document.getElementById('btnDismissError');

    if (btnCancelLoading) {
        btnCancelLoading.addEventListener('click', () => {
            vscode.postMessage({ type: 'cancelOperation' });
            stopRichLoadingTelemetry();
            loadingBanner.classList.add('hidden');
            clearButtonThinking();
        });
    }

    const chkAutoWebSearch = document.getElementById('chkAutoWebSearch');
    const chkNativeGrounding = document.getElementById('chkNativeGrounding');
    const inpWebQuery = document.getElementById('inpWebQuery');
    const btnRunWebSearch = document.getElementById('btnRunWebSearch');
    const lblWebCount = document.getElementById('lblWebCount');
    const webResearchList = document.getElementById('webResearchList');
    const btnClearWebResearch = document.getElementById('btnClearWebResearch');

    const txtBrainstormIdea = document.getElementById('txtBrainstormIdea');
    const btnStep1Clarify = document.getElementById('btnStep1Clarify');
    const btnStep1Create = document.getElementById('btnStep1Create');
    const btnStep1Refine = document.getElementById('btnStep1Refine');
    const clarifyBox = document.getElementById('clarifyBox');
    const clarifyContent = document.getElementById('clarifyContent');
    const clarifyWizardContainer = document.getElementById('clarifyWizardContainer');
    const clarifyStressSection = document.getElementById('clarifyStressSection');
    const clarifyStressList = document.getElementById('clarifyStressList');
    const wizardProgressText = document.getElementById('wizardProgressText');
    const wizardStepDots = document.getElementById('wizardStepDots');
    const wizardCategoryBadge = document.getElementById('wizardCategoryBadge');
    const wizardQuestionTitle = document.getElementById('wizardQuestionTitle');
    const wizardWhyText = document.getElementById('wizardWhyText');
    const wizardOptionsList = document.getElementById('wizardOptionsList');
    const inpWizardCustom = document.getElementById('inpWizardCustom');
    const btnWizardPrev = document.getElementById('btnWizardPrev');
    const btnWizardNext = document.getElementById('btnWizardNext');
    const btnWizardApplyAll = document.getElementById('btnWizardApplyAll');
    const wizardSummaryPreview = document.getElementById('wizardSummaryPreview');

    const step1ResultBox = document.getElementById('step1ResultBox');
    const btnOpenBriefInline = document.getElementById('btnOpenBriefInline');
    const btnPreviewBriefSide = document.getElementById('btnPreviewBriefSide');
    const txtBriefInlineEditor = document.getElementById('txtBriefInlineEditor');
    const btnSaveBriefInline = document.getElementById('btnSaveBriefInline');

    const step2ResultBox = document.getElementById('step2ResultBox');
    const btnOpenDraftInline = document.getElementById('btnOpenDraftInline');
    const btnPreviewDraftSide = document.getElementById('btnPreviewDraftSide');
    const txtDraftInlineEditor = document.getElementById('txtDraftInlineEditor');
    const btnSaveDraftInline = document.getElementById('btnSaveDraftInline');

    const inpStep2Extra = document.getElementById('inpStep2Extra');
    const btnStep2UpdateDraft = document.getElementById('btnStep2UpdateDraft');
    const btnStep2Draft = document.getElementById('btnStep2Draft');
    const staleStep2Notice = document.getElementById('staleStep2Notice');
    const btnRollbackStep1 = document.getElementById('btnRollbackStep1');
    const btnRollbackStep2 = document.getElementById('btnRollbackStep2');
    const btnRollbackStep3 = document.getElementById('btnRollbackStep3');

    const chkLensComprehension = document.getElementById('chkLensComprehension');
    const chkLensEdge = document.getElementById('chkLensEdge');
    const chkLensConsistency = document.getElementById('chkLensConsistency');
    const chkLensSecurity = document.getElementById('chkLensSecurity');
    const chkLensReadiness = document.getElementById('chkLensReadiness');
    const btnStep3Review = document.getElementById('btnStep3Review');
    const readinessScoreBox = document.getElementById('readinessScoreBox');
    const lblReadinessScoreVal = document.getElementById('lblReadinessScoreVal');
    const lblReadinessVerdict = document.getElementById('lblReadinessVerdict');
    const readinessMeterFill = document.getElementById('readinessMeterFill');
    const lblStopGuideText = document.getElementById('lblStopGuideText');
    const paraphraseBox = document.getElementById('paraphraseBox');
    const paraphraseText = document.getElementById('paraphraseText');
    const reviewsToolbar = document.getElementById('reviewsToolbar');
    const lblReviewSummary = document.getElementById('lblReviewSummary');
    const btnSelectImportantReviews = document.getElementById('btnSelectImportantReviews');
    const btnSelectAllReviews = document.getElementById('btnSelectAllReviews');
    const btnDeselectAllReviews = document.getElementById('btnDeselectAllReviews');
    const reviewsList = document.getElementById('reviewsList');

    const inpStep4Comment = document.getElementById('inpStep4Comment');
    const chkOpenDiff = document.getElementById('chkOpenDiff');
    const btnStep4Resolve = document.getElementById('btnStep4Resolve');
    const lblReviewRoundBadge = document.getElementById('lblReviewRoundBadge');
    const step4LoopForkBox = document.getElementById('step4LoopForkBox');
    const btnLoopRerunGoldfish = document.getElementById('btnLoopRerunGoldfish');
    const btnLoopGoApprove = document.getElementById('btnLoopGoApprove');

    const inpFeatureName = document.getElementById('inpFeatureName');
    const btnStep5Approve = document.getElementById('btnStep5Approve');
    const btnStep5CopyPrompt = document.getElementById('btnStep5CopyPrompt');
    const btnStep5Implement = document.getElementById('btnStep5Implement');
    const btnStep5Drift = document.getElementById('btnStep5Drift');
    const approvedSpecsBox = document.getElementById('approvedSpecsBox');
    const approvedSpecsList = document.getElementById('approvedSpecsList');

    // Artifact Quick-Open Bars & Buttons across all 5 Steps
    const btnOpenClarifyMd = document.getElementById('btnOpenClarifyMd');
    const btnPreviewClarifyMd = document.getElementById('btnPreviewClarifyMd');
    const btnOpenWebResearchJson = document.getElementById('btnOpenWebResearchJson');
    const btnOpenStep2Diff = document.getElementById('btnOpenStep2Diff');
    const step3ArtifactBar = document.getElementById('step3ArtifactBar');
    const btnOpenReviewReportMd = document.getElementById('btnOpenReviewReportMd');
    const btnPreviewReviewReportMd = document.getElementById('btnPreviewReviewReportMd');
    const btnOpenReviewJson = document.getElementById('btnOpenReviewJson');
    const step4ArtifactBar = document.getElementById('step4ArtifactBar');
    const btnOpenStep4Draft = document.getElementById('btnOpenStep4Draft');
    const btnPreviewStep4Draft = document.getElementById('btnPreviewStep4Draft');
    const btnOpenStep4Diff = document.getElementById('btnOpenStep4Diff');
    const step5ImplArtifactBar = document.getElementById('step5ImplArtifactBar');
    const btnOpenImplGuide = document.getElementById('btnOpenImplGuide');
    const btnPreviewImplGuide = document.getElementById('btnPreviewImplGuide');
    const step5DriftArtifactBar = document.getElementById('step5DriftArtifactBar');
    const btnOpenDriftReport = document.getElementById('btnOpenDriftReport');
    const btnPreviewDriftReport = document.getElementById('btnPreviewDriftReport');
    const sitemapArtifactGroup = document.getElementById('sitemapArtifactGroup');
    const btnOpenSitemapMd = document.getElementById('btnOpenSitemapMd');
    const btnPreviewSitemapMd = document.getElementById('btnPreviewSitemapMd');

    // Onboarding & Navigation Guide Elements
    const lblFolderStatus = document.getElementById('lblFolderStatus');
    const btnOpenFolder = document.getElementById('btnOpenFolder');
    const btnRevealSpecFolder = document.getElementById('btnRevealSpecFolder');
    const lblKeyReadyStatus = document.getElementById('lblKeyReadyStatus');
    const btnQuickOpenKeys = document.getElementById('btnQuickOpenKeys');
    const lblNextActionDesc = document.getElementById('lblNextActionDesc');
    const prereqStep2 = document.getElementById('prereqStep2');
    const prereqStep3 = document.getElementById('prereqStep3');
    const prereqStep4 = document.getElementById('prereqStep4');
    const prereqStep5 = document.getElementById('prereqStep5');
    const prereqStep5Sdd = document.getElementById('prereqStep5Sdd');

    if (btnOpenBriefInline) {
        btnOpenBriefInline.addEventListener('click', () => {
            vscode.postMessage({ type: 'openFile', relativePath: 'concepts_brief.md', previewMode: false });
        });
    }
    if (btnPreviewBriefSide) {
        btnPreviewBriefSide.addEventListener('click', () => {
            vscode.postMessage({ type: 'openFile', relativePath: 'concepts_brief.md', previewMode: true });
        });
    }
    if (btnSaveBriefInline && txtBriefInlineEditor) {
        btnSaveBriefInline.addEventListener('click', () => {
            vscode.postMessage({
                type: 'saveArtifactEdit',
                relativePath: 'concepts_brief.md',
                content: txtBriefInlineEditor.value
            });
        });
    }

    if (btnOpenDraftInline) {
        btnOpenDraftInline.addEventListener('click', () => {
            vscode.postMessage({ type: 'openFile', relativePath: 'design_draft.md', previewMode: false });
        });
    }

    // Wire all Artifact Quick-Open & Preview Buttons across Steps 1-5
    function bindArtifactButton(btn, relativePath, previewMode = false) {
        if (!btn) return;
        btn.addEventListener('click', () => {
            vscode.postMessage({ type: 'openFile', relativePath, previewMode });
        });
    }
    bindArtifactButton(btnOpenClarifyMd, '.egm/clarifying_questions.md', false);
    bindArtifactButton(btnPreviewClarifyMd, '.egm/clarifying_questions.md', true);
    bindArtifactButton(btnOpenWebResearchJson, '.egm/web_research.json', false);
    bindArtifactButton(btnOpenReviewReportMd, 'goldfish_review_report.md', false);
    bindArtifactButton(btnPreviewReviewReportMd, 'goldfish_review_report.md', true);
    bindArtifactButton(btnOpenReviewJson, '.egm/goldfish_reviews.json', false);
    bindArtifactButton(btnOpenStep4Draft, 'design_draft.md', false);
    bindArtifactButton(btnPreviewStep4Draft, 'design_draft.md', true);
    bindArtifactButton(btnOpenImplGuide, 'approved_specs/implementation_output.md', false);
    bindArtifactButton(btnPreviewImplGuide, 'approved_specs/implementation_output.md', true);
    bindArtifactButton(btnOpenDriftReport, 'approved_specs/drift_report.md', false);
    bindArtifactButton(btnPreviewDriftReport, 'approved_specs/drift_report.md', true);
    bindArtifactButton(btnOpenSitemapMd, 'approved_specs/SITEMAP.md', false);
    bindArtifactButton(btnPreviewSitemapMd, 'approved_specs/SITEMAP.md', true);

    if (btnOpenStep2Diff) {
        btnOpenStep2Diff.addEventListener('click', () => {
            vscode.postMessage({ type: 'openDiff', mode: 'step2' });
        });
    }
    if (btnOpenStep4Diff) {
        btnOpenStep4Diff.addEventListener('click', () => {
            vscode.postMessage({ type: 'openDiff', mode: 'step4' });
        });
    }
    if (btnPreviewDraftSide) {
        btnPreviewDraftSide.addEventListener('click', () => {
            vscode.postMessage({ type: 'openFile', relativePath: 'design_draft.md', previewMode: true });
        });
    }
    if (btnSaveDraftInline && txtDraftInlineEditor) {
        btnSaveDraftInline.addEventListener('click', () => {
            vscode.postMessage({
                type: 'saveArtifactEdit',
                relativePath: 'design_draft.md',
                content: txtDraftInlineEditor.value
            });
        });
    }

    // Interactive Clarifying Wizard State, UI Input Persistence & Button Thinking Tracker
    let activeClarifyingInterview = null;
    let currentWizardIdx = 0;
    const wizardAnswers = {}; // { [questionId]: { question, answer } }
    let persistedSelectedReviewIds = null; // null = use smart default; Array<string> = user's explicit checkbox state
    let activeThinkingBtn = null;
    let activeThinkingOrigText = '';
    let saveUiTimer = null;

    function getCheckedReviewIdsFromDom() {
        const boxes = document.querySelectorAll('.review-checkbox');
        if (!boxes || boxes.length === 0) {
            return persistedSelectedReviewIds;
        }
        const ids = [];
        boxes.forEach((cb) => {
            if (cb.checked) {
                const id = cb.getAttribute('data-review-id');
                if (id) ids.push(id);
            }
        });
        return ids;
    }

    function persistUiInputsNow() {
        const snapshot = {
            step1Idea: txtBrainstormIdea ? txtBrainstormIdea.value : '',
            wizardAnswers: { ...wizardAnswers },
            wizardCurrentIdx: currentWizardIdx,
            step2Extra: inpStep2Extra ? inpStep2Extra.value : '',
            step3Lenses: {
                comprehension: chkLensComprehension ? chkLensComprehension.checked : true,
                edgeCases: chkLensEdge ? chkLensEdge.checked : true,
                consistency: chkLensConsistency ? chkLensConsistency.checked : true,
                security: chkLensSecurity ? chkLensSecurity.checked : true,
                readiness: chkLensReadiness ? chkLensReadiness.checked : true
            },
            selectedReviewIds: persistedSelectedReviewIds,
            step4Comment: inpStep4Comment ? inpStep4Comment.value : '',
            step4OpenDiff: chkOpenDiff ? chkOpenDiff.checked : true,
            step5FeatureName: inpFeatureName ? inpFeatureName.value : 'initial-architecture'
        };
        try {
            vscode.setState(snapshot);
        } catch {
            // Ignore setState error
        }
        vscode.postMessage({
            type: 'saveUiInputs',
            inputs: snapshot
        });
    }

    function persistSelectedReviewIdsFromDom() {
        persistedSelectedReviewIds = getCheckedReviewIdsFromDom();
        persistUiInputsNow();
    }

    function schedulePersistUiInputs() {
        if (saveUiTimer) {
            clearTimeout(saveUiTimer);
        }
        saveUiTimer = setTimeout(() => {
            persistUiInputsNow();
        }, 300);
    }

    // Restore from Webview local state immediately on boot (before backend roundtrip)
    try {
        const cachedState = vscode.getState();
        if (cachedState && typeof cachedState === 'object') {
            if (txtBrainstormIdea && cachedState.step1Idea) {
                txtBrainstormIdea.value = cachedState.step1Idea;
            }
            if (cachedState.wizardAnswers && typeof cachedState.wizardAnswers === 'object') {
                Object.assign(wizardAnswers, cachedState.wizardAnswers);
            }
            if (typeof cachedState.wizardCurrentIdx === 'number') {
                currentWizardIdx = cachedState.wizardCurrentIdx;
            }
            if (inpStep2Extra && cachedState.step2Extra) {
                inpStep2Extra.value = cachedState.step2Extra;
            }
            if (cachedState.step3Lenses && typeof cachedState.step3Lenses === 'object') {
                if (chkLensComprehension) chkLensComprehension.checked = cachedState.step3Lenses.comprehension ?? true;
                if (chkLensEdge) chkLensEdge.checked = cachedState.step3Lenses.edgeCases ?? true;
                if (chkLensConsistency) chkLensConsistency.checked = cachedState.step3Lenses.consistency ?? true;
                if (chkLensSecurity) chkLensSecurity.checked = cachedState.step3Lenses.security ?? true;
                if (chkLensReadiness) chkLensReadiness.checked = cachedState.step3Lenses.readiness ?? true;
            }
            if (Array.isArray(cachedState.selectedReviewIds)) {
                persistedSelectedReviewIds = cachedState.selectedReviewIds;
            }
            if (inpStep4Comment && cachedState.step4Comment) {
                inpStep4Comment.value = cachedState.step4Comment;
            }
            if (chkOpenDiff && typeof cachedState.step4OpenDiff === 'boolean') {
                chkOpenDiff.checked = cachedState.step4OpenDiff;
            }
            if (inpFeatureName && cachedState.step5FeatureName) {
                inpFeatureName.value = cachedState.step5FeatureName;
            }
        }
    } catch {
        // Ignore
    }

    if (txtBrainstormIdea) {
        txtBrainstormIdea.addEventListener('input', () => schedulePersistUiInputs());
    }
    if (inpStep2Extra) {
        inpStep2Extra.addEventListener('input', () => schedulePersistUiInputs());
    }
    if (inpStep4Comment) {
        inpStep4Comment.addEventListener('input', () => schedulePersistUiInputs());
    }
    if (chkOpenDiff) {
        chkOpenDiff.addEventListener('change', () => persistUiInputsNow());
    }
    if (inpFeatureName) {
        inpFeatureName.addEventListener('input', () => schedulePersistUiInputs());
    }
    [chkLensComprehension, chkLensEdge, chkLensConsistency, chkLensSecurity, chkLensReadiness].forEach((chk) => {
        if (chk) {
            chk.addEventListener('change', () => persistUiInputsNow());
        }
    });

    let loadingTimerInterval = null;
    let loadingStartTimeMs = 0;
    let activeLoadingOpKey = '';

    const LOADING_TELEMETRY_PROFILES = {
        'step1-clarify': {
            role: 'elephant',
            targetFile: 'EleGold_Specs/.egm/clarifying_questions.json',
            subJa: '初期アイデアの前提・盲点・技術的トレードオフを洗い出しています',
            subEn: 'Analyzing hidden assumptions, architectural trade-offs, and key decision points',
            stagesJa: [
                '📂 ワークスペース構造と設定ファイル (package.json 等) をスキャン中',
                '🌐 Web検索・最新技術ドキュメントから関連知識を取得中',
                '🔍 初期ストレスチェック（隠れたリスク・ボトルネック）を分析中',
                '❓ クリック選択式の深掘り質問カード (JSON) を構築中'
            ],
            stagesEn: [
                '📂 Scanning workspace structure & project configuration',
                '🌐 Fetching technical grounding & web references',
                '🔍 Running initial stress-test on hidden assumptions & risks',
                '❓ Building interactive multiple-choice clarifying question cards'
            ]
        },
        'step1-brief': {
            role: 'elephant',
            targetFile: 'EleGold_Specs/concepts_brief.md',
            subJa: 'EGM 7つのレンズで要件を深掘りし、初期コンセプトブリーフを作成しています',
            subEn: 'Synthesizing requirements across all 7 EGM lenses into concepts_brief.md',
            stagesJa: [
                '📂 入力アイデア・深掘り質問の選択回答・対話履歴を統合中',
                '🌐 Web検索リファレンスと既存コード構造を照合中',
                '🧠 7つのレンズ（Why / Scope / Edge Cases / Trade-offs / Architecture）を分析中',
                '📄 EleGold_Specs/concepts_brief.md を構造化Markdownで生成中'
            ],
            stagesEn: [
                '📂 Merging prompt, wizard answers & Elephant context history',
                '🌐 Cross-referencing web grounding & workspace tree',
                '🧠 Evaluating 7 EGM Lenses (Why, Scope, Edge Cases, Trade-offs, Architecture)',
                '📄 Writing structured EleGold_Specs/concepts_brief.md'
            ]
        },
        'step1-refine': {
            role: 'elephant',
            targetFile: 'EleGold_Specs/concepts_brief.md',
            subJa: '既存の concepts_brief.md に追加要望・変更点を反映しています',
            subEn: 'Updating existing concepts_brief.md with your latest feedback',
            stagesJa: [
                '📄 現在の concepts_brief.md と対話履歴を読み込み中',
                '💬 追加要望・回答内容の差分を7レンズ要件にマージ中',
                '💾 EleGold_Specs/concepts_brief.md を更新保存中'
            ],
            stagesEn: [
                '📄 Loading current concepts_brief.md & conversation context',
                '💬 Merging new requirements into 7-Lens brief',
                '💾 Saving updated EleGold_Specs/concepts_brief.md'
            ]
        },
        'step2-draft': {
            role: 'elephant',
            targetFile: 'EleGold_Specs/design_draft.md',
            subJa: 'CUJ・Mermaid図・異常系・型定義・テスト計画を含む全9章の設計書を執筆しています',
            subEn: 'Drafting formal 9-section Engineering Design Specification (design_draft.md)',
            stagesJa: [
                '📄 合意済みブリーフ (concepts_brief.md) とプロジェクト構造を読み込み中',
                '📐 第1〜4章: 概要・CUJ (Given/When/Then)・アーキテクチャ＆Mermaid図を設計中',
                '🛡️ 第5〜6章: 代替案の棄却理由・異常系/エッジケース/ロールバック仕様を定義中',
                '💻 第7〜9章: 変更対象ファイル・厳密な型/API定義・テスト計画・設計判断ログを執筆中'
            ],
            stagesEn: [
                '📄 Loading agreed concepts_brief.md & repository structure',
                '📐 Sections 1–4: Overview, CUJs (Given/When/Then), Architecture & Mermaid diagrams',
                '🛡️ Sections 5–6: Alternatives Considered, Failure Modes & Rollback contracts',
                '💻 Sections 7–9: Target Files, Strict Type/API Signatures, Test Plan & Decision Log'
            ]
        },
        'step2-update': {
            role: 'elephant',
            targetFile: 'EleGold_Specs/design_draft.md',
            subJa: '既存の design_draft.md を最新ブリーフ＆追加指示に基づいて差分アップデートしています',
            subEn: 'Updating existing design_draft.md with latest brief & instructions',
            stagesJa: [
                '📄 既存の design_draft.md と最新 concepts_brief.md を比較中',
                '🔄 アーキテクチャ・インターフェース定義・異常系仕様を差分更新中',
                '💾 更新前バックアップを保存し VS Code Diff 比較ビューを準備中'
            ],
            stagesEn: [
                '📄 Comparing existing design_draft.md against latest concepts_brief.md',
                '🔄 Updating architecture, interface contracts & edge cases',
                '💾 Saving snapshot & preparing VS Code Diff View'
            ]
        },
        'step3-review': {
            role: 'goldfish',
            targetFile: 'EleGold_Specs/.egm/goldfish_reviews.json',
            subJa: '🛡️ ゼロコンテキスト隔離モード: 過去の会話とブリーフを完全遮断して初見監査を実行中',
            subEn: '🛡️ Zero-Context Isolation: Auditing design_draft.md cold with zero conversation history',
            stagesJa: [
                '🔒 Elephantの対話履歴 (.egm/elephant_context.json) とブリーフを完全遮断',
                '📖 初見理解テスト (Stage 6 Cold Paraphrase): 仕様書のみからシステム挙動を要約中',
                '🐠 5つの監査レンズ（理解性・エッジケース・既存整合性・セキュリティ・実装準備度）で検証中',
                '📋 重要度付き指摘リスト (Critical/High/Medium/Low) と修正案を構築中'
            ],
            stagesEn: [
                '🔒 Blocking Elephant chat history & concepts_brief.md (Strict Isolation)',
                '📖 Running Stage 6 Cold Comprehension Paraphrase test',
                '🐠 Auditing across 5 lenses (Comprehension, Edge Cases, Codebase Fit, Security, Readiness)',
                '📋 Compiling structured findings & concrete specification fixes'
            ]
        },
        'step4-resolve': {
            role: 'elephant',
            targetFile: 'EleGold_Specs/design_draft.md',
            subJa: '選択された金魚レビュー指摘事項を解決し、設計書と第9章ログを更新しています',
            subEn: 'Resolving selected Goldfish findings and logging decisions in Section 9',
            stagesJa: [
                '💾 更新前の design_draft.md を Diff 比較用にスナップショット保存中',
                '🔧 選択された指摘事項と人間の追加コメントを各章の仕様に統合中',
                '📝 第9章 (Design Decisions & Review Log) に解決履歴を記録中',
                '✍️ 全9章の更新版 design_draft.md 全文を LLM から生成・書き出し中'
            ],
            stagesEn: [
                '💾 Snapshotting current design_draft.md for Diff comparison',
                '🔧 Integrating selected Goldfish fixes & author notes into specification',
                '📝 Recording resolution rationale in Section 9 (Review Log)',
                '✍️ Generating & writing complete updated 9-section design_draft.md'
            ]
        },
        'step5-approve': {
            role: 'elephant',
            targetFile: 'EleGold_Specs/approved_specs/',
            subJa: '設計仕様書に承認メタデータを刻印し、正式アーカイブと SITEMAP.md を更新しています',
            subEn: 'Stamping approval metadata, archiving spec, and updating SITEMAP.md',
            stagesJa: [
                '✅ Status: Approved と Goldfish 監査完了メタデータを刻印中',
                '📁 EleGold_Specs/approved_specs/NNN-[feature].md にアーカイブ保存中',
                '🗺️ EleGold_Specs/approved_specs/SITEMAP.md の仕様書インデックスを更新中'
            ],
            stagesEn: [
                '✅ Stamping Status: Approved & Goldfish verification metadata',
                '📁 Archiving to EleGold_Specs/approved_specs/NNN-[feature].md',
                '🗺️ Updating EleGold_Specs/approved_specs/SITEMAP.md index'
            ]
        },
        'step5-implement': {
            role: 'elephant',
            targetFile: 'EleGold_Specs/IMPLEMENTATION_GUIDE.md',
            subJa: '承認済み仕様書に基づき、実装コードと実装ガイドを生成しています',
            subEn: 'Generating implementation code & guide strictly from approved specification',
            stagesJa: [
                '📄 承認済み仕様書と第7章（変更対象ファイル・型定義）を解析中',
                '💻 仕様に準拠した実装コードおよび EleGold_Specs/IMPLEMENTATION_GUIDE.md を生成中',
                '💾 ファイルを書き出してエディタで開いています'
            ],
            stagesEn: [
                '📄 Parsing approved specification & Section 7 target file contracts',
                '💻 Generating implementation code & EleGold_Specs/IMPLEMENTATION_GUIDE.md',
                '💾 Writing files and opening in editor'
            ]
        },
        'step5-drift': {
            role: 'goldfish',
            targetFile: 'EleGold_Specs/DRIFT_REPORT.md',
            subJa: '承認済み仕様書と現在の実装コードの乖離（ドリフト）をゼロコンテキスト監査しています',
            subEn: 'Auditing codebase drift against the approved specification',
            stagesJa: [
                '📄 承認済み仕様書とワークスペース内の実装コードを照合中',
                '⚖️ 未実装項目・仕様外の勝手な変更・インターフェース不一致を検査中',
                '📊 EleGold_Specs/DRIFT_REPORT.md を生成中'
            ],
            stagesEn: [
                '📄 Comparing approved specification against workspace source files',
                '⚖️ Detecting unimplemented requirements & interface drift',
                '📊 Generating EleGold_Specs/DRIFT_REPORT.md'
            ]
        },
        'web-search': {
            role: 'elephant',
            targetFile: 'EleGold_Specs/.egm/web_research.json',
            subJa: '外部Web検索・GitHub・技術ドキュメントから根拠情報を収集しています',
            subEn: 'Searching DuckDuckGo, GitHub & technical documentation for grounding',
            stagesJa: [
                '🌐 検索クエリで外部ドキュメント・リポジトリを検索中',
                '📚 スニペットとURLを抽出し EleGold_Specs/.egm/web_research.json に保存中'
            ],
            stagesEn: [
                '🌐 Querying external documentation & repositories',
                '📚 Saving reference snippets to EleGold_Specs/.egm/web_research.json'
            ]
        }
    };

    function startRichLoadingTelemetry(mainText, opKey) {
        if (loadingTimerInterval) {
            clearInterval(loadingTimerInterval);
            loadingTimerInterval = null;
        }
        activeLoadingOpKey = opKey || 'step1-brief';
        const profile = LOADING_TELEMETRY_PROFILES[activeLoadingOpKey] || LOADING_TELEMETRY_PROFILES['step1-brief'];
        const isGoldfish = profile.role === 'goldfish';

        loadingBanner.classList.toggle('goldfish-mode', isGoldfish);
        loadingText.textContent = mainText || '...';
        if (loadingSubText) {
            loadingSubText.textContent = currentLang === 'en' ? profile.subEn : profile.subJa;
        }

        // Render Metadata Chips (Active Model, Context Mode, Target File, Web Grounding)
        if (loadingMetaChips) {
            loadingMetaChips.innerHTML = '';
            const provText = isGoldfish
                ? (lblGoldfishModel ? lblGoldfishModel.textContent : 'Goldfish')
                : (lblElephantModel ? lblElephantModel.textContent : 'Elephant');
            const turnsCount = lastWorkspaceStatus ? lastWorkspaceStatus.elephantTurns || 0 : 0;
            const webRefsCount = lastWorkspaceStatus && Array.isArray(lastWorkspaceStatus.webResearch)
                ? lastWorkspaceStatus.webResearch.length
                : 0;

            const chips = [
                isGoldfish ? `🐠 Audit: ${provText}` : `🐘 Architect: ${provText}`,
                isGoldfish
                    ? (currentLang === 'en' ? '🛡️ Zero-Context Isolated' : '🛡️ 履歴遮断 (Zero-Context)')
                    : (currentLang === 'en' ? `🧠 Context: ${turnsCount} turns` : `🧠 履歴保持: ${turnsCount}ターン`),
                `📁 ${profile.targetFile}`
            ];
            if (!isGoldfish && chkAutoWebSearch && chkAutoWebSearch.checked) {
                chips.push(currentLang === 'en' ? `🌐 Web Grounding (${webRefsCount} refs)` : `🌐 Web根拠 (${webRefsCount}件)`);
            }

            chips.forEach((c) => {
                const span = document.createElement('span');
                span.className = 'loading-meta-chip';
                span.textContent = c;
                loadingMetaChips.appendChild(span);
            });
        }

        const stages = (currentLang === 'en' ? profile.stagesEn : profile.stagesJa) || [];
        loadingStartTimeMs = Date.now();

        function updateTick() {
            const elapsedSec = (Date.now() - loadingStartTimeMs) / 1000;
            if (loadingElapsedBadge) {
                loadingElapsedBadge.textContent = `⏱️ ${elapsedSec.toFixed(1)}s`;
            }
            // Advance stage every ~3.2 seconds up to the last stage
            const activeStageIdx = Math.min(stages.length - 1, Math.floor(elapsedSec / 3.2));
            if (loadingProgressBar) {
                const pct = Math.min(94, Math.round(18 + (elapsedSec / 18) * 75));
                loadingProgressBar.style.width = `${pct}%`;
            }
            if (loadingStagesList && stages.length > 0) {
                loadingStagesList.innerHTML = '';
                stages.forEach((stText, idx) => {
                    const li = document.createElement('li');
                    const isDone = idx < activeStageIdx;
                    const isCurrent = idx === activeStageIdx;
                    li.className = 'loading-stage-item' + (isDone ? ' done' : '') + (isCurrent ? ' active' : '');
                    const iconSpan = document.createElement('span');
                    iconSpan.className = 'stage-icon';
                    iconSpan.textContent = isDone ? '✓' : isCurrent ? '▶' : '○';
                    const txtSpan = document.createElement('span');
                    let displayStageText = stText;
                    if (isCurrent && idx === stages.length - 1 && elapsedSec > 18) {
                        displayStageText = currentLang === 'en'
                            ? `${stText} (Full spec output in progress: ${Math.round(elapsedSec)}s — click ⏹️ Cancel to switch to a faster model)`
                            : `${stText} （長文仕様書を出力中: ${Math.round(elapsedSec)}秒経過 — 急ぐ場合は右上の「⏹️ 中断」から高速モデルへ切替可）`;
                    }
                    txtSpan.textContent = displayStageText;
                    li.appendChild(iconSpan);
                    li.appendChild(txtSpan);
                    loadingStagesList.appendChild(li);
                });
            }
        }

        updateTick();
        loadingTimerInterval = setInterval(updateTick, 100);
    }

    function stopRichLoadingTelemetry() {
        if (loadingTimerInterval) {
            clearInterval(loadingTimerInterval);
            loadingTimerInterval = null;
        }
    }

    function startButtonThinking(btn, thinkingLabelJa, thinkingLabelEn) {
        clearButtonThinking();
        if (!btn) return;
        activeThinkingBtn = btn;
        activeThinkingOrigText = btn.textContent || '';
        btn.disabled = true;
        btn.classList.add('btn-thinking');
        const label = currentLang === 'en' ? thinkingLabelEn : thinkingLabelJa;
        btn.innerHTML = `<span class="btn-inline-spinner"></span><span>${label}</span>`;
    }

    function clearButtonThinking() {
        if (activeThinkingBtn) {
            activeThinkingBtn.classList.remove('btn-thinking');
            activeThinkingBtn.textContent = activeThinkingOrigText;
            activeThinkingBtn.disabled = false;
            activeThinkingBtn = null;
            activeThinkingOrigText = '';
        }
    }

    function syncWizardAnswersToTextarea() {
        if (!txtBrainstormIdea || !activeClarifyingInterview) return;
        const markerJa = '\n\n--- 🐘 深掘り質問への回答（選択結果） ---';
        const markerEn = '\n\n--- 🐘 Clarifying Questions Decisions ---';
        let baseText = txtBrainstormIdea.value;
        const idxJa = baseText.indexOf(markerJa);
        const idxEn = baseText.indexOf(markerEn);
        if (idxJa !== -1) baseText = baseText.slice(0, idxJa);
        if (idxEn !== -1) baseText = baseText.slice(0, idxEn);
        baseText = baseText.trimEnd();

        const qs = activeClarifyingInterview.questions || [];
        const lines = [];
        const ansPrefix = currentLang === 'en' ? '👉 Selected Answer:' : '👉 選択回答:';
        qs.forEach((q, idx) => {
            const qid = q.id || `Q${idx + 1}`;
            const entry = wizardAnswers[qid];
            if (entry && entry.answer) {
                lines.push(`- [${qid}: ${q.category || ''}] ${q.question}\n  ${ansPrefix} ${entry.answer}`);
            }
        });

        if (lines.length > 0) {
            const header = currentLang === 'en' ? markerEn : markerJa;
            txtBrainstormIdea.value = `${baseText}${header}\n${lines.join('\n')}`;
        } else {
            txtBrainstormIdea.value = baseText;
        }
        persistUiInputsNow();
    }

    function renderClarifyingWizard() {
        if (!activeClarifyingInterview || !Array.isArray(activeClarifyingInterview.questions) || activeClarifyingInterview.questions.length === 0) {
            if (clarifyWizardContainer) clarifyWizardContainer.classList.add('hidden');
            return;
        }
        if (clarifyWizardContainer) clarifyWizardContainer.classList.remove('hidden');
        if (clarifyContent) clarifyContent.classList.add('hidden');

        // Stress test bullets
        const stress = activeClarifyingInterview.stressTest || [];
        if (clarifyStressSection && clarifyStressList) {
            if (stress.length > 0) {
                clarifyStressSection.classList.remove('hidden');
                clarifyStressList.innerHTML = '';
                stress.forEach((s) => {
                    const li = document.createElement('li');
                    li.textContent = s;
                    clarifyStressList.appendChild(li);
                });
            } else {
                clarifyStressSection.classList.add('hidden');
            }
        }

        const questions = activeClarifyingInterview.questions;
        if (currentWizardIdx < 0) currentWizardIdx = 0;
        if (currentWizardIdx >= questions.length) currentWizardIdx = questions.length - 1;

        const q = questions[currentWizardIdx];
        const qid = q.id || `Q${currentWizardIdx + 1}`;
        const savedAnswer = (wizardAnswers[qid] && wizardAnswers[qid].answer) || '';

        const answeredCount = questions.filter((item, i) => {
            const id = item.id || `Q${i + 1}`;
            return Boolean(wizardAnswers[id] && wizardAnswers[id].answer);
        }).length;

        if (wizardProgressText) {
            wizardProgressText.textContent =
                currentLang === 'en'
                    ? `Question ${currentWizardIdx + 1} / ${questions.length} (${answeredCount} answered)`
                    : `質問 ${currentWizardIdx + 1} / ${questions.length} （回答済: ${answeredCount}/${questions.length}）`;
        }

        if (wizardStepDots) {
            wizardStepDots.innerHTML = '';
            questions.forEach((item, idx) => {
                const id = item.id || `Q${idx + 1}`;
                const isAns = Boolean(wizardAnswers[id] && wizardAnswers[id].answer);
                const dot = document.createElement('button');
                dot.type = 'button';
                dot.className = 'wizard-dot' + (idx === currentWizardIdx ? ' active' : '') + (isAns ? ' answered' : '');
                dot.textContent = isAns && idx !== currentWizardIdx ? '✓' : String(idx + 1);
                dot.addEventListener('click', () => {
                    currentWizardIdx = idx;
                    renderClarifyingWizard();
                    persistUiInputsNow();
                });
                wizardStepDots.appendChild(dot);
            });
        }

        if (wizardCategoryBadge) {
            wizardCategoryBadge.textContent = `${qid} · ${q.category || ''}`;
        }
        if (wizardQuestionTitle) {
            wizardQuestionTitle.textContent = q.question || '';
        }
        if (wizardWhyText) {
            wizardWhyText.textContent = q.whyItMatters ? `💡 ${q.whyItMatters}` : '';
            wizardWhyText.classList.toggle('hidden', !q.whyItMatters);
        }

        if (wizardOptionsList) {
            wizardOptionsList.innerHTML = '';
            const opts = Array.isArray(q.options) ? q.options : [];
            opts.forEach((optText) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                const isSelected = savedAnswer === optText;
                btn.className = 'wizard-option-btn' + (isSelected ? ' selected' : '');

                const radio = document.createElement('span');
                radio.className = 'wizard-opt-radio';
                radio.textContent = isSelected ? '✓' : '';

                const txt = document.createElement('span');
                txt.textContent = optText;

                btn.appendChild(radio);
                btn.appendChild(txt);

                btn.addEventListener('click', () => {
                    wizardAnswers[qid] = { question: q.question, answer: optText };
                    if (inpWizardCustom) inpWizardCustom.value = '';
                    syncWizardAnswersToTextarea();
                    renderClarifyingWizard();
                    // Automatically advance to next unanswered question after a brief pause
                    if (currentWizardIdx < questions.length - 1) {
                        setTimeout(() => {
                            currentWizardIdx++;
                            renderClarifyingWizard();
                            persistUiInputsNow();
                        }, 240);
                    }
                });

                wizardOptionsList.appendChild(btn);
            });
        }

        if (inpWizardCustom) {
            const isCustom = savedAnswer && !(q.options || []).includes(savedAnswer);
            inpWizardCustom.value = isCustom ? savedAnswer : '';
        }

        if (btnWizardPrev) {
            btnWizardPrev.disabled = currentWizardIdx === 0;
        }
        if (btnWizardNext) {
            btnWizardNext.disabled = currentWizardIdx >= questions.length - 1;
        }

        if (wizardSummaryPreview) {
            if (answeredCount > 0) {
                wizardSummaryPreview.classList.remove('hidden');
                wizardSummaryPreview.textContent =
                    currentLang === 'en'
                        ? `✅ ${answeredCount} / ${questions.length} decisions synced to your prompt above. Ready for "② Generate 7-Lens Concept Brief"!`
                        : `✅ ${answeredCount} / ${questions.length} 問の回答が上の入力欄に自動反映されました！すべて選んだら下の「② 7レンズ分析ブリーフを生成」を押してください。`;
            } else {
                wizardSummaryPreview.classList.add('hidden');
            }
        }
    }

    if (btnWizardPrev) {
        btnWizardPrev.addEventListener('click', () => {
            if (currentWizardIdx > 0) {
                currentWizardIdx--;
                renderClarifyingWizard();
                persistUiInputsNow();
            }
        });
    }

    if (btnWizardNext) {
        btnWizardNext.addEventListener('click', () => {
            if (activeClarifyingInterview && currentWizardIdx < activeClarifyingInterview.questions.length - 1) {
                currentWizardIdx++;
                renderClarifyingWizard();
                persistUiInputsNow();
            }
        });
    }

    if (inpWizardCustom) {
        inpWizardCustom.addEventListener('input', () => {
            if (!activeClarifyingInterview) return;
            const q = activeClarifyingInterview.questions[currentWizardIdx];
            if (!q) return;
            const qid = q.id || `Q${currentWizardIdx + 1}`;
            const val = inpWizardCustom.value.trim();
            if (val) {
                wizardAnswers[qid] = { question: q.question, answer: val };
            } else {
                delete wizardAnswers[qid];
            }
            syncWizardAnswersToTextarea();
        });
    }

    if (btnWizardApplyAll) {
        btnWizardApplyAll.addEventListener('click', () => {
            syncWizardAnswersToTextarea();
            btnStep1Create.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }

    const QUICK_TEMPLATES = {
        ja: {
            greenfield: `【0→1新規開発】\n■ 作りたいシステム・アプリの概要:\n（例：社内ドキュメントを全文検索してAI要約するWebアプリ）\n\n■ 主な機能・やりたいこと:\n1. \n2. \n\n■ 希望する技術スタック・制約（未定なら「おすすめを提案して」でOK）:\n（例：TypeScript + Next.js + SQLite、ローカルで動く構成）`,
            feature: `【既存プロジェクトへの新機能追加】\n■ 追加したい機能:\n（例：Webhook送信時の指数バックオフ付きリトライ機能と死活監視ログ）\n\n■ 背景・解決したい課題:\n\n■ 既存コードで維持したいルール・制約:\n`,
            api: `【API・バックエンド設計】\n■ エンドポイント / サービスの目的:\n\n■ 想定リクエスト・レスポンス / データ構造:\n\n■ 非機能要件（認証・レート制限・エラー時ロールバックなど）:\n`
        },
        en: {
            greenfield: `[0→1 Greenfield App]\n■ Overview of the app/system to build:\n(e.g., A local-first markdown knowledge base with vector search)\n\n■ Core features:\n1. \n2. \n\n■ Preferred tech stack / constraints (or ask Elephant to recommend):\n(e.g., TypeScript, Node.js, SQLite)`,
            feature: `[New Feature for Existing Repo]\n■ Feature to add:\n(e.g., Webhook delivery retry queue with exponential backoff and dead-letter logging)\n\n■ Problem to solve:\n\n■ Existing architectural constraints:\n`,
            api: `[API / Backend Service Spec]\n■ Service / Endpoint purpose:\n\n■ Expected inputs, outputs & data schema:\n\n■ Non-functional requirements (Auth, rate limits, idempotency, rollback):\n`
        }
    };

    document.querySelectorAll('.template-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            const tplKey = chip.getAttribute('data-template');
            const dict = QUICK_TEMPLATES[currentLang] || QUICK_TEMPLATES.ja;
            if (tplKey && dict[tplKey]) {
                txtBrainstormIdea.value = dict[tplKey];
                txtBrainstormIdea.focus();
                persistUiInputsNow();
            }
        });
    });

    if (btnOpenFolder) {
        btnOpenFolder.addEventListener('click', () => {
            vscode.postMessage({ type: 'openFolder' });
        });
    }

    if (btnRevealSpecFolder) {
        btnRevealSpecFolder.addEventListener('click', () => {
            vscode.postMessage({ type: 'revealSpecFolder' });
        });
    }

    if (btnQuickOpenKeys) {
        btnQuickOpenKeys.addEventListener('click', () => {
            configDrawer.classList.remove('hidden');
            const prov = selProvider.value || 'gemini';
            const keyInput = document.getElementById(`keyInput-${prov}`);
            if (keyInput) {
                keyInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                keyInput.focus();
            }
        });
    }

    function applyTranslations(lang) {
        currentLang = lang === 'en' ? 'en' : 'ja';
        btnLangJa.classList.toggle('active', currentLang === 'ja');
        btnLangEn.classList.toggle('active', currentLang === 'en');

        document.querySelectorAll('[data-i18n]').forEach((el) => {
            const key = el.getAttribute('data-i18n');
            if (key === 'noticeIsolation' || key === 'descReviewLoop' || key === 'descLoopFork') {
                el.innerHTML = t(key);
            } else if (key) {
                el.textContent = t(key);
            }
        });

        document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (key) {
                el.setAttribute('placeholder', t(key));
            }
        });

        if (lastProviderSummary) {
            renderProviderInfo(lastProviderSummary);
        }
        if (lastWorkspaceStatus) {
            renderWorkspaceInfo(lastWorkspaceStatus);
        }
    }

    btnLangJa.addEventListener('click', () => {
        applyTranslations('ja');
        vscode.postMessage({ type: 'setLanguage', language: 'ja' });
    });

    btnLangEn.addEventListener('click', () => {
        applyTranslations('en');
        vscode.postMessage({ type: 'setLanguage', language: 'en' });
    });

    // Stepper smooth scroll
    document.querySelectorAll('.stepper-node').forEach((node) => {
        node.addEventListener('click', () => {
            const targetId = node.getAttribute('data-target');
            const targetEl = targetId ? document.getElementById(targetId) : null;
            if (targetEl) {
                targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });

    function updateStepper(activeStep) {
        for (let i = 1; i <= 5; i++) {
            const node = document.getElementById(`stepNode${i}`);
            if (!node) continue;
            node.classList.remove('active', 'done');
            if (i < activeStep) {
                node.classList.add('done');
            } else if (i === activeStep) {
                node.classList.add('active');
            }
        }
    }

    function renderModelPresets(provider) {
        modelPresets.innerHTML = '';
        const list = MODEL_PRESETS[provider] || [];
        list.forEach((m) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'preset-pill';
            btn.textContent = m;
            btn.addEventListener('click', () => {
                inpModel.value = m;
            });
            modelPresets.appendChild(btn);
        });
    }

    function renderGoldfishPresets() {
        if (!goldfishModelPresets) return;
        goldfishModelPresets.innerHTML = '';
        const gfProv = selGoldfishProvider.value === 'same' ? selProvider.value : selGoldfishProvider.value;
        const list = MODEL_PRESETS[gfProv] || [];
        list.forEach((m) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'preset-pill';
            btn.textContent = m;
            btn.addEventListener('click', () => {
                inpGoldfishModel.value = m;
            });
            goldfishModelPresets.appendChild(btn);
        });
    }

    const LIVE_API_FETCHED = {};

    function updateFetchButtonStatus(provider) {
        if (!btnFetchModels) return;
        if (LIVE_API_FETCHED[provider]) {
            btnFetchModels.textContent =
                currentLang === 'en' ? '✓ Auto-Synced from API (Refresh)' : '✓ APIから自動取得済（再取得）';
        } else {
            btnFetchModels.textContent = t('btnFetchModels');
        }
    }

    selProvider.addEventListener('change', () => {
        const p = selProvider.value;
        const defaults = MODEL_PRESETS[p] || [];
        if (defaults.length > 0) {
            inpModel.value = defaults[0];
        }
        renderModelPresets(p);
        renderGoldfishPresets();
        updateFetchButtonStatus(p);
        vscode.postMessage({
            type: 'fetchModels',
            provider: p,
            silent: true
        });
    });

    selGoldfishProvider.addEventListener('change', () => {
        renderGoldfishPresets();
        const gfProv = selGoldfishProvider.value === 'same' ? selProvider.value : selGoldfishProvider.value;
        vscode.postMessage({
            type: 'fetchModels',
            provider: gfProv,
            silent: true
        });
    });

    if (btnFetchModels) {
        btnFetchModels.addEventListener('click', () => {
            vscode.postMessage({
                type: 'fetchModels',
                provider: selProvider.value
            });
        });
    }

    btnToggleConfig.addEventListener('click', () => {
        configDrawer.classList.toggle('hidden');
    });

    btnCloseConfig.addEventListener('click', () => {
        configDrawer.classList.add('hidden');
    });

    btnOpenVsSettings.addEventListener('click', () => {
        vscode.postMessage({ type: 'openSettings' });
    });

    btnSaveProviderConfig.addEventListener('click', () => {
        vscode.postMessage({
            type: 'saveProviderConfig',
            provider: selProvider.value,
            model: inpModel.value,
            goldfishProvider: selGoldfishProvider.value,
            goldfishModel: inpGoldfishModel.value,
            webSearchEnabled: chkAutoWebSearch.checked,
            nativeGrounding: chkNativeGrounding.checked
        });
    });

    btnTestConnection.addEventListener('click', () => {
        vscode.postMessage({
            type: 'testConnection',
            provider: selProvider.value,
            model: inpModel.value
        });
    });

    document.querySelectorAll('.save-key-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const provider = btn.getAttribute('data-provider');
            const input = document.getElementById(`keyInput-${provider}`);
            if (provider && input) {
                vscode.postMessage({
                    type: 'saveApiKey',
                    provider,
                    apiKey: input.value
                });
                input.value = '';
            }
        });
    });

    pillBrief.addEventListener('click', () => {
        vscode.postMessage({ type: 'openFile', relativePath: 'concepts_brief.md' });
    });

    pillDraft.addEventListener('click', () => {
        vscode.postMessage({ type: 'openFile', relativePath: 'design_draft.md' });
    });

    btnResetElephant.addEventListener('click', () => {
        vscode.postMessage({ type: 'resetElephant' });
    });

    btnDismissError.addEventListener('click', () => {
        errorBanner.classList.add('hidden');
    });

    chkAutoWebSearch.addEventListener('change', () => {
        vscode.postMessage({
            type: 'saveProviderConfig',
            webSearchEnabled: chkAutoWebSearch.checked
        });
    });

    chkNativeGrounding.addEventListener('change', () => {
        vscode.postMessage({
            type: 'saveProviderConfig',
            nativeGrounding: chkNativeGrounding.checked
        });
    });

    btnRunWebSearch.addEventListener('click', () => {
        startButtonThinking(btnRunWebSearch, '🌐 Web検索中...', '🌐 Searching...');
        vscode.postMessage({
            type: 'manualWebSearch',
            query: inpWebQuery.value
        });
    });

    btnClearWebResearch.addEventListener('click', () => {
        vscode.postMessage({ type: 'clearWebResearch' });
    });

    // Step 1: Clarify & Brainstorm
    btnStep1Clarify.addEventListener('click', () => {
        if (!txtBrainstormIdea.value.trim()) {
            vscode.postMessage({
                type: 'step1Clarify',
                idea: '',
                useWebSearch: chkAutoWebSearch.checked
            });
            return;
        }
        startButtonThinking(
            btnStep1Clarify,
            '🐘 象が前提を分析し、選択肢付きの質問を生成中...',
            '🐘 Elephant is generating interactive questions...'
        );
        vscode.postMessage({
            type: 'step1Clarify',
            idea: txtBrainstormIdea.value,
            useWebSearch: chkAutoWebSearch.checked
        });
    });

    btnStep1Create.addEventListener('click', () => {
        if (!txtBrainstormIdea.value.trim()) {
            vscode.postMessage({
                type: 'step1Brainstorm',
                idea: '',
                useWebSearch: chkAutoWebSearch.checked,
                refine: false
            });
            return;
        }
        startButtonThinking(
            btnStep1Create,
            '🐘 象が7つのレンズで分析し concepts_brief.md を生成中...',
            '🐘 Elephant is generating concepts_brief.md...'
        );
        vscode.postMessage({
            type: 'step1Brainstorm',
            idea: txtBrainstormIdea.value,
            useWebSearch: chkAutoWebSearch.checked,
            refine: false
        });
    });

    btnStep1Refine.addEventListener('click', () => {
        startButtonThinking(
            btnStep1Refine,
            '🐘 象が回答・追加要望を反映してブリーフを更新中...',
            '🐘 Elephant is updating concepts_brief.md...'
        );
        vscode.postMessage({
            type: 'step1Brainstorm',
            idea: txtBrainstormIdea.value,
            useWebSearch: chkAutoWebSearch.checked,
            refine: true
        });
    });

    // Step 2: Draft Spec (Fresh Generate or Update Existing)
    btnStep2Draft.addEventListener('click', () => {
        startButtonThinking(
            btnStep2Draft,
            '🐘 象が全9章の詳細設計仕様書 (design_draft.md) を執筆中...',
            '🐘 Elephant is drafting 9-section design_draft.md...'
        );
        vscode.postMessage({
            type: 'step2GenerateDraft',
            extraInstructions: inpStep2Extra.value,
            useWebSearch: chkAutoWebSearch.checked,
            refineExistingDraft: false
        });
    });

    if (btnStep2UpdateDraft) {
        btnStep2UpdateDraft.addEventListener('click', () => {
            startButtonThinking(
                btnStep2UpdateDraft,
                '🐘 象が既存の設計仕様書を差分更新中...',
                '🐘 Elephant is updating existing design_draft.md...'
            );
            vscode.postMessage({
                type: 'step2GenerateDraft',
                extraInstructions: inpStep2Extra.value,
                useWebSearch: chkAutoWebSearch.checked,
                refineExistingDraft: true
            });
        });
    }

    if (btnRollbackStep1) {
        btnRollbackStep1.addEventListener('click', () => {
            vscode.postMessage({ type: 'rollbackToStep', targetStep: 1 });
        });
    }
    if (btnRollbackStep2) {
        btnRollbackStep2.addEventListener('click', () => {
            vscode.postMessage({ type: 'rollbackToStep', targetStep: 2 });
        });
    }
    if (btnRollbackStep3) {
        btnRollbackStep3.addEventListener('click', () => {
            vscode.postMessage({ type: 'rollbackToStep', targetStep: 3 });
        });
    }

    // Step 3: Goldfish Review
    btnStep3Review.addEventListener('click', () => {
        startButtonThinking(
            btnStep3Review,
            '🐠 金魚がゼロコンテキストで設計書を冷徹に監査中...',
            '🐠 Goldfish is auditing design_draft.md cold...'
        );
        vscode.postMessage({
            type: 'step3GoldfishReview',
            lenses: {
                comprehension: chkLensComprehension.checked,
                edgeCases: chkLensEdge.checked,
                consistency: chkLensConsistency.checked,
                security: chkLensSecurity.checked,
                readiness: chkLensReadiness.checked
            }
        });
    });

    if (btnSelectImportantReviews) {
        btnSelectImportantReviews.addEventListener('click', () => {
            document.querySelectorAll('.review-checkbox').forEach((cb) => {
                const sev = (cb.getAttribute('data-severity') || '').toLowerCase();
                const isResolved = cb.getAttribute('data-resolved') === 'true';
                cb.checked = !isResolved && (sev === 'critical' || sev === 'high');
            });
            persistSelectedReviewIdsFromDom();
        });
    }

    btnSelectAllReviews.addEventListener('click', () => {
        document.querySelectorAll('.review-checkbox').forEach((cb) => {
            cb.checked = true;
        });
        persistSelectedReviewIdsFromDom();
    });

    btnDeselectAllReviews.addEventListener('click', () => {
        document.querySelectorAll('.review-checkbox').forEach((cb) => {
            cb.checked = false;
        });
        persistSelectedReviewIdsFromDom();
    });

    // Step 4: Resolve Selected
    btnStep4Resolve.addEventListener('click', () => {
        const selectedIds = [];
        document.querySelectorAll('.review-checkbox:checked').forEach((cb) => {
            const id = cb.getAttribute('data-review-id');
            if (id) {
                selectedIds.push(id);
            }
        });
        startButtonThinking(
            btnStep4Resolve,
            '🐘 象が選択された指摘を解決して設計書を更新中...',
            '🐘 Elephant is resolving findings in design_draft.md...'
        );
        vscode.postMessage({
            type: 'step4ResolveReviews',
            selectedIds,
            humanComment: inpStep4Comment.value,
            openDiff: chkOpenDiff.checked
        });
    });

    if (btnLoopRerunGoldfish) {
        btnLoopRerunGoldfish.addEventListener('click', () => {
            const sec3 = document.getElementById('secStep3');
            if (sec3) {
                sec3.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            startButtonThinking(
                btnStep3Review,
                '🐠 金魚が修正後の設計書を初見ゼロ文脈で再監査中...',
                '🐠 Goldfish is re-auditing the updated design_draft.md...'
            );
            vscode.postMessage({
                type: 'step3GoldfishReview',
                lenses: {
                    comprehension: chkLensComprehension.checked,
                    edgeCases: chkLensEdge.checked,
                    consistency: chkLensConsistency.checked,
                    security: chkLensSecurity.checked,
                    readiness: chkLensReadiness.checked
                }
            });
        });
    }

    if (btnLoopGoApprove) {
        btnLoopGoApprove.addEventListener('click', () => {
            const sec5 = document.getElementById('secStep5');
            if (sec5) {
                sec5.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    }

    // Step 5: Approve & Implement
    btnStep5Approve.addEventListener('click', () => {
        startButtonThinking(
            btnStep5Approve,
            '✅ 設計書を正式承認アーカイブに保存中...',
            '✅ Approving & archiving specification...'
        );
        vscode.postMessage({
            type: 'step5ApproveSpec',
            featureName: inpFeatureName.value
        });
    });

    btnStep5CopyPrompt.addEventListener('click', () => {
        vscode.postMessage({ type: 'step5CopySddPrompt' });
    });

    btnStep5Implement.addEventListener('click', () => {
        startButtonThinking(
            btnStep5Implement,
            '💻 承認済み設計書から実装コードを生成中...',
            '💻 Generating code from approved spec...'
        );
        vscode.postMessage({ type: 'step5Implement' });
    });

    btnStep5Drift.addEventListener('click', () => {
        startButtonThinking(
            btnStep5Drift,
            '⚖️ 金魚が仕様ドリフト（乖離）を監査中...',
            '⚖️ Goldfish is auditing spec drift...'
        );
        vscode.postMessage({ type: 'step5DriftReport' });
    });

    function renderProviderInfo(providerSummary) {
        lblElephantModel.textContent = `${providerSummary.elephantProvider} (${providerSummary.elephantModel})`;
        lblGoldfishModel.textContent = `${providerSummary.goldfishProvider} (${providerSummary.goldfishModel})`;

        selProvider.value = providerSummary.elephantProvider;
        inpModel.value = providerSummary.elephantModel;
        renderModelPresets(providerSummary.elephantProvider);

        ['gemini', 'claude', 'openai', 'grok'].forEach((p) => {
            const badge = document.getElementById(`keyStatus-${p}`);
            const info = providerSummary.keyStatus[p];
            if (badge && info) {
                badge.textContent = info.configured ? `${t('keyConfigured')} ${info.masked}` : t('keyNotSet');
                badge.className = 'key-badge' + (info.configured ? ' configured' : '');
            }
        });

        const stCacheStats = document.getElementById('stCacheStats');
        if (stCacheStats && providerSummary.cacheStats) {
            const cs = providerSummary.cacheStats;
            const totalHits = (cs.providerCacheHits || 0) + (cs.localCacheHits || 0);
            const savedTok = cs.cachedInputTokens || 0;
            const isEn = currentLang === 'en';
            if (savedTok > 0 || totalHits > 0) {
                const tokStr = savedTok >= 1000 ? `${(savedTok / 1000).toFixed(1)}k` : String(savedTok);
                stCacheStats.textContent = isEn
                    ? `⚡ Saved ${tokStr} tok (${totalHits} hits)`
                    : `⚡ 節約 ${tokStr} tok (Hit ${totalHits}回)`;
            } else {
                stCacheStats.textContent = isEn ? '⚡ Cache ON' : '⚡ キャッシュON';
            }
            const lastInfo = cs.lastCall
                ? `\nLast: ${cs.lastCall.provider} [${cs.lastCall.source}] (In: ${cs.lastCall.inputTokens}, Cached: ${cs.lastCall.cachedTokens}, Out: ${cs.lastCall.outputTokens})`
                : '';
            stCacheStats.title = isEn
                ? `Prompt Caching (Gemini/Claude/OpenAI/Grok/Ollama) + Local SHA-256 Cache\nTotal Calls: ${cs.totalCalls || 0} | Provider Cache Hits: ${cs.providerCacheHits || 0} | Local Hits: ${cs.localCacheHits || 0} | Saved Input Tokens: ${savedTok}${lastInfo}`
                : `プロンプトキャッシュ (Gemini/Claude/OpenAI/Grok/Ollama) ＋ ローカルSHA-256キャッシュ稼働中\n総リクエスト: ${cs.totalCalls || 0}回 | プロバイダーキャッシュHit: ${cs.providerCacheHits || 0}回 | ローカルHit: ${cs.localCacheHits || 0}回 | 累計キャッシュ済入力トークン: ${savedTok}${lastInfo}`;
        }

        renderNavigationGuide(lastWorkspaceStatus, providerSummary);
    }

    const btnClearCache = document.getElementById('btnClearCache');
    if (btnClearCache) {
        btnClearCache.addEventListener('click', () => {
            vscode.postMessage({ type: 'clearLlmCache' });
        });
    }

    function renderNavigationGuide(ws, providerSummary) {
        const isEn = currentLang === 'en';
        const hasWs = ws ? Boolean(ws.hasWorkspace) : true;
        const prov = providerSummary ? providerSummary.elephantProvider : 'gemini';
        const keyInfo = providerSummary && providerSummary.keyStatus ? providerSummary.keyStatus[prov] : null;
        const keyReady = prov === 'ollama' || Boolean(keyInfo && keyInfo.configured);

        if (lblFolderStatus && btnOpenFolder) {
            if (!hasWs) {
                lblFolderStatus.textContent = isEn
                    ? '⚠️ No Project Folder Open'
                    : '⚠️ 開発フォルダが未選択です';
                btnOpenFolder.classList.remove('hidden');
                if (btnRevealSpecFolder) btnRevealSpecFolder.classList.add('hidden');
            } else {
                const outFolder = (ws && ws.outputFolder) || 'EleGold_Specs';
                const modeLabel = ws && ws.isGreenfield
                    ? isEn
                        ? '🌱 0→1 New'
                        : '🌱 新規0→1'
                    : isEn
                        ? '🏗️ Existing'
                        : '🏗️ 既存';
                lblFolderStatus.textContent = isEn
                    ? `✅ ${ws ? ws.workspaceName : ''}/${outFolder}/ (${modeLabel})`
                    : `✅ 保存先: ${ws ? ws.workspaceName : ''}/${outFolder}/ (${modeLabel})`;
                btnOpenFolder.classList.add('hidden');
                if (btnRevealSpecFolder) btnRevealSpecFolder.classList.remove('hidden');
            }
        }

        if (lblKeyReadyStatus && btnQuickOpenKeys) {
            if (!keyReady) {
                lblKeyReadyStatus.textContent = isEn
                    ? `⚠️ ${prov.toUpperCase()} API Key Not Set`
                    : `⚠️ ${prov.toUpperCase()} のAPIキーが未設定です`;
                btnQuickOpenKeys.classList.remove('hidden');
            } else {
                lblKeyReadyStatus.textContent = isEn
                    ? `✅ ${prov.toUpperCase()} Ready`
                    : `✅ ${prov.toUpperCase()} 利用準備OK`;
                btnQuickOpenKeys.classList.add('hidden');
            }
        }

        const step = ws && ws.currentStep ? ws.currentStep : 1;
        const hasBrief = Boolean(ws && ws.hasBrief);
        const hasDraft = Boolean(ws && ws.hasDraft);
        const briefNewer = Boolean(ws && ws.briefNewerThanDraft);
        const hasClarify = Boolean(ws && ws.clarifyingNotes && ws.clarifyingNotes.trim());
        const reviews = (ws && ws.reviews) || [];
        const hasOpenReviews = reviews.some((r) => !r.resolved);
        const resolvedInCurrentRound = Boolean(ws && ws.resolvedInCurrentRound);
        const roundCount = (ws && ws.reviewRoundCount) || (reviews.length > 0 ? 1 : 0);

        const canRunStep2 = ws && typeof ws.canRunStep2 === 'boolean' ? ws.canRunStep2 : hasBrief;
        const canRunStep3 = ws && typeof ws.canRunStep3 === 'boolean' ? ws.canRunStep3 : (hasBrief && hasDraft && !briefNewer);
        const canRunStep4 = ws && typeof ws.canRunStep4 === 'boolean' ? ws.canRunStep4 : (canRunStep3 && reviews.length > 0);
        const canApproveStep5 =
            ws && typeof ws.canApproveStep5 === 'boolean'
                ? ws.canApproveStep5
                : (canRunStep3 && reviews.length > 0 && resolvedInCurrentRound);
        const canRunStep5SddTools =
            ws && typeof ws.canRunStep5SddTools === 'boolean'
                ? ws.canRunStep5SddTools
                : (canApproveStep5 && Boolean(ws && (ws.draftApproved || (ws.approvedSpecs && ws.approvedSpecs.length > 0))));

        if (lblReviewRoundBadge) {
            if (roundCount === 0) {
                lblReviewRoundBadge.textContent = isEn ? 'Not Run Yet' : '未実行 (0回)';
                lblReviewRoundBadge.classList.remove('active-round');
            } else {
                const resolvedCount = reviews.filter((r) => r.resolved).length;
                lblReviewRoundBadge.textContent = isEn
                    ? `Round ${roundCount} (${resolvedCount}/${reviews.length} resolved)`
                    : `第 ${roundCount} ラウンド目 (${resolvedCount}/${reviews.length}件 反映済)`;
                lblReviewRoundBadge.classList.add('active-round');
            }
        }

        if (btnStep3Review) {
            if (roundCount > 0 && resolvedInCurrentRound) {
                btnStep3Review.textContent = isEn
                    ? `🔄 Run Round ${roundCount + 1} Fresh Goldfish Review on Updated Spec`
                    : `🔄 修正後の設計書で金魚レビューを再実行 (第 ${roundCount + 1} ラウンド目)`;
            } else {
                btnStep3Review.textContent = t('btnStep3Review');
            }
        }

        // Only show Step 4 Fork Box when Step 4 has actually been executed in the current round!
        if (step4LoopForkBox) {
            step4LoopForkBox.classList.toggle('hidden', !(canRunStep4 && resolvedInCurrentRound && !ws?.draftApproved));
        }

        // Toggle Step 1 Refine button only when concepts_brief.md exists
        if (btnStep1Refine) {
            btnStep1Refine.classList.toggle('hidden', !hasBrief);
        }

        // Toggle Rollback / Redo buttons
        if (btnRollbackStep1) btnRollbackStep1.classList.toggle('hidden', !hasBrief && !hasDraft);
        if (btnRollbackStep2) btnRollbackStep2.classList.toggle('hidden', !hasDraft);
        if (btnRollbackStep3) btnRollbackStep3.classList.toggle('hidden', reviews.length === 0);

        // Toggle Step 2 Update vs Regenerate & Stale notice
        if (staleStep2Notice) staleStep2Notice.classList.toggle('hidden', !briefNewer);
        if (btnStep2UpdateDraft) {
            btnStep2UpdateDraft.classList.toggle('hidden', !hasDraft);
            btnStep2UpdateDraft.disabled = !canRunStep2;
        }
        if (btnStep2Draft) {
            btnStep2Draft.textContent = hasDraft
                ? isEn
                    ? '📝 Regenerate Design Spec from Scratch'
                    : '📝 ブリーフから設計仕様書を新規に書き直す'
                : t('btnStep2Draft');
        }

        // Toggle Step 2..5 strict prerequisite lock banners & button disabled states
        if (prereqStep2) prereqStep2.classList.toggle('hidden', canRunStep2);
        if (btnStep2Draft) btnStep2Draft.disabled = !canRunStep2;

        if (prereqStep3) {
            prereqStep3.classList.toggle('hidden', canRunStep3);
            if (!canRunStep3) {
                prereqStep3.innerHTML = briefNewer
                    ? isEn
                        ? '🔒 Step 1 <code>concepts_brief.md</code> was updated. Please update or regenerate <code>design_draft.md</code> in Step 2 first.'
                        : '🔒 Step 1 の要件ブリーフが更新されています。先に Step 2 で <code>design_draft.md</code> を更新してください。'
                    : t('prereqStep3');
            }
        }
        if (btnStep3Review) btnStep3Review.disabled = !canRunStep3;

        if (prereqStep4) prereqStep4.classList.toggle('hidden', canRunStep4);
        if (btnStep4Resolve) btnStep4Resolve.disabled = !canRunStep4;

        if (prereqStep5) {
            prereqStep5.classList.toggle('hidden', canApproveStep5);
            if (!canApproveStep5) {
                if (!canRunStep3) {
                    prereqStep5.innerHTML = isEn
                        ? '🔒 Complete Step 1 (<code>concepts_brief.md</code>) and Step 2 (<code>design_draft.md</code>) first.'
                        : '🔒 先に Step 1 (<code>concepts_brief.md</code>) と Step 2 (<code>design_draft.md</code>) を完了させてください。';
                } else if (reviews.length === 0) {
                    prereqStep5.innerHTML = isEn
                        ? '🔒 Run Step 3 (Goldfish Zero-Context Review) at least once before approving the specification.'
                        : '🔒 EGM公式ルールに基づき、先に Step 3 で「🐠 金魚レビュー」を最低1回実行してください。';
                } else {
                    prereqStep5.innerHTML = isEn
                        ? '🔒 Critical/High findings are open from Step 3. Please resolve them in Step 4 ("✨ Resolve Selected") to unlock approval.'
                        : '🔒 Step 3 で重要指摘（Critical / High）が検出されています。先に Step 4 の「✨ 選択した指摘を設計書に反映」を実行すると最終承認が解放されます。';
                }
            }
        }
        if (btnStep5Approve) btnStep5Approve.disabled = !canApproveStep5;

        if (prereqStep5Sdd) {
            prereqStep5Sdd.classList.toggle('hidden', canRunStep5SddTools);
        }
        if (btnStep5CopyPrompt) btnStep5CopyPrompt.disabled = !canRunStep5SddTools;
        if (btnStep5Implement) btnStep5Implement.disabled = !canRunStep5SddTools;
        if (btnStep5Drift) btnStep5Drift.disabled = !canRunStep5SddTools;

        // Highlight active step card & "👈 いまここ" badge & lock incomplete downstream steps
        const stepUnlockMap = {
            1: true,
            2: canRunStep2,
            3: canRunStep3,
            4: canRunStep4,
            5: canApproveStep5
        };
        for (let i = 1; i <= 5; i++) {
            const card = document.getElementById(`secStep${i}`);
            const badge = document.getElementById(`focusBadge${i}`);
            if (card) {
                card.classList.toggle('active-step-card', i === step);
                card.classList.toggle('locked-step-card', !stepUnlockMap[i]);
            }
            if (badge) {
                badge.classList.toggle('hidden', i !== step);
            }
        }

        // Update Next Action text
        if (lblNextActionDesc) {
            if (!hasWs) {
                lblNextActionDesc.textContent = isEn
                    ? 'First, click "📂 Open Folder" above to open an empty folder (for a new 0→1 app) or an existing project folder.'
                    : 'まず上の「📂 フォルダを開く」から、空のフォルダ（新規0→1開発）または既存プロジェクトのフォルダを開いてください。';
            } else if (!keyReady) {
                lblNextActionDesc.textContent = isEn
                    ? `Click "🔑 Set API Key" above to register your ${prov.toUpperCase()} API key (or switch to another LLM provider).`
                    : `まず上の「🔑 APIキーを設定」を押して、${prov.toUpperCase()} のAPIキーを登録してください。`;
            } else if (step === 1 && !hasClarify) {
                lblNextActionDesc.textContent = isEn
                    ? 'Step 1: Type what you want to build (or click a 💡 Quick Template below), then click "① Ask Clarifying Questions" or "② Generate 7-Lens Concept Brief".'
                    : 'Step 1: 作りたいものを入力（または下の「💡 記入例を挿入」をクリック）して、「① まず前提の深掘り質問を受ける」または「② 7レンズ分析ブリーフを生成」を押してください。';
            } else if (step === 1 && hasClarify) {
                lblNextActionDesc.textContent = isEn
                    ? 'Step 1: Read Elephant\'s questions below, add your answers to the Step 1 text box, and click "② Generate 7-Lens Concept Brief".'
                    : 'Step 1: 象からの深掘り質問を確認し、回答や方針を入力欄に追記してから「② 7レンズ分析ブリーフを生成」を押してください。';
            } else if (step === 2 && briefNewer) {
                lblNextActionDesc.textContent = isEn
                    ? 'Step 2: Step 1 brief was updated! Click "🔄 Update Existing Draft" (to keep existing work) or "📝 Regenerate Design Spec" in Step 2.'
                    : 'Step 2: Step 1 の要件ブリーフが更新されました！Step 2 の「🔄 既存の設計書をベースに差分更新」または「📝 新規に書き直す」を押してください。';
            } else if (step === 2) {
                lblNextActionDesc.textContent = isEn
                    ? 'Step 2: concepts_brief.md is ready! Scroll to Step 2 and click "📝 Generate Design Spec" to draft the 9-section specification.'
                    : 'Step 2: 要件ブリーフ (concepts_brief.md) が完成しました！Step 2 の「📝 設計仕様書を書き起こす」を押して全9章の設計書を作成しましょう。';
            } else if (step === 3) {
                lblNextActionDesc.textContent = isEn
                    ? 'Step 3: design_draft.md is ready! Run "🐠 Run Fresh Goldfish Review" in Step 3 for a cold Zero-Context audit.'
                    : 'Step 3: 設計書ドラフト (design_draft.md) が完成しました！Step 3 の「🐠 金魚レビューを実行」を押して初見ゼロ文脈の監査にかけましょう。';
            } else if (step === 4 && hasOpenReviews) {
                lblNextActionDesc.textContent = isEn
                    ? 'Step 4: Review Goldfish\'s findings in Step 3, keep the ones you want to fix checked, and click "✨ Resolve Selected" in Step 4.'
                    : 'Step 4: Step 3 で検出された金魚の指摘事項を確認し、Step 4 の「✨ 選択した指摘を設計書に反映」を押して設計書を仕上げましょう。';
            } else {
                lblNextActionDesc.textContent = isEn
                    ? 'Step 5: Your specification is ready! Click "✅ Approve & Archive Spec" in Step 5, then copy the SDD prompt or generate code.'
                    : 'Step 5: 設計仕様書が固まりました！Step 5 の「✅ 設計書を承認して確定保存」を押し、「📋 コーディングAI用指示をコピー」または「💻 この設計書からコード生成」へ進みましょう！';
            }
        }
    }

    function renderWorkspaceInfo(ws) {
        stBrief.textContent = ws.hasBrief ? t('stCreated') : t('stMissing');
        pillBrief.className = 'status-pill' + (ws.hasBrief ? ' ready' : ' pending');

        stDraft.textContent = ws.draftApproved
            ? t('stApproved')
            : ws.hasDraft
                ? t('stEditing')
                : t('stMissing');
        pillDraft.className = 'status-pill' + (ws.hasDraft ? ' ready' : ' pending');

        const turns = Math.floor((ws.elephantTurnCount || 0) / 2);
        stTurns.textContent = currentLang === 'en' ? `🐘 ${turns} turns` : `🐘 ${turns}ターン`;

        updateStepper(ws.currentStep || 1);
        renderNavigationGuide(ws, lastProviderSummary);

        // Restore persisted UI inputs (Step 1 initial idea, wizard answers, Step 2/4/5 inputs)
        if (ws.uiInputs && typeof ws.uiInputs === 'object') {
            if (txtBrainstormIdea && document.activeElement !== txtBrainstormIdea) {
                if (ws.uiInputs.step1Idea) {
                    txtBrainstormIdea.value = ws.uiInputs.step1Idea;
                } else if (!ws.hasBrief && !ws.clarifyingNotes && ws.elephantTurnCount === 0) {
                    // Cleanly clear when reset or rolled back to Step 1
                    txtBrainstormIdea.value = '';
                    Object.keys(wizardAnswers).forEach((k) => delete wizardAnswers[k]);
                }
            }
            if (ws.uiInputs.wizardAnswers && typeof ws.uiInputs.wizardAnswers === 'object') {
                Object.keys(ws.uiInputs.wizardAnswers).forEach((k) => {
                    if (!wizardAnswers[k]) {
                        wizardAnswers[k] = ws.uiInputs.wizardAnswers[k];
                    }
                });
            }
            if (typeof ws.uiInputs.wizardCurrentIdx === 'number' && ws.uiInputs.wizardCurrentIdx >= 0) {
                currentWizardIdx = ws.uiInputs.wizardCurrentIdx;
            }
            if (inpStep2Extra && document.activeElement !== inpStep2Extra && typeof ws.uiInputs.step2Extra === 'string') {
                inpStep2Extra.value = ws.uiInputs.step2Extra;
            }
            if (ws.uiInputs.step3Lenses && typeof ws.uiInputs.step3Lenses === 'object') {
                if (chkLensComprehension) chkLensComprehension.checked = ws.uiInputs.step3Lenses.comprehension ?? true;
                if (chkLensEdge) chkLensEdge.checked = ws.uiInputs.step3Lenses.edgeCases ?? true;
                if (chkLensConsistency) chkLensConsistency.checked = ws.uiInputs.step3Lenses.consistency ?? true;
                if (chkLensSecurity) chkLensSecurity.checked = ws.uiInputs.step3Lenses.security ?? true;
                if (chkLensReadiness) chkLensReadiness.checked = ws.uiInputs.step3Lenses.readiness ?? true;
            }
            if (Array.isArray(ws.uiInputs.selectedReviewIds)) {
                persistedSelectedReviewIds = ws.uiInputs.selectedReviewIds;
            } else if (ws.uiInputs.selectedReviewIds === null) {
                persistedSelectedReviewIds = null;
            }
            if (inpStep4Comment && document.activeElement !== inpStep4Comment && typeof ws.uiInputs.step4Comment === 'string') {
                inpStep4Comment.value = ws.uiInputs.step4Comment;
            }
            if (chkOpenDiff && typeof ws.uiInputs.step4OpenDiff === 'boolean') {
                chkOpenDiff.checked = ws.uiInputs.step4OpenDiff;
            }
            if (inpFeatureName && document.activeElement !== inpFeatureName && ws.uiInputs.step5FeatureName) {
                inpFeatureName.value = ws.uiInputs.step5FeatureName;
            }
        }

        // Clarifying notes & interactive wizard box
        if (ws.clarifyingInterview && Array.isArray(ws.clarifyingInterview.questions) && ws.clarifyingInterview.questions.length > 0) {
            clarifyBox.classList.remove('hidden');
            activeClarifyingInterview = ws.clarifyingInterview;
            renderClarifyingWizard();
        } else if (ws.clarifyingNotes && ws.clarifyingNotes.trim()) {
            clarifyBox.classList.remove('hidden');
            if (clarifyWizardContainer) clarifyWizardContainer.classList.add('hidden');
            if (clarifyContent) {
                clarifyContent.classList.remove('hidden');
                clarifyContent.textContent = ws.clarifyingNotes;
            }
        } else {
            clarifyBox.classList.add('hidden');
            activeClarifyingInterview = null;
        }

        // Step 1 & Step 2 inline generated result & direct editor boxes
        if (step1ResultBox) {
            if (ws.hasBrief) {
                step1ResultBox.classList.remove('hidden');
                if (txtBriefInlineEditor && document.activeElement !== txtBriefInlineEditor) {
                    txtBriefInlineEditor.value = ws.briefPreview || '';
                }
            } else {
                step1ResultBox.classList.add('hidden');
            }
        }

        if (step2ResultBox) {
            if (ws.hasDraft) {
                step2ResultBox.classList.remove('hidden');
                if (txtDraftInlineEditor && document.activeElement !== txtDraftInlineEditor) {
                    txtDraftInlineEditor.value = ws.draftPreview || '';
                }
                if (btnOpenStep2Diff) {
                    btnOpenStep2Diff.classList.toggle('hidden', !ws.hasStep2Diff);
                }
            } else {
                step2ResultBox.classList.add('hidden');
            }
        }

        // Toggle Step 3, Step 4, and Step 5 Artifact Quick-Open Bars strictly when their step is completed
        if (step3ArtifactBar) {
            step3ArtifactBar.classList.toggle('hidden', !(ws.canRunStep4 && (ws.hasReviewReportMd || (ws.reviews && ws.reviews.length > 0))));
        }
        if (step4ArtifactBar) {
            step4ArtifactBar.classList.toggle('hidden', !ws.resolvedInCurrentRound);
            if (btnOpenStep4Diff) {
                btnOpenStep4Diff.classList.toggle('hidden', !ws.hasStep4Diff);
            }
        }
        if (step5ImplArtifactBar) {
            step5ImplArtifactBar.classList.toggle('hidden', !ws.hasImplementationGuide);
        }
        if (step5DriftArtifactBar) {
            step5DriftArtifactBar.classList.toggle('hidden', !ws.hasDriftReport);
        }
        if (sitemapArtifactGroup) {
            sitemapArtifactGroup.classList.toggle('hidden', !ws.hasSitemapMd);
        }
        if (btnOpenWebResearchJson) {
            btnOpenWebResearchJson.classList.toggle('hidden', !(ws.webResearch && ws.webResearch.length > 0));
        }

        // Goldfish paraphrase box
        if (ws.goldfishParaphrase && ws.goldfishParaphrase.trim()) {
            paraphraseBox.classList.remove('hidden');
            paraphraseText.textContent = ws.goldfishParaphrase;
        } else {
            paraphraseBox.classList.add('hidden');
        }

        renderReadinessDashboard(ws);
        renderReviews(ws.reviews || [], ws.reviewRoundCount || 1);
        renderWebResearch(ws.webResearch || []);

        const approved = ws.approvedSpecs || [];
        if (approved.length > 0 || ws.hasSitemapMd) {
            approvedSpecsBox.classList.remove('hidden');
            approvedSpecsList.innerHTML = '';
            approved.forEach((relPath) => {
                const li = document.createElement('li');
                li.className = 'approved-spec-item';

                const nameSpan = document.createElement('span');
                nameSpan.className = 'approved-spec-name';
                nameSpan.textContent = '📄 ' + relPath;

                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'artifact-btn-group';

                const openBtn = document.createElement('button');
                openBtn.type = 'button';
                openBtn.className = 'mini-cta-btn';
                openBtn.textContent = currentLang === 'en' ? '📄 Open' : '📄 開く';
                openBtn.addEventListener('click', () => {
                    vscode.postMessage({ type: 'openFile', relativePath: relPath, previewMode: false });
                });

                const prevBtn = document.createElement('button');
                prevBtn.type = 'button';
                prevBtn.className = 'mini-cta-btn secondary';
                prevBtn.textContent = currentLang === 'en' ? '👁️ Preview' : '👁️ 見やすく表示';
                prevBtn.addEventListener('click', () => {
                    vscode.postMessage({ type: 'openFile', relativePath: relPath, previewMode: true });
                });

                actionsDiv.appendChild(openBtn);
                actionsDiv.appendChild(prevBtn);
                li.appendChild(nameSpan);
                li.appendChild(actionsDiv);
                approvedSpecsList.appendChild(li);
            });
        } else {
            approvedSpecsBox.classList.add('hidden');
        }
    }

        function formatInlineBackticks(text) {
            const escaped = String(text || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            return escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
        }

        function renderReadinessDashboard(ws) {
            if (!readinessScoreBox) return;
            const reviews = (ws && ws.reviews) || [];
            if (reviews.length === 0) {
                readinessScoreBox.classList.add('hidden');
                return;
            }
            readinessScoreBox.classList.remove('hidden');

            const isEn = currentLang === 'en';
            const openItems = reviews.filter((r) => !r.resolved);
            const critHighOpen = openItems.filter((r) => {
                const s = String(r.severity || '').toLowerCase();
                return s === 'critical' || s === 'high';
            }).length;
            const score = ws.readinessScore || 75;
            const isPass = critHighOpen === 0 || ws.reviewVerdict === 'PASS';
            const round = ws.reviewRoundCount || 1;

            readinessScoreBox.classList.toggle('needs-revision', !isPass);
            if (lblReadinessScoreVal) {
                lblReadinessScoreVal.textContent = `${score}%`;
            }
            if (readinessMeterFill) {
                readinessMeterFill.style.width = `${Math.max(15, Math.min(100, score))}%`;
            }
            if (lblReadinessVerdict) {
                lblReadinessVerdict.classList.toggle('revision', !isPass);
                lblReadinessVerdict.textContent = isPass
                    ? isEn
                        ? '🎉 PASS (Ready to Approve)'
                        : '🎉 合格・承認推奨 (PASS)'
                    : isEn
                        ? `⚠️ ${critHighOpen} Critical/High Open`
                        : `⚠️ 重要課題 残り${critHighOpen}件`;
            }
            if (lblStopGuideText) {
                if (isPass) {
                    lblStopGuideText.innerHTML = isEn
                        ? `✨ <strong>All Critical & High issues are resolved!</strong> Remaining Medium/Low items are optional polish. To avoid over-engineering, we recommend proceeding directly to <strong>Step 5 (Approve Spec)</strong>.`
                        : `✨ <strong>致命的な穴（Critical / High）はすべて解消されました！</strong> 残りの指摘は任意の微調整です。これ以上のループは過剰設計（Over-engineering）になりやすいため、<strong>このまま Step 5（最終承認）へ進むことを強く推奨します！</strong>`;
                } else if (round >= 2) {
                    lblStopGuideText.innerHTML = isEn
                        ? `💡 <strong>Round ${round}:</strong> Only Critical & High items are pre-checked below. Resolve those in Step 4, then proceed to Step 5!`
                        : `💡 <strong>第${round}ラウンド:</strong> 無限ループを防ぐため、本当に直すべき <strong>🚨 重要指摘（Critical / High）のみ自動でチェックON</strong> にしています。Step 4で反映したらStep 5へ進みましょう！`;
                } else {
                    lblStopGuideText.innerHTML = isEn
                        ? `👉 Keep the <strong>🚨 Critical / High</strong> items checked and click <strong>"✨ Resolve Selected" in Step 4</strong> (optional Medium/Low items can be unchecked).`
                        : `👉 まずは <strong>🚨 致命的・重要（Critical / High）</strong> を中心にチェックを入れたまま、<strong>Step 4 の「✨ 選択した指摘を設計書に反映」</strong> を押してください（細かい指摘はチェックを外してスキップ可能です）。`;
                }
            }
        }

        const SEVERITY_LABELS_JA = {
            Critical: '🚨 致命的 (Critical)',
            High: '⚠️ 重要 (High)',
            Medium: '💡 推奨 (Medium)',
            Low: '📌 軽微 (Low)'
        };

        const CATEGORY_LABELS_JA = {
            Comprehension: '📖 初見理解',
            'Edge Case': '⚡ 異常系・境界値',
            Consistency: '🧩 既存整合性',
            Security: '🛡️ セキュリティ',
            Readiness: '🚀 実装準備度'
        };

        function renderReviews(reviews, roundCount = 1) {
            reviewsList.innerHTML = '';
            if (!Array.isArray(reviews) || reviews.length === 0) {
                reviewsToolbar.classList.add('hidden');
                const p = document.createElement('p');
                p.className = 'empty-hint';
                p.textContent = t('emptyReviews');
                reviewsList.appendChild(p);
                return;
            }

            reviewsToolbar.classList.remove('hidden');
            const unresolvedCount = reviews.filter((r) => !r.resolved).length;
            const critHighCount = reviews.filter((r) => {
                const s = String(r.severity || '').toLowerCase();
                return !r.resolved && (s === 'critical' || s === 'high');
            }).length;

            lblReviewSummary.textContent =
                currentLang === 'en'
                ?`Findings: ${reviews.length} (${critHighCount} Critical/High, ${unresolvedCount} open)`
                : `全${reviews.length}件 （🚨重要: ${critHighCount}件 / 未解決: ${unresolvedCount}件）`;

            reviews.forEach((item) => {
                const sev = item.severity || 'Medium';
                const sevLower = String(sev).toLowerCase();
                const isCritOrHigh = sevLower === 'critical' || sevLower === 'high';

                const card = document.createElement('div');
                card.className = `review-card sev-card-${sev}` + (item.resolved ? ' resolved' : '');

                const header = document.createElement('div');
                header.className = 'review-card-header';

                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.className = 'review-checkbox';
                cb.setAttribute('data-review-id', item.id);
                cb.setAttribute('data-severity', sev);
                cb.setAttribute('data-resolved', item.resolved ? 'true' : 'false');
                // Restore saved checkbox selection across reloads, or use smart default (Critical/High from Round 2+)
                if (Array.isArray(persistedSelectedReviewIds)) {
                    cb.checked = !item.resolved && persistedSelectedReviewIds.includes(item.id);
                } else if (item.resolved) {
                    cb.checked = false;
                } else if (roundCount >= 2) {
                    cb.checked = isCritOrHigh;
                } else {
                    cb.checked = sevLower !== 'low';
                }
                cb.addEventListener('change', () => {
                    persistSelectedReviewIdsFromDom();
                });

                const badges = document.createElement('div');
                badges.className = 'review-badges';

                const idSpan = document.createElement('code');
                idSpan.textContent = item.id;

                const sevSpan = document.createElement('span');
                sevSpan.className = `sev-badge sev-${sev}`;
                sevSpan.textContent =
                    currentLang === 'en' ? sev : SEVERITY_LABELS_JA[sev] || sev;

                const catSpan = document.createElement('span');
                catSpan.className = 'cat-badge';
                const rawCat = item.category || 'Review';
                catSpan.textContent =
                    currentLang === 'en' ? rawCat : CATEGORY_LABELS_JA[rawCat] || rawCat;

                badges.appendChild(idSpan);
                badges.appendChild(sevSpan);
                badges.appendChild(catSpan);

                if (item.resolved) {
                    const resSpan = document.createElement('span');
                    resSpan.className = 'resolved-badge';
                    resSpan.textContent = t('resolvedBadge');
                    badges.appendChild(resSpan);
                }

                header.appendChild(cb);
                header.appendChild(badges);
                header.addEventListener('click', (e) => {
                    if (e.target !== cb) {
                        cb.checked = !cb.checked;
                        persistSelectedReviewIdsFromDom();
                    }
                });

                const title = document.createElement('div');
                title.className = 'review-title';
                title.innerHTML = formatInlineBackticks(item.title || '');

                card.appendChild(header);
                card.appendChild(title);

                // 1-line easy summary (or concise first sentence of description)
                const fullDesc = String(item.description || '').trim();
                const firstSentenceMatch = fullDesc.match(/^(.+?。|.+?\.\s)/);
                const autoShortSummary =
                    item.summary && item.summary.trim()
                        ? item.summary.trim()
                        : firstSentenceMatch && firstSentenceMatch[1].length < fullDesc.length
                            ? firstSentenceMatch[1]
                            : fullDesc.length > 110
                                ? fullDesc.slice(0, 110) + '…'
                                : fullDesc;

                if (autoShortSummary) {
                    const sumDiv = document.createElement('div');
                    sumDiv.className = 'review-summary-line';
                    sumDiv.innerHTML = '📌 ' + formatInlineBackticks(autoShortSummary);
                    card.appendChild(sumDiv);
                }

                if (item.suggestion) {
                    const sug = document.createElement('div');
                    sug.className = 'review-suggestion';
                    sug.innerHTML = `<strong>${t('suggestionPrefix')}</strong>` + formatInlineBackticks(item.suggestion);
                    card.appendChild(sug);
                }

                // Collapsible full technical details so the card stays super clean & easy to read
                if (fullDesc && (item.summary || fullDesc.length > 95)) {
                    const detailsEl = document.createElement('details');
                    detailsEl.className = 'review-detail-toggle';
                    const sumEl = document.createElement('summary');
                    sumEl.textContent =
                        currentLang === 'en' ? '🔍 View technical details & reason' : '🔍 詳しい理由・該当箇所を見る（開閉）';
                    const desc = document.createElement('div');
                    desc.className = 'review-desc';
                    desc.innerHTML = formatInlineBackticks(fullDesc);
                    detailsEl.appendChild(sumEl);
                    detailsEl.appendChild(desc);
                    card.appendChild(detailsEl);
                }

                reviewsList.appendChild(card);
            });
        }

        function renderWebResearch(items) {
            const list = Array.isArray(items) ? items : [];
            lblWebCount.textContent = String(list.length);
            webResearchList.innerHTML = '';

            if (list.length === 0) {
                const li = document.createElement('li');
                li.className = 'research-snippet';
                li.textContent = t('noWebData');
                webResearchList.appendChild(li);
                return;
            }

            list.forEach((item) => {
                const li = document.createElement('li');
                const a = document.createElement('a');
                a.href = item.url;
                a.textContent = `[${item.source}] ${item.title}`;
                a.target = '_blank';

                const snip = document.createElement('div');
                snip.className = 'research-snippet';
                snip.textContent = (item.snippet || '').slice(0, 140) + (item.snippet && item.snippet.length > 140 ? '…' : '');

                li.appendChild(a);
                li.appendChild(snip);
                webResearchList.appendChild(li);
            });
        }

        window.addEventListener('message', (event) => {
            const msg = event.data;
            if (!msg) return;

            if (msg.type === 'loading') {
                if (msg.isLoading) {
                    // Move loadingBanner directly above the currently active step card (or Step 1)
                    const targetCard =
                        (activeThinkingBtn && activeThinkingBtn.closest('.step-card')) ||
                        document.querySelector('.step-card.active-step-card') ||
                        document.getElementById('secStep1');
                    if (targetCard && targetCard.parentNode) {
                        targetCard.parentNode.insertBefore(loadingBanner, targetCard);
                    }
                    startRichLoadingTelemetry(msg.text || '...', msg.operationKey || '');
                    loadingBanner.classList.remove('hidden');
                } else {
                    stopRichLoadingTelemetry();
                    loadingBanner.classList.add('hidden');
                    clearButtonThinking();
                }
                return;
            }

            if (msg.type === 'error') {
                stopRichLoadingTelemetry();
                const targetCard =
                    (activeThinkingBtn && activeThinkingBtn.closest('.step-card')) ||
                    document.querySelector('.step-card.active-step-card') ||
                    document.getElementById('secStep1');
                if (targetCard && targetCard.parentNode) {
                    targetCard.parentNode.insertBefore(errorBanner, targetCard);
                }
                clearButtonThinking();
                errorText.textContent = msg.message || 'Error';
                errorBanner.classList.remove('hidden');
                return;
            }

            if (msg.type === 'modelsListResult') {
                if (msg.provider && Array.isArray(msg.models) && msg.models.length > 0) {
                    MODEL_PRESETS[msg.provider] = msg.models;
                    if (msg.fromLiveApi) {
                        LIVE_API_FETCHED[msg.provider] = true;
                    }
                    renderModelPresets(selProvider.value);
                    renderGoldfishPresets();
                    updateFetchButtonStatus(selProvider.value);
                }
                return;
            }

            if (msg.type === 'allModelsListResult') {
                if (msg.modelsByProvider && typeof msg.modelsByProvider === 'object') {
                    Object.keys(msg.modelsByProvider).forEach((prov) => {
                        const entry = msg.modelsByProvider[prov];
                        if (entry && Array.isArray(entry.models) && entry.models.length > 0) {
                            MODEL_PRESETS[prov] = entry.models;
                            if (entry.fromLiveApi) {
                                LIVE_API_FETCHED[prov] = true;
                            }
                        }
                    });
                    renderModelPresets(selProvider.value);
                    renderGoldfishPresets();
                    updateFetchButtonStatus(selProvider.value);
                }
                return;
            }

            if (msg.type === 'stateUpdate') {
                const { language, providerSummary, workspaceStatus, settings } = msg.payload;
                lastProviderSummary = providerSummary;
                lastWorkspaceStatus = workspaceStatus;

                if (language) {
                    applyTranslations(language);
                }
                if (providerSummary) {
                    renderProviderInfo(providerSummary);
                }
                if (settings) {
                    chkAutoWebSearch.checked = Boolean(settings.webSearchEnabled);
                    chkNativeGrounding.checked = Boolean(settings.nativeGrounding);
                    selGoldfishProvider.value = settings.rawGoldfishProvider || 'same';
                    inpGoldfishModel.value = settings.rawGoldfishModel || '';
                    renderGoldfishPresets();
                }
                if (workspaceStatus) {
                    renderWorkspaceInfo(workspaceStatus);
                }
            }
        });

        applyTranslations(currentLang);
        vscode.postMessage({ type: 'init' });
    }) ();
