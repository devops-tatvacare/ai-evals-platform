import { useEffect, useRef, useState } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-python";
import "prismjs/components/prism-json";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-markdown";
import "prismjs/themes/prism-tomorrow.min.css";
import { Copy, Check } from "lucide-react";

interface CodeBlockProps {
  code: string;
  language: "typescript" | "python" | "json" | "bash" | "markdown";
}

export default function CodeBlock({ code, language }: CodeBlockProps) {
  const codeRef = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (codeRef.current) {
      Prism.highlightElement(codeRef.current);
    }
  }, [code, language]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="relative my-4 overflow-hidden rounded-lg"
      style={{ background: "var(--code-bg)" }}
    >
      <button
        type="button"
        onClick={handleCopy}
        className="export-btn absolute right-3 top-3 z-10 flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
        style={{
          background: "rgba(255, 255, 255, 0.1)",
          color: "#94a3b8",
          border: "none",
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? "Copied!" : "Copy"}
      </button>
      <div className="overflow-x-auto">
        <pre className="p-4 text-sm leading-relaxed" style={{ margin: 0 }}>
          <code
            ref={codeRef}
            className={`language-${language}`}
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {code}
          </code>
        </pre>
      </div>
    </div>
  );
}
