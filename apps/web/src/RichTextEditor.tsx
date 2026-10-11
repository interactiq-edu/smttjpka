import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Mark, Node } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import type { RichTextDocument } from '@interactiq/contracts';

const emptyDocument: RichTextDocument = { type: 'doc', content: [{ type: 'paragraph' }] };

const ImageNode = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  addAttributes: () => ({ src: { default: null }, alt: { default: '' } }),
  parseHTML: () => [{ tag: 'img[src]' }],
  renderHTML: ({ HTMLAttributes }) => ['img', { ...HTMLAttributes, loading: 'lazy' }],
});

const Superscript = Mark.create({
  name: 'superscript',
  excludes: 'subscript',
  parseHTML: () => [{ tag: 'sup' }],
  renderHTML: () => ['sup', 0],
});

const Subscript = Mark.create({
  name: 'subscript',
  excludes: 'superscript',
  parseHTML: () => [{ tag: 'sub' }],
  renderHTML: () => ['sub', 0],
});

const symbolGroups = [
  { label: 'Arithmetic', items: ['±','×','÷','·','−','√','∛','∞','%'] },
  { label: 'Relations', items: ['=','≠','≈','≡','<','>','≤','≥','∝'] },
  { label: 'Algebra & calculus', items: ['∑','∏','∫','∬','∂','∇','Δ','∞'] },
  { label: 'Greek', items: ['α','β','γ','δ','θ','λ','μ','ρ','σ','φ','ω','π','Δ','Ω'] },
  { label: 'Geometry & engineering', items: ['°','∠','⊥','∥','→','↔','⌀','℃','Ω'] },
  { label: 'Sets & logic', items: ['∈','∉','⊂','⊆','∪','∩','∀','∃','¬','⇒'] },
];
const equationGroups = [
  { label: 'Powers & roots', items: ['x²','x³','xⁿ','a₁','aₙ','√(x)','∛(x)','ⁿ√(x)','|x|'] },
  { label: 'Fractions & rates', items: ['a/b','Δy/Δx','dy/dx','d²y/dx²','∂y/∂x'] },
  { label: 'Calculus & series', items: ['lim x→a','Σᵢ₌₁ⁿ xᵢ','∫ f(x) dx','∫ₐᵇ f(x) dx'] },
  { label: 'Trigonometry & logs', items: ['sin(θ)','cos(θ)','tan(θ)','logₐ(x)','ln(x)','eˣ'] },
  { label: 'Common engineering', items: ['F = ma','V = IR','P = VI','σ = P/A','v = u + at','Q = mcΔT'] },
];

export function RichTextEditor({ value, onChange, onUploadImage, mode = 'full', label = 'Resource content editor' }: { value: RichTextDocument; onChange: (document: RichTextDocument) => void; onUploadImage?: (file: File) => Promise<string>; mode?: 'full' | 'math'; label?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState('');
  const [picker, setPicker] = useState<'symbol' | 'equation' | null>(null);
  const [equation, setEquation] = useState('');
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Superscript,
      Subscript,
      Link.configure({ openOnClick: false, autolink: false, protocols: ['http', 'https'], HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } }),
      ImageNode,
    ],
    content: value.content.length ? value : emptyDocument,
    editorProps: { attributes: { class: 'rich-editor__content', 'aria-label': label } },
    onUpdate: ({ editor: instance }) => onChange(instance.getJSON() as RichTextDocument),
  });

  useEffect(() => {
    if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(value)) editor.commands.setContent(value.content.length ? value : emptyDocument, { emitUpdate: false });
  }, [editor, value]);

  if (!editor) return null;
  const command = (callback: () => void) => () => { callback(); editor.chain().focus().run(); };
  const addLink = () => {
    const href = window.prompt('Enter an https:// or http:// URL');
    if (href && /^https?:\/\//i.test(href)) editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  };
  const addImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 5_000_000) {
      setImageError('Use a PNG, JPG, WebP, or GIF image smaller than 5 MB.');
      return;
    }
    if (!onUploadImage) { setImageError('Image storage is not configured yet.'); return; }
    try {
      const src = await onUploadImage(file);
      editor.chain().focus().insertContent({ type: 'image', attrs: { src, alt: file.name.slice(0, 120) } }).run();
      setImageError('');
    } catch (error) { setImageError(error instanceof Error ? error.message : 'Unable to upload this image.'); }
  };
  const insertText = (text: string) => { editor.chain().focus().insertContent(text).run(); setPicker(null); };

  return <div className="rich-editor">
    <div className="rich-editor__toolbar" aria-label="Formatting toolbar">
      <button aria-label="Undo" disabled={!editor.can().undo()} onClick={command(() => editor.chain().undo().run())} type="button">Undo</button>
      <button aria-label="Redo" disabled={!editor.can().redo()} onClick={command(() => editor.chain().redo().run())} type="button">Redo</button>
      <span className="toolbar-divider" />
      <button className={editor.isActive('bold') ? 'is-active' : ''} onClick={command(() => editor.chain().toggleBold().run())} type="button"><strong>B</strong></button>
      <button className={editor.isActive('italic') ? 'is-active' : ''} onClick={command(() => editor.chain().toggleItalic().run())} type="button"><em>I</em></button>
      <button className={editor.isActive('underline') ? 'is-active' : ''} onClick={command(() => editor.chain().toggleUnderline().run())} type="button"><u>U</u></button>
      <button className={editor.isActive('strike') ? 'is-active' : ''} onClick={command(() => editor.chain().toggleStrike().run())} type="button"><s>S</s></button>
      <button aria-label="Superscript" className={editor.isActive('superscript') ? 'is-active' : ''} onClick={command(() => editor.chain().toggleMark('superscript').run())} type="button">x<sup>2</sup></button>
      <button aria-label="Subscript" className={editor.isActive('subscript') ? 'is-active' : ''} onClick={command(() => editor.chain().toggleMark('subscript').run())} type="button">x<sub>2</sub></button>
      <label className="toolbar-colour" title="Font colour"><span>A</span><input aria-label="Font colour" type="color" value={String(editor.getAttributes('textStyle').color ?? '#17151c')} onChange={(event) => editor.chain().focus().setColor(event.target.value).run()} /></label>
      {mode === 'full' && <><button className={editor.isActive('highlight') ? 'is-active' : ''} onClick={command(() => editor.chain().toggleHighlight({ color: '#f8e2b8' }).run())} type="button">Highlight</button><button className={editor.isActive('link') ? 'is-active' : ''} onClick={addLink} type="button">Link</button><span className="toolbar-divider" /><button className={editor.isActive('heading', { level: 2 }) ? 'is-active' : ''} onClick={command(() => editor.chain().toggleHeading({ level: 2 }).run())} type="button">H2</button><button className={editor.isActive('bulletList') ? 'is-active' : ''} onClick={command(() => editor.chain().toggleBulletList().run())} type="button">List</button><button className={editor.isActive('orderedList') ? 'is-active' : ''} onClick={command(() => editor.chain().toggleOrderedList().run())} type="button">1. List</button><button className={editor.isActive('blockquote') ? 'is-active' : ''} onClick={command(() => editor.chain().toggleBlockquote().run())} type="button">Quote</button></>}
      <button onClick={() => setPicker('symbol')} type="button">Σ Symbol</button>
      <button onClick={() => setPicker('equation')} type="button">ƒ(x) Equation</button>
      {onUploadImage && <button onClick={() => inputRef.current?.click()} type="button">Upload image</button>}
      {onUploadImage && <button className="toolbar-danger" disabled={!editor.isActive('image')} onClick={command(() => editor.chain().deleteSelection().run())} type="button">Delete image</button>}
      <button onClick={command(() => editor.chain().unsetAllMarks().clearNodes().run())} type="button">Clear</button>
    </div>
    <input accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Upload image" className="visually-hidden" onChange={addImage} ref={inputRef} type="file" />
    {imageError && <p className="message message--error">{imageError}</p>}
    <EditorContent editor={editor} />
    {picker && <div className="math-picker-backdrop" role="presentation" onMouseDown={() => setPicker(null)}><section aria-modal="true" className="math-picker" onMouseDown={(event) => event.stopPropagation()} role="dialog"><button aria-label="Close" className="math-picker__close" onClick={() => setPicker(null)} type="button">×</button><p className="eyebrow">{picker === 'symbol' ? 'Insert symbol' : 'Equation editor'}</p><h3>{picker === 'symbol' ? 'Choose a standard mathematical symbol' : 'Choose or type an equation'}</h3><p className="muted">Symbols use standard Unicode mathematical notation and remain readable across modern devices.</p><div className="math-picker__groups">{(picker === 'symbol' ? symbolGroups : equationGroups).map((group) => <section key={group.label}><h4>{group.label}</h4><div className="math-picker__grid">{group.items.map((item) => <button key={item} onClick={() => insertText(item)} type="button">{item}</button>)}</div></section>)}</div>{picker === 'equation' && <div className="math-picker__custom"><label>Custom equation<input autoFocus placeholder="e.g. F = ma or σ = P/A" value={equation} onChange={(event) => setEquation(event.target.value)} /></label><button className="primary-action primary-action--dark" disabled={!equation.trim()} onClick={() => { insertText(equation.trim()); setEquation(''); }} type="button">Insert equation</button></div>}</section></div>}
  </div>;
}
