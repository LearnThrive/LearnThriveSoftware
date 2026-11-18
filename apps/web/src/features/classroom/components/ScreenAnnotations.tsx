import { useCallback, useEffect, useRef, useState } from 'react';
import { CaptureUpdateAction, Excalidraw, reconcileElements } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { RemoteExcalidrawElement } from '@excalidraw/excalidraw/data/reconcile';
import '@excalidraw/excalidraw/index.css';
import type { BoardElement } from '@learnthrive/shared/protocol';
import { trailingThrottle } from '../board';
import type { ScreenFrame } from './ScreenStage';
import { EquationDialog } from './EquationDialog';
import { insertEquation, useEquationImages } from './equations';

const AS_BOARD = (elements: readonly OrderedExcalidrawElement[]) => elements as unknown as BoardElement[];
const AS_SCENE = (elements: readonly BoardElement[]) => elements as unknown as OrderedExcalidrawElement[];
const AS_REMOTE = (elements: readonly BoardElement[]) => elements as unknown as RemoteExcalidrawElement[];

/**
 * Drawing on top of a shared screen: the tutor writes and draws on a past paper, a slide, anything on show, and everyone sees it as it is made.
 * It is the same drawing tool as the whiteboard (pens, shapes, text, arrows, an eraser, and equations), on a transparent layer exactly as big as
 * the picture. The layer's coordinates are the SHARED SCREEN'S OWN PIXELS and its zoom is set so one screen pixel is one scene unit, so a mark
 * lands on the same spot of the paper for everybody, whatever size their window is. Only the tutor draws; the drawing lasts as long as the
 * share and is cleared when it ends (the server does that).
 */
export function ScreenAnnotations({ frame, canDraw, elements, onUpdate, onCommit, onClear }: {
  frame: ScreenFrame;
  canDraw: boolean;
  elements: BoardElement[];
  onUpdate: (elements: BoardElement[]) => void;
  /** Called when this layer goes away, so what the tutor drew survives switching tabs. */
  onCommit: (elements: BoardElement[]) => void;
  onClear: () => void;
}) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [apiReady, setApiReady] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [equationOpen, setEquationOpen] = useState(false);
  const lastSent = useRef(new Map<string, { version: number; versionNonce: number }>());
  const zoom = frame.width / frame.intrinsicWidth;

  // One screen pixel is one scene unit, whatever the window size, and the view never drifts (no panning or zooming of a layer that sits on a picture).
  const fit = useCallback(() => {
    apiRef.current?.updateScene({ appState: { zoom: { value: zoom as never }, scrollX: 0, scrollY: 0 }, captureUpdate: CaptureUpdateAction.NEVER });
  }, [zoom]);
  useEffect(() => { if (apiReady) fit(); }, [apiReady, fit, drawing]);

  // What others (or the server's copy) hold goes into the scene. An empty list means "cleared", which a merge would not do.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    if (elements.length === 0) {
      api.updateScene({ elements: [], captureUpdate: CaptureUpdateAction.NEVER });
      lastSent.current = new Map();
      return;
    }
    const merged = reconcileElements(api.getSceneElementsIncludingDeleted(), AS_REMOTE(elements), api.getAppState());
    api.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });
    lastSent.current = new Map(merged.map((element) => [element.id, { version: element.version, versionNonce: element.versionNonce }]));
  }, [elements, apiReady]);
  useEquationImages(apiRef, elements, apiReady);

  const send = useRef(trailingThrottle((changed: BoardElement[]) => onUpdate(changed), 100)).current;
  useEffect(() => () => send.cancel(), [send]);
  const commitRef = useRef(onCommit);
  useEffect(() => { commitRef.current = onCommit; });
  useEffect(() => () => {
    send.flush();
    const api = apiRef.current;
    if (api && canDraw) commitRef.current(AS_BOARD(api.getSceneElementsIncludingDeleted()));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on the layer going away
  }, []);

  const handleChange = useCallback((scene: readonly OrderedExcalidrawElement[]) => {
    if (!canDraw) return;
    const changed: BoardElement[] = [];
    for (const element of scene) {
      const last = lastSent.current.get(element.id);
      if (!last || last.version !== element.version || last.versionNonce !== element.versionNonce) {
        changed.push(element as unknown as BoardElement);
        lastSent.current.set(element.id, { version: element.version, versionNonce: element.versionNonce });
      }
    }
    if (changed.length > 0) send(changed);
  }, [canDraw, send]);

  const addEquation = async (latex: string) => {
    const api = apiRef.current;
    if (!api) throw new Error('The drawing layer is not ready yet.');
    await insertEquation(api, latex, { x: frame.intrinsicWidth / 2, y: frame.intrinsicHeight / 2 }, Math.max(24, Math.round(frame.intrinsicHeight / 18)));
  };

  // Once drawing is really on (the layer has left view-only mode), pick a pen in a colour that shows on a page: what someone marking a paper
  // reaches for first. Done after the switch, because a tool chosen while the layer is still view-only is reset.
  useEffect(() => {
    const api = apiRef.current;
    if (!drawing || !api) return;
    const timer = setTimeout(() => {
      api.updateScene({ appState: { currentItemStrokeColor: '#e03131', currentItemStrokeWidth: 2 }, captureUpdate: CaptureUpdateAction.NEVER });
      api.setActiveTool({ type: 'freedraw' });
    }, 60);
    return () => clearTimeout(timer);
  }, [drawing, apiReady]);

  return (
    <>
      <div className={`screen-annotations ${drawing ? 'is-drawing' : ''}`} aria-hidden={!drawing}>
        <Excalidraw
          excalidrawAPI={(api) => { apiRef.current = api; setApiReady(true); }}
          initialData={{ elements: AS_SCENE(elements), appState: { viewBackgroundColor: 'transparent', zoom: { value: zoom as never }, scrollX: 0, scrollY: 0 } }}
          onChange={handleChange}
          onScrollChange={(scrollX, scrollY, current) => { if (scrollX !== 0 || scrollY !== 0 || Math.abs(current.value - zoom) > 0.0001) fit(); }}
          viewModeEnabled={!canDraw || !drawing}
          theme="light"
          UIOptions={{ canvasActions: { export: false, saveToActiveFile: false, loadScene: false, toggleTheme: false, clearCanvas: false, changeViewBackgroundColor: false, saveAsImage: false }, tools: { image: false } }}
        />
      </div>
      {canDraw && (
        <div className="screen-tools" role="toolbar" aria-label="Drawing on the shared screen">
          <button type="button" className={`screen-tools__main ${drawing ? 'is-on' : ''}`} aria-pressed={drawing} onClick={() => setDrawing((on) => !on)}>
            {drawing ? 'Done drawing' : 'Draw on screen'}
          </button>
          {drawing && (
            <>
              <button type="button" onClick={() => setEquationOpen(true)}>Equation…</button>
              <button type="button" onClick={onClear}>Clear drawing</button>
            </>
          )}
        </div>
      )}
      {canDraw && <EquationDialog open={equationOpen} onClose={() => setEquationOpen(false)} onInsert={addEquation} />}
    </>
  );
}
