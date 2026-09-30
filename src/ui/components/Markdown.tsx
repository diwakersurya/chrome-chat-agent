import * as stylex from '@stylexjs/stylex'
import { memo, useEffect, useState, type ComponentProps } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { color, font, radius, space } from '../tokens.stylex'
import { CopyButton } from './CopyButton'

// Shiki is heavy — load it on first code block only.
let highlighter: Promise<typeof import('shiki/bundle/web')> | undefined
const loadShiki = () => (highlighter ??= import('shiki/bundle/web'))

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string>()
  useEffect(() => {
    let live = true
    const t = setTimeout(async () => {
      try {
        const { codeToHtml, bundledLanguages } = await loadShiki()
        const out = await codeToHtml(code, {
          lang: lang in bundledLanguages ? lang : 'text',
          themes: { light: 'github-light', dark: 'github-dark' },
          defaultColor: false,
        })
        if (live) setHtml(out)
      } catch {
        // plain <pre> fallback stays
      }
    }, 120) // debounce while streaming
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [code, lang])

  return (
    <figure {...stylex.props(styles.codeFigure)}>
      <figcaption {...stylex.props(styles.codeBar)}>
        <span>{lang || 'text'}</span>
        <CopyButton text={code} label="Copy code" />
      </figcaption>
      {html ? (
        <div {...stylex.props(styles.codeBody)} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre {...stylex.props(styles.codeBody, styles.pre)}>
          <code>{code}</code>
        </pre>
      )}
    </figure>
  )
}

const components: ComponentProps<typeof ReactMarkdown>['components'] = {
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const text = String(children ?? '')
    const lang = /language-([\w+#-]+)/.exec(className ?? '')?.[1]
    if (!lang && !text.includes('\n')) return <code {...stylex.props(styles.inlineCode)}>{children}</code>
    return <CodeBlock code={text.replace(/\n$/, '')} lang={lang ?? ''} />
  },
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener" {...stylex.props(styles.link)}>
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div {...stylex.props(styles.tableWrap)}>
      <table {...stylex.props(styles.table)}>{children}</table>
    </div>
  ),
  th: ({ children }) => <th {...stylex.props(styles.cell, styles.th)}>{children}</th>,
  td: ({ children }) => <td {...stylex.props(styles.cell)}>{children}</td>,
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div {...stylex.props(styles.prose)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})

const styles = stylex.create({
  prose: {
    fontFamily: font.prose,
    fontSize: font.prosePx,
    lineHeight: 1.62,
    color: color.ink,
    overflowWrap: 'anywhere',
  },
  inlineCode: {
    fontFamily: font.mono,
    fontSize: '0.86em',
    backgroundColor: color.sunken,
    paddingInline: space.xs,
    paddingBlock: space.xxs,
    borderRadius: radius.sm,
  },
  codeFigure: {
    marginInline: 0,
    marginBlock: space.md,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.line,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: color.surface,
  },
  codeBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingInlineStart: space.md,
    paddingInlineEnd: space.xs,
    paddingBlock: space.xxs,
    fontFamily: font.ui,
    fontSize: font.xs,
    color: color.muted,
    backgroundColor: color.sunken,
  },
  codeBody: {
    fontFamily: font.mono,
    fontSize: font.sm,
    lineHeight: 1.55,
    padding: space.md,
    overflowX: 'auto',
  },
  pre: { margin: 0 },
  link: { color: color.accent, textUnderlineOffset: '3px' },
  tableWrap: { overflowX: 'auto', marginBlock: space.md },
  table: { borderCollapse: 'collapse', fontFamily: font.ui, fontSize: font.sm },
  cell: {
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.line,
    paddingInline: space.sm,
    paddingBlock: space.xs,
    textAlign: 'start',
  },
  th: { backgroundColor: color.sunken, fontWeight: 600 },
})
