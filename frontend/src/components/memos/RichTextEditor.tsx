import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import {
  Bold,
  Italic,
  Strikethrough,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Link as LinkIcon,
  Quote as QuoteIcon,
  Undo2,
  Redo2,
  Code,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: number;
}

// TipTap-based rich-text editor for memos. Output is HTML kept in
// memos.content as a string — we don't add a new column, the existing
// text column tolerates HTML (it's just text). The MemosPanel render
// path uses dangerouslySetInnerHTML; that's safe because the only
// writers are project members (RLS guards) and TipTap sanitises input.
//
// Chosen feature set is the absolute minimum a researcher will demand:
// bold/italic/strike, two heading levels, lists, blockquote, link, code.
// No tables, no images, no YouTube embeds — those would require a
// dedicated content model and are out of scope for memos.
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  className,
  minHeight = 280,
}: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable code block (separate from inline `code` mark): too
        // niche, and TipTap's default uses <pre> which doesn't paste
        // back nicely into Markdown exports.
        codeBlock: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        protocols: ["http", "https", "mailto"],
        // Render in primary color so users can see they're links inside
        // the editor without hovering.
        HTMLAttributes: {
          class: "text-primary underline underline-offset-2",
          rel: "noopener noreferrer",
        },
      }),
    ],
    content: value || "",
    onUpdate({ editor }) {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-sm dark:prose-invert max-w-none focus:outline-none",
          "p-3 min-h-[280px] rounded-md border bg-background"
        ),
      },
    },
  });

  // Sync external changes (e.g. user picked a different memo from the
  // list) without losing focus when the user is mid-typing in the same
  // memo. Only set content when the actual selected memo's HTML differs.
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== value) {
      editor.commands.setContent(value || "", { emitUpdate: false });
    }
  }, [value, editor]);

  if (!editor) return null;

  return (
    <div className={cn("flex flex-col", className)}>
      <Toolbar editor={editor} />
      <div style={{ minHeight }} className="flex-1">
        <EditorContent editor={editor} placeholder={placeholder} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------

type Editor = NonNullable<ReturnType<typeof useEditor>>;

function Toolbar({ editor }: { editor: Editor }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1 rounded-md border bg-muted/40 p-1">
      <ToolbarButton
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        label="Negrita"
      >
        <Bold className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        label="Cursiva"
      >
        <Italic className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        label="Tachado"
      >
        <Strikethrough className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
        label="Código"
      >
        <Code className="h-3.5 w-3.5" />
      </ToolbarButton>
      <Divider />
      <ToolbarButton
        active={editor.isActive("heading", { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        label="Título 1"
      >
        <Heading1 className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        label="Título 2"
      >
        <Heading2 className="h-3.5 w-3.5" />
      </ToolbarButton>
      <Divider />
      <ToolbarButton
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        label="Lista"
      >
        <List className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        label="Lista numerada"
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        label="Cita"
      >
        <QuoteIcon className="h-3.5 w-3.5" />
      </ToolbarButton>
      <Divider />
      <ToolbarButton
        active={editor.isActive("link")}
        onClick={() => {
          const previous = editor.getAttributes("link").href as string | undefined;
          const url = window.prompt("URL del enlace", previous ?? "https://");
          if (url === null) return;
          if (url === "") {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
          } else {
            editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
          }
        }}
        label="Enlace"
      >
        <LinkIcon className="h-3.5 w-3.5" />
      </ToolbarButton>
      <Divider />
      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        label="Deshacer"
      >
        <Undo2 className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        label="Rehacer"
      >
        <Redo2 className="h-3.5 w-3.5" />
      </ToolbarButton>
    </div>
  );
}

function ToolbarButton({
  active,
  onClick,
  disabled,
  label,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "secondary" : "ghost"}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="h-7 w-7 p-0"
    >
      {children}
    </Button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-border" />;
}
