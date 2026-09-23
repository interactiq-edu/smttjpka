import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Node } from '@tiptap/core';
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

export function RichTextEditor({ value, onChange, onUploadImage }: { value: RichTextDocument; onChange: (document: RichTextDocument) => void; onUploadImage?: (file: File) => Promise<string> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState('');
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Link.configure({ openOnClick: false, autolink: false, protocols: ['http', 'https'], HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } }),
      ImageNode,
    ],
    content: value.content.length ? value : emptyDocument,
    editorProps: { attributes: { class: 'rich-editor__content', 'aria-label': 'Resource content editor' } },
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

  return <div className="rich-editor">
    <div className="rich-editor__toolbar" aria-label="Formatting toolbar">
      <button aria-label="Undo" disabled={!editor.can().undo()} onClick={command(() => editor.chain().undo().run())} type="button">Undo</button>
      <button aria-label="Redo" disabled={!editor.can().redo()} onClick={command(() => editor.chain().redo().run())} type="button">Redo</button>
      <span className="toolbar-divider" />
      <button className={editor.isActive('bold') ? 'is-active' : ''} onClick={command(() => editor.chain().toggleBold().run())} type="button"><strong>B</strong></button>
      <button className={editor.isActive('italic') ? 'is-active' : ''} onClick={command(() => editor.chain().toggleItalic().run())} type="button"><em>I</em></button>
      <button className={editor.isActive('underline') ? 'is-active' : ''} onClick={command(() => editor.chain().toggleUnderline().run())} type="button"><u>U</u></button>
      <button className={editor.isActive('strike') ? 'is-active' : ''} onClick={command(() => editor.chain().toggleStrike().run())} type="button"><s>S</s></button>
      <button className={editor.isActive('highlight') ? 'is-active' : ''} onClick={command(() => editor.chain().toggleHighlight({ color: '#f8e2b8' }).run())} type="button">Highlight</button>
      <button className={editor.isActive('link') ? 'is-active' : ''} onClick={addLink} type="button">Link</button>
      <span className="toolbar-divider" />
      <button className={editor.isActive('heading', { level: 2 }) ? 'is-active' : ''} onClick={command(() => editor.chain().toggleHeading({ level: 2 }).run())} type="button">H2</button>
      <button className={editor.isActive('bulletList') ? 'is-active' : ''} onClick={command(() => editor.chain().toggleBulletList().run())} type="button">List</button>
      <button className={editor.isActive('orderedList') ? 'is-active' : ''} onClick={command(() => editor.chain().toggleOrderedList().run())} type="button">1. List</button>
      <button className={editor.isActive('blockquote') ? 'is-active' : ''} onClick={command(() => editor.chain().toggleBlockquote().run())} type="button">Quote</button>
      <button onClick={() => inputRef.current?.click()} type="button">Upload image</button>
      <button className="toolbar-danger" disabled={!editor.isActive('image')} onClick={command(() => editor.chain().deleteSelection().run())} type="button">Delete image</button>
      <button onClick={command(() => editor.chain().unsetAllMarks().clearNodes().run())} type="button">Clear</button>
    </div>
    <input accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Upload image" className="visually-hidden" onChange={addImage} ref={inputRef} type="file" />
    {imageError && <p className="message message--error">{imageError}</p>}
    <EditorContent editor={editor} />
  </div>;
}
