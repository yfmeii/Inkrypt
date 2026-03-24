type VaultEditorHeaderProps = {
  draftTitle: string
  setDraftTitle: (value: string) => void
  draftFavorite: boolean
  setDraftFavorite: (value: boolean) => void
  busy: boolean
  attachmentsBusy: boolean
  selectedBaselineReady: boolean
  dirty: boolean
  busyText: string | null
  onSave: () => void
  onDelete: () => void
  onOpenAttachments: () => void
}

export function VaultEditorHeader({
  draftTitle,
  setDraftTitle,
  draftFavorite,
  setDraftFavorite,
  busy,
  attachmentsBusy,
  selectedBaselineReady,
  dirty,
  busyText,
  onSave,
  onDelete,
  onOpenAttachments,
}: VaultEditorHeaderProps) {
  const favoriteLabel = draftFavorite ? '取消收藏' : '收藏'
  const favoriteDisabled = busy || attachmentsBusy || !selectedBaselineReady

  return (
    <div className="editorTitleBar">
      <input
        className="titleInput"
        value={draftTitle}
        onChange={(event) => setDraftTitle(event.target.value)}
        placeholder="未命名"
        aria-label="标题"
        disabled={favoriteDisabled}
      />
      <div className="editorTitleActions">
        <button
          className={draftFavorite ? 'iconBtn active' : 'iconBtn'}
          data-label={favoriteLabel}
          onClick={() => setDraftFavorite(!draftFavorite)}
          type="button"
          title={favoriteLabel}
          aria-label={favoriteLabel}
          aria-pressed={draftFavorite}
          disabled={favoriteDisabled}
        >
          {draftFavorite ? (
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.01 4.38.38-3.32 2.88 1 4.28L12 15.4z" />
            </svg>
          )}
        </button>
        <button
          className="iconBtn"
          onClick={onOpenAttachments}
          disabled={favoriteDisabled}
          type="button"
          title="附件"
          aria-label="附件"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M16.5 6.5v8.75a4.25 4.25 0 1 1-8.5 0V6.75a2.75 2.75 0 0 1 5.5 0V15a1.25 1.25 0 1 1-2.5 0V8.5h-1.5V15a2.75 2.75 0 1 0 5.5 0V6.75a4.25 4.25 0 0 0-8.5 0v8.5a5.75 5.75 0 1 0 11.5 0V6.5z" />
          </svg>
        </button>
        <button
          className="iconBtn"
          onClick={onSave}
          onMouseDown={(event) => event.preventDefault()}
          disabled={busy || !dirty}
          type="button"
          title="保存并同步到云端"
          aria-label="保存"
          style={{ marginLeft: 'auto' }}
        >
          {busy && busyText === '正在上传…' ? (
            <span className="spinner" aria-hidden="true" />
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z" />
            </svg>
          )}
        </button>
        <button
          className="iconBtn"
          onClick={onDelete}
          disabled={busy || !selectedBaselineReady}
          type="button"
          title="删除笔记"
          aria-label="删除"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
          </svg>
        </button>
      </div>
    </div>
  )
}
