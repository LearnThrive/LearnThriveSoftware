import { useRef, useState } from 'react';
import { MAX_BOARD_PAGES, type BoardBackground, type BoardPage } from '@learnthrive/shared/protocol';
import { Icon } from './Icon';
import { usePopoverDismiss } from '../usePopoverDismiss';

const BACKGROUND_LABELS: Record<BoardBackground, string> = {
  blank: 'Blank', lined: 'Lined paper', grid: 'Grid paper', dotted: 'Dotted paper', coordinate: 'Coordinate grid',
};
const BACKGROUNDS = Object.keys(BACKGROUND_LABELS) as BoardBackground[];

interface BoardPageTabsProps {
  pages: BoardPage[];
  activePageId: string;
  viewedPageId: string;
  isTutor: boolean;
  following: boolean;
  onSelect: (pageId: string) => void;
  onCreate: () => void;
  onRename: (pageId: string, name: string) => void;
  onDuplicate: (pageId: string) => void;
  onDelete: (pageId: string) => void;
  onReorder: (pageIds: string[]) => void;
  onBackground: (pageId: string, background: BoardBackground) => void;
}

export function BoardPageTabs({
  pages, activePageId, viewedPageId, isTutor, following, onSelect, onCreate, onRename, onDuplicate, onDelete, onReorder, onBackground,
}: BoardPageTabsProps) {
  const [renaming, setRenaming] = useState<{ pageId: string; value: string } | null>(null);
  const [backgroundMenuFor, setBackgroundMenuFor] = useState<string | null>(null);
  const backgroundMenuContainerRef = useRef<HTMLDivElement>(null);
  const backgroundMenuTriggerRef = useRef<HTMLButtonElement>(null);
  usePopoverDismiss(backgroundMenuFor !== null, () => setBackgroundMenuFor(null), backgroundMenuContainerRef, backgroundMenuTriggerRef);

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= pages.length) return;
    const ids = pages.map((page) => page.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    onReorder(ids);
  };

  const commitRename = () => {
    if (renaming && renaming.value.trim()) onRename(renaming.pageId, renaming.value.trim());
    setRenaming(null);
  };

  return (
    <div className="board-page-tabs" role="tablist" aria-label="Whiteboard pages">
      {pages.map((page, index) => {
        const isActive = page.id === viewedPageId;
        const isTutorPage = page.id === activePageId;
        return (
          <div
            key={page.id} className={`board-page-tab ${isActive ? 'is-active' : ''}`} role="presentation"
            ref={backgroundMenuFor === page.id ? backgroundMenuContainerRef : undefined}
          >
            {renaming?.pageId === page.id ? (
              <input
                className="board-page-tab-rename" autoFocus value={renaming.value} aria-label={`Rename page (was ${page.name})`}
                onChange={(event) => setRenaming({ pageId: page.id, value: event.target.value })}
                onBlur={commitRename}
                onKeyDown={(event) => { if (event.key === 'Enter') commitRename(); if (event.key === 'Escape') setRenaming(null); }}
              />
            ) : (
              <button
                type="button" role="tab" aria-selected={isActive} className="board-page-tab-button"
                onClick={() => onSelect(page.id)}
                onDoubleClick={() => { if (isTutor) setRenaming({ pageId: page.id, value: page.name }); }}
                onKeyDown={(event) => { if (isTutor && event.key === 'F2') { event.preventDefault(); setRenaming({ pageId: page.id, value: page.name }); } }}
              >
                {isTutorPage && <Icon name="people" size={11} />}
                {page.name}
              </button>
            )}
            {isTutor && (
              <span className="board-page-tab-actions">
                <button type="button" onClick={() => setRenaming({ pageId: page.id, value: page.name })} aria-label={`Rename ${page.name}`}><Icon name="edit" size={11} /></button>
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move ${page.name} earlier`}><Icon name="arrow" size={11} style={{ transform: 'rotate(180deg)' }} /></button>
                <button type="button" onClick={() => move(index, 1)} disabled={index === pages.length - 1} aria-label={`Move ${page.name} later`}><Icon name="arrow" size={11} /></button>
                <button
                  type="button" ref={backgroundMenuFor === page.id ? backgroundMenuTriggerRef : undefined}
                  onClick={() => setBackgroundMenuFor(backgroundMenuFor === page.id ? null : page.id)}
                  aria-label={`${page.name} background`} aria-haspopup="menu" aria-expanded={backgroundMenuFor === page.id}
                ><Icon name="settings" size={11} /></button>
                <button type="button" onClick={() => onDuplicate(page.id)} aria-label={`Duplicate ${page.name}`}><Icon name="plus" size={11} /></button>
                {pages.length > 1 && (
                  <button type="button" onClick={() => onDelete(page.id)} aria-label={`Delete ${page.name}`}><Icon name="close" size={11} /></button>
                )}
              </span>
            )}
            {backgroundMenuFor === page.id && (
              <div className="board-background-menu" role="menu">
                {BACKGROUNDS.map((background) => (
                  <button
                    key={background} type="button" className={page.background === background ? 'is-active' : ''}
                    onClick={() => { onBackground(page.id, background); setBackgroundMenuFor(null); }}
                  >
                    {BACKGROUND_LABELS[background]}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {isTutor && pages.length < MAX_BOARD_PAGES && (
        <button type="button" className="board-page-add" onClick={onCreate} aria-label="Add whiteboard page"><Icon name="plus" size={13} /></button>
      )}
      {!isTutor && !following && <span className="board-following-hint">Viewing independently</span>}
    </div>
  );
}
