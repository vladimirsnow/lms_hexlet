"use client";

import { useEditor, EditorContent, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Heading2, Italic, List, ListOrdered, Quote, Redo2, Undo2 } from "lucide-react";
import { normalizeLocale, type AppLocale } from "@/lib/i18n";
import { useState } from "react";

const labels = {
  ru: {
    toolbar: "Форматирование текста",
    bold: "Полужирный",
    italic: "Курсив",
    heading: "Заголовок",
    bulletList: "Маркированный список",
    orderedList: "Нумерованный список",
    quote: "Цитата",
    undo: "Отменить",
    redo: "Повторить",
  },
  kk: {
    toolbar: "Мәтінді пішімдеу",
    bold: "Қалың",
    italic: "Көлбеу",
    heading: "Тақырып",
    bulletList: "Маркерленген тізім",
    orderedList: "Нөмірленген тізім",
    quote: "Дәйексөз",
    undo: "Болдырмау",
    redo: "Қайталау",
  },
  en: {
    toolbar: "Text formatting",
    bold: "Bold",
    italic: "Italic",
    heading: "Heading",
    bulletList: "Bulleted list",
    orderedList: "Numbered list",
    quote: "Block quote",
    undo: "Undo",
    redo: "Redo",
  },
} satisfies Record<AppLocale, Record<string, string>>;

export function RichTextEditor({
  name,
  ariaLabel,
  locale,
}: {
  name: string;
  ariaLabel: string;
  locale: AppLocale | string;
}) {
  const appLocale = normalizeLocale(locale);
  const t = labels[appLocale];
  const [html, setHtml] = useState("");
  const editor = useEditor({
    extensions: [StarterKit],
    content: "",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "rich-text-editor__surface",
        role: "textbox",
        "aria-label": ariaLabel,
        "aria-multiline": "true",
      },
    },
    onUpdate: ({ editor: currentEditor }) => setHtml(currentEditor.getHTML()),
  });
  const state = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      bold: currentEditor?.isActive("bold") ?? false,
      italic: currentEditor?.isActive("italic") ?? false,
      heading: currentEditor?.isActive("heading", { level: 2 }) ?? false,
      bulletList: currentEditor?.isActive("bulletList") ?? false,
      orderedList: currentEditor?.isActive("orderedList") ?? false,
      blockquote: currentEditor?.isActive("blockquote") ?? false,
    }),
  });

  return (
    <div className="rich-text-editor">
      <div className="rich-text-editor__toolbar" role="toolbar" aria-label={t.toolbar}>
        <button
          aria-label={t.bold}
          aria-pressed={state?.bold ?? false}
          className="rich-text-editor__tool"
          disabled={!editor}
          onClick={() => editor?.chain().focus().toggleBold().run()}
          type="button"
        >
          <Bold aria-hidden="true" size={16} />
        </button>
        <button
          aria-label={t.italic}
          aria-pressed={state?.italic ?? false}
          className="rich-text-editor__tool"
          disabled={!editor}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          type="button"
        >
          <Italic aria-hidden="true" size={16} />
        </button>
        <button
          aria-label={t.heading}
          aria-pressed={state?.heading ?? false}
          className="rich-text-editor__tool"
          disabled={!editor}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          type="button"
        >
          <Heading2 aria-hidden="true" size={16} />
        </button>
        <button
          aria-label={t.bulletList}
          aria-pressed={state?.bulletList ?? false}
          className="rich-text-editor__tool"
          disabled={!editor}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          type="button"
        >
          <List aria-hidden="true" size={16} />
        </button>
        <button
          aria-label={t.orderedList}
          aria-pressed={state?.orderedList ?? false}
          className="rich-text-editor__tool"
          disabled={!editor}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          type="button"
        >
          <ListOrdered aria-hidden="true" size={16} />
        </button>
        <button
          aria-label={t.quote}
          aria-pressed={state?.blockquote ?? false}
          className="rich-text-editor__tool"
          disabled={!editor}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          type="button"
        >
          <Quote aria-hidden="true" size={16} />
        </button>
        <span className="rich-text-editor__separator" aria-hidden="true" />
        <button
          aria-label={t.undo}
          className="rich-text-editor__tool"
          disabled={!editor || !editor.can().undo()}
          onClick={() => editor?.chain().focus().undo().run()}
          type="button"
        >
          <Undo2 aria-hidden="true" size={16} />
        </button>
        <button
          aria-label={t.redo}
          className="rich-text-editor__tool"
          disabled={!editor || !editor.can().redo()}
          onClick={() => editor?.chain().focus().redo().run()}
          type="button"
        >
          <Redo2 aria-hidden="true" size={16} />
        </button>
      </div>
      <EditorContent editor={editor} className="rich-text-editor__content" />
      <input type="hidden" name={name} value={html} />
    </div>
  );
}
