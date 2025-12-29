/**
 * BlockNote React 组件
 */

import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle, useMemo, useState } from 'react'
import { useCreateBlockNote, useBlockNoteEditor, useComponentsContext, useDictionary, useExtension, useExtensionState } from '@blocknote/react'
import { BlockNoteView, ShadCNDefaultComponents } from '@blocknote/shadcn'
import type { ShadCNComponents } from '@blocknote/shadcn'
import {
  FormattingToolbarController,
  FormattingToolbar,
  BasicTextStyleButton,
  BlockTypeSelect,
  ColorStyleButton,
  CreateLinkButton,
  NestBlockButton,
  UnnestBlockButton,
  TextAlignButton,
  SideMenuController,
  SideMenu,
  AddBlockButton,
  DragHandleMenu,
  SideMenuProps,
} from '@blocknote/react'
import { SideMenuExtension } from '@blocknote/core/extensions'
import { 
  Text, Heading1, Heading2, Heading3, Heading4, Heading5, Heading6,
  List, ListOrdered, CheckSquare, Code, Image, Video, FileAudio, File, Table, Quote, Trash2,
} from 'lucide-react'
import { zh } from '@blocknote/core/locales'
import type { BlockNoteEditor } from '@blocknote/core'
import * as Y from 'yjs'
import {
  DropdownMenu as AppDropdownMenu,
  DropdownMenuCheckboxItem as AppDropdownMenuCheckboxItem,
  DropdownMenuContent as AppDropdownMenuContent,
  DropdownMenuItem as AppDropdownMenuItem,
  DropdownMenuLabel as AppDropdownMenuLabel,
  DropdownMenuSeparator as AppDropdownMenuSeparator,
  DropdownMenuSub as AppDropdownMenuSub,
  DropdownMenuSubContent as AppDropdownMenuSubContent,
  DropdownMenuSubTrigger as AppDropdownMenuSubTrigger,
  DropdownMenuTrigger as AppDropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Button as AppButton } from './ui/button'
import { Toggle as AppToggle } from './ui/toggle'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/shadcn/style.css'
import '../blocknote.css'
import { markdownToBlocks, blocksToMarkdown } from '../lib/blocknote/converter'
import { useInkryptStore } from '../state/store'
import { YjsBlockNoteBinding } from '../lib/yjs/blockNoteBinding'

function getBlockTypeIcon(blockType: string, level?: number) {
  const iconSize = 18
  const iconProps = { size: iconSize, strokeWidth: 1.5 }
  
  switch (blockType) {
    case 'heading':
      switch (level) {
        case 1: return <Heading1 {...iconProps} />
        case 2: return <Heading2 {...iconProps} />
        case 3: return <Heading3 {...iconProps} />
        case 4: return <Heading4 {...iconProps} />
        case 5: return <Heading5 {...iconProps} />
        case 6: return <Heading6 {...iconProps} />
        default: return <Heading1 {...iconProps} />
      }
    case 'bulletListItem': return <List {...iconProps} />
    case 'numberedListItem': return <ListOrdered {...iconProps} />
    case 'checkListItem': return <CheckSquare {...iconProps} />
    case 'codeBlock': return <Code {...iconProps} />
    case 'image': return <Image {...iconProps} />
    case 'video': return <Video {...iconProps} />
    case 'audio': return <FileAudio {...iconProps} />
    case 'file': return <File {...iconProps} />
    case 'table': return <Table {...iconProps} />
    case 'quote': return <Quote {...iconProps} />
    default: return <Text {...iconProps} />
  }
}

function DeleteBlockMenuItem() {
  const editor = useBlockNoteEditor()
  const Components = useComponentsContext()!
  const sideMenu = useExtension(SideMenuExtension)
  const block = useExtensionState(SideMenuExtension, { selector: (state) => state?.block })
  
  if (!block) return null
  
  return (
    <Components.Generic.Menu.Item onClick={() => { editor.removeBlocks([block]); sideMenu.unfreezeMenu() }}>
      <Trash2 size={16} />
      删除
    </Components.Generic.Menu.Item>
  )
}

function BlockTypeDragHandle() {
  const Components = useComponentsContext()!
  const dict = useDictionary()
  const sideMenu = useExtension(SideMenuExtension)
  const block = useExtensionState(SideMenuExtension, { selector: (state) => state?.block })
  
  if (!block) return null
  
  const icon = getBlockTypeIcon(block.type, (block.props as { level?: number })?.level)
  
  return (
    <Components.Generic.Menu.Root
      onOpenChange={(open: boolean) => { open ? sideMenu.freezeMenu() : sideMenu.unfreezeMenu() }}
      position="left"
    >
      <Components.Generic.Menu.Trigger>
        <Components.SideMenu.Button
          label={dict.side_menu.drag_handle_label}
          draggable={true}
          onDragStart={(e) => sideMenu.blockDragStart(e, block)}
          onDragEnd={sideMenu.blockDragEnd}
          className="bn-button"
          icon={icon}
        />
      </Components.Generic.Menu.Trigger>
      <DragHandleMenu>
        <DeleteBlockMenuItem />
      </DragHandleMenu>
    </Components.Generic.Menu.Root>
  )
}

function CustomSideMenu(props: SideMenuProps) {
  const block = useExtensionState(SideMenuExtension, { selector: (state) => state?.block })
  const blockType = block?.type || 'paragraph'
  const blockLevel = (block?.props as { level?: number })?.level
  
  return (
    <div className="bn-side-menu-wrapper" data-block-type={blockType} data-level={blockLevel}>
      <SideMenu {...props}>
        <AddBlockButton />
        <BlockTypeDragHandle />
      </SideMenu>
    </div>
  )
}

export interface BlockNoteComponentProps {
  initialContent: string
  attachments: Record<string, string>
  onChange: (markdown: string) => void
  disabled?: boolean
  placeholder?: string
  onAddAttachment?: (file: File) => Promise<string>
  onDropFiles?: (files: File[]) => void
  onPasteFiles?: (files: File[]) => void
  onConversionError?: (error: Error, originalContent: string) => void
  // Yjs integration props
  yjsDoc?: Y.Doc
  onYjsDocChange?: (doc: Y.Doc) => void
}

export interface BlockNoteComponentRef {
  getMarkdown: () => string
  clear: () => void
  focus: () => void
  getEditor: () => BlockNoteEditor | null
  retry: () => void
}

function resolveAttachmentUrl(url: string, attachments: Record<string, string>): string {
  if (!url.startsWith('attachment:')) return url
  const name = url.slice('attachment:'.length)
  try {
    const decodedName = decodeURIComponent(name)
    if (Object.prototype.hasOwnProperty.call(attachments, decodedName)) return attachments[decodedName]
    if (Object.prototype.hasOwnProperty.call(attachments, name)) return attachments[name]
    return url
  } catch {
    if (Object.prototype.hasOwnProperty.call(attachments, name)) return attachments[name]
    return url
  }
}

function createAttachmentUploader(
  onAddAttachmentRef: React.MutableRefObject<((file: File) => Promise<string>) | undefined>
): (file: File) => Promise<string> {
  return async (file: File) => {
    const onAddAttachment = onAddAttachmentRef.current
    if (onAddAttachment) {
      try { return await onAddAttachment(file) }
      catch (error) { console.error('Failed to upload attachment:', error); throw error }
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsDataURL(file)
    })
  }
}

export const BlockNoteComponent = forwardRef<BlockNoteComponentRef, BlockNoteComponentProps>(
  function BlockNoteComponent(props, ref) {
    const { initialContent, attachments, onChange, disabled = false, placeholder = '请输入内容...', onAddAttachment, onDropFiles, onPasteFiles, onConversionError, yjsDoc, onYjsDocChange } = props
    const mode = useInkryptStore((state) => state.mode)
    
    const [isDark, setIsDark] = useState(() => {
      if (typeof window === 'undefined') return false
      if (mode === 'dark') return true
      if (mode === 'light') return false
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    })

    useEffect(() => {
      if (typeof window === 'undefined') return
      const updateDarkMode = () => {
        if (mode === 'dark') setIsDark(true)
        else if (mode === 'light') setIsDark(false)
        else setIsDark(window.matchMedia('(prefers-color-scheme: dark)').matches)
      }
      updateDarkMode()
      if (mode === 'system') {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
        const handler = () => updateDarkMode()
        if ('addEventListener' in mediaQuery) {
          mediaQuery.addEventListener('change', handler)
          return () => mediaQuery.removeEventListener('change', handler)
        } else {
          ;(mediaQuery as any).addListener(handler)
          return () => (mediaQuery as any).removeListener(handler)
        }
      }
    }, [mode])

    const attachmentsRef = useRef(attachments)
    const onAddAttachmentRef = useRef(onAddAttachment)
    const onChangeRef = useRef(onChange)
    const initialContentRef = useRef(initialContent)
    const [conversionError, setConversionError] = useState<{ error: Error; originalContent: string } | null>(null)
    const [retryCount, setRetryCount] = useState(0)

    const dictionary = useMemo(() => ({ ...zh, placeholders: { ...zh.placeholders, default: placeholder, emptyDocument: placeholder } }), [placeholder])

    const shadcnComponents = useMemo<Partial<ShadCNComponents>>(() => ({
      ...ShadCNDefaultComponents,
      Button: { ...ShadCNDefaultComponents.Button, Button: AppButton as typeof ShadCNDefaultComponents.Button.Button },
      Toggle: { ...ShadCNDefaultComponents.Toggle, Toggle: AppToggle as typeof ShadCNDefaultComponents.Toggle.Toggle },
      DropdownMenu: {
        ...ShadCNDefaultComponents.DropdownMenu,
        DropdownMenu: AppDropdownMenu as typeof ShadCNDefaultComponents.DropdownMenu.DropdownMenu,
        DropdownMenuCheckboxItem: AppDropdownMenuCheckboxItem as typeof ShadCNDefaultComponents.DropdownMenu.DropdownMenuCheckboxItem,
        DropdownMenuContent: AppDropdownMenuContent as typeof ShadCNDefaultComponents.DropdownMenu.DropdownMenuContent,
        DropdownMenuItem: AppDropdownMenuItem as typeof ShadCNDefaultComponents.DropdownMenu.DropdownMenuItem,
        DropdownMenuLabel: AppDropdownMenuLabel as typeof ShadCNDefaultComponents.DropdownMenu.DropdownMenuLabel,
        DropdownMenuSeparator: AppDropdownMenuSeparator as typeof ShadCNDefaultComponents.DropdownMenu.DropdownMenuSeparator,
        DropdownMenuSub: AppDropdownMenuSub as typeof ShadCNDefaultComponents.DropdownMenu.DropdownMenuSub,
        DropdownMenuSubContent: AppDropdownMenuSubContent as typeof ShadCNDefaultComponents.DropdownMenu.DropdownMenuSubContent,
        DropdownMenuSubTrigger: AppDropdownMenuSubTrigger as typeof ShadCNDefaultComponents.DropdownMenu.DropdownMenuSubTrigger,
        DropdownMenuTrigger: AppDropdownMenuTrigger as typeof ShadCNDefaultComponents.DropdownMenu.DropdownMenuTrigger
      }
    }), [])
    
    attachmentsRef.current = attachments
    onAddAttachmentRef.current = onAddAttachment
    onChangeRef.current = onChange

    // Create Yjs binding if yjsDoc is provided
    const yjsBindingRef = useRef<YjsBlockNoteBinding | null>(null)

    const editor = useCreateBlockNote({
      uploadFile: createAttachmentUploader(onAddAttachmentRef),
      resolveFileUrl: async (url: string) => resolveAttachmentUrl(url, attachmentsRef.current),
      dictionary,
      pasteHandler: ({ defaultPasteHandler }) => defaultPasteHandler({ prioritizeMarkdownOverHTML: false, plainTextAsMarkdown: true }),
      // Yjs collaboration configuration
      collaboration: yjsDoc ? {
        fragment: yjsDoc.getXmlFragment('document-store'),
        user: {
          name: 'User',
          color: '#ff0000'
        }
      } : undefined
    })

    // Initialize Yjs binding when editor and yjsDoc are available
    useEffect(() => {
      if (!editor || !yjsDoc) {
        yjsBindingRef.current = null
        return
      }

      yjsBindingRef.current = new YjsBlockNoteBinding(yjsDoc, editor)
    }, [editor, yjsDoc])

    // Handle Y.Doc changes
    useEffect(() => {
      if (!yjsDoc || !onYjsDocChange) return

      const updateHandler = () => {
        onYjsDocChange(yjsDoc)
      }

      yjsDoc.on('update', updateHandler)
      return () => {
        yjsDoc.off('update', updateHandler)
      }
    }, [yjsDoc, onYjsDocChange])

    useEffect(() => {
      if (!editor) return
      
      // If using Yjs, only load initial content if the Y.Doc is empty
      if (yjsDoc && yjsBindingRef.current) {
        const fragment = yjsDoc.getXmlFragment('document-store')
        // Check if Y.Doc already has content
        if (fragment.length > 0) {
          // Y.Doc already has content, don't overwrite
          return
        }
      }

      const loadInitialContent = async () => {
        try {
          const blocks = await markdownToBlocks(editor, initialContentRef.current)
          
          // If using Yjs, initialize the Y.Doc with blocks
          if (yjsDoc && yjsBindingRef.current) {
            yjsBindingRef.current.initializeFromBlocks(blocks)
          } else {
            // Otherwise, use the standard BlockNote API
            editor.replaceBlocks(editor.document, blocks)
          }
          
          setConversionError(null)
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error))
          setConversionError({ error: err, originalContent: initialContentRef.current })
          onConversionError?.(err, initialContentRef.current)
        }
      }
      loadInitialContent()
    }, [editor, retryCount, onConversionError, yjsDoc])

    const handleChange = useCallback(() => {
      if (!editor) return
      
      // In Yjs mode, the Y.Doc update handler will be called separately
      // We still call onChange for backward compatibility with markdown-based workflows
      try { 
        const markdown = blocksToMarkdown(editor.document)
        onChangeRef.current(markdown)
      }
      catch (error) { 
        console.error('Failed to convert blocks to markdown:', error)
      }
    }, [editor])

    useEffect(() => { 
      if (!editor) return
      
      // Only subscribe to editor changes if not using Yjs
      // In Yjs mode, changes are tracked via Y.Doc updates
      if (!yjsDoc) {
        return editor.onChange(handleChange)
      }
    }, [editor, handleChange, yjsDoc])
    useEffect(() => { if (!editor) return; editor.isEditable = !disabled }, [editor, disabled])

    const handleDrop = useCallback((event: React.DragEvent) => {
      if (!onDropFiles) return
      const files = Array.from(event.dataTransfer.files)
      if (files.length > 0) { event.preventDefault(); onDropFiles(files) }
    }, [onDropFiles])

    const handlePaste = useCallback((event: React.ClipboardEvent) => {
      if (!onPasteFiles) return
      const hasText = event.clipboardData.types.includes('text/plain') || event.clipboardData.types.includes('text/html')
      const files = Array.from(event.clipboardData.items).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => file !== null)
      if (files.length > 0 && !hasText) { event.preventDefault(); onPasteFiles(files) }
    }, [onPasteFiles])

    const handleRetry = useCallback(() => { setConversionError(null); setRetryCount(c => c + 1) }, [])

    useImperativeHandle(ref, () => ({
      getMarkdown: () => { if (!editor) return ''; try { return blocksToMarkdown(editor.document) } catch { return '' } },
      clear: () => { if (!editor) return; try { editor.replaceBlocks(editor.document, []) } catch {} },
      focus: () => { if (!editor) return; try { editor.focus() } catch {} },
      getEditor: () => editor || null,
      retry: handleRetry
    }), [editor, handleRetry])

    if (conversionError) {
      return (
        <div className="blocknote-conversion-error">
          <div className="blocknote-error-banner">
            <span className="blocknote-error-icon" aria-hidden="true">⚠️</span>
            <span className="blocknote-error-text">内容转换失败：{conversionError.error.message}</span>
            <button className="blocknote-error-dismiss" onClick={() => setConversionError(null)} type="button" title="关闭提示">✕</button>
          </div>
          <div className="blocknote-fallback-content"><pre className="blocknote-raw-content">{conversionError.originalContent}</pre></div>
        </div>
      )
    }

    if (!editor) return <div>Loading editor...</div>
    
    return (
      <div className="blocknote-wrapper" onDrop={handleDrop} onPaste={handlePaste}>
        <BlockNoteView editor={editor} editable={!disabled} theme={isDark ? 'dark' : 'light'} data-theming-css-variables-demo shadCNComponents={shadcnComponents} formattingToolbar={false} sideMenu={false}>
          <SideMenuController sideMenu={(props) => <CustomSideMenu {...props} />} />
          <FormattingToolbarController formattingToolbar={() => (
            <FormattingToolbar>
              <BlockTypeSelect key="blockTypeSelect" />
              <BasicTextStyleButton basicTextStyle="bold" key="boldStyleButton" />
              <BasicTextStyleButton basicTextStyle="italic" key="italicStyleButton" />
              <BasicTextStyleButton basicTextStyle="underline" key="underlineStyleButton" />
              <BasicTextStyleButton basicTextStyle="strike" key="strikeStyleButton" />
              <BasicTextStyleButton basicTextStyle="code" key="codeStyleButton" />
              <TextAlignButton textAlignment="left" key="textAlignLeftButton" />
              <TextAlignButton textAlignment="center" key="textAlignCenterButton" />
              <TextAlignButton textAlignment="right" key="textAlignRightButton" />
              <ColorStyleButton key="colorStyleButton" />
              <NestBlockButton key="nestBlockButton" />
              <UnnestBlockButton key="unnestBlockButton" />
              <CreateLinkButton key="createLinkButton" />
            </FormattingToolbar>
          )} />
        </BlockNoteView>
      </div>
    )
  }
)

export default BlockNoteComponent
