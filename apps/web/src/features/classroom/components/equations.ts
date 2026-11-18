import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import { CaptureUpdateAction, convertToExcalidrawElements } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { BoardElement } from '@learnthrive/shared/protocol';
import { equationFileId, renderTex } from '../math';

/**
 * Equations on an Excalidraw canvas (the whiteboard and the drawing layer on a shared screen). An equation is an ordinary image element whose
 * picture is the SVG MathJax made, and whose LaTeX is kept in the element itself (`customData.latex`). Only the element travels to the other
 * participants (a few hundred bytes, like any other drawing); each browser makes the picture itself from the LaTeX (`useEquationImages`), so
 * there are no image files to send, store or lose, and a person who joins late sees every equation.
 */

interface EquationData { latex: string; fontPx: number }

const equationOf = (element: Record<string, unknown>): EquationData | null => {
  const data = element.customData as Partial<EquationData> | undefined;
  return data && typeof data.latex === 'string' && data.latex.length > 0 ? { latex: data.latex, fontPx: typeof data.fontPx === 'number' ? data.fontPx : 32 } : null;
};

async function addPicture(api: ExcalidrawImperativeAPI, data: EquationData) {
  const image = await renderTex(data.latex, data.fontPx);
  api.addFiles([{ id: equationFileId(data.latex) as never, mimeType: 'image/svg+xml', dataURL: image.dataUrl as never, created: Date.now() }]);
  return image;
}

/** Puts an equation on the canvas, centred on `centre` (scene coordinates). `fontPx` is the text size in scene pixels. Throws a MathError for bad LaTeX. */
export async function insertEquation(api: ExcalidrawImperativeAPI, latex: string, centre: { x: number; y: number }, fontPx: number): Promise<void> {
  const data: EquationData = { latex: latex.trim(), fontPx };
  const image = await addPicture(api, data);
  const [element] = convertToExcalidrawElements([{
    type: 'image', x: centre.x - image.width / 2, y: centre.y - image.height / 2, width: image.width, height: image.height,
    fileId: equationFileId(data.latex) as never, status: 'saved',
  } as never]);
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), { ...element, customData: data } as never],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

/**
 * Makes the picture for every equation on the canvas that does not have one here yet (one that arrived from someone else, or was there when
 * this person joined). `ready` changes when the canvas becomes available, so equations present from the start are picked up too.
 */
export function useEquationImages(apiRef: MutableRefObject<ExcalidrawImperativeAPI | null>, elements: readonly BoardElement[], ready: unknown) {
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const files = api.getFiles();
    const wanted = new Map<string, EquationData>();
    for (const element of elements) {
      if (element.isDeleted || element.type !== 'image' || typeof element.fileId !== 'string') continue;
      const data = equationOf(element);
      if (data && !files[element.fileId as keyof typeof files]) wanted.set(element.fileId, data);
    }
    for (const data of wanted.values()) void addPicture(api, data).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apiRef is a ref; `ready` and the elements are what should re-run this
  }, [elements, ready]);
}
