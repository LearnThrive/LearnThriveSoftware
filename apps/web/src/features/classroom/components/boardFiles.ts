import type { BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { BoardFile } from '@learnthrive/shared/protocol';

// The pictures behind a canvas's image elements (see BoardFile). Equations are image elements too, but each browser draws those itself from their
// LaTeX (equations.ts), so they are never sent.

type CanvasElement = { type: string; isDeleted?: boolean; fileId?: string | null; customData?: Record<string, unknown> };

/** The pictures that the elements on show need and that this canvas holds. */
export function picturesIn(elements: readonly CanvasElement[], files: BinaryFiles): BoardFile[] {
  const found = new Map<string, BoardFile>();
  for (const element of elements) {
    if (element.type !== 'image' || element.isDeleted || !element.fileId || element.customData?.latex) continue;
    const file = (files as Record<string, { dataURL?: unknown; mimeType?: unknown } | undefined>)[element.fileId];
    if (file && typeof file.dataURL === 'string' && typeof file.mimeType === 'string') found.set(element.fileId, { id: element.fileId, mimeType: file.mimeType, dataURL: file.dataURL });
  }
  return [...found.values()];
}

export const toBinaryFiles = (files: readonly BoardFile[]): BinaryFiles =>
  Object.fromEntries(files.map((file) => [file.id, { ...file, created: Date.now() }])) as unknown as BinaryFiles;

/** Gives the canvas the pictures it does not have yet. */
export function addBoardFiles(api: ExcalidrawImperativeAPI, files: readonly BoardFile[]): void {
  const held = api.getFiles() as Record<string, unknown>;
  const missing = files.filter((file) => !held[file.id]);
  if (missing.length > 0) api.addFiles(Object.values(toBinaryFiles(missing)));
}
