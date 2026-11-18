import { useEffect, useId, useRef, useState } from 'react';
import { MathError, renderTex, type MathImage } from '../math';
import { Icon } from './Icon';

/** One button in a palette. `|` in `tex` marks where the cursor goes afterwards (and is not typed). */
interface Snippet { label: string; tex: string; title: string }

const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', omega: 'ω',
  Delta: 'Δ', Sigma: 'Σ', Omega: 'Ω', Phi: 'Φ', Psi: 'Ψ', Theta: 'Θ',
};

const PALETTES: Array<{ id: string; name: string; items: Snippet[] }> = [
  { id: 'structure', name: 'Structure', items: [
    { label: 'a⁄b', tex: '\\frac{|}{}', title: 'Fraction' },
    { label: '√', tex: '\\sqrt{|}', title: 'Square root' },
    { label: 'ⁿ√', tex: '\\sqrt[n]{|}', title: 'nth root' },
    { label: 'xⁿ', tex: '^{|}', title: 'Power (superscript)' },
    { label: 'xₙ', tex: '_{|}', title: 'Subscript' },
    { label: '( )', tex: '\\left( | \\right)', title: 'Brackets that grow' },
    { label: '| |', tex: '\\left| | \\right|', title: 'Modulus' },
    { label: '[ ]', tex: '\\begin{pmatrix} | & \\\\ & \\end{pmatrix}', title: 'Matrix' },
    { label: '{ cases', tex: '\\begin{cases} | & \\text{if } \\\\ & \\text{otherwise} \\end{cases}', title: 'Cases' },
    { label: 'x̄', tex: '\\bar{|}', title: 'Bar / mean' },
    { label: 'vec', tex: '\\vec{|}', title: 'Vector' },
    { label: 'â', tex: '\\hat{|}', title: 'Hat / unit vector' },
  ] },
  { id: 'operators', name: 'Operators', items: [
    { label: '±', tex: '\\pm ', title: 'Plus or minus' },
    { label: '×', tex: '\\times ', title: 'Times' },
    { label: '÷', tex: '\\div ', title: 'Divide' },
    { label: '·', tex: '\\cdot ', title: 'Dot' },
    { label: '≠', tex: '\\neq ', title: 'Not equal' },
    { label: '≈', tex: '\\approx ', title: 'Approximately' },
    { label: '≤', tex: '\\leq ', title: 'Less than or equal' },
    { label: '≥', tex: '\\geq ', title: 'Greater than or equal' },
    { label: '<', tex: '< ', title: 'Less than' },
    { label: '>', tex: '> ', title: 'Greater than' },
    { label: '∝', tex: '\\propto ', title: 'Proportional to' },
    { label: '∞', tex: '\\infty ', title: 'Infinity' },
    { label: '→', tex: '\\rightarrow ', title: 'Arrow' },
    { label: '⇒', tex: '\\Rightarrow ', title: 'Implies' },
    { label: '⇔', tex: '\\Leftrightarrow ', title: 'If and only if' },
    { label: '∴', tex: '\\therefore ', title: 'Therefore' },
  ] },
  { id: 'greek', name: 'Greek', items: ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'theta', 'lambda', 'mu', 'pi', 'rho', 'sigma', 'tau', 'phi', 'omega', 'Delta', 'Sigma', 'Omega', 'Phi', 'Psi', 'Theta']
    .map((name) => ({ label: GREEK[name] ?? name, tex: `\\${name} `, title: name })) },
  { id: 'calculus', name: 'Calculus', items: [
    { label: '∫', tex: '\\int_{|}^{} ', title: 'Integral' },
    { label: 'Σ', tex: '\\sum_{n=1}^{|} ', title: 'Sum' },
    { label: 'lim', tex: '\\lim_{x \\to |} ', title: 'Limit' },
    { label: 'd/dx', tex: '\\frac{d}{dx}', title: 'Derivative' },
    { label: 'dy/dx', tex: '\\frac{dy}{dx}', title: 'dy by dx' },
    { label: '∂', tex: '\\frac{\\partial |}{\\partial x}', title: 'Partial derivative' },
    { label: '∇', tex: '\\nabla ', title: 'Nabla' },
    { label: 'ẋ', tex: '\\dot{|}', title: 'Dot (rate of change)' },
    { label: 'ln', tex: '\\ln ', title: 'Natural log' },
    { label: 'log', tex: '\\log_{|} ', title: 'Log to a base' },
    { label: 'eˣ', tex: 'e^{|}', title: 'Exponential' },
  ] },
  { id: 'geometry', name: 'Geometry & trig', items: [
    { label: 'sin', tex: '\\sin ', title: 'Sine' },
    { label: 'cos', tex: '\\cos ', title: 'Cosine' },
    { label: 'tan', tex: '\\tan ', title: 'Tangent' },
    { label: 'sin⁻¹', tex: '\\sin^{-1} ', title: 'Inverse sine' },
    { label: '°', tex: '^\\circ ', title: 'Degrees' },
    { label: '∠', tex: '\\angle ', title: 'Angle' },
    { label: '△', tex: '\\triangle ', title: 'Triangle' },
    { label: '∥', tex: '\\parallel ', title: 'Parallel' },
    { label: '⊥', tex: '\\perp ', title: 'Perpendicular' },
    { label: '≅', tex: '\\cong ', title: 'Congruent' },
    { label: '∼', tex: '\\sim ', title: 'Similar' },
    { label: 'π', tex: '\\pi ', title: 'Pi' },
  ] },
  { id: 'sets', name: 'Sets & logic', items: [
    { label: '∈', tex: '\\in ', title: 'Element of' },
    { label: '∉', tex: '\\notin ', title: 'Not an element of' },
    { label: '⊂', tex: '\\subset ', title: 'Subset' },
    { label: '∪', tex: '\\cup ', title: 'Union' },
    { label: '∩', tex: '\\cap ', title: 'Intersection' },
    { label: '∅', tex: '\\emptyset ', title: 'Empty set' },
    { label: 'ℝ', tex: '\\mathbb{R} ', title: 'Real numbers' },
    { label: 'ℤ', tex: '\\mathbb{Z} ', title: 'Integers' },
    { label: 'ℕ', tex: '\\mathbb{N} ', title: 'Natural numbers' },
    { label: '∀', tex: '\\forall ', title: 'For all' },
    { label: '∃', tex: '\\exists ', title: 'There exists' },
  ] },
  { id: 'science', name: 'Science', items: [
    { label: 'ce{ }', tex: '\\ce{|}', title: 'Chemical formula or equation, e.g. \\ce{2H2 + O2 -> 2H2O}' },
    { label: '⇌', tex: '\\rightleftharpoons ', title: 'Reversible reaction' },
    { label: '↑', tex: '\\uparrow ', title: 'Gas given off' },
    { label: 'Δ', tex: '\\Delta ', title: 'Change in' },
    { label: 'text', tex: '\\text{|}', title: 'Words inside a formula' },
    { label: 'm s⁻¹', tex: '\\,\\mathrm{m\\,s^{-1}}', title: 'Units: metres per second' },
    { label: 'kg', tex: '\\,\\mathrm{kg}', title: 'Units: kilograms' },
    { label: '°C', tex: '\\,^\\circ\\mathrm{C}', title: 'Degrees Celsius' },
    { label: 'Ω', tex: '\\,\\Omega ', title: 'Ohm' },
    { label: 'μ', tex: '\\mu ', title: 'Micro / mu' },
    { label: '∥', tex: '\\parallel ', title: 'Parallel' },
    { label: 'cancel', tex: '\\cancel{|}', title: 'Cross out' },
  ] },
];

const TEMPLATES: Array<{ name: string; tex: string }> = [
  { name: 'Quadratic formula', tex: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}' },
  { name: 'Pythagoras', tex: 'a^2 + b^2 = c^2' },
  { name: 'Circle', tex: 'A = \\pi r^2 \\qquad C = 2\\pi r' },
  { name: 'Sine rule', tex: '\\frac{a}{\\sin A} = \\frac{b}{\\sin B} = \\frac{c}{\\sin C}' },
  { name: 'Cosine rule', tex: 'a^2 = b^2 + c^2 - 2bc\\cos A' },
  { name: 'Gradient', tex: 'm = \\frac{y_2 - y_1}{x_2 - x_1}' },
  { name: 'Differentiation', tex: '\\frac{d}{dx}\\left(x^n\\right) = nx^{n-1}' },
  { name: 'Integration', tex: '\\int x^n \\, dx = \\frac{x^{n+1}}{n+1} + C' },
  { name: 'SUVAT', tex: 'v = u + at \\qquad s = ut + \\tfrac{1}{2}at^2 \\qquad v^2 = u^2 + 2as' },
  { name: "Ohm's law", tex: 'V = IR \\qquad P = IV' },
  { name: 'Photosynthesis', tex: '\\ce{6CO2 + 6H2O ->[\\text{light}] C6H12O6 + 6O2}' },
  { name: 'Combustion of methane', tex: '\\ce{CH4 + 2O2 -> CO2 + 2H2O}' },
  { name: 'Neutralisation', tex: '\\ce{HCl + NaOH -> NaCl + H2O}' },
  { name: 'Moles', tex: 'n = \\frac{m}{M_r}' },
];

/**
 * Type or build an equation, see it typeset as you go, and put it on the board. LaTeX is the input (the same notation as a maths paper or a
 * textbook), with palettes of symbols and structures for anyone who does not know the commands, and ready-made formulas to start from.
 * Nothing leaves the browser: the picture is made here and shared as part of the board.
 */
export function EquationDialog({ open, onClose, onInsert, initial = '' }: {
  open: boolean;
  onClose: () => void;
  /** The LaTeX to put on the board. Resolves when it has been placed; a rejection is shown in the dialog. */
  onInsert: (tex: string) => Promise<void>;
  initial?: string;
}) {
  const titleId = useId();
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [tex, setTex] = useState(initial);
  const [palette, setPalette] = useState(PALETTES[0].id);
  const [preview, setPreview] = useState<MathImage | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => { if (open) { setTex(initial); setPreview(null); setProblem(null); setTimeout(() => areaRef.current?.focus(), 0); } }, [open, initial]);

  // Typeset as they type, a moment after they stop. A stale answer never overwrites a newer one.
  useEffect(() => {
    if (!open) return;
    if (!tex.trim()) { setPreview(null); setProblem(null); return; }
    let current = true;
    const timer = setTimeout(() => {
      renderTex(tex, 34).then((image) => { if (current) { setPreview(image); setProblem(null); } })
        .catch((error: unknown) => { if (current) { setPreview(null); setProblem(error instanceof MathError ? error.message : 'That could not be typeset.'); } });
    }, 180);
    return () => { current = false; clearTimeout(timer); };
  }, [tex, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const put = (snippet: string) => {
    const area = areaRef.current;
    const at = snippet.indexOf('|');
    const clean = snippet.replace('|', '');
    const start = area?.selectionStart ?? tex.length;
    const end = area?.selectionEnd ?? tex.length;
    const next = tex.slice(0, start) + clean + tex.slice(end);
    setTex(next);
    setTimeout(() => { area?.focus(); const caret = start + (at >= 0 ? at : clean.length); area?.setSelectionRange(caret, caret); }, 0);
  };

  const insert = async () => {
    if (!preview || working) return;
    setWorking(true);
    try { await onInsert(tex.trim()); onClose(); }
    catch (error) { setProblem(error instanceof Error ? error.message : 'Could not put the equation on the board.'); }
    finally { setWorking(false); }
  };

  const active = PALETTES.find((entry) => entry.id === palette) ?? PALETTES[0];
  return (
    <div className="equation-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button type="button" className="equation-dialog__scrim" aria-label="Close" onClick={onClose} />
      <div className="equation-dialog__panel">
        <header className="equation-dialog__header">
          <h2 id={titleId}>Add an equation</h2>
          <button type="button" className="chat-close" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </header>
        <div className="equation-dialog__edit">
          <label className="equation-dialog__field">
            <span>LaTeX</span>
            <textarea
              ref={areaRef} value={tex} onChange={(event) => setTex(event.target.value)} rows={4} spellCheck={false} autoCapitalize="none" autoCorrect="off"
              placeholder={'e.g.  x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}   or   \\ce{2H2 + O2 -> 2H2O}'}
              onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void insert(); }}
            />
          </label>
          <div className="equation-dialog__preview" aria-live="polite">
            <span>Preview</span>
            <div className="equation-dialog__preview-box">
              {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL made in this browser: next/image cannot optimise it */}
              {preview ? <img src={preview.dataUrl} alt={`Preview of ${tex.trim()}`} /> : problem ? <p className="equation-dialog__problem" role="alert">{problem}</p> : <p className="equation-dialog__hint">Your equation appears here.</p>}
            </div>
          </div>
        </div>
        <div className="equation-dialog__palettes">
          <div className="equation-dialog__tabs" role="tablist" aria-label="Symbols">
            {PALETTES.map((entry) => <button key={entry.id} type="button" role="tab" aria-selected={entry.id === palette} onClick={() => setPalette(entry.id)}>{entry.name}</button>)}
          </div>
          <div className="equation-dialog__symbols" role="tabpanel" aria-label={`${active.name} symbols`}>
            {active.items.map((item) => <button key={item.title + item.tex} type="button" title={item.title} aria-label={item.title} onClick={() => put(item.tex)}>{item.label}</button>)}
          </div>
        </div>
        <details className="equation-dialog__templates">
          <summary>Ready-made formulas</summary>
          <div>{TEMPLATES.map((template) => <button key={template.name} type="button" onClick={() => setTex(template.tex)}>{template.name}</button>)}</div>
        </details>
        <footer className="equation-dialog__footer">
          <p>Ctrl or Cmd + Enter to add it.</p>
          <button type="button" className="button button-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="button button-primary" onClick={() => void insert()} disabled={!preview || working}>{working ? 'Adding…' : 'Add to the board'}</button>
        </footer>
      </div>
    </div>
  );
}
