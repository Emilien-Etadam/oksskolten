export const feeds = {

  // FeedList
  'feeds.title': { ja: 'フィード', en: 'Feeds', zh: '订阅源'},
  'feeds.inbox': { ja: 'Inbox', en: 'Inbox', zh: '收件箱'},
  'feeds.add': { ja: 'フィード', en: 'Feed', zh: '订阅源'},
  'feeds.theme': { ja: 'テーマ', en: 'Theme', zh: '主题'},
  'feeds.colorMode': { ja: 'カラーモード', en: 'Color mode', zh: '颜色模式'},
  'feeds.rename': { ja: '名前を変更', en: 'Rename', zh: '重命名'},
  'feeds.markAllRead': { ja: 'すべて既読にする', en: 'Mark all as read', zh: '全部标为已读'},
  'feeds.delete': { ja: '削除', en: 'Delete', zh: '删除'},
  'feeds.deleteFeed': { ja: 'フィードを削除', en: 'Delete Feed', zh: '删除订阅源'},
  'feeds.reEnableFeed': { ja: 'フィードを再有効化', en: 'Re-enable Feed', zh: '重新启用订阅源'},
  'feeds.deleteConfirm': {
    ja: '${name} を削除しますか？紐づく記事もすべて削除されます。',
    en: 'Delete ${name}? All associated articles will also be deleted.',
    zh: '确定删除 ${name}？所有关联的文章也将被删除。'
  },
  'feeds.reEnableConfirm': {
    ja: 'このフィードは連続エラーにより無効化されています。再有効化しますか？',
    en: 'This feed was disabled due to repeated errors. Re-enable it?',
    zh: '此订阅源因多次错误被禁用。是否重新启用？'
  },
  'feeds.enable': { ja: '有効化', en: 'Enable', zh: '启用'},
  'feeds.bookmarks': { ja: 'あとで読む', en: 'Read Later', zh: '稍后阅读'},
  'feeds.likes': { ja: 'いいね', en: 'Liked', zh: '已点赞'},
  'feeds.today': { ja: 'Today', en: 'Today', zh: '今天'},
  'feeds.history': { ja: '読んだ記事', en: 'Read', zh: '已读'},
  'feeds.fetch': { ja: 'フェッチ', en: 'Fetch articles', zh: '获取文章'},
  'category.fetchAll': { ja: 'すべてフェッチ', en: 'Fetch all feeds', zh: '获取所有订阅源'},
  'feeds.reDetect': { ja: 'RSS を再検出', en: 'Re-detect RSS', zh: '重新检测 RSS'},
  'feeds.aiFilter': { ja: 'AI フィルタ', en: 'AI filter', zh: 'AI 过滤'},
  'feeds.archiveImages': { ja: '画像を自動アーカイブ', en: 'Auto-archive images', zh: '自动存档图片'},
  'feeds.aiFilterDescription': { ja: '${feed} の記事のうち、条件に合わないものを自動的に非表示にします。', en: 'Hide articles from ${feed} that do not match your criterion.', zh: '自动隐藏 ${feed} 中不符合条件的文章。'},
  'feeds.aiFilterPlaceholder': { ja: '例: セルフホスティングとホームオートメーションに関する記事のみ。雑談は除く。', en: 'e.g. Only posts about self-hosting and home automation. Skip chit-chat.', zh: '例如：仅保留自托管和智能家居相关内容，排除闲聊。'},
  'feeds.aiFilterHint': { ja: 'ローカルモデルが各記事を判定します。空欄でフィルタを無効化。', en: 'Your local model judges each article. Leave empty to disable the filter.', zh: '由本地模型判断每篇文章。留空则禁用过滤。'},
  'feeds.clips': { ja: 'クリップ', en: 'Clips', zh: '剪藏'},
  'feeds.clipArticle': { ja: '記事をクリップ', en: 'Clip Article', zh: '剪藏文章'},
  'feeds.articleUrlPlaceholder': { ja: '記事のURLを入力', en: 'Enter article URL', zh: '输入文章 URL'},
  'modal.clipExistsInFeed': {
    ja: 'この記事はフィード「',
    en: 'This article already exists in feed "',
    zh: '此文章已存在于订阅源「'
  },
  'modal.clipExistsInFeedSuffix': {
    ja: '」に登録済みです',
    en: '"',
    zh: '」中'
  },
  'modal.clipViewArticle': {
    ja: '記事を見る',
    en: 'View article',
    zh: '查看文章'
  },
  'modal.clipAlreadyExists': {
    ja: 'この記事はすでにクリップに保存されています',
    en: 'This article is already saved in Clips',
    zh: '此文章已保存在剪藏中'
  },
  'modal.clipMoveToClips': { ja: 'クリップに移動', en: 'Move to Clips', zh: '移至剪藏'},
  'modal.clipContentPending': {
    ja: '記事を追加しました。本文は取得中です',
    en: 'Article added — its content is still loading',
    zh: '已添加文章 — 正在获取正文'
  },

  // FeedErrorBanner - pipeline stages
  'feedError.stage.discovery': { ja: 'RSS検出', en: 'RSS Discovery', zh: 'RSS 发现'},
  'feedError.stage.bridge': { ja: 'Bridge変換', en: 'Bridge', zh: '桥接'},
  'feedError.stage.fetch': { ja: '記事取得', en: 'Fetch', zh: '获取'},
  'feedError.stage.parse': { ja: '解析', en: 'Parse', zh: '解析'},

  // FeedErrorBanner - error explanations
  'feedError.noRssUrl': {
    ja: 'このサイトからRSSフィードのURLを検出できませんでした。サイトがRSSを提供していない可能性があります。「RSSを再検出」でRSS Bridge経由の取得を試みることができます。',
    en: 'Could not detect an RSS feed URL from this site. The site may not provide RSS. Try "Re-detect RSS" to attempt fetching via RSS Bridge.',
    zh: '无法从此站点检测到 RSS 订阅源 URL。该站点可能不提供 RSS。尝试「重新检测 RSS」以通过 RSS Bridge 获取。'
  },
  'feedError.flareSolverrFailed': {
    ja: 'このサイトはBot検出（Cloudflare等）で保護されており、突破に失敗しました。しばらく時間をおいてから「再取得」を試してください。',
    en: 'This site is protected by bot detection (e.g. Cloudflare) and bypass failed. Wait a moment and try "Retry Fetch".',
    zh: '此站点受机器人检测（如 Cloudflare）保护，绕过失败。请稍等片刻后尝试「重试获取」。'
  },
  'feedError.httpError': {
    ja: 'サーバーからHTTPエラー（${code}）が返されました。サイトが一時的にダウンしているか、URLが変更された可能性があります。',
    en: 'The server returned HTTP error (${code}). The site may be temporarily down or the URL may have changed.',
    zh: '服务器返回 HTTP 错误（${code}）。站点可能暂时不可用或 URL 已更改。'
  },
  'feedError.parseFailed': {
    ja: 'フィードのXMLを解析できませんでした。フィードの形式が壊れているか、RSS/Atom形式でない可能性があります。「RSSを再検出」で別のフィードソースを探すことができます。',
    en: 'Could not parse the feed XML. The feed format may be broken or not RSS/Atom. Try "Re-detect RSS" to find an alternative feed source.',
    zh: '无法解析订阅源 XML。订阅源格式可能损坏或不是 RSS/Atom 格式。尝试「重新检测 RSS」查找替代订阅源。'
  },
  'feedError.cssBridgeFailed': {
    ja: 'CSSセレクタによるスクレイピングで記事を抽出できませんでした。サイトの構造が変わった可能性があります。「RSSを再検出」でセレクタを再推論できます。',
    en: 'Failed to extract articles via CSS selector scraping. The site structure may have changed. Try "Re-detect RSS" to re-infer the selector.',
    zh: '通过 CSS 选择器抓取文章失败。站点结构可能已更改。尝试「重新检测 RSS」以重新推断选择器。'
  },
  'feedError.unknown': {
    ja: 'フィードの取得中に予期しないエラーが発生しました。しばらく待ってから「再取得」を試してください。',
    en: 'An unexpected error occurred while fetching the feed. Wait a moment and try "Retry Fetch".',
    zh: '获取订阅源时发生意外错误。请稍等片刻后尝试「重试获取」。'
  },

  // FeedErrorBanner - actions & states
  'feedError.reDetect': { ja: 'RSSを再検出', en: 'Re-detect RSS', zh: '重新检测 RSS'},
  'feedError.retry': { ja: '再取得', en: 'Retry Fetch', zh: '重试获取'},
  'feedError.processing': { ja: '記事を取得しています…', en: 'Fetching articles…', zh: '正在获取文章…'},

  // AddModal (unified)
  'modal.addNew': { ja: 'はじめる', en: 'Get Started', zh: '开始使用'},
  'modal.addFeedOption': { ja: 'フィード', en: 'Feed', zh: '订阅源'},
  'modal.addFeedDesc': { ja: 'URLからRSSフィードを追加', en: 'Add an RSS feed from a URL', zh: '从 URL 添加 RSS 订阅源'},
  'modal.clipArticleOption': { ja: 'クリップ', en: 'Clip', zh: '剪藏'},
  'modal.clipArticleDesc': { ja: 'URLから記事を取得してクリップ', en: 'Clip an article from a URL', zh: '从 URL 剪藏文章'},
  'modal.addFolderOption': { ja: 'フォルダ', en: 'Folder', zh: '文件夹'},
  'modal.addFolderDesc': { ja: 'フィードを整理するフォルダを作成', en: 'Create a folder to organize feeds', zh: '创建文件夹来整理订阅源'},
  'modal.addFolder': { ja: 'フォルダを追加', en: 'Add Folder', zh: '添加文件夹'},
  'modal.folderNamePlaceholder': { ja: 'フォルダ名', en: 'Folder name', zh: '文件夹名称'},
  'modal.create': { ja: '作成', en: 'Create', zh: '创建'},
  'modal.creating': { ja: '作成中...', en: 'Creating...', zh: '创建中...'},

  // FeedModal
  'modal.addFeed': { ja: 'フィードを追加', en: 'Add Feed', zh: '添加订阅源'},
  'modal.url': { ja: 'URL', en: 'URL', zh: 'URL'},
  'modal.discovering': { ja: '取得中...', en: 'Fetching...', zh: '获取中...'},
  'modal.namePlaceholder': { ja: '名前（自動取得）', en: 'Name (auto-detected)', zh: '名称（自动检测）'},
  'modal.cancel': { ja: 'キャンセル', en: 'Cancel', zh: '取消'},
  'modal.adding': { ja: '追加中...', en: 'Adding...', zh: '添加中...'},
  'modal.add': { ja: '追加', en: 'Add', zh: '添加'},
  'modal.errorRssNotDetected': { ja: 'このURLからRSSフィードを検出できませんでした', en: 'RSS could not be detected for this URL', zh: '无法从此 URL 检测到 RSS'},
  'modal.errorAlreadyExists': { ja: 'このフィードは既に登録されています', en: 'This feed already exists', zh: '此订阅源已存在'},
  'modal.errorHttpOrHttpsOnly': { ja: 'http:// または https:// で始まるURLのみ対応しています', en: 'Only http:// or https:// URLs are allowed', zh: '仅支持以 http:// 或 https:// 开头的 URL'},
  'modal.genericError': { ja: 'エラーが発生しました', en: 'An error occurred', zh: '发生错误'},
  'modal.step.rssDiscovery': { ja: 'RSS 検出', en: 'RSS discovery', zh: 'RSS 发现'},
  'modal.step.flaresolverr': { ja: 'JSレンダリング', en: 'JS rendering', zh: 'JS 渲染'},
  'modal.step.rssBridge': { ja: 'RSS Bridge', en: 'RSS Bridge', zh: 'RSS 桥接'},
  'modal.step.cssSelector': { ja: 'CSS Selector（LLM）', en: 'CSS Selector (LLM)', zh: 'CSS 选择器（LLM）'},
  'modal.step.done': { ja: 'フィード作成完了', en: 'Feed created', zh: '订阅源已创建'},
  'modal.step.completed': { ja: '完了', en: 'Completed', zh: '已完成'},
  'modal.step.found': { ja: '検出', en: 'Found', zh: '已找到'},
  'modal.step.notFound': { ja: 'この段階では未検出', en: 'Not detected at this step', zh: '此步骤未检测到'},
  'modal.step.skipped': { ja: 'スキップ', en: 'Skipped', zh: '已跳过'},
  'modal.choiceTitle': { ja: 'サイト全体のRSSフィードが見つかりました', en: 'Found a site-wide RSS feed', zh: '找到全站 RSS 订阅源'},
  'modal.choiceWholeSite': { ja: 'サイト全体を購読', en: 'Subscribe to the whole site', zh: '订阅整个站点'},
  'modal.choiceThisPage': { ja: 'このページだけを購読', en: 'Subscribe to this page only', zh: '仅订阅此页面'},
  'modal.errorPageExtract': { ja: 'このページからコンテンツを抽出できませんでした', en: 'Could not extract content from this page', zh: '无法从此页面提取内容'},

  // Settings
  'feeds.dateFormat': { ja: '日付表示', en: 'Date', zh: '日期'},
  'feeds.dateRelative': { ja: '相対', en: 'Relative', zh: '相对'},
  'feeds.dateAbsolute': { ja: '絶対', en: 'Absolute', zh: '绝对'},
  'feeds.inactive': { ja: 'inactive', en: 'inactive', zh: '未活跃'},
  'metrics.articles': { ja: '記事', en: 'articles', zh: '篇文章'},
  'metrics.perWeek': { ja: '/週', en: '/wk', zh: '/周'},
  'metrics.lastUpdated': { ja: '最終更新', en: 'last', zh: '最近'},
  'metrics.inactive': { ja: '更新停止', en: 'inactive', zh: '未活跃'},
  'metrics.chars': { ja: '文字', en: 'chars', zh: '字符'},
  'metrics.preview': { ja: '12記事 · 2.1/週 · 3日前', en: '12 articles · 2.1/wk · 3d ago', zh: '12 篇文章 · 2.1/周 · 3 天前'},
  'refresh.action': { ja: '更新', en: 'Refresh', zh: '刷新'},
  'refresh.running': { ja: '取得中...', en: 'Fetching...', zh: '获取中...'},
  'refresh.done': { ja: '新着 ${count} 件', en: '${count} new articles', zh: '${count} 篇新文章'},
  'refresh.upToDate': { ja: '新着はありません', en: 'No new articles', zh: '没有新文章'},
  'refresh.failed': { ja: '取得に失敗しました', en: 'Fetch failed', zh: '获取失败'},

  // Categories
  'category.add': { ja: 'カテゴリを追加', en: 'Add category', zh: '添加分类'},
  'category.namePlaceholder': { ja: 'カテゴリ名', en: 'Category name', zh: '分类名称'},
  'category.rename': { ja: '名前を変更', en: 'Rename', zh: '重命名'},
  'category.delete': { ja: 'カテゴリを削除', en: 'Delete category', zh: '删除分类'},
  'category.deleteConfirm': {
    ja: '${name} を削除しますか？配下のフィードはトップに移動します。',
    en: 'Delete ${name}? Feeds will be moved to top.',
    zh: '确定删除 ${name}？订阅源将移至顶部。'
  },
  'category.markAllRead': { ja: 'すべて既読にする', en: 'Mark all as read', zh: '全部标为已读'},
  'category.moveToCategory': { ja: 'カテゴリに移動', en: 'Move to category', zh: '移动到分类'},
  'category.uncategorized': { ja: 'トップ', en: 'Top', zh: '顶部'},

  // Multi-select
  'feeds.selectedCount': { ja: '${count} 件選択中', en: '${count} feeds selected', zh: '已选择 ${count} 个'},
  'feeds.bulkMarkAllRead': { ja: 'すべて既読にする', en: 'Mark all as read', zh: '全部标为已读'},
  'feeds.bulkMoveToCategory': { ja: 'カテゴリに移動', en: 'Move to category', zh: '移动到分类'},
  'feeds.bulkFetch': { ja: 'フェッチ', en: 'Fetch articles', zh: '获取文章'},
  'feeds.bulkDelete': { ja: '${count} 件削除', en: 'Delete ${count} feeds', zh: '删除 ${count} 个订阅源'},
  'feeds.bulkDeleteConfirm': {
    ja: '${count} 件のフィードを削除しますか？紐づく記事もすべて削除されます。',
    en: 'Delete ${count} feeds? All associated articles will also be deleted.',
    zh: '确定删除 ${count} 个订阅源？所有关联的文章也将被删除。'
  },
} as const
