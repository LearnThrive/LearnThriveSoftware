import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CaptureUpdateAction, Excalidraw, convertToExcalidrawElements, exportToBlob, reconcileElements, restoreElements,
} from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI, Collaborator, SocketId } from '@excalidraw/excalidraw/types';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { RemoteExcalidrawElement } from '@excalidraw/excalidraw/data/reconcile';
import '@excalidraw/excalidraw/index.css';
import { MAX_BOARD_IMPORT_BYTES, type BoardElement, type BoardPage, type ParticipantRole } from '@learnthrive/shared/protocol';
import type { BoardPointer } from '../meeting';
import { boardBackgroundStyle, trailingThrottle } from '../board';
import { usePopoverDismiss } from '../usePopoverDismiss';
import { BoardPageTabs } from './BoardPageTabs';
import { Icon } from './Icon';

const AS_BOARD_ELEMENTS = (elements: readonly OrderedExcalidrawElement[]) => elements as unknown as BoardElement[];
const AS_EXCALIDRAW_ELEMENTS = (elements: readonly BoardElement[]) => elements as unknown as OrderedExcalidrawElement[];
const AS_REMOTE_ELEMENTS = (elements: readonly BoardElement[]) => elements as unknown as RemoteExcalidrawElement[];

interface WhiteboardProps {
  role: ParticipantRole;
  pages: BoardPage[];
  activePageId: string;
  elementsByPage: Record<string, BoardElement[]>;
  studentsCanDraw: boolean;
  pointers: Record<string, BoardPointer>;
  followMeSeq: number;
  onUpdate: (pageId: string, elements: BoardElement[]) => void;
  onCursor: (x: number, y: number) => void;
  onLaser: (x: number, y: number) => void;
  onCommitLocal: (pageId: string, elements: BoardElement[]) => void;
  onSwitchPage: (pageId: string) => void;
  onCreatePage: () => void;
  onRenamePage: (pageId: string, name: string) => void;
  onDuplicatePage: (pageId: string) => void;
  onDeletePage: (pageId: string) => void;
  onReorderPages: (pageIds: string[]) => void;
  onBackground: (pageId: string, background: BoardPage['background']) => void;
  onSetStudentsCanDraw: (value: boolean) => void;
  onClearPage: (pageId: string) => void;
  onFollowMe: () => void;
  onImport: (pageId: string, elements: BoardElement[]) => void;
}

const TUTORING_SHORTCUTS = [
  { id: 'number-line', label: 'Number line' },
  { id: 'axes', label: 'Coordinate axes' },
  { id: 'fraction', label: 'Fraction bar' },
] as const;

export function Whiteboard({
  role, pages, activePageId, elementsByPage, studentsCanDraw, pointers, followMeSeq,
  onUpdate, onCursor, onLaser, onCommitLocal, onSwitchPage, onCreatePage, onRenamePage, onDuplicatePage,
  onDeletePage, onReorderPages, onBackground, onSetStudentsCanDraw, onClearPage, onFollowMe, onImport,
}: WhiteboardProps) {
  const isTutor = role === 'tutor';
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [viewedPageId, setViewedPageId] = useState(activePageId || pages[0]?.id || '');
  const [following, setFollowing] = useState(true);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const prevViewedRef = useRef<string | null>(null);
  const lastSentRef = useRef(new Map<string, { version: number; versionNonce: number }>());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const shortcutsPanelRef = useRef<HTMLDivElement>(null);
  const shortcutsTriggerRef = useRef<HTMLButtonElement>(null);
  usePopoverDismiss(shortcutsOpen, () => setShortcutsOpen(false), shortcutsPanelRef, shortcutsTriggerRef);

  // The tutor always views whatever page they themselves switch to (there's nothing to "follow");
  // a student follows the tutor's active page only while `following` is true, and can stop
  // following locally at any time without telling the server (see shared/protocol.ts's note on
  // why board:page-switch stays tutor-only — a student browsing independently is a pure local view).
  useEffect(() => {
    if (isTutor || following) setViewedPageId(activePageId);
  }, [activePageId, following, isTutor]);

  useEffect(() => {
    if (followMeSeq === 0) return;
    setFollowing(true);
    setViewedPageId(activePageId);
  }, [followMeSeq]); // eslint-disable-line react-hooks/exhaustive-deps -- fires only on a fresh nudge, not on activePageId drift

  const currentPage = pages.find((page) => page.id === viewedPageId) ?? null;
  const pageElements = useMemo(() => elementsByPage[viewedPageId] ?? [], [elementsByPage, viewedPageId]);
  const viewOnly = !isTutor && !studentsCanDraw;

  // One effect, keyed on both which page is being viewed and that page's at-rest element cache:
  // fires on an explicit page switch (local or tutor-driven) and on any remote update to the
  // currently-viewed page. Reconciled with Excalidraw's own reconcileElements (the same
  // version/versionNonce merge the server uses) against whatever's live in the local scene, so a
  // remote update never clobbers an in-flight local edit that hasn't round-tripped yet.
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !viewedPageId) return;
    if (prevViewedRef.current && prevViewedRef.current !== viewedPageId) {
      onCommitLocal(prevViewedRef.current, AS_BOARD_ELEMENTS(api.getSceneElementsIncludingDeleted()));
    }
    prevViewedRef.current = viewedPageId;
    const reconciled = reconcileElements(api.getSceneElementsIncludingDeleted(), AS_REMOTE_ELEMENTS(pageElements), api.getAppState());
    api.updateScene({ elements: reconciled, captureUpdate: CaptureUpdateAction.NEVER });
    lastSentRef.current = new Map(reconciled.map((element) => [element.id, { version: element.version, versionNonce: element.versionNonce }]));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onCommitLocal is stable (bound controller method)
  }, [viewedPageId, pageElements]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    // The server never echoes a board:cursor/board:laser broadcast back to its own sender, so
    // `pointers` can never contain our own id — no self-filtering needed here.
    const collaborators = new Map<SocketId, Collaborator>();
    for (const pointer of Object.values(pointers)) {
      collaborators.set(pointer.id as SocketId, {
        username: pointer.name, isCurrentUser: false,
        pointer: { x: pointer.x, y: pointer.y, tool: pointer.tool },
      });
    }
    api.updateScene({ collaborators, captureUpdate: CaptureUpdateAction.NEVER });
  }, [pointers]);

  const sendThrottled = useRef(trailingThrottle((pageId: string, elements: BoardElement[]) => onUpdate(pageId, elements), 120)).current;
  useEffect(() => () => sendThrottled.cancel(), [sendThrottled]);

  const handleChange = useCallback((elements: readonly OrderedExcalidrawElement[]) => {
    if (!viewedPageId) return;
    const changed: BoardElement[] = [];
    for (const element of elements) {
      const last = lastSentRef.current.get(element.id);
      if (!last || last.version !== element.version || last.versionNonce !== element.versionNonce) {
        changed.push(element as unknown as BoardElement);
        lastSentRef.current.set(element.id, { version: element.version, versionNonce: element.versionNonce });
      }
    }
    if (changed.length > 0) sendThrottled(viewedPageId, changed);
  }, [viewedPageId, sendThrottled]);

  const cursorThrottled = useRef(trailingThrottle((x: number, y: number, tool: 'pointer' | 'laser') => {
    if (tool === 'laser') onLaser(x, y); else onCursor(x, y);
  }, 70)).current;
  useEffect(() => () => cursorThrottled.cancel(), [cursorThrottled]);

  const insertShortcut = (kind: typeof TUTORING_SHORTCUTS[number]['id']) => {
    const api = apiRef.current;
    if (!api || viewOnly) return;
    const { scrollX, scrollY, width, height, zoom } = api.getAppState();
    const cx = width / 2 / zoom.value - scrollX;
    const cy = height / 2 / zoom.value - scrollY;
    let skeleton: Parameters<typeof convertToExcalidrawElements>[0] = [];
    if (kind === 'number-line') {
      const ticks = Array.from({ length: 9 }, (_, index) => index - 4);
      skeleton = [
        { type: 'line', x: cx - 200, y: cy, points: [[0, 0], [400, 0]] },
        ...ticks.map((tick) => ({ type: 'line' as const, x: cx + tick * 50, y: cy - 8, points: [[0, 0], [0, 16]] as [number, number][] })),
        ...ticks.map((tick) => ({ type: 'text' as const, x: cx + tick * 50 - 5, y: cy + 12, text: String(tick), fontSize: 14 })),
      ];
    } else if (kind === 'axes') {
      skeleton = [
        { type: 'line', x: cx - 180, y: cy, points: [[0, 0], [360, 0]] },
        { type: 'line', x: cx, y: cy - 140, points: [[0, 0], [0, 280]] },
        { type: 'text', x: cx + 165, y: cy + 6, text: 'x', fontSize: 16 },
        { type: 'text', x: cx + 6, y: cy - 138, text: 'y', fontSize: 16 },
      ];
    } else {
      skeleton = [
        { type: 'text', x: cx - 10, y: cy - 34, text: 'a', fontSize: 20, textAlign: 'center' },
        { type: 'line', x: cx - 30, y: cy, points: [[0, 0], [60, 0]] },
        { type: 'text', x: cx - 10, y: cy + 6, text: 'b', fontSize: 20, textAlign: 'center' },
      ];
    }
    const inserted = convertToExcalidrawElements(skeleton);
    api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), ...inserted], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    setShortcutsOpen(false);
  };

  const exportPng = async () => {
    const api = apiRef.current;
    if (!api) return;
    const blob = await exportToBlob({ elements: api.getSceneElements(), appState: api.getAppState(), files: api.getFiles(), mimeType: 'image/png' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `${currentPage?.name ?? 'board'}.png`; link.click();
    URL.revokeObjectURL(url);
  };

  const exportJson = () => {
    const api = apiRef.current;
    if (!api) return;
    const data = { type: 'excalidraw', version: 2, elements: api.getSceneElements(), appState: { viewBackgroundColor: '#ffffff' } };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `${currentPage?.name ?? 'board'}.excalidraw`; link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file: File) => {
    if (file.size > MAX_BOARD_IMPORT_BYTES) { apiRef.current?.setToast({ message: 'That file is too large to import.' }); return; }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { elements?: unknown };
      if (!Array.isArray(parsed.elements)) throw new Error('Missing elements array');
      const restored = restoreElements(parsed.elements as never, null);
      onImport(viewedPageId, AS_BOARD_ELEMENTS(restored));
    } catch {
      apiRef.current?.setToast({ message: 'That file is not a valid Excalidraw board.' });
    }
  };

  return (
    <div className="whiteboard">
      <div className="whiteboard-toolbar">
        <BoardPageTabs
          pages={pages} activePageId={activePageId} viewedPageId={viewedPageId} isTutor={isTutor} following={following}
          onSelect={(pageId) => { if (isTutor) onSwitchPage(pageId); else { setFollowing(false); setViewedPageId(pageId); } }}
          onCreate={onCreatePage} onRename={onRenamePage} onDuplicate={onDuplicatePage} onDelete={onDeletePage}
          onReorder={onReorderPages} onBackground={onBackground}
        />
        <div className="whiteboard-actions">
          {!isTutor && !following && (
            <button type="button" className="inline-action" onClick={() => { setFollowing(true); setViewedPageId(activePageId); }}>Follow tutor</button>
          )}
          {isTutor && (
            <>
              <button type="button" className="inline-action" onClick={onFollowMe}>Follow me</button>
              <button
                type="button" className={`inline-action ${!studentsCanDraw ? 'is-active' : ''}`}
                onClick={() => onSetStudentsCanDraw(!studentsCanDraw)}
                aria-pressed={!studentsCanDraw}
              >
                {studentsCanDraw ? 'Students can draw' : 'Drawing locked'}
              </button>
              <div className="popover-anchor" ref={shortcutsPanelRef}>
                <button
                  type="button" className="inline-action" ref={shortcutsTriggerRef}
                  onClick={() => setShortcutsOpen((open) => !open)}
                  aria-haspopup="menu" aria-expanded={shortcutsOpen}
                >
                  Insert
                </button>
                {shortcutsOpen && (
                  <div className="board-shortcuts-menu" role="menu">
                    {TUTORING_SHORTCUTS.map((shortcut) => (
                      <button key={shortcut.id} type="button" role="menuitem" onClick={() => { insertShortcut(shortcut.id); setShortcutsOpen(false); }}>{shortcut.label}</button>
                    ))}
                  </div>
                )}
              </div>
              <button type="button" className="inline-action" onClick={() => setClearConfirmOpen(true)}>Clear page</button>
              <button type="button" className="inline-action" onClick={() => fileInputRef.current?.click()}>Import</button>
              <input ref={fileInputRef} type="file" accept=".excalidraw,application/json" className="sr-only"
                onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleImportFile(file); event.target.value = ''; }} />
            </>
          )}
          <button type="button" className="inline-action" onClick={() => void exportPng()}>Export PNG</button>
          <button type="button" className="inline-action" onClick={exportJson}>Export JSON</button>
        </div>
      </div>
      {clearConfirmOpen && (
        <div className="board-clear-confirm" role="alertdialog" aria-label="Confirm clearing the whiteboard page">
          <p>Clear this whiteboard page for everyone? This can&apos;t be undone.</p>
          <div className="poll-creator-actions">
            <button type="button" className="button-secondary" onClick={() => setClearConfirmOpen(false)}>Cancel</button>
            <button type="button" className="button-danger" onClick={() => { onClearPage(viewedPageId); setClearConfirmOpen(false); }}>Clear page</button>
          </div>
        </div>
      )}
      <div className="whiteboard-canvas" style={boardBackgroundStyle(currentPage?.background ?? 'blank')}>
        <Excalidraw
          excalidrawAPI={(api) => { apiRef.current = api; }}
          initialData={{ elements: AS_EXCALIDRAW_ELEMENTS(pageElements), appState: { viewBackgroundColor: 'transparent' } }}
          onChange={handleChange}
          onPointerUpdate={({ pointer }) => cursorThrottled(pointer.x, pointer.y, pointer.tool)}
          viewModeEnabled={viewOnly}
          isCollaborating
          theme="light"
          name={currentPage?.name}
          UIOptions={{ canvasActions: { export: false, saveToActiveFile: false, loadScene: false, toggleTheme: false } }}
        />
        {viewOnly && <div className="whiteboard-view-only-badge"><Icon name="lock" size={13} />View only — the tutor has turned off drawing</div>}
      </div>
    </div>
  );
}
