import { APP_NAME } from '../app-name.js'

export const common = {
  // Header
  'header.menu': { ja: 'メニュー', en: 'Menu', zh: '菜单'},
  'header.back': { ja: '戻る', en: 'Back', zh: '返回'},
  'header.modeSystem': { ja: 'システム', en: 'System', zh: '系统'},
  'header.modeDark': { ja: 'ダークモード', en: 'Dark', zh: '深色'},
  'header.modeLight': { ja: 'ライトモード', en: 'Light', zh: '浅色'},
  'header.title': { ja: APP_NAME, en: APP_NAME, zh: APP_NAME },

  // Hint banners
  'hint.today': { ja: 'あなたの行動をもとにスコアリングされたおすすめ記事。AIに「今日何読む？」と聞くこともできます。', en: 'Articles scored by your engagement. You can also ask the AI "What should I read today?"', zh: '根据您的互动评分的文章。您也可以问 AI「今天读什么？」' },
  'hint.inbox': { ja: '未読記事だけが集まるOksskoltenの玄関口。既読にするとInboxには表示されなくなります。', en: 'The front door of Oksskolten, where only unread articles live. Once marked as read, they won\'t appear in Inbox anymore.', zh: 'Oksskolten 的入口，只有未读文章。标为已读后将不再出现在收件箱中。' },
  'hint.bookmarks': { ja: '気になる記事を一旦キープ。あとで読みたいときに使えます。', en: 'Keep articles for later. A quick way to save something you want to come back to.', zh: '保留文章以便稍后阅读。快速保存您想回来看的内容。' },
  'hint.likes': { ja: 'いいねした記事がここに。検索やレコメンドのスコアリングにも反映されます。', en: 'Articles you\'ve liked live here. Likes also boost search and recommendation scoring.', zh: '您点赞的文章在这里。点赞也会提升搜索和推荐评分。' },
  'hint.clips': { ja: 'フィードを追跡するほどじゃない相手の記事を、URL指定で個別に保存できます。', en: 'Save individual articles by URL — perfect for sources you don\'t need a full feed for.', zh: '通过 URL 保存单篇文章 — 适合不需要完整订阅的来源。' },
  'hint.history': { ja: '記事を開いて読んだ履歴。「スクロールで自動既読」で流れたものは含まず、実際に開いた記事だけが残ります。', en: 'Articles you actually opened and read. Items swept away by "Auto-Mark As Read On Scroll" aren\'t included — only articles you tapped into.', zh: '您实际打开并阅读的文章。「滚动时自动标为已读」跳过的不包括在内 — 只有您点进去看的文章。' },
  'date.justNow': { ja: 'たった今', en: 'just now', zh: '刚刚'},

  // Sidebar menu
  'sidebar.settings': { ja: '設定', en: 'Settings', zh: '设置'},

  // ConfirmDialog
  'confirm.cancel': { ja: 'キャンセル', en: 'Cancel', zh: '取消'},

  // Logout
  'sidebar.logout': { ja: 'ログアウト', en: 'Log out', zh: '退出登录'},

  // Home page — time-based greetings
  'home.greeting.morning': { ja: 'おはよう、{name}', en: 'Good morning, {name}', zh: '早上好，{name}'},
  'home.greeting.afternoon': { ja: 'こんにちは、{name}', en: 'Good afternoon, {name}', zh: '下午好，{name}'},
  'home.greeting.evening': { ja: 'こんばんは、{name}', en: 'Good evening, {name}', zh: '晚上好，{name}'},
  // Home page — random fallback (outside greeting windows)
  'home.greeting.random.0': { ja: '何について調べましょうか？', en: 'What would you like to explore?', zh: '想探索些什么？'},
  'home.greeting.random.1': { ja: '今日はどんな記事を読みますか？', en: 'What would you like to read today?', zh: '今天想读什么？'},
  'home.greeting.random.2': { ja: '何かお手伝いできることはありますか？', en: 'How can I help you?', zh: '有什么我能帮忙的？'},
  'home.greeting.random.3': { ja: '気になるトピックはありますか？', en: 'Any topics on your mind?', zh: '有什么感兴趣的话题吗？'},
  'home.greeting.random.4': { ja: '何から始めましょうか？', en: 'Where shall we start?', zh: '从哪里开始？'},
  'home.placeholder': { ja: '記事について何でも聞いてください...', en: 'Ask anything about your articles...', zh: '随便问关于文章的问题...'},
  'home.chatHistory': { ja: 'チャット履歴', en: 'Chat history', zh: '聊天历史'},
  // Command Palette
  'command.navigation': { ja: 'ナビゲーション', en: 'Navigation', zh: '导航'},
  'command.actions': { ja: 'アクション', en: 'Actions', zh: '操作'},
  'command.feeds': { ja: 'フィード', en: 'Feeds', zh: '订阅源'},
  'command.appearance': { ja: '外観', en: 'Appearance', zh: '外观'},
  'command.placeholder': { ja: 'コマンドを入力...', en: 'Type a command or search...', zh: '输入命令或搜索...'},
  'command.noResults': { ja: '結果が見つかりません', en: 'No results found.', zh: '未找到结果。'},
  'command.searchArticles': { ja: '記事を検索', en: 'Search articles', zh: '搜索文章'},
  'command.addFeed': { ja: 'フィードを追加', en: 'Add new feed', zh: '添加新订阅源'},
  'command.importOpml': { ja: 'OPML インポート', en: 'Import OPML', zh: '导入 OPML'},
  'command.exportOpml': { ja: 'OPML エクスポート', en: 'Export OPML', zh: '导出 OPML'},
  'error.anthropicKeyNotSet': {
    ja: 'Anthropic API キーが設定されていません。',
    en: 'Anthropic API key is not configured.',
    zh: 'Anthropic API 密钥未配置。'
  },
  'error.geminiKeyNotSet': {
    ja: 'Gemini API キーが設定されていません。',
    en: 'Gemini API key is not configured.',
    zh: 'Gemini API 密钥未配置。'
  },
  'error.openaiKeyNotSet': {
    ja: 'OpenAI API キーが設定されていません。',
    en: 'OpenAI API key is not configured.',
    zh: 'OpenAI API 密钥未配置。'
  },
  'error.googleTranslateKeyNotSet': {
    ja: 'Google Translate API キーが設定されていません。',
    en: 'Google Translate API key is not configured.',
    zh: 'Google 翻译 API 密钥未配置。'
  },
  'error.deeplKeyNotSet': {
    ja: 'DeepL API キーが設定されていません。',
    en: 'DeepL API key is not configured.',
    zh: 'DeepL API 密钥未配置。'
  },
  'error.summarizationFailed': {
    ja: '要約に失敗しました。しばらくしてから再度お試しください。',
    en: 'Summarization failed. Please try again later.',
    zh: '摘要生成失败。请稍后重试。'
  },
  'error.translationFailed': {
    ja: '翻訳に失敗しました。しばらくしてから再度お試しください。',
    en: 'Translation failed. Please try again later.',
    zh: '翻译失败。请稍后重试。'
  },
  'error.goToSettings': {
    ja: '設定画面',
    en: 'Settings',
    zh: '设置'
  },
  'error.setApiKeyFromSettings': {
    ja: 'から API キーを入力してください。',
    en: ' to configure your API key.',
    zh: '中配置您的 API 密钥。'
  },

  // Search
  'search.title': { ja: '検索', en: 'Search', zh: '搜索'},
  'search.placeholder': { ja: '記事を検索...', en: 'Search articles...', zh: '搜索文章...'},
  'search.noResults': { ja: '一致する記事がありません', en: 'No matching articles', zh: '没有匹配的文章'},
  'search.indexBuilding': { ja: '検索インデックスを構築中です…', en: 'Building search index…', zh: '正在构建搜索索引…'},
  'search.hint': { ja: '↑↓ 移動 · Enter 開く · Esc 閉じる', en: '↑↓ navigate · Enter open · Esc close', zh: '↑↓ 导航 · Enter 打开 · Esc 关闭'},
  'search.filterBookmarked': { ja: 'あとで読む', en: 'Read Later', zh: '稍后阅读'},
  'search.filterLiked': { ja: 'いいね', en: 'Liked', zh: '已点赞'},
  'search.filterUnread': { ja: '未読', en: 'Unread', zh: '未读'},
  'search.period.today': { ja: '今日', en: 'Today', zh: '今天'},
  'search.period.week': { ja: '1週間', en: 'Week', zh: '周'},
  'search.period.month': { ja: '1ヶ月', en: 'Month', zh: '月'},
  'about.version': { ja: 'バージョン', en: 'Version', zh: '版本'},
  'about.github': { ja: 'GitHub', en: 'GitHub', zh: 'GitHub'},
  'about.issues': { ja: 'フィードバック', en: 'Feedback', zh: '反馈'},
  'about.commit': { ja: 'コミット', en: 'Commit', zh: '提交'},
  'about.buildDate': { ja: 'ビルド日時', en: 'Build Date', zh: '构建日期'},

  // Toast
  'toast.fetchedArticles': { ja: '${name}: ${count}件の新しい記事を取得', en: '${name}: Fetched ${count} new articles', zh: '${name}：获取了 ${count} 篇新文章'},
  'toast.noNewArticles': { ja: '${name}: 新着なし', en: '${name}: No new articles', zh: '${name}：无新文章'},
  'toast.fetchError': { ja: '${name}: フェッチに失敗しました', en: '${name}: Fetch failed', zh: '${name}：获取失败'},
  'toast.newVersion': { ja: '新しいバージョンが利用可能です', en: 'A new version is available', zh: '有新版本可用'},
  'toast.reload': { ja: '更新', en: 'Reload', zh: '重新加载'},
  'hint.smart': { ja: '保存した検索がフォルダになります。クエリに一致する新しい記事は自動的にここに現れます。', en: 'A saved search that behaves like a folder: new articles matching the query appear here on their own.', zh: '保存的搜索会像文件夹一样：匹配查询的新文章会自动出现在这里。'},
  'hint.stories': { ja: '複数のフィードが同じ出来事を報じたとき、それらは1つのストーリーにまとまります。ソースの数が多い順に並びます。', en: 'When several feeds report the same event they are folded into one story, ranked by how many sources covered it.', zh: '当多个订阅源报道同一事件时，它们会合并为一条新闻，按来源数量排序。'},
  'hint.recommended': { ja: 'いいね・ブックマーク・開いた記事から学んだ関心プロファイルに基づく未読記事。設定の「関心」で確認・調整できます。', en: 'Unread articles ranked by the interest profile learned from what you like, bookmark and open. Review and tune it under Settings → Your interests.', zh: '根据您点赞、收藏和打开的文章学习到的兴趣画像排序的未读文章。可在设置 → 我的兴趣中查看和调整。'},
} as const
