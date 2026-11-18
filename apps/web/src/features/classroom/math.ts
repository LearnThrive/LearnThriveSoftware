/**
 * LaTeX to a picture, for the whiteboard and the drawing layer on a shared screen. MathJax (already a dependency, the same engine the paper
 * marker uses) typesets the maths as SVG glyph outlines: crisp at any zoom, no fonts to load, nothing sent to a server. It is loaded the first
 * time someone opens the equation tool, not with the classroom.
 *
 * Packages: the AMS set (align, matrices, \text), chemistry (\ce{H2O + CO2 -> ...} and \pu{25 kJ/mol}), physics (\vec, \dv, \qty ...), \cancel,
 * \boldsymbol, degree signs and friends (gensymb), and mathtools. Anything else is shown as an error, never silently dropped.
 */

export interface MathImage {
  /** The SVG markup, sized in pixels for the requested font size. */
  svg: string;
  /** The same as a data: URL, for an <img> or a whiteboard image file. */
  dataUrl: string;
  width: number;
  height: number;
}

export class MathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MathError';
  }
}

export const MAX_TEX_LENGTH = 2000;

interface Engine { convert: (tex: string) => string }
let engine: Promise<Engine> | null = null;

function loadEngine(): Promise<Engine> {
  engine ??= (async () => {
    const [{ mathjax }, { TeX }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler }] = await Promise.all([
      import('mathjax-full/js/mathjax.js'),
      import('mathjax-full/js/input/tex.js'),
      import('mathjax-full/js/output/svg.js'),
      import('mathjax-full/js/adaptors/liteAdaptor.js'),
      import('mathjax-full/js/handlers/html.js'),
    ]);
    // The TeX packages must be imported to be registered: without these, \ce, \cancel and friends are silently unknown.
    await Promise.all([
      import('mathjax-full/js/input/tex/ams/AmsConfiguration.js'),
      import('mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js'),
      import('mathjax-full/js/input/tex/noundefined/NoUndefinedConfiguration.js'),
      import('mathjax-full/js/input/tex/mhchem/MhchemConfiguration.js'),
      import('mathjax-full/js/input/tex/physics/PhysicsConfiguration.js'),
      import('mathjax-full/js/input/tex/cancel/CancelConfiguration.js'),
      import('mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js'),
      import('mathjax-full/js/input/tex/gensymb/GensymbConfiguration.js'),
      import('mathjax-full/js/input/tex/mathtools/MathtoolsConfiguration.js'),
    ]);
    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    const document = mathjax.document('', {
      InputJax: new TeX({ packages: ['base', 'ams', 'newcommand', 'noundefined', 'mhchem', 'physics', 'cancel', 'boldsymbol', 'gensymb', 'mathtools'] }),
      OutputJax: new SVG({ fontCache: 'none' }),
    });
    return { convert: (tex: string) => adaptor.innerHTML(document.convert(tex, { display: true })) };
  })();
  return engine;
}

/** Turns a LaTeX string into a sized SVG picture, or throws a MathError saying what is wrong. `fontPx` is the size of the text (1 em). */
export async function renderTex(tex: string, fontPx = 32): Promise<MathImage> {
  const source = tex.trim();
  if (!source) throw new MathError('Type an equation.');
  if (source.length > MAX_TEX_LENGTH) throw new MathError(`Keep it under ${MAX_TEX_LENGTH} characters.`);
  const { convert } = await loadEngine();
  let markup: string;
  try {
    markup = convert(source);
  } catch (error) {
    throw new MathError(error instanceof Error ? error.message : 'That could not be typeset.');
  }
  // MathJax does not throw for bad input: it draws an error box (merror) with the reason in its title.
  if (markup.includes('data-mml-node="merror"')) {
    const reason = /data-mml-node="merror"[^>]*(?:data-mjx-error|title)="([^"]+)"/.exec(markup)?.[1];
    throw new MathError(reason ? `LaTeX problem: ${reason}` : 'That is not valid LaTeX.');
  }
  const box = /viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/.exec(markup);
  if (!markup.startsWith('<svg') || !box) throw new MathError('That could not be typeset.');
  // The viewBox is in 1/1000 em, so the picture's size in pixels follows from the text size.
  const width = Math.max(1, Math.round((Number(box[3]) / 1000) * fontPx));
  const height = Math.max(1, Math.round((Number(box[4]) / 1000) * fontPx));
  const svg = markup
    .replace(/^<svg[^>]*>/, (open) => {
      const cleaned = open.replace(/\s(?:width|height|style|xmlns)="[^"]*"/g, '');
      return cleaned.replace('<svg', `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"`);
    });
  return { svg, dataUrl: `data:image/svg+xml;base64,${toBase64(svg)}`, width, height };
}

function toBase64(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** A short, stable id for an equation's picture (the same LaTeX always gives the same id, so every browser names the same file the same). */
export function equationFileId(tex: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < tex.length; i += 1) {
    const code = tex.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `eq-${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}
